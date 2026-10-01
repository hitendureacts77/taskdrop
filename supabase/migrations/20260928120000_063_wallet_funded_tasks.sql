-- 063 — jobs are paid from the poster's wallet.
--
-- The money model, as the owner set it out:
--
--   * A poster can only lock a quote if their wallet covers it -- the price
--     plus the service fee. Locking takes that amount out of the withdrawable
--     balance in the same step; it is "locked in a task in progress".
--   * When the job is completed, the worker's share goes to the worker's
--     wallet straight away (no clearing wait), and TaskDrop's share -- the
--     commission and the service fee -- is booked to platform_ledger, which is
--     what the admin Earnings view reads.
--   * If the job is cancelled, never completed, or a dispute goes the poster's
--     way, everything the poster paid comes back to their wallet, service fee
--     included. The 5% fine a poster used to pay for cancelling after the
--     worker started is gone.
--
-- Real rupees sit in the Razorpay account throughout; these tables are the
-- record of whose they are.

alter table public.tasks
  add column if not exists funded_via text check (funded_via in ('payment', 'wallet')),
  add column if not exists funded_minor bigint,
  add column if not exists wallet_refunded_at timestamptz;

comment on column public.tasks.funded_via is
  'How the escrow was paid: ''wallet'' (taken from the poster''s balance at lock) or ''payment'' (an older per-task Razorpay payment).';
comment on column public.tasks.funded_minor is
  'What was taken from the poster''s wallet for this task -- the price plus the service fee. Returned in full if the task does not complete.';

update public.tasks set funded_via = 'payment' where funded_at is not null and funded_via is null;

-- ---------------------------------------------------------------- funding --

-- Take a locked task's escrow from its poster's wallet. No caller check: the
-- public wrappers below do that. Raises when the wallet is short, with the
-- shortfall in DETAIL so the app can offer exactly that top-up.
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
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'That task no longer exists'; end if;
  if v_task.funded_at is not null then return v_task; end if;

  select a.escrow_minor into v_escrow from public.assignments a
   where a.task_id = p_task_id and a.status in ('assigned', 'started')
   order by a.created_at desc limit 1;
  if v_escrow is null then raise exception 'No offer has been chosen on this task yet'; end if;

  insert into public.wallets (user_id) values (v_task.poster_id) on conflict (user_id) do nothing;
  select balance_minor into v_balance from public.wallets where user_id = v_task.poster_id for update;

  if coalesce(v_balance, 0) < v_escrow then
    raise exception 'Not enough money in your wallet'
      using detail = (v_escrow - coalesce(v_balance, 0))::text,
            hint = 'Add money to your wallet, then try again.';
  end if;

  update public.wallets
     set balance_minor = balance_minor - v_escrow, updated_at = now()
   where user_id = v_task.poster_id;

  update public.tasks
     set funded_at = now(),
         funded_via = 'wallet',
         funded_minor = v_escrow,
         wallet_refunded_at = null,
         updated_at = now()
   where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$fn$;
revoke all on function private.fund_task_from_wallet(uuid) from public, anon, authenticated;

