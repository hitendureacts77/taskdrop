-- 148: money and job-flow guards from security hunt 2.14, rounds D and E.
--
-- H51 (Critical) A quote with a negative price created money: the database took any
--     bids.price_minor, and accepting a minus-Rs-1,000 quote "took" a negative amount
--     from the poster's wallet. Quotes, task prices and time limits now have database
--     rules, and lock_bid, auto-hire and wallet funding refuse a price at or below zero.
-- H53 (Critical) A card-paid job stayed "paid" after the helper backed out, so the
--     poster could hire a far dearer quote with no new payment, and the new helper
--     was paid the new price. Funding now has to cover the chosen quote: a wallet-paid
--     job is charged the difference, a card-paid job refuses the dearer quote. Every
--     payout (approve, auto-approve, staff decision) is capped to what was paid in.
-- H54 (High) A helper who backed out could press Start and take the job from the new
--     helper. Start now needs the caller's hire to be the current one.
-- B20 (Medium) A poster could open a dispute on a job where no work was sent (even an
--     OPEN job) and so dodge the 5% fine. The poster can report a problem only once
--     the work is sent; before that they cancel.
--
-- Every function rewritten here keeps every refusal its previous version had
-- (scripts/check-lost-refusals.mjs). Grants are unchanged: create or replace keeps
-- them, and the two new private helpers are closed to app users.

-- ---- 1. database rules for prices and time limits ----------------------------------------------
-- Same upper bounds as the api (MONEY_MAX = 100_000_000_00 paise; time limit at most
-- 10,000,000 minutes). Added NOT VALID so an old row can never stop the migration;
-- every new or changed row is checked. Validated straight away where no old row breaks them.

alter table public.bids
  add constraint bids_price_minor_range
  check (price_minor > 0 and price_minor <= 10000000000) not valid;
alter table public.bids
  add constraint bids_time_limit_range
  check (time_limit_minutes > 0 and time_limit_minutes <= 10000000) not valid;

-- A service listing may say "from 0" while it is set up (the api allows it); a request may not.
alter table public.tasks
  add constraint tasks_benchmark_minor_range
  check (benchmark_minor >= 0 and benchmark_minor <= 10000000000
         and (benchmark_minor > 0 or kind = 'service')) not valid;
alter table public.tasks
  add constraint tasks_locked_minor_range
  check (locked_minor is null or (locked_minor > 0 and locked_minor <= 10000000000)) not valid;
alter table public.tasks
  add constraint tasks_time_limit_range
  check (time_limit_minutes > 0 and time_limit_minutes <= 10000000) not valid;
alter table public.assignments
  add constraint assignments_escrow_minor_positive
  check (escrow_minor is null or escrow_minor > 0) not valid;

do $$
begin
  if not exists (select 1 from public.bids where not (price_minor > 0 and price_minor <= 10000000000)) then
    alter table public.bids validate constraint bids_price_minor_range;
  end if;
  if not exists (select 1 from public.bids where not (time_limit_minutes > 0 and time_limit_minutes <= 10000000)) then
    alter table public.bids validate constraint bids_time_limit_range;
  end if;
  if not exists (select 1 from public.tasks
                  where not (benchmark_minor >= 0 and benchmark_minor <= 10000000000
                             and (benchmark_minor > 0 or kind = 'service'))) then
    alter table public.tasks validate constraint tasks_benchmark_minor_range;
  end if;
  if not exists (select 1 from public.tasks
                  where not (locked_minor is null or (locked_minor > 0 and locked_minor <= 10000000000))) then
    alter table public.tasks validate constraint tasks_locked_minor_range;
  end if;
  if not exists (select 1 from public.tasks where not (time_limit_minutes > 0 and time_limit_minutes <= 10000000)) then
    alter table public.tasks validate constraint tasks_time_limit_range;
  end if;
  if not exists (select 1 from public.assignments where not (escrow_minor is null or escrow_minor > 0)) then
    alter table public.assignments validate constraint assignments_escrow_minor_positive;
  end if;
end $$;

