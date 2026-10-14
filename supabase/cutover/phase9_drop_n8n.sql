-- Phase 9 clean-up: remove what is left of n8n.
--
-- NOT a migration, so nothing applies it by accident. Migration 090 stopped n8n
-- (no events, no digest) but, under ground rule 2 ("migrations only add; never
-- drop or rename" while the old app and old admin share this database), left
-- these objects in place and empty or inert. At the Phase 9 switch-over, when the
-- old app and old admin are retired, run this once in the Supabase SQL editor.
--
-- Before running, check nothing still uses them:
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where p.prokind = 'f' and n.nspname in ('public', 'private')
--      and (pg_get_functiondef(p.oid) ilike '%automation_config%'
--        or pg_get_functiondef(p.oid) ilike '%automation_log%'
--        or pg_get_functiondef(p.oid) ilike '%send_daily_digest%');
-- That should list only private.send_daily_digest itself.

select cron.unschedule(jobname) from cron.job where jobname = 'n8n-log-prune';

drop function if exists private.send_daily_digest();
drop table if exists private.automation_log;
drop table if exists private.automation_config;
