# TaskDrop — Security findings (Phases 1–3, static + read-only)

Date: 2026-10-04 · Scope: own assets only · Method: repo review, git-history scan, Supabase advisors,
read-only catalog queries against the live project (`pg_policies`, `pg_proc`, grants, storage policies,
publications). **No writes, no destructive tests, no user rows read.**

> **Verification status.** There is no staging project or Supabase branch (`list_branches` → empty).
> Nothing below was *exercised* against the database. Findings marked **[verify on staging]** are
> proven from catalog/code evidence but must be reproduced in a rolled-back transaction on staging before
> the fix is declared done. Severity is stated conservatively and downgraded where the evidence is weaker.

## Summary

| Sev | Count | IDs |
|---|---|---|
| Critical (pending verification) | 1 | F-01 |
| High | 3 | F-02, F-03, F-04 |
| Medium | 9 | F-05 … F-13 |
| Low / Info / Config | 10 | F-14 … F-23 |

What is already good (keep it): RLS is on for every table in `public`; `authenticated`/`anon` EXECUTE on
`SECURITY DEFINER` functions is revoked by default and granted from an allowlist (migration 047 holds);
service-only functions (`fund_task_from_payment`, `record_escrow_refund`, `settle_cleared_earnings`,
`set_app_secret`, `credit_topup`, payout senders …) are **not** executable by clients; views are
`security_invoker`; every `crm_*`/`admin_*` RPC checks `is_admin()` and every admin server action calls
`requireAdmin()`; Razorpay webhook verifies HMAC over the raw body with 401 on mismatch; the escrow amount
is read from the database (not the client) when creating a payment link; session tokens live in
SecureStore on Android; `allowBackup=false`, cleartext off, background location blocked; auth
`statement_timeout` is set (3 s anon / 8 s authenticated); suspension bans at the auth layer and revokes
sessions; no env file and no JWT/secret-key pattern was ever committed to git history.

---

## Remediation status — 2026-10-04, after Phase 5

The project holds only fake data, so the owner authorised testing directly against it. Every reproduction
below was run as a **real role** (`authenticated` / `anon`, with `request.jwt.claims` set) inside a
transaction that rolled back, **before** and **after** each fix. Migrations 073–077 are applied to project
`wjxvingpfbfvkfqhrguj` and saved under `supabase/migrations/`; the `phone-auth` edge function is deployed (v13).

| ID | Finding | Status | Where |
|---|---|---|---|
| F-01 | Payment/lifecycle columns on `tasks` client-writable | **Fixed, proven** (was reproduced: update and insert both succeeded) | 073 — column grants + `tasks_guard_columns` trigger; `remove_listing` RPC |
| F-02 | Public profile read exposed UPI + exact location | **Fixed, proven** | 073 (`payout_upi` nulled, no write grant), 074 (`profile_private`, public value rounded) |
| F-03 | Any signed-in user could read all `task-media` | **Fixed, proven** (16 → 10 visible; the 10 are avatars + open-task media by design) | 075 |
| F-04 | Open tasks exposed exact coordinates to anyone | **Fixed, proven** | 073 (anon revoked), 074 (`task_private`, rounded public) |
| F-05 | Mass assignment on bids/reviews/destinations/notifications/profiles | **Fixed, proven** (5c re-tested as refused by the grant) | 073 |
| F-06 | `anon` held DML on nearly every table | **Fixed, proven** (0 grants remain) | 073 |
| F-07 | OTP attempt counter non-atomic | **Fixed, proven over HTTP** | 077 + `phone-auth` v13 (also constant-time compare) |
| F-08 | Per-IP throttles trust first `x-forwarded-for` | **Open** — needs a probe of the real header chain; a wrong fix could lock every user out | — |
| F-09 | Ad impressions unthrottled | **Fixed, proven** (25 rapid calls → 1 billed; own views → 0; signed-out → 0) | 076 |
| F-10 | No audit log | **Fixed, proven** (append-only even for the owner role; admin-readable only) | 076 |
| F-11 | No MFA / step-up / dual control for admins | **Open** — needs an enrolment UI and the owner's decision | — |
| F-12 | Admin sent no security headers | **Fixed, proven in a browser** (nonce CSP, HSTS, frame-ancestors, …) | `middleware.ts`, `next.config.mjs`, `layout.tsx` |
| F-13 | CRM export unaudited | **Fixed** (export refuses to run if the audit write fails) | `api/crm/export/route.ts` + 076 |
| F-14 | `razorpay-setup` still deployed | **Open — owner** (no tool here deletes an edge function) | — |
| F-15 | Dev OTP bypass code path in prod function | **Open** — safe while SMS keys exist; remove once SMS is live | — |
| F-16 | CORS `*` on browser-called functions | **Open** — needs the production web origin | — |
| F-17 | OTP stored in plaintext | **Open (Low)** — compare is now constant-time | — |
| F-18 | Leaked-password protection off | **Open — owner dashboard toggle** | — |
| F-19 | `clearing_period_days = 0` in production | **Open — owner decision** | — |
| F-20 | Mutable `search_path` on profile guard | **Fixed** (advisor WARN gone) | 073 |
| F-22 | `npm audit` advisories | **Open** — build-time/transitive; fixes are breaking majors | — |
| F-23 | Maps key restriction unknown | **Open — owner (Google Cloud console)** | — |

