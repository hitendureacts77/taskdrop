-- 009_payouts
--
-- Withdrawals leave the wallet the moment they are requested, so the balance on
-- screen can never be spent twice while a transfer is in flight. The actual
-- bank/UPI transfer is settled out of band by an operator or a payout provider,
-- which flips the row to 'paid' (or back to 'failed', refunding the wallet).

create type payout_status as enum ('requested', 'paid', 'failed');

create table public.payouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount_minor  bigint not null check (amount_minor > 0),
  status        payout_status not null default 'requested',
  destination   text,
  failure_note  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index payouts_user_idx on public.payouts(user_id, created_at desc);
create trigger trg_payouts_updated before update on public.payouts
  for each row execute function public.set_updated_at();

alter table public.payouts enable row level security;

-- Readable by their owner only. There is deliberately no insert/update policy:
-- the RPC below is the only way a row is created, so the amount can never be
-- decoupled from the wallet debit.
create policy payouts_select_own on public.payouts
  for select using (user_id = (select auth.uid()));

create or replace function public.request_withdrawal(
  p_amount_minor bigint,
  p_destination  text default null
)
returns public.payouts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- Lock the wallet so two taps cannot both pass the balance check.
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
  values (v_me, p_amount_minor, nullif(btrim(coalesce(p_destination, '')), ''))
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.request_withdrawal(bigint, text) from public;
grant execute on function public.request_withdrawal(bigint, text) to authenticated;
