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

**See what is owed:**

```sql
select o.id, p.display_name, o.amount_minor / 100.0 as rupees,
       o.destination, o.status, o.created_at
from public.payouts o
join public.profiles p on p.id = o.user_id
where o.status in ('requested', 'processing')
order by o.created_at;
```

**Send the money** — by UPI or bank transfer, to the `destination` shown —
then record it:

```sql
select public.admin_mark_payout('<payout id>', 'paid');
```

**If the transfer bounces**, this puts the full amount back in their wallet:

```sql
select public.admin_mark_payout('<payout id>', 'failed', 'Bank rejected the VPA');
```

A payout already marked `paid` or `failed` cannot be re-marked, so a mistake
here is not silently correctable — check the id before running it.

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
into `balance_minor` before a worker can withdraw it. Nothing does this on a
schedule yet, so **until it is automated, a worker's money stops here.**

```sql
select public.settle_cleared_earnings();
```

It returns how many tasks it settled, and is safe to run as often as you like —
a task is settled at most once.

**Automate it.** Enable `pg_cron` (Supabase → Database → Extensions) and this
runs it nightly:

```sql
select cron.schedule(
  'settle-cleared-earnings',
  '0 2 * * *',
  $$select public.settle_cleared_earnings()$$
);
```

That removes the one job on this page that genuinely cannot wait for someone to
remember it.

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
