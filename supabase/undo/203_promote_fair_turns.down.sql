-- Undo for 20261125120000_203_promote_fair_turns.sql (plan task 1.19 row C).
--
-- Puts start_promotion, settle_campaign and settle_finished_campaigns back to their 114/046 bodies by
-- re-running those migrations' definitions, puts the sweep back on '7 * * * *', and removes the trigger.
-- The new table, columns, settings and functions are left in place (harmless when nothing calls them);
-- drop them by hand only if the owner asks.
--
-- Run the 114 and 046 function bodies from git first:
--   git show HEAD:supabase/migrations/20261021100400_114_promotion_price_tiers.sql   (start_promotion)
--   git show HEAD:supabase/migrations/20260921120400_046_refund_unspent_campaign_budget.sql
--     (settle_campaign, settle_finished_campaigns; then revoke settle_finished_campaigns from authenticated)

drop trigger if exists task_promotions_on_live on public.task_promotions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'settle-finished-campaigns') then
    perform cron.unschedule('settle-finished-campaigns');
  end if;
  perform cron.schedule('settle-finished-campaigns', '7 * * * *',
    $c$set statement_timeout = '5min'; select private.run_cron_job('settle-finished-campaigns')$c$);
end $$;
update private.cron_jobs set max_gap = interval '2 hours' where job = 'settle-finished-campaigns';
