-- Undo for 20261123170000_202_cron_money_sweeps.sql (plan 3.5c, PR 5).
--
-- Puts the three money sweeps back on pg_cron as bare commands (as before the wrapper, copied from the
-- retired supabase/cutover/inngest_money_jobs.sql in git history). It does NOT stop the sweeps: they must
-- keep running somewhere. Run it only if the wrapper itself is at fault; a failing sweep is a sweep bug,
-- not a wrapper bug, and this undo would only hide it again.

do $$
declare
  v_name text;
begin
  foreach v_name in array array['auto-complete-due', 'settle-cleared-often', 'settle-finished-campaigns'] loop
    if exists (select 1 from cron.job where jobname = v_name) then
      perform cron.unschedule(v_name);
    end if;
  end loop;

  perform cron.schedule('auto-complete-due',         '*/15 * * * *', $c$select private.auto_complete_due()$c$);
  perform cron.schedule('settle-cleared-often',      '*/5 * * * *',  $c$select public.settle_cleared_earnings()$c$);
  perform cron.schedule('settle-finished-campaigns', '7 * * * *',    $c$select public.settle_finished_campaigns()$c$);
end $$;

-- Off the watched list, so job-watchdog does not call them stopped. The three cases stay in
-- private.cron_dispatch (harmless: nothing calls them).
delete from private.cron_jobs where job in ('auto-complete-due', 'settle-cleared-often', 'settle-finished-campaigns');
