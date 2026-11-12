-- 167: hiring checks the price the poster saw, and blocks and suspensions stop hiring.
--
-- B53 (High) lock_bid read the offer's price at the moment of the call. A worker may edit
--     the price of an open offer (161, bids_edit_while_open), so a raise sent just before
--     the poster tapped Hire charged the poster's wallet the new price. lock_bid now takes
--     the price the poster saw (p_expected_price_minor) and refuses when the offer no longer
--     says that, and it locks the offer row while it reads it.
-- B61 (Medium) A block or a suspension did not stop hiring:
--     * lock_bid and auto-hire (private.auto_accept_bid) now refuse a worker the poster has
--       blocked, or who blocked the poster, and a worker who is suspended;
--     * block_user removes the offers (not yet chosen) between the two people on open tasks;
--     * crm_suspend_user removes the suspended person's offers (not yet chosen) on open tasks;
--     * task_contact_phone gives no number between two people who blocked each other.
--
-- Only adds. Every function keeps its signature, grants and refusals (scripts/check-lost-refusals.mjs).
--
-- lock_bid: the old two-argument function stays callable exactly as before (old app builds
-- and the api send p_bid_id and p_payout_mode). A new three-argument function, with no
-- defaults so a one- or two-argument call can never be ambiguous, does the work; the old
-- one calls it with no expected price. Offers already chosen and offers with a job history
-- (an assignment row) are never deleted.

-- ---- 1. lock_bid ----------------------------------------------------------------------
-- The old shape: unchanged for its callers, now hands over to the checked version below.
create or replace function public.lock_bid(p_bid_id uuid, p_payout_mode payout_mode default 'one_time'::payout_mode)
returns public.tasks
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return public.lock_bid(p_bid_id, p_payout_mode, null::bigint);
end $function$;

-- From 148, with: the offer row locked and read again after the task lock, the price the
-- poster saw checked, and blocked or suspended workers refused.
create or replace function public.lock_bid(p_bid_id uuid, p_payout_mode payout_mode, p_expected_price_minor bigint)
returns public.tasks
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bid    public.bids;
  v_task   public.tasks;
  v_fee    numeric;
  v_escrow bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Quote not found'; end if;

  select * into v_task from public.tasks where id = v_bid.task_id for update;
  if v_task.poster_id <> auth.uid() then raise exception 'Only the poster can lock a quote'; end if;
  if v_task.status <> 'OPEN' then raise exception 'This task is no longer open'; end if;

  -- B53: hold the offer still and read its price again, so an edit cannot slip in between.
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'Quote not found'; end if;

  if v_bid.price_minor is null or v_bid.price_minor <= 0 then
    raise exception 'That quote has no valid price';
  end if;
  if p_expected_price_minor is not null and v_bid.price_minor <> p_expected_price_minor then
    raise exception 'The offer changed. Please review the new price.';
  end if;

  -- B61: no hiring across a block, and no hiring a suspended person.
  if private.blocked_between(v_task.poster_id, v_bid.worker_id) then
    raise exception 'You cannot hire this person.';
  end if;
  if exists (select 1 from public.user_suspensions s
              where s.user_id = v_bid.worker_id and s.lifted_at is null) then
    raise exception 'This worker cannot be hired right now.';
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(v_bid.price_minor * (1 + v_fee));
  if v_escrow <= 0 then raise exception 'That quote has no valid price'; end if;

  -- W3 (debug round 1): a re-hired worker's row becomes the newest again (created_at = now()), so
  -- every "order by created_at desc" lookup of the task's worker finds them and not someone who
  -- walked off in between, and their chat view starts again from now (176).
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, payout_mode)
  values (v_task.id, v_bid.id, v_bid.worker_id, v_escrow, p_payout_mode)
  on conflict (task_id, worker_id) do update
    set escrow_minor = excluded.escrow_minor, status = 'assigned', created_at = now();

  update public.bids set is_locked = true where id = v_bid.id;

  update public.tasks
     set status = 'LOCKED',
         locked_bid_id = v_bid.id,
         locked_minor = v_bid.price_minor,
         payout_mode = p_payout_mode
   where id = v_task.id;

  return private.fund_task_from_wallet(v_task.id);
end $function$;

revoke all on function public.lock_bid(uuid, payout_mode, bigint) from public, anon;
grant execute on function public.lock_bid(uuid, payout_mode, bigint) to authenticated, service_role;
-- The old shape keeps its grants (create or replace); restated so a fresh database matches.
revoke all on function public.lock_bid(uuid, payout_mode) from public, anon;
grant execute on function public.lock_bid(uuid, payout_mode) to authenticated, service_role;

-- ---- 2. auto-hire -----------------------------------------------------------------------
-- From 148, with: no auto-hire across a block or of a suspended worker.
create or replace function private.auto_accept_bid()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task   public.tasks;
  v_fee    numeric;
  v_escrow bigint;
  v_mode   public.payout_mode;
