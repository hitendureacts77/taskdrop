-- 064 — the wallet holds two different kinds of money, and only one of them
-- can go to a bank.
--
--   * credits_minor  -- money a poster added. Spendable on TaskDrop tasks only.
--                       Never withdrawable: a balance you can top up AND cash
--                       out is a wallet under RBI's PPI rules, which needs a
--                       licence. Credits that only buy tasks do not.
--   * balance_minor  -- earnings from completed work (and the part of a
--                       cancelled task that was paid out of earnings).
--                       Withdrawable, minimum set by 'min_withdraw_minor'.
--
-- Paying for a task spends credits first, then earnings. The task remembers
-- how much came from credits so a refund puts each rupee back where it came
-- from -- a cancelled task must never turn credits into withdrawable money.

alter table public.wallets
  add column if not exists credits_minor bigint not null default 0
    check (credits_minor >= 0);

comment on column public.wallets.credits_minor is
  'Money added by the user (top-ups). Spendable on tasks only; never withdrawable.';
comment on column public.wallets.balance_minor is
  'Earnings. Withdrawable to a bank account or UPI ID.';

alter table public.tasks
  add column if not exists funded_credits_minor bigint not null default 0;

comment on column public.tasks.funded_credits_minor is
  'The part of funded_minor that came from the poster''s credits. Refunded to credits; the rest goes back to earnings.';

-- Existing balances: whatever a user topped up is credits, the rest earnings.
-- No wallet-funded task exists yet, so paid top-ups are all still unspent.
with topped as (
  select user_id, sum(amount_minor) as minor
    from public.payments
   where purpose = 'topup' and status = 'paid'
   group by user_id
)
update public.wallets w
   set credits_minor = least(w.balance_minor, t.minor),
       balance_minor = w.balance_minor - least(w.balance_minor, t.minor),
       updated_at = now()
  from topped t
 where t.user_id = w.user_id and w.balance_minor > 0;

insert into public.settings (key, value)
values ('min_withdraw_minor', to_jsonb(10000))
on conflict (key) do nothing;

-- ---------------------------------------------------------------- funding --

create or replace function private.fund_task_from_wallet(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task    public.tasks;
  v_escrow  bigint;
  v_credits bigint;
  v_balance bigint;
  v_from_credits bigint;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'That task no longer exists'; end if;
  if v_task.funded_at is not null then return v_task; end if;

  select a.escrow_minor into v_escrow from public.assignments a
   where a.task_id = p_task_id and a.status in ('assigned', 'started')
   order by a.created_at desc limit 1;
  if v_escrow is null then raise exception 'No offer has been chosen on this task yet'; end if;

  insert into public.wallets (user_id) values (v_task.poster_id) on conflict (user_id) do nothing;
  select credits_minor, balance_minor into v_credits, v_balance
    from public.wallets where user_id = v_task.poster_id for update;

  if v_credits + v_balance < v_escrow then
    raise exception 'Not enough money in your wallet'
      using detail = (v_escrow - v_credits - v_balance)::text,
            hint = 'Add money to your wallet, then try again.';
  end if;

  v_from_credits := least(v_credits, v_escrow);

  update public.wallets
     set credits_minor = credits_minor - v_from_credits,
         balance_minor = balance_minor - (v_escrow - v_from_credits),
         updated_at = now()
   where user_id = v_task.poster_id;

  update public.tasks
     set funded_at = now(),
         funded_via = 'wallet',
         funded_minor = v_escrow,
         funded_credits_minor = v_from_credits,
         wallet_refunded_at = null,
         updated_at = now()
   where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$fn$;
revoke all on function private.fund_task_from_wallet(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- refunds --

create or replace function private.refund_wallet_on_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task    public.tasks;
  v_credits bigint;
begin
  select * into v_task from public.tasks where id = new.task_id for update;
  if not found
     or v_task.funded_via is distinct from 'wallet'
     or v_task.funded_at is null
     or v_task.wallet_refunded_at is not null
     or coalesce(v_task.funded_minor, 0) <= 0 then
    return new;
  end if;

  v_credits := least(coalesce(v_task.funded_credits_minor, 0), v_task.funded_minor);

  update public.wallets
     set credits_minor = credits_minor + v_credits,
         balance_minor = balance_minor + (v_task.funded_minor - v_credits),
         updated_at = now()
   where user_id = v_task.poster_id;

  if v_task.status = 'OPEN' then
    update public.tasks
       set funded_at = null, funded_via = null, funded_minor = null,
           funded_credits_minor = 0, wallet_refunded_at = null
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

-- ------------------------------------------------------------- withdrawals --

-- Only earnings (balance_minor) can be withdrawn -- that was already the
-- column this read; credits simply never land in it any more. Adds the
-- minimum withdrawal.
create or replace function public.request_withdrawal(p_amount_minor bigint, p_destination text default null::text)
returns payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me      uuid := auth.uid();
  v_balance bigint;
  v_min     bigint := private.setting_num('min_withdraw_minor', 10000)::bigint;
  v_row     public.payouts;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter an amount to withdraw';
  end if;
  if p_amount_minor < v_min then
    raise exception 'The minimum withdrawal is % rupees', (v_min / 100);
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
    raise exception 'That is more than your earnings available to withdraw';
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

-- Top-ups land in credits. Called by the Razorpay functions (service role)
-- once a top-up payment is settled; idempotent per payment.
create or replace function public.credit_topup(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_pay public.payments;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found or v_pay.purpose <> 'topup' or v_pay.status <> 'paid' then return; end if;
  if v_pay.credited_at is not null then return; end if;

  insert into public.wallets (user_id) values (v_pay.user_id) on conflict (user_id) do nothing;
  update public.wallets
     set credits_minor = credits_minor + v_pay.amount_minor, updated_at = now()
   where user_id = v_pay.user_id;
  update public.payments set credited_at = now() where id = p_payment_id;
end;
$fn$;

alter table public.payments add column if not exists credited_at timestamptz;
-- Everything settled before this change was already credited by the old code.
update public.payments set credited_at = coalesce(paid_at, now())
 where purpose = 'topup' and status = 'paid' and credited_at is null;

revoke all on function public.credit_topup(uuid) from public, anon, authenticated;
grant execute on function public.credit_topup(uuid) to service_role;
