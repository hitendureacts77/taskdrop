-- 065 — withdrawals are sent by RazorpayX Payouts.
--
-- The money model: Razorpay collects what posters pay, these tables are the
-- wallet records, and a worker's withdrawal goes out through RazorpayX to the
-- bank account or UPI ID they saved. Until RazorpayX is configured
-- (RAZORPAYX_ACCOUNT_NUMBER), nothing here changes behaviour: a withdrawal
-- stays 'requested' and an operator can still pay it by hand.
--
-- Lifecycle of a payout row:
--   requested   the worker asked; earnings already taken out of balance_minor
--   processing  handed to RazorpayX (claimed by the razorpayx-payouts function)
--   paid        RazorpayX says the transfer is done (payout.processed)
--   failed      RazorpayX refused or reversed it; the money is back in earnings
--   cancelled   the worker took it back before it was sent

alter table public.payouts
  add column if not exists destination_id uuid references public.payout_destinations (id) on delete set null,
  add column if not exists provider_payout_id text unique,
  add column if not exists mode text,
  add column if not exists sent_at timestamptz;

comment on column public.payouts.destination_id is 'The saved bank account or UPI ID this withdrawal goes to.';
comment on column public.payouts.provider_payout_id is 'RazorpayX payout id (pout_...), once RazorpayX has accepted it.';

alter table public.payout_destinations
  add column if not exists rzp_contact_id text,
  add column if not exists rzp_fund_account_id text;

comment on column public.payout_destinations.rzp_fund_account_id is
  'RazorpayX fund account for this destination, created on first payout and reused.';

-- ------------------------------------------------------------- withdrawals --

-- A withdrawal names one of the worker's own saved destinations, by id, so the
-- payout can be sent to exactly that account. The text form is kept for older
-- app versions; it must still come with at least one saved destination.
drop function if exists public.request_withdrawal(bigint, text);

create or replace function public.request_withdrawal(
  p_amount_minor   bigint,
  p_destination    text default null::text,
  p_destination_id uuid default null
)
returns payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me      uuid := auth.uid();
  v_balance bigint;
  v_min     bigint := private.setting_num('min_withdraw_minor', 10000)::bigint;
  v_dest    public.payout_destinations;
  v_label   text;
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

  if p_destination_id is not null then
    select * into v_dest from public.payout_destinations where id = p_destination_id and user_id = v_me;
    if not found then
      raise exception 'Choose one of your saved bank accounts or UPI IDs';
    end if;
    v_label := case
      when v_dest.kind = 'upi' then 'UPI · ' || v_dest.upi_id
      else 'Bank · ' || coalesce(v_dest.account_name, '') || ' · ••••' || right(coalesce(v_dest.account_number, ''), 4)
    end;
  else
    if not exists (select 1 from public.payout_destinations where user_id = v_me) then
      raise exception 'Add a bank account or UPI ID before withdrawing';
    end if;
    v_label := nullif(btrim(coalesce(p_destination, '')), '');
    if v_label is null then
      raise exception 'Choose the bank account or UPI ID to send the money to';
    end if;
  end if;

  select balance_minor into v_balance from public.wallets where user_id = v_me for update;
  if not found then
    raise exception 'No wallet found';
  end if;
  if v_balance < p_amount_minor then
    raise exception 'That is more than your earnings available to withdraw';
  end if;

  update public.wallets set balance_minor = balance_minor - p_amount_minor where user_id = v_me;

  insert into public.payouts (user_id, amount_minor, destination, destination_id)
  values (v_me, p_amount_minor, v_label, p_destination_id)
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.request_withdrawal(bigint, text, uuid) from public, anon;
grant execute on function public.request_withdrawal(bigint, text, uuid) to authenticated;

-- ------------------------------------------------- the sending function's side --
-- Service role only: called by the razorpayx-payouts / razorpayx-webhook
-- functions, never by the app.

-- Claim a requested payout for sending. Only one caller can win it, and once
-- it is 'processing' the worker can no longer cancel it.
create or replace function public.claim_payout_for_sending(p_payout_id uuid)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_row public.payouts;
begin
  update public.payouts
     set status = 'processing', updated_at = now()
   where id = p_payout_id and status = 'requested'
  returning * into v_row;
  return v_row;
end;
$fn$;

-- RazorpayX never accepted it (a network error, a 5xx): put it back so it can
-- be sent again. The idempotency key makes a resend safe.
create or replace function public.unclaim_payout(p_payout_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  update public.payouts
     set status = 'requested', failure_note = p_note, updated_at = now()
   where id = p_payout_id and status = 'processing' and provider_payout_id is null;
end;
$fn$;

-- RazorpayX accepted it.
create or replace function public.record_payout_sent(p_payout_id uuid, p_provider_id text, p_mode text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  update public.payouts
     set provider_payout_id = p_provider_id, mode = p_mode, sent_at = now(), failure_note = null, updated_at = now()
   where id = p_payout_id;
end;
$fn$;

-- The final word from RazorpayX. 'paid' closes it; 'failed' closes it and puts
-- the money back in the worker's earnings -- once, however often it is told.
create or replace function public.settle_payout(
  p_payout_id uuid,
  p_outcome   text,
  p_reference text default null,
  p_note      text default null
)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_row public.payouts;
begin
  if p_outcome not in ('paid', 'failed') then
    raise exception 'A payout settles as paid or failed';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then return null; end if;
  if v_row.status in ('paid', 'failed', 'cancelled') then return v_row; end if;

  update public.payouts
     set status = p_outcome::public.payout_status,
         reference = coalesce(p_reference, reference),
         failure_note = case when p_outcome = 'failed' then p_note else null end,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if p_outcome = 'failed' then
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
     where user_id = v_row.user_id;
    perform private.notify(v_row.user_id, 'payout_failed', 'Withdrawal could not be sent',
      coalesce(p_note, 'The money is back in your earnings. Check your bank or UPI details and try again.'), null);
  else
    perform private.notify(v_row.user_id, 'payout_paid', 'Money sent to your account',
      'Your withdrawal of ' || to_char(v_row.amount_minor / 100.0, 'FM999999990.00') || ' rupees has been sent.', null);
  end if;

  return v_row;
end;
$fn$;

-- Remember the RazorpayX contact and fund account for a destination.
create or replace function public.save_payout_fund_account(p_destination_id uuid, p_contact_id text, p_fund_account_id text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  update public.payout_destinations
     set rzp_contact_id = p_contact_id, rzp_fund_account_id = p_fund_account_id
   where id = p_destination_id;
end;
$fn$;

revoke all on function public.claim_payout_for_sending(uuid) from public, anon, authenticated;
revoke all on function public.unclaim_payout(uuid, text) from public, anon, authenticated;
revoke all on function public.record_payout_sent(uuid, text, text) from public, anon, authenticated;
revoke all on function public.settle_payout(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.save_payout_fund_account(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_payout_for_sending(uuid) to service_role;
grant execute on function public.unclaim_payout(uuid, text) to service_role;
grant execute on function public.record_payout_sent(uuid, text, text) to service_role;
grant execute on function public.settle_payout(uuid, text, text, text) to service_role;
grant execute on function public.save_payout_fund_account(uuid, text, text) to service_role;