-- ---- 2. what was actually paid in for a job ----------------------------------------------------
-- Wallet: the amount taken from the wallet, unless it has gone back. Card: the payment,
-- less anything already refunded. Nothing when the job is not funded.
create or replace function private.task_paid_in_minor(p_task_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
             when t.funded_at is null then 0
             when t.funded_via = 'wallet' then
               case when t.wallet_refunded_at is null then coalesce(t.funded_minor, 0) else 0 end
             when t.funding_payment_id is not null then coalesce((
               select greatest(p.amount_minor - coalesce(p.refunded_minor, 0), 0)
                 from public.payments p where p.id = t.funding_payment_id), 0)
             else coalesce(t.funded_minor, 0)
           end
      from public.tasks t where t.id = p_task_id), 0)::bigint
$$;
revoke all on function private.task_paid_in_minor(uuid) from public, anon, authenticated;

-- The worker's pay for a job, never more than the money paid in covers. A job paid in
-- full (the normal case) pays exactly p_net, as before; a job paid in short pays the
-- same share of p_net as the share of the escrow that was paid.
create or replace function private.cap_worker_net(p_task_id uuid, p_net bigint, p_escrow bigint, p_locked bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_paid bigint := private.task_paid_in_minor(p_task_id);
  v_need bigint := coalesce(p_escrow,
                            round(coalesce(p_locked, 0) * (1 + private.setting_num('poster_service_fee_pct', 0.03))));
begin
  if coalesce(p_net, 0) <= 0 then
    return 0;
  end if;
  if v_need <= 0 or v_paid >= v_need then
    return p_net;
  end if;
  return greatest(floor(p_net::numeric * v_paid / v_need), 0)::bigint;
end;
$$;
revoke all on function private.cap_worker_net(uuid, bigint, bigint, bigint) from public, anon, authenticated;

-- ---- 3. paying for a job from the wallet -------------------------------------------------------
-- Was: a job already marked funded returned at once, whatever the chosen quote cost.
-- Now the money paid in must cover the chosen quote: a wallet-paid job is charged the
-- difference, a card-paid job refuses a quote dearer than what was paid.
create or replace function private.fund_task_from_wallet(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task    public.tasks;
  v_escrow  bigint;
  v_balance bigint;
  v_paid    bigint;
  v_charge  bigint;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'That task no longer exists'; end if;

  select a.escrow_minor into v_escrow from public.assignments a
   where a.task_id = p_task_id and a.status in ('assigned', 'started')
   order by (a.bid_id is not distinct from v_task.locked_bid_id) desc, a.created_at desc limit 1;

  if v_task.funded_at is not null then
    if v_escrow is null then return v_task; end if;
    v_paid := private.task_paid_in_minor(p_task_id);
    if v_paid >= v_escrow then return v_task; end if;
    if v_task.funded_via is distinct from 'wallet' or v_task.wallet_refunded_at is not null then
      raise exception 'That quote is higher than what you paid for this job. Choose a quote within what you paid, or cancel the job to get your money back and post it again.';
    end if;
    v_charge := v_escrow - v_paid;
  else
    if v_escrow is null then raise exception 'No offer has been chosen on this task yet'; end if;
    v_charge := v_escrow;
  end if;

  if v_escrow <= 0 or v_charge <= 0 then
    raise exception 'That quote has no valid price';
  end if;

  insert into public.wallets (user_id) values (v_task.poster_id) on conflict (user_id) do nothing;
  select balance_minor into v_balance
    from public.wallets where user_id = v_task.poster_id for update;

  if coalesce(v_balance, 0) < v_charge then
    raise exception 'Not enough money in your wallet'
      using detail = (v_charge - coalesce(v_balance, 0))::text,
            hint = 'Add money to your wallet, then try again.';
  end if;

  update public.wallets
     set balance_minor = balance_minor - v_charge, updated_at = now()
   where user_id = v_task.poster_id;

  update public.tasks
     set funded_at = coalesce(funded_at, now()),
         funded_via = 'wallet',
         funded_minor = v_escrow,
         funded_credits_minor = 0,
         wallet_refunded_at = null,
         updated_at = now()
   where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$fn$;
revoke all on function private.fund_task_from_wallet(uuid) from public, anon, authenticated;

-- ---- 4. choosing a quote ------------------------------------------------------------------------
create or replace function public.lock_bid(p_bid_id uuid, p_payout_mode payout_mode default 'one_time'::payout_mode)
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
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Quote not found'; end if;

  select * into v_task from public.tasks where id = v_bid.task_id for update;
  if v_task.poster_id <> auth.uid() then raise exception 'Only the poster can lock a quote'; end if;
  if v_task.status <> 'OPEN' then raise exception 'This task is no longer open'; end if;
  if v_bid.price_minor is null or v_bid.price_minor <= 0 then
    raise exception 'That quote has no valid price';
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(v_bid.price_minor * (1 + v_fee));
  if v_escrow <= 0 then raise exception 'That quote has no valid price'; end if;

  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, payout_mode)
  values (v_task.id, v_bid.id, v_bid.worker_id, v_escrow, p_payout_mode)
  on conflict (task_id, worker_id) do update set escrow_minor = excluded.escrow_minor, status = 'assigned';

  update public.bids set is_locked = true where id = v_bid.id;

  update public.tasks
     set status = 'LOCKED',
         locked_bid_id = v_bid.id,
         locked_minor = v_bid.price_minor,
         payout_mode = p_payout_mode
   where id = v_task.id;

  return private.fund_task_from_wallet(v_task.id);
end $function$;

-- Auto-hire skips a quote with no valid price, and a quote dearer than what a job that is
-- still marked paid (a card payment left after a helper backed out) already covers: the
-- poster chooses that one by hand.
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
     or new.price_minor > v_task.benchmark_minor then
    return new;
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(new.price_minor * (1 + v_fee));
  v_mode := coalesce(v_task.payout_mode, 'one_time');

  if v_escrow <= 0
     or (v_task.funded_at is not null and private.task_paid_in_minor(v_task.id) < v_escrow) then
    return new;
  end if;

  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, payout_mode)
  values (v_task.id, new.id, new.worker_id, v_escrow, v_mode)
  on conflict (task_id, worker_id) do update set escrow_minor = excluded.escrow_minor, status = 'assigned';

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

