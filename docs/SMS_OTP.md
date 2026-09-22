# Sending the login code by SMS

The sign-in code is generated, stored and checked by the `phone-auth` Edge
Function. MSG91 is only the transport — we pass it our own code rather than
letting it mint one, so verification stays entirely on our side.

Until the secrets below are set, `phone-auth` refuses to send at all (503,
"SMS is not set up on this server yet") for any number not on the test
allowlist. It does **not** fall back to returning the code. That fallback is
what used to exist, and on a public endpoint it hands anyone who knows your
number a working login code.

## 1. DLT registration — do this first, it gates everything

India requires every transactional SMS sender to be registered with TRAI's DLT
platform. Unregistered traffic is dropped by the carriers silently: MSG91 will
report success and nothing arrives. There is no way to code around this.

Register on any DLT portal (Jio, Airtel and Vodafone all run one; registering
on one propagates to the rest):

1. **Entity registration** — PAN, GST and a letterhead authorisation. One-time
   fee, typically around ₹5,000. Takes a few working days to approve.
2. **Header (sender ID)** — six alphanumeric characters, e.g. `TSKDRP`. Must be
   registered as *transactional*, not promotional; promotional headers are
   blocked by DND and most of your users will be on DND.
3. **Content template** — the exact message body, with variables marked. Keep
   it close to:

   ```
   {#var#} is your TaskDrop verification code. It is valid for 10 minutes. Do not share it with anyone.
   ```

   The template must match what is sent character for character apart from the
   variable. A template that differs even in punctuation is rejected at the
   carrier.

Approval of a template takes hours to a couple of days. Do this before you
plan a launch date.

## 2. MSG91

Create an account at msg91.com, then:

1. **Settings → API → Auth Key** — copy it. This is the `MSG91_AUTHKEY`.
2. **SMS → DLT** — link the DLT entity ID and header you registered above.
3. **SMS → Templates** — create a template that mirrors the DLT-approved one
   and put `##OTP##` where the code goes. MSG91 substitutes our value there.
   Copy its template id — this is the `MSG91_TEMPLATE_ID`.
4. Load credit. OTP SMS to India runs roughly ₹0.15–0.25 per message.

## 3. Set the secrets

These live in Supabase, never in the repo:

```bash
npx supabase secrets set MSG91_AUTHKEY=... MSG91_TEMPLATE_ID=... --project-ref wjxvingpfbfvkfqhrguj
```

`TEST_PHONES` is an optional comma-separated list of 10-digit numbers that skip
the SMS and get the code back in the response instead, so you can keep
developing without burning credit:

```bash
npx supabase secrets set TEST_PHONES=9876543210,9123456789 --project-ref wjxvingpfbfvkfqhrguj
```

**Clear `TEST_PHONES` before launch.** Any number listed there can be signed
into by anyone, because the endpoint is public and hands back the code.

## 4. Deploy

```bash
npx supabase functions deploy phone-auth --project-ref wjxvingpfbfvkfqhrguj
```

Deploy *after* the secrets are set. The order matters: a deployed function with
no `MSG91_AUTHKEY` refuses every send, which locks you out of your own app
unless your number is in `TEST_PHONES`.

## What the limits are

All of these are per rolling hour, enforced in the function against
`auth_codes` and `auth_send_log`:

| Limit | Value | Stops |
|---|---|---|
| Gap between sends to one number | 60s | Resend-spamming one handset |
| Sends per number | 5 | Harassing a single victim |
| Sends per IP | 30 | Rotating numbers to burn your credit |
| Wrong guesses per number | 5 | Brute-forcing the six digits |
| Code lifetime | 10 min | Replay of an intercepted code |

The guess budget deliberately **survives a resend**. Before, asking for a new
code reset `attempts` to zero, so alternating resend and guess gave unlimited
tries at a six-digit number.

The per-IP ceiling is loose on purpose — Indian mobile carriers NAT large
numbers of subscribers behind one address, so a tight limit would lock out real
users. It is a cost backstop, not a per-user control. If you ever see it
firing on legitimate traffic, raise it rather than removing the per-phone caps.

## When nothing arrives

Work down this list; it is roughly in order of likelihood.

- **MSG91 dashboard → Reports.** If the message is not there, the function
  never called MSG91 — check the Edge Function logs in the Supabase dashboard.
- **Delivered in MSG91 but not on the handset.** Almost always DLT: header or
  template not approved, or the template registered does not match what is
  being sent. MSG91's report shows the carrier rejection reason.
- **`SMS is not set up on this server yet`.** Secrets are missing. They are not
  picked up until the function is redeployed after being set.
- **DND.** Transactional headers reach DND numbers; promotional ones do not.
  If it works for some numbers and not others, the header is registered under
  the wrong category.
