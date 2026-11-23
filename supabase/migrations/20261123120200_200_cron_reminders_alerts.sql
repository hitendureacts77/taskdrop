-- 200 -- plan task 3.5c, PR 3: reminders, alerts and the public lists move from Inngest to pg_cron.
--
--   task-reminders     run_task_reminders()       every 15 min at :02   (was Inngest, every 30 min)
--   sms-pumping-watch  run_sms_pumping_watch()    every 15 min at :08   (was Inngest, hourly)
--   daily-digest       private.run_daily_digest() 09:00 IST, catch-up 10:00 (was Inngest, 09:00 IST)
--   public-snapshots   private.run_public_snapshots() every 10 min at :03 (was Inngest, every 20 min)
--
-- The digest's words move into SQL (private.digest_alert, the same title and five lines as
-- digestAlert in the old jobs.ts, with the same Indian rupee format). The public lists' age check
-- moves into SQL (the same rule as checkSnapshotFreshness: a kept copy older than 30 minutes is a
-- failure report; a `public_snapshots_stale` team alert only while it is 45 minutes old or less).
-- All four are safe to run twice (their own locks and once-only guards; the digest is once a day
-- through the wrapper). Adds only. Undo: supabase/undo/200_cron_reminders_alerts.down.sql.

-- ---- rupees, the way the app writes them (en-IN grouping, at most 2 decimals) --------------------
create or replace function private.inr(p_amount numeric)
returns text
language plpgsql
immutable
set search_path to 'pg_temp'
as $fn$
declare
  v_abs  numeric := round(abs(coalesce(p_amount, 0)), 2);
  v_int  text;
  v_frac text;
  v_head text;
begin
  v_int  := split_part(v_abs::text, '.', 1);
  v_frac := rtrim(split_part(v_abs::text, '.', 2), '0');
  if length(v_int) > 3 then
    v_head := left(v_int, length(v_int) - 3);
    v_head := regexp_replace(v_head, '(\d)(?=(\d\d)+$)', '\1,', 'g');
    v_int  := v_head || ',' || right(v_int, 3);
  end if;
  return '₹' || case when coalesce(p_amount, 0) < 0 and v_abs > 0 then '-' else '' end
              || v_int || case when v_frac <> '' then '.' || v_frac else '' end;
end;
$fn$;
revoke all on function private.inr(numeric) from public, anon, authenticated, service_role;

