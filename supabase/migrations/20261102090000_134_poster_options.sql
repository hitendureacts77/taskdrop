-- 134: options a poster can switch on while posting (owner, 2026-11-01).
--
-- The post flow gained an Options step that suggests, per task, the extras that
-- would help it, and the poster switches on the ones they want:
--
--   Flash Drop       flash_until          first helper nearby to accept gets it, within 30 minutes
--   Live answer      live_answer          a quick paid question about a place, answered with a live photo
--   Crew             crew_id/size/slot    one job for several helpers: one task row per helper
--   Repeat           repeat_every         when the job is done, the next one is posted by itself
--   Regulars         preferred_worker_id  someone hired before gets the first 10 minutes to send an offer
--   Photos           want_photos          the helper sends before and after photos with the proof
--                    photos_public        ... and may show them on their profile
--
-- Plus, for helpers: a weekly goal on the profile and my_streaks() for the Earn side.
--
-- Additive only, like every migration before Phase 9: new nullable or defaulted
-- columns, a new table and new functions, so the old app keeps working. The
-- server decides: the poster's switches are only accepted in the shapes below,
-- and every time window is set here, from the database clock.

-- ---- columns ---------------------------------------------------------------

alter table public.tasks
  add column if not exists flash_until         timestamptz,
  add column if not exists live_answer         boolean not null default false,
  add column if not exists crew_id             uuid,
  add column if not exists crew_size           smallint,
  add column if not exists crew_slot           smallint,
  add column if not exists repeat_every        text,
  add column if not exists repeated_from       uuid references public.tasks (id) on delete set null,
  add column if not exists preferred_worker_id uuid references public.profiles (id) on delete set null,
  add column if not exists preferred_until     timestamptz,
  add column if not exists want_photos         boolean not null default false,
  add column if not exists photos_public       boolean not null default false;

alter table public.tasks drop constraint if exists tasks_repeat_every_valid;
alter table public.tasks
  add constraint tasks_repeat_every_valid check (repeat_every is null or repeat_every in ('week', 'month'));

alter table public.tasks drop constraint if exists tasks_crew_shape;
alter table public.tasks
  add constraint tasks_crew_shape check (
    (crew_id is null and crew_size is null and crew_slot is null)
    or (crew_id is not null and crew_size between 2 and 10 and crew_slot between 1 and crew_size)
  );

alter table public.tasks drop constraint if exists tasks_photos_public_needs_photos;
alter table public.tasks
  add constraint tasks_photos_public_needs_photos check (not photos_public or want_photos);

create index if not exists tasks_crew_idx on public.tasks (crew_id) where crew_id is not null;

comment on column public.tasks.flash_until is 'Flash Drop: until when the first helper nearby to accept gets the job. Set by the database (now + 30 min).';
comment on column public.tasks.live_answer is 'Live answer: a quick question about a place, answered with a live photo.';
comment on column public.tasks.crew_id is 'Crew: the shared id of the task rows that make up one job for several helpers.';
comment on column public.tasks.repeat_every is 'Repeat: week or month. When the job is done, the next one is posted by itself.';
comment on column public.tasks.repeated_from is 'The task this one was posted again from (Repeat). Set by the database only.';
comment on column public.tasks.preferred_worker_id is 'Regulars: someone hired before, offered the task first.';
comment on column public.tasks.preferred_until is 'Until when only preferred_worker_id may send an offer. Set by the database (now + 10 min).';
comment on column public.tasks.want_photos is 'The poster asked for before and after photos with the proof.';
comment on column public.tasks.photos_public is 'The poster lets the helper show those photos on their profile.';

-- A poster sets these when posting. Only Repeat can be switched off afterwards.
grant insert (flash_until, live_answer, crew_id, crew_size, crew_slot, repeat_every,
              preferred_worker_id, preferred_until, want_photos, photos_public)
  on public.tasks to authenticated;
grant update (repeat_every) on public.tasks to authenticated;

