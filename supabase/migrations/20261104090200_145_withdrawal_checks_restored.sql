-- 145 — the withdrawal checks that 071 dropped, put back (plan task 2.14, hole H32).
--
-- 066 hardened request_withdrawal: a most-per-withdrawal limit (setting
-- max_withdraw_minor, Rs 1 lakh), "add your name and PAN first" and the account
-- holder's name on a bank account. 071 added the suspended-account refusal by
-- rewriting the function from an older copy, and the 066 checks were lost on
-- the way. The bug and security hunt found it on 3 Nov 2026 by comparing every
-- function with its previous version. (Which way a payout is sent, `via`, is
-- set by the trigger from 086, so it is not set here.)
--
-- This keeps everything 071 has and puts back the limit and the holder's name.
-- The PAN check is NOT put back: the app has no screen to enter a PAN
-- (no one has one saved), so it would block every withdrawal. Whether PAN is
-- asked for, and where, is the owner's decision (plan task 2.14, finding H32).

create or replace function public.request_withdrawal(
  p_amount_minor   bigint,
  p_destination    text default null::text,
  p_destination_id uuid default null::uuid
)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me      uuid := auth.uid();
  v_balance bigint;
  v_min     bigint := private.setting_num('min_withdraw_minor', 10000)::bigint;
  v_max     bigint := private.setting_num('max_withdraw_minor', 10000000)::bigint;
  v_dest    public.payout_destinations;
  v_label   text;
  v_row     public.payouts;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public.user_suspensions where user_id = v_me and lifted_at is null) then
    raise exception 'Your account is suspended. Contact support.';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter an amount to withdraw';
  end if;
  if p_amount_minor < v_min then
    raise exception 'The minimum withdrawal is % rupees', (v_min / 100);
  end if;
  if p_amount_minor > v_max then
    raise exception 'The most you can withdraw at once is % rupees', (v_max / 100);
  end if;

  if p_destination_id is not null then
    select * into v_dest from public.payout_destinations where id = p_destination_id and user_id = v_me;
    if not found then
      raise exception 'Choose one of your saved bank accounts or UPI IDs';
    end if;
    if v_dest.kind = 'bank' and coalesce(btrim(v_dest.account_name), '') = '' then
      raise exception 'Add the account holder''s name to this bank account first';
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

  update public.wallets set balance_minor = balance_minor - p_amount_minor, updated_at = now() where user_id = v_me;

  insert into public.payouts (user_id, amount_minor, destination, destination_id)
  values (v_me, p_amount_minor, v_label, p_destination_id)
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.request_withdrawal(bigint, text, uuid) from public, anon;
grant execute on function public.request_withdrawal(bigint, text, uuid) to authenticated;
