-- 198 -- pg_cron job runner (plan task 3.5c, PR 1). No job moves in this migration.
--
-- Owner decision (9 Nov, confirmed 23 Nov "3.5c: use the recommendations"): background work is
-- hybrid. A job that is one SQL function on a timer, with no outside call, runs on Supabase
-- pg_cron; anything that calls an outside service or needs per-person retries stays on Inngest.
--
-- This adds the parts every pg_cron job runs through, so no job can fail silently:
--   * private.cron_jobs      the list of pg_cron jobs (how late a green run may be, money or not)
--   * private.job_runs       one row per run: ok, skipped or failed, with a short error
--   * private.run_cron_job   the one wrapper every pg_cron command calls
--   * private.cron_dispatch  the fixed list of what each job runs (later migrations replace it)
--   * private.report_job_failure   a team alert plus a `job.failed` event (Inngest tells Sentry)
--   * private.run_job_watchdog     pg_cron job `job-watchdog`, every 5 minutes: finds stopped jobs
--   * public.cron_health     service role only: Inngest's outbox-sweeper asks it, so the two watch
--                            each other (pg_cron's outbox-watchdog sees Inngest stuck, Inngest
--                            sees pg_cron stuck)
--
-- pg_cron runs each command as one transaction, the same as the single RPC Inngest made. A
-- direct database session carries no JWT claims, so private.assert_service_caller() lets it
-- through and the existing job functions need no change.
--
-- Events carry ids and fixed codes only (job name, SQLSTATE, run id, money), never message text.
-- Adds only; nothing is dropped or renamed. Undo: supabase/undo/198_cron_job_runner.down.sql.

-- ------------------------------------------------------------------ tables --

create table if not exists private.cron_jobs (
  job              text primary key,
  max_gap          interval,                 -- how late a green run may be before the job counts as stopped; null = not watched
  money            boolean not null default false,
  timeout          interval not null default interval '5 minutes',
  once_per_ist_day boolean not null default false,
  created_at       timestamptz not null default now()
);
alter table private.cron_jobs enable row level security;
revoke all on private.cron_jobs from public, anon, authenticated, service_role;
comment on table private.cron_jobs is
  'The pg_cron jobs that run through private.run_cron_job (plan 3.5c). Not readable by any API role.';

create table if not exists private.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null,
  started_at  timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status      text not null check (status in ('ok', 'skipped', 'failed')),
  result      jsonb,
  sqlstate    text,
  error       text check (error is null or length(error) <= 300)   -- left(SQLERRM, 300) only, never DETAIL
);
create index if not exists job_runs_job_started_idx on private.job_runs (job, started_at desc);
alter table private.job_runs enable row level security;
revoke all on private.job_runs from public, anon, authenticated, service_role;
comment on table private.job_runs is
  'One row per pg_cron run through private.run_cron_job: ok, skipped or failed (plan 3.5c). Kept 30 days.';

insert into private.cron_jobs (job, max_gap, money, timeout, once_per_ist_day) values
  ('job-watchdog',  interval '15 minutes', false, interval '1 minute', false),
  ('selftest-ok',   null,                  false, interval '1 minute', false),   -- tests only; never scheduled
  ('selftest-fail', null,                  false, interval '1 minute', false)    -- tests only; fails on purpose
on conflict (job) do nothing;

-- ------------------------------------------------------- failure report --

/**
 * A pg_cron job failed (SQLSTATE of the error), stopped (`STALE`) or died inside pg_cron
 * (`CRON`). Leaves a team alert and a `job.failed` event for Inngest's job-failure-report,
 * which tells Sentry (`fatal` for a money job, which emails the owner). Both at most once per
 * job per hour (a money job: every 15 minutes); a stopped job at most once per 6 hours, so a
 * long outage is a few messages, not hundreds. Returns whether it reported.
 */
create or replace function private.report_job_failure(p_job text, p_sqlstate text, p_run_id bigint default null)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_money  boolean;
  v_window interval;
  v_state  text := left(coalesce(p_sqlstate, 'XXXXX'), 10);
  v_job    text := left(p_job, 80);
