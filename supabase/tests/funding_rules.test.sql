-- Funding rules.
--
-- The rule this asserts is the one every marketplace holding money works to,
-- Fiverr included: no work begins until the buyer's money is actually in.
--
-- Before the funding gate existed, a task could be locked, started, finished
-- and released to a worker without a single rupee being collected -- and the
-- live database really was in that state, with four tasks "released" worth
-- 8,200 rupees against zero settled payments. These assertions are what stops
-- it happening again. Rolls back; leaves nothing.
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

-- payments has no INSERT policy for users on purpose -- rows are written by the
-- Edge Function with the service role -- so the test steps out of the user role
-- to stand one up.
create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
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

  -- ---- a quote is posted, quoted on, and locked -------------------------
  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'funding gate', 100000, 240)
  returning id into v_task;

  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240)
  returning id into v_bid;

  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid, 'one_time');

  select escrow_minor into v_escrow from public.assignments where task_id = v_task;
  assert v_escrow = 103000,
    format('escrow should be the quote plus the 3%% fee, was %s', v_escrow);

  -- ---- an unfunded task cannot be started -------------------------------
  -- This is the whole point. Locking a quote is not paying for it.
  perform pg_temp.become(v_worker);
  v_failed := false;
  begin
    perform public.start_task(v_task);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'a worker must not be able to start an unpaid task';

  -- ---- a payment that has not settled does not fund it ------------------
  perform pg_temp.as_operator();
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status)
  values (v_poster, v_task, 'escrow', v_escrow, 'plink_unpaid', 'created')
  returning id into v_pay;

  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    perform public.fund_task(v_task, v_pay);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'a payment that has not settled must not fund a task';

  -- ---- nor does a settled payment that is short of the escrow -----------
  perform pg_temp.as_operator();
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task, 'escrow', v_escrow - 1, 'plink_short', 'paid', now())
  returning id into v_short;

  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    perform public.fund_task(v_task, v_short);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'an underpayment must not fund a task';

  -- ---- a real settled payment does ---------------------------------------
  perform pg_temp.as_operator();
  update public.payments set status = 'paid', paid_at = now() where id = v_pay;

  perform pg_temp.become(v_poster);
  v_row := public.fund_task(v_task, v_pay);
  assert v_row.funded_at is not null, 'a settled payment should fund the task';

  -- ---- funding twice must not count twice --------------------------------
  v_row := public.fund_task(v_task, v_pay);
  assert v_row.funded_at is not null, 'funding again should be harmless, not an error';

  -- ---- and only now can the work begin -----------------------------------
  perform pg_temp.become(v_worker);
  v_row := public.start_task(v_task);
  assert v_row.status = 'TASK_STARTED',
    format('a funded task should start, status was %s', v_row.status);

  raise notice 'funding_rules: all assertions passed';
end;
$$;

rollback;
