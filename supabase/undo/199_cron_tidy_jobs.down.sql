-- Undo for 20261123120100_199_cron_tidy_jobs.sql (plan 3.5c, PR 2).
-- First revert the PR (puts the five Inngest functions back) and let the inngest function redeploy and
-- sync, then run this to stop the pg_cron copies. Both running for a few minutes is harmless: all five
-- jobs are safe to run twice.

do $$
declare
  v_name text;
begin
  foreach v_name in array array['housekeeping', 'outbox-prune', 'outbox-prune-catchup', 'user-sync-repair',
                                'user-sync-repair-catchup', 'crm-rules', 'overdue-tasks'] loop
    if exists (select 1 from cron.job where jobname = v_name) then
      perform cron.unschedule(v_name);
    end if;
  end loop;
end $$;

-- Watched no more, so job-watchdog does not report them as stopped.
delete from private.cron_jobs where job in ('housekeeping', 'outbox-prune', 'user-sync-repair', 'crm-rules', 'overdue-tasks');
-- private.cron_dispatch keeps the five cases; they are unreachable without a row in private.cron_jobs.
