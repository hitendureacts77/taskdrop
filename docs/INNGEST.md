# Background jobs: Inngest

Background work (schedules, retries, alerts, calls to outside services) runs on
**Inngest** (owner decision, 2026-10-12).

## The split

| Postgres owns | Inngest owns |
|---|---|
| The rules and the money: prices, fees, who gets paid, balances | When things run: schedules, retries, back-off |
| What happened, written in the same transaction as the change | Calls to the outside world: push, payouts, email |
| The sweeps themselves (`auto_complete_due`, `settle_cleared_earnings`, ...) | Ringing the bell on those sweeps |

Inngest never decides an amount. A mistake in an Inngest function can send a late
or duplicate message; it cannot move money on its own.

## How an event travels

```
trigger / RPC  ->  private.emit_event()  ->  private.outbox   (same transaction)
                                         \->  pg_net POST to Inngest   (fast path, after commit)

Inngest "outbox-sweeper" (every minute)  ->  outbox_pending()  -> re-sends anything not confirmed
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
| `taskdrop/user.deleted` | someone deletes their account | `user_id`, `by_admin` |
| `taskdrop/support.opened` | someone sends a help request | `ticket_id`, `category`, `from` |
| `taskdrop/withdrawal.requested` | a worker asks to withdraw | `payout_id`, `amount_rupees`, `name`, `via` |
| `taskdrop/payout.failed` | a withdrawal fails and the money goes back | `payout_id`, `amount_rupees`, `name` |
| `taskdrop/dispute.opened` | a job is disputed | `task_id`, `poster` |

## The functions (`supabase/functions/inngest/`)

| Function | Trigger | Does |
|---|---|---|
| `outbox-sweeper` | every minute | re-sends unconfirmed outbox events, marks them sent |
| `outbox-prune` | daily 04:15 IST | removes sent events older than 14 days, and team alerts older than 30 days |
| `team-alert` | support / withdrawal / payout failed / dispute events | writes a message to `admin_alerts` |
| `daily-digest` | daily 09:00 IST | writes the day's totals to `admin_alerts` |
| `crm-rules` | every 3 hours | calls `run_crm_rules()`: the automation rules an admin switched on (Admin → Rules) create follow-up tasks, once per rule per person |
| `nightly-reconcile` | daily 02:30 IST | calls `run_reconciliation()` (our own money checks), then compares the last 3 days of payments with Razorpay payment links and saves both to `reconciliation_runs`; a difference leaves an `admin_alerts` row. Reports only, never changes money |
| `auto-complete-due` | every 15 min | calls `run_auto_complete_due()` |
| `settle-cleared-earnings` | every 5 min | calls `settle_cleared_earnings()` |
| `settle-finished-campaigns` | hourly at :07 | calls `settle_finished_campaigns()` |
| `push-notification` | event `notification.created` | reads the message from the database, sends it to Expo, waits 15 minutes, reads Expo's receipts and forgets devices that are gone |
| `account-files` | event `user.deleted` | removes whatever files of the deleted account are still in storage (the api function already tried once); empty when nothing is left |
| `overdue-tasks` | every 10 min | calls `run_overdue_tasks()`: a started job past its due time becomes `OVERDUE`. Only the label changes; no money moves |
| `housekeeping` | hourly at :17 | calls `run_housekeeping()`: removes expired sign-in codes, send and search counters, rate counters, password attempts older than 30 days, notifications older than 90 days |

The three money sweeps are **off** until `INNGEST_MONEY_JOBS=on`, because pg_cron runs them
today (see "Moving the money sweeps"). Every function reports its final failure to
Sentry.

Push, `account-files`, `overdue-tasks` and `housekeeping` need migration 101. Push also has a
switch (next section). `notification.created` holds ids and the kind only: the title and body
are read by the Edge Function and handed to Expo, and Inngest keeps only counts and a one-way
key per device.

## Moving push and the prunes

Pushes keep going out the old way, straight from the database, until the settings row
`push_via_inngest` is `true`. So nothing breaks while Inngest is being set up.

1. Apply migration 101, redeploy the `inngest` function, and see the four new functions in the Inngest dashboard.
2. Invoke `housekeeping` and `overdue-tasks` once each and see them green.
3. Run `supabase/cutover/inngest_background_jobs.sql` by hand. It turns the switch on and unschedules the two old prune jobs.
4. Try it on a phone: do something that notifies you and see a `push-notification` run and the buzz.

To go back: `update public.settings set value = 'false' where key = 'push_via_inngest';` (at once, no deploy). The same file lists the two `cron.schedule` lines for the prunes.

The web has no push; in-app notifications and live updates do not go through Inngest.

Team messages land in `public.admin_alerts` (admins can read them, nobody else).
The admin app's alerts view reads that table.

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
- `npm run test:db` runs `supabase/tests/outbox.test.sql`: events are queued with the
  change, carry no contact details, the sweeper sees only old unsent events, only the
  service role can call the Inngest-facing functions, the old automation tool's leftovers
  are gone (migration 102), and no event or alert carries free text.

## Not moved yet (still in the plan, Phase 5)

Withdrawal payouts with retries, stuck-payout reconciliation, refund retries and webhook
hand-off. They touch the money flow, so they wait for the lawyer's answer (R3). Each is moved
one at a time, with the old job removed in the same deploy as its replacement. Do not add new
pg_cron jobs while this is in progress.
