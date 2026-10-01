-- 066 — one wallet, like Kardoh: money you add and money you earn sit in the
-- same balance, and all of it can be spent on tasks or withdrawn.
--
-- This undoes the credits/earnings split from 064 at the owner's request.
-- The owner has been told what that split was for: a balance that can be both
-- topped up and cashed out is a wallet under RBI's PPI rules, and "add by
-- card, withdraw to UPI" is a cash-out route for stolen cards. Withdrawals stay
-- reviewed before they are sent (see 065) as the safeguard for the second.
--
-- credits_minor and tasks.funded_credits_minor stay as columns (always 0 from
-- here) so older app builds that read them keep working.

update public.wallets
   set balance_minor = balance_minor + credits_minor,
       credits_minor = 0,
       updated_at = now()
 where credits_minor > 0;

comment on column public.wallets.balance_minor is
  'The wallet: top-ups, earnings and refunds. Spendable on tasks and withdrawable.';
comment on column public.wallets.credits_minor is
  'Unused since 066 (always 0). Kept so older app builds still read a number.';

-- Top-ups land in the one balance. Still idempotent per payment.
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
     set balance_minor = balance_minor + v_pay.amount_minor, updated_at = now()
   where user_id = v_pay.user_id;
  update public.payments set credited_at = now() where id = p_payment_id;
end;
$fn$;
revoke all on function public.credit_topup(uuid) from public, anon, authenticated;
grant execute on function public.credit_topup(uuid) to service_role;

-- Paying for a task takes from the one balance.
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
  select balance_minor into v_balance
    from public.wallets where user_id = v_task.poster_id for update;

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
         funded_credits_minor = 0,
         wallet_refunded_at = null,
         updated_at = now()
   where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$fn$;
revoke all on function private.fund_task_from_wallet(uuid) from public, anon, authenticated;

-- A task that does not complete gives everything back to the one balance.
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

-- Kardoh's smallest top-up is ₹50.
insert into public.settings (key, value)
values ('min_topup_minor', to_jsonb(5000))
on conflict (key) do update set value = excluded.value;
