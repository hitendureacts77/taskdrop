# Background jobs: pg_cron and Inngest

Background work is **hybrid** (owner decision 2026-11-09, plan task 3.5c; replaces "Inngest only"
from 2026-10-12). A job that is one SQL function on a timer, with no outside call, runs on
Supabase **pg_cron** inside the database. Anything that calls an outside service, needs retries
with back-off, or must run one person at a time runs on **Inngest**.

## The split

| Postgres owns | pg_cron owns | Inngest owns |
|---|---|---|
| The rules and the money: prices, fees, who gets paid, balances | Timed database-only jobs: the money sweeps, prunes, reminders, watchdogs (through `private.run_cron_job`) | Calls to the outside world: push, ImageKit and file clean-up, Razorpay checks and Plan B money moves |
| What happened, written in the same transaction as the change | One run at a time, every run written to `private.job_runs`, failures to the team and Sentry | Retries with back-off, one person at a time, and the outbox bridge |
| The sweeps themselves (`auto_complete_due`, `settle_cleared_earnings`, ...) | Ringing the bell on those sweeps | Telling Sentry when a pg_cron job fails (`job-failure-report`) |

Inngest never decides an amount. A mistake in an Inngest function can send a late
or duplicate message; it cannot move money on its own.

## How an event travels

```
trigger / RPC  ->  private.emit_event()  ->  private.outbox   (same transaction)
                                         \->  pg_net POST to Inngest   (fast path, after commit)

Inngest "outbox-sweeper" (every 10 minutes) ->  outbox_pending()  -> re-sends anything not confirmed
```

The outbox id **is** the Inngest event id, so an event that arrives twice (fast
path and sweeper) is dropped as a duplicate. If Inngest is down, events wait in the
outbox and go out when it is back; nothing is lost and the user's action never fails.

Events carry ids, names, amounts and fixed categories, never phone numbers, emails, bank details or
UPI ids, and never text a person typed (a help-request subject, a job title) or a provider's
free-text failure note: events leave the database for a third party, and that text can hold
anything. The team opens the linked page in the admin panel for the detail. The alert function
also drops those fields from anything it stores, for an event queued before this rule.

| Event | When | `data` |
|---|---|---|
| `taskdrop/user.signed_up` | a new account passes the age check | `user_id`, `name` |
| `taskdrop/user.updated` | a profile edit (name, username, photo, bios, skills, languages, intent, location, payout UPI, setup finished) or a change of sign-in email or phone, once the person has passed the age check | `user_id`, `changed` (field names only, never the new values) |
| `taskdrop/user.deleted` | someone deletes their account, or an account is removed from auth outright | `user_id`, `by_admin` (`removed: true` for the outright case) |
| `taskdrop/support.opened` | someone sends a help request | `ticket_id`, `category`, `from` |
| `taskdrop/withdrawal.requested` | a worker asks to withdraw | `payout_id`, `amount_rupees`, `name`, `via` |
| `taskdrop/payout.failed` | a withdrawal fails and the money goes back | `payout_id`, `amount_rupees`, `name` |
| `taskdrop/dispute.opened` | a job is disputed | `task_id`, `poster` |
| `taskdrop/job.failed` | a pg_cron job failed, stopped, or died inside pg_cron (at most once an hour per job; a money job every 15 minutes; a stopped job every 6 hours) | `job`, `sqlstate` (or `STALE` / `CRON`), `run_id`, `money` |

## The functions (`supabase/functions/inngest/`)

