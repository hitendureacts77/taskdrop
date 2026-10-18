-- Cutover: let Inngest run push notifications and the housekeeping prunes.
--
-- NOT a migration, so nothing applies it by accident. Run it by hand in the
-- Supabase SQL editor, once, after ALL of these are true:
--
--   1. Migration 101 is applied and the `inngest` Edge Function is redeployed, so
--      Inngest lists push-notification, account-files, overdue-tasks and
--      housekeeping.
--   2. INNGEST_SIGNING_KEY and INNGEST_EVENT_KEY are set, the `inngest_event_url`
--      Vault secret is set, and Inngest Cloud shows the app synced
--      (docs/INNGEST.md, "Switching it on").
--   3. housekeeping and overdue-tasks have each run green once in the Inngest
--      dashboard (Invoke).
--
-- Right after running it, check push on a test phone: sign in on it, then do
-- something that notifies you (send yourself a chat message from a second
-- account). A `push-notification` run appears in Inngest and the phone buzzes.
-- If not, the "to go back" line at the bottom returns pushes to the old road at once.
--
-- 1. Move push to Inngest. Until this row exists, pushes go out the old way
--    (straight from the database), so nothing breaks while you set Inngest up.
insert into public.settings (key, value)
values ('push_via_inngest', 'true')
on conflict (key) do update set value = excluded.value;

-- 2. End the overlap on the prunes: Inngest's `housekeeping` now does what these
--    two pg_cron jobs did (and more).
select cron.unschedule(jobname)
  from cron.job
 where jobname in ('api-rate-prune', 'password-attempts-prune');

-- To go back:
--   update public.settings set value = 'false' where key = 'push_via_inngest';   -- pushes return to the old road at once
--   select cron.schedule('api-rate-prune',         '*/10 * * * *', $c$delete from private.api_rate where window_start < now() - interval '1 hour'$c$);
--   select cron.schedule('password-attempts-prune', '17 * * * *',  $c$delete from public.password_attempts where at < now() - interval '30 days'$c$);
--
-- The three money sweeps have their own switch: supabase/cutover/inngest_money_jobs.sql.
