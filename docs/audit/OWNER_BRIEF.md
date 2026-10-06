# Owner brief — one page (updated 2026-10-04, after Phase 5)

## What was done

The four P0 problems are fixed **and proven** against your project (fake data), by reproducing each as a real
role before the fix and again after:

1. **F-01** A poster could mark their own task "funded" (and create a task already marked funded). Closed with column-level privileges plus a guard trigger.
2. **F-02** Everyone could read every user's UPI ID and saved location. Closed; exact coordinates now live in owner-only tables and the public value is rounded to ~1 km.
3. **F-03** Any signed-in user could read every file in `task-media`. Now scoped to avatars, open-task media, your own files, and tasks/proofs you're part of.
4. **F-04** Exact job coordinates were public to signed-out visitors. Closed (anonymous access removed everywhere; coarse location until assignment, as you chose).

Plus: write-lock-down on bids/reviews/payout destinations/notifications/profiles (F-05) · anonymous role holds nothing (F-06) ·
atomic OTP attempt counter, deployed (F-07) · ad-billing throttle (F-09) · append-only admin **audit log** (F-10) ·
admin security headers incl. a nonce CSP (F-12) · CSV exports audited (F-13) · **live notifications** now actually
delivered and a shared refetch signal in the apps (S-01/S-02) · wallet-adjustment and ticket-resolved notifications ·
11 missing foreign-key indexes and a per-row policy fixed · six stale SQL suites repaired and two new ones added (F-26).

All of it is in `supabase/migrations/073…077`, `supabase/tests/`, `phone-auth` (v13), the admin app and the mobile app.
Nothing is committed to git — review the diffs first.

## Needs you

- **Review and commit** (both repos). The live DB already has these migrations applied; the project's own
  `072_dispute_reason` isn't in the repo (F-29) — reconcile before `supabase db push`.
- **Admin sign-in (F-27, High):** the admin login offers a mobile-OTP option. Make it Google-only and add MFA.
  I did not remove it, because it's how you may be signing in today.
- **Decide:** `clearing_period_days = 0` in production (F-19) · the 5% post-start cancellation fine is no longer paid (F-26) · whether `top_earners` should name individuals.
- **Dashboard toggles:** leaked-password protection (F-18) · PITR + a restore drill · Auth rate limits.
- **Google Cloud:** restrict the Maps key (Android package + Play App Signing SHA-1, only the APIs you use, budget alert) — or approve moving Places lookups behind an Edge Function (F-23).
- **Delete** the `razorpay-setup` function (F-14) and confirm `TEST_PHONES` / `ALLOW_ANY_OTP` are unset when SMS goes live (F-15).
- **Move** `SUPABASE_SERVICE_ROLE_KEY` and Razorpay secrets out of the local `.env` into Vault/Vercel.
- **Triage `npm audit`** — CI's audit step will stay red until each item is fixed or consciously accepted (F-22).
- **Build a release AAB** with EAS so the Android static/dynamic checks can run.

## Still open (engineering)

F-08 trustworthy client-IP for the per-IP SMS/login limits (needs a probe of the real header chain first) ·
F-11 MFA/step-up + dual control for money actions · F-16 CORS to the real origins · F-17 hash OTPs at rest ·
the refund notification (matrix row 4) and reading fees from `settings` everywhere (row 6) ·
a Playwright/Maestro suite and a k6 load profile once there's a signed-in test user.

## Not verified (be honest with yourself about these)

The live-notification → screen-refresh path at runtime, the admin dashboard pages under the new CSP (only `/login`
was loaded in a browser), the Android build, and anything under load. Passing SQL suites prove the database rules;
they don't prove the screens.
