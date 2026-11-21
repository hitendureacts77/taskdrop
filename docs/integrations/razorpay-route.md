# Razorpay Route (Plan B money flow)

Researched 18 Nov 2026 from razorpay.com/docs only. Anything not found in the docs says
"NOT CONFIRMED — ask in writing (S.4)". Nothing here has been tested against a live account.

## 1. What it is for

Route lets Razorpay take one payment from the poster, hold it, and later pay a share to a
"linked account" (our worker). TaskDrop never holds a balance. This is the Plan B flow:
poster pays offer + 3% fee, Razorpay holds the money, we release the worker's share
(offer minus 10%) after approval or 3 days, and Razorpay keeps our share in our own account.

Our current code uses Payment Links (`supabase/functions/razorpay`, `razorpay-webhook`).
Route can work with Payment Links, but the safest fit for "worker known at payment time"
is an **Order with a `transfers` array** (see section 3).

Docs: https://razorpay.com/docs/payments/route/

## 2. Eligibility & KYC

- **Turnover rule (documented):** domestic turnover over Rs 40 lakh (GST-3B) or export over
  Rs 5 lakh in FY26 or FY25. Also the linked account must deal directly with our customers,
  and we must send a written Route use case. Review takes 5 to 7 business days. Route
  services that did not meet this were discontinued from 1 Jan 2026.
  https://razorpay.com/docs/payments/route/ and https://razorpay.com/docs/payments/route/faqs
- **This rule is a blocker for TaskDrop today.** We have no Rs 40 lakh turnover.
  Whether a new business can get an exception: NOT CONFIRMED — ask in writing (S.4).
- **Individuals allowed:** yes. `business_type: "individual"` is supported; for an individual
  the `legal_info` and `stakeholder` objects are optional.
  https://razorpay.com/docs/api/payments/route/create-linked-account-composite
- **KYC fields:** `legal_business_name` (as on PAN and bank account, 4 to 200 chars),
  `tnc_accepted`, `reference_id`, and a settlement destination. If a stakeholder is sent,
  `stakeholder.kyc.pan` is required and the 4th PAN character must be `P`.
- **Settlement destination:** either `bank_account` (account number, IFSC, beneficiary name)
  or `upi` (VPA). `is_default` must be `true`. Same page as above.
- **VPA caveat:** one linked account is one method. For both, create two linked accounts.
  If a VPA payout fails, retry is from the Dashboard (Route > Settlements > Failed > Retry).
  https://razorpay.com/docs/payments/route/faqs
- **Activation status values:** NOT FULLY CONFIRMED. Docs show `created` at creation, `activated`
  for the product, and the webhook names below (`under_review`, `needs_clarification`,
  `activated`). An FAQ snippet also lists `not_activated`. Ask for the full list (S.4).

## 3. Calls we use

Base URL `https://api.razorpay.com`. Auth: HTTP Basic (key id : key secret), as in our code.

| Our step | Method + path | Key fields | Doc URL |
|---|---|---|---|
| Onboard worker (once) | `POST /v2/accounts` (composite) | `type`, `reference_id`, `legal_business_name`, `business_type=individual`, `tnc_accepted`, `settlement_accounts[]` (upi or bank_account), optional `stakeholder.kyc.pan` | https://razorpay.com/docs/api/payments/route/create-linked-account-composite |
| Old 4-step onboarding (if composite is not enabled) | `POST /v2/accounts`, then stakeholder, then product config, then `PATCH /v2/accounts/:id/products/:pid` | `tnc_accepted`, `ifsc_code`, `account_number`, `beneficiary_name` | https://razorpay.com/docs/api/payments/route/update-product-config and https://razorpay.com/docs/api/payments/route/create-stakeholder |
| Check worker status | `GET /v2/accounts/:id/products/:pid` | `activation_status`, `requirements` | https://razorpay.com/docs/us/api/payments/route/fetch-product-config |
| Poster accepts offer, create payment | `POST /v1/orders` | `amount` (paise), `currency=INR`, `receipt`, `transfers[]` = `{account, amount, currency, on_hold:true, on_hold_until?, notes, linked_account_notes}` | https://razorpay.com/docs/api/payments/route/create-transfers-orders |
| Alternative: transfer after capture | `POST /v1/payments/:id/transfers` | `transfers[]` same fields. Payment must be `captured`. Sum of transfers cannot exceed captured amount | https://razorpay.com/docs/api/payments/route/create-transfers-payments |
| Poster approves or 3 days pass: release | `PATCH /v1/transfers/:id` | `on_hold: false` | https://razorpay.com/docs/api/payments/route/modify-settlement-hold |
| Dispute: keep holding | `PATCH /v1/transfers/:id` | `on_hold: true` (optionally `on_hold_until`) | same page |
| Cancel before start: full refund | `POST /v1/payments/:id/refund` | `amount`, `reverse_all: true` | https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer |
| Cancel after start: 5% fine to worker, rest back | Reverse part of the transfer, then refund. See "Partial" below | `POST /v1/transfers/:id/reversals` with `amount`; then `POST /v1/payments/:id/refund` | https://razorpay.com/docs/us/api/payments/route/reverse-a-transfer |
| Nightly match | `GET /v1/settlements/recon/combined?year=&month=&day=&count=&skip=` and `GET /v1/transfers?expand[]=recipient_settlement` | settlement id, `utr`, `fee`, `tax`, `recipient_settlement_id` | https://razorpay.com/docs/api/settlements/fetch-recon and https://razorpay.com/docs/api/payments/route/fetch-settlement-details |

