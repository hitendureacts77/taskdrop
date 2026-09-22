# Going live with real payments

Everything that could be automated has been:

- the webhook is deployed with JWT verification **off**, so Razorpay can reach it
- a 256-bit `RAZORPAY_WEBHOOK_SECRET` is generated into your `.env`
- your Razorpay **test** keys are in `.env` and verified against the live API
- `npm run check:payments` tells you what is still outstanding

**One step needs your hands**, because it needs a Supabase login this machine
does not have:

```bash
npx supabase login          # opens your browser, once
bash scripts/push-payment-secrets.sh
npm run check:payments
```

Alternatively paste the three values from `.env` into
**Supabase dashboard → Edge Functions → Secrets**.

## 1. Razorpay keys

Test keys are in `.env` already and verified working — they authenticate, and
the exact payment-link call the Edge Function makes returns a live test link.
Test mode moves no real money, which is what you want until the flow is proven.

When you are ready for real customers, swap them for live keys from
**Settings → API Keys → Generate Live Key** (live keys need completed KYC) and
re-run the push script.

They are server-only: they must never reach a client bundle. The script below
sends them straight to Supabase as Edge Function secrets.

Put them in `.env`:

```
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
```

then send all three secrets up in one go:

```bash
bash scripts/push-payment-secrets.sh
```

Until these are set, the app says "Razorpay is not configured" when someone
tries to fund escrow. That message is deliberate — it is better than a fake
success.

## 2. The webhook, which is the part people forget

Without it a payment only settles if the payer returns to the app and taps
"I've paid". Close the tab after paying and Razorpay has the money while the
task sits unfunded.

The secret is already generated and sits in your `.env`; the script above sends
it. Register the endpoint in Razorpay with that same value:

In Razorpay: **Settings → Webhooks → Add New Webhook**

- URL: `https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/razorpay-webhook`
- Secret: the same string
- Active events: `payment_link.paid`

JWT verification is already **off** for this function — it has to be, because
Razorpay has no Supabase session.

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
  writes a `payouts` row as `requested`; a person then sends the money over UPI
  and marks the row. `npm run payouts` is that loop, and it costs nothing to run
  — a UPI transfer carries no fee, while every payout API charges per transfer
  or per month. See [PAYING_WORKERS.md](PAYING_WORKERS.md) for the comparison
  and for when it is worth automating.
- **Set an admin.** The analytics dashboard only appears for accounts in the
  `admin` role:
  ```sql
  insert into public.user_roles (user_id, role) values ('<your-user-id>', 'admin');
  ```
- **Finish the OTP setup.** `phone-auth` texts the code through MSG91 and only
  hands it back for numbers in `TEST_PHONES`. Three things still gate launch:
  DLT registration with TRAI (entity, sender header, template — days of
  paperwork, start early), the MSG91 secrets set in Supabase, and `TEST_PHONES`
  cleared, since anyone can sign in as a number listed there. Full runbook in
  [SMS_OTP.md](SMS_OTP.md).
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
