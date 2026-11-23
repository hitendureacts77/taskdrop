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
    if v_cmd !~ $re$^set statement_timeout = '[0-9]+min'; select private\.run_cron_job\('[a-z0-9-]+'\)\Z$re$ then
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

-- ---- 10. the moved jobs: each runs green through the wrapper and is scheduled as planned ----------
do $$
declare
  r     record;
  v_out jsonb;
begin
  for r in
    select * from (values
      -- PR 2 (migration 199)
      ('housekeeping',             'housekeeping',     '17 * * * *'),
      ('outbox-prune',             'outbox-prune',     '45 22 * * *'),
      ('outbox-prune-catchup',     'outbox-prune',     '45 23 * * *'),
      ('user-sync-repair',         'user-sync-repair', '40 21 * * *'),
      ('user-sync-repair-catchup', 'user-sync-repair', '40 22 * * *'),
      ('crm-rules',                'crm-rules',        '0 */3 * * *'),
      ('overdue-tasks',            'overdue-tasks',    '1-59/10 * * * *'),
      -- PR 3 (migration 200)
      ('task-reminders',           'task-reminders',    '2-59/15 * * * *'),
      ('sms-pumping-watch',        'sms-pumping-watch', '8-59/15 * * * *'),
      ('daily-digest',             'daily-digest',      '30 3 * * *'),
      ('daily-digest-catchup',     'daily-digest',      '30 4 * * *'),
      ('public-snapshots',         'public-snapshots',  '3-59/10 * * * *'),
      -- PR 4 (migration 201)
      ('outbox-watchdog',          'outbox-watchdog',   '5-59/10 * * * *')
    ) as t(jobname, job, schedule)
  loop
    if not exists (select 1 from cron.job
                    where jobname = r.jobname and schedule = r.schedule and active
                      and command like '%select private.run_cron_job(''' || r.job || ''')') then
      raise exception 'FAIL: pg_cron job % is not scheduled at % through the wrapper', r.jobname, r.schedule;
    end if;
  end loop;

  for r in select unnest(array['housekeeping', 'outbox-prune', 'user-sync-repair', 'crm-rules', 'overdue-tasks',
                                   'task-reminders', 'sms-pumping-watch', 'public-snapshots', 'outbox-watchdog']) as job loop
    delete from private.job_runs where job = r.job;
    v_out := private.run_cron_job(r.job);
    if v_out ->> 'status' <> 'ok' then
      raise exception 'FAIL: % did not run green through the wrapper: % (%)', r.job, v_out,
        (select error from private.job_runs where id = (v_out ->> 'run')::bigint);
    end if;
  end loop;
end $$;

-- ---- 11. the daily digest: the same words as the old Inngest job, once a day --------------------
do $$
declare
  v_alert jsonb;
  v_out   jsonb;
begin
  -- The fixed input and expected text of the old digestAlert test (supabase/functions/inngest/jobs.test.ts).
  v_alert := private.digest_alert(jsonb_build_object(
    'date', '2026-10-12', 'people_total', 40, 'new_people', 3, 'jobs_posted', 7, 'jobs_finished', 5,
    'earned_rupees', 1234.5, 'withdrawals_waiting', 2, 'withdrawals_waiting_rupees', 800,
    'open_disputes', 1, 'open_help_requests', 4));
  if v_alert ->> 'kind' <> 'digest' or v_alert ->> 'title' <> 'Daily digest, 2026-10-12' then
    raise exception 'FAIL: digest kind or title changed: %', v_alert;
  end if;
  if v_alert ->> 'body' <> E'3 new people (40 in all)\n7 jobs posted, 5 finished\nTaskDrop earned ₹1,234.5\n2 withdrawals waiting (₹800)\n1 open disputes, 4 open help requests' then
    raise exception 'FAIL: digest words changed: %', v_alert ->> 'body';
  end if;
  if private.digest_alert('{}'::jsonb) ->> 'title' <> 'Daily digest, today' then
    raise exception 'FAIL: a digest with no date does not say today';
  end if;
  if private.inr(1234567.891) <> '₹12,34,567.89' or private.inr(0) <> '₹0' or private.inr(999) <> '₹999'
     or private.inr(1000) <> '₹1,000' or private.inr(null) <> '₹0' then
    raise exception 'FAIL: rupees are not written the Indian way: % % % %', private.inr(1234567.891), private.inr(0), private.inr(999), private.inr(1000);
  end if;

  delete from public.admin_alerts where kind = 'digest';
  delete from private.job_runs where job = 'daily-digest';
  v_out := private.run_cron_job('daily-digest');
  if v_out ->> 'status' <> 'ok' then
    raise exception 'FAIL: the digest did not run green: %', v_out;
  end if;
  v_out := private.run_cron_job('daily-digest');   -- the catch-up an hour later
  if v_out ->> 'status' <> 'skipped' then
    raise exception 'FAIL: the digest catch-up ran a second time: %', v_out;
  end if;
  if (select count(*) from public.admin_alerts where kind = 'digest') <> 1 then
    raise exception 'FAIL: expected one digest alert';
  end if;
end $$;

-- ---- 12. the public lists' age check --------------------------------------------------------------
do $$
declare
  v_out jsonb;
  v_marker timestamptz;
begin
  delete from public.admin_alerts where kind in ('public_snapshots_stale', 'job_failed');

  -- 40 minutes old: one stale alert and one failure report.
  insert into public.settings (key, value) values ('public_snapshots_last_ok', to_jsonb(now() - interval '40 minutes'))
  on conflict (key) do update set value = excluded.value;
  v_out := private.run_public_snapshots();
  if (select count(*) from public.admin_alerts where kind = 'public_snapshots_stale') <> 1 then
    raise exception 'FAIL: a 40-minute-old copy did not leave one stale alert';
  end if;
  if (select count(*) from public.admin_alerts where kind = 'job_failed' and data ->> 'job' = 'public-snapshots') <> 1 then
    raise exception 'FAIL: a 40-minute-old copy was not reported';
  end if;
  -- The refresh moved the marker.
  select (value #>> '{}')::timestamptz into v_marker from public.settings where key = 'public_snapshots_last_ok';
  if v_marker < now() - interval '1 minute' then
    raise exception 'FAIL: a finished refresh did not move the marker';
  end if;

  -- 50 minutes old: a report, but no new stale alert.
  delete from public.admin_alerts where kind = 'job_failed';
  update public.settings set value = to_jsonb(now() - interval '50 minutes') where key = 'public_snapshots_last_ok';
  v_out := private.run_public_snapshots();
  if (select count(*) from public.admin_alerts where kind = 'public_snapshots_stale') <> 1 then
    raise exception 'FAIL: a 50-minute-old copy left another stale alert';
  end if;
  if (select count(*) from public.admin_alerts where kind = 'job_failed' and data ->> 'job' = 'public-snapshots') <> 1 then
    raise exception 'FAIL: a 50-minute-old copy was not reported';
  end if;

  -- Not a time: treated as never recorded, no alert.
  delete from public.admin_alerts where kind in ('public_snapshots_stale', 'job_failed');
  update public.settings set value = '"not a time"'::jsonb where key = 'public_snapshots_last_ok';
  perform private.run_public_snapshots();
  if exists (select 1 from public.admin_alerts where kind in ('public_snapshots_stale', 'job_failed')) then
    raise exception 'FAIL: an unreadable marker raised an alert';
  end if;
end $$;

-- ---- 13. the outbox watchdog (25 minutes) and the nightly money check heartbeat --------------------
do $$
declare
  v_out jsonb;
begin
  delete from private.outbox where sent_at is null;
  delete from public.admin_alerts where kind in ('outbox_stuck', 'job_failed');

  -- 20 minutes unsent: not stuck yet under the 25-minute rule.
  insert into private.outbox (kind, data, created_at) values ('test.young', '{}'::jsonb, now() - interval '20 minutes');
  v_out := private.run_cron_job('outbox-watchdog');
  if v_out ->> 'status' <> 'ok' or exists (select 1 from public.admin_alerts where kind = 'outbox_stuck') then
    raise exception 'FAIL: a 20-minute-old event was called stuck: %', v_out;
  end if;

  -- 30 minutes unsent: one alert, and a second run stays quiet.
  insert into private.outbox (kind, data, created_at) values ('test.old', '{}'::jsonb, now() - interval '30 minutes');
  perform private.run_cron_job('outbox-watchdog');
  perform private.run_cron_job('outbox-watchdog');
  if (select count(*) from public.admin_alerts where kind = 'outbox_stuck') <> 1 then
    raise exception 'FAIL: a 30-minute-old event did not leave exactly one alert';
  end if;

  -- No reconciliation_runs row in 26 hours: nightly-reconcile is reported once.
  delete from public.reconciliation_runs;
  perform private.run_job_watchdog();
  perform private.run_job_watchdog();
  if (select count(*) from public.admin_alerts
       where kind = 'job_failed' and data ->> 'job' = 'nightly-reconcile' and data ->> 'sqlstate' = 'STALE') <> 1 then
    raise exception 'FAIL: a missing nightly money check was not reported exactly once';
  end if;

  -- A recent row: quiet.
  delete from public.admin_alerts where kind = 'job_failed';
  insert into public.reconciliation_runs (kind, from_day, to_day) values ('internal', current_date - 3, current_date);
  v_out := private.run_job_watchdog();
  if (v_out ->> 'reconcile_ran')::boolean is not true
     or exists (select 1 from public.admin_alerts where kind = 'job_failed' and data ->> 'job' = 'nightly-reconcile') then
    raise exception 'FAIL: a recent money check was reported as missing: %', v_out;
  end if;
end $$;

rollback;
