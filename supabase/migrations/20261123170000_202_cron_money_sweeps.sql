-- 202 -- plan task 3.5c, PR 5: the three money sweeps run on pg_cron for good, through the wrapper.
--
--   auto-complete-due           private.auto_complete_due()          every 15 min   max_gap 45 min
--   settle-cleared-often        public.settle_cleared_earnings()     every 5 min    max_gap 15 min
--   settle-finished-campaigns   public.settle_finished_campaigns()   :07 every hour max_gap 2 h
--
-- Owner, 23 Nov: "yes, move them back to pg_cron". Staging had them on Inngest
-- (INNGEST_MONEY_JOBS=on, pg_cron copies unscheduled 25 Oct by supabase/cutover/inngest_money_jobs.sql),
-- and Inngest ran out of runs on 16 Nov, so on staging the sweeps had stopped. This migration schedules
-- them again (same names and times as before the cutover) and the same PR removes the Inngest copies.
--
-- Through private.run_cron_job each run is written to private.job_runs, one copy runs at a time, and a
-- failure or a stop reaches the team at once and Sentry as "fatal" (money = true), which emails the owner.
-- Before this, a failing sweep only left a row in cron.job_run_details that nobody read.
--
-- Safe to run twice: every sweep takes row locks and only touches work that is due, so a short overlap
-- with an Inngest copy (between this migration and the inngest function's redeploy) pays nobody twice.
-- No money rule changes; the sweeps' own functions are untouched. Adds only.
-- Undo: supabase/undo/202_cron_money_sweeps.down.sql.

-- ---- the list of pg_cron jobs --------------------------------------------------------------------
insert into private.cron_jobs (job, max_gap, money, timeout, once_per_ist_day) values
  ('auto-complete-due',         interval '45 minutes', true, interval '5 minutes', false),
  ('settle-cleared-often',      interval '15 minutes', true, interval '5 minutes', false),
  ('settle-finished-campaigns', interval '2 hours',    true, interval '5 minutes', false)
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
    -- money sweeps (migration 202)
    when 'auto-complete-due' then
      return jsonb_build_object('completed', private.auto_complete_due());
    when 'settle-cleared-often' then
      return jsonb_build_object('settled', public.settle_cleared_earnings());
    when 'settle-finished-campaigns' then
      return jsonb_build_object('settled', public.settle_finished_campaigns());
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

-- ---- the schedules ---------------------------------------------------------------------------------
-- Old names are removed first, whatever their command was (bare sweeps on a database that never ran the
-- cutover, nothing on staging). settle-cleared-earnings was the nightly copy (gone since 113).
do $$
declare
  v_name text;
begin
  foreach v_name in array array['auto-complete-due', 'settle-cleared-often', 'settle-cleared-earnings',
                                'settle-finished-campaigns'] loop
    if exists (select 1 from cron.job where jobname = v_name) then
      perform cron.unschedule(v_name);
    end if;
  end loop;

  perform cron.schedule('auto-complete-due', '*/15 * * * *',
    $c$set statement_timeout = '5min'; select private.run_cron_job('auto-complete-due')$c$);
  perform cron.schedule('settle-cleared-often', '*/5 * * * *',
    $c$set statement_timeout = '5min'; select private.run_cron_job('settle-cleared-often')$c$);
  perform cron.schedule('settle-finished-campaigns', '7 * * * *',
    $c$set statement_timeout = '5min'; select private.run_cron_job('settle-finished-campaigns')$c$);
end $$;