alter table public.profiles
  add column if not exists weekly_goal_minor integer;
alter table public.profiles drop constraint if exists profiles_weekly_goal_range;
alter table public.profiles
  add constraint profiles_weekly_goal_range check (weekly_goal_minor is null or weekly_goal_minor between 0 and 100000000);
comment on column public.profiles.weekly_goal_minor is 'A helper''s own weekly earnings goal, in paise. Shown on the Earn side only.';
grant update (weekly_goal_minor) on public.profiles to authenticated;

-- ---- the shapes the server accepts -----------------------------------------

create or replace function private.shape_poster_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Flash Drop rides on Auto-hire: the first offer at or under the price is
  -- accepted at once. The window is always 30 minutes from now.
  if new.flash_until is not null then
    if new.assignment_mode is distinct from 'auto' then
      raise exception 'Flash Drop hires the first helper who accepts, so it needs Auto-hire'
        using errcode = 'P0001';
    end if;
    new.flash_until := now() + interval '30 minutes';
    new.flag := 'urgent';
  end if;

  if new.live_answer then
    if new.crew_id is not null then
      raise exception 'A Live answer is for one person' using errcode = 'P0001';
    end if;
    new.pillar := 'local_intel';
  end if;

  if new.crew_id is not null and new.repeat_every is not null then
    raise exception 'A crew job cannot repeat yet. Post it again when you need it' using errcode = 'P0001';
  end if;

  -- Regulars: only someone this poster hired before, and the window is always
  -- 10 minutes from now.
  if new.preferred_worker_id is not null then
    if new.preferred_worker_id = new.poster_id then
      new.preferred_worker_id := null;
    elsif not exists (
      select 1 from public.assignments a
        join public.tasks t on t.id = a.task_id
       where t.poster_id = new.poster_id and a.worker_id = new.preferred_worker_id
    ) then
      raise exception 'You can offer a task first only to someone you hired before' using errcode = 'P0001';
    end if;
  end if;
  new.preferred_until := case when new.preferred_worker_id is null then null else now() + interval '10 minutes' end;

  if not new.want_photos then
    new.photos_public := false;
  end if;
  return new;
end;
$$;
revoke all on function private.shape_poster_options() from public, anon, authenticated;

drop trigger if exists tasks_shape_options on public.tasks;
create trigger tasks_shape_options
  before insert on public.tasks
  for each row execute function private.shape_poster_options();

-- ---- Regulars: the first 10 minutes belong to the person asked -------------

create or replace function private.bids_wait_for_regular()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pref  uuid;
  v_until timestamptz;
begin
  select preferred_worker_id, preferred_until into v_pref, v_until
    from public.tasks where id = new.task_id;
  if v_pref is not null and v_until > now() and v_pref is distinct from new.worker_id then
    raise exception 'The customer asked someone they hired before first. It opens to everyone in % min',
      greatest(1, ceil(extract(epoch from (v_until - now())) / 60)::int)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.bids_wait_for_regular() from public, anon, authenticated;

drop trigger if exists bids_wait_for_regular on public.bids;
create trigger bids_wait_for_regular
  before insert on public.bids
  for each row execute function private.bids_wait_for_regular();

-- ---- telling people: the regular asked first, and helpers near a Flash Drop -

create or replace function private.tell_about_poster_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_who text;
  v_helper record;
