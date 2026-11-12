-- B54 + B56 (migration 168): a worker walking off a card-paid job gives the card money back
-- to the poster's wallet, and the job must be paid again for the next hire.
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/walkoff_card_refund.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_task   uuid;
  v_bid    uuid;
  v_pay    uuid;
  v_row    public.tasks;
  v_bal    bigint;
  v_credit bigint;
begin
  -- The columns 066 section J added.
  assert exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'payments' and column_name = 'wallet_credited_at'), 'payments.wallet_credited_at';
  assert exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'payments' and column_name = 'wallet_credited_minor'), 'payments.wallet_credited_minor';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'walk+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Card Poster'), (v_worker, 'Card Worker')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 0, credits_minor = 0 where user_id = v_poster;

  -- An older job paid by card: hired, then a settled card payment.
  perform pg_temp.as_operator();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'card paid', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, is_locked)
  values (v_task, v_worker, 100000, 240, true) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor)
  values (v_task, v_bid, v_worker, 103000);
  update public.tasks set status = 'LOCKED', locked_bid_id = v_bid, locked_minor = 100000 where id = v_task;
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task, 'escrow', 103000, 'plink_walkoff', 'paid', now())
  returning id into v_pay;

  v_row := public.fund_task_from_payment(v_pay);
  assert v_row.funded_at is not null, 'a settled card payment funds the hired job';
  assert v_row.funded_via = 'payment', format('the job is marked paid by card, got %s', coalesce(v_row.funded_via, 'nothing'));

  -- The worker walks off.
  perform pg_temp.become(v_worker);
  v_row := public.cancel_task(v_task, null);
  assert v_row.status = 'OPEN', 'the job is back on the market';

  perform pg_temp.as_operator();
  select * into v_row from public.tasks where id = v_task;
  assert v_row.funded_at is null and v_row.funding_payment_id is null and v_row.funded_via is null,
    'the job is no longer marked paid, so the next hire is paid for afresh';
  select balance_minor, credits_minor into v_bal, v_credit from public.wallets where user_id = v_poster;
  assert v_bal = 103000, format('the card money is in the spendable wallet balance, got %s', v_bal);
  assert v_credit = 0, 'nothing lands in the unused credits column';
  assert (select wallet_credited_minor from public.payments where id = v_pay) = 103000, 'the payment records the move';
  assert (select wallet_credited_at from public.payments where id = v_pay) is not null, 'the payment records when';

  -- The same payment can never fund the job again, nor count as waiting to be applied.
  v_row := public.fund_task_from_payment(v_pay);
  assert v_row.funded_at is null, 'a payment moved to the wallet funds nothing';
  assert not exists (select 1 from public.payments_unapplied where payment_id = v_pay),
    'a payment moved to the wallet is not waiting to be applied';

  -- A second walk-off trigger run does not pay twice.
  perform private.move_card_payment_to_wallet(v_task);
  select balance_minor into v_bal from public.wallets where user_id = v_poster;
  assert v_bal = 103000, format('moved once only, got %s', v_bal);

  raise notice 'walkoff_card_refund: all assertions passed';
end;
$$;

rollback;
