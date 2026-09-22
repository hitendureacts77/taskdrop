-- Who may call what. Asserted against the real grants and the real RPCs.
--
-- Migration 047 closed a hole: settle_cleared_earnings() is SECURITY DEFINER,
-- checks nothing at all, and authenticated held EXECUTE on it, so any signed-in
-- user could drive a row-locking write across every task in the table. These
-- assertions fail against 046 and pass against 047.
--
-- Everything runs inside one transaction that is rolled back, so the test
-- leaves no rows behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rpc_surface.test.sql

begin;

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

-- ---- 1. grant posture ------------------------------------------------------
-- These are plain catalog reads, so they run before any fixture exists.
do $$
declare
  fn      text;
  granted boolean;
  -- Every function the client, the edge functions or scripts/payouts.mjs
  -- actually calls. If one of these loses its grant, the app breaks.
  must_be_callable text[] := array[
    'activate_promotion', 'cancel_promotion', 'cancel_task', 'cancel_withdrawal',
    'confirm_release', 'lock_bid', 'mark_work_done', 'my_stats', 'open_dispute',
    'platform_stats', 'request_revision', 'request_withdrawal',
    'set_default_payout_destination', 'start_promotion', 'start_task',
    'submit_review', 'settle_my_cleared_earnings', 'ad_auction',
    'record_ad_impression', 'record_ad_click', 'my_campaign_stats',
    'escrow_refund_due', 'admin_payout_queue', 'admin_mark_payout',
    'admin_resolve_dispute', 'admin_set_admin', 'platform_earnings'
  ];
  -- Service role only. A grant here is the hole 047 closed.
  must_not_be_callable text[] := array[
    'settle_cleared_earnings', 'settle_finished_campaigns',
    'fund_task_from_payment', 'record_escrow_refund',
    'set_app_secret', 'app_secrets'
  ];
begin
  foreach fn in array must_be_callable loop
    select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      into granted
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    if granted is null then
      raise exception 'FAIL: public.%() does not exist -- has it been renamed?', fn;
    end if;
    if not granted then
      raise exception 'FAIL: authenticated cannot execute public.%(), which the app calls', fn;
    end if;
  end loop;

  foreach fn in array must_not_be_callable loop
    select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      into granted
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;

    if granted then
      raise exception 'FAIL: authenticated can execute public.%(), which is service-role only', fn;
    end if;
  end loop;
end;
$$;

-- ---- 2. the SECURITY DEFINER view is gone ----------------------------------
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'sponsored_tasks' and c.relkind = 'v'
  ) then
    raise exception 'FAIL: the sponsored_tasks SECURITY DEFINER view is back';
  end if;
end;
$$;

-- ---- 3. the scoped sweep settles the caller and nobody else ----------------
do $$
declare
  v_poster   uuid := gen_random_uuid();
  v_worker   uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid();
  v_task     uuid;
  v_task2    uuid;
  v_bid      uuid;
  v_bid2     uuid;
  v_locked   bigint := 110000;   -- ₹1,100
  v_net      bigint := 88000;    -- 80% of the above
  v_escrow   bigint;
  v_escrow2  bigint;
  v_pay      uuid;
  v_pay2     uuid;
  v_swept    integer;
  v_balance  bigint;
  v_clearing bigint;
  v_failed   boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'test+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_other)) as u(id);

  insert into public.profiles (id, display_name)
  values (v_poster, 'Sweep Poster'), (v_worker, 'Sweep Worker'), (v_other, 'Other Worker')
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_other)
  on conflict (user_id) do nothing;

  -- Two tasks, one per worker, driven all the way to COMPLETED through the
  -- real RPCs so the clearing balances are real rather than hand-written.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Sweep test A', 100000, 240) returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Sweep test B', 100000, 240) returning id into v_task2;

  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, v_locked, 240) returning id into v_bid;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task2, v_other, v_locked, 240) returning id into v_bid2;

  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);
  perform public.lock_bid(v_bid2);

  -- Locking a quote is not paying for it (migration 028). Both tasks have to
  -- be funded by a settled payment before any work can start.
  select escrow_minor into v_escrow  from public.assignments where task_id = v_task;
  select escrow_minor into v_escrow2 from public.assignments where task_id = v_task2;

  perform pg_temp.as_admin();
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task,  'escrow', v_escrow,  'plink_sweep_a', 'paid', now())
  returning id into v_pay;
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task2, 'escrow', v_escrow2, 'plink_sweep_b', 'paid', now())
  returning id into v_pay2;

  perform pg_temp.become(v_poster);
  perform public.fund_task(v_task,  v_pay);
  perform public.fund_task(v_task2, v_pay2);

  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  perform public.mark_work_done(v_task);

  perform pg_temp.become(v_other);
  perform public.start_task(v_task2);
  perform public.mark_work_done(v_task2);

  perform pg_temp.become(v_poster);
  perform public.confirm_release(v_task);
  perform public.confirm_release(v_task2);

  -- Both are now sitting in clearing. Backdate so both are genuinely due.
  perform pg_temp.as_admin();
  update public.tasks set clear_at = now() - interval '1 day'
   where id in (v_task, v_task2);

  -- ---- the unscoped sweep is unreachable from a session --------------------
  perform pg_temp.become(v_worker);
  v_failed := false;
  begin
    perform public.settle_cleared_earnings();
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a signed-in user swept every worker''s earnings';
  end if;

  -- ---- the scoped sweep settles exactly one task, the caller's ------------
  v_swept := public.settle_my_cleared_earnings();
  if v_swept <> 1 then
    raise exception 'FAIL: scoped sweep touched % tasks, expected 1 (the caller''s)', v_swept;
  end if;

  select balance_minor, clearing_minor into v_balance, v_clearing
    from public.wallets where user_id = v_worker;
  if v_balance <> v_net then
    raise exception 'FAIL: caller balance is %, expected %', v_balance, v_net;
  end if;
  if v_clearing <> 0 then
    raise exception 'FAIL: caller still holds % in clearing', v_clearing;
  end if;

  -- ---- the other worker was not touched -----------------------------------
  select balance_minor, clearing_minor into v_balance, v_clearing
    from public.wallets where user_id = v_other;
  if v_balance <> 0 then
    raise exception 'FAIL: a stranger''s balance moved to % during the caller''s sweep', v_balance;
  end if;
  if v_clearing <> v_net then
    raise exception 'FAIL: a stranger''s clearing is %, expected % (untouched)', v_clearing, v_net;
  end if;

  -- ---- and it is idempotent ----------------------------------------------
  v_swept := public.settle_my_cleared_earnings();
  if v_swept <> 0 then
    raise exception 'FAIL: re-running the scoped sweep settled % tasks again', v_swept;
  end if;

  -- ---- signed out, it refuses --------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'authenticated', true);
  v_failed := false;
  begin
    perform public.settle_my_cleared_earnings();
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: the scoped sweep ran without a signed-in caller';
  end if;

  perform pg_temp.as_admin();
  raise notice 'rpc_surface: all assertions passed';
end;
$$;

rollback;