begin
  select coalesce(nullif(btrim(display_name), ''), 'A customer') into v_who
    from public.profiles where id = new.poster_id;

  if new.preferred_worker_id is not null then
    perform private.notify(new.preferred_worker_id, 'offered_first',
      v_who || ' asked you first',
      'You have 10 minutes to send an offer on "' || left(new.title, 60) || '" before anyone else can.',
      new.id);
  end if;

  -- Flash Drop: tell up to 30 helpers seen in the last day whose rounded area is
  -- within about 5 km. Rounded areas only (migration 074), never anyone's spot.
  if new.flash_until is not null and new.loc_lat is not null and new.loc_lng is not null then
    for v_helper in
      select p.id from public.profiles p
       where p.id <> new.poster_id
         and p.deleted_at is null
         and p.onboarded_at is not null
         and p.skills <> '{}'
         and p.loc_lat is not null and p.loc_lng is not null
         and p.last_seen_at > now() - interval '1 day'
         and abs(p.loc_lat - new.loc_lat) < 0.045
         and abs(p.loc_lng - new.loc_lng) < 0.05
       order by p.last_seen_at desc
       limit 30
    loop
      perform private.notify(v_helper.id, 'flash_drop',
        'Flash Drop near you: ₹' || (new.benchmark_minor / 100)::text,
        '"' || left(new.title, 60) || '". The first helper to accept in the next 30 minutes gets it.',
        new.id);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.tell_about_poster_options() from public, anon, authenticated;

drop trigger if exists tasks_tell_about_options on public.tasks;
create trigger tasks_tell_about_options
  after insert on public.tasks
  for each row
  when (new.preferred_worker_id is not null or new.flash_until is not null)
  execute function private.tell_about_poster_options();

-- ---- Repeat: when the job is done, post the next one ----------------------

create or replace function private.repeat_finished_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step   interval := case new.repeat_every when 'month' then interval '1 month' else interval '7 days' end;
  v_due    timestamptz := coalesce(new.due_at, now()) + v_step;
  v_worker uuid := private.task_worker(new.id);
  v_where  public.task_private;
  v_new    uuid;