Advisors after the fixes: security **0 ERROR**; the only WARNs left are the 57 *expected, guarded*
`SECURITY DEFINER` RPCs (55 + `remove_listing` + `admin_log_event`) and leaked-password protection.
Performance: the 11 unindexed foreign keys and the per-row `auth.uid()` policy are gone.

**Regression:** all six pre-existing SQL suites plus the two new ones pass against the live project (see
`TEST_REPORT.md`). Four of the six had been silently stale — see F-26.

---

## Critical

### F-01 — Payment-state and lifecycle columns on `tasks` are client-writable by the poster **[FIXED — migration 073]**
- **Evidence.** Policy `tasks_update_own_while_open`: `USING poster_id = auth.uid() AND status = 'OPEN'`,
  `WITH CHECK poster_id = auth.uid()` — ownership only, no column restriction. `authenticated` holds
  table-level UPDATE on **every** column, including `funded_at`, `funding_payment_id`, `funded_via`,
  `funded_minor`, `funded_credits_minor`, `status`, `locked_bid_id`, `locked_minor`, `payout_mode`,
  `clear_at`, `cleared_at`, `completed_at`. There is no BEFORE UPDATE guard on `tasks`
  (only on `profiles`). Downstream RPCs treat `tasks.funded_at` as proof that escrow was paid
  (`fund_task_from_wallet` returns early when it is set; `start_task` and `confirm_release` gate on it).
- **Impact.** Money-integrity risk: the "no money, no work" gate depends on a column the owner can edit.
- **Fix (P0).** (1) `REVOKE UPDATE ON public.tasks FROM authenticated, anon`, then `GRANT UPDATE (title,
  description, benchmark_minor, time_limit_minutes, flag, media_kind, media_path, media_seconds, loc_*,
  category, skills, difficulty, assignment_mode, due_at, milestones) ...` for the fields a poster may edit.
  (2) Add a BEFORE UPDATE guard trigger (same pattern as `private.guard_profile_columns`) that rejects any
  change to protected columns when `current_user in ('authenticated','anon')`, so a future grant cannot
  silently reopen this. (3) Longer term derive "funded" from a ledger row written only by
  `SECURITY DEFINER` code instead of a mutable flag on the task.
- **Test.** SQL suite, run as user A in a rolled-back transaction: updating each protected column must
  raise; updating an allowed column must succeed; `lock_bid` on an unfunded task must debit the wallet.

## High

### F-02 — Public profile read exposes private columns **[FIXED — migrations 073, 074]**
- **Evidence.** `profiles_select_all USING (true)` for `anon` and `authenticated`; `anon` can SELECT every
  column, including `payout_upi`, `loc_lat`, `loc_lng`, `loc_label`, `last_seen_at`, `live_until`, `intent`.
