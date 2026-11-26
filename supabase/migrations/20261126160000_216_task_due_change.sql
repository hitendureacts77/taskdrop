-- 216 -- plan 1.19 rows J and K: a task never disappears when its date passes (owner, 25 Nov).
--
--   set_task_due(task, due)   the poster's own OPEN post gets a new date, or none (an open task:
--                             no completion date, it stays open until someone is picked). A crew's
--                             open posts move together. Same range as the api's dueAtOrNull: not
--                             already past (5 minutes of clock difference allowed), within 3 years.
--                             A City Hunt's time is fixed (158), so a Hunt is refused.
--   tasks.due_lapsed_at       the date an open post had when it passed with nobody picked.
--   run_task_reminders()      the same two reminders as migration 128, unchanged, plus a third
--                             step: an OPEN post (not a City Hunt) whose date passed with nobody
--                             picked SWITCHES TO NO FIXED DATE (due_at -> null, the old date kept in
--                             due_lapsed_at) and stays open. The poster is told once (a crew once),
--                             only when the date passed in the last 3 days, so the first run does
--                             not message about old posts. A new date that passes again switches
--                             and tells again. Runs on pg_cron every 15 minutes (job
--                             'task-reminders', migration 200).
--   the guest and list reads  PASSED-DATE OPEN TASKS BECOME VISIBLE AGAIN. Seven functions are
--                             re-created from their latest definitions with only the line
--                             `and (t.due_at is null or t.due_at > now())` removed:
--                             guest_open_posts, guest_helpers (146), guest_task_questions,
--                             guest_public_media (151), guest_open_posts_near, guest_helpers_near
--                             (162), private.platform_highlights_live (166).
--                             Reminders, watchdogs and on-time checks (095, 105, 128, 134, 175) and
--                             the Plan B hold expiry (195) are not touched.
--   bids.proposed_due_at      a worker's own finish date on an offer (nullable). Checked by a
--                             trigger: from now on, within 3 years. The worker may set it on insert
--                             and change it while the offer is not accepted (column grants).
--   on_bid_inserted()         158's body; the "offered" notification now says "Can finish by <date>"
--                             when the offer has one.
--   bids_due_on_accept        when an offer with a date is accepted (bids.is_locked turns true, in
--                             lock_bid or auto-accept), the task's due_at becomes that date, in the
--                             same transaction. lock_bid and every money step are not changed.
--
-- Adds only. Undo: supabase/undo/216_task_due_change.down.sql.

-- The date an open post had when it passed with nobody picked (it then switches to no fixed date).
-- Cleared when the poster sets a new date or accepts an offer. Readable like every task column.
alter table public.tasks add column if not exists due_lapsed_at timestamptz;

