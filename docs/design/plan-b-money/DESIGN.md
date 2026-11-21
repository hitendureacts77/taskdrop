# Plan B money flow: the design (task 2.21)

Written 18 Nov 2026, when you said "lock the Plan B feature for payments and implement the Plan B design".
Plan B is now **locked**: TaskDrop never holds a balance. Each task is paid for on its own, the payment
company holds the money, and the app's wallet becomes a read-only record of each task's money.

The payment company is **Razorpay Route** (decision 3, decided 19 Nov 2026: "we will be using Razorpay for
Plan B"; Cashfree is out). The provider details, with every point still to confirm in writing, are in
[`docs/integrations/razorpay-route.md`](../../integrations/razorpay-route.md). One risk stays open: Route's
documented rule asks for more than ₹40 lakh domestic turnover, so S.4 asks Razorpay in writing whether a new
TaskDrop can have it.

## 1. What changes, in one table

| Today (Plan A, wallet) | Plan B (locked) |
|---|---|
| The poster tops up a wallet, then pays for tasks from it | The poster pays for **this one task** at the payment company when they hire |
| Money sits in TaskDrop's own account | Money sits **on hold at the payment company**, marked for the chosen worker |
| On approval the worker's wallet gets the earnings, which clear for 7 days, then the worker asks to withdraw | On approval the server tells the payment company to **release** the worker's share to the worker's bank or UPI |
| A cancelled task's money goes back into the wallet | A cancelled task's money goes back to the **card or UPI it came from** |
| The wallet screen shows a balance | The wallet screen shows a **record**: paid, on hold, released, refunded. No balance |
| Withdraw screen, Add money sheet | Gone under Plan B. Workers add their bank or UPI once ("Get paid" setup) |

## 2. How money moves (the rows every money test covers)

Amounts, all in paise, worked out in one place (`packages/rules` `planBSplit`, and the same sums in
`private.plan_b_amounts` in the database):

- `offer` = the price the poster accepted.
- `charged` = `round(offer × 1.03)`: what the poster pays (the 3% service fee is inside it).
- `commission` = `round(offer × 0.10)`, the admin-set rate.
- `worker_share` = `offer − commission`, never more than `charged`.
- TaskDrop keeps `charged − worker_share` (fee + commission).

| # | Moment | What the server does | Who holds the money |
|---|---|---|---|
| 1 | Poster hires (offer accepted) | The task is LOCKED and a **hold** row is opened, "waiting for payment". The worker must already be set up to be paid | Nobody yet |
| 2 | Poster pays | Razorpay takes `charged` on an Order whose transfer marks `worker_share` for the worker's linked account, **on hold**. The hold becomes "held", the task is funded, work can start | Razorpay |
| 3 | Worker marks done | Nothing moves. 3 days to approve or report | The payment company |
| 4 | Poster approves, or 3 days pass | The hold becomes "release asked". The money worker releases `worker_share` to the worker. TaskDrop's part settles to TaskDrop | Worker and TaskDrop |
| 5 | Poster cancels before work starts | Full refund of `charged` to the original card or UPI | Back to the poster |
| 6 | Poster cancels after work starts | `fine` = `round(offer × 0.05)` is released to the worker; `charged − fine` is refunded | Split |
| 7 | Worker walks away | Full refund of `charged`; the task opens again; a new hire pays again | Back to the poster |
| 8 | Dispute | The hold stays on hold. Staff decide: worker wins = row 4, poster wins = row 5 | The payment company |

## 3. Three safety rules

1. **Nothing pays twice.** Every provider message is recorded once (the webhook keeps the event id).
   Every release and refund has its own key (`release:<hold id>`, `refund:<hold id>`), sent to the payment
   company as its idempotency key and stored on the hold, so a repeat call or a double tap cannot move
   money a second time. A hold moves through its states only forward, under a row lock.
2. **A daily match.** Each night the server adds up its own ledger for the day and compares it with the
   payment company's settlement report. Any difference is written to `money_match_runs` and raises the
   `money_mismatch` alarm (task 2.11).
3. **An emergency stop for money.** One switch in the admin app (Admin role, authenticator code, written
   to the audit log) pauses **new payments and releases** at once: every server path reads it on every
   call, so it takes effect in under a minute, with no app release. **Refunds keep working.**

## 4. Database (migration 195, adds only)

| New thing | What it is | Who can read it |
|---|---|---|
| setting `money_flow` | `wallet` (today) or `plan_b`. **The undo switch.** | server |
| setting `money_provider` | `razorpay_route` or `simulated` (staging only) | server |
| setting `money_paused` | the emergency stop | server; admin app shows it |
| table `payout_accounts` | the worker's account at the payment company: provider, provider account id, status (`pending`, `active`, `rejected`). **No bank or UPI numbers are stored**: they go straight to the payment company | the worker (own row), money staff |
| table `task_holds` | one row per paid task: provider ids, the amounts above, the state, the release and refund keys | the poster and worker of that task, money staff |
| table `money_ledger` | append-only record of every money event (charge, hold, release, commission, fee, refund, fine). Rows can never be changed or deleted. Closes **H34** | each person sees their own rows; money staff see all |
| table `money_match_runs` | one row per nightly match | money staff |

Hold states (forward only):

```
awaiting_payment ─► held ─► release_asked ─► released
        │             ├──► refund_asked ─► refunded
        │             └──► split_asked  ─► split        (cancel after start)
        └──► expired  (not paid within 24 h: the task opens again)
any "…_asked" ─► failed (provider refused; staff can retry)
```

A dispute has no state of its own: the hold simply stays `held` until staff decide (row 8).

Changed functions, **only when `money_flow = 'plan_b'`** (under `wallet` they behave exactly as today):

- `lock_bid` and the auto-hire trigger: no wallet charge. Refuse if the worker's payout account is not
  active ("This worker has not set up payments yet"). Open the hold.
- `confirm_release`, `auto_complete_due`, `admin_resolve_dispute` (worker wins): no wallet credit. The
  hold moves to `release_asked` and an outbox event `money_move` is written.
- `cancel_task` and `admin_resolve_dispute` (poster wins): no wallet refund or fine credit. The hold moves
  to `refund_asked` or `split_asked`.
- `credit_topup`, `pay_task_from_wallet`, `hunt_accept_find`'s wallet charge: refused ("Top-ups are
  closed. Pay for each task when you hire."). Withdrawing an old leftover balance still works, so no one's
  money is stuck (staging only; production starts with no balances).

New functions (service role only, except the reads):

- `plan_b_checkout_terms(task)`: the amounts and ids the `money` function needs to start a payment.
- `plan_b_mark_paid(hold, provider ids, amount)`: amount must match `charged` exactly, else the hold is
  kept for a person (as H76 does today). Sets the task funded, writes ledger rows.
- `plan_b_claim_move(hold)` / `plan_b_record_move(hold, ok, provider ref)`: the two halves around every
  outside call, so a crash between them is found and retried, never repeated blindly.
- `my_money_ledger()`, `my_payout_account()`: the reads for the app.
- `admin_set_money_paused(on, reason)`: the emergency stop (admin + authenticator + audit row).
- `record_money_match(day, provider total, detail)`: the nightly match.

**Undo.** The quick undo is `money_flow = 'wallet'`: every changed function goes back to today's path
at once. The full undo, `docs/design/plan-b-money/undo_195.sql`, drops only the new tables, settings and
functions; the changed function bodies can stay because under `wallet` they are today's code.

## 5. Server (Edge Functions and Inngest)

- `supabase/functions/_shared/money/`: one **provider interface** with two adapters: `razorpayRoute.ts`
  and `simulated.ts`. The simulated adapter refuses to run unless the database's `environment` setting
  says `staging`, so the whole flow can be tested before Razorpay turns Route on for a test account.
- Razorpay calls: the worker becomes a **linked account** (`POST /v2/accounts`, individual); each hire is
  an **Order** with `transfers[{account, amount: worker_share, on_hold: true}]`, paid on Razorpay's hosted
  checkout (not a Payment Link, which cannot carry the held transfer); release is
  `PATCH /v1/transfers/:id {on_hold:false}`; a refund is `POST /v1/payments/:id/refund` (a split first
  reverses the refunded part of the transfer). Razorpay documents no idempotency header there, so each
  refund carries our key in `receipt` and `notes`, and we look for it before sending again.

  ```ts
  interface MoneyProvider {
    setupPayee(input): Promise<{ accountId; status }>        // worker's bank/UPI + PAN go straight to the provider
    payeeStatus(accountId): Promise<status>
    startPayment(hold): Promise<{ orderId; checkoutUrl }>     // charged, with worker_share marked on hold
    readPayment(orderId): Promise<{ paid; paymentId; transferId; amount }>
    release(hold, key): Promise<{ ref }>                      // worker_share (or the fine) to the worker
    refund(hold, amount, key): Promise<{ ref }>               // back to the original card or UPI
    settlementTotal(day): Promise<{ total; rows }>            // for the daily match
    verifyWebhook(rawBody, headers): Promise<Event | null>
  }
  ```

- `supabase/functions/money` (signed-in callers): `checkout`, `sync`, `payout-setup`, `payout-status`,
  `settle` (runs this task's waiting release or refund straight away, so the poster sees it happen).
  Same guards as the `razorpay` function today: key guard, account standing, rate limit, safe return URL.
- `supabase/functions/money-webhook` (public, signature checked first): payment paid, transfer
  settled or failed, refund processed, payee account activated.
- Inngest: `money-moves` runs hourly and on each `money_move` event, and retries every waiting
  release or refund; `money-match` runs nightly at 02:30 IST.
- Every path calls the emergency-stop check first. Refunds skip it.

## 6. App screens

| Screen | Plan B change |
|---|---|
| Wallet tab | Becomes **Money**: "On hold", "Released", "Refunded" totals and a list of each task's money from `my_money_ledger`. No balance, no Add money, no Withdraw. Workers see a "Get paid" card until their account is active |
| Pay for this task (EscrowScreen) | "Pay ₹X" opens the payment company's checkout (in-app sheet on Android, new tab on web, as Add money does today), then waits for "held". Shows the offer, the 3% fee and "Held by <payment company> until you approve" |
| Hire buttons (Compare, Task manage, Hunt) | After hiring, go straight to Pay for this task. No more "not enough in your wallet" sheet. A worker not set up to be paid shows "Can be hired once they add their bank" |
| Get paid setup (new sheet, from Money and from the first offer) | Name as on PAN, PAN, then UPI or bank. Sent straight to the payment company; the app keeps only the status |
| Auto-hire on Post | No wallet check. The offer is accepted automatically and the poster is asked to pay |
| Header menu | "Wallet · Balance ₹x" becomes "Money" |

All copy keeps the two palettes: paying and holding in jade, earning and released money in royal blue.

## 7. Admin app

- **Money stop** switch on the Money page (Admin role only, authenticator code, reason required, audit
  row). Shows when it was last switched and by whom.
- Holds list: each hold's state, with "Retry" for a `failed` move (money staff).
- Nightly match results with the difference highlighted.

## 8. What is built now and what waits

Built now, on staging, behind `money_flow`: everything above, with the **simulated** provider and the
Razorpay adapter written from the official documents. Staging stays on `wallet` until you switch it.

Waits for you:

1. **Razorpay turns Route on** (S.4: the ₹40 lakh turnover question, in writing); then the Route test keys
   and webhook secret go into `.env.all-secrets` and the function secret store, and Claude runs the full
   test with test money.
2. **The lawyer's written yes** (S.3) before `plan_b` runs with real money.
3. Production starts on `plan_b` from day one (task 5.x): no balances ever exist there.

## 9. Decisions made in this design (say if you want any changed)

1. **A worker must set up payments before they can be hired.** The hold is made for a named worker at the
   moment of payment, so the money is never in TaskDrop's own account. Offers can still be sent before.
2. **A worker who walks away means a full refund**, and the next hire pays again. Moving held money from
   one worker to another would mean TaskDrop holding it in between.
3. **No 7-day clearing under Plan B.** The 3-day approval window is the protection; after it the payment
   company pays out on its own schedule.
4. **Promotions stay as they are**: they are TaskDrop's own sale, not money held for someone else.
5. **No promo credits now.** The old `credits_minor` column stays at 0.
6. **An unpaid hire expires after 24 hours** and the task opens for offers again.
