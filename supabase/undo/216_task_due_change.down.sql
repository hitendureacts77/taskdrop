-- Undo for 20261126160000_216_task_due_change.sql (plan 1.19 J and K).
-- Revert the PR first (the app stops calling setTaskDue and sending proposedDueAt), then run this. Puts
-- run_task_reminders back as migration 128 left it (no date_passed nudge), removes set_task_due, hides
-- passed-date open tasks again in the seven reads, restores 158's offer notification and removes the
-- offer finish date (its triggers, then the column). Notifications already sent stay.

drop function if exists public.set_task_due(uuid, timestamptz);

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
begin
  perform private.assert_service_caller();

  -- One run at a time; a second caller simply does nothing.
  if not pg_try_advisory_xact_lock(hashtextextended('run_task_reminders', 0)) then
    return jsonb_build_object('review_reminders', 0, 'due_reminders', 0, 'skipped', true);
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

  return jsonb_build_object('review_reminders', v_review, 'due_reminders', v_due);
end;
$$;

-- ---- passed-date open tasks hidden again (the reads as 146, 151, 162, 166 left them) ----

-- public.guest_open_posts: as last defined in 146.
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
     and (t.due_at is null or t.due_at > now())
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

-- public.guest_helpers: as last defined in 146.
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
                        and (t.due_at is null or t.due_at > now())
                        and not private.task_is_hidden(t.id)))
   order by p.last_seen_at desc nulls last
   limit least(greatest(coalesce(p_limit, 300), 1), 300)
$$;

-- public.guest_task_questions: as last defined in 151.
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
                     and (t.due_at is null or t.due_at > now())
                     and p.deleted_at is null
                     and not private.task_is_hidden(t.id))
  ), '[]'::jsonb)
$$;

-- public.guest_public_media: as last defined in 151.
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
                    and (t.due_at is null or t.due_at > now())
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

-- public.guest_open_posts_near: as last defined in 162.
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
     and (t.due_at is null or t.due_at > now())
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

-- public.guest_helpers_near: as last defined in 162.
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
                        and (t.due_at is null or t.due_at > now())
                        and not private.task_is_hidden(t.id)))
   order by p.last_seen_at desc nulls last
   limit least(greatest(coalesce(p_limit, 300), 1), 300)
$$;

-- private.platform_highlights_live: as last defined in 166.
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
                          and (t.due_at is null or t.due_at > now())
                          and not exists (select 1 from public.task_moderation m where m.task_id = t.id)
                          and not exists (select 1 from public.profiles p
                                           where p.id = t.poster_id and p.deleted_at is not null)),
    'completedToday', (select count(*) from public.tasks
                        where status in ('COMPLETED', 'AUTO_COMPLETED')
                          and coalesce(completed_at, updated_at) > now() - interval '24 hours'),
    'liveWorkers',    (select count(*) from public.profiles where live_until > now())
  )
$$;

-- ---- the offer finish date ----

drop trigger if exists bids_due_on_accept on public.bids;
drop function if exists private.bid_due_on_accept();
drop trigger if exists bids_due_in_range on public.bids;
drop function if exists private.bid_due_in_range();

-- private.on_bid_inserted: as 158 left it.
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
      'To do ' || private.label(v_task.title) || '. Open it to compare offers.',
      v_task.id);
  end if;
  return new;
exception when others then
  return new;
end;
$$;

alter table public.bids drop column if exists proposed_due_at;
-- Put the old date back first, so undone posts read as they did before.
update public.tasks set due_at = due_lapsed_at
 where status = 'OPEN' and due_at is null and due_lapsed_at is not null;
alter table public.tasks drop column if exists due_lapsed_at;
