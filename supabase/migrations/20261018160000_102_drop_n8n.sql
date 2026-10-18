-- 102 -- remove what was left of the old automation tool.
--
-- Migration 090 stopped it and left these objects in place, inert. They were created
-- by the upgrade only; the old app and old admin never read or wrote them, so
-- dropping them does not break the shared database. Nothing else refers to them
-- (checked: the only function mentioning them is the one dropped here).

select cron.unschedule(jobname) from cron.job where jobname = 'n8n-log-prune';

drop function if exists private.send_daily_digest();
drop table if exists private.automation_log;
drop table if exists private.automation_config;
