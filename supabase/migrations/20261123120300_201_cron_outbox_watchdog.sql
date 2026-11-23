-- 201 -- plan task 3.5c, PR 4: the outbox watchdog moves to pg_cron, and pg_cron watches the
-- nightly money check.
--
--   outbox-watchdog   run_outbox_watchdog()   every 10 min at :05   (was Inngest, hourly at :52)
--
-- It must not run on the system it watches: events unsent for long mean Inngest is not receiving
-- them, so the watchdog now runs inside the database. Q2 (owner, "use the recommendations"): the
-- sweeper runs every 10 minutes, so "stuck" moves from 15 to 25 minutes (same function, same
-- signature, same six-hour quiet time).
--
-- job-watchdog also watches Inngest's money check: no reconciliation_runs row in 26 hours means
-- nightly-reconcile did not run, which is reported like a stopped job (team alert + Sentry,
-- at most every 6 hours). Adds only. Undo: supabase/undo/201_cron_outbox_watchdog.down.sql.

create or replace function public.run_outbox_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_stuck   integer;
  v_minutes integer;
  v_alerted boolean := false;
begin
  perform private.assert_service_caller();

  select count(*), coalesce(floor(extract(epoch from now() - min(created_at)) / 60), 0)::integer
    into v_stuck, v_minutes
    from private.outbox
   where sent_at is null
     and created_at < now() - interval '25 minutes';

  if v_stuck > 0
     and not exists (select 1 from public.admin_alerts
                      where kind = 'outbox_stuck' and created_at > now() - interval '6 hours') then
    perform public.record_admin_alert(
      'outbox_stuck',
      'Background jobs are not receiving events',
      v_stuck || ' event(s) have waited unsent, the oldest for ' || v_minutes
        || ' minutes. Check the Inngest keys, its monthly run limit, and that the inngest function is deployed and synced.',
      jsonb_build_object('stuck', v_stuck, 'oldest_minutes', v_minutes));
    v_alerted := true;
  end if;

  return jsonb_build_object('stuck', v_stuck, 'oldest_minutes', v_minutes, 'alerted', v_alerted);
end;
$$;
revoke all on function public.run_outbox_watchdog() from public, anon, authenticated;
grant execute on function public.run_outbox_watchdog() to service_role;

-- ---- job-watchdog, now also watching the nightly money check --------------------------------------
create or replace function private.run_job_watchdog()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_job       text;
  v_stale     text[] := '{}';
  v_cron      text[] := '{}';
  v_pruned    integer := 0;
  v_details   integer := 0;
  v_reconcile boolean := true;
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

  -- Inngest's nightly-reconcile writes a reconciliation_runs row every night (02:30 IST).
  if not exists (select 1 from public.reconciliation_runs r where r.ran_at > now() - interval '26 hours') then
    perform private.report_job_failure('nightly-reconcile', 'STALE', null);
    v_reconcile := false;
  end if;

  if extract(minute from now() at time zone 'UTC') < 5 then
    delete from private.job_runs where started_at < now() - interval '30 days';
    get diagnostics v_pruned = row_count;
    delete from cron.job_run_details where end_time < now() - interval '7 days';
    get diagnostics v_details = row_count;
  end if;

  return jsonb_build_object('stale', to_jsonb(v_stale), 'cron_failed', to_jsonb(v_cron),
                            'reconcile_ran', v_reconcile,
                            'pruned_runs', v_pruned, 'pruned_cron_details', v_details);
end;
$fn$;
revoke all on function private.run_job_watchdog() from public, anon, authenticated, service_role;

-- ---- the list of pg_cron jobs --------------------------------------------------------------------
insert into private.cron_jobs (job, max_gap, money, timeout, once_per_ist_day) values
  ('outbox-watchdog', interval '30 minutes', false, interval '1 minute', false)
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
    when 'outbox-watchdog' then
      return public.run_outbox_watchdog();
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
begin
  if exists (select 1 from cron.job where jobname = 'outbox-watchdog') then
    perform cron.unschedule('outbox-watchdog');
  end if;
  perform cron.schedule('outbox-watchdog', '5-59/10 * * * *',
    $c$set statement_timeout = '1min'; select private.run_cron_job('outbox-watchdog')$c$);
end $$;
