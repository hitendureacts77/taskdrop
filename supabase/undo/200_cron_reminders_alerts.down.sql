-- Undo for 20261123120200_200_cron_reminders_alerts.sql (plan 3.5c, PR 3).
-- First revert the PR (puts the four Inngest functions and their jobs.ts helpers back) and let the
-- inngest function redeploy and sync, then run this. A short overlap is harmless (own locks and
-- once-only guards); the worst case is a second digest.

do $$
declare
  v_name text;
begin
  foreach v_name in array array['task-reminders', 'sms-pumping-watch', 'daily-digest', 'daily-digest-catchup',
                                'public-snapshots'] loop
    if exists (select 1 from cron.job where jobname = v_name) then
      perform cron.unschedule(v_name);
    end if;
  end loop;
end $$;

delete from private.cron_jobs where job in ('task-reminders', 'sms-pumping-watch', 'daily-digest', 'public-snapshots');
drop function if exists private.run_public_snapshots();
drop function if exists private.run_daily_digest();
drop function if exists private.digest_alert(jsonb);
drop function if exists private.inr(numeric);
-- private.cron_dispatch still names the dropped functions in its four cases; with no row in
-- private.cron_jobs they are never reached. Run undo 199 and 198 too to remove the runner itself.
