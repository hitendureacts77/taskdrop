# Running the business without the console

The owner console was removed from the app. The three jobs it did still have to
be done by someone, and the functions that do them are still in the database —
they are just no longer reachable by tapping.

Run these in the **Supabase dashboard → SQL Editor**, signed in as the project
owner. The SQL Editor runs as `postgres`, which satisfies the admin checks
inside each function.

---

## 1. Paying a worker

This is the one that cannot be skipped. A worker requests a withdrawal, the
money leaves their wallet immediately, and the payout sits at `requested`
until someone marks it. Nothing else moves it.

It has its own command now, because the SQL below was missing the one thing the
job actually needs — a bank destination is masked in `payouts.destination` and
cannot be paid into:

```bash
npm run payouts                        # who is owed what, and where to send it
npm run payouts paid <id> <reference>  # after the money has left
npm run payouts failed <id> "<why>"    # bounced — refunds their wallet
```

Send the money yourself over UPI, which costs nothing. The listing prints a
`upi://` link that opens straight into a UPI app with the amount filled in.
[PAYING_WORKERS.md](PAYING_WORKERS.md) covers why this is by hand, what the
providers charge, and when to automate it.

Still doable in the SQL Editor if you prefer:

```sql
select * from public.admin_payout_queue();
select public.admin_mark_payout('<payout id>', 'paid', '<upi reference>');
select public.admin_mark_payout('<payout id>', 'failed', 'Bank rejected the VPA');
```

A payout already marked `paid` or `failed` cannot be re-marked, so a mistake
here is not silently correctable — check the id before running it.

> **If these raise `Admins only`**, migration 037 has not been applied yet.
> Before it, `private.is_admin()` was `has_role(auth.uid(), 'admin')` and
> nothing else — and `auth.uid()` is null in the SQL Editor, so every function
> on this page refused the owner. Apply
> `supabase/migrations/20260916100000_037_operator_can_pass_admin_checks.sql`.

---

## 2. Settling a dispute

Escrow on a disputed task is frozen. Neither party can move it, and the task
stays stuck until this runs.

**See them:**

```sql
select t.id, t.title, t.locked_minor / 100.0 as rupees,
       p.display_name as poster, t.updated_at
from public.tasks t
join public.profiles p on p.id = t.poster_id
where t.status = 'DISPUTED'
order by t.updated_at;
```

**Decide:**

```sql
-- The work stands: releases to the worker, as a normal completion would.
select public.admin_resolve_dispute('<task id>', 'worker', 'Photos supported the worker');

-- Or refund the poster and cancel the task.
select public.admin_resolve_dispute('<task id>', 'poster', 'Work was not delivered');
```

Either way it is written to `cancellations_log` with your reason.

---

## 3. Releasing cleared earnings

Completed work sits in `clearing_minor` for seven days, then has to be moved
into `balance_minor` before a worker can withdraw it.

**This is no longer a manual job.** The app sweeps whenever anyone opens their
wallet or the withdraw screen, and one person opening it settles every worker
who is due, not just themselves. `settle_cleared_earnings()` is granted to
`authenticated` for exactly that reason — it only ever moves money that is
already owed.

Migration 038 adds the nightly `pg_cron` job as well, so the figures stay right
for someone who is not in the app. Apply it and this section needs nobody.

By hand, if you want to force it:

```sql
select public.settle_cleared_earnings();
```

It returns how many tasks it settled, and is safe to run as often as you like —
a task is settled at most once.

---

## 4. Refunding a cancelled task

Cancelling now refunds the poster by itself: the app asks Razorpay for the
refund the moment `cancel_task()` succeeds. This section is for the times it
does not — the poster closed the app mid-cancel, Razorpay was down, or the
task was cancelled by a dispute ruling rather than by the poster.

**See what is owed:**

```sql
select task_id, title, due_minor / 100.0 as rupees,
       provider_payment_id, cancelled_at
from public.refunds_outstanding
order by cancelled_at;
```

Anything listed here is money TaskDrop is holding that belongs to a poster.
The list should normally be empty.

**Send it** from the Razorpay dashboard against `provider_payment_id`, for
exactly `due_minor`, then write it down so the row stops appearing:

```sql
select public.record_escrow_refund('<payment id>', '<rfnd_... from Razorpay>', <amount in paise>);
```

`due_minor` is the escrow less anything already refunded and less the 5%
penalty the worker was paid out of it. Do not refund the gross amount — the
worker's share has already left.

---

## Checking the numbers

```sql
select public.platform_stats(30);
```

Revenue, volume, escrow held, payouts pending, disputes open. The same figures
the analytics screen shows, which is still in the app under
**Profile → My spending and requests** / **My earnings and jobs**.

---

## If you want the console back

Nothing was dropped from the database — only the screen and its client
wrappers. `git revert` the commit that removed it, or ask for the two actions
to be put somewhere they fit better: disputes alongside the task in **Requests**,
payouts alongside the money in **Wallet**.