create or replace function public.set_task_due(p_task_id uuid, p_due_at timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_crew uuid;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  if p_due_at is not null
     and (p_due_at < now() - interval '5 minutes' or p_due_at > now() + interval '3 years') then
    raise exception 'Pick a date from now on, within 3 years' using errcode = 'P0001';
  end if;

  select t.crew_id into v_crew
    from public.tasks t
   where t.id = p_task_id and t.poster_id = v_me and t.status = 'OPEN' and t.hunt_window is null;
  if not found then
    raise exception 'This task can no longer be changed' using errcode = 'P0001';
  end if;

  update public.tasks
     set due_at = p_due_at, due_lapsed_at = null
   where poster_id = v_me
     and status = 'OPEN'
     and hunt_window is null
     and (id = p_task_id or (v_crew is not null and crew_id = v_crew));

  return p_due_at;
end;
$$;
revoke all on function public.set_task_due(uuid, timestamptz) from public, anon;
grant execute on function public.set_task_due(uuid, timestamptz) to authenticated;

create or replace function public.run_task_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  r        record;
  v_review integer := 0;
  v_due    integer := 0;
  v_passed integer := 0;
begin
  perform private.assert_service_caller();

  -- One run at a time; a second caller simply does nothing.
  if not pg_try_advisory_xact_lock(hashtextextended('run_task_reminders', 0)) then
    return jsonb_build_object('review_reminders', 0, 'due_reminders', 0, 'date_passed', 0, 'skipped', true);
  end if;

  -- Poster: finished work, approved for them within 24 hours if they do nothing.
  for r in
    select t.id, t.poster_id, t.title
      from public.tasks t
     where t.status = 'WORK_DONE'
       and t.funded_at is not null
       and t.auto_complete_at is not null
       and t.auto_complete_at > now()
       and t.auto_complete_at <= now() + interval '24 hours'
       and not exists (select 1 from public.notifications n
                        where n.task_id = t.id and n.user_id = t.poster_id and n.kind = 'review_reminder')
     order by t.auto_complete_at
     limit 500
  loop
    perform private.notify(
      r.poster_id, 'review_reminder',
      'Work is waiting for your approval',
      private.label(r.title) || ': approve it or report a problem. If you do nothing, it is approved for you within 24 hours.',
      r.id);
    v_review := v_review + 1;
  end loop;

  -- Worker: a started job that falls due within the hour.
  for r in
    select t.id, t.title, a.worker_id
      from public.tasks t
      join public.assignments a on a.task_id = t.id and a.status = 'started'
     where t.status = 'TASK_STARTED'
       and t.due_at is not null
       and t.due_at > now()
       and t.due_at <= now() + interval '1 hour'
       and not exists (select 1 from public.notifications n
                        where n.task_id = t.id and n.user_id = a.worker_id and n.kind = 'due_reminder')
     order by t.due_at
     limit 500
  loop
    perform private.notify(
      r.worker_id, 'due_reminder',
      'Due within the hour',
      'Send ' || private.label(r.title) || ' before the deadline.',
      r.id);
    v_due := v_due + 1;
  end loop;

  -- Poster (plan 1.19 J, owner 25 Nov): an open post whose date passed with nobody picked switches
  -- to no fixed date and stays open. The old date is kept in due_lapsed_at (the poster's banner).
  -- A crew switches together and its poster is told once. Told only when the date passed in the
  -- last 3 days, so the first run does not message about old posts. A City Hunt's time is fixed,
  -- so it is left out.
  for r in
    select distinct on (coalesce(t.crew_id, t.id)) t.id, t.poster_id, t.title, t.crew_id, t.due_at
      from public.tasks t
     where t.status = 'OPEN'
       and t.hunt_window is null
       and t.due_at is not null
       and t.due_at < now()
     order by coalesce(t.crew_id, t.id), t.due_at
     limit 500
  loop
    update public.tasks
       set due_lapsed_at = due_at, due_at = null
     where status = 'OPEN'
       and hunt_window is null
       and due_at is not null
       and due_at < now()
       and (id = r.id or (r.crew_id is not null and crew_id = r.crew_id));
    -- Someone was picked, or a new date set, since the select: nothing switched, so say nothing.
    if not found then
      continue;
    end if;
    if r.due_at > now() - interval '3 days'
       and not exists (select 1 from public.profiles p where p.id = r.poster_id and p.deleted_at is not null) then
      perform private.notify(
        r.poster_id, 'date_passed',
        'Your date passed: the task is still open',
        private.label(r.title) || ' now has no fixed date. Helpers can still offer and tell you when they can finish. Set a new date if you need it by a certain day.',
        r.id);
    end if;
    v_passed := v_passed + 1;
  end loop;

  return jsonb_build_object('review_reminders', v_review, 'due_reminders', v_due, 'date_passed', v_passed);
end;
$$;

-- ---- passed-date open tasks stay visible (plan 1.19 J, owner 25 Nov) --------------------------

-- public.guest_open_posts: as last defined in 146, without the date cut-off.
create or replace function public.guest_open_posts(
  p_kind      text    default 'request',
  p_limit     integer default 30,
  p_q         text    default null,
  p_pillar    text    default null,
  p_min_minor bigint  default null,
  p_max_minor bigint  default null,
  p_flag      text    default null,
  p_pinned    boolean default null,
  p_poster    uuid    default null,
  p_ids       uuid[]  default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.guest_task_json(t) || jsonb_build_object('poster', private.guest_person_json(p))
    from public.tasks t
    left join public.profiles p on p.id = t.poster_id
   where t.status = 'OPEN'
     and (p_kind is null or t.kind = p_kind)
     and not private.task_is_hidden(t.id)
     and (p.id is null or p.deleted_at is null)
     and (nullif(btrim(p_q), '') is null
          or strpos(lower(t.title), lower(btrim(p_q))) > 0
          or strpos(lower(coalesce(t.description, '')), lower(btrim(p_q))) > 0)
     and (p_pillar is null or t.pillar::text = p_pillar)
     and (p_min_minor is null or t.benchmark_minor >= p_min_minor)
     and (p_max_minor is null or t.benchmark_minor <= p_max_minor)
     and (p_flag is null or t.flag::text = p_flag)
     and (p_pinned is null or (t.loc_lat is not null) = p_pinned)
     and (p_poster is null or t.poster_id = p_poster)
     and (p_ids is null or t.id = any(p_ids))
   order by t.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 500)
$$;

-- public.guest_helpers: as last defined in 146, without the date cut-off.
create or replace function public.guest_helpers(p_limit integer default 300)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.guest_person_json(p)
    from public.profiles p
   where p.onboarded_at is not null
     and p.deleted_at is null
     and p.loc_lat is not null
     and (p.skills <> '{}'
          or exists (select 1 from public.tasks t
                      where t.poster_id = p.id and t.kind = 'service' and t.status = 'OPEN'
                        and not private.task_is_hidden(t.id)))
   order by p.last_seen_at desc nulls last
   limit least(greatest(coalesce(p_limit, 300), 1), 300)
$$;

-- public.guest_task_questions: as last defined in 151, without the date cut-off.
create or replace function public.guest_task_questions(p_task uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id,
             'body', q.body,
             'answer', q.answer,
             'answeredAt', q.answered_at,
             'asker', private.question_first_name(pr.display_name),
             'mine', false,
             'createdAt', q.created_at
           ) order by q.created_at)
      from (select * from public.task_questions
             where task_id = p_task and hidden_at is null
             order by created_at limit 100) q
      left join public.profiles pr on pr.id = q.asker_id
     where exists (select 1 from public.tasks t
                    join public.profiles p on p.id = t.poster_id
                   where t.id = p_task
                     and t.status = 'OPEN'
                     and p.deleted_at is null
                     and not private.task_is_hidden(t.id))
  ), '[]'::jsonb)
