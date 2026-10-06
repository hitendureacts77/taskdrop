-- Withdrawal rules.
--
-- Money leaves the wallet the moment a withdrawal is requested, so cancelling
-- has to put back exactly what was taken, exactly once. This asserts the
-- balance arithmetic, who is allowed to cancel, and — the one that actually
-- matters — that a second cancel cannot mint money. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/withdrawal_rules.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Whoever actually sends the money. payouts has only a SELECT policy, so no
-- signed-in user can move a payout along -- that is deliberate, and it means
-- the test has to step out of the user role to simulate an operator picking
-- the payout up.
create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_me      uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_payout  public.payouts;
  v_balance bigint;
  v_status  text;
  v_failed  boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'wd+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_me), (v_other)) as u(id);

  insert into public.profiles (id, display_name)
  values (v_me, 'Withdrawer'), (v_other, 'Bystander')
  on conflict (id) do nothing;

  insert into public.wallets (user_id, balance_minor)
  values (v_me, 500000), (v_other, 0)
  on conflict (user_id) do update set balance_minor = excluded.balance_minor;

  -- request_withdrawal needs a saved destination (migration 026).
  insert into public.payout_destinations (user_id, kind, label, upi_id)
  values (v_me, 'upi', 'UPI', 'withdrawer@okaxis');

  -- ---- requesting moves money out of the wallet -------------------------
  perform pg_temp.become(v_me);
  v_payout := public.request_withdrawal(200000, 'me@bank');

  select balance_minor into v_balance from public.wallets where user_id = v_me;
  assert v_balance = 300000,
    format('request should leave 300000, left %s', v_balance);
  assert v_payout.status = 'requested',
    format('a new payout should be requested, was %s', v_payout.status);

  -- ---- you cannot withdraw more than you hold ---------------------------
  v_failed := false;
  begin
    perform public.request_withdrawal(999999999, 'me@bank');
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'overdrawing the wallet should be refused';

  -- ---- somebody else's payout is not yours to cancel --------------------
  perform pg_temp.become(v_other);
  v_failed := false;
  begin
    perform public.cancel_withdrawal(v_payout.id);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'a stranger should not be able to cancel my withdrawal';

  -- Back to my own session to read my own balance: RLS hides the wallet from
  -- the bystander, so reading it as them yields NULL rather than a number.
  perform pg_temp.become(v_me);
  select balance_minor into v_balance from public.wallets where user_id = v_me;
  assert v_balance = 300000,
    format('a refused cancel must not move money, balance was %s', v_balance);

  -- ---- cancelling returns exactly what was taken ------------------------
  v_payout := public.cancel_withdrawal(v_payout.id);

  assert v_payout.status = 'cancelled',
    format('cancel should mark it cancelled, was %s', v_payout.status);

  select balance_minor into v_balance from public.wallets where user_id = v_me;
  assert v_balance = 500000,
    format('cancel should restore 500000, restored %s', v_balance);

  -- ---- cancelling twice must not pay out twice --------------------------
  -- The whole point of the row lock. Without it a double tap refunds twice
  -- and the wallet ends up with money that never existed.
  v_failed := false;
  begin
    perform public.cancel_withdrawal(v_payout.id);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'a second cancel should be refused';

  select balance_minor into v_balance from public.wallets where user_id = v_me;
  assert v_balance = 500000,
    format('a second cancel must not add money again, balance was %s', v_balance);

  -- ---- once it is being sent, it is too late ----------------------------
  v_payout := public.request_withdrawal(100000, 'me@bank');
  perform pg_temp.as_operator();
  update public.payouts set status = 'processing' where id = v_payout.id;
  perform pg_temp.become(v_me);

  v_failed := false;
  begin
    perform public.cancel_withdrawal(v_payout.id);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'a payout already being processed should not be cancellable';

  select balance_minor into v_balance from public.wallets where user_id = v_me;
  assert v_balance = 400000,
    format('a refused late cancel must not refund, balance was %s', v_balance);

  perform pg_temp.as_operator();
  select status into v_status from public.payouts where id = v_payout.id;
  assert v_status = 'processing',
    format('a refused cancel must leave the status alone, was %s', v_status);

  raise notice 'withdrawal_rules: all assertions passed';
end;
$$;

rollback;
