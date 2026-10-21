-- 113 — drop the nightly copy of the earnings sweep (Phase 2, known bug).
--
-- Two cron jobs call the same function: 'settle-cleared-often' (every 5
-- minutes, migration 063) and 'settle-cleared-earnings' (02:00 UTC, migration
-- 041). The sweep is idempotent and the five-minute job covers everything the
-- nightly one does, so the nightly one only added a second scan of every task
-- (docs/audit/SCALE_READINESS.md, row 7). Removes the nightly job; the
-- five-minute one stays until the Inngest cutover (supabase/cutover/).
--
-- This unschedules a job; no table, column or function is dropped.

select cron.unschedule(jobid) from cron.job where jobname = 'settle-cleared-earnings';
