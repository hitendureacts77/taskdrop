-- Cutover: let Inngest run the money sweeps instead of pg_cron.
--
-- NOT a migration, so nothing applies it by accident. Run it by hand in the
-- Supabase SQL editor, once, after ALL of these are true:
--
--   1. Migration 090 is applied and the `inngest` Edge Function is deployed.
--   2. INNGEST_SIGNING_KEY and INNGEST_EVENT_KEY are set, and Inngest Cloud shows
--      the app synced (docs/INNGEST.md, "Switching it on").
--   3. INNGEST_MONEY_JOBS=on is set and the function redeployed, so Inngest lists
--      auto-complete-due, settle-cleared-earnings and settle-finished-campaigns.
--   4. Each of the three has run green at least once in the Inngest dashboard.
--
-- Both runners may be on together for a while: every sweep takes row locks and
-- only touches work that is due, so an overlap cannot pay anyone twice. This
-- file ends the overlap.

select cron.unschedule(jobname)
  from cron.job
 where jobname in ('auto-complete-due', 'settle-cleared-earnings', 'settle-cleared-often', 'settle-finished-campaigns');

-- To go back to pg_cron (Inngest stays up; just set INNGEST_MONEY_JOBS off and redeploy):
--   select cron.schedule('auto-complete-due',         '*/15 * * * *', $$select private.auto_complete_due()$$);
--   select cron.schedule('settle-cleared-earnings',   '0 2 * * *',    $$select public.settle_cleared_earnings()$$);
--   select cron.schedule('settle-cleared-often',      '*/5 * * * *',  $$select public.settle_cleared_earnings()$$);
--   select cron.schedule('settle-finished-campaigns', '7 * * * *',    $$select public.settle_finished_campaigns()$$);
