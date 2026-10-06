-- Cancellation rules.
--
-- A marketplace where a poster cannot withdraw a request, or a worker cannot
-- step off a job, does not work. This asserts who may cancel when, and that the
-- post-start fine actually reaches the worker. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/cancel_rules.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_task   uuid;
  v_bid    uuid;
  v_status text;
  v_clear  bigint;
  v_fine   bigint;
  v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'cancel+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker)) as u(id);

  insert into public.profiles (id, display_name)
  values (v_poster, 'Cancel Poster'), (v_worker, 'Cancel Worker')
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (v_poster), (v_worker)
  on conflict (user_id) do nothing;

  -- lock_bid funds the task from the poster's wallet (migration 063).
  update public.wallets set balance_minor = 5000000 where user_id = v_poster;

  -- ---- an OPEN task costs nothing to withdraw ---------------------------
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'open cancel', 100000, 240) returning id into v_task;

  perform pg_temp.become(v_poster);
  perform public.cancel_task(v_task);
  select status into v_status from public.tasks where id = v_task;
  if v_status <> 'CANCELLED' then
    raise exception 'FAIL: an open task should cancel, got %', v_status;
  end if;

  -- ---- somebody with no stake cannot cancel -----------------------------
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'guard', 100000, 240) returning id into v_task;

  perform pg_temp.become(v_worker);
  v_failed := false;
  begin
    perform public.cancel_task(v_task);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a non-participant cancelled a task';
  end if;

  -- ---- cancelling after the worker started pays them the 5% fine --------
  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 200000, 240) returning id into v_bid;

  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  perform pg_temp.become(v_poster);
  perform public.cancel_task(v_task);

  -- The worker is paid the post-start fine (settings.post_start_cancel_penalty_pct
  -- of the locked 200000) straight into their withdrawable balance (migration 079)...
  v_fine := round(200000 * private.setting_num('post_start_cancel_penalty_pct', 0.05))::bigint;
  select balance_minor into v_clear from public.wallets where user_id = v_worker;
  if v_clear <> v_fine then
    raise exception 'FAIL: the worker was paid %, expected the % fine', v_clear, v_fine;
  end if;

  -- ...and money is conserved: the poster gets back everything else.
  select balance_minor into v_clear from public.wallets where user_id = v_poster;
  if v_clear <> 5000000 - v_fine then
    raise exception 'FAIL: the poster''s wallet is %, expected % (everything but the fine)', v_clear, 5000000 - v_fine;
  end if;
  if (select penalty_or_refund_minor from public.cancellations_log where task_id = v_task and cancelled_by = 'poster') <> v_fine then
    raise exception 'FAIL: the cancellation log does not record the fine';
  end if;

  -- ---- a worker stepping off hands the task back to the market ----------
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'worker quits', 100000, 240) returning id into v_task;

  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;

  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  perform public.cancel_task(v_task);

  select status into v_status from public.tasks where id = v_task;
  if v_status <> 'OPEN' then
    raise exception 'FAIL: the task should return to OPEN, got %', v_status;
  end if;

  -- ---- submitted work is a dispute, not a cancellation ------------------
  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  -- Proof of work is required before a task can be marked done (migration 057).
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Finished the work exactly as agreed', '[]'::jsonb);
  perform public.mark_work_done(v_task);

  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    perform public.cancel_task(v_task);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: submitted work was cancelled';
  end if;

  raise notice 'ALL CANCEL RULE TESTS PASSED';
end;
$$;

rollback;
