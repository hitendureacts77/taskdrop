# Paying workers

Money comes in through Razorpay. Getting it back out to a worker is a different
problem with a different answer, and for an MVP the answer is **do it by hand
over UPI, which costs nothing**.

This page is why, and what to switch to when by hand stops scaling.

---

## The one thing to know first

A Razorpay **Payment Gateway** account cannot send money to a third party. It
can settle to your own bank account and it can refund the original payer. That
is the whole list. There is no API on it for paying a worker, which is why
`supabase/functions/` has no payout function — it is not a gap, the product
cannot do it.

Every option below is a *second* product with its own onboarding.

## What it costs to send ₹500 to a worker

| How | Cost of one ₹500 payout | Fixed cost | Onboarding |
|---|---|---|---|
| **You, from a UPI app** | **₹0** | none | none — you already have it |
| Razorpay Route | ~₹0.50 (0.1% + platform fee, successful transfers only) | none | Route activation; each worker becomes a linked account |
| RazorpayX Payouts | ~₹2–5 per transfer | **₹825–₹8,259/month** for the plan that includes the API | X current account + KYC |
| Cashfree Payouts | per transfer, quote not published — ask them | no setup fee | Cashfree account + KYC |

UPI is free because NPCI mandates zero MDR on it. That mandate is why a
transfer you make yourself costs nothing and why every API above still charges
— you are paying the provider's margin, not the rail.

### On the "free UPI gateway" products

Searching for free payouts turns up BharatUPI, open-source `upipay`, and similar
"0% commission UPI" projects. They are all **collection** — money in, resting on
the same zero-MDR mandate. None of them can push money to a third party's VPA.
If a provider offers genuinely free *outbound* transfers at volume, read where
the float is sitting before you use it.

### Why not RazorpayX, despite it fitting the schema

It is the natural fit — `payout_destinations` already stores a UPI id, and X
pays a VPA directly. But the payouts API sits behind a monthly plan, and the
cheapest plan that includes API access is more per month than an MVP will pay in
payouts all year. Revisit it when monthly payout volume × ₹3 exceeds the
subscription.

### Why not Route yet

Route is the cheapest per rupee and is the structure built for marketplaces:
Razorpay holds the money and pays the sub-merchant, so TaskDrop never holds
funds belonging to a worker. That last part matters — under the RBI payment
aggregator framework, third-party money sitting in your own account is the thing
the licence exists to govern, and today TaskDrop's escrow does exactly that.

The cost is a rewrite, not a fee: the 20% commission and 3% poster fee become a
split at payment time rather than a ledger computation, every worker has to be
onboarded as a linked account, and money lands in their **bank account** on
Razorpay's settlement cycle instead of on the UPI id they gave you.

Worth doing. Not worth doing before the flow has customers.

---

## The free path, which is what is built

```bash
npm run payouts
```

```
  3 payouts owed, ₹4,250.00 in total

      ₹1,200.00  Anita Rao            3f9c2a71  6h ago
                 UPI  anita@okhdfcbank
                 upi://pay?pa=anita%40okhdfcbank&pn=Anita+Rao&am=1200.00&cu=INR&tn=TaskDrop+payout+3f9c2a71
```

Open that link on a phone and it drops straight into a UPI app with the amount
and reference filled in. Send it, then write it down:

```bash
npm run payouts paid 3f9c2a71 <the UPI reference>
```

If it bounces:

```bash
npm run payouts failed 3f9c2a71 "bank rejected the VPA"
```

which puts the full amount back in the worker's wallet.

Both go through `admin_mark_payout`, which is the point of using the script
rather than editing the row: the refund on failure happens inside the same
locked transaction as the status change. A hand-edited row skips it and the
worker is simply out the money.

`npm run payouts` needs `SUPABASE_SERVICE_ROLE_KEY` in `.env`. That key bypasses
every row-level policy in the database — it belongs on your machine and nowhere
near a client bundle.

### What it shows you that SQL did not

`payouts.destination` is a snapshot of how the account *read on screen* when the
withdrawal was requested, and a bank account is masked there down to its last
four digits. You cannot pay into `····4471`. The script joins the live
`payout_destinations` row back in, so you get the full account number and IFSC,
and it says `CANNOT SEND` outright when there is nothing payable on file.

---

## When to stop doing it by hand

Roughly when payouts pass a few dozen a week, or when someone has to be
available at a weekend to do it. At that point:

1. Take Cashfree Payouts or RazorpayX, whichever quotes better at your volume.
2. Write one Edge Function that reads `admin_payout_queue()`, sends each
   transfer, and calls `admin_mark_payout` with the provider's reference.
3. Keep the script. It is what you use when the provider is down.

Nothing in the ledger changes when you do this. `request_withdrawal` already
debits the wallet and opens the row; the only question is who sends the money
and who writes the reference back.

---

## Adjacent: the poster's refunds

Refunds are a different mechanism and already automatic — cancelling a task asks
Razorpay to refund the original payment. Refunds ride the payment gateway you
already have, which is exactly why they work without any of the above. See
section 4 of [RUNNING_THE_BUSINESS.md](RUNNING_THE_BUSINESS.md).

---

Sources, as of September 2026:
[Razorpay pricing](https://razorpay.com/pricing/) ·
[Razorpay Route](https://razorpay.com/route/) ·
[RazorpayX payouts](https://productgrowth.in/tools/payments/razorpay-x/) ·
[Cashfree pricing FAQs](https://www.cashfree.com/docs/help/account/pricing) ·
[Cashfree Payouts API](https://www.cashfree.com/docs/api-reference/payouts/overview)
