# TaskDrop admin panel

Staff-only web panel for running TaskDrop: money, jobs, people, disputes, refunds, help requests and settings.

## Run it

```bash
# from the repo root
npm install
cp apps/admin/.env.example apps/admin/.env.local   # then fill in the keys
npm run dev --workspace @taskdrop/admin             # http://localhost:3001
```

`.env.local` needs:

| Key | Where to find it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Already filled in |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page, "anon / publishable" | Safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page, "service_role" | **Server only. Never add `NEXT_PUBLIC_`.** Needed for the Refunds list, Razorpay payment ids and people's phone/email. Everything else works without it. |

Sign in with an account that has the `admin` role in `user_roles`. Anyone else is sent to "not authorized".

## Database changes that come with this panel

Two migration files are in `supabase/migrations/`. Read them, then apply them the way you apply the others (`supabase db push`, or paste them into the SQL editor):

- **060_admin_earnings_daily** – adds up earnings per day in the database, so the 1-year, 5-year and all-time charts stay fast. The panel works without it; it just reads more rows.
- **061_fix_admin_resolve_dispute** – `admin_resolve_dispute` currently fails on every call (it writes values that don't exist in `assignment_status`, `cancelled_by` and `cancel_reason`). Until this is applied, the "Decide this dispute" buttons show an error and nothing changes. The fix also makes a poster refund go back the way they paid (card/UPI, via Refunds) instead of into their wallet, so a poster can't be refunded twice.

## What each screen does

| Screen | What you can do |
| --- | --- |
| Dashboard | TaskDrop's earnings today and in total, money held in escrow, paid to workers today and in total, what's waiting for you, whose money is in the account |
| Earnings & escrow | Earnings by type (today / chosen range / total), chart from 7 days to all time with a named comparison line, every job in escrow, who each rupee belongs to |
| Earnings entries | Every line in the company ledger, filterable by day and type |
| Worker payouts | Send each withdrawal (UPI link, copy buttons), then record it: sent (with UTR), being sent, or put back in the worker's wallet |
| Refunds | Posters owed money from cancelled jobs; "Send refund" asks Razorpay to return it |
| Jobs / a job | Every job with filters; a job's money, timeline, quotes, and dispute decision |
| People / a person | Everyone, their wallet, jobs posted and worked, withdrawals, ratings |
| Disputes | Open disputes, oldest first |
| Help requests | Read and reply (they get a notification), mark resolved |
| Promotions | Paid job boosts |
| Reports | Jobs, people and earnings over 7 days to a year |
| Settings | Commission, service fee, waiting periods and more, each change confirmed first |

Every button that moves money opens a panel that says exactly what will happen to whose money before anything is sent.

## Payouts are manual (for now)

No payout provider is connected, so the panel never sends money itself. You pay from your UPI app or bank, then record it. Connecting RazorpayX or Cashfree Payouts later would let the "I've sent it" step happen automatically.
