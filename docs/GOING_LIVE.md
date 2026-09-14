# Going live with real payments

Everything except the money loop runs today. Payments are the one part I cannot
finish for you, because it needs credentials that are yours — I will not invent
them, and you should not paste them into a chat with anyone, including me.

Here is the whole list, in order. It is short.

## 1. Razorpay keys

In the Razorpay dashboard: **Settings → API Keys → Generate Live Key**.

Set them as Supabase Edge Function secrets (not in `.env`, not in the app
bundle — these are server-only and must never reach a client):

```bash
npx supabase secrets set RAZORPAY_KEY_ID=rzp_live_xxx RAZORPAY_KEY_SECRET=xxx --project-ref wjxvingpfbfvkfqhrguj
```

Until these are set, the app says "Razorpay is not configured" when someone
tries to fund escrow. That message is deliberate — it is better than a fake
success.

## 2. The webhook, which is the part people forget

Without it a payment only settles if the payer returns to the app and taps
"I've paid". Close the tab after paying and Razorpay has the money while the
task sits unfunded.

Generate a webhook secret (any long random string), set it, then register the
endpoint:

```bash
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=<a long random string> --project-ref wjxvingpfbfvkfqhrguj
```

In Razorpay: **Settings → Webhooks → Add New Webhook**

- URL: `https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/razorpay-webhook`
- Secret: the same string
- Active events: `payment_link.paid`

**One manual step I could not do from here:** that function must have JWT
verification turned **off**, because Razorpay has no Supabase session. It is
declared in `supabase/config.toml`, but the deploy I made through the
management API ignored it and left verification on — a webhook arriving now
gets a 401 before the signature is ever checked.

Fix it either way:

```bash
npx supabase functions deploy razorpay-webhook --project-ref wjxvingpfbfvkfqhrguj
```

or in the dashboard: **Edge Functions → razorpay-webhook → Details → uncheck
"Verify JWT"**.

The function is safe public: every request is HMAC-SHA256 signed with your
webhook secret and compared in constant time, and anything that does not match
is refused before a row is touched.

## 3. Check it end to end

One command tells you which step you are on:

```bash
npm run check:payments
```

It sends no money. It reads the status codes the functions already return and
names the next fix. Right now it reports both steps above as outstanding.

Manually, if you prefer:

```bash
curl -i -X POST https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/razorpay-webhook \
  -H 'Content-Type: application/json' -d '{}'
```

- `401 Bad signature` → correct, and JWT verification is off.
- `401` with no body → JWT verification is still on; redo step 2.
- `503` → the webhook secret is not set.

Then run a real ₹1 payment through the app and confirm:

```sql
select status, paid_at, amount_minor from public.payments order by created_at desc limit 1;
```

It should read `paid` without anyone tapping anything.

## 4. Before you take real money

- **Razorpay KYC** has to be complete or live keys stay disabled.
- **Payouts are recorded, not sent.** `request_withdrawal` debits the wallet and
  writes a `payouts` row as `requested`; actually moving money to a worker's UPI
  needs RazorpayX or a manual transfer, and then marking the row `paid`. Nothing
  is lost — the ledger is correct — but a human is currently in that loop.
- **Set an admin.** The analytics dashboard only appears for accounts in the
  `admin` role:
  ```sql
  insert into public.user_roles (user_id, role) values ('<your-user-id>', 'admin');
  ```
- **Replace the OTP shortcut.** `phone-auth` returns the code in its response
  because there is no SMS provider wired up, which is fine for testing and not
  fine in public. Plug in an SMS gateway and delete the `devCode` from the
  response.
- **Restrict the Maps key.** It is set and working (Places API New). Because it
  is `EXPO_PUBLIC_`, it ships inside the app bundle and anyone can read it — so
  restriction in Google Cloud Console is the only thing protecting your billing.
  Credentials → the key → Application restrictions (your web origins + Android
  package/SHA-1) and API restrictions (Places API New only).

## What is already enforced server-side

Worth knowing, because none of it can be bypassed from a client: the 20%
commission and 3% poster fee, who may lock/start/complete/release a task, the
5% post-start cancellation fine, that a withdrawal cannot overdraw, that only
the two parties can read a task's chat, and that platform analytics require the
admin role. There are 21 assertions covering these in `supabase/tests/`.