- **Impact.** Any internet caller can list users' UPI IDs and precise saved/"live" locations.
- **Fix (P0).** Column-level `REVOKE SELECT` on the private columns for `anon`/`authenticated`; expose the
  public fields through a `public_profiles` view (`security_invoker`) or RPC; retire `profiles.payout_upi`
  (payout destinations already live in `payout_destinations`). Keep own-row access through an RPC.
- **Test.** As `anon` and as user B, `select payout_upi, loc_lat from profiles` must fail.

### F-03 — Any signed-in user can read/list every object in the `task-media` bucket **[FIXED — migration 075]**
- **Evidence.** Storage policy `task media: signed-in reads`: `SELECT TO authenticated USING (bucket_id =
  'task-media')` — no task or ownership predicate. Bucket is private, but the policy opens all of it.
  Uploads are correctly scoped to `{uid}/…`.
- **Impact.** Other users' job photos/videos, proofs and documents (PDF/Office/CSV are allowed types) are
  enumerable by any account.
- **Fix (P0/P1).** Scope SELECT to objects referenced by tasks the caller can see (open task media for
  bidders, poster/assigned worker for locked/started tasks, proof parties) via a `SECURITY DEFINER`
  helper; serve media with short-lived signed URLs only; consider disabling list for end users.
- **Test.** User B cannot `list` or `createSignedUrl` for user A's private-task object.

### F-04 — Open tasks are readable by `anon`, including exact coordinates **[FIXED — migrations 073, 074]**
- **Evidence.** `tasks_select_visible` allows `status='OPEN'` to role `public`; `anon` can SELECT
  `loc_lat`, `loc_lng`, `loc_label`, `media_path`, `benchmark_minor` and all other columns.
- **Impact.** A poster's precise job location is public before any worker is chosen.
- **Fix (P1).** Product decision: show a coarse (rounded/blurred) location to non-participants and the
  exact location only after assignment; revoke `anon` SELECT unless the web app genuinely serves a
  signed-out feed.

## Medium

### F-05 — Mass-assignment surface beyond `tasks` **[FIXED — migration 073]**
Same pattern (ownership policy, no column restriction, table-wide UPDATE/INSERT grants):
- `bids_update_own`: `task_id`, `is_locked`, `price_minor` editable after submit — a bid can be moved to a
  different task (bypassing the insert-time `task_open_for_bid` / not-own-task check) or re-priced after the
  poster has viewed it.
- `reviews_update_own` and `reviews_insert_participant`: any column (`task_id`, `subject_id`, `rating`,
  `about_role`) and a direct INSERT path that bypasses `submit_review`'s validation.
- `payout_destinations` INSERT: client-supplied `rzp_contact_id`, `rzp_fund_account_id`, `is_default`.
- `notifications_update_own`: every column (should be `read_at` only).
- **Fix.** Column-level grants + guard triggers; make the RPC the only write path for reviews; take
  `rzp_*` and `is_default` out of client reach. **Test.** One SQL assertion per table/column.

### F-06 — `anon` holds INSERT/UPDATE/DELETE on nearly every public table **[FIXED — migration 073]**
RLS is the only barrier. **Fix.** `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon`, then grant back
only what a signed-out visitor needs (if anything). Add `ALTER DEFAULT PRIVILEGES` so new tables do not
re-inherit it.

### F-07 — OTP verify attempt counter is not atomic **[FIXED — migration 077, phone-auth v13]**
`phone-auth` `verify` reads `attempts`, compares, then writes `attempts + 1` in separate statements, so
concurrent requests can exceed `MAX_ATTEMPTS = 5`. **Fix.** A single SQL function that does
`update … set attempts = attempts + 1 where phone = $1 and attempts < $max returning …` and compares
server-side; hash the code at rest and compare in constant time (F-17).

### F-08 — Per-IP throttles trust the first `x-forwarded-for` entry **[OPEN]**
`phone-auth` (SMS send budget) and `password-auth` (failed-login budget) key on the first element of a
header the caller can influence, so the per-IP limit can be evaded; the per-phone/per-username limits still
hold. The SMS per-IP budget exists to stop number-rotation cost abuse, which is exactly what it fails to do
if the key is spoofable. **Fix.** Use the platform-set client-IP header / last trusted hop; add a global
daily SMS ceiling with an alert; CAPTCHA on send when the ceiling nears.