begin
  select c.money into v_money from private.cron_jobs c where c.job = v_job;
  v_money := coalesce(v_money, false);
  v_window := case
                when v_state = 'STALE' then interval '6 hours'
                when v_money then interval '15 minutes'
                else interval '1 hour'
              end;

  if exists (select 1 from public.admin_alerts a
              where a.kind = 'job_failed'
                and a.data ->> 'job' = v_job
                and ((a.data ->> 'sqlstate') = 'STALE') = (v_state = 'STALE')
                and a.created_at > now() - v_window) then
    return false;
  end if;

  perform public.record_admin_alert(
    'job_failed',
    'Background job failed: ' || v_job,
    case v_state
      when 'STALE' then 'The database job "' || v_job || '" has not finished a run in time. It may have stopped.'
      when 'CRON'  then 'The database job "' || v_job || '" failed inside pg_cron itself (see cron.job_run_details).'
      else 'The database job "' || v_job || '" failed with code ' || v_state || '. Its work was rolled back; the next run tries again.'
    end
      || case when v_money then ' It is a money job.' else '' end,
    jsonb_build_object('job', v_job, 'sqlstate', v_state, 'run_id', p_run_id, 'money', v_money));

  perform private.emit_event('job.failed',
    jsonb_build_object('job', v_job, 'sqlstate', v_state, 'run_id', p_run_id, 'money', v_money));
  return true;
end;
$fn$;
revoke all on function private.report_job_failure(text, text, bigint) from public, anon, authenticated, service_role;

-- ------------------------------------------------------ stopped jobs --

/** Watched jobs whose last ok or skipped run is older than their max_gap (or none since they were added). */
create or replace function private.stopped_cron_jobs()
returns table (job text, money boolean, last_ok timestamptz)
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
  select c.job, c.money, l.last_ok
    from private.cron_jobs c
    left join lateral (
      select max(r.started_at) as last_ok
        from private.job_runs r
       where r.job = c.job and r.status in ('ok', 'skipped')
    ) l on true
   where c.max_gap is not null
     and coalesce(l.last_ok, c.created_at) < now() - c.max_gap
   order by c.job
$fn$;
revoke all on function private.stopped_cron_jobs() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------- the watchdog --

/**
 * pg_cron job `job-watchdog`, every 5 minutes (through the wrapper):
 *   * a watched job past its max_gap is reported as STALE;
 *   * a failed pg_cron run of one of our commands in the last 15 minutes (a run the wrapper could
 *     not record, for example a killed process) is reported as CRON;
 *   * once an hour, deletes job_runs older than 30 days and cron.job_run_details older than 7 days.
 */
create or replace function private.run_job_watchdog()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_job     text;
  v_stale   text[] := '{}';
  v_cron    text[] := '{}';
  v_pruned  integer := 0;
  v_details integer := 0;
begin
  for v_job in select s.job from private.stopped_cron_jobs() s loop
    perform private.report_job_failure(v_job, 'STALE', null);
    v_stale := v_stale || v_job;
  end loop;

  for v_job in
    select distinct substring(d.command from $re$run_cron_job\('([a-z0-9-]+)'\)$re$)
      from cron.job_run_details d
     where d.status = 'failed'
       and d.start_time > now() - interval '15 minutes'
       and d.command like '%private.run_cron_job(%'
  loop
    if v_job is not null then
      perform private.report_job_failure(v_job, 'CRON', null);
      v_cron := v_cron || v_job;
    end if;
  end loop;

  if extract(minute from now() at time zone 'UTC') < 5 then
    delete from private.job_runs where started_at < now() - interval '30 days';
    get diagnostics v_pruned = row_count;
    delete from cron.job_run_details where end_time < now() - interval '7 days';
    get diagnostics v_details = row_count;
  end if;

  return jsonb_build_object('stale', to_jsonb(v_stale), 'cron_failed', to_jsonb(v_cron),
                            'pruned_runs', v_pruned, 'pruned_cron_details', v_details);
end;
$fn$;
revoke all on function private.run_job_watchdog() from public, anon, authenticated, service_role;

-- ------------------------------------------------------------ dispatch --

/**
 * What each job runs: a fixed list, no dynamic SQL. Later migrations of plan 3.5c replace this
 * function to add the jobs they move; the wrapper below stays as it is.
 */
