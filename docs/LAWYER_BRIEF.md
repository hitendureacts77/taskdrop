# Brief for a lawyer: how TaskDrop moves money

Prepared 2026-10-20 from the code on `redesigned-2.0`, for the owner to send. It is a fact sheet plus questions, **not legal advice**, and it was written by an engineer, not a lawyer. Nothing here is live with real customers: the app is in testing with fake data. The answer is needed before Phase 5 (payouts and refund retries are built but switched off until then; see `docs/UPGRADE_PLAN.md`, risk R3).

Companion documents: `docs/LEGAL_AUDIT.md` (what the Terms and Privacy drafts say and why, with open gaps G1 to G14) and `docs/legal/` (the rendered drafts).

## 1. What TaskDrop is

An online marketplace in India (₹, UPI). A person posts a task in plain words (local or remote); other people send offers; the poster picks one; the work is done; the poster approves. TaskDrop does not employ or supervise anyone. Users must be 18 or older (age gate at sign-up).

## 2. The money flow, step by step

| Step | What happens | Where it is decided |
|---|---|---|
| 1 | The poster chooses an offer. They pay the **offer price + a service fee** through **Razorpay**. The fee is **3% by default**; the live value is the admin-editable setting `poster_service_fee_pct`, so it can change. | Server only; default in `packages/rules`, live value in the `settings` table |
| 2 | The money is **held** (the code calls it escrow) while the work is done. The worker sees it is protected. | Postgres rules + Razorpay webhook |
| 3 | The worker submits proof of work. The poster has **3 days** to approve, ask for a revision, or report a problem. If they do nothing the task **auto-completes**. | Scheduled job |
| 4 | On completion the worker is credited the price **minus an admin-set commission (currently 10%)**. Earnings sit as "clearing" for **7 days**, then become available. | Postgres |
| 5 | The worker **withdraws** to UPI or a bank account through **RazorpayX payouts**, after giving a legal name and PAN. Minimum ₹100. | RazorpayX + `payout_profiles` |
| 6 | Cancelling **after work has started, for the normal reason**, costs the poster a **5% fine**; the rest is refunded. Cancelling because the worker is overdue is a separate case that the rules do not fine (ask the owner to confirm how it behaves before relying on this). Before work starts, a cancel is refunded in full. | Postgres |
| 7 | Disputes are decided by TaskDrop staff in an admin panel, who can release to the worker or refund the poster. | Admin panel, audit-logged |

Other things that matter for the questions below:

- **One wallet per user.** Top-ups, earnings and refunds sit in a single balance that is spendable on tasks and withdrawable (migration 066). Posters can also hold **credits**.
- As far as the code shows, payments are collected by Razorpay and payouts go out through RazorpayX from a current account whose number is a configured secret; the app keeps the balances (escrow, wallet, clearing) in its own database. **Which entity legally holds the money between steps 1 and 5, and whether those database balances count as holding it, is exactly what we need confirmed.** (The owner should correct this paragraph if the Razorpay setup differs.)
- A suspension blocks withdrawals; money already owed is kept (Terms draft).
- Payments and payouts are idempotent and logged; refunds retry automatically (built, off until your answer).

## 3. Questions

**A. RBI and payments (the main one)**
1. Does holding the poster's money until approval, and then crediting a **withdrawable wallet**, make TaskDrop a prepaid payment instrument issuer, a payment aggregator, or neither? Does the wallet need RBI authorisation?
2. If authorisation is needed, what is the smallest structure that avoids it: for example Razorpay's marketplace product (Route) holding the funds and splitting payouts, with TaskDrop only instructing it? What would change in the product (wallet, credits, 7-day clearing)?
3. Is a **5% cancellation fine** (normal post-start cancels only) (normal post-start cancels only) and a **7-day clearing delay** acceptable, and how should they be disclosed?
4. KYC: is name + PAN before the first withdrawal enough, or is more needed (for example for amounts above a threshold)?

**B. Tax**
5. **GST** on the poster service fee (3% by default) and the worker commission: who charges it, at what rate, and what invoice does each side need?
6. **TDS / TCS** for an e-commerce operator paying out to workers: does it apply, from what amount, and how is it reported? (`LEGAL_AUDIT.md` G14.)

**C. Platform duties**
7. As an intermediary: grievance officer, takedown timelines, and the Consumer Protection (E-Commerce) Rules. Is our draft (24-hour acknowledgement, 15-day resolution) right? Who must be named? (`G1`, `G2`.)
8. Are workers independent providers, and does anything in the flow (admin-set commission, staff dispute decisions, ratings) weaken that?
9. Liability if a task goes wrong in the physical world (local tasks) or if a remote task is illegal. What must the Terms say, and should there be a mandatory dispute or arbitration clause?
10. Copyright: we show a DMCA-style agent page; what is the right Indian notice-and-takedown route, and does a US DMCA agent also matter?

**D. Data**
11. **DPDP Act:** consent versus "legitimate use" for the data listed in `LEGAL_AUDIT.md` section 3, retention periods, children (we require 18+), and the deletion promise (what we keep after an account is deleted: paid tasks, payment history, PAN if paid out, disputes). Anything to add before launch?
12. Cross-border: Supabase (Mumbai), Sentry, Vercel, ImageKit, Google and MSG91 process data. Is any notice or contract needed?

## 4. Please also tell us

- What we must change before real money moves, in order of priority.
- What can wait until after launch.
- Whether we need any registration (company, GST, payment aggregator, data fiduciary) and who is responsible for each.

## 5. What to attach

`docs/LEGAL_AUDIT.md`, the two files in `docs/legal/`, and a screen recording of one task going from post to payout (record it on the test project; all money is fake).
