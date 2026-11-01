-- Migration 133: money safety limits for new accounts and the self-dealing flag (plan task 2.11, hole H17).
--
-- What is asserted:
--   1. A new account cannot post a job worth more than the limit, nor have an offer worth more chosen
--      (the amount held); an amount at the limit is fine.
--   2. The limit rises with finished jobs that earned 4+ stars, and goes away once the account is both
--      old enough and has enough finished jobs.
--   3. A new account's withdrawals add up per day; the one that would cross the limit is refused.
--   4. The server (a session that is not the app's own roles) is not limited.
--   5. The admin's settings are what the limits follow.
--   6. A poster and a worker who share a UPI id or a device leave one alert; strangers leave none; the
--      job is never blocked.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/new_account_limits.test.sql

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

create or replace function pg_temp.make_user(p_name text) returns uuid
language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'limits+' || v_user || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_user, p_name) on conflict (id) do nothing;
  insert into public.wallets (user_id, balance_minor) values (v_user, 5000000) on conflict (user_id) do update set balance_minor = 5000000;
  return v_user;
end;
$$;

-- A finished job between two people, with a review of `p_stars` about the worker.
create or replace function pg_temp.finished_job(p_poster uuid, p_worker uuid, p_stars smallint) returns uuid
language plpgsql as $$
declare
  v_task uuid;
  v_bid  uuid;
begin
  perform pg_temp.as_operator();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, status)
  values (p_poster, 'services', 'finished', 100000, 240, 'COMPLETED') returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_task, p_worker, 100000, 240) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status) values (v_task, v_bid, p_worker, 103000, 'assigned');
  insert into public.reviews (task_id, author_id, subject_id, about_role, rating) values (v_task, p_poster, p_worker, 'worker', p_stars);
  return v_task;
end;
$$;

create or replace function pg_temp.refused(p_sql text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end;
$$;

-- ---- 1. the value of one job -------------------------------------------------------------------
do $$
declare
  v_new  uuid := pg_temp.make_user('New poster');
  v_task uuid;
begin
  perform pg_temp.become(v_new);

  assert pg_temp.refused(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (%L, ''services'', ''too big'', 500001, 240)', v_new)),
    'a new account cannot post a job worth more than Rs 5,000';

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_new, 'services', 'at the limit', 500000, 240) returning id into v_task;

  -- The amount held when an offer is chosen is checked too.
  assert pg_temp.refused(format('update public.tasks set locked_minor = 600000 where id = %L', v_task)),
    'an offer worth more than the limit cannot be chosen by a new account';
  update public.tasks set locked_minor = 500000 where id = v_task;
end;
$$;

-- ---- 4. the server is not limited --------------------------------------------------------------
do $$
declare
  v_new uuid := pg_temp.make_user('Server-posted');
begin
  perform pg_temp.as_operator();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_new, 'services', 'seeded big job', 9000000, 240);
end;
$$;

-- ---- 2. the limit rises, then goes away --------------------------------------------------------
do $$
declare
  v_poster uuid := pg_temp.make_user('Rising poster');
  v_worker uuid := pg_temp.make_user('Helpful worker');
  v_cap    bigint;
begin
  perform pg_temp.as_operator();
  assert private.new_account_cap(v_poster, 500000) = 500000, 'a brand-new account starts at the base limit';

  perform pg_temp.finished_job(v_poster, v_worker, 5::smallint);
  assert private.new_account_cap(v_worker, 500000) = 1000000, 'one finished job with 5 stars doubles the limit';

  perform pg_temp.finished_job(v_poster, v_worker, 2::smallint);
  assert private.new_account_cap(v_worker, 500000) = 1000000, 'a finished job with 2 stars adds nothing';

  perform pg_temp.finished_job(v_poster, v_worker, 4::smallint);
  perform pg_temp.finished_job(v_poster, v_worker, 5::smallint);
  v_cap := private.new_account_cap(v_worker, 500000);
  assert v_cap = 2000000, format('the rise stops at the number of jobs that ends "new" (3 more): %s', v_cap);

  -- 4 finished jobs but the account is days old: still new.
  assert private.new_account_cap(v_worker, 500000) is not null, 'finished jobs alone do not end "new"';
  update public.profiles set created_at = now() - interval '31 days' where id = v_worker;
  assert private.new_account_cap(v_worker, 500000) is null, 'old enough and enough finished jobs: no limit';

  -- Old but with no finished jobs: still new.
  update public.profiles set created_at = now() - interval '90 days' where id = v_poster;
  assert private.new_account_cap(v_poster, 500000) is not null, 'age alone does not end "new": a 90-day-old account with no finished job is still limited';
end;
$$;

