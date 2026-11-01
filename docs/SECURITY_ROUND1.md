# Security round 1: stop-ship tests (plan task 2.7)

Run on **1 November 2026** against the staging project (fake accounts, fake money). Nothing was run against production or the payment companies. Claude did the attacks; the scripts are in the repository, so the same run can be repeated.

## Result in one line

**No Critical and no High problem.** Two Low problems were found and fixed. Gate 2a's "no Critical or High problem from 2.7 is open" is true.

## What each test did

| Test | How it was run | Result |
|---|---|---|
| **T0, T1** Setup and automatic checks | `npm run check` on every change, the secret scanner (gitleaks) on every change and weekly, the commit guard on the PC (task 2.5) | Green. A fake key in a commit is stopped before it exists (shown on 1 Nov) |
| **T2 Keys** | `npm run security:history` reads every line ever added on every branch (454 commits). The built website bundle was scanned for secret-shaped text by `scripts/secret-guard.test.mjs`. The code of the app and the website was checked for any secret name readable by the app | **0 findings.** The 2 old Razorpay **test** values in commit `c926854` are the ones the plan already accepts (listed with the reason in `scripts/secret-history.mjs` and `.gitleaks.toml`). The Android file itself needs a build: it is checked in 2.9 (T11) |
| **T3 Database rules** | The break-it suite (`BREAKIT=1 npx playwright test e2e/breakit.spec.ts`): 285 hostile probes as a stranger, a cheat and a script, including direct database access with a normal login | 284 held, **1 got through (Low):** `getProfile` of another person included the empty old field `payout_upi` (hole H13). Fixed below |
| **T5 Storage** | `npm run security:storage`: as a stranger and with only the public key, tried to download, list, get a signed link to, overwrite, delete and path-trick another person's private files | **13 of 13 refused** |
| **T7 Server permissions** | `supabase/tests/rpc_caller_checks.test.sql` (now part of `npm run test:db`): every function a signed-in or signed-out person can run | All **113** callable functions either check who is calling (107 do: the admin ones through the staff gate) or are public on purpose (6: the app switches and five public statistics). Only `get_app_controls` is callable signed out. **1 Low problem:** see below |
| **T8 Money** | Break-it sections 3 to 5 and 9, and the money tests in `e2e/money.spec.ts`: double payments, fake or repeated payment messages, wrong amounts, refunds, overdrafts, double spends, other people's wallets | All held |

## The two Low problems, both fixed

1. **`getProfile` sent the legacy `payout_upi` field** of any person (always empty since migration 073, so nothing was exposed). It is now removed from the answer (`supabase/functions/api/reads.ts`). The column itself is dropped from the app's reach in task 3.9.
2. **Two private money functions had an open grant again.** `private.move_card_payment_to_wallet` and `private.book_revenue_on_completion` lost the closed door that migration 066 gave them when migration 128 replaced one of them. Not reachable today (the REST door only exposes `public` and `graphql_public`, which was checked), but the closed door is back in migration 131, and the new SQL test fails if any private function that is not a row-rule helper is ever open.

## Also seen, not a finding

- Supabase's own advisor still lists the 7 private tables closed to the app (accepted in the plan), leaked-password protection off (paid plan only, H11, switched on in production in 5.2) and `get_app_controls` readable signed out (accepted).
- The break-it suite and the storage test need the staging project's `dev_otp_for_all` switch, which is on only on staging and must be off in production (5.9).

## Repeat it

```bash
npm run security:history
npm run security:storage        # needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values)
npm run test:db                 # includes the T7 caller check
BREAKIT=1 npx playwright test e2e/breakit.spec.ts --project=web-desktop   # after: npm run web:export
```
