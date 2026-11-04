# Bug and security hunt, round 1 (plan task 2.14)

Started 3 November 2026 on staging (`wjxvingpfbfvkfqhrguj`), with the fake accounts only. Every database trial ran inside a transaction that was rolled back, so nothing on staging was changed. Code read at `redesigned-2.0` commit `6fbaa3b`.

## Summary for you

- **1 High, fixed:** withdrawals lost three safety checks on 4 October (H32). The ₹1 lakh per-withdrawal limit is back (migration 145), with a test proving it was missing and is now enforced, and a new permanent test that catches any database function losing a check this way again.
- **2 for your decision:** asking for name and PAN before a withdrawal (dropped on 4 Oct; the app has no screen for it), and whether every staff role, including the read-only Viewer, may download everyone's phone numbers and emails (H33).
- **1 Medium, needs building:** wallets keep only a running total, with no record of each movement, so nobody can prove the books balance (H34). Not urgent on fake money; needed before real money.
- **1 Low, fixed:** the test-data seed files skipped the location rounding, so 13 staging tasks show a point about 11 m precise instead of about 1 km (B15).
- **Held up well:** the payment webhooks (signature checked, a repeated message cannot pay twice), the top-up credit, the new task questions and the nearby counter, every admin route (each checks the sign-in itself), and every automatic check (256 unit tests, typecheck and lint pass; npm audit 0 high, 14 moderate).
- **Not run yet:** part D (every move in a task's life), part G (screens on the website and phone, needs the phone), the rest of part E (Ideas board, streaks, crew jobs) and part H (Inngest jobs, push, photo location data with a real photo). These are the next session.

## A. The doors (first count)

| Door | Count | Notes |
|---|---|---|
| `api` actions | 123: 67 reads, 52 writes, 4 media | All go through one limiter (300 reads, 60 writes, 20 uploads a minute per person), the account standing check and the admin switches. A batch may carry reads only |
| Database functions a signed-in person can run | 132 (113 at round 1 on 1 Nov) | All pass `rpc_caller_checks.test.sql`, but that test only looks for a caller check in the text, so part C and E read the new ones by hand |
| Database functions a signed-out person can run | 1 (`get_app_controls`) | Accepted in the plan |
| Other server functions | `phone-auth`, `password-auth`, `places-search`, `app-config`, `razorpay`, `razorpayx-payouts`, `razorpay-webhook`, `razorpayx-webhook`, `inngest` | Webhooks are public on purpose and checked by signature |
| Admin server routes | 7 (sign-in, ping, live, people export, leads export, reports export, sign-in callback) | Each checks for a signed-in staff member itself |

The full list of every action with who may call it is part of the next session.

## B. Automatic sweep

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, 256 unit tests) | Pass |
| `npm audit --omit=dev` | 0 critical, 0 high, 14 moderate (no change in level since 2.6) |
| Supabase security advisor | Nothing new: 9 private tables with no row rules (closed to the app on purpose), `get_app_controls` signed out (accepted), leaked-password protection off (H11, production 5.2), 132 owner-rights functions callable when signed in (see A) |
| **New: a scan of all 148 migrations** comparing each function with its previous version | Found H32. Now a permanent test, `scripts/check-lost-refusals.mjs`, in `npm test` |

## C. Money

| What was tried | Result |
|---|---|
| Payment webhook: wrong or missing signature | Refused (constant-time compare) |
| Payment webhook: the same "paid" message twice | Safe. `fund_task_from_payment` locks the task and returns early once funded; `credit_topup` locks the payment and marks it credited |
| Paid amount smaller than the job | Not funded (checked against the escrow amount) |
| Withdrawal: two at once | Safe. The wallet row is locked before the balance check |
| **Withdrawal: more than ₹1 lakh at once from an established account** | **Allowed. H32, fixed in migration 145** |
| Top-up money can be withdrawn | Your decision of 29 Sep (migration 066: one wallet). The safeguard it relies on, a person reviewing each withdrawal, holds only while `payout_method` is `manual` (it is today). See H33's note below |
| Books balance (wallets against completed work, refunds, top-ups and withdrawals) | Cannot be proven: there is no record of each wallet movement, and early test data and the seed files set balances directly. H34 |

Read-only checks that passed on staging: no negative wallet; no task paid twice; no completed task without funding or without a helper; no refund larger than its payment; no task with two helpers; every funded amount equals its payment.

## E. Features since 1 November (part)

| Feature | Result |
|---|---|
| Task questions (migration 140) | Sound: only the poster answers; strangers read only open tasks; blocked and hidden tasks give nothing; contacts and links refused; 3 per task, 20 a day |
| Nearby pulse | Counts only, with a 2 km minimum radius over locations already rounded to about 1 km, so it reveals no more than the public map |
| Helpers on the map (`workersNear`) | Uses the rounded area only. Confirmed on staging: every helper location has at most 2 decimals |
| **Tasks on the map** | **13 tasks have a point precise to about 11 m (B15).** Cause: the seed files load data with triggers off |

## F. Admin app (part)

All 7 server routes check for a signed-in staff member themselves, the exports write to the audit log before they build a single row, and Sales cannot see money. **H33:** the people export adds every person's email and phone number for any staff role, including Viewer.

## Findings

| # | Finding | Level | State |
|---|---|---|---|
| H32 | Migration 071 (4 Oct, adding "no withdrawal while suspended") rewrote `request_withdrawal` from an older copy and lost three checks from 066: the most per withdrawal (₹1 lakh), "add your name and PAN first", and the account holder's name on a bank account. Proven on staging: an established account could ask for more than ₹1 lakh at once | High (before real money) | **Fixed** in migration 145 with `supabase/tests/withdrawal_limits.test.sql` (fails on the old function, passes on the new one). **PAN not put back:** the app has no screen to enter it and no one has one saved, so it would block every withdrawal. Your decision |
| H33 | Any staff role, including the read-only Viewer, can download one spreadsheet with every person's name, email and phone number (`/api/crm/export`) | Medium | Your decision: limit the contact columns to Admin and Support? |
| H34 | Wallets are one running number per person, changed in place by many functions. There is no record of each movement, so the books cannot be proven to balance and a wrong change would be hard to find | Medium (High once money is real) | To build before Step 5: an add-only list of wallet movements written by every money function, and a test that each balance equals its list |
| B15 | The test-data seed files load with triggers off, so the 074 location rounding never ran for their tasks; 13 staging tasks publish a point about 11 m precise and have no private copy | Low (fake data) | **Fixed** in both seed files (they now round and keep the exact copy). The 13 rows are corrected the next time the test data is reset, which waits for your yes |
| Note | The comment in `razorpay-webhook` says top-ups are "never withdrawable"; since 066 they are | Low | Comment to correct with the next change there |
| Note | If `payout_method` is switched to RazorpayX, withdrawals go out with no person looking first, so "add by card, withdraw to UPI" (the cash-out route 066 warned about) is limited only by the new-account cap of ₹5,000 a day | Medium at launch | Put to the lawyer (S.3) with the 066 note; consider a hold on money that came from a top-up |