-- ---- 5. starting the job: only the helper hired now ---------------------------------------------
create or replace function public.start_task(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_task   public.tasks;
  v_assign public.assignments;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not exists (select 1 from public.assignments
                  where task_id = p_task_id and worker_id = auth.uid()) then
    raise exception 'You are not assigned to this task';
  end if;
  if v_task.status <> 'LOCKED' then raise exception 'This task cannot be started'; end if;

  -- No money, no work. The poster locked the quote but never paid.
  if v_task.funded_at is null then
    raise exception 'This task has not been paid for yet. Ask the poster to fund the escrow first.';
  end if;

  -- A helper who backed out keeps an old (refunded) row; only the current hire may start.
  select * into v_assign from public.assignments
   where task_id = p_task_id and worker_id = auth.uid()
     and status = 'assigned' and bid_id = v_task.locked_bid_id
   limit 1;
  if v_assign.id is null then
    raise exception 'You are no longer the chosen worker on this task';
  end if;

  -- The money paid in must cover the quote that was chosen.
  if private.task_paid_in_minor(p_task_id) < coalesce(v_assign.escrow_minor, 0) then
    raise exception 'This task has not been fully paid for yet. Ask the poster to fund the escrow first.';
  end if;

  update public.assignments set status = 'started'
   where task_id = p_task_id and worker_id = auth.uid();
  -- Everyone else loses the race; their hold is released.
  update public.assignments set status = 'refunded'
   where task_id = p_task_id and worker_id <> auth.uid();

  update public.tasks
     set status = 'TASK_STARTED', started_at = now()
   where id = p_task_id
  returning * into v_task;

  return v_task;
end $function$;

-- ---- 6. paying the helper: never more than was paid in ------------------------------------------
create or replace function public.confirm_release(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_task       public.tasks;
  v_worker     uuid;
  v_escrow     bigint;
  v_commission numeric;
  v_clear_days numeric;
  v_net        bigint;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.poster_id <> auth.uid() then raise exception 'Only the poster can release escrow'; end if;
  if v_task.status not in ('WORK_DONE','REVISION_REQUESTED') then
    raise exception 'The worker has not marked this done yet';
  end if;
  if v_task.funded_at is null then
    raise exception 'No escrow was ever paid for this task, so there is nothing to release';
  end if;

  select worker_id, escrow_minor into v_worker, v_escrow from public.assignments
   where task_id = p_task_id and status = 'started' limit 1;
  if v_worker is null then raise exception 'No active worker on this task'; end if;

  v_commission := private.setting_num('worker_commission_pct', 0.20);
  v_clear_days := private.setting_num('clearing_period_days', 7);
  v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));
  v_net := private.cap_worker_net(p_task_id, v_net, v_escrow, v_task.locked_minor);

  -- Earnings clear before they can be withdrawn.
  update public.wallets
     set clearing_minor = clearing_minor + v_net
   where user_id = v_worker;

  update public.assignments set status = 'released'
   where task_id = p_task_id and worker_id = v_worker;

  update public.tasks
     set status = 'COMPLETED',
         completed_at = now(),
         clear_at = now() + (v_clear_days || ' days')::interval
   where id = p_task_id
  returning * into v_task;

  return v_task;
