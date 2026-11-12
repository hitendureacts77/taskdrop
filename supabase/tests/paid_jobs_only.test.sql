-- A helper who backs out of a job gets no credit when someone else finishes it (migration 175,
-- debug loop B67). Only the paid assignment ('released') counts in jobs done, earnings, streaks and
-- the Top helpers list. Rolls back; leaves nothing.
--
-- The job is built the way the database leaves it after a walk-off and a rehire (cancel_task's
-- helper branch sets the first assignment to 'refunded' and reopens the task; the second helper is
-- hired, and confirm_release sets theirs to 'released'), so the test does not depend on the payment
-- path, which CI cannot run.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/paid_jobs_only.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
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

do $$
declare
  v_poster  uuid := gen_random_uuid();
  v_walker  uuid := gen_random_uuid();
  v_doer    uuid := gen_random_uuid();
  v_task    uuid;
  v_bid_w   uuid;
  v_bid_d   uuid;
  v_stats   jsonb;
  v_streak  jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'pjo+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_walker), (v_doer)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'PJO Poster'), (v_walker, 'PJO Walker'), (v_doer, 'PJO Doer')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_walker), (v_doer) on conflict (user_id) do nothing;
  update public.profiles set onboarded_at = now(), created_at = now() where id in (v_poster, v_walker, v_doer);

  -- The walker was hired first and backed out (refunded); the doer was hired next and paid (released).
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'pjo walk-off job', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_walker, 100000, 240) returning id into v_bid_w;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, is_locked)
  values (v_task, v_doer, 100000, 240, true) returning id into v_bid_d;
  insert into public.assignments (task_id, bid_id, worker_id, status, escrow_minor, payout_mode)
  values (v_task, v_bid_w, v_walker, 'refunded', 103000, 'one_time'),
         (v_task, v_bid_d, v_doer,   'released', 103000, 'one_time');
  update public.tasks
     set status = 'COMPLETED', locked_bid_id = v_bid_d, locked_minor = 100000, payout_mode = 'one_time',
         completed_at = now()
   where id = v_task;

  -- Public profile numbers.
  assert (public.public_profile_stats(v_walker) ->> 'jobsDone')::int = 0,
    'FAIL B67: the helper who backed out shows the job as done on their profile';
  assert (public.public_profile_stats(v_doer) ->> 'jobsDone')::int = 1,
    'FAIL B67: the helper who finished the job lost it on their profile';

  -- Top helpers list (New talent: both accounts are new).
  assert coalesce((select e.jobs_done from private.top_earners_live('new_talent', 30) e where e.id = v_walker), 0) = 0,
    'FAIL B67: the helper who backed out has the job in Top helpers';
  assert (select e.jobs_done from private.top_earners_live('new_talent', 30) e where e.id = v_doer) = 1,
    'FAIL B67: the helper who finished the job is missing it in Top helpers';

  -- Their own Earn numbers and streaks.
  perform pg_temp.become(v_walker);
  v_stats := public.my_stats('worker');
  v_streak := public.my_streaks();
  perform pg_temp.as_owner();
  assert (v_stats ->> 'jobsDone')::int = 0 and (v_stats ->> 'earnedMinor')::bigint = 0,
    format('FAIL B67: my_stats credits the helper who backed out: %s', v_stats);
  assert (v_streak ->> 'jobsDone')::int = 0 and (v_streak ->> 'weekJobs')::int = 0
     and (v_streak ->> 'weekEarnedMinor')::bigint = 0,
    format('FAIL B67: my_streaks credits the helper who backed out: %s', v_streak);

  perform pg_temp.become(v_doer);
  v_stats := public.my_stats('worker');
  v_streak := public.my_streaks();
  perform pg_temp.as_owner();
  assert (v_stats ->> 'jobsDone')::int = 1 and (v_stats ->> 'earnedMinor')::bigint > 0,
    format('FAIL B67: my_stats lost the finished job: %s', v_stats);
  assert (v_streak ->> 'jobsDone')::int = 1 and (v_streak ->> 'weekJobs')::int = 1,
    format('FAIL B67: my_streaks lost the finished job: %s', v_streak);
end;
$$;

rollback;
