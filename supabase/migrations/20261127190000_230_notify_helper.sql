-- 230: "Offer to Ravi first and wait 10 minutes" becomes "also notify Ravi" (task 1.21 row C, owner 27 Nov 2026).
--
-- Before: a task posted with preferred_worker_id was closed to everyone else for 10 minutes
-- (tasks.preferred_until + the bids_wait_for_regular trigger). Now every task is open to everyone at once;
-- the chosen helper only gets one notification that links to the task. A poster can also notify one of
-- their regulars about a task that is already open (public.notify_helper_about_task, the My regulars
-- "Notify about a task" action). Nothing is reserved for anyone.
--
-- Abuse limits: only someone the poster hired before, or who has an open service listing (the old
-- offer-first rule); never a blocked or deleted person; one notification per helper per task
-- (public.task_helper_notices, primary key task + helper). Forward-only: columns stay, preferred_until is
-- never set again, and tasks inside a window when this ships open to everyone now.

-- ---- 1. one row per helper told about a task ----------------------------------------------------

create table if not exists public.task_helper_notices (
  task_id    uuid not null references public.tasks (id) on delete cascade,
  worker_id  uuid not null references public.profiles (id) on delete cascade,
  poster_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, worker_id)
);
alter table public.task_helper_notices enable row level security;
-- Server only: written by the functions below, read by nobody through the API.
revoke all on public.task_helper_notices from public, anon, authenticated;
create index if not exists task_helper_notices_poster_idx on public.task_helper_notices (poster_id, created_at desc);
comment on table public.task_helper_notices is
  'Helpers a poster notified about a task ("Also notify Ravi", migration 230). One row per helper per task, so nobody is told twice.';

-- ---- 2. who a poster may notify -----------------------------------------------------------------

create or replace function private.can_notify_helper(p_poster uuid, p_worker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_poster is not null and p_worker is not null and p_worker <> p_poster
     and exists (select 1 from public.profiles p where p.id = p_worker and p.deleted_at is null)
     and not private.blocked_between(p_poster, p_worker)
     and (
       exists (select 1 from public.assignments a
                 join public.tasks t on t.id = a.task_id
                where t.poster_id = p_poster and a.worker_id = p_worker)
       or exists (select 1 from public.tasks s
                   where s.poster_id = p_worker and s.kind = 'service' and s.status = 'OPEN')
     );
$$;
revoke all on function private.can_notify_helper(uuid, uuid) from public, anon, authenticated;

-- Sends the one notification (in-app; the notifications trigger sends the push through the outbox).
-- Returns false when this helper was already told about this task, or may not be told.
create or replace function private.notify_helper_once(p_task uuid, p_worker uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_who  text;
  v_rows int;
begin
  select * into v_task from public.tasks where id = p_task;
  if v_task.id is null or not private.can_notify_helper(v_task.poster_id, p_worker) then
    return false;
  end if;
  insert into public.task_helper_notices (task_id, worker_id, poster_id)
  values (p_task, p_worker, v_task.poster_id)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;
  select coalesce(nullif(btrim(display_name), ''), 'A customer') into v_who
    from public.profiles where id = v_task.poster_id;
  perform private.notify(p_worker, 'task_shared',
    v_who || ' shared a task with you',
    '"' || left(v_task.title, 60) || '". It is open to everyone. Send an offer if you can help.',
    p_task);
  return true;
end;
$$;
revoke all on function private.notify_helper_once(uuid, uuid) from public, anon, authenticated;

-- ---- 3. posting: no window any more, the chosen helper is only told ------------------------------

-- Migration 161's body, with two changes: preferred_until is never set, and a helper who may not be
-- notified (blocked, deleted, never hired) is dropped quietly so the task still posts.
create or replace function private.shape_poster_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.crew_id is not null and exists (
    select 1 from public.tasks t where t.crew_id = new.crew_id and t.poster_id <> new.poster_id
  ) then
    raise exception 'That crew belongs to someone else' using errcode = 'P0001';
  end if;

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

  if new.preferred_worker_id is not null and not private.can_notify_helper(new.poster_id, new.preferred_worker_id) then
    new.preferred_worker_id := null;
  end if;
  -- No hold for anyone: the task is open to everyone from the start.
  new.preferred_until := null;

  if not new.want_photos then
    new.photos_public := false;
  end if;
  return new;
end;
$$;
revoke all on function private.shape_poster_options() from public, anon, authenticated;
comment on function private.shape_poster_options() is
  'Poster options: crew ownership, Flash Drop, Live answer, the helper to notify (hired before or with an open service listing, never blocked or deleted; no hold), photo sharing. Runs before a task is inserted.';

-- Offers are no longer held back for anyone.
drop trigger if exists bids_wait_for_regular on public.bids;
create or replace function private.bids_wait_for_regular()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Kept as a no-op (migration 230): the 10-minute first look was removed.
  return new;
end;
$$;
revoke all on function private.bids_wait_for_regular() from public, anon, authenticated;

-- Migration 134's body, with the regular's message changed: "shared a task with you", sent once.
create or replace function private.tell_about_poster_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_helper record;
begin
  if new.preferred_worker_id is not null then
    perform private.notify_helper_once(new.id, new.preferred_worker_id);
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

-- Tasks inside a window when this ships open to everyone now.
update public.tasks set preferred_until = null where preferred_until > now();

comment on column public.tasks.preferred_worker_id is 'The helper the poster chose to notify when posting (migration 230). The task is open to everyone; this person only got a notification.';
comment on column public.tasks.preferred_until is 'Unused since migration 230 (no first look any more). Always null for new tasks.';

-- ---- 4. notify a regular about a task that is already open ---------------------------------------

create or replace function public.notify_helper_about_task(p_task uuid, p_worker uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'P0001';
  end if;
  select * into v_task from public.tasks where id = p_task;
  if v_task.id is null or v_task.poster_id is distinct from auth.uid() then
    raise exception 'That task is not yours' using errcode = 'P0001';
  end if;
  if v_task.kind is distinct from 'request' or v_task.status is distinct from 'OPEN' then
    raise exception 'You can share a task only while it is open' using errcode = 'P0001';
  end if;
  if not private.can_notify_helper(auth.uid(), p_worker) then
    raise exception 'You can notify only someone you hired before' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.task_helper_notices n where n.task_id = p_task and n.worker_id = p_worker) then
    return jsonb_build_object('sent', false, 'already', true);
  end if;
  return jsonb_build_object('sent', private.notify_helper_once(p_task, p_worker), 'already', false);
end;
$$;
revoke all on function public.notify_helper_about_task(uuid, uuid) from public, anon;
grant execute on function public.notify_helper_about_task(uuid, uuid) to authenticated;
comment on function public.notify_helper_about_task(uuid, uuid) is
  'My regulars: tell someone you hired before about one of your open tasks. One notification per helper per task; nothing is reserved.';
