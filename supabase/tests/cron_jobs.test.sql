-- Plan task 3.5c: the pg_cron job runner (migration 198 onward).
--
-- What is asserted:
--   1. An unknown job raises.
--   2. A failing job (selftest-fail) leaves one `failed` run row with its SQLSTATE and at most 300
--      characters of message, one `job_failed` team alert and one `job.failed` outbox row whose data
--      holds only job, sqlstate, run_id and money.
--   3. A second failure within the hour adds a run row but no second alert or event.
--   4. The wrapper takes a non-blocking advisory lock (one test session cannot open a second one,
--      so the source is checked).
--   5. A watched job past its max_gap is reported once as STALE by the watchdog; cron_health lists
--      it and says `report` once, then not again within the hour.
--   6. A once-a-day job run twice on one India date: ok, then skipped.
--   7. job-watchdog runs green through the wrapper and is scheduled every 5 minutes.
--   8. The private functions are closed to anon, authenticated and service_role; cron_health is
--      closed to anon and authenticated and open to service_role.
--   9. Every scheduled pg_cron job of ours calls the wrapper with a statement_timeout, and every
--      job it names is listed in private.cron_jobs and has a case in private.cron_dispatch.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/cron_jobs.test.sql

begin;

-- ---- 1. unknown job -----------------------------------------------------------
do $$
begin
  begin
    perform private.run_cron_job('no-such-job');
    raise exception 'FAIL: an unknown job did not raise';
  exception when sqlstate '22023' then
    null;
  end;
end $$;

-- ---- 2 + 3. a failing job -------------------------------------------------------
do $$
declare
  v_out    jsonb;
  v_row    private.job_runs%rowtype;
  v_keys   text[];
  v_alerts integer;
  v_events integer;
begin
  delete from public.admin_alerts where kind = 'job_failed';
  delete from private.outbox where kind = 'job.failed';

  v_out := private.run_cron_job('selftest-fail');
  if v_out ->> 'status' <> 'failed' then
    raise exception 'FAIL: selftest-fail did not report failed: %', v_out;
  end if;

  select * into v_row from private.job_runs where id = (v_out ->> 'run')::bigint;
  if v_row.status <> 'failed' or v_row.sqlstate <> 'P0001' then
    raise exception 'FAIL: the failed run row is wrong: % %', v_row.status, v_row.sqlstate;
  end if;
  if length(v_row.error) > 300 or length(v_row.error) < 30 then
    raise exception 'FAIL: the error text is not cut to 300 characters: %', length(v_row.error);
  end if;

  select count(*) into v_alerts from public.admin_alerts where kind = 'job_failed' and data ->> 'job' = 'selftest-fail';
  if v_alerts <> 1 then
    raise exception 'FAIL: expected one job_failed alert, found %', v_alerts;
  end if;

  select count(*) into v_events from private.outbox where kind = 'job.failed' and data ->> 'job' = 'selftest-fail';
  if v_events <> 1 then
    raise exception 'FAIL: expected one job.failed event, found %', v_events;
  end if;
  select array_agg(k order by k) into v_keys
    from private.outbox o, jsonb_object_keys(o.data) k
   where o.kind = 'job.failed' and o.data ->> 'job' = 'selftest-fail';
  if v_keys is distinct from array['job', 'money', 'run_id', 'sqlstate'] then
    raise exception 'FAIL: the job.failed event carries more than ids and codes: %', v_keys;
  end if;
  if (select data -> 'money' from private.outbox where kind = 'job.failed' limit 1) <> 'false'::jsonb then
    raise exception 'FAIL: a non-money job was marked money';
  end if;

  -- 3. A second failure within the hour: one more run row, no second alert or event.
  perform private.run_cron_job('selftest-fail');
  if (select count(*) from private.job_runs where job = 'selftest-fail' and status = 'failed') < 2 then
    raise exception 'FAIL: the second failure left no run row';
  end if;
  if (select count(*) from public.admin_alerts where kind = 'job_failed' and data ->> 'job' = 'selftest-fail') <> 1 then
    raise exception 'FAIL: a second failure within the hour added another alert';
  end if;
  if (select count(*) from private.outbox where kind = 'job.failed' and data ->> 'job' = 'selftest-fail') <> 1 then
    raise exception 'FAIL: a second failure within the hour added another event';
  end if;
end $$;

-- ---- 4. one run at a time ---------------------------------------------------------
do $$
begin
  if pg_get_functiondef('private.run_cron_job(text)'::regprocedure) not like '%pg_try_advisory_xact_lock%' then
    raise exception 'FAIL: run_cron_job does not take a non-blocking advisory lock';
  end if;
end $$;

-- ---- 5. a stopped job ---------------------------------------------------------------
do $$
declare
  v_health jsonb;