| Function | Trigger | Does |
|---|---|---|
| `outbox-sweeper` | every 10 minutes | re-sends unconfirmed outbox events, marks them sent. In the same step it asks `cron_health()` whether a pg_cron job stopped and, at most once an hour, tells Sentry (`fatal` for a money job) |
| `job-failure-report` | event `job.failed` | tells Sentry that a pg_cron job failed or stopped (`fatal` for a money job, which emails the owner). The team alert is already written by the database |
| `team-alert` | support / withdrawal / payout failed / dispute events | writes a message to `admin_alerts` |
| `nightly-reconcile` | daily 02:30 IST | calls `run_reconciliation()` (our own money checks), then compares the last 3 days of payments with Razorpay payment links and saves both to `reconciliation_runs`; a difference leaves an `admin_alerts` row. Reports only, never changes money |
| `auto-complete-due` | hourly at :27 | calls `run_auto_complete_due()` |
| `settle-cleared-earnings` | hourly at :47 | calls `settle_cleared_earnings()` |
| `settle-finished-campaigns` | every 3 hours at :07 | calls `settle_finished_campaigns()` |
| `push-notification` | event `notification.created` | reads the message from the database, sends it to Expo, waits 15 minutes, reads Expo's receipts and forgets devices that are gone |
| `account-files` | event `user.deleted` | removes whatever files of the deleted account are still in storage (the api function already tried once); empty when nothing is left. Also marks the account's ImageKit pictures deleted (migration 109), except those a kept record still uses |
| `media-purge` | hourly at :41 | marks pictures nobody finished uploading (pending for 24 h) as deleted, then removes deleted pictures from ImageKit in batches of 50, with retries. Waits, without failing, until the ImageKit secrets are set. See `docs/MEDIA.md` |
| `stray-imagekit-files` | weekly, Sunday 03:30 India time | removes ImageKit files in this deployment's folder that have no `media` row (by path or file id) and are over 2 days old, at most 200 per run; no-op until the ImageKit secrets are set; removes nothing if the database cannot be asked. `IMAGEKIT_ORPHAN_DRY_RUN=1` only counts. Needs no migration (H41) |
| `user-created` | event `user.signed_up` | records the person in the `user_sync` ledger |
| `user-updated` | event `user.updated` | counts the update and keeps which fields changed in the ledger |
| `user-deleted` | event `user.deleted` | marks the person deleted in the ledger. Deleted is final: a late update or sign-up cannot revive them |
| `safety-alarm` | every hour, at :23 | production only (any project but staging or localhost; quiet on staging). Fires a `fatal` Sentry event, which the alert rule emails at once, if production has a test shortcut on: `dev_otp_for_all` not off, the environment setting not `production`, a test-only function secret set (`ALLOW_ANY_OTP`, `TEST_PHONES`, an App Check debug token, `INNGEST_DEV`), or a Razorpay test key. Reads only. Rules and tests in `supabase/functions/_shared/safetyAlarm.ts` (plan task 5.9) |

