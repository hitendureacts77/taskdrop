-- B53 (migration 167): hiring charges the price the poster saw, never a price changed after.
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lock_bid_expected_price.test.sql

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
  v_task2  uuid;
  v_bid    uuid;
  v_bid2   uuid;
  v_row    public.tasks;
  v_bal    bigint;
  v_msg    text;
  v_n      int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'price+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Price Poster'), (v_worker, 'Price Worker')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  -- Both overloads exist and a one- or two-argument call is not ambiguous.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lock_bid';
  assert v_n = 2, format('lock_bid should have the old and the checked shape, found %s', v_n);
  assert not has_function_privilege('anon', 'public.lock_bid(uuid, payout_mode, bigint)', 'EXECUTE'),
    'signed out cannot hire';
  assert has_function_privilege('authenticated', 'public.lock_bid(uuid, payout_mode, bigint)', 'EXECUTE'),
    'a signed-in poster can hire';

  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'price check', 100000, 240) returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'old app call', 100000, 240) returning id into v_task2;

  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task2, v_worker, 100000, 240) returning id into v_bid2;

  -- The poster saw Rs 1,000; the worker raises the offer to Rs 1,500 before the tap.
  update public.bids set price_minor = 150000 where id = v_bid;

  perform pg_temp.become(v_poster);
  v_msg := null;
  begin
    perform public.lock_bid(v_bid, 'one_time', 100000);
  exception when others then v_msg := sqlerrm; end;
  assert v_msg = 'The offer changed. Please review the new price.',
    format('a changed offer must be refused, got %s', coalesce(v_msg, 'it was accepted'));

  perform pg_temp.as_operator();
  select balance_minor into v_bal from public.wallets where user_id = v_poster;
  assert v_bal = 1000000, format('nothing may be charged for a refused hire, balance %s', v_bal);
  assert (select status from public.tasks where id = v_task) = 'OPEN', 'the task stays open';

  -- With the new price seen, the hire goes through at that price.
  perform pg_temp.become(v_poster);
  v_row := public.lock_bid(v_bid, 'one_time', 150000);
  assert v_row.status = 'LOCKED' and v_row.locked_minor = 150000, 'the hire is at the price seen';
  perform pg_temp.as_operator();
  select balance_minor into v_bal from public.wallets where user_id = v_poster;
  assert v_bal = 1000000 - round(150000 * (1 + private.setting_num('poster_service_fee_pct', 0.03))),
    format('charged the seen price plus the fee, balance %s', v_bal);

  -- An old app build sends no price: the one-argument call still works.
  perform pg_temp.become(v_poster);
  v_row := public.lock_bid(v_bid2);
  assert v_row.status = 'LOCKED' and v_row.locked_minor = 100000, 'the old call shape still hires';

  raise notice 'lock_bid_expected_price: all assertions passed';
end;
$$;

rollback;
