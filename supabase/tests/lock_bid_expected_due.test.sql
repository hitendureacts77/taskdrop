-- 227: hiring moves the task to the finish date the poster saw, never a date changed after.
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lock_bid_expected_due.test.sql

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
  v_task1  uuid;
  v_task2  uuid;
  v_task3  uuid;
  v_bid1   uuid;
  v_bid2   uuid;
  v_bid3   uuid;
  v_seen   timestamptz := date_trunc('minute', now()) + interval '2 days';
  v_later  timestamptz := date_trunc('minute', now()) + interval '4 days';
  v_row    public.tasks;
  v_msg    text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'due+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Due Poster'), (v_worker, 'Due Worker')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  assert not has_function_privilege('anon', 'public.lock_bid(uuid, payout_mode, bigint, boolean, timestamptz)', 'EXECUTE'),
    'signed out cannot hire';
  assert has_function_privilege('authenticated', 'public.lock_bid(uuid, payout_mode, bigint, boolean, timestamptz)', 'EXECUTE'),
    'a signed-in poster can hire';

  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'date moved', 100000, 240) returning id into v_task1;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'date added', 100000, 240) returning id into v_task2;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'old app call', 100000, 240) returning id into v_task3;

  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, proposed_due_at)
  values (v_task1, v_worker, 100000, 240, v_seen) returning id into v_bid1;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task2, v_worker, 100000, 240) returning id into v_bid2;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, proposed_due_at)
  values (v_task3, v_worker, 100000, 240, v_seen) returning id into v_bid3;

  -- The poster saw "Can finish by" v_seen; the worker moves it two days later before the tap.
  update public.bids set proposed_due_at = v_later where id = v_bid1;

  perform pg_temp.become(v_poster);
  v_msg := null;
  begin
    perform public.lock_bid(v_bid1, 'one_time', 100000, true, v_seen);
  exception when others then v_msg := sqlerrm; end;
  assert v_msg = 'The helper changed their finish time. Please look again.',
    format('a moved date must be refused, got %s', coalesce(v_msg, 'it was accepted'));

  perform pg_temp.as_operator();
  assert (select status from public.tasks where id = v_task1) = 'OPEN', 'the task stays open';
  assert (select balance_minor from public.wallets where user_id = v_poster) = 1000000,
    'nothing may be charged for a refused hire';
  assert (select due_at from public.tasks where id = v_task1) is null, 'the task date is untouched';

  -- With the new date seen (sent with milliseconds, as the app does), the hire goes through.
  perform pg_temp.become(v_poster);
  v_row := public.lock_bid(v_bid1, 'one_time', 100000, true, v_later + interval '0.123 seconds');
  assert v_row.status = 'LOCKED', 'the hire goes through with the date seen';
  perform pg_temp.as_operator();
  assert (select due_at from public.tasks where id = v_task1) = v_later, 'the task moves to the date seen';

  -- The poster saw no date (null); the worker adds one before the tap: refused too.
  perform pg_temp.become(v_worker);
  update public.bids set proposed_due_at = v_later where id = v_bid2;
  perform pg_temp.become(v_poster);
  v_msg := null;
  begin
    perform public.lock_bid(v_bid2, 'one_time', 100000, true, null);
  exception when others then v_msg := sqlerrm; end;
  assert v_msg = 'The helper changed their finish time. Please look again.',
    format('a date added after the poster looked must be refused, got %s', coalesce(v_msg, 'it was accepted'));

  -- The price check still comes first.
  v_msg := null;
  begin
    perform public.lock_bid(v_bid2, 'one_time', 90000, true, v_later);
  exception when others then v_msg := sqlerrm; end;
  assert v_msg = 'The offer changed. Please review the new price.',
    format('a changed price is still refused, got %s', coalesce(v_msg, 'it was accepted'));

  -- An old app build sends no date: the three-argument call does not check it.
  perform pg_temp.become(v_worker);
  update public.bids set proposed_due_at = v_later where id = v_bid3;
  perform pg_temp.become(v_poster);
  v_row := public.lock_bid(v_bid3, 'one_time', 100000);
  assert v_row.status = 'LOCKED', 'the old call shape still hires';

  raise notice 'lock_bid_expected_due: all assertions passed';
end;
$$;

rollback;
