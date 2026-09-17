-- 038 — run the clearing sweep nightly.
--
-- Released earnings sit in clearing for seven days and then have to be moved
-- into the withdrawable balance. Nothing was moving them, so a worker's money
-- stopped there permanently. This is the one job on the platform that cannot
-- wait for a person to remember it.
create extension if not exists pg_cron;

-- 02:00 UTC = 07:30 IST, after the day's releases and before anyone is up to
-- withdraw. settle_cleared_earnings() settles each task at most once, so a
-- double run is harmless.
select cron.schedule(
  'settle-cleared-earnings',
  '0 2 * * *',
  $$select public.settle_cleared_earnings()$$
);
