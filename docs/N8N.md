# n8n for TaskDrop

TaskDrop **tells** n8n when something happens. n8n never reads or changes anything
in TaskDrop: it has no database access, no API key, no admin rights. That is on
purpose, so an n8n mistake can send a wrong message but can never move money,
change a wallet or suspend someone.

Migration `080_n8n_events` does the sending. Until an address is set it only writes
each event to `private.automation_log` (kept 30 days), so it is safe while n8n is
not connected.

## Events

Each one is a POST with this JSON body, plus the headers `X-TaskDrop-Event: <event>`
and, if you set a secret, `X-TaskDrop-Secret: <secret>`:

```json
{ "event": "withdrawal.requested", "at": "2026-10-04T10:15:00Z", "data": { ... } }
```

| Event | When | `data` |
|---|---|---|
| `user.signed_up` | a new account is created | `user_id`, `name` |
| `support.opened` | someone sends a help request | `ticket_id`, `category`, `subject` (first 80 characters), `from` |
| `withdrawal.requested` | a worker asks to withdraw | `payout_id`, `amount_rupees`, `name`, `via` (`razorpayx` or `manual`) |
| `payout.failed` | a withdrawal fails and the money goes back | `payout_id`, `amount_rupees`, `name`, `reason` |
| `dispute.opened` | a job is disputed | `task_id`, `title`, `poster` |
| `digest.daily` | every day at 9:00 IST | `date`, `people_total`, `new_people`, `jobs_posted`, `jobs_finished`, `earned_rupees`, `withdrawals_waiting`, `withdrawals_waiting_rupees`, `open_disputes`, `open_help_requests` |

Events never contain phone numbers, emails, bank details or UPI ids.

## Switching it on

In n8n, add a **Webhook** node (method POST) and copy its *production* URL. Then,
in the Supabase SQL editor:

```sql
insert into private.automation_config (key, value) values
  ('n8n_webhook_url', 'https://YOUR-N8N/webhook/taskdrop')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- optional: n8n can check this header to be sure the call is from TaskDrop
insert into private.automation_config (key, value) values ('n8n_webhook_secret', 'a-long-random-string')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Pause everything without deleting the address:

```sql
insert into private.automation_config (key, value) values ('n8n_enabled', 'off')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

See what was sent: `select * from private.automation_log order by id desc limit 20;`
(`sent = false` means no address was set at the time).

## Keep n8n notify-only

Good uses: alert the admin, a daily summary, a welcome message, a follow-up
reminder. Anything that touches money (payouts, refunds, wallets) or accounts
(suspend, admin roles) stays in the admin panel, behind its own confirm step.