-- ---- 3. withdrawals per day, and 5. the settings -----------------------------------------------
do $$
declare
  v_new uuid := pg_temp.make_user('New earner');
  v_old uuid := pg_temp.make_user('Established earner');
  v_job uuid;
  v_peer uuid := pg_temp.make_user('Peer');
begin
  perform pg_temp.as_operator();
  insert into public.payout_destinations (user_id, kind, label, upi_id) values (v_new, 'upi', 'UPI', 'newearner@okaxis');
  insert into public.payout_destinations (user_id, kind, label, upi_id) values (v_old, 'upi', 'UPI', 'oldearner@okaxis');

  perform pg_temp.become(v_new);
  perform public.request_withdrawal(300000, 'x');
  assert pg_temp.refused('select public.request_withdrawal(300000, ''x'')'),
    'a second withdrawal that takes the day past Rs 5,000 is refused';
  perform public.request_withdrawal(200000, 'x'); -- exactly reaches the limit

  assert pg_temp.refused('select public.request_withdrawal(100000, ''x'')'), 'the day is full';

  -- The admin raises the limit: it follows the setting.
  perform pg_temp.as_operator();
  update public.settings set value = '800000'::jsonb where key = 'new_account_max_withdraw_day_minor';
  perform pg_temp.become(v_new);
  perform public.request_withdrawal(300000, 'x');

  -- An established account is not limited.
  perform pg_temp.as_operator();
  update public.profiles set created_at = now() - interval '40 days' where id = v_old;
  perform pg_temp.finished_job(v_old, v_peer, 5::smallint);
  perform pg_temp.finished_job(v_old, v_peer, 5::smallint);
  perform pg_temp.finished_job(v_old, v_peer, 5::smallint);
  perform pg_temp.become(v_old);
  perform public.request_withdrawal(4000000, 'x');
end;
$$;

-- ---- 6. self-dealing flag ----------------------------------------------------------------------
do $$
declare
  v_poster uuid := pg_temp.make_user('Dealing poster');
  v_same   uuid := pg_temp.make_user('Same UPI worker');
  v_device uuid := pg_temp.make_user('Same device worker');
  v_clean  uuid := pg_temp.make_user('Honest worker');
  v_task   uuid;
  v_bid    uuid;
  n        integer;
begin
  perform pg_temp.as_operator();
  delete from public.admin_alerts where kind = 'self_dealing';
  insert into public.payout_destinations (user_id, kind, label, upi_id) values
    (v_poster, 'upi', 'UPI', 'Shared.Name@okaxis'), (v_same, 'upi', 'UPI', 'shared.name@OKAXIS'), (v_clean, 'upi', 'UPI', 'honest@okaxis');
  insert into public.app_devices (user_id, install_id, platform) values
    (v_poster, 'install-shared-0001', 'android'), (v_device, 'install-shared-0001', 'android'), (v_clean, 'install-clean-0001', 'android');

  -- Same UPI id (case does not matter): flagged, not blocked.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (v_poster, 'services', 'deal one', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_task, v_same, 100000, 240) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status) values (v_task, v_bid, v_same, 103000, 'assigned');
  select count(*) into n from public.admin_alerts where kind = 'self_dealing' and data ->> 'taskId' = v_task::text;
  assert n = 1, format('a shared UPI id leaves one alert, found %s', n);

  -- Same device: flagged.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (v_poster, 'services', 'deal two', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_task, v_device, 100000, 240) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status) values (v_task, v_bid, v_device, 103000, 'assigned');
  select count(*) into n from public.admin_alerts where kind = 'self_dealing' and data ->> 'taskId' = v_task::text;
  assert n = 1, format('a shared device leaves one alert, found %s', n);

  -- Strangers: nothing; and running the check again on a flagged job adds nothing.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (v_poster, 'services', 'honest deal', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_task, v_clean, 100000, 240) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status) values (v_task, v_bid, v_clean, 103000, 'assigned');
  select count(*) into n from public.admin_alerts where kind = 'self_dealing' and data ->> 'taskId' = v_task::text;
  assert n = 0, 'two people with nothing in common leave no alert';
  perform private.flag_self_dealing((select task_id from public.assignments where worker_id = v_same));
  perform private.flag_self_dealing((select task_id from public.assignments where worker_id = v_same));
  select count(*) into n from public.admin_alerts where kind = 'self_dealing';
  assert n = 2, format('the same job is flagged once, found %s alerts in total', n);
end;
$$;

-- ---- who can reach the helpers -----------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.new_account_cap(uuid,bigint)', 'private.flag_self_dealing(uuid)', 'private.setting_int(text,bigint)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
      format('%s must not be callable by the app''s roles', f);
  end loop;
end;
$$;

rollback;