begin
  select * into v_task from public.tasks where id = new.task_id for update;
  if not found
     or v_task.assignment_mode <> 'auto'
     or v_task.status <> 'OPEN'
     or new.price_minor is null
     or new.price_minor <= 0
     or new.price_minor > v_task.benchmark_minor
     or private.blocked_between(v_task.poster_id, new.worker_id)
     or exists (select 1 from public.user_suspensions s
                 where s.user_id = new.worker_id and s.lifted_at is null) then
    return new;
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(new.price_minor * (1 + v_fee));
  v_mode := coalesce(v_task.payout_mode, 'one_time');

  if v_escrow <= 0
     or (v_task.funded_at is not null and private.task_paid_in_minor(v_task.id) < v_escrow) then
    return new;
  end if;

  -- W3: a re-hire becomes the newest assignment again, as in lock_bid.
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, payout_mode)
  values (v_task.id, new.id, new.worker_id, v_escrow, v_mode)
  on conflict (task_id, worker_id) do update
    set escrow_minor = excluded.escrow_minor, status = 'assigned', created_at = now();

  update public.bids set is_locked = true where id = new.id;

  update public.tasks
     set status = 'LOCKED',
         locked_bid_id = new.id,
         locked_minor = new.price_minor,
         payout_mode = v_mode
   where id = v_task.id;

  begin
    perform private.fund_task_from_wallet(v_task.id);
    perform private.notify(v_task.poster_id, 'auto_locked', 'Offer accepted automatically',
      private.who(new.worker_id, 'The worker') || ' will do ' || private.label(v_task.title)
        || '. Paid from your wallet, so they can start.', v_task.id);
  exception when others then
    perform private.notify(v_task.poster_id, 'auto_locked', 'Offer accepted: payment needed',
      private.who(new.worker_id, 'The worker') || ' is ready to do ' || private.label(v_task.title)
        || '. Add money to your wallet so they can start.', v_task.id);
  end;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.auto_accept_bid() from public, anon, authenticated;

-- ---- 3. block_user ----------------------------------------------------------------------
-- From 093, with: offers between the two people on open tasks, not yet chosen, are removed.
-- Offers with a job history (an assignment row, e.g. a helper who backed out) are kept.
create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_user = auth.uid() then raise exception 'You cannot block yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'That person no longer exists'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), p_user) on conflict do nothing;

  delete from public.bids b
   using public.tasks t
   where t.id = b.task_id
     and t.status = 'OPEN'
     and not coalesce(b.is_locked, false)
     and ((t.poster_id = auth.uid() and b.worker_id = p_user)
       or (t.poster_id = p_user and b.worker_id = auth.uid()))
     and not exists (select 1 from public.assignments a where a.bid_id = b.id);
end;
$fn$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- ---- 4. crm_suspend_user ----------------------------------------------------------------
-- The live definition (071 plus the staff guard 124 put in), with: the suspended person's
-- offers on open tasks, not yet chosen, are removed.
create or replace function public.crm_suspend_user(p_user uuid, p_reason text)
returns public.user_suspensions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_row public.user_suspensions;
begin
  perform private.require_people_staff();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say why, so the next admin knows'; end if;
  if p_user = auth.uid() then raise exception 'You cannot suspend yourself'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user and role = 'admin') then
    raise exception 'An admin cannot be suspended from here';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'That person no longer exists'; end if;
  if exists (select 1 from public.user_suspensions where user_id = p_user and lifted_at is null) then
    raise exception 'That person is already suspended';
  end if;

  insert into public.user_suspensions (user_id, reason, suspended_by)
  values (p_user, left(btrim(p_reason), 500), auth.uid())
  returning * into v_row;

  -- No sign-in, no refresh, no more pushes. A short-lived access token already
  -- issued can still work until it expires (up to an hour).
  update auth.users set banned_until = now() + interval '100 years' where id = p_user;
  delete from auth.sessions where user_id = p_user;
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from public.push_tokens where user_id = p_user;

  -- Their offers on open tasks can no longer be chosen (B61).
  delete from public.bids b
   using public.tasks t
   where t.id = b.task_id
     and t.status = 'OPEN'
     and b.worker_id = p_user
     and not coalesce(b.is_locked, false)
     and not exists (select 1 from public.assignments a where a.bid_id = b.id);
  return v_row;
end;
$fn$;

-- ---- 5. task_contact_phone --------------------------------------------------------------
-- From 058, with: no number between two people where either blocked the other.
create or replace function public.task_contact_phone(p_task_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me    uuid := auth.uid();
  v_task  public.tasks;
  v_other uuid;
  v_email text;
begin
  if v_me is null then
    raise exception 'Sign in first';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;

  if v_task.status not in ('TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED',
                           'COMPLETED', 'AUTO_COMPLETED', 'DISPUTED') then
    raise exception 'Contact details unlock when the work starts';
  end if;

  if v_task.poster_id = v_me then
    select a.worker_id into v_other
      from public.assignments a
     where a.task_id = p_task_id
       and a.status in ('assigned', 'started', 'released')
     order by a.created_at desc
     limit 1;
  elsif exists (
    select 1 from public.assignments a
     where a.task_id = p_task_id
       and a.worker_id = v_me
       and a.status in ('assigned', 'started', 'released')
  ) then
    v_other := v_task.poster_id;
  else
    raise exception 'This is not your task';
  end if;

  if v_other is null then
    return null;
  end if;

  -- A block stops contact (B61).
  if private.blocked_between(v_me, v_other) then
    return null;
  end if;

  select u.email into v_email from auth.users u where u.id = v_other;
  if v_email ~ '^p[0-9]{10}@phone\.taskdrop\.app$' then
    return '+91' || substring(v_email from '^p([0-9]{10})@');
  end if;
  return null;
end;
$function$;
revoke all on function public.task_contact_phone(uuid) from public, anon;
grant execute on function public.task_contact_phone(uuid) to authenticated;