end $function$;

-- Pay out work the poster never answered, once the review window has run.
create or replace function private.auto_complete_due()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task       record;
  v_worker     uuid;
  v_escrow     bigint;
  v_commission numeric := private.setting_num('worker_commission_pct', 0.20);
  v_clear_days numeric := private.setting_num('clearing_period_days', 7);
  v_net        bigint;
  v_count      integer := 0;
begin
  for v_task in
    select t.id, t.locked_minor
      from public.tasks t
     where t.status = 'WORK_DONE'
       and t.auto_complete_at is not null
       and t.auto_complete_at <= now()
       and t.funded_at is not null
     order by t.auto_complete_at
     for update skip locked
  loop
    v_worker := null;
    v_escrow := null;
    select a.worker_id, a.escrow_minor into v_worker, v_escrow from public.assignments a
     where a.task_id = v_task.id and a.status = 'started' limit 1;
    if v_worker is null then continue; end if;

    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));
    v_net := private.cap_worker_net(v_task.id, v_net, v_escrow, v_task.locked_minor);
    update public.wallets set clearing_minor = clearing_minor + v_net where user_id = v_worker;
    update public.assignments set status = 'released' where task_id = v_task.id and worker_id = v_worker;
    update public.tasks
       set status = 'AUTO_COMPLETED',
           completed_at = now(),
           clear_at = now() + (v_clear_days || ' days')::interval
     where id = v_task.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.auto_complete_due() from public, anon, authenticated;

create or replace function public.admin_resolve_dispute(p_task_id uuid, p_outcome text, p_note text default null::text)
 returns public.tasks
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_task       public.tasks;
  v_assign     public.assignments;
  v_net        bigint := 0;
  v_back       bigint := 0;
  v_clear_days numeric := private.setting_num('clearing_period_days', 0);