-- The poster pays for a task that was locked without being paid for (an
-- auto-hire that found the wallet short, or a task from before this change).
create or replace function public.pay_task_from_wallet(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_poster uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select poster_id into v_poster from public.tasks where id = p_task_id;
  if v_poster is null then raise exception 'That task no longer exists'; end if;
  if v_poster <> auth.uid() then raise exception 'Only the poster pays for a task'; end if;
  return private.fund_task_from_wallet(p_task_id);
end;
$fn$;
revoke all on function public.pay_task_from_wallet(uuid) from public, anon;
grant execute on function public.pay_task_from_wallet(uuid) to authenticated;

-- Locking a quote now pays for it too, in one transaction: a wallet that is
-- short fails the whole thing, so nothing is ever locked without the money.
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

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(v_bid.price_minor * (1 + v_fee));

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

-- Auto-hire locks a quote the moment it arrives. It pays from the wallet when
-- the wallet covers it; otherwise the task waits, locked, for the poster to
-- top up and pay -- a short wallet must not turn away a good offer.
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
     or new.price_minor > v_task.benchmark_minor then
    return new;
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(new.price_minor * (1 + v_fee));
  v_mode := coalesce(v_task.payout_mode, 'one_time');

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
    perform private.notify(v_task.poster_id, 'auto_locked',
      'An offer was auto-accepted on "' || left(v_task.title, 60) || '"',
      'It was paid from your wallet. The worker can start.', v_task.id);
  exception when others then
    perform private.notify(v_task.poster_id, 'auto_locked',
      'An offer was auto-accepted on "' || left(v_task.title, 60) || '"',
      'Add money to your wallet to pay for it, so the worker can start.', v_task.id);
  end;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.auto_accept_bid() from public;

-- ---------------------------------------------------------------- refunds --

-- Every way a task stops short of completion writes a cancellations_log row:
-- the poster cancelling, the worker walking away, an admin cancelling, a
-- dispute decided for the poster. So the refund hangs off that one insert.
-- A wallet-funded task gets everything back into the wallet at once; an older
-- Razorpay-paid task keeps going through the Refunds screen as before.
create or replace function private.refund_wallet_on_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = new.task_id for update;
  if not found
     or v_task.funded_via is distinct from 'wallet'
     or v_task.funded_at is null
     or v_task.wallet_refunded_at is not null
     or coalesce(v_task.funded_minor, 0) <= 0 then
    return new;
  end if;

  update public.wallets
     set balance_minor = balance_minor + v_task.funded_minor, updated_at = now()
   where user_id = v_task.poster_id;

  if v_task.status = 'OPEN' then
    -- The worker walked away and the task went back to the market: it is
    -- unpaid again, and is paid afresh when the next offer is locked.
    update public.tasks
       set funded_at = null, funded_via = null, funded_minor = null, wallet_refunded_at = null
     where id = v_task.id;
  else
    update public.tasks set wallet_refunded_at = now() where id = v_task.id;
  end if;

  perform private.notify(v_task.poster_id, 'wallet_refund',
    'Money back in your wallet',
    'The ' || to_char(v_task.funded_minor / 100.0, 'FM999999990.00') || ' rupees locked for "' || left(v_task.title, 60) || '" is back in your wallet.',
    v_task.id);
  return new;
end;
$fn$;
revoke all on function private.refund_wallet_on_cancel() from public, anon, authenticated;

drop trigger if exists trg_refund_wallet_on_cancel on public.cancellations_log;
create trigger trg_refund_wallet_on_cancel
  after insert on public.cancellations_log
  for each row execute function private.refund_wallet_on_cancel();

-- No more fine for cancelling after the worker has started: a job that does
-- not complete gives the poster everything back. Otherwise unchanged.
create or replace function public.cancel_task(p_task_id uuid, p_reason text default null::text)
returns tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me        uuid := auth.uid();
  v_task      public.tasks;
  v_assign    public.assignments;
  v_is_poster boolean;
  v_phase     text;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;

  if v_task.status in ('COMPLETED', 'AUTO_COMPLETED', 'CANCELLED') then
    raise exception 'This task is already closed';
  end if;
  if v_task.status in ('WORK_DONE', 'REVISION_REQUESTED', 'DISPUTED') then
    raise exception 'The work is already submitted — open a dispute instead';
  end if;

  select * into v_assign
  from public.assignments
  where task_id = p_task_id and status in ('assigned', 'started')
  order by created_at desc
  limit 1;

  v_is_poster := (v_me = v_task.poster_id);
  if not v_is_poster and (v_assign.worker_id is null or v_assign.worker_id <> v_me) then
    raise exception 'You were not part of this task';
  end if;

  v_phase := v_task.status::text;

  if not v_is_poster then
    update public.assignments set status = 'refunded' where id = v_assign.id;
    update public.bids set is_locked = false where id = v_assign.bid_id;

    update public.tasks
       set status = 'OPEN',
           locked_bid_id = null,
           locked_minor = null,
           started_at = null
     where id = p_task_id
    returning * into v_task;

    insert into public.cancellations_log
      (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
    values (p_task_id, 'worker', 'normal', v_phase, v_assign.escrow_minor, 0);

    return v_task;
  end if;

  if v_assign.id is not null then
    update public.assignments set status = 'refunded' where id = v_assign.id;
    update public.bids set is_locked = false where id = v_assign.bid_id;
  end if;

  update public.tasks
     set status = 'CANCELLED',
         completed_at = now()
   where id = p_task_id
  returning * into v_task;

  insert into public.cancellations_log
    (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
  values (p_task_id, 'poster', 'normal', v_phase, v_task.locked_minor, 0);

  return v_task;
end;
$function$;

-- ------------------------------------------------------- worker is paid now --

-- Earnings are withdrawable as soon as the job completes. Every release path
-- reads this setting, and the sweep below moves them within minutes (the app
-- also sweeps the moment a worker opens their wallet).
update public.settings set value = to_jsonb(0) where key = 'clearing_period_days';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'settle-cleared-often') then
    perform cron.unschedule('settle-cleared-often');
  end if;
  perform cron.schedule('settle-cleared-often', '*/5 * * * *', 'select public.settle_cleared_earnings()');
end $$;

-- ------------------------------------------------------------- withdrawals --

-- A withdrawal has to name a saved bank account or UPI ID. The app already
-- asks for one; this makes it a rule rather than a courtesy.
create or replace function public.request_withdrawal(p_amount_minor bigint, p_destination text default null::text)
returns payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me      uuid := auth.uid();
  v_balance bigint;
  v_row     public.payouts;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter an amount to withdraw';
  end if;
  if not exists (select 1 from public.payout_destinations where user_id = v_me) then
    raise exception 'Add a bank account or UPI ID before withdrawing';
  end if;
  if nullif(btrim(coalesce(p_destination, '')), '') is null then
    raise exception 'Choose the bank account or UPI ID to send the money to';
  end if;

  select balance_minor into v_balance
  from public.wallets
  where user_id = v_me
  for update;

  if not found then
    raise exception 'No wallet found';
  end if;
  if v_balance < p_amount_minor then
    raise exception 'That is more than your available balance';
  end if;

  update public.wallets
     set balance_minor = balance_minor - p_amount_minor
   where user_id = v_me;

  insert into public.payouts (user_id, amount_minor, destination)
  values (v_me, p_amount_minor, btrim(p_destination))
  returning * into v_row;

  return v_row;
end;
$function$;
