# Runbook: what to do when something goes wrong

For whoever is on call for the admin panel. Written from how the code works on 2026-10-21; where a step depends on something that is not switched on yet, it says so. Everything here is done in the admin panel unless stated. Money actions ask for the authenticator code first (Security page); if you have not set it up, do that before you need it.

Two rules for all of it:

1. **Say why.** Every admin action asks for a reason and writes to the audit log (`admin_audit_log`; a person's page, Audit tab, shows what was done to them).
2. **Money moves only on the database's word.** Nothing here edits a balance by hand. If a step seems to need that, stop and ask.

## Where problems show up

| Where | What it tells you |
|---|---|
| Admin panel, **Needs you now** (home) | Everything waiting on a person, ranked by how close it is to a deadline |
| Admin panel, **Alerts** | Messages the background jobs left: withdrawal waiting, payout failed, help request, dispute, daily digest |
| Sentry (org `hitendu`) | Errors from the app, the admin and every server function. A `fatal` issue means money moved and the books may not know |
| Uptime monitors | `api` health, `taskdrop.in`, the admin (once Uptime Robot is set up, Phase 1) |
| **Money check** (`/money/reconcile`) | Payments, wallets and payouts that do not add up |

## A withdrawal is stuck

Signs: a withdrawal at `requested` or `processing` for more than a day, an Alerts entry "payout failed", or a worker writing in.

1. **Payouts** page. Open the withdrawal. It shows its status and, for RazorpayX, the provider status and note.
2. **Check all** asks RazorpayX where every open payout stands and records the answer. Do this first; most "stuck" payouts are only unrecorded.
3. If RazorpayX says it **failed, was rejected, cancelled or reversed**, the money goes back to the worker's wallet by itself when it is recorded. If it says it **has no payout** under this withdrawal's reference, use **Give back** (with a reason): it returns the money only after RazorpayX confirms there is no payout.
4. If payouts are set to **manual** (Payouts, settings), a person pays by hand: `npm run payouts` lists who is owed what and gives a UPI link; mark it paid with the reference afterwards (`npm run payouts paid <id> <reference>`). Never mark paid before the money has left.
5. Sentry issue **"PAYOUT MADE BUT NOT RECORDED"** (fatal): RazorpayX made the payout but our database did not record it. Do not send it again. Open the withdrawal, press **Check all**; recording is idempotent. If it still shows `requested`, find the payout in the RazorpayX dashboard by the withdrawal id (the reference) and tell the person who maintains the code, with the payout id.

## A refund did not go through

Signs: the **Refunds** page lists money owed; Sentry fatal **"REFUND SENT BUT NOT RECORDED"**; a poster saying their money has not come back.

1. **Refunds** lists cancelled jobs the poster paid for by card or UPI whose refund has not gone out, with the amount due and the Razorpay payment id. Jobs paid from the TaskDrop wallet are refunded to the wallet automatically and never appear here.
2. Before pressing **Send refund**, look the payment id up in the Razorpay dashboard. If Razorpay already shows a refund as **processed**, do not send another: the money is on its way (banks take a few days) and only our record is behind.
3. If there is no refund on Razorpay, press **Send refund** and confirm. It asks Razorpay to send the amount due back to the card or UPI the poster paid with, and cannot be undone.
4. "REFUND SENT BUT NOT RECORDED": the refund left and our record failed. Do not send it again. Tell the person who maintains the code, with the task id from the Sentry event.

## A report came in

Aim to act within 24 hours; reviewers from the stores will report too.

1. **Reports** page, **Open**. Each card shows what was reported; for a message it shows what it says.
2. Decide:
   - **Hide this message** (message reports): neither person in the chat sees it any more; it is kept.
   - **Hide this job** (open the job from the card): only its poster and admins see it.
   - **Suspend** the person (their page): signs them out and stops sign-in and withdrawals. Their jobs and money stay where they are. Needs a reason.
   - **Sign out everywhere** (their page, Devices tab) if an account may be in someone else's hands.
3. Close the card with **Mark acted on** or **Dismiss**, and write what you did.
4. A person who is blocked can no longer bid on, message or see the open tasks of the person who blocked them. You do not need to do anything for that.

## A dispute

**Disputes** page. The money is frozen in escrow until you decide.

1. Open the job. Read what was asked, the quotes, the chat, the proof and any reviews.
2. **Pay the worker** if the work was done: they get their share, TaskDrop keeps its commission.
3. **Refund the poster** if it was not: the job is cancelled and everything they paid, service fee included, goes back to their TaskDrop wallet.
4. Both are final. If it is not clear, ask each side what happened (through Help requests, or a message from the person's page in the Customer hub) before deciding.

## The app is broken for everyone (maintenance mode)

**Settings, App controls.** Pick the platform (or all), switch **Maintenance** on and write the message people will see ("Back in 30 minutes"). Apps notice within about a minute. Individual switches can also turn off just posting, offers, top-ups, withdrawals, promotions, chat photos, or any sign-in method, per platform. A **minimum version** shows "Update the app" to older builds. Switch maintenance off when done.

Sign-in itself keeps answering during maintenance with the same message, so people are not left guessing.

## A payment was taken but the job is not funded

Signs: **Money check** lists "paid, not credited" or "funded without a paid payment"; a poster says they paid and the worker cannot start.

1. **Money check** shows the payment and the task.
2. The payment link settles by itself when the poster returns to the app, and by webhook. Ask the poster to open the task once; that triggers a check.
3. If it stays unfunded, the Sentry issue "paid but could not fund task" has the payment id. Do not refund yet; tell the person who maintains the code.

## Uptime alerts

- `api` health failing: open Sentry for the `api` function. The health check only fails when the database does not answer; check Supabase's project status first.
- `taskdrop.in` failing: check Vercel (project `taskdrop`), the latest deployment, and DNS at Spaceship.
- Admin failing: Vercel project `taskdrop-admin`.

## After any incident

Write two lines in the audit trail (the reason fields do this) and, if code was at fault, add a test with the fix. If the incident touched real money, tell the owner the same day.