### Which way to take the payment

- **Order with `transfers` (recommended).** Set up at order creation. After capture the transfer
  is created on its own. It stays `created` until the order is paid. Needs the worker to be an
  activated linked account at that moment, which is true in our flow (offer accepted means
  worker known). Not allowed on orders with `partial_payment` enabled. INR only.
  https://razorpay.com/docs/payments/route/transfer-funds-to-linked-accounts
- **Transfer after capture.** Works, but needs a webhook-then-call step, and leaves a gap where
  money is captured with no hold. Fewer moving parts is better, so prefer the Order way.
- **Payment Links:** Razorpay says Payment Links can transfer payments to a linked account, and
  that you use the API with the payment id to do it (post-payment style). Whether the Payment
  Links *create* API accepts a `transfers` array with `on_hold`: NOT CONFIRMED — ask in writing (S.4).
  https://razorpay.com/docs/payments/payment-links/transfer-payments
  **Design call:** plan to switch from Payment Links to Orders + Checkout for task payments. Our
  existing Payment Links code stays for promotions and top-ups, if those remain.
- **Hold:** with `on_hold: true` and no `on_hold_until`, settlement is held "indefinitely".
  Docs say set `on_hold_until` more than 30 minutes after creation. `on_hold_until` must be
  between 946684800 and 4765046400 (Unix). A maximum hold length: NOT CONFIRMED — ask in writing (S.4).
  Our 3-day auto-complete is a TaskDrop timer; we call PATCH `on_hold:false` ourselves.
- **Release timing:** after release the money reaches the worker "by the next working day"
  on top of their settlement schedule (docs example: schedule T+10 means held funds go next
  working day after release if past schedule). Exact schedule for individuals: NOT CONFIRMED — ask in writing (S.4).

### Partial (5% fine) handling

- `reverse_all: true` on a refund works for a **partial refund when the payment went to one
  linked account**. It cannot be used for partial refunds on multi-account payments.
  https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer
- Our case is one worker per payment, so: refund = poster's money minus fine, with
  `reverse_all: true`, or do it by hand: reverse the refunded part of the transfer, then refund.
- Does Razorpay reverse a transfer that is still `on_hold` and never settled? NOT CONFIRMED — ask in writing (S.4).
- Who bears the 3% fee refund and the gateway fee on a refund: NOT CONFIRMED — ask in writing (S.4).
- Transfer entity has `amount_reversed` and status `reversed` or `partially_reversed`.

## 4. Webhooks & how each side proves who it is

- **Webhook to us:** header `X-Razorpay-Signature`, HMAC-SHA256 of the raw request body with our
  webhook secret. Same method as `razorpay-webhook/index.ts` today. Use the raw body, not parsed JSON.
  https://razorpay.com/docs/webhooks/validate-test
- **Dedupe:** header `x-razorpay-event-id` is the same on every redelivery. Store it and skip repeats.
  Events can arrive out of order, so never trust order; re-read the entity if state matters.