$$;

-- public.guest_public_media: as last defined in 151, without the date cut-off.
create or replace function public.guest_public_media(p_paths text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.path), '{}'::text[])
    from unnest((coalesce(p_paths, '{}'::text[]))[1:200]) as x(path)
   where exists (select 1 from public.tasks t
                  where t.media_path = x.path and t.status = 'OPEN'
                    and not private.task_is_hidden(t.id)
                    and private.guest_owns_media(t.poster_id, x.path))
      or exists (select 1 from public.profiles p
                  where p.avatar_url = x.path and p.deleted_at is null
                    and private.guest_owns_media(p.id, x.path))
      or exists (select 1
                   from public.task_proofs tp
                   join public.tasks t on t.id = tp.task_id
                   join public.profiles w on w.id = tp.worker_id and w.deleted_at is null
                   cross join lateral jsonb_array_elements(tp.files) f
                  where f ->> 'path' = x.path
                    and f ->> 'label' in ('before', 'after')
                    and t.photos_public
                    and t.status in ('COMPLETED', 'AUTO_COMPLETED')
                    and not private.task_is_hidden(t.id)
                    and private.guest_owns_media(tp.worker_id, x.path))
$$;

-- public.guest_open_posts_near: as last defined in 162, without the date cut-off.
create or replace function public.guest_open_posts_near(
  p_kind      text    default 'request',
  p_limit     integer default 30,
  p_q         text    default null,
  p_pillar    text    default null,
  p_min_minor bigint  default null,
  p_max_minor bigint  default null,
  p_flag      text    default null,
  p_pinned    boolean default null,
  p_poster    uuid    default null,
  p_ids       uuid[]  default null,
  p_min_lat   double precision default null,
  p_max_lat   double precision default null,
  p_min_lng   double precision default null,
  p_max_lng   double precision default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.guest_task_json(t) || jsonb_build_object('poster', private.guest_person_json(p))
    from public.tasks t
    left join public.profiles p on p.id = t.poster_id
   where t.status = 'OPEN'
     and (p_kind is null or t.kind = p_kind)
     and not private.task_is_hidden(t.id)
     and (p.id is null or p.deleted_at is null)
     and (nullif(btrim(p_q), '') is null
          or strpos(lower(t.title), lower(btrim(p_q))) > 0
          or strpos(lower(coalesce(t.description, '')), lower(btrim(p_q))) > 0)
     and (p_pillar is null or t.pillar::text = p_pillar)
     and (p_min_minor is null or t.benchmark_minor >= p_min_minor)
     and (p_max_minor is null or t.benchmark_minor <= p_max_minor)
     and (p_flag is null or t.flag::text = p_flag)
     and (p_pinned is null or (t.loc_lat is not null) = p_pinned)
     and (p_poster is null or t.poster_id = p_poster)
     and (p_ids is null or t.id = any(p_ids))
     and (p_min_lat is null or t.loc_lat >= p_min_lat)
     and (p_max_lat is null or t.loc_lat <= p_max_lat)
     and (p_min_lng is null or t.loc_lng >= p_min_lng)
     and (p_max_lng is null or t.loc_lng <= p_max_lng)
   order by t.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 500)
$$;

