-- Undo for 20261123120000_198_cron_job_runner.sql (plan 3.5c, PR 1).
-- Run by hand only after the later 3.5c undos (199 onward) and after the inngest function no longer
-- calls cron_health (revert the PR first: the sweeper tolerates the function missing, but cleaner).
-- The two tables stay (harmless, private); drop them too only if nothing else reads them.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'job-watchdog') then
    perform cron.unschedule('job-watchdog');
  end if;
end $$;

drop function if exists public.cron_health();
drop function if exists private.run_cron_job(text);
drop function if exists private.cron_dispatch(text);
drop function if exists private.run_job_watchdog();
drop function if exists private.stopped_cron_jobs();
drop function if exists private.report_job_failure(text, text, bigint);
delete from public.settings where key = 'cron_health_reported_at';
-- drop table if exists private.job_runs;
-- drop table if exists private.cron_jobs;
