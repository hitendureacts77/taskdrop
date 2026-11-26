-- Undo for 20261127100000_227_hire_checks_due.sql.
-- Revert the PR first (the app and the api stop sending expectedDueAt), then run this. Puts the
-- three-argument lock_bid back as 195 left it and removes the five-argument one. No data changes.

-- From 167, with one change at the end: under Plan B (or for a City Hunt accept) no wallet charge.
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

  -- 195: under Plan B a City Hunt find is paid as it is accepted, which needs the hold to be paid
  -- first. Until that flow is built, say so plainly instead of half-accepting.
  if private.plan_b_on() and coalesce(current_setting('taskdrop.hunt_accept', true), '') <> '' then
    raise exception 'City Hunt finds cannot be accepted while payments move to pay-per-task. Try again soon.';
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(v_bid.price_minor * (1 + v_fee));
  if v_escrow <= 0 then raise exception 'That quote has no valid price'; end if;

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

  -- 195: Plan B opens a hold and the poster pays for this task at the payment company next.
  if private.plan_b_on() then
    perform private.plan_b_open_hold(v_task.id);
    select * into v_task from public.tasks where id = v_task.id;
    return v_task;
  end if;

  return private.fund_task_from_wallet(v_task.id);
end $function$;

revoke all on function public.lock_bid(uuid, payout_mode, bigint) from public, anon;
grant execute on function public.lock_bid(uuid, payout_mode, bigint) to authenticated, service_role;

drop function if exists public.lock_bid(uuid, payout_mode, bigint, boolean, timestamptz);
