-- Undo for 20261126110000_203_promote_bidding.sql (plan task 1.19 row C).
--
-- Puts start_promotion, cancel_promotion, settle_campaign and settle_finished_campaigns back to their
-- 114/046 bodies by re-running those migrations' definitions, and removes the trigger. The new settings,
-- columns, table and functions are left in place (harmless when nothing calls them); drop them by hand
-- only if the owner asks. The cron schedule was not changed by 203.
--
-- Run the 114 and 046 function bodies from git first:
--   git show HEAD:supabase/migrations/20261021100400_114_promotion_price_tiers.sql   (start_promotion)
--   git show HEAD:supabase/migrations/20260921120400_046_refund_unspent_campaign_budget.sql
--     (settle_campaign, cancel_promotion, settle_finished_campaigns; then revoke settle_finished_campaigns
--      from authenticated)
-- Campaigns that settled under 203 kept their whole amount; refunding any of them is a money decision for
-- the owner, not part of this undo.

drop trigger if exists task_promotions_on_live on public.task_promotions;