begin
  while v_due < now() + interval '2 hours' loop
    v_due := v_due + v_step;
  end loop;
  select * into v_where from public.task_private where task_id = new.id;

  -- Finishing a job must never fail because its next copy could not be posted.
  begin
    insert into public.tasks (
      poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, flag,
      media_kind, media_path, media_seconds, loc_label, loc_lat, loc_lng, category, skills,
      difficulty, assignment_mode, due_at, milestones, kind, topup_pct, live_answer,
      repeat_every, repeated_from, preferred_worker_id, want_photos, photos_public
    ) values (
      new.poster_id, new.pillar, new.title, new.description, new.benchmark_minor, new.time_limit_minutes, 'none',
      new.media_kind, new.media_path, new.media_seconds, new.loc_label,
      coalesce(v_where.loc_lat, new.loc_lat), coalesce(v_where.loc_lng, new.loc_lng),
      new.category, new.skills, new.difficulty, 'bids', v_due, new.milestones, new.kind,
      new.topup_pct, new.live_answer, new.repeat_every, new.id, v_worker, new.want_photos, new.photos_public
    ) returning id into v_new;

    if v_where.address is not null then
      update public.task_private set address = v_where.address where task_id = v_new;
    end if;

    perform private.notify(new.poster_id, 'repeat_posted',
      'Posted again: "' || left(new.title, 60) || '"',
      'Your repeating task is up for ' || to_char(v_due at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM')
        || case when v_worker is null then '.' else '. The person who did it last gets the first 10 minutes.' end,
      v_new);
  exception when others then
    raise warning 'repeat_finished_task: could not post again for task %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.repeat_finished_task() from public, anon, authenticated;

drop trigger if exists tasks_repeat_when_done on public.tasks;
create trigger tasks_repeat_when_done
  after update of status on public.tasks
  for each row
  when (new.repeat_every is not null
        and new.status in ('COMPLETED', 'AUTO_COMPLETED')
        and old.status not in ('COMPLETED', 'AUTO_COMPLETED'))
  execute function private.repeat_finished_task();

-- ---- Crew: who belongs, the shared chat, and the slots ----------------------

create or replace function private.is_crew_member(p_crew uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_crew is not null and p_uid is not null and (
    exists (select 1 from public.tasks t where t.crew_id = p_crew and t.poster_id = p_uid)
    or exists (
      select 1 from public.tasks t
        join public.assignments a on a.task_id = t.id
       where t.crew_id = p_crew and a.worker_id = p_uid
         and a.status in ('assigned', 'started', 'released')
    )
  );
$$;
revoke all on function private.is_crew_member(uuid, uuid) from public, anon;
grant execute on function private.is_crew_member(uuid, uuid) to authenticated;

create table if not exists public.crew_messages (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid not null,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists crew_messages_crew_idx on public.crew_messages (crew_id, created_at);
alter table public.crew_messages enable row level security;

drop policy if exists crew_messages_members_read on public.crew_messages;
create policy crew_messages_members_read on public.crew_messages
  for select to authenticated
  using (private.is_crew_member(crew_id, (select auth.uid())) or private.is_admin());

drop policy if exists crew_messages_members_write on public.crew_messages;
create policy crew_messages_members_write on public.crew_messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and private.is_crew_member(crew_id, (select auth.uid())));

revoke all on public.crew_messages from anon, authenticated;
grant select on public.crew_messages to authenticated;
grant insert (crew_id, sender_id, body) on public.crew_messages to authenticated;

-- The slots of a crew job. Anyone may see how many are filled while a slot is
-- still open (a helper deciding whether to join); names only for the crew.
create or replace function public.crew_overview(p_crew uuid)
returns table (
  task_id uuid, slot smallint, size smallint, status public.task_status, title text,
  price_minor bigint, worker_id uuid, worker_name text, worker_avatar text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_member boolean;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  v_member := private.is_crew_member(p_crew, v_me) or private.is_admin();
  if not v_member and not exists (select 1 from public.tasks t where t.crew_id = p_crew and t.status = 'OPEN') then
    raise exception 'This crew is not available' using errcode = 'P0001';
  end if;
  return query
    select t.id, t.crew_slot, t.crew_size, t.status, t.title,
           coalesce(t.locked_minor, t.benchmark_minor)::bigint,
           case when v_member then a.worker_id end,
           case when v_member then p.display_name end,
           case when v_member then p.avatar_url end
      from public.tasks t
      left join public.assignments a on a.task_id = t.id and a.status in ('assigned', 'started', 'released')
      left join public.profiles p on p.id = a.worker_id
     where t.crew_id = p_crew
     order by t.crew_slot;
end;
$$;
revoke all on function public.crew_overview(uuid) from public, anon;
grant execute on function public.crew_overview(uuid) to authenticated;

-- ---- Photos: shown on the helper's profile when the poster allowed it -------

-- Same rules as migration 112, plus one: proof files of a finished job whose
-- poster allowed it may be seen by anyone signed in.
create or replace function private.can_read_task_media(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_name like 'media:%' then
      exists (
        select 1 from public.media m
         where 'media:' || m.id::text = p_name
           and (
             (m.owner = p_uid and m.status in ('pending', 'attached'))
             or (m.status <> 'deleted' and private.is_admin())
             or (
               m.status = 'attached'
               and (
                 exists (select 1 from public.profiles p where p.avatar_url = p_name)
                 or exists (
                   select 1 from public.tasks t
                    where t.media_path = p_name
                      and ( t.status = 'OPEN'
                            or t.poster_id = p_uid
                            or private.user_bid_on_task(t.id, p_uid)
                            or private.user_assigned_task(t.id, p_uid) )
                 )
                 or exists (
                   select 1 from public.task_proofs tp
                     join public.tasks t on t.id = tp.task_id
                    where tp.files @> jsonb_build_array(jsonb_build_object('path', p_name))
                      and ( tp.worker_id = p_uid or t.poster_id = p_uid
                            or (t.photos_public and t.status in ('COMPLETED', 'AUTO_COMPLETED')) )
                 )
                 or exists (
                   select 1 from public.messages ms
                    where left(ms.body, 60) = left('::media::' || p_name, 60)
                      and ms.body = '::media::' || p_name
                      and private.can_use_task_thread(ms.task_id, p_uid)
                 )
               )
             )
           )
      )
    else
      exists (select 1 from public.profiles p where p.avatar_url = p_name)
      or exists (
        select 1 from public.tasks t
         where t.media_path = p_name
           and ( t.status = 'OPEN'
                 or t.poster_id = p_uid
                 or private.is_admin()
                 or private.user_bid_on_task(t.id, p_uid)
                 or private.user_assigned_task(t.id, p_uid) )
      )
      or exists (
        select 1 from public.task_proofs tp
          join public.tasks t on t.id = tp.task_id
         where tp.files @> jsonb_build_array(jsonb_build_object('path', p_name))
           and ( tp.worker_id = p_uid or t.poster_id = p_uid or private.is_admin()
                 or (t.photos_public and t.status in ('COMPLETED', 'AUTO_COMPLETED')) )
      )
      or exists (
        select 1 from public.messages ms
         where left(ms.body, 60) = left('::media::' || p_name, 60)
           and ms.body = '::media::' || p_name
           and private.can_use_task_thread(ms.task_id, p_uid)
      )
  end;
$$;
revoke all on function private.can_read_task_media(text, uuid) from public, anon;
grant execute on function private.can_read_task_media(text, uuid) to authenticated;

-- A helper's shared before-and-after photos: the latest proof of each finished
-- job whose poster allowed it, newest first.
create or replace function public.worker_proof_photos(p_worker uuid)
returns table (task_id uuid, title text, category text, completed_at timestamptz, files jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select x.task_id, x.title, x.category, x.completed_at, x.files
    from (
      select distinct on (t.id) t.id as task_id, t.title, t.category, t.completed_at, tp.files
        from public.tasks t
        join public.task_proofs tp on tp.task_id = t.id and tp.worker_id = p_worker
       where t.photos_public
         and t.status in ('COMPLETED', 'AUTO_COMPLETED')
         and (select auth.uid()) is not null
       order by t.id, tp.created_at desc
    ) x
   order by x.completed_at desc nulls last
   limit 12;
$$;
revoke all on function public.worker_proof_photos(uuid) from public, anon;
grant execute on function public.worker_proof_photos(uuid) to authenticated;

-- ---- Streaks and badges (helpers) -----------------------------------------

create or replace function public.my_streaks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_week  timestamptz := date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_cut   numeric := private.setting_num('worker_commission_pct', 0.10);
  v_out   jsonb;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  with done as (
    select t.*, a.worker_id
      from public.assignments a
      join public.tasks t on t.id = a.task_id
     where a.worker_id = v_me and t.status in ('COMPLETED', 'AUTO_COMPLETED')
  ), ordered as (
    select (d.due_at is null or d.work_done_at is null or d.work_done_at <= d.due_at) as on_time,
           row_number() over (order by coalesce(d.work_done_at, d.completed_at) desc nulls last) as rn
      from done d
  )
  select jsonb_build_object(
    'weekStart', v_week,
    'weekEarnedMinor', coalesce((select sum(round(d.locked_minor * (1 - v_cut))) from done d where d.completed_at >= v_week), 0),
    'weekJobs', (select count(*) from done d where d.completed_at >= v_week),
    'weeklyGoalMinor', (select p.weekly_goal_minor from public.profiles p where p.id = v_me),
    'onTimeStreak', coalesce((select min(o.rn) - 1 from ordered o where not o.on_time), (select count(*) from ordered)),
    'jobsDone', (select count(*) from done),
    'earlyStarts', (select count(*) from done d
                     where d.started_at is not null
                       and (d.started_at at time zone 'Asia/Kolkata')::time < time '08:00'),
    'fiveStars', (select count(*) from public.reviews r
                   where r.subject_id = v_me and r.about_role = 'worker' and r.rating = 5),
    'crewJobs', (select count(*) from done d where d.crew_id is not null),
    'liveAnswers', (select count(*) from done d where d.live_answer),
    'photoJobs', (select count(*) from done d where d.want_photos)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.my_streaks() from public, anon;
grant execute on function public.my_streaks() to authenticated;
