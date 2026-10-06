-- Funding rules.
--
-- The rule this asserts is the one every marketplace holding money works to,
-- Fiverr included: no work begins until the buyer's money is actually in.
--
-- Since migration 063 the money comes out of the poster's wallet at the moment
-- they lock a quote (lock_bid -> private.fund_task_from_wallet), so an unpaid
-- quote cannot be locked at all. The older Razorpay-link path (fund_task, called
-- with a settled payment) still exists for tasks that reach LOCKED unfunded, and
-- its checks are asserted too. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/funding_rules.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- payments and wallets have no client write policy on purpose -- rows are
-- written by SECURITY DEFINER code and the edge functions -- so the test steps
-- out of the user role to stand fixtures up.
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
  v_short  uuid;
  v_row    public.tasks;
  v_escrow bigint;
  v_before bigint;
  v_after  bigint;
  v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'fund+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker)) as u(id);

  insert into public.profiles (id, display_name)
  values (v_poster, 'Funding Poster'), (v_worker, 'Funding Worker')
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (v_poster), (v_worker)
  on conflict (user_id) do nothing;

  -- ---- a task is posted and quoted on -----------------------------------
  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'funding gate', 100000, 240)
  returning id into v_task;

  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240)
  returning id into v_bid;

  -- ---- an unpaid quote cannot be locked ---------------------------------
  -- Locking a quote is paying for it. The wallet is empty, so this must fail
  -- and must leave the task open.
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    perform public.lock_bid(v_bid, 'one_time');
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'a quote must not lock when the poster cannot pay for it';
  assert (select status from public.tasks where id = v_task) = 'OPEN',
    'a failed lock must leave the task open';
  assert (select funded_at from public.tasks where id = v_task) is null,
    'a failed lock must not mark the task funded';

  -- ---- a funded wallet locks it, and takes exactly the escrow ------------
  perform pg_temp.as_operator();
  update public.wallets set balance_minor = 500000 where user_id = v_poster;
  v_before := 500000;

  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid, 'one_time');

  select escrow_minor into v_escrow from public.assignments where task_id = v_task;
  assert v_escrow = 103000,
    format('escrow should be the quote plus the 3%% fee, was %s', v_escrow);

  select balance_minor into v_after from public.wallets where user_id = v_poster;
  assert v_before - v_after = v_escrow,
    format('the wallet should drop by exactly the escrow (%s), dropped %s', v_escrow, v_before - v_after);

  select * into v_row from public.tasks where id = v_task;
  assert v_row.funded_at is not null and v_row.funded_via = 'wallet' and v_row.funded_minor = v_escrow,
    'a wallet-funded task should record how and how much it was funded';

  -- ---- locking again must not take the money twice -----------------------
  select balance_minor into v_before from public.wallets where user_id = v_poster;
  v_failed := false;
  begin
    perform public.lock_bid(v_bid, 'one_time');
  exception when others then
    v_failed := true;
  end;
  select balance_minor into v_after from public.wallets where user_id = v_poster;
  assert v_after = v_before, 'a repeated lock must not debit the wallet again';

  -- ---- only now can the work begin ---------------------------------------
  perform pg_temp.become(v_worker);
  v_row := public.start_task(v_task);
  assert v_row.status = 'TASK_STARTED',
    format('a funded task should start, status was %s', v_row.status);

  -- ---- the settled-payment path still refuses what it should -------------
  -- A second task, brought to LOCKED without funding (as a legacy row would be),
  -- must still be un-startable, and fund_task must reject bad payments.
  perform pg_temp.as_operator();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, status)
  values (v_poster, 'services', 'legacy unfunded', 100000, 240, 'LOCKED')
  returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, is_locked)
  values (v_task, v_worker, 100000, 240, true) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor)
  values (v_task, v_bid, v_worker, 103000);

  perform pg_temp.become(v_worker);
  v_failed := false;
  begin
    perform public.start_task(v_task);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'a worker must not be able to start an unpaid task';

  perform pg_temp.as_operator();
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status)
  values (v_poster, v_task, 'escrow', 103000, 'plink_unpaid', 'created')
  returning id into v_pay;

  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    perform public.fund_task(v_task, v_pay);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'a payment that has not settled must not fund a task';

  perform pg_temp.as_operator();
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task, 'escrow', 102999, 'plink_short', 'paid', now())
  returning id into v_short;

  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    perform public.fund_task(v_task, v_short);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'an underpayment must not fund a task';

  perform pg_temp.as_operator();
  update public.payments set status = 'paid', paid_at = now() where id = v_pay;
  perform pg_temp.become(v_poster);
  v_row := public.fund_task(v_task, v_pay);
  assert v_row.funded_at is not null, 'a settled payment should fund the task';
  v_row := public.fund_task(v_task, v_pay);
  assert v_row.funded_at is not null, 'funding again should be harmless, not an error';

  raise notice 'funding_rules: all assertions passed';
end;
$$;

rollback;
