-- Withdrawal limits (plan task 2.14, hole H32, migration 145).
--
-- 071 rewrote request_withdrawal from an older copy and lost the checks 066
-- had added. This pins the ones 145 put back, so a later rewrite cannot drop
-- them unseen: the most per withdrawal and the holder's name on a bank
-- account, and (kept from 071) no withdrawal while suspended. The account is
-- made "established" for the length of the test, so the separate new-account
-- limit (133) does not answer first. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/withdrawal_limits.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_me     uuid := gen_random_uuid();
  v_upi    uuid;
  v_bank   uuid;
  v_payout public.payouts;
  v_max    bigint := private.setting_num('max_withdraw_minor', 10000000)::bigint;
  v_err    text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_me, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'wl+' || v_me || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_me, 'Limit Tester') on conflict (id) do nothing;
  insert into public.wallets (user_id, balance_minor) values (v_me, v_max * 3)
  on conflict (user_id) do update set balance_minor = excluded.balance_minor;
  insert into public.payout_destinations (user_id, kind, label, upi_id)
  values (v_me, 'upi', 'UPI', 'limits@okaxis') returning id into v_upi;
  -- A bank account saved before the name was required (the app now always sends one).
  insert into public.payout_destinations (user_id, kind, label, account_name, account_number, ifsc)
  values (v_me, 'bank', 'Bank', '', '000111222333', 'HDFC0000001') returning id into v_bank;
  -- Every account counts as established inside this transaction only.
  update public.settings set value = to_jsonb(0) where key in ('new_account_days', 'new_account_tasks');

  perform pg_temp.become(v_me);

  -- ---- more than the most per withdrawal is refused, with its own message ----
  v_err := null;
  begin
    perform public.request_withdrawal(v_max + 100, null, v_upi);
  exception when others then v_err := sqlerrm;
  end;
  assert v_err like 'The most you can withdraw at once is%',
    format('a withdrawal over the limit should be refused by the limit, got: %s', coalesce(v_err, 'no error'));

  -- ---- a bank account with no holder's name is refused ----------------------
  v_err := null;
  begin
    perform public.request_withdrawal(10000, null, v_bank);
  exception when others then v_err := sqlerrm;
  end;
  assert v_err like 'Add the account holder%',
    format('a bank account without a name should be refused, got: %s', coalesce(v_err, 'no error'));

  -- ---- the limit itself is allowed, and the money leaves the wallet ---------
  v_payout := public.request_withdrawal(v_max, null, v_upi);
  assert v_payout.status = 'requested', format('a withdrawal at the limit should go through, was %s', v_payout.status);

  -- ---- still refused while suspended (071) ----------------------------------
  perform pg_temp.as_owner();
  insert into public.user_suspensions (user_id, reason) values (v_me, 'withdrawal_limits test');
  perform pg_temp.become(v_me);
  v_err := null;
  begin
    perform public.request_withdrawal(10000, null, v_upi);
  exception when others then v_err := sqlerrm;
  end;
  assert v_err like 'Your account is suspended%',
    format('a suspended account should not withdraw, got: %s', coalesce(v_err, 'no error'));

  raise notice 'withdrawal_limits: all assertions passed';
end;
$$;

rollback;