- **Events we subscribe to:**
  - `payment.captured` and `order.paid` (money in; confirm on our side)
  - `transfer.processed`, `transfer.failed`, `settlement.processed`
  - `product.route.under_review`, `product.route.needs_clarification`, `product.route.activated`
  - `account.activated`, `account.under_review`, `account.needs_clarification`, `account.updated` (India, VPA accounts)
  - `refund.processed`, `refund.failed` (refund events exist; exact names: confirm against
    https://razorpay.com/docs/us/webhooks/all)
  https://razorpay.com/docs/webhooks/route
- **Us to Razorpay:** Basic auth with key id and secret. Never in client code or `EXPO_PUBLIC_`.
- **Retry schedule and timeout of Razorpay webhooks:** NOT CONFIRMED — ask in writing (S.4).

## 5. Data we store (provider ids only, never bank numbers)

- `razorpay_linked_account_id` (`acc_...`) per worker, plus `onboarding_status` and last webhook time.
- `razorpay_order_id`, `razorpay_payment_id` per task payment.
- `razorpay_transfer_id` (`trf_...`), `transfer_status`, `settlement_status`, `on_hold`, `amount_reversed`.
- `razorpay_refund_id` per refund; `recipient_settlement_id` and `utr` for reconciliation.
- Event ids seen (dedupe table).
- Never store: bank account number, IFSC, VPA, PAN. The worker enters those in Razorpay's flow
  or we pass them straight through once. Whether Razorpay offers a hosted worker KYC form
  (so we never touch PAN): NOT CONFIRMED — ask in writing (S.4).

## 6. Limits & prices

- Minimum transfer: 100 paise (Rs 1). Currency INR only. Transfer cannot exceed order amount.
- `notes`: max 15 pairs, 256 characters each.
- Rate limit: a Razorpay doc says Orders and Payments APIs are about 100 requests a minute per
  key (https://razorpay.com/docs/developer-tools/integrations/standard-checkout). Route
  endpoints: NOT CONFIRMED — ask in writing (S.4).
- **Prices:** two fees. A gateway fee on the full payment, and a transfer fee on each amount
  moved to a linked account, both with GST, "as per your agreed pricing plan".
  https://razorpay.com/docs/payments/route/faqs
  The transfer-fee percentage is not in the docs. Our older note (docs/PAYING_WORKERS.md)
  says about 0.1% plus a platform fee; treat that as unverified. NOT CONFIRMED — ask in writing (S.4).
- Order transfer failures retry on following days, up to 3 times.

## 7. Errors & retries

- Transfer states: `created`, `pending`, `processed`, `failed`, `reversed`, `partially_reversed`.
  Settlement states: `pending`, `on_hold`, `settled`. A transfer fails for things like
  insufficient balance; the `error` object gives `code`, `description`, `reason`.
- **Idempotency:** the composite account call accepts an `Idempotency-Key` header and
  `reference_id`. For orders use a unique `receipt` per task and check before re-creating.
  A general idempotency header for orders/transfers/PATCH: NOT CONFIRMED — ask in writing (S.4).
  Payout-side idempotency headers exist for X products, not Route.
- Our rule: every call is safe to repeat because we store the provider id first, then check it
  before calling again. A repeated `PATCH on_hold:false` should be harmless; confirm in test.
- Retry network errors and 5xx with backoff (3 tries). Never retry a 4xx without reading it.
- Webhook handler: return 200 fast, do the work in a queue (Inngest), dedupe on event id.

## 8. Test plan on staging (test keys)

Docs say Route works in test and live mode, and a test linked account can be used in live
and the other way round. Use test keys on staging only.

1. Create a test linked account (individual, UPI and bank). Check it reaches `activated`.
2. Create an Order with one transfer, `on_hold: true`. Pay with test UPI. Confirm
   `settlement_status = on_hold`.
3. `PATCH on_hold:false`. Confirm `transfer.processed` and `settlement.processed` webhooks.
4. Refund with `reverse_all: true` before any release. Check what happens to a held transfer.
5. Partial refund with `reverse_all` (poster gets 95%, worker keeps the fine). Check
   `amount_reversed` and the final numbers.
6. Send the same webhook twice; confirm one effect. Send a bad signature; confirm refusal.
7. Run the nightly job: pull `recon/combined` for the day, match our ledger to payments,
   refunds, transfers. Alert on any gap.
8. Kill the app mid-flow (pay then close tab). Webhook alone must fund the task.
9. Not testable on staging, ask Razorpay: whether test mode shows the real Rs 40 lakh gate.

## 9. Open questions for the S.4 written quote

1. Can TaskDrop get Route without Rs 40 lakh turnover? Any exception or sandbox-only period?
2. Is a marketplace of individual gig workers an accepted use case (payer-payee rule)?
3. Maximum length of `on_hold_until`. Is there a hard limit (days)?
4. Do Payment Links accept `transfers` with `on_hold` at creation, or only after payment?
5. Transfer fee and platform fee, in writing. Is GST extra?
6. Settlement schedule for individual linked accounts after release (T+?). UPI vs bank.
7. Does `reverse_all` reverse a transfer that is held and not settled? Fine/partial rules.
8. Are gateway fees refunded when we refund the poster?
9. Webhook retry schedule, timeout, and IP list.
10. Rate limits for Route endpoints. Idempotency header for orders, transfers, PATCH.
11. Can Razorpay host worker KYC so we never see PAN or bank numbers?
12. Full list of linked account activation statuses and the time it takes for individuals.
13. A reconciliation report that shows transfers (not only settlements) per day.
14. RBI position on a marketplace using Route in this way (we do not hold funds).
