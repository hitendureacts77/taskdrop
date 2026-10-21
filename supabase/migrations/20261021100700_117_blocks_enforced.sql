-- 117 — a block now stops contact (Phase 7).
--
-- Migration 093 added blocks and block_user(), but nothing read them: a
-- blocked person could still bid on the blocker's task, message them and see
-- their open tasks. Now, for a pair where either has blocked the other:
--   * an offer on the other's task is refused,
--   * a chat message to the other is refused,
--   * the other's OPEN tasks stay out of the feed and out of search.
-- Tasks already underway are not hidden and money is not touched: a block
-- stops new contact, it does not strand a job in progress. Admins still see
-- everything.
--
-- Only adds: a function, two triggers and a restrictive policy. Nothing is
-- dropped or renamed, and a person with no blocks sees no change.

create or replace function private.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b)
        or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;
revoke all on function private.blocked_between(uuid, uuid) from public;
grant execute on function private.blocked_between(uuid, uuid) to anon, authenticated;

-- ---- offers -------------------------------------------------------------
create or replace function private.refuse_bid_when_blocked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poster uuid;
begin
  select poster_id into v_poster from public.tasks where id = new.task_id;
  if private.blocked_between(new.worker_id, v_poster) then
    raise exception 'You cannot send an offer on this task.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_bid_when_blocked() from public, anon, authenticated;

drop trigger if exists trg_bids_refuse_blocked on public.bids;
create trigger trg_bids_refuse_blocked
  before insert on public.bids
  for each row execute function private.refuse_bid_when_blocked();

-- ---- chat ---------------------------------------------------------------
create or replace function private.refuse_message_when_blocked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poster uuid;
  v_worker uuid;
  v_other  uuid;
begin
  select poster_id into v_poster from public.tasks where id = new.task_id;
  select a.worker_id into v_worker from public.assignments a
   where a.task_id = new.task_id and a.status in ('assigned', 'started', 'released')
   order by a.created_at desc limit 1;
  v_other := case when new.sender_id = v_poster then v_worker else v_poster end;
  if private.blocked_between(new.sender_id, v_other) then
    raise exception 'You cannot message this person.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_message_when_blocked() from public, anon, authenticated;

drop trigger if exists trg_messages_refuse_blocked on public.messages;
create trigger trg_messages_refuse_blocked
  before insert on public.messages
  for each row execute function private.refuse_message_when_blocked();

-- ---- the feed and search --------------------------------------------------
-- Restrictive, like tasks_hide_moderated: ANDed with the existing visibility
-- policy, never widening it. Only OPEN tasks are hidden.
drop policy if exists tasks_hide_blocked on public.tasks;
create policy tasks_hide_blocked on public.tasks
  as restrictive for select
  using (
    status <> 'OPEN'
    or poster_id = (select auth.uid())
    or not private.blocked_between((select auth.uid()), poster_id)
    or private.is_admin()
  );