-- public.guest_helpers_near: as last defined in 162, without the date cut-off.
create or replace function public.guest_helpers_near(
  p_limit   integer default 300,
  p_min_lat double precision default null,
  p_max_lat double precision default null,
  p_min_lng double precision default null,
  p_max_lng double precision default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.guest_person_json(p)
    from public.profiles p
   where p.onboarded_at is not null
     and p.deleted_at is null
     and p.loc_lat is not null
     and (p_min_lat is null or p.loc_lat >= p_min_lat)
     and (p_max_lat is null or p.loc_lat <= p_max_lat)
     and (p_min_lng is null or p.loc_lng >= p_min_lng)
     and (p_max_lng is null or p.loc_lng <= p_max_lng)
     and (p.skills <> '{}'
          or exists (select 1 from public.tasks t
                      where t.poster_id = p.id and t.kind = 'service' and t.status = 'OPEN'
                        and not private.task_is_hidden(t.id)))
   order by p.last_seen_at desc nulls last
   limit least(greatest(coalesce(p_limit, 300), 1), 300)
$$;

-- private.platform_highlights_live: as last defined in 166, without the date cut-off.
create or replace function private.platform_highlights_live()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'activeNow',      (select count(*) from public.profiles where last_seen_at > now() - interval '15 minutes'),
    'activeToday',    (select count(*) from public.profiles where last_seen_at > now() - interval '24 hours'),
    'openTasks',      (select count(*) from public.tasks t
                        where t.status = 'OPEN'
                          and t.kind = 'request'
                          and not exists (select 1 from public.task_moderation m where m.task_id = t.id)
                          and not exists (select 1 from public.profiles p
                                           where p.id = t.poster_id and p.deleted_at is not null)),
    'completedToday', (select count(*) from public.tasks
                        where status in ('COMPLETED', 'AUTO_COMPLETED')
                          and coalesce(completed_at, updated_at) > now() - interval '24 hours'),
    'liveWorkers',    (select count(*) from public.profiles where live_until > now())
  )
$$;

-- ---- a worker's own finish date on an offer -------------------------------------------------------

alter table public.bids add column if not exists proposed_due_at timestamptz;
comment on column public.bids.proposed_due_at is
  'The date the worker says they can finish by (plan 1.19 J). Becomes the task''s due_at when this offer is accepted.';

grant insert (proposed_due_at) on public.bids to authenticated;
grant update (proposed_due_at) on public.bids to authenticated;

-- From now on (5 minutes of clock difference allowed), within 3 years: the api's dueAtOrNull range.
create or replace function private.bid_due_in_range()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.proposed_due_at is not null
     and (tg_op = 'INSERT' or new.proposed_due_at is distinct from old.proposed_due_at)
     and (new.proposed_due_at < now() - interval '5 minutes'
          or new.proposed_due_at > now() + interval '3 years') then
    raise exception 'Pick a finish date from now on, within 3 years' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.bid_due_in_range() from public, anon, authenticated;

drop trigger if exists bids_due_in_range on public.bids;
create trigger bids_due_in_range
  before insert or update of proposed_due_at on public.bids
  for each row execute function private.bid_due_in_range();

-- Accepting an offer that names a date moves the task to that date. Fires inside lock_bid's (or
-- auto-accept's) own transaction, on bids.is_locked turning true; no money column is touched.
create or replace function private.bid_due_on_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks
     set due_at = new.proposed_due_at, due_lapsed_at = null
   where id = new.task_id
     and hunt_window is null
     and due_at is distinct from new.proposed_due_at;
  return new;
end;
$$;
revoke all on function private.bid_due_on_accept() from public, anon, authenticated;

drop trigger if exists bids_due_on_accept on public.bids;
create trigger bids_due_on_accept
  after update of is_locked on public.bids
  for each row
  when (new.is_locked and not coalesce(old.is_locked, false) and new.proposed_due_at is not null)
  execute function private.bid_due_on_accept();

-- 158's body, plus the worker's date in the "offered" notification when the offer has one.
create or replace function private.on_bid_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task public.tasks;
begin
  if coalesce(current_setting('taskdrop.hunt_accept', true), '') <> '' then return new; end if;
  select * into v_task from public.tasks where id = new.task_id;
  if found then
    perform private.notify(
      v_task.poster_id, 'quote',
      private.who(new.worker_id, 'A worker') || ' offered ' || private.rupees(new.price_minor),
      'To do ' || private.label(v_task.title) || '. '
        || case when new.proposed_due_at is not null
                then 'Can finish by '
                     || to_char(new.proposed_due_at at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM') || '. '
                else '' end
        || 'Open it to compare offers.',
      v_task.id);
  end if;
  return new;
exception when others then
  return new;
end;
$$;