-- ---- the daily digest -------------------------------------------------------------------------
/** The title and five lines of the old digestAlert (jobs.ts), from the totals of daily_digest(). */
create or replace function private.digest_alert(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'private', 'pg_temp'
as $fn$
declare
  v_date text := nullif(btrim(coalesce(p ->> 'date', '')), '');
begin
  return jsonb_build_object(
    'kind',  'digest',
    'title', 'Daily digest, ' || coalesce(v_date, 'today'),
    'body',  concat_ws(E'\n',
      coalesce((p ->> 'new_people')::numeric, 0) || ' new people (' || coalesce((p ->> 'people_total')::numeric, 0) || ' in all)',
      coalesce((p ->> 'jobs_posted')::numeric, 0) || ' jobs posted, ' || coalesce((p ->> 'jobs_finished')::numeric, 0) || ' finished',
      'TaskDrop earned ' || private.inr((p ->> 'earned_rupees')::numeric),
      coalesce((p ->> 'withdrawals_waiting')::numeric, 0) || ' withdrawals waiting (' || private.inr((p ->> 'withdrawals_waiting_rupees')::numeric) || ')',
      coalesce((p ->> 'open_disputes')::numeric, 0) || ' open disputes, ' || coalesce((p ->> 'open_help_requests')::numeric, 0) || ' open help requests'));
end;
$fn$;
revoke all on function private.digest_alert(jsonb) from public, anon, authenticated, service_role;

create or replace function private.run_daily_digest()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_totals jsonb := public.daily_digest();
  v_alert  jsonb := private.digest_alert(v_totals);
  v_id     uuid;
begin
  v_id := public.record_admin_alert(v_alert ->> 'kind', v_alert ->> 'title', v_alert ->> 'body', v_totals);
  return jsonb_build_object('alert', v_id);
end;
$fn$;
revoke all on function private.run_daily_digest() from public, anon, authenticated, service_role;

-- ---- the public lists ----------------------------------------------------------------------------
/**
 * Age check, then refresh (plan 3.5b layer C). The time of the last finished refresh is kept in the
 * settings row public_snapshots_last_ok. Older than 30 minutes: a failure report (team + Sentry,
 * throttled), and a public_snapshots_stale team alert only while 45 minutes or less, so a long
 * outage rings the bell once or twice. Nothing recorded yet is not an alert. Another refresh
 * already running counts as success and does not move the marker.
 */
create or replace function private.run_public_snapshots()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_last    timestamptz;
  v_age     numeric;
  v_refresh jsonb;
begin
  begin
    select (s.value #>> '{}')::timestamptz into v_last from public.settings s where s.key = 'public_snapshots_last_ok';
  exception when others then
    v_last := null;   -- not a time: treated as never recorded
  end;

  if v_last is not null then
    v_age := greatest(0, extract(epoch from clock_timestamp() - v_last) / 60);
    if v_age > 30 then
      perform private.report_job_failure('public-snapshots', 'STALE', null);
      if v_age <= 45 then
        perform public.record_admin_alert(
          'public_snapshots_stale',
          'Kept copies of the public lists are out of date',
          'The last refresh finished ' || floor(v_age) || ' minutes ago (the app falls back to live answers after 30). Check the public-snapshots job (private.job_runs).',
          jsonb_build_object('age_minutes', floor(v_age)));
      end if;
    end if;
  end if;

  v_refresh := private.refresh_public_snapshots();
  if coalesce((v_refresh ->> 'skipped')::boolean, false) is false then
    insert into public.settings (key, value) values ('public_snapshots_last_ok', to_jsonb(clock_timestamp()))
    on conflict (key) do update set value = excluded.value;
  end if;

  return jsonb_build_object('skipped', coalesce((v_refresh ->> 'skipped')::boolean, false),
                            'took_ms', v_refresh -> 'took_ms',
                            'age_before_minutes', floor(v_age));
end;
$fn$;
revoke all on function private.run_public_snapshots() from public, anon, authenticated, service_role;

-- ---- the list of pg_cron jobs --------------------------------------------------------------------
insert into private.cron_jobs (job, max_gap, money, timeout, once_per_ist_day) values
  ('task-reminders',    interval '45 minutes', false, interval '2 minutes', false),
  ('sms-pumping-watch', interval '45 minutes', false, interval '2 minutes', false),
  ('daily-digest',      interval '26 hours',   false, interval '2 minutes', true),
  ('public-snapshots',  interval '30 minutes', false, interval '5 minutes', false)
on conflict (job) do update
  set max_gap = excluded.max_gap, money = excluded.money, timeout = excluded.timeout,
      once_per_ist_day = excluded.once_per_ist_day;

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
    when 'housekeeping' then
      return public.run_housekeeping();
    when 'outbox-prune' then
      return to_jsonb(public.outbox_prune());
    when 'user-sync-repair' then
      return public.user_sync_repair();
    when 'crm-rules' then
      return to_jsonb(public.run_crm_rules());
    when 'overdue-tasks' then
      return to_jsonb(public.run_overdue_tasks());
    when 'task-reminders' then
      return public.run_task_reminders();
    when 'sms-pumping-watch' then
      return public.run_sms_pumping_watch();
    when 'daily-digest' then
      return private.run_daily_digest();
    when 'public-snapshots' then
      return private.run_public_snapshots();
    when 'selftest-ok' then
      return jsonb_build_object('ok', true);
    when 'selftest-fail' then
      raise exception 'self-test failure on purpose: %', repeat('x', 400) using errcode = 'P0001';
    else
      raise exception 'cron job % has no case in private.cron_dispatch', p_job using errcode = '22023';
  end case;
end;
$fn$;
revoke all on function private.cron_dispatch(text) from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('task-reminders',       '2-59/15 * * * *', '2min', 'task-reminders'),
      ('sms-pumping-watch',    '8-59/15 * * * *', '2min', 'sms-pumping-watch'),
      ('daily-digest',         '30 3 * * *',      '2min', 'daily-digest'),
      ('daily-digest-catchup', '30 4 * * *',      '2min', 'daily-digest'),
      ('public-snapshots',     '3-59/10 * * * *', '5min', 'public-snapshots')
    ) as t(jobname, schedule, timeout, job)
  loop
    if exists (select 1 from cron.job where jobname = r.jobname) then
      perform cron.unschedule(r.jobname);
    end if;
    perform cron.schedule(r.jobname, r.schedule,
      format('set statement_timeout = %L; select private.run_cron_job(%L)', r.timeout, r.job));
  end loop;
end $$;