Also on a schedule: `money-moves` (Plan B, hourly at :12 plus the `money.move` event; the task
screen also asks for a waiting move when it opens) and `money-match` (Plan B, nightly 02:30 IST,
our ledger against Razorpay's settlement report). Both call Razorpay, so they stay on Inngest.

**Run budget.** Each Inngest account (staging `taskdrop`, production `TaskDrop Production`) is on the
free Hobby plan: 50,000 executions a month for all jobs together, and every `step.run` counts as
one more. At the old pace (sweeper every 5 min, four jobs every 10) both accounts used about
2,500 a day, and staging ran out on 16 Nov 2026: events then sat in the outbox and Plan B
releases waited until someone opened the task. Since plan 3.5c (migrations 198 to 201) every
database-only timer runs on pg_cron instead, at no cost. Inngest's own timers are now the
sweeper (144 a day), `media-purge`, `money-moves` and `safety-alarm` (24 each), the two nightly
money checks and the weekly stray-file sweep: about 220 runs a day, plus 56 while staging still
runs the three wallet money sweeps on Inngest (`INNGEST_MONEY_JOBS=on`; plan 3.5c PR 5 moves them
back to pg_cron). That is roughly 600 executions a day, about 18,000 a month, which leaves most of
the 50,000 for event-driven runs (push, money moves, people sync). The outbox sweeper stays at 10
minutes because the watchdog alarms at 25. Before making any Inngest schedule faster, check the
account's Billing → Usage page (every 5 minutes is about 17,000 executions a month).

The three money sweeps run on Inngest only when `INNGEST_MONEY_JOBS=on`. **Staging has it on**
and its pg_cron copies were unscheduled on 25 Oct (`supabase/cutover/inngest_money_jobs.sql`), so
while staging's Inngest is out of its monthly runs the sweeps do not run there at all. Plan 3.5c
PR 5 puts them back on pg_cron for good, through the wrapper; it waits for the owner's answer
(23 Nov). Every function reports its final failure to Sentry.

Push, `account-files`, `overdue-tasks` and `housekeeping` need migration 101; the live-feed clean-up inside `housekeeping` needs 104; `outbox-watchdog` and `task-reminders` need 105; `media-purge` and the picture step in `account-files` need 109. Push also has a
switch (next section). `notification.created` holds ids and the kind only: the title and body
are read by the Edge Function and handed to Expo, and Inngest keeps only counts and a one-way
key per device.

## pg_cron jobs (plan 3.5c)

Every pg_cron command has one shape: `set statement_timeout = '<n>min'; select private.run_cron_job('<job>')`.
The wrapper (migration 198):

1. refuses a job that is not in `private.cron_jobs`;
2. runs one copy at a time (a non-blocking advisory lock; a run that finds a slower one still going writes `skipped`);
3. skips a once-a-day job that already ran today (India date), so a catch-up run an hour later is safe;
4. sets `lock_timeout` to 10 s and runs the job in a sub-transaction through the fixed list in `private.cron_dispatch` (no dynamic SQL);
5. writes `ok`, `skipped` or `failed` to `private.job_runs` (a failure keeps its SQLSTATE and at most 300 characters of the message, never the detail);
6. on a failure, `private.report_job_failure` leaves a `job_failed` team alert and a `job.failed` event, which Inngest's `job-failure-report` turns into a Sentry issue.

Two watchers, each on the other system: `job-watchdog` (pg_cron, every 5 min) reports a job whose last
green run is older than its `max_gap` (`STALE`) or a run that failed inside pg_cron itself (`CRON`), and
prunes `job_runs` (30 days) and `cron.job_run_details` (7 days) once an hour. Inngest's `outbox-sweeper`
asks `cron_health()` every 10 minutes, so if pg_cron itself stops, Sentry still hears. pg_cron's
`outbox-watchdog` sees the reverse: events unsent for 25 minutes mean Inngest is not receiving
them (one alert, then quiet for six hours). `job-watchdog` also watches Inngest's money check: no
`reconciliation_runs` row in 26 hours reports `nightly-reconcile` as stopped. Only if both systems
stop at once is nobody told.

| pg_cron job | Schedule (UTC) | India time | `max_gap` | Once a day | Money | Since |
|---|---|---|---|---|---|---|
| `job-watchdog` | `*/5 * * * *` | every 5 min | 15 min (watched by Inngest) | no | no | 198 |
| `housekeeping` | `17 * * * *` | :47 every hour | 2 h | no | no | 199 |
| `outbox-prune`, catch-up `outbox-prune-catchup` | `45 22 * * *`, `45 23 * * *` | 04:15, 05:15 | 26 h | yes | no | 199 |
| `user-sync-repair`, catch-up `user-sync-repair-catchup` | `40 21 * * *`, `40 22 * * *` | 03:10, 04:10 | 26 h | yes | no | 199 |
| `crm-rules` | `0 */3 * * *` | 05:30, 08:30 ... | 4 h | no | no | 199 |
| `overdue-tasks` | `1-59/10 * * * *` | every 10 min | 30 min | no | no | 199 |
| `task-reminders` | `2-59/15 * * * *` | every 15 min | 45 min | no | no | 200 |
| `sms-pumping-watch` | `8-59/15 * * * *` | every 15 min | 45 min | no | no | 200 |
| `daily-digest`, catch-up `daily-digest-catchup` | `30 3 * * *`, `30 4 * * *` | 09:00, 10:00 | 26 h | yes | no | 200 |
| `public-snapshots` | `3-59/10 * * * *` | every 10 min | 30 min | no | no | 200 |
| `outbox-watchdog` | `5-59/10 * * * *` | every 10 min | 30 min | no | no | 201 |

What they run: `housekeeping` calls `run_housekeeping()` (expired sign-in codes, send and search
counters, rate counters, password attempts older than 30 days, notifications older than 90 days,
admin live-feed rows older than 30 days, free ad events older than `ad_events_keep_days`);
`outbox-prune` calls `outbox_prune()` (sent events older than 14 days, team alerts older than 30);
`user-sync-repair` calls `user_sync_repair()` (puts the `user_sync` ledger right; normally all zeros);
`crm-rules` calls `run_crm_rules()` (the automation rules an admin switched on, once per rule per
person); `overdue-tasks` calls `run_overdue_tasks()` (a started job past its due time becomes
`OVERDUE`; only the label changes). `task-reminders` calls `run_task_reminders()` (finished work
waiting for approval, a started job due within the hour; once per task and person, as in-app
notifications whose push still goes through Inngest's `push-notification`); `sms-pumping-watch`
calls `run_sms_pumping_watch()` (many codes sent, few used: one alert per 6 h); `daily-digest`
writes the day's totals as a `digest` team alert (`private.digest_alert` holds the words);
`public-snapshots` checks the age of the kept public lists (older than 30 minutes is a failure
report, plus one `public_snapshots_stale` alert while 45 minutes or less), then calls
`private.refresh_public_snapshots()` and writes the `public_snapshots_last_ok` settings row.

Check them on the database:

```sql
select jobname, schedule, active from cron.job order by 1;
select job, status, started_at, sqlstate, error from private.job_runs order by id desc limit 20;
```

Adding a job: a migration adds its row to `private.cron_jobs`, its case to `private.cron_dispatch`
(replace the whole function) and its `cron.schedule` line, and removes the Inngest copy in the same PR.
`supabase/tests/cron_jobs.test.sql` fails if a scheduled job has no row or no case.

## People: created, updated, deleted

Three events describe a person (`user.signed_up`, `user.updated`, `user.deleted`, above) and each has
an Inngest function that writes `public.user_sync`: one row per person with `state` (`active` or
`deleted`), when they were first seen, how many profile updates, the field names changed last, and
when they were deleted. It holds no name, contact or any text, only ids, counts and field names. Admins
can read it; only the service role writes it. It is what mail lists, a CRM or other integrations
should read to know who exists.

- **Created** is `user.signed_up`, sent when a new account passes the age check (migration 082), not at the
  moment the auth row appears: nothing about a person leaves the database before we know they are 18+.
- **Updated** is sent only for the columns listed above. The one-a-minute heartbeat, ratings and
  `updated_at` never raise it, and neither does saving a value unchanged. Nothing is sent for someone
  who has not passed the age check or whose account is deleted.
- **Deleted** is sent by `delete_account()` (self or admin) and by a trigger when an account the ledger
  knows is removed from auth directly (the dashboard, a clean-up script).
- Events for one person run one at a time, the same event applied twice does nothing more, and the ledger
  copes with them arriving out of order. `user_sync_repair()` runs nightly as a safety net.

Migration 103; tested by `supabase/tests/user_sync.test.sql`.

## Moving push and the prunes

Pushes keep going out the old way, straight from the database, until the settings row
`push_via_inngest` is `true`. So nothing breaks while Inngest is being set up.

1. Apply migration 101, redeploy the `inngest` function, and see the four new functions in the Inngest dashboard.
2. Invoke `housekeeping` and `overdue-tasks` once each and see them green.
3. Run `supabase/cutover/inngest_background_jobs.sql` by hand. It turns the switch on and unschedules the two old prune jobs.
4. Try it on a phone: do something that notifies you and see a `push-notification` run and the buzz.

To go back: `update public.settings set value = 'false' where key = 'push_via_inngest';` (at once, no deploy). The same file lists the two `cron.schedule` lines for the prunes.

Lock-screen wording (H42, owner decision 26): pushes for chat, task questions, payouts, wallet, support, security and staff warnings carry a plain line ("You have a new message"), never a name, amount, task title or typed text. The list lives in `PLAIN_PUSH` in `supabase/functions/inngest/jobs.ts` and, for the direct road used while `push_via_inngest` is false, in `private.push_plain_line` (migration 155); a unit test keeps the two identical. The in-app notification text and the tap-through data are unchanged.

The web has no push; in-app notifications and live updates do not go through Inngest.

Team messages land in `public.admin_alerts` (admins can read them, nobody else).
The admin app's alerts view reads that table.

## Where Inngest is not used, on purpose

- **Rules and money.** Prices, fees, who is paid and balances stay in Postgres (RLS, RPCs). Inngest only rings the bell.
- **Live updates and in-app notifications.** They go straight from Postgres (Realtime); a round trip through a third party would only add delay.
- **Payouts, refund retries, stuck-payout checks and webhook hand-off.** They touch the money flow and wait for the lawyer's answer (R3).
- **The admin live feed.** Rows are written by a database trigger inside the change itself; only its hourly clean-up is an Inngest job.

## Switching it on (hosted test project)

Nothing is live until these are done. You do 1, 2 and 4; they need your accounts.

1. **Create an Inngest Cloud account** (free plan). Create an app named `taskdrop`.
2. Copy the **Signing Key** and an **Event Key**, then set them as Edge Function secrets:
   ```bash
   supabase secrets set INNGEST_SIGNING_KEY=signkey-... INNGEST_EVENT_KEY=...
   ```
3. Migration `090_outbox_inngest.sql` and the `inngest` function are applied and deployed on the hosted test project (2026-10-18). If you rebuild elsewhere: apply the migration and deploy the function
   (`supabase functions deploy inngest --no-verify-jwt`). Done by an agent only when asked.
4. In Inngest Cloud, **sync the app** with the URL
   `https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/inngest`.
5. Give the database the event address, as a Vault secret (SQL editor):
   ```sql
   select vault.create_secret('https://inn.gs/e/<YOUR_EVENT_KEY>', 'inngest_event_url');
   ```
   To change it later: `select vault.update_secret(id, '<new url>') from vault.secrets where name = 'inngest_event_url';`

After a deploy that adds or changes a function or schedule, tell Inngest to re-read the list: run the **Inngest sync** workflow (GitHub → Actions → Run workflow), or `curl -X PUT https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/inngest`. It answers `Successfully registered`.

Until step 5, events still collect in the outbox; the sweeper sends them once the
Event Key is set on the function. After step 5 they also go out instantly.

**Check it works:** open a help request in the app. Within seconds there is a row in
`admin_alerts` (`select * from admin_alerts order by created_at desc limit 5;`) and a
`team-alert` run in the Inngest dashboard.

## Moving the money sweeps off pg_cron

1. Set `INNGEST_MONEY_JOBS=on` (`supabase secrets set INNGEST_MONEY_JOBS=on`) and redeploy.
2. In the Inngest dashboard, run each of the three once (Invoke) and see it green.
3. Run `supabase/cutover/inngest_money_jobs.sql` by hand. It unschedules the pg_cron
   copies. To go back, the same file lists the four `cron.schedule` lines.

Both runners may be on together for a while: each sweep takes row locks and only
touches work that is due.

## Running it on your PC

```bash
npx inngest-cli@latest dev -u http://127.0.0.1:54321/functions/v1/inngest   # UI: http://localhost:8288
```

Serve the function with `INNGEST_DEV=1` in its env. For the local database to reach the
dev server, store `http://host.docker.internal:8288/e/local` as the `inngest_event_url`
Vault secret.

## Tests

- `npm test` runs the job logic (`supabase/functions/inngest/jobs.test.ts`).
- `npm run test:db` also runs `supabase/tests/watchdog_reminders.test.sql` (live-feed titles, one payment per payment link, the watchdog and the reminders) and `supabase/tests/inngest_jobs.test.sql`.
- `npm run test:db` runs `supabase/tests/cron_jobs.test.sql`: the pg_cron wrapper, failure reports (one alert and one ids-only event per hour), the watchdog, `cron_health`, once-a-day jobs, who may call what, and that every scheduled job goes through the wrapper.
- CI type-checks the Inngest function with Deno (`deno check`), which the Node unit tests cannot do.
- `npm run test:db` runs `supabase/tests/outbox.test.sql`: events are queued with the
  change, carry no contact details, the sweeper sees only old unsent events, only the
  service role can call the Inngest-facing functions, the old automation tool's leftovers
  are gone (migration 102), and no event or alert carries free text.

## Not moved yet (still in the plan, Phase 5)

Withdrawal payouts with retries, stuck-payout reconciliation, refund retries and webhook
hand-off. They touch the money flow, so they wait for the lawyer's answer (R3). Each is moved
one at a time, with the old job removed in the same deploy as its replacement.