begin
  delete from public.admin_alerts where kind = 'job_failed';
  delete from public.settings where key = 'cron_health_reported_at';
  update private.cron_jobs set max_gap = interval '5 minutes', created_at = now() - interval '1 day'
   where job = 'selftest-ok';
  delete from private.job_runs where job = 'selftest-ok';

  perform private.run_job_watchdog();
  if (select count(*) from public.admin_alerts
       where kind = 'job_failed' and data ->> 'job' = 'selftest-ok' and data ->> 'sqlstate' = 'STALE') <> 1 then
    raise exception 'FAIL: a job past its max_gap was not reported once as STALE';
  end if;
  perform private.run_job_watchdog();
  if (select count(*) from public.admin_alerts where kind = 'job_failed' and data ->> 'job' = 'selftest-ok') <> 1 then
    raise exception 'FAIL: a stopped job was reported twice within 6 hours';
  end if;

  v_health := public.cron_health();
  if not (v_health -> 'stopped') @> '[{"job":"selftest-ok"}]'::jsonb or (v_health ->> 'report')::boolean is not true then
    raise exception 'FAIL: cron_health did not list the stopped job with report=true: %', v_health;
  end if;
  v_health := public.cron_health();
  if (v_health ->> 'report')::boolean then
    raise exception 'FAIL: cron_health said report twice within the hour';
  end if;

  -- A green run makes it fresh again.
  perform private.run_cron_job('selftest-ok');
  if exists (select 1 from private.stopped_cron_jobs() where job = 'selftest-ok') then
    raise exception 'FAIL: a job with a fresh ok run still counts as stopped';
  end if;
  update private.cron_jobs set max_gap = null where job = 'selftest-ok';
end $$;

-- ---- 6. once a day ----------------------------------------------------------------------
do $$
declare
  v_first  jsonb;
  v_second jsonb;
begin
  update private.cron_jobs set once_per_ist_day = true where job = 'selftest-ok';
  delete from private.job_runs where job = 'selftest-ok';
  v_first := private.run_cron_job('selftest-ok');
  v_second := private.run_cron_job('selftest-ok');
  if v_first ->> 'status' <> 'ok' or v_second ->> 'status' <> 'skipped' or v_second ->> 'reason' <> 'done today' then
    raise exception 'FAIL: a once-a-day job ran twice: % then %', v_first, v_second;
  end if;
  update private.cron_jobs set once_per_ist_day = false where job = 'selftest-ok';
end $$;

-- ---- 7. the watchdog itself -------------------------------------------------------------
do $$
declare
  v_out jsonb;
begin
  v_out := private.run_cron_job('job-watchdog');
  if v_out ->> 'status' <> 'ok' then
    raise exception 'FAIL: job-watchdog did not run green: %', v_out;
  end if;
  if not exists (select 1 from cron.job
                  where jobname = 'job-watchdog' and schedule = '*/5 * * * *'
                    and command like '%select private.run_cron_job(''job-watchdog'')%') then
    raise exception 'FAIL: job-watchdog is not scheduled every 5 minutes through the wrapper';
  end if;
end $$;

-- ---- 8. who may call what ---------------------------------------------------------------
do $$
declare
  v_fn   text;
  v_role text;
begin
  foreach v_fn in array array[
    'private.run_cron_job(text)', 'private.cron_dispatch(text)', 'private.run_job_watchdog()',
    'private.report_job_failure(text,text,bigint)', 'private.stopped_cron_jobs()'] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception 'FAIL: % can execute %', v_role, v_fn;
      end if;
    end loop;
  end loop;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.cron_health()', 'execute') then
      raise exception 'FAIL: % can execute cron_health', v_role;
    end if;
    if has_table_privilege(v_role, 'private.job_runs', 'select') or has_table_privilege(v_role, 'private.cron_jobs', 'select') then
      raise exception 'FAIL: % can read the job tables', v_role;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.cron_health()', 'execute') then
    raise exception 'FAIL: service_role cannot execute cron_health';
  end if;
end $$;

-- ---- 9. every scheduled job goes through the wrapper -------------------------------------
do $$
declare
  v_cmd text;
  v_job text;
begin
  for v_cmd in select command from cron.job where command like '%run_cron_job%' loop
    if v_cmd !~ $re$^set statement_timeout = '[0-9]+min'; select private\.run_cron_job\('[a-z0-9-]+'\)$$re$ then
      raise exception 'FAIL: a pg_cron command does not have the wrapper shape: %', v_cmd;
    end if;
    v_job := substring(v_cmd from $re$run_cron_job\('([a-z0-9-]+)'\)$re$);
    if not exists (select 1 from private.cron_jobs where job = v_job) then
      raise exception 'FAIL: scheduled job % is not in private.cron_jobs', v_job;
    end if;
    if pg_get_functiondef('private.cron_dispatch(text)'::regprocedure) not like '%''' || v_job || '''%' then
      raise exception 'FAIL: scheduled job % has no case in cron_dispatch', v_job;
    end if;
  end loop;
end $$;

rollback;
