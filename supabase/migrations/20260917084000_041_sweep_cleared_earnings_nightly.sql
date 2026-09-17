-- 041_sweep_cleared_earnings_nightly
--
-- settle_cleared_earnings() has had no caller since migration 023 shipped it.
-- The wrapper that called it went out with the owner console, pg_cron was never
-- enabled, and the result is visible in the live database: every wallet holds a
-- balance of zero while clearing_minor holds real money, because earnings reach
-- clearing, their seven days elapse, and nothing moves them.
--
-- The app now sweeps whenever someone opens their wallet or the withdraw
-- screen, which covers the person who actually wants the money. This is the
-- other half: it keeps the figures honest for everyone who is not looking --
-- analytics, a poster reading their own stats, and any worker whose clearing
-- period ends while they are not in the app.
--
-- Optional in the sense that nothing breaks without it, and worth having
-- because "did anyone open the app today" is not a good reason for a balance to
-- be wrong. pg_cron is available on every Supabase tier at no cost.
create extension if not exists pg_cron with schema cron;

-- Nightly at 02:00 UTC. The sweep is idempotent -- a task is settled at most
-- once, enforced by tasks.cleared_at and a row lock -- so overlapping with an
-- app-triggered sweep is harmless.
select cron.unschedule('settle-cleared-earnings')
 where exists (select 1 from cron.job where jobname = 'settle-cleared-earnings');

select cron.schedule(
  'settle-cleared-earnings',
  '0 2 * * *',
  $$select public.settle_cleared_earnings()$$
);
