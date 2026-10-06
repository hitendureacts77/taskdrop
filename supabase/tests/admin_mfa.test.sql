-- Admin money actions need an authenticator code (aal2).
--
-- Audit finding F-11 (docs/audit/SECURITY_FINDINGS.md). These assertions FAIL
-- against migrations <= 079 and PASS against 080.
--
-- Everything runs inside one transaction that is rolled back, so the test
-- leaves no rows behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_mfa.test.sql

begin;

create or replace function pg_temp.become(p_user uuid, p_aal text default 'aal1') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- true when the statement is refused with the MFA message.
create or replace function pg_temp.mfa_refused(p_sql text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return sqlerrm like '%authenticator code%';
end;
$$;

do $$
declare
  v_admin  uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_payout public.payouts;
  v_own    public.payouts;
  v_fee    jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'mfa+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_worker), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_admin, 'MFA Admin'), (v_worker, 'MFA Worker'), (v_other, 'MFA Other')
  on conflict (id) do nothing;
  insert into public.wallets (user_id, balance_minor)
  values (v_admin, 500000), (v_worker, 500000), (v_other, 0)
  on conflict (user_id) do update set balance_minor = excluded.balance_minor;
  insert into public.payout_destinations (user_id, kind, label, upi_id)
  values (v_admin, 'upi', 'UPI', 'mfa.admin@okaxis'), (v_worker, 'upi', 'UPI', 'mfa.worker@okaxis');

  -- make sure the switch is on for this test
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';

  -- an ordinary user's own withdrawal is untouched by any of this
  perform pg_temp.become(v_worker);
  v_payout := public.request_withdrawal(100000, 'worker@upi');
  perform pg_temp.as_owner();
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  -- ---- password/Google only (aal1): money actions refused -----------------
  perform pg_temp.become(v_admin, 'aal1');
  if not pg_temp.mfa_refused(format('select public.admin_mark_payout(%L, ''processing'', null)', v_payout.id)) then
    raise exception 'FAIL F-11: an admin without an authenticator code moved a payout';
  end if;
  if not pg_temp.mfa_refused('update public.settings set value = ''0.04''::jsonb where key = ''poster_service_fee_pct''') then
    raise exception 'FAIL F-11: an admin without an authenticator code changed a fee';
  end if;
  if not pg_temp.mfa_refused(format('select public.admin_set_admin(%L, true)', v_other)) then
    raise exception 'FAIL F-11: an admin without an authenticator code granted admin';
  end if;
  if not pg_temp.mfa_refused('update public.settings set value = ''false''::jsonb where key = ''admin_require_mfa''') then
    raise exception 'FAIL F-11: a password alone switched the MFA requirement off';
  end if;
  -- switching it ON never needs a code
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';

  -- an admin is also a person: their own withdrawal, and cancelling it, are fine
  v_own := public.request_withdrawal(50000, 'admin@upi');
  v_own := public.cancel_withdrawal(v_own.id);
  if v_own.status <> 'cancelled' then raise exception 'FAIL: an admin could not cancel their own withdrawal'; end if;

  -- ---- with a verified code (aal2): the same actions go through ------------
  perform pg_temp.become(v_admin, 'aal2');
  perform public.admin_mark_payout(v_payout.id, 'processing', null);
  select value into v_fee from public.settings where key = 'poster_service_fee_pct';
  update public.settings set value = v_fee where key = 'poster_service_fee_pct';
  if (select status from public.payouts where id = v_payout.id) <> 'processing' then
    raise exception 'FAIL: a verified admin could not move a payout';
  end if;

  -- ---- the service role (webhooks, RazorpayX) and the operator are not gated
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'postgres', true);
  insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason)
  values (v_other, 100, 0, 0, 'service-role adjustment');
  perform pg_temp.as_owner();
  insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason)
  values (v_other, 100, 0, 0, 'operator adjustment');

  raise notice 'admin_mfa: all assertions passed';
end;
$$;

rollback;