begin
  perform private.assert_not_money_blind();
  perform private.assert_money_staff();
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;
  if p_outcome not in ('worker', 'poster') then
    raise exception 'Resolve in favour of the worker or the poster';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'That task no longer exists';
  end if;
  if v_task.status <> 'DISPUTED' then
    raise exception 'That task is not disputed';
  end if;

  select * into v_assign from public.assignments a
   where a.task_id = p_task_id and a.status in ('started', 'assigned')
   order by (a.status = 'started') desc, a.created_at desc
   limit 1;

  if p_outcome = 'worker' then
    if v_task.funded_at is null then
      raise exception 'Nothing was paid for this job, so there is nothing to pay the worker';
    end if;
    if v_assign.id is null then
      raise exception 'No worker on this task to pay';
    end if;

    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - private.setting_num('worker_commission_pct', 0.20)));
    -- Never more than the money paid in for this job covers.
    v_net := private.cap_worker_net(p_task_id, v_net, v_assign.escrow_minor, v_task.locked_minor);
    insert into public.wallets (user_id) values (v_assign.worker_id) on conflict (user_id) do nothing;
    update public.assignments set status = 'released' where id = v_assign.id;

    if v_clear_days <= 0 then
      update public.wallets set balance_minor = balance_minor + v_net, updated_at = now()
       where user_id = v_assign.worker_id;
      update public.tasks
         set status = 'COMPLETED', completed_at = now(), clear_at = now(), cleared_at = now(), updated_at = now()
       where id = p_task_id
      returning * into v_task;
    else
      update public.wallets set clearing_minor = clearing_minor + v_net, updated_at = now()
       where user_id = v_assign.worker_id;
      update public.tasks
         set status = 'COMPLETED',
             completed_at = now(),
             clear_at = now() + make_interval(days => v_clear_days::int),
             updated_at = now()
       where id = p_task_id
      returning * into v_task;
    end if;
  else
    v_back := case
      when v_task.funded_via = 'wallet' and v_task.wallet_refunded_at is null then coalesce(v_task.funded_minor, 0)
      when v_task.funding_payment_id is not null then coalesce((
        select greatest(p.amount_minor - p.refunded_minor, 0) from public.payments p where p.id = v_task.funding_payment_id), 0)
      else 0
    end;

    update public.assignments set status = 'refunded'
     where task_id = p_task_id and status in ('assigned', 'started');

    update public.tasks
       set status = 'CANCELLED', completed_at = now(), updated_at = now()
     where id = p_task_id
    returning * into v_task;

    insert into public.cancellations_log (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
    values (p_task_id, 'poster', 'normal', 'DISPUTED', v_task.locked_minor, 0);
  end if;

  insert into public.dispute_decisions (task_id, decided_by, outcome, note, worker_paid_minor, poster_refunded_minor)
  values (p_task_id, auth.uid(), p_outcome, nullif(btrim(coalesce(p_note, '')), ''), v_net, v_back);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

-- ---- 7. reporting a problem: only once the work is sent -----------------------------------------
-- The poster reports a problem on work that was sent (WORK_DONE, REVISION_REQUESTED).
-- Before that they cancel (5% to the helper once the work has started). The helper may
-- still report a problem while the job is under way, as before.
create or replace function public.open_dispute(p_task_id uuid, p_reason text default null)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     uuid := auth.uid();
  v_task   public.tasks;
  v_worker uuid;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;

  select a.worker_id into v_worker
  from public.assignments a
  where a.task_id = p_task_id and a.status in ('started', 'released')
  order by a.created_at desc
  limit 1;

  if v_me <> v_task.poster_id and (v_worker is null or v_me <> v_worker) then
    raise exception 'You were not part of this task';
  end if;
  if v_task.status in ('COMPLETED', 'AUTO_COMPLETED', 'CANCELLED') then
    raise exception 'This task is already closed';
  end if;
  if v_task.status = 'DISPUTED' then
    raise exception 'A dispute is already open on this task';
  end if;
  -- An OVERDUE job stays open to the poster: the helper missed the deadline, so cancelling would cost the poster
  -- the 5% fine for the helper's lateness. Staff decide. (A job just started, with no proof yet, is the poster's to cancel.)
  if v_task.status not in ('WORK_DONE', 'REVISION_REQUESTED', 'OVERDUE')
     and (v_me = v_task.poster_id or v_task.status <> 'TASK_STARTED') then
    raise exception 'The work has not been sent yet, so there is nothing to report. To stop this job, cancel it instead.';
  end if;

  update public.tasks set status = 'DISPUTED' where id = p_task_id
  returning * into v_task;

  insert into public.task_disputes (task_id, opened_by, reason)
  values (p_task_id, v_me, coalesce(v_reason, 'No reason given'));

  return v_task;
end;
$function$;