create or replace function private.cron_dispatch(p_job text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
begin
  case p_job
    when 'job-watchdog' then
      return private.run_job_watchdog();
    when 'selftest-ok' then
      return jsonb_build_object('ok', true);
    when 'selftest-fail' then
      -- Fails on purpose, with a long message, to prove failures are recorded, cut to 300 characters and reported.
      raise exception 'self-test failure on purpose: %', repeat('x', 400) using errcode = 'P0001';
    else
      raise exception 'cron job % has no case in private.cron_dispatch', p_job using errcode = '22023';
  end case;
end;
$fn$;
revoke all on function private.cron_dispatch(text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------- wrapper --

/**
 * Every pg_cron command is `set statement_timeout = ...; select private.run_cron_job('<job>')`.
 *   1. A job not in private.cron_jobs raises (pg_cron records the failure; the watchdog reports it).
 *   2. One run at a time (Inngest's concurrency: 1): a run that finds a slower one still going writes
 *      `skipped` (still running) and stops.
 *   3. A once-a-day job that already ran ok today (India date) writes `skipped` (done today), so a
 *      catch-up run an hour later is safe.
 *   4. lock_timeout 10 s, so a stuck run cannot hold locks for long.
 *   5. The job runs in a sub-transaction: on an error its half-done work is rolled back, a `failed`
 *      row is written with the SQLSTATE and at most 300 characters of the message, and the failure
 *      is reported. On success an `ok` row holds the job's result.
 */
create or replace function private.run_cron_job(p_job text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_cfg     private.cron_jobs%rowtype;
  v_started timestamptz := clock_timestamp();
  v_run     bigint;
  v_result  jsonb;
  v_state   text;
  v_msg     text;
begin
  select * into v_cfg from private.cron_jobs c where c.job = p_job;
  if not found then
    raise exception 'unknown cron job: %', left(p_job, 80) using errcode = '22023';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('cron:' || p_job, 0)) then
    insert into private.job_runs (job, started_at, finished_at, status, result)
    values (p_job, v_started, clock_timestamp(), 'skipped', '{"reason":"still running"}')
    returning id into v_run;
    return jsonb_build_object('run', v_run, 'status', 'skipped', 'reason', 'still running');
  end if;

  if v_cfg.once_per_ist_day and exists (
       select 1 from private.job_runs r
        where r.job = p_job and r.status = 'ok'
          and (r.started_at at time zone 'Asia/Kolkata')::date = (clock_timestamp() at time zone 'Asia/Kolkata')::date) then
    insert into private.job_runs (job, started_at, finished_at, status, result)
    values (p_job, v_started, clock_timestamp(), 'skipped', '{"reason":"done today"}')
    returning id into v_run;
    return jsonb_build_object('run', v_run, 'status', 'skipped', 'reason', 'done today');
  end if;

  perform set_config('lock_timeout', '10s', true);

  begin
    v_result := private.cron_dispatch(p_job);
    insert into private.job_runs (job, started_at, finished_at, status, result)
    values (p_job, v_started, clock_timestamp(), 'ok', v_result)
    returning id into v_run;
    return jsonb_build_object('run', v_run, 'status', 'ok');
  exception when others or query_canceled then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;

  -- Outside the rolled-back sub-transaction: record and report the failure.
  perform set_config('lock_timeout', '0', true);
  insert into private.job_runs (job, started_at, finished_at, status, sqlstate, error)
  values (p_job, v_started, clock_timestamp(), 'failed', v_state, left(v_msg, 300))
  returning id into v_run;
  perform private.report_job_failure(p_job, v_state, v_run);
  return jsonb_build_object('run', v_run, 'status', 'failed', 'sqlstate', v_state);
end;
$fn$;
revoke all on function private.run_cron_job(text) from public, anon, authenticated, service_role;

-- ------------------------------------------------- Inngest watches pg_cron --

/**
 * Called by Inngest's outbox-sweeper inside its existing "load unsent" step. Returns the stopped
 * jobs, whether any is a money job, and `report: true` at most once an hour (the time is kept in
 * the settings row `cron_health_reported_at`), so the sweeper tells Sentry if pg_cron itself
 * stopped. Service role only.
 */
create or replace function public.cron_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_stopped jsonb;
  v_money   boolean;
  v_last    timestamptz;
  v_report  boolean := false;
begin
  perform private.assert_service_caller();

  select coalesce(jsonb_agg(jsonb_build_object('job', s.job, 'money', s.money,
                                               'last_ok', s.last_ok) order by s.job), '[]'::jsonb),
         coalesce(bool_or(s.money), false)
    into v_stopped, v_money
    from private.stopped_cron_jobs() s;

  if jsonb_array_length(v_stopped) > 0 then
    select (st.value #>> '{}')::timestamptz into v_last
      from public.settings st where st.key = 'cron_health_reported_at';
    if v_last is null or v_last < now() - interval '1 hour' then
      insert into public.settings (key, value) values ('cron_health_reported_at', to_jsonb(now()))
      on conflict (key) do update set value = excluded.value;
      v_report := true;
    end if;
  end if;

  return jsonb_build_object('stopped', v_stopped, 'money', v_money, 'report', v_report);
end;
$fn$;
revoke all on function public.cron_health() from public, anon, authenticated;
grant execute on function public.cron_health() to service_role;

-- ---------------------------------------------------------------- schedule --

do $$
begin
  if exists (select 1 from cron.job where jobname = 'job-watchdog') then
    perform cron.unschedule('job-watchdog');
  end if;
  perform cron.schedule('job-watchdog', '*/5 * * * *',
    $c$set statement_timeout = '1min'; select private.run_cron_job('job-watchdog')$c$);
end $$;