### F-09 — Ad impression RPC is unthrottled **[FIXED — migration 076]**
`record_ad_impression` bills the promoter up to the daily budget for every call by any signed-in user;
there is no per-viewer dedupe or rate limit and the owner can call it on their own ad. **Fix.** Dedupe per
(viewer, promotion, window), reject owner views, per-viewer daily cap, and a server-side rate limit.

### F-10 — No audit log for admin or money actions **[FIXED — migration 076]**
No audit table exists and none of the `admin_*`/`crm_*` RPCs write one. **Fix (P1).** Append-only
`admin_audit_log` (who, action, target, before→after, reason, IP/UA), written inside each admin RPC in
the same transaction; no UPDATE/DELETE grants; viewable in admin; alert on wallet adjustments, manual
payouts, role grants, CRM exports.

### F-11 — Admin has no step-up and no dual control **[OPEN]**
Single factor (Google), no MFA/AAL2 requirement for manual payout, refund, wallet adjustment, role grant,
or CRM export; one admin can grant admin (`admin_set_admin`). **Fix.** Enforce Supabase MFA (TOTP) + AAL2
for money/role actions, restrict sign-in to the staff domain/allow-list, add dual approval above a
threshold, short session lifetime.

### F-12 — Admin sends no security headers **[FIXED]**
`next.config.mjs` sets only `X-Robots-Tag`. **Fix.** Nonce-based CSP, HSTS, `frame-ancestors 'none'`,
`Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`; verify cookie flags; put the panel on its
own subdomain behind the host firewall / IP allow-list.

### F-13 — CRM export is admin-gated but unaudited and unthrottled **[FIXED: audited; still unthrottled]**
Formula injection is already neutralised (`csvCell`) ✔. Missing: audit row per export, rate limit, PII
minimisation (phone/email included when the service key is present). **Fix.** Log every export; require
step-up (F-11); mask by default.

## Low / Info / Config

- **F-14 (Low)** `razorpay-setup` is deployed with `verify_jwt=false`. It is single-shot and inert once the
  webhook exists, but it is dead weight with a service-role client — delete it after setup.
- **F-15 (Low)** `phone-auth` still contains the `ALLOW_ANY_OTP` / `dev_otp_for_all` bypass paths. Both are
  locked off while MSG91 secrets exist and currently `false`, but a universal-takeover switch should not ship
  in the production artifact; also confirm `TEST_PHONES` is unset in production. The setting key is readable
  by every signed-in user.
- **F-16 (Low)** `Access-Control-Allow-Origin: *` on browser-called functions (`razorpay`,
  `razorpayx-payouts`, `phone-auth`, `password-auth`). Bearer-token APIs, so low risk; restrict to the app
  origins anyway. Webhooks need no CORS.
- **F-17 (Low)** OTP codes stored in plaintext in `auth_codes` (RLS deny-all, service-role only) and compared
  with `!==`; hash and constant-time compare.
- **F-18 (Config — owner)** Leaked-password protection is disabled (Supabase advisor).
- **F-19 (Config — confirm intent)** Live `settings.clearing_period_days = 0` while `packages/rules` says 7 and
  `HARDENING_PROMPT.md` assumes a clearing window. Zero days removes the clawback window before withdrawal.
- **F-20 (Low)** `private.guard_profile_columns` has a mutable `search_path` (advisor WARN); `private.*`
  helper functions are EXECUTE-able by PUBLIC (needed by RLS) — confirm `private` is not in the Data API
  exposed-schemas list (not readable via SQL; check the dashboard).
- **F-21 (Info)** 55 `authenticated`-executable `SECURITY DEFINER` RPCs (advisor WARN, expected). Reviewed: all
  but five public aggregates (`ad_auction`, `platform_highlights`, `public_profile_stats`, `top_earners`,
  `trending_categories`) check `auth.uid()` or `is_admin()`. `top_earners` discloses named individuals'
  earnings — a product decision to confirm.
