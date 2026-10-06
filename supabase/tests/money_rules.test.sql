-- Money and state-transition rules, asserted against the real RPCs.
--
-- These are the rules the client cannot be trusted with, so they are tested
-- where they are enforced. Everything runs inside one transaction that is
-- rolled back, so the test leaves no rows behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/money_rules.test.sql
-- or paste into the SQL editor. A failing assertion raises an exception.

begin;

-- Act as a given user for the RPCs, which all read auth.uid().
create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_admin() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_poster   uuid := gen_random_uuid();
  v_worker   uuid := gen_random_uuid();
  v_worker2  uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_task     uuid;
  v_bid      uuid;
  v_bid2     uuid;
  v_locked   bigint := 110000;   -- ₹1,100
  v_clearing bigint;
  v_balance  bigint;
  v_status   text;
  v_failed   boolean;
begin
  -- ---- fixtures ---------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'test+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_worker2), (v_stranger)) as u(id);

  insert into public.profiles (id, display_name)
  values (v_poster, 'Test Poster'), (v_worker, 'Test Worker'),
         (v_worker2, 'Test Worker 2'), (v_stranger, 'Test Stranger')
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_worker2), (v_stranger)
  on conflict (user_id) do nothing;

  -- lock_bid funds the task from the poster's wallet (migration 063), and a
  -- withdrawal needs a saved destination (migration 026).
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;
  insert into public.payout_destinations (user_id, kind, label, upi_id)
  values (v_worker, 'upi', 'UPI', 'worker.test@okaxis');

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Rules test task', 100000, 240)
  returning id into v_task;

  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, v_locked, 240) returning id into v_bid;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker2, v_locked, 240) returning id into v_bid2;

  -- ---- only the poster can lock a quote ---------------------------------
  perform pg_temp.become(v_stranger);
  v_failed := false;
  begin
    perform public.lock_bid(v_bid);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a stranger was allowed to lock a quote';
  end if;

  -- ---- poster locks ------------------------------------------------------
  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);

  -- ---- the task closes on the first lock --------------------------------
  v_failed := false;
  begin
    perform public.lock_bid(v_bid2);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a second quote was locked on a closed task';
  end if;

  select status into v_status from public.tasks where id = v_task;
  if v_status <> 'LOCKED' then
    raise exception 'FAIL: task should be LOCKED, got %', v_status;
  end if;

  -- ---- only the assigned worker may start -------------------------------
  perform pg_temp.become(v_worker2);
  v_failed := false;
  begin
    perform public.start_task(v_task);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: an unassigned worker started the task';
  end if;

  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);

  -- ---- starting twice is refused ----------------------------------------
  v_failed := false;
  begin
    perform public.start_task(v_task);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: an already-started task was started again';
  end if;

  -- ---- a non-participant cannot mark the work done ----------------------
  perform pg_temp.become(v_stranger);
  v_failed := false;
  begin
    perform public.mark_work_done(v_task);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a stranger marked the work done';
  end if;

  perform pg_temp.become(v_worker);
  -- Proof of work is required before a task can be marked done (migration 057).
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Finished the work exactly as agreed', '[]'::jsonb);
  perform public.mark_work_done(v_task);

  -- ---- only the poster releases -----------------------------------------
  perform pg_temp.become(v_worker);
  v_failed := false;
  begin
    perform public.confirm_release(v_task);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: the worker released their own escrow';
  end if;

  perform pg_temp.become(v_poster);
  perform public.confirm_release(v_task);

  -- ---- the commission split is exact ------------------------------------
  select clearing_minor into v_clearing from public.wallets where user_id = v_worker;
  -- The commission is a live setting (worker_commission_pct), not a constant.
  if v_clearing <> round(v_locked * (1 - private.setting_num('worker_commission_pct', 0.20)))::bigint then
    raise exception 'FAIL: worker cleared %, expected the locked amount % less the worker commission',
      v_clearing, v_locked;
  end if;

  -- ---- a stranger cannot review -----------------------------------------
  perform pg_temp.become(v_stranger);
  v_failed := false;
  begin
    perform public.submit_review(v_task, 5::smallint, 'not my task');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a stranger reviewed a task they were not part of';
  end if;

  -- ---- a review updates the subject's average ---------------------------
  perform pg_temp.become(v_poster);
  perform public.submit_review(v_task, 4::smallint, 'good work');
  if (select worker_rating_avg from public.profiles where id = v_worker) <> 4.00 then
    raise exception 'FAIL: worker rating average was not recomputed';
  end if;

  -- ---- withdrawals cannot overdraw --------------------------------------
  -- RLS (correctly) refuses a cross-user wallet write, so the fixture top-up
  -- has to drop back to the owning role first.
  perform pg_temp.as_admin();
  update public.wallets set balance_minor = 50000 where user_id = v_worker;
  perform pg_temp.become(v_worker);

  v_failed := false;
  begin
    perform public.request_withdrawal(50001::bigint, 'test@upi');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a withdrawal was allowed to overdraw the wallet';
  end if;

  perform public.request_withdrawal(20000::bigint, 'test@upi');
  select balance_minor into v_balance from public.wallets where user_id = v_worker;
  if v_balance <> 30000 then
    raise exception 'FAIL: balance after withdrawal is %, expected 30000', v_balance;
  end if;

  raise notice 'ALL MONEY RULE TESTS PASSED';
end;
$$;

rollback;
