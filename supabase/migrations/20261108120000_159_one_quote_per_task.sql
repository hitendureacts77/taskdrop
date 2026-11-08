-- 159: one offer per worker per task, and an offer is never taken back (2026-11-08).
--
-- A worker may send one offer for a task. They can change the price, message and time while the
-- task is still open, but they cannot send a second one and they cannot delete the first.
--
-- 1. The rule "one offer per worker per task" has always been a unique constraint on
--    (task_id, worker_id) (migration 001). It is checked here and put back, with the extra rows
--    cleaned up first, if some database ever lost it. On a normal database this step does nothing.
-- 2. Row level security still let a worker delete their own unlocked offer straight through the
--    data API and then send a new one. bids_keep_sent refuses that for app users. TaskDrop's own
--    functions (account deletion, cleanup) and a deleted task's cascade still remove offers.
-- 3. Row level security let a worker edit an unlocked offer even after the task was closed or
--    cancelled. bids_edit_while_open refuses an edit unless the task is still open.
-- 4. Hire side: a poster could only give a task a first look to someone they had hired before.
--    A worker who has an open service listing can now be given the first 10 minutes too, so the
--    "Send <name> a task" button on a listing works. The same block rule applies. Every other
--    line of the function is migration 135, unchanged.
--
-- Only adds: two functions, two triggers, one replaced function body. The offers table, its
-- policies and its grants are not touched.

-- ---- 1. the one-offer guard exists --------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'public.bids'::regclass and i.indisunique and i.indpred is null and i.indnatts = 2
       and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = any (i.indkey)) = array['task_id', 'worker_id']
  ) then
    -- Keep one offer per worker and task: the chosen one first, then the newest. Never remove an
    -- offer that a job or a task points at.
    delete from public.bids b using (
      select x.id, row_number() over (partition by x.task_id, x.worker_id
               order by x.is_locked desc, x.created_at desc) rn from public.bids x) d
     where b.id = d.id and d.rn > 1 and not b.is_locked
       and not exists (select 1 from public.assignments a where a.bid_id = b.id)
       and not exists (select 1 from public.tasks t where t.locked_bid_id = b.id);
    create unique index bids_one_per_worker_task on public.bids (task_id, worker_id);
  end if;
end $$;

-- ---- 2. an offer cannot be taken back ---------------------------------------------------------

-- Runs as the caller (no security definer): only direct deletes by app users are refused. Our own
-- functions run as the owner, and a cascade from a deleted task or account runs one level deeper.
create or replace function private.bids_keep_sent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and pg_trigger_depth() = 1 then
    raise exception 'An offer cannot be taken back. You can change it until the customer picks someone.'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all on function private.bids_keep_sent() from public, anon, authenticated;
comment on function private.bids_keep_sent() is
  'Refuses a direct delete of an offer by an app user. Owner functions and cascades still work.';

drop trigger if exists bids_keep_sent on public.bids;
create trigger bids_keep_sent
  before delete on public.bids
  for each row execute function private.bids_keep_sent();

-- ---- 3. an offer is editable only while the task is open --------------------------------------

create or replace function private.bids_edit_while_open()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  select t.status::text into v_status from public.tasks t where t.id = new.task_id;
  if v_status is distinct from 'OPEN' then
    raise exception 'This task is no longer taking offers, so your offer cannot be changed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.bids_edit_while_open() from public, anon, authenticated;
comment on function private.bids_edit_while_open() is
  'Refuses an edit of an offer by an app user once the task is no longer open. Owner functions (lock_bid and the like) are not affected.';

drop trigger if exists bids_edit_while_open on public.bids;
create trigger bids_edit_while_open
  before update on public.bids
  for each row execute function private.bids_edit_while_open();

-- ---- 4. first look for a worker with an open service listing ------------------------------------

-- Migration 135's body, with one change: the "hired before" check also accepts a worker who has an
-- open service listing (and is not blocked either way with the poster).
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

  if new.preferred_worker_id is not null then
    if new.preferred_worker_id = new.poster_id then
      new.preferred_worker_id := null;
    elsif not exists (
      select 1 from public.assignments a
        join public.tasks t on t.id = a.task_id
       where t.poster_id = new.poster_id and a.worker_id = new.preferred_worker_id
    ) and not (
      exists (select 1 from public.tasks s
               where s.poster_id = new.preferred_worker_id and s.kind = 'service' and s.status = 'OPEN')
      and not private.blocked_between(new.poster_id, new.preferred_worker_id)
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
comment on function private.shape_poster_options() is
  'Poster options: crew ownership, Flash Drop, Live answer, first look for someone hired before or with an open service listing, photo sharing. Runs before a task is inserted.';