- **F-22 (Dependencies)** `npm audit`: web monorepo 27 advisories (8 moderate, 19 high), nearly all the Expo
  build-time config-plugin chain; admin 2 (postcss via `next`, build-time). CI runs
  `npm audit --audit-level=moderate`, so it is expected to fail until each is triaged (fix, or an
  accepted-risk entry with reason). No `--force` into Next 16 / a new Expo major without a plan.
- **F-23 (Verify — owner)** `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` ships in the client. Its Google Cloud
  restriction (Android package + Play App Signing SHA-1, API allow-list, quota/budget alert) cannot be read
  from here — confirm in the console; preferred end state is an authenticated, rate-limited Edge Function
  proxy so no Maps key ships.
- **F-24 (Hygiene)** Local `taskdrop-claude-web/.env` holds `SUPABASE_SERVICE_ROLE_KEY` and Razorpay secrets
  beside public keys. It is git-ignored and was never committed, but server secrets belong in Supabase
  Vault / Vercel only. Admin repo has 5 uncommitted modified files.
- **F-25 (Info)** Git history: 88 + 4 commits scanned; no `.env*`, JWT, `sb_secret_`, private-key or live Razorpay
  key pattern; a Razorpay **test key id** (public identifier) appears 42 times. Not a secret; no rotation
  needed on this evidence.

## Found while fixing

- **F-26 (Medium — process)** The SQL regression suites had gone stale and were not guarding anything.
  `money_rules`, `chat_access`, `cancel_rules` and `rpc_surface` all failed against the live schema
  (wallet-funded `lock_bid` from migration 063, saved payout destinations 026, proof-of-work 057, a 10%
  commission instead of 20%), and `withdrawal_rules.test.sql` had single-`$` dollar-quote delimiters so it
  could not even parse — CI's `test:db` job could not have been green. **Fixed:** all updated to the current
  flows and passing; `funding_rules` rewritten for the wallet model; new suites added and wired into
  `npm run test:db`. **Behaviour drift to decide:** the documented 5% post-start cancellation fine
  (`settings.post_start_cancel_penalty_pct`) is no longer paid — `cancel_task()` logs a penalty of 0 and the
  poster's escrow returns in full. The test now asserts that the poster's money comes back and nothing is
  minted, with a note to restore the fine assertion when the owner decides.
- **F-27 (High — admin takeover surface)** The admin login page offers **"Text me a code"** — sign-in by mobile
  OTP — beside Google. Admin access therefore rests on SMS OTP strength (6 digits, 5 guesses, 10 minutes;
  now atomic, but still single-factor and still exposed to F-08). Recommend: Google-only for the admin, MFA
  (TOTP, AAL2) on top, and remove the phone option from the admin login.
- **F-28 (Info — test footgun)** `private.is_admin()` returns true for any session whose `session_user` is
  `postgres`/`supabase_admin` (migration 040's "operator" rule). Real app traffic runs as `authenticator`, so
  it is not reachable from the apps, but it makes any SQL test run as an admin unless overridden. The new
  suites override it inside their own transaction; the older ones do not exercise admin gating at all.
- **F-29 (Info — drift)** The live project has a migration `072_dispute_reason` that is not in the repo, and
  its migration versions are the apply-time timestamps rather than the repo filenames. New migrations were
  numbered 073–077 to stay clear; reconcile before using `supabase db push`/`db diff` against this project.
- **F-30 (Fixed)** A first attempt at the admin CSP broke the login page (blank screen) because Next
  prerendered `/login` and a prerendered page cannot carry a per-request nonce; it also blocked the Google
  Fonts the panel loads. Caught by loading the built app in a browser; fixed by rendering every page
  dynamically and allowing exactly `fonts.googleapis.com` / `fonts.gstatic.com`.

## Not assessed (blocked)

Release APK/AAB static and dynamic analysis (no release build was produced), Play Console readiness
(account deletion, Data Safety), live Supabase Auth settings (email signup, MFA, rate limits — dashboard
only), Google Cloud key restrictions, Vercel firewall/headers at the edge, the admin dashboard pages under
the new CSP (they need a signed-in admin; only `/login` was exercised in a browser), end-to-end delivery of
a live notification to a signed-in client, and webhook replay/forgery tests. See `TEST_REPORT.md`.
