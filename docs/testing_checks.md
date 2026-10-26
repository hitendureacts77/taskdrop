# TaskDrop testing checks

Version 1.0, 2026-10-22. The test plan for taking TaskDrop from "works for the owner and ~10 testers" to "safe to put in front of real customers and real money". Part A is the to-do list, phase by phase (T0 to T14); Part B is the reference (tools, test accounts, how to log a finding, notes from the videos).

This file is a companion to `docs/UPGRADE_PLAN.md` (which says what to **build**) and `docs/audit/` (what was found and fixed so far). This one says what to **try to break**, how, and what "passed" looks like.

## How to use this file

- `- [ ]` open, `- [x]` done **with evidence** (a log, a screenshot, a test name, a link; see Part B, section 5), `- [!]` failed (a finding is logged, section 3 of Part B), `- [-]` deferred or not applicable (say why).
- Each check has an ID (`T3.4`) so a finding, a pull request and a regression test can point back to it.
- Each check names **who can run it**:
  - **(Claude)**: an agent session can run it against the **test project** once you say "run phase T*n*". It needs no account sign-in of yours.
  - **(You)**: needs your accounts, your phone, a dashboard, or a decision.
  - **(Both)**: the agent prepares or runs it, you confirm or click the part that needs you.
- Every check has a **Pass** line: what you must see. If you cannot say what "pass" looks like, it is not a check yet.
- A check is not done because it "looked fine". It is done when the evidence is in `docs/audit/evidence/` (no secrets in it) or a test now guards it.
- Order matters: T0 to T2 first (set up, safety net, keys), because every later phase assumes they hold. T3 to T8 are where the serious bugs hide. T9 to T13 are quality, scale and paperwork. T14 is the gate.

## Ground rules for testing

1. **Test project and fake data only.** Everything runs against the cloud **test** project (`wjxvingpfbfvkfqhrguj`, fake data) or a throwaway copy. **Never** run attacks, load, fuzzing or a "wipe and reseed" against a production project. A reset or reseed needs your explicit OK (`AGENTS.md` rule 7).
2. **Only your own systems.** Attack your own app, your own Supabase, your own Vercel. Do **not** attack Razorpay, MSG91, Google, Expo or Sentry: use their **test modes** and their documented sandboxes, and respect their rate limits.
3. **Secrets never leave the machine.** Do not print, paste, commit or screenshot a key, token, `.env` value or service-role key. Redact evidence. If a secret does leak into a log, a screenshot, a chat or git, treat it as compromised and rotate it (T2.9).
4. **Every failure becomes a finding** (Part B, section 3): ID, severity, how to reproduce, fix, retest. **Every fix gets a regression test** (an SQL test, an `api` test or a Playwright test), so it cannot quietly come back.
5. **Re-test after every migration or RLS change.** Row-level-security bugs come back when someone adds a table or "fixes" a permission error. T3 is cheap to re-run; re-run it.
6. **Prove it both ways.** For every "user B must not see this", also prove "user A still can" (a positive control). A test that only ever sees "refused" may be broken.
7. **Money tests use test mode** until T14. Real money, in small amounts, is the last step, not the first.
8. **Write down what you did not test.** An honest "not tested: reason" beats a green board.

## Where we start (what already exists)

| Area | What is already in the repo | Gap this plan closes |
|---|---|---|
| Unit and `api` tests | `npm test` (rules, schemas, Inngest jobs, ImageKit, contacts, errors, `api` operations) | Property-based money tests, fuzzing (T4, T8) |
| Database tests | `npm run test:db`: 30+ SQL test files (money, RLS, column lockdown, rpc surface, blocks, moderation, MFA, audit, throttles) | Per-table access matrix as an identity × table grid, storage policies, views (T3, T5) |
| End-to-end | Playwright, 20 tests (`e2e/`: sign-in, money paths, rules, screens at desktop and phone size) | Safari, Android device runs, parallel/race tests, visual comparison (T7, T9, T10) |
| CI | `ci.yml` (check, `npm audit` gate, Deno type-check, old-app compatibility), `e2e.yml` | Secret scanning, SAST, SQL-test gating, scheduled runs (T1) |
| Security work | `docs/audit/SECURITY_FINDINGS.md` (F-01 to F-30, most fixed and proven), `THREAT_MODEL.md`, `SCALE_READINESS.md`, `TEST_REPORT.md` | Independent re-test of the fixes, the open items below, the release APK, load (T2 to T12) |
| Platform checks | Supabase security and performance advisors (run before and after the Phase 5 audit) | Run on a schedule; add to the gate (T1.7) |

**Still-open findings that this plan must close or consciously accept** (from `SECURITY_FINDINGS.md`; re-check each, do not trust the old status):

| ID | Open item | Where it is tested |
|---|---|---|
| F-08 | Per-IP throttles trust the first `x-forwarded-for` value; no global SMS ceiling | T6.4, T12.9 |
| F-11 | Admin step-up / dual control (the MFA gate for money exists since migration 080; re-prove it) | T6.15 |
| F-14 | `razorpay-setup` function still deployed | T7.3 |
| F-15 | Developer sign-in bypass (`dev_otp_for_all`) in the production sign-in function | T6.5 |
| F-16 | CORS `*` on browser-called functions | T7.4 |
| F-17 | OTP stored in plaintext (Low) | T6.6 |
| F-18 | Leaked-password protection off | T6.9 |
| F-19 | `clearing_period_days = 0` in the test project (must be 7 in production) | T8.12 |
| F-22 | `npm audit` advisories (build-time, transitive) | T1.5 |
| F-23 | Google Maps key restriction | T2.5 (your plan says this was restricted on 2026-10-22: verify it) |

## Where this plan comes from

- **Your two messages** (WhatsApp, 2 and 3 Oct): (1) refactor and cut API calls as far as possible **without changing the design**; (2) the most common problems are exposed API keys, SQL injection, insecure buckets and the like. They became T9 (calls, performance), T2 (keys), T4 (injection) and T5 (buckets).
- **The six Instagram links could not be read.** Instagram blocks the tool used here, so nothing from those videos is in this plan. Part B, section 4 has a table with a row per link: watch each, write down the point it makes, and map it to a check ID. Anything that is not covered gets a new check. This plan was **not** built from their content.
- **Public checklists**, used for the structure and the checks:
  - Supabase, "The Vibe Coding Master Checklist" and "Testing for Vibe Coders" (Aug 2025): RLS, keys in the front end, integration tests first, test with two users, webhooks idempotent.
  - Critical Cloud, "Vibe-Coded App Security: A Production Checklist": RLS with real policies, keys in the bundle, private buckets with `storage.objects` policies, views and `security definer` functions, roles from app metadata only, webhook signatures and rate limits, custom SMTP, MFA and a second owner everywhere, backups that include Storage and are restored once, alerts that reach a person.
  - OWASP API Security Top 10 (2023): BOLA, broken auth, BOPLA, resource consumption, BFLA, sensitive business flows, SSRF, misconfiguration, inventory, unsafe consumption of APIs (T7).
  - OWASP MASVS and MASTG for the Android app (T11); OWASP ASVS L2 for the web and admin (T6).
- **The repo's own audit** (`docs/audit/`), so this plan builds on what was found rather than starting over.

## Progress board

> Counts are generated from the boxes below. `[-]` boxes do not count against a phase.

<!-- BOARD:START -->
| Phase | Name | Status |
|---|---|---|
| T0 | Test environment, accounts and tooling | Not started, 0 of 8 checks done (3 need you only) |
| T1 | Automated safety net (CI) | Not started, 0 of 10 checks done (0 need you only) |
| T2 | Secrets and keys (the "exposed API keys" problem) | Not started, 0 of 12 checks done (4 need you only) |
| T3 | Database access and Row Level Security (the heart of a Supabase app) | Not started, 0 of 16 checks done (0 need you only) |
| T4 | Injection and hostile input (SQL injection, XSS and the rest) | Not started, 0 of 14 checks done (0 need you only) |
| T5 | Storage and media (the "insecure buckets" problem) | Not started, 0 of 13 checks done (0 need you only) |
| T6 | Authentication, sessions and accounts | Not started, 0 of 16 checks done (1 need you only) |
| T7 | Server API and business-logic authorization (OWASP API Top 10) | Not started, 0 of 13 checks done (1 need you only) |
| T8 | Money and payments (Razorpay, RazorpayX, escrow, wallets) | Not started, 0 of 14 checks done (1 need you only) |
| T9 | Performance, fewer API calls, and scale | Not started, 0 of 15 checks done (0 need you only) |
| T10 | Functional, usability and compatibility | Not started, 0 of 12 checks done (3 need you only) |
| T11 | Mobile app security (Android APK, OWASP MASVS) | Not started, 0 of 11 checks done (1 need you only) |
| T12 | Reliability, operations and recovery | Not started, 0 of 13 checks done (6 need you only) |
| T13 | Privacy, data and compliance checks (the testing side only) | Not started, 0 of 7 checks done (2 need you only) |
| T14 | Pre-production gate and sign-off | Not started, 0 of 10 checks done (0 need you only) |
<!-- BOARD:END -->

**Severity and the stop-ship rule.** *Critical*: someone can take or create money, take over an account, or read other people's private data. *High*: the same but needs more effort, or a whole class of users is locked out. *Medium*: real harm with a precondition, or a protection is missing. *Low*: hardening, noise. **No open Critical or High at launch. Every open Medium is accepted in writing by you (Part B, section 3).**

---

# Part A: the plan

## T0: Test environment, accounts and tooling

Nothing else is trustworthy until the test setup is.

- [ ] **T0.1 (You)** Confirm the test project holds only fake data and none of it is a real person's phone, email, UPI or PAN. *Pass:* a count of `auth.users` whose phone is not on the test-number list is zero or each one is known to you.
- [ ] **T0.2 (Both)** A written list of every environment: local, test (cloud), Vercel preview (`redesigned-2.0`), beta, and production (does not exist yet). For each: its Supabase project ref, its Vercel project, its Razorpay mode, its SMS mode. *Pass:* the list is in `docs/audit/evidence/` and nothing points a test at production.
- [ ] **T0.3 (Both)** Test identities exist (Part B, section 2): anonymous, poster A, worker B, attacker C, suspended user, under-18 user, and one admin of each staff role (full admin, finance, support, sales, viewer). Each has a **saved sign-in state** so tests do not log in by hand. *Pass:* a test can act as each identity in one line.
- [ ] **T0.4 (Claude)** A helper that calls the `api` function and PostgREST **as each identity**, plus a way to run SQL as `anon` and `authenticated` with a user's JWT claims (the way `docs/audit/TEST_REPORT.md` did). *Pass:* one command shows the same query returning different rows for A, B and anonymous.
- [ ] **T0.5 (You)** Razorpay and RazorpayX are in **test mode** with test keys; MSG91 is in a mode that does not send real SMS to strangers. *Pass:* the dashboards say Test mode; no real card or UPI ID has been used.
- [ ] **T0.6 (Both)** Seed and reset: `npm run seed:reset` rebuilds a known dataset (10 users, tasks in every state, a funded task, a disputed task, a payout). *Pass:* running it twice gives the same state, and it refuses to run against a project that is not the test one.
- [ ] **T0.7 (Both)** Tools installed (Part B, section 1): gitleaks, Semgrep, osv-scanner, k6, Lighthouse, an HTTP proxy (mitmproxy or Burp Community or OWASP ZAP), MobSF, jadx/apktool, Maestro, axe. *Pass:* each runs `--version`.
- [ ] **T0.8 (You)** Two real Android phones (one low-end, 3 GB RAM or less; one recent) and at least one iPhone is **not** needed yet (iOS is deferred). *Pass:* both phones have the `beta` APK installed.

## T1: Automated safety net (CI)

The cheapest bugs to fix are the ones that never merge. Make the machine say no.

- [ ] **T1.1 (Claude)** `npm run check` is green on `redesigned-2.0` and is a **required** check on pull requests. *Pass:* a deliberately broken type blocks the merge.
- [ ] **T1.2 (Claude)** `npm run test:db` runs in CI on a throwaway database and a failing SQL test blocks the merge. *Pass:* break one RLS rule on a branch; CI turns red.
- [ ] **T1.3 (Claude)** Playwright (`e2e.yml`) runs on a schedule (nightly) and before any promotion to `main`, not only by hand. *Pass:* three consecutive green runs; a failing run alerts you.
- [ ] **T1.4 (Claude)** **Secret scanning in CI and on history**: `gitleaks detect` over the full history of both repos, plus push protection or a pre-commit hook. *Pass:* zero findings, or each finding is a known public value (a Supabase publishable key, a Sentry DSN) listed with a reason.
- [ ] **T1.5 (Claude)** Dependency checks: `npm run audit:gate` plus `osv-scanner` over both lockfiles. Each exception in `audit-exceptions.json` has a reason and a review date that has not passed. *Pass:* no un-excepted High or Critical advisory; no exception is older than its review date.
- [ ] **T1.6 (Claude)** Static analysis: Semgrep with the `p/owasp-top-ten`, `p/typescript`, `p/react` and `p/jwt` rule packs over `apps`, `packages`, `supabase/functions` and the admin repo. *Pass:* every finding is fixed or marked a false positive with a reason.
- [ ] **T1.7 (Both)** Supabase **security and performance advisors** re-run, and the result is saved. *Pass:* zero ERROR; every WARN is explained; none is new since the last run.
- [ ] **T1.8 (Claude)** A "no secrets in the bundle" check runs on every web export: scan `apps/mobile/dist` for `service_role`, `sk_`, `rzp_live`, `RAZORPAY_KEY_SECRET`, `AIza`, `-----BEGIN`, and for any `.map` file. *Pass:* none present (this extends the one-off check done on 2026-10-21).
- [ ] **T1.9 (Claude)** Migration safety in CI: the old-app compatibility job stays green (migrations only add), and a check fails any migration that creates a table without `enable row level security`. *Pass:* a test migration with no RLS is rejected.
- [ ] **T1.10 (Claude)** A flaky-test rule: a test that fails then passes is fixed or deleted within a week. *Pass:* the e2e history shows no unexplained retries.

## T2: Secrets and keys (the "exposed API keys" problem)

- [ ] **T2.1 (Claude)** **Classify every key.** Build a table of every environment variable and secret in both repos, Vercel, EAS and Supabase (names only, never values): which are *public by design* (Supabase publishable key, Sentry DSN, `EXPO_PUBLIC_*`) and which are *secret* (service role, Razorpay and RazorpayX secrets, webhook secrets, MSG91, ImageKit private key, Inngest keys, `GOOGLE_SERVICES_JSON`, Google Maps **server** key). *Pass:* every name is in exactly one column; `docs/UPGRADE_PLAN.md` section 7 matches the code.
- [x] **T2.2 (Claude)** No secret has a public prefix: grep for `EXPO_PUBLIC_`, `NEXT_PUBLIC_` and `VITE_` names that hold anything on the secret list. *Pass:* none. (At the last check the only `EXPO_PUBLIC_` names in the app were the Supabase URL and key, Sentry, legal and copyright text, and the app URL.) **Passed 2026-10-26:** both repos hold only the Supabase URL and publishable key, Sentry DSN, environment and replay rate, legal and copyright text, the app URL, the five Firebase web values and the reCAPTCHA site key (all public by design). `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` now appears only in comments (the key moved to `places-search`). `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN` is set only in the EAS `preview` environment (beta APKs, owner decision, PR 84); EAS `production` does not have it, so store builds use Play Integrity.
- [x] **T2.3 (Claude)** **Scan the built web bundle** (`npm run web:export`): search every `.js` file for the secret patterns in T1.8 and for the service-role key by its JWT shape. *Pass:* none. The Maps key is not in the web bundle (verified 2026-10-21; re-verify on every build). **Passed 2026-10-26 on the live site** (6 scripts, 2.9 MB, build of `a5181e7`): no `service_role`, `sk_`, `rzp_`, `RAZORPAY_KEY_SECRET`, `sb_secret_`, ImageKit private key, PEM or JWT. The one `AIza` key is `EXPO_PUBLIC_FIREBASE_API_KEY` (public by design), not the Maps key. Every `.map` answers 403.
- [ ] **T2.4 (Both)** **Scan the release APK** (T11.2): unzip, run `strings` and MobSF over the Hermes bytecode and assets. *Pass:* no server secret; the only keys are the ones on the public list.
- [ ] **T2.5 (You)** **Every client-side key is restricted at the provider.** Google Maps/Firebase key: limited to the Android package `com.taskdrop.app` + SHA-1 and to only the APIs it needs; the Places **server** key is limited by API and never shipped. Supabase publishable key: expected public, so the protection is RLS (T3). *Pass:* screenshots of the restriction pages; a request with the key from another package or origin is refused.
- [x] **T2.6 (Claude)** **Git history is clean** in both repos and on every branch (`gitleaks` over all refs). *Pass:* zero real secrets. If one is found, it is rotated (T2.9) **and** removed; deleting the latest commit is not enough. **Checked 2026-10-26.** gitleaks is not installed on this PC, so a script with the same main patterns ran over every ref: 320 commits in the app repo, 61 in the admin repo. Admin repo: nothing. App repo: two hits. The old Razorpay **test** key pair in `supabase/functions/_shared/secrets.ts` (commit c926854, 2026-09-14, removed since) is known and accepted by the owner (test account only, no rotation, decision 2026-10-25, manual 3.2). The CI database URL `postgres:…@127.0.0.1:54322` is Supabase's local default, not a secret. Passed with that one accepted item.
- [ ] **T2.7 (Both)** **Logs and monitoring do not leak.** Trigger errors on web, Android, the admin and each function, then read the Sentry events, the Supabase function logs, the Vercel logs and the Inngest runs. *Pass:* no token, key, phone number, email, UPI ID, PAN or address appears (the plan's Phase 1 rule: user id only).
- [ ] **T2.8 (Both)** **Errors do not reveal internals.** Send bad input to every function. *Pass:* responses never contain a stack trace, a SQL error text, a table or column name, a file path or a library version; users see plain-language messages.
- [ ] **T2.9 (You)** **Rotation drill.** Pick one low-risk secret (e.g. the ImageKit private key or an Inngest key), rotate it end to end and time it. *Pass:* the app keeps working after rotation, the old value is refused, and you have a written step list for the high-risk ones (service role, Razorpay, RazorpayX, webhook secrets).
- [ ] **T2.10 (You)** **CI and build logs** (GitHub Actions, Vercel, EAS) are read for echoed secrets; secrets are masked; `pull_request` workflows from forks cannot read secrets. *Pass:* no secret visible in any log.
- [x] **T2.11 (Claude)** The `.env.all-secrets` style files are git-ignored and absent from every published artifact (web `dist`, EAS upload, Vercel output). *Pass:* a search of each artifact finds no such file. **Passed 2026-10-26:** `.env.all-secrets` is ignored by `.gitignore` (`.env.*`) and by `.easignore`. The only env files ever committed are the two `.env.example` files. On the live site, `/.env`, `/.env.local` and `/.env.all-secrets` return the app page, not a file. Vercel builds from a GitHub clone, so ignored files never reach it.
- [ ] **T2.12 (You)** **Account security for everything that holds the keys:** MFA on GitHub, Supabase, Vercel, Expo, Google Cloud/Firebase, Razorpay, the domain registrar (Spaceship) and the email inbox that resets them. A second owner/recovery path exists for each. *Pass:* a checklist with a screenshot per account.

## T3: Database access and Row Level Security (the heart of a Supabase app)

In a Supabase app the browser talks to the database directly, so **RLS, column grants and function permissions are the whole security layer** (`THREAT_MODEL.md`). Test them as a grid, not by feel.

- [ ] **T3.1 (Claude)** **RLS is on for every table** in every exposed schema, with real policies. Query `pg_tables`/`pg_class` for `relrowsecurity = false` in `public`. *Pass:* none, apart from tables you have listed on purpose.
- [ ] **T3.2 (Claude)** **No lazy policies:** search `pg_policies` for `using (true)` / `with check (true)` on any table that holds a person's data. *Pass:* none, or each is a deliberately public read (e.g. categories) with a comment.
- [ ] **T3.3 (Claude)** **The identity × table grid.** For every table, run select, insert, update and delete as: anonymous, user A (owner), user B (stranger), the suspended user, and each staff role. Record what each can do. *Pass:* the grid matches the intended table, committed as a test (`supabase/tests/access_grid.test.sql`). Anonymous holds **no** grants on private tables (F-06).
- [ ] **T3.4 (Claude)** **Direct Data API probe as anonymous.** With only the public URL and publishable key, request every table and view through `/rest/v1/`. *Pass:* private tables answer 401/403/empty; no row of private data comes back.
- [ ] **T3.5 (Claude)** **IDOR at the database layer:** A creates a task, bid, message, review, payout destination, wallet row and notification; B tries to read, edit and delete each **by id**. *Pass:* B gets nothing and changes nothing; A still can (positive control).
- [ ] **T3.6 (Claude)** **Mass assignment:** insert and update with extra columns (`funded_at`, `status`, `rating`, `balance_minor`, `is_admin`, `role`, `rzp_*`, `payout_upi`, `suspended`). *Pass:* every protected column is refused (F-01, F-05 stay fixed); the trigger and column grants are covered by `column_lockdown.test.sql`.
- [ ] **T3.7 (Claude)** **RPC surface:** list every function `authenticated` or `anon` can execute (`has_function_privilege`). *Pass:* it matches an allowlist file in the repo; admin and money functions are refused to normal users **and** to the wrong staff role; a new function is private until someone adds it to the list (`rpc_surface.test.sql`).
- [ ] **T3.8 (Claude)** **`security definer` review:** every such function sets `search_path`, checks `auth.uid()` or a role inside its body, and never trusts an id argument as "who is calling". *Pass:* a reviewed table of function → why definer → what it checks.
- [ ] **T3.9 (Claude)** **Views:** every view in an exposed schema is `security_invoker = true` or intentionally definer with a reason, and none exposes `auth.users`. *Pass:* the advisor and a catalog query agree.
- [ ] **T3.10 (Claude)** **Roles come from the server, not the user.** Search policies and functions for `raw_user_meta_data` / `user_metadata` used for a permission. *Pass:* roles come from `app_metadata` or a table only; a user who edits their own metadata gains nothing.
- [ ] **T3.11 (Claude)** **Private columns stay private:** exact location, UPI, phone/synthetic email, PAN and address are only readable by the owner or after the unlock rule (poster chose a worker, work started). *Pass:* a stranger, an applicant and the poster each see exactly what the rules say (F-02, F-04).
- [ ] **T3.12 (Claude)** **Realtime authorization:** subscribe to `messages`, `notifications` and any broadcast channel as a stranger. *Pass:* no event for someone else's rows arrives; after the Phase 9 lockdown `messages` and `notifications` are off the public realtime feed.
- [ ] **T3.13 (Claude)** **Blocks and suspensions are enforced in SQL:** a blocked user cannot bid, message or see the blocker's open tasks; a suspended user cannot withdraw or post. *Pass:* `blocks_enforced.test.sql` passes and also holds through the REST API, not only the app.
- [ ] **T3.14 (Claude)** **Audit trail:** every admin and money action writes an append-only row that even the table owner cannot edit. *Pass:* an update/delete on `admin_audit_log` fails.
- [ ] **T3.15 (Both)** **Backups and restore** are tested in T12.1 (a backup nobody has restored is a hope, not a backup).
- [ ] **T3.16 (Claude)** **Constraints and types:** money is integer minor units (paise) everywhere, never float; check constraints stop negative amounts, empty strings and over-long text at the database, not only in the app. *Pass:* inserting `-1`, `0.5`, `1e12` or 10 MB of text into each money/text column is refused.

## T4: Injection and hostile input (SQL injection, XSS and the rest)

The app does not build SQL strings from user input in the usual way: it uses the Supabase client, parameterised RPC calls and an `api` function. That removes the classic SQL injection, but **not** the vibe-coding versions of it. Test the seams below.

- [ ] **T4.1 (Claude)** **Dynamic SQL review.** Every `execute format(...)` and `execute '...'` in `supabase/migrations/` and every raw SQL string in `supabase/functions/` and the admin. At the last scan, the `execute format` uses were for fixed internal lists (table names via `%I`, function signatures via `%s`) in setup migrations, which are safe only while the list is not user-controlled. *Pass:* a reviewed table: each site, where its inputs come from, and `%I`/`%L` (or a fixed list) for every dynamic part. No user input reaches `%s`.
- [ ] **T4.2 (Claude)** **PostgREST filter injection.** The search code builds an `or(...)` filter string from the user's text (`supabase/functions/api/reads.ts` `searchTasks`; the admin's `lib/data/users.ts` and `tasks.ts`). The API version strips `, ( ) * % \`, but not `"`, `.` or `:`. *Pass:* fuzz the search box on the app, the API and the admin with every character in `",.:;()*%\_'` plus `%00`, very long strings and Unicode; no result outside the caller's rights, no 500, no change in the filter's meaning (e.g. `a,status.eq.OPEN` cannot add a clause).
- [ ] **T4.3 (Claude)** **SQLi payloads at every input** (a list of classic strings: `' OR 1=1--`, `"; drop table x;--`, `' UNION SELECT ...`) sent to every `api` operation field, every RPC argument and every form, as each identity. Use **sqlmap against the test project's `api` endpoint with a test token**, rate-limited, only on the test project. *Pass:* no error text from the database, no extra rows, no timing difference.
- [ ] **T4.4 (Claude)** **LIKE/ILIKE wildcards:** `%` and `_` in a username or search return one literal match, not "everyone". *Pass:* `ilike` lookups that must match one person (the admin's by-username lookup) strip wildcards (it does; keep it that way) and are covered by a test.
- [ ] **T4.5 (Claude)** **Stored XSS.** Put `<script>`, `<img onerror>`, `"><svg onload>`, `javascript:` links and HTML in: task title and description, bid message, chat, review, display name, username, bio, address label, support ticket, report reason, referral text. View each as the **other** user, on web, and in the **admin** (staff read user content, so this is the high-value target). *Pass:* shown as inert text everywhere; the admin's CSP blocks inline script (`middleware.ts`); no alert fires.
- [ ] **T4.6 (Claude)** **Output encoding on every channel:** push notification text, emails/SMS templates, CSV exports, PDF/legal exports, share links and deep links. *Pass:* hostile text does not execute or change structure in any of them.
- [ ] **T4.7 (Claude)** **CSV/formula injection in admin exports** (`=HYPERLINK(...)`, `+cmd`, `-2+3`, `@SUM`): a user's display name starting with `=` is exported with a leading quote. *Pass:* opening the export in a spreadsheet runs nothing.
- [ ] **T4.8 (Claude)** **URLs the server fetches (SSRF).** Anywhere a server fetches a URL from input or follows a redirect (`places-search`, media/link previews, webhook targets, ImageKit). *Pass:* `http://169.254.169.254/`, `http://localhost`, `file://` and private ranges are refused; a redirect to them is refused.
- [ ] **T4.9 (Claude)** **Path and filename tricks:** `../`, absolute paths, very long names, Unicode look-alikes, null bytes and `.php`/`.html` extensions in uploaded filenames and object paths. *Pass:* stored under server-generated names inside the caller's own prefix; none escapes.
- [ ] **T4.10 (Claude)** **Type and size abuse on the `api` function:** numbers as strings, `NaN`, `Infinity`, negative, 2^53+1, arrays where scalars are expected, deeply nested JSON, a 10 MB body, 10,000 array items, a missing `op`, an unknown `op`. *Pass:* a clean 4xx with a plain message; never a 500, a hang, or a partial write. Validation lives in the shared Zod schemas **and** the database.
- [ ] **T4.11 (Claude)** **The "no phone numbers in posts" rule cannot be dodged.** Try digits with spaces, dots, words ("nine eight seven..."), Devanagari or other numerals, "WhatsApp me at", emails, UPI IDs, links, zero-width characters and repeated retries, on posts, bids, bios, chat and ticket text, **straight at the API** (`e2e/rules.spec.ts` covers the basics). *Pass:* each dodge is refused or deliberately accepted and written down (the rule protects the fee model, so it matters).
- [ ] **T4.12 (Both)** **HTML/SVG upload and polyglots:** an SVG with script, an HTML file renamed `.jpg`, a GIF/JS polyglot, an `.apk`, a 0-byte file, a corrupt video. *Pass:* refused by type **and** by content, never served with a type a browser would execute (see T5).
- [ ] **T4.13 (Claude)** **Open redirects and deep links:** the `taskdrop://` scheme and web `?page=` / redirect parameters do not forward to a URL you did not allow. *Pass:* only same-origin or allow-listed targets.
- [ ] **T4.14 (Claude)** **Unicode and layout stress:** emoji, right-to-left text, 500-character names, Hindi/Hinglish, combining marks. *Pass:* no crash, no overflow that hides a button, correct sorting and search; the design does not break.

## T5: Storage and media (the "insecure buckets" problem)

- [ ] **T5.1 (Claude)** **Bucket inventory.** List every bucket (`storage.buckets`): public or private, size limit, allowed types. Include ImageKit folders and the Supabase buckets for video and documents. *Pass:* a table of bucket → purpose → public? → who may read/write/delete. Nothing private is in a public bucket.
- [ ] **T5.2 (Claude)** **Policies on `storage.objects` exist** for every private bucket and are scoped to the owner or to the task's participants. *Pass:* the policy text is reviewed; none says `true`.
- [ ] **T5.3 (Claude)** **Anonymous probe:** list and read the bucket with the publishable key and with guessed paths. *Pass:* listing is refused; guessing a path of someone else's file returns nothing.
- [ ] **T5.4 (Claude)** **Cross-user probe:** B tries to list, read, overwrite and delete A's avatar, task photos, chat photos and proof-of-work files by exact path. *Pass:* refused for everything B is not entitled to (F-03 stays fixed); positive controls pass (a participant can open a chat photo; a poster can open the proof).
- [ ] **T5.5 (Claude)** **Signed URLs:** they expire, are tied to the file, and cannot be turned into a longer-lived link by editing the URL. *Pass:* a URL used after its expiry fails; changing the path or the signature fails; the lifetime is short (minutes, not months).
- [ ] **T5.6 (Claude)** **Moderation really hides:** after staff hide a photo or message, the signed-URL function refuses it and a previously issued URL stops working on its expiry. *Pass:* a hidden photo is unreachable to both users on web and Android.
- [ ] **T5.7 (Claude)** **Upload limits are enforced server-side:** type allow-list (no SVG/HTML), 50 MB cap for proof files, video up to 60 s, photo size, and a per-user upload rate. *Pass:* an oversize or wrong-type upload sent directly to the storage API (bypassing the app) is refused.
- [ ] **T5.8 (Claude)** **Uploads are scoped to the caller:** B cannot upload into A's folder or overwrite an existing object. *Pass:* refused; names are server-generated.
- [ ] **T5.9 (Both)** **ImageKit:** the private key is a server secret; upload tokens are short-lived and single-purpose; delivery URLs for private content are signed; a Supabase user without access cannot get a URL. *Pass:* each point shown by a failed attempt.
- [ ] **T5.10 (Claude)** **Privacy in images:** photos have GPS/EXIF stripped (or you state why not); the public profile does not reveal an exact address. *Pass:* a photo taken at home, uploaded and downloaded by a stranger carries no coordinates.
- [ ] **T5.11 (Both)** **Lifecycle:** deleting an account, a task or a message removes its files (and ImageKit copies); abandoned uploads are cleaned up after 24 h; orphan files are reported. *Pass:* after deletion a search of every bucket for that user's id finds nothing.
- [ ] **T5.12 (Both)** **Backups of files.** Supabase database backups do **not** include Storage files. *Pass:* a written answer to "if a bucket is wiped, how do we get the files back?", tested once (T12.1).
- [ ] **T5.13 (Claude)** **Content types and headers on delivery:** `X-Content-Type-Options: nosniff`, download as attachment for documents, no HTML ever served inline from a user upload. *Pass:* headers checked on one file of each type.

## T6: Authentication, sessions and accounts

- [ ] **T6.1 (Claude)** **Logged-out access:** type every app URL and admin URL while signed out. *Pass:* redirected to sign-in or refused; no private data in the page source or in the first network response.
- [ ] **T6.2 (Claude)** **Token tampering:** edit a JWT's `sub`, `role`, `exp`; use `alg: none`; use a token from another project; use an expired token; use a token after "sign out everywhere". *Pass:* every one refused.
- [ ] **T6.3 (Claude)** **Role escalation:** a normal user calls every admin RPC and admin API route; a Sales/Support/Viewer staff member calls money functions. *Pass:* refused at the **database** (`staff_role_db_guards.test.sql`), not only hidden in the menu.
- [ ] **T6.4 (Claude)** **OTP abuse:** brute-force the 6-digit code (attempt cap, burn on cap), replay a used code, use an expired code, request many codes for one phone and from one IP, spoof `X-Forwarded-For` to dodge the per-IP limit (F-08), use many numbers to pump SMS. *Pass:* caps hold; a **global daily SMS ceiling** exists and alerts you; spoofed headers do not reset the limit.
- [ ] **T6.5 (Both)** **No developer bypass in production:** `dev_otp_for_all` is Off, test phone numbers are removed or disabled, and the dev-code path (F-15) is gone or unreachable. *Pass:* in a production-configured environment a random number cannot sign in with a known code.
- [ ] **T6.6 (Claude)** **OTP storage:** codes are stored hashed or are short-lived and compared in constant time (F-17 Low). *Pass:* decision recorded.
- [ ] **T6.7 (Claude)** **Sign-up/sign-in does not reveal accounts:** the same message and similar timing for known and unknown phones and usernames. *Pass:* no way to enumerate users.
- [ ] **T6.8 (Both)** **Google and Apple sign-in:** redirect URL allow-list is exact (no wildcards that include an attacker's host), PKCE is S256, a second method for the same person links instead of duplicating, and a user cannot take over another's account by registering the same email at a provider. *Pass:* each case tried.
- [ ] **T6.9 (You)** **Password rules:** minimum length, leaked-password protection **on** (F-18), lock-out or slow-down after repeated failures, reset flow safe. *Pass:* a known-breached password is refused; 20 wrong guesses are slowed.
- [ ] **T6.10 (Claude)** **Age gate (18+):** cannot be skipped by editing the request, deleting the field or changing the date format; an under-18 account is refused at **every** way in (phone, Google, username). *Pass:* `age_gate.test.sql` plus a direct API attempt.
- [ ] **T6.11 (Claude)** **Sessions:** sign out really ends the session; "sign out everywhere" works; refresh tokens rotate; the token is in secure storage on Android (`lib/secureStorage.ts`), not in plain storage; idle timeout on the admin. *Pass:* a copied old token stops working.
- [ ] **T6.12 (Claude)** **Suspended and deleted users:** a suspended user is signed out and blocked at the database; a deleted user's data is removed or anonymised, their sessions end, and their phone can sign up again cleanly. *Pass:* `account_deletion.test.sql` plus a live pass.
- [ ] **T6.13 (Both)** **Supabase Auth settings are production-grade:** custom SMTP configured (the built-in mailer does not reach real users), email confirmation where used, short OTP expiry, rate limits on, CAPTCHA/Turnstile decision recorded, redirect URLs trimmed to the real ones. *Pass:* screenshots of each setting page.
- [ ] **T6.14 (Claude)** **Admin web security:** CSP with nonce, HSTS, frame-ancestors, no CSRF hole in server actions, cookies `HttpOnly` + `Secure` + `SameSite`, login restricted to the staff allow-list, idle and total session limits. *Pass:* response headers captured; a cross-site form post to a server action fails.
- [ ] **T6.15 (Both)** **Money needs step-up:** every admin money action asks for an authenticator code each session; an admin who lost the code cannot bypass it; a second full admin exists. *Pass:* a payout, a refund and a settings change are each refused without the code (F-11 re-proved).
- [ ] **T6.16 (Claude)** **Sales is money-blind** and **Support/Viewer are view-only** where the plan says so, at the database and in exports and the live feed. *Pass:* the role × page × action grid is a test; the `admin:live` channel shows no money to Sales.

## T7: Server API and business-logic authorization (OWASP API Top 10)

The `api` Edge Function (about 90 operations across `apps/mobile/src/data/api.ts` and `extras.ts`) is where "who may do what to which object" is decided. Test it as a grid and against the OWASP list.

- [ ] **T7.1 (Claude)** **Operation inventory** (API9): generate the list of every `api` operation and every other function endpoint from the code, with the identity each is meant for. *Pass:* the list is a committed file and a test fails if a new operation is added without an entry.
- [ ] **T7.2 (Claude)** **Operation × identity grid** (API1 object-level, API5 function-level): call **every** operation as anonymous, owner, stranger, wrong role, suspended, blocked and each staff role, with real ids and swapped ids. *Pass:* the grid matches the intended table; "stranger passes an owner's id" is refused on every operation that takes an id.
- [ ] **T7.3 (Both)** **Endpoints that skip the JWT check** (`verify_jwt = false`: `phone-auth`, `password-auth`, `razorpay-webhook`, `app-config`, `inngest`, and others in `supabase/config.toml`): each one authenticates the caller another way, rate-limits, and returns nothing private. `razorpay-setup` is deleted or locked (F-14). *Pass:* a table of endpoint → how it knows the caller → what it can do.
- [ ] **T7.4 (You)** **CORS:** `Access-Control-Allow-Origin: *` is replaced with the real web origins in production (F-16). *Pass:* a request from another origin is refused by the browser; the app and admin still work.
- [ ] **T7.5 (Claude)** **Property-level checks** (API3): responses never include fields the caller should not see (other people's phone, exact location, PAN, wallet balance, internal flags); updates ignore fields the caller must not set. *Pass:* a diff of response fields per identity.
- [ ] **T7.6 (Claude)** **Resource limits** (API4): page sizes are capped, every list has a limit, expensive filters are bounded, big uploads and big JSON are refused, and each operation has a rate limit (`api_rate_hit`). *Pass:* asking for `limit=100000` returns the cap; 200 calls in 10 s from one user get slowed or refused; one user cannot slow everyone.
- [ ] **T7.7 (Claude)** **Sensitive business flows** (API6): sign-up bonus/referral abuse, fake reviews between two of your own accounts, self-dealing (post and bid on your own task), bid spam, cancel-and-repost loops, promotion/ad click inflation, support-ticket spam. *Pass:* each is refused, capped or visible to staff.
- [ ] **T7.8 (Claude)** **Race conditions** (parallel requests with the same token): fund the same task twice, accept two bids at once, withdraw the whole balance twice, cancel while approving, start two promotions, claim one referral twice. *Pass:* exactly one succeeds, balances are right, no negative wallet; use 50 parallel requests, repeated.
- [ ] **T7.9 (Claude)** **Idempotency and replay:** repeat the same payment, withdrawal, refund and webhook request. *Pass:* the second is a no-op that returns the first result (idempotency keys or unique constraints), never a second charge.
- [ ] **T7.10 (Claude)** **State machine:** try every illegal transition (complete before start, start before funding, approve twice, cancel after completion, reopen a disputed task) by calling the operations directly. *Pass:* only the transitions in the lifecycle diagram work (`docs/taskdrop-plan.html` section 04).
- [ ] **T7.11 (Claude)** **Unsafe consumption of third-party data** (API10): webhook bodies, Razorpay/RazorpayX responses, Google Places results and push receipts are validated, not trusted; a malformed response fails closed. *Pass:* a fake provider returning odd values is handled.
- [ ] **T7.12 (Claude)** **Old and new app together** (rule 2 of `AGENTS.md`): the compatibility job runs the old app's operations through the new `api`. *Pass:* green; a new field never breaks the old app. After Phase 9, the lockdown test (a direct database call with the public key + a user token is refused) passes.
- [ ] **T7.13 (Claude)** **Error handling:** a thrown error becomes a plain 4xx/5xx with a code, never a stack, and is reported to Sentry without personal data. *Pass:* T2.8 and T4.10 together.

## T8: Money and payments (Razorpay, RazorpayX, escrow, wallets)

This is where a bug costs real money. Test with test keys; the live-money run is T14.

- [ ] **T8.1 (Claude)** **Money maths is exact.** Property-based tests (`fast-check`) over `packages/rules`: for random prices, the poster pays offer + 3 %, the worker's commission and the 5 % fine round the same way everywhere, nothing is ever negative, and **sum of every party's change = 0** (no paise created or lost). *Pass:* 10,000 random cases pass; the same constants are used by the app, the `api` function and the SQL.
- [ ] **T8.2 (Claude)** **No client-trusted prices:** change the price, the fee, the commission, the days or the promotion budget in the request. *Pass:* the server recomputes and ignores or refuses; `start_promotion` only accepts the configured tiers (migration 114).
- [ ] **T8.3 (Both)** **Pay-in:** card, UPI and netbanking in Razorpay **test mode**; success, failure, user abandons, bank timeout, double submit, wrong amount, currency mismatch. *Pass:* funding happens only on a verified success, exactly once, for the exact amount.
- [ ] **T8.4 (Claude)** **Webhook forgery and replay:** send a "payment captured" webhook with no signature, a wrong signature, a signature over a re-serialised body, an old valid one replayed, a duplicate event id, an out-of-order event, a wrong amount, and one for an unknown order. *Pass:* all but the first valid delivery are refused or are no-ops; the event id is recorded once; the amount and currency are reconciled against the order.
- [ ] **T8.5 (Claude)** **Ledger invariants:** for every wallet and task, `balance = Σ ledger`; escrow held = Σ of funded, unreleased tasks; platform earnings = fee + commission − refunds. The nightly reconcile (`run_reconciliation`) runs and alerts. *Pass:* a deliberately planted bad row is caught (already shown once on 2026-10-17: repeat after the next change).
- [ ] **T8.6 (Both)** **Withdrawals and payouts:** minimum amount, destination ownership, a destination edited just before withdrawing, insufficient balance, a suspended user, a RazorpayX failure, a timeout after money was sent, a retry. *Pass:* money is never lost or sent twice; a "sent but not recorded" case alerts you (`Sentry fatal`) and is reconcilable.
- [ ] **T8.7 (Both)** **Refunds and cancellation:** before payment, before start, after start (5 % fine), disputed, worker no-show, poster no-show, partial refund, refund to wallet vs to card/UPI. *Pass:* each path ends with every party's balance as the rules say, and an audit row.
- [ ] **T8.8 (Claude)** **Time rules:** 3-day approve window, auto-complete, 7-day clearing, deadlines and overdue, at midnight IST boundaries, around clock skew and a missed cron. *Pass:* with time advanced in a test, the right thing happens once; a missed run is caught up, not doubled.
- [ ] **T8.9 (Claude)** **Disputes:** both sides' evidence, an admin ruling, a ruling after a refund, two admins ruling at once. *Pass:* one ruling applies, money matches it, the other admin sees a clear message.
- [ ] **T8.10 (Claude)** **Promotions and wallet top-ups:** buy, end early, refund unspent, double-click, concurrent buys. *Pass:* spend ≤ budget; impressions are throttled (F-09 stays fixed).
- [ ] **T8.11 (Both)** **Fee and tax correctness with your lawyer/accountant:** commission, service fee, GST on fees, TDS/TCS if they apply, invoices. *Pass:* a written answer from a qualified person. (This is a legal question, not a test I can pass for you.)
- [ ] **T8.12 (You)** **Production money settings are set** and different from the test project: `clearing_period_days = 7` (F-19), commission 10 %, review window 3 days, minimum withdrawal. *Pass:* a settings screenshot taken **in the production project** before launch.
- [ ] **T8.13 (Both)** **Test mode and live mode cannot mix:** live keys exist only in production secrets; test keys cannot be used in production and vice versa; webhook secrets differ. *Pass:* a live-mode webhook sent to the test project is refused, and the reverse.
- [ ] **T8.14 (Claude)** **Fraud and abuse signals:** two accounts on one device paying each other, rapid fund-and-withdraw loops, many small withdrawals, new account + big withdrawal. *Pass:* each is limited or flagged to staff (decide the thresholds; record them).

## T9: Performance, fewer API calls, and scale

Your first message: **cut API calls as far as possible without changing the design.** The rule for this phase: **measure first, change second, and prove the screens look the same.**

- [ ] **T9.1 (Claude)** **Visual baseline before any refactor.** Playwright screenshots of every screen at phone and desktop size, light and dark, in a fixed seed state. *Pass:* the baseline is committed; after every performance change the diff is zero (or each difference is approved by you). This is how "without changing the design" is proven.
- [ ] **T9.2 (Claude)** **A call counter.** Add a dev-only counter in `apps/mobile/src/lib/gateway.ts` (the single place every `api` call goes through) that logs operation, count, duration and size per screen, off in production. *Pass:* one command prints a table of calls per screen.
- [ ] **T9.3 (Both)** **Baseline numbers.** For each key screen (sign-in, home, browse/search, task detail, post a task, my tasks, chat, wallet, profile, notifications) record: requests on first open, requests in 60 s idle, requests after a pull-to-refresh, payload size, time to first content on 4G and on a throttled "slow 3G". *Pass:* a table in `docs/audit/evidence/`.
- [ ] **T9.4 (Claude)** **Find the waste:** duplicate calls on mount (React strict mode, two components asking for the same data), calls made again on every focus, N+1 patterns (a call per list row), calls for data already in memory, calls with `select('*')` that need three columns, calls made while the app is in the background. *Pass:* each is listed with the file and the fix.
- [ ] **T9.5 (Claude)** **Polling inventory and policy.** Known timers: presence heartbeat every 60 s (`PresenceBeat.tsx`), live workers every 60 s (`LiveWorkers.tsx`), app config every 5 min (`appConfig.ts`), plus realtime for chat and notifications. Decide for each: needed? slower? paused when the app is backgrounded or the screen is not shown? replaced by realtime or by a refresh on focus? *Pass:* a table; idle traffic per user per hour is under the target in T9.9.
- [ ] **T9.6 (Claude)** **Reduce, in this order of safety** (each step re-checked against T9.1 screenshots and the e2e suite): (1) remove duplicates and background calls; (2) batch several reads into one `api` operation; (3) cache reads that change rarely (categories, config, public stats) in memory with a time limit and at the edge; (4) cursor pagination with hard limits; (5) debounce search and filter typing; (6) fetch only the columns shown; (7) optimistic updates instead of re-fetching after a write. *Pass:* calls per screen drop against T9.3, the screens look identical, all tests pass.
- [ ] **T9.7 (Claude)** **Pagination and bounds:** no unbounded read remains (`SCALE_READINESS.md` seam 3: the open-task feed and bids had none). *Pass:* every list call has a limit and a stable order; a user with 5,000 rows still loads in under a second.
- [ ] **T9.8 (Both)** **Database performance:** top 10 queries from `pg_stat_statements` by total time and by mean time, `EXPLAIN (ANALYZE, BUFFERS)` on each, missing indexes added, RLS policies written with `(select auth.uid())` so they are not re-run per row, the cron sweeps (`settle_cleared_earnings` every 5 min, `auto_complete_due`) batched with partial indexes. *Pass:* no query over 100 ms at 100,000 rows of seed data; no sequential scan on a large table in a hot path.
- [ ] **T9.9 (Claude)** **Set the budgets** and fail the build when exceeded. Suggested starting targets (change them, but write them down): home first screen ≤ 4 calls; an idle signed-in user ≤ 2 calls/minute; a normal 10-minute session ≤ 60 calls; `api` read p95 under 500 ms and write p95 under 800 ms (your plan's Part B, section 6); withdrawal response under 1 s. *Pass:* the numbers are in `docs/UPGRADE_PLAN.md` section 6 and measured.
- [ ] **T9.10 (Claude)** **Cost model:** (calls per active user per day) × (users) against your current Supabase, Vercel, ImageKit, SMS and Maps plan limits, at 100, 1,000 and 10,000 users. *Pass:* a table that shows which limit you hit first and what it costs; alerts are set at 70 % of each limit.
- [ ] **T9.11 (Both)** **Load test (test project, your OK first, caps set).** k6 scripts for browse feed, search, post a task, bid, chat, wallet read, withdraw and the admin dashboard at 50 → 500 → 2,000 simulated users, with ramp and soak (30 minutes). Record p50/p95/p99, error rate, database CPU and connections, realtime messages/second. *Pass:* the error rate is under 1 %, p95 stays under target, nothing falls over; a measured-limits table replaces the guesses in `SCALE_READINESS.md`.
- [ ] **T9.12 (Claude)** **Realtime fan-out:** how many concurrent chat subscribers before delays? *Pass:* a number; the trigger to move chat to broadcast channels is written down.
- [ ] **T9.13 (Claude)** **Web speed:** Lighthouse/PageSpeed on `taskdrop.in` at mobile settings: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, JS bundle analysed and split, images lazy-loaded and sized (feed thumbnails under 50 KB). *Pass:* scores saved; regressions fail CI.
- [ ] **T9.14 (Both)** **Android speed:** cold start, list scrolling (no dropped frames on the feed), memory after 30 minutes, battery use from the heartbeat, on the **low-end phone**, on 3G. *Pass:* numbers recorded; crash-free sessions above 99.5 % in Sentry over the closed test.
- [ ] **T9.15 (Claude)** **Offline and flaky network:** airplane mode mid-action, slow network, a request that fails then retries. *Pass:* no duplicate writes, no stuck spinner, a plain message, and retries use idempotency keys (T7.9).

## T10: Functional, usability and compatibility

Use the core-flow table in `docs/UPGRADE_PLAN.md` section 5.2 as the checklist; do not copy it here. This phase adds the parts that checklist misses.

- [ ] **T10.1 (Both)** **Core flows 1 to 12** pass on Web (Chrome and **Safari**), Android and the admin; failures are logged and fixed. *Pass:* a filled-in 5.2 table with dates.
- [ ] **T10.2 (You)** **Exploratory sessions.** Three 45-minute sessions with a goal each ("try to get a task done without paying", "try to confuse the chat", "use the app badly: wrong inputs, back button everywhere, rotate, kill the app"). Write down every oddity. *Pass:* notes in the findings log; each is fixed, scheduled or accepted.
- [ ] **T10.3 (Both)** **Interruptions:** a call or notification during payment, killing the app mid-upload and mid-payment, low battery, no storage, permission denied for camera, location, photos, notifications, and then granted later. *Pass:* the app recovers, money state is correct, and messages are plain.
- [ ] **T10.4 (Both)** **Push notifications:** arrives with the app open, in the background and killed; the right screen opens when tapped; a bad or old token is cleaned up; notifications for every type in the notification table. *Pass:* a table of type × state × result on the real phones.
- [ ] **T10.5 (Both)** **Deep links and sharing:** `taskdrop://` and web links open the right screen when signed in, signed out and on a fresh install. *Pass:* no private screen opens for a signed-out user.
- [ ] **T10.6 (You)** **Accessibility:** TalkBack on the main flows, text size at 200 %, colour contrast 4.5:1 (your design rule), tap targets 48 dp, reduced-motion respected, labels on icon buttons; run `axe` on web. *Pass:* no blocker on the core flows; the rest logged.
- [ ] **T10.7 (You)** **Language and content:** Hindi and Hinglish text, long names, ₹ and number formatting (Indian digit grouping), dates in IST, empty states, error states, loading states on every list. *Pass:* no raw error text, no `undefined`, no layout break.
- [ ] **T10.8 (Both)** **Device and browser matrix:** at least Android 9, 12 and 14 (or whatever your users have), small and large screens, a low-end device; Chrome, Safari (macOS and iPhone browser), Firefox and Edge for the web. *Pass:* a matrix of what was tried.
- [ ] **T10.9 (Claude)** **Time zones and clocks:** a user with the phone clock wrong or in another zone; deadlines and "time ago" use server time. *Pass:* no money or deadline decision depends on the phone's clock.
- [ ] **T10.10 (Both)** **Update paths:** an EAS Update reaches an installed beta app without reinstalling; an older build sees "Update the app" when the minimum version is raised; maintenance mode shows the right screen on Android only when set for Android only. *Pass:* each seen on a phone (these are the open Phase 1 and 3 boxes).
- [ ] **T10.11 (Both)** **Admin app checklist:** sign-in with MFA, every app-control switch per platform, broadcasts, reports queue, dispute, payout, refund, copyright, task and promotion actions, settings, audit log, at desktop and phone width. *Pass:* every page works against the test project; every action is in the audit log.
- [ ] **T10.12 (Both)** **Two-device sync:** a bid placed on the phone appears on the web instantly, and the reverse; chat both ways; a status change on one is seen on the other. *Pass:* matches `docs/audit/SYNC_MATRIX.md`; no stale screen after reconnect.

## T11: Mobile app security (Android APK, OWASP MASVS)

Test the **release** build you would ship, not the debug one.

- [ ] **T11.1 (Both)** **Build the release candidate** (production profile, AAB for the Play closed test, APK for inspection) from a clean checkout. *Pass:* it installs and runs; the version and `versionCode` are what you expect.
- [ ] **T11.2 (Claude)** **Static analysis of the build:** unzip the APK; run MobSF; `apktool d`; `jadx`; inspect `AndroidManifest.xml`. *Pass:* `debuggable=false`, `allowBackup=false` and `usesCleartextTraffic=false` (all set in `app.json` today), no exported component that should be private, permissions limited to what the app uses (camera, microphone, location, photos, notifications; background location blocked), no leftover test code, no source maps, no secrets (T2.4).
- [ ] **T11.3 (Both)** **Local data:** with a rooted emulator or `adb`, read the app's storage after sign-in. *Pass:* the session token is in the secure store (`expo-secure-store`), nothing sensitive is in plain shared preferences, SQLite or cached files; backups are off.
- [ ] **T11.4 (Both)** **Logs and screenshots:** `adb logcat` during all flows; check the recents screen and screenshots on money and ID screens. *Pass:* no token, phone number, UPI or address in logs; decide whether payment and payout screens should block screenshots.
- [ ] **T11.5 (Both)** **Network:** run the app through an intercepting proxy (mitmproxy) to read its traffic. *Pass:* everything is HTTPS; **no** secret appears in a URL; the app **refuses** a proxy certificate that is not trusted by the device (no custom user-CA acceptance); the only API keys on the wire are the public ones. (Certificate pinning is a recorded accepted risk in `THREAT_MODEL.md`: confirm you still accept it.)
- [ ] **T11.6 (Both)** **Deep link and intent abuse:** craft `taskdrop://` links and Android intents with hostile parameters. *Pass:* no screen opens without sign-in, no action runs from a link without the user's confirmation, no data leaks to other apps.
- [ ] **T11.7 (Both)** **Update channel integrity:** only builds from your EAS project can update the app; the `beta` and production channels are separate; the runtime-version policy prevents a JS update landing on an incompatible native build; consider **EAS Update code signing** before launch. *Pass:* a decision is recorded; an update for another runtime version is not applied.
- [ ] **T11.8 (Both)** **Rooted or tampered device:** behaviour on a rooted phone and on a repackaged APK. *Pass:* money actions use Play Integrity as a **risk signal** (your `SECURITY_SYNC_SCALE_PROMPT.md` decision); decide what happens and record it.
- [ ] **T11.9 (You)** **Signing and keystore:** the upload keystore is backed up in two places (your plan says half done), the Play App Signing key is enrolled, and nobody else can publish as you. *Pass:* a restore of the backup is checked.
- [ ] **T11.10 (Both)** **Permissions and privacy:** each permission has a plain reason in the prompt and in the Play Data safety form; the app works (with a clear message) when each is denied. *Pass:* a table of permission → reason → denied behaviour.
- [ ] **T11.11 (Claude)** **Third-party SDKs:** list every native SDK (Sentry, Firebase messaging, maps, Razorpay checkout) with its version, what data it sends and where. *Pass:* matches the privacy policy and the Data safety form.

## T12: Reliability, operations and recovery

- [ ] **T12.1 (You)** **Restore drill.** Take a database backup and a copy of the Storage files, restore them into a **scratch** project, and run the Playwright suite against it. *Pass:* the restore works end to end and takes a known time. Confirm which Supabase plan gives you daily backups and whether you need point-in-time recovery; the Free plan has no automatic backups.
- [ ] **T12.2 (Both)** **Written undo for every migration** (your Phase 10 box): what to do if migration N goes wrong. *Pass:* a rollback note per migration since the last release; one is rehearsed on the scratch project.
- [ ] **T12.3 (You)** **Rollback rehearsal:** Vercel instant rollback of the web, an EAS Update rollback to the previous update, and a Supabase function redeploy of the previous version. *Pass:* each done once, timed, on the beta.
- [ ] **T12.4 (Both)** **Kill switches work:** maintenance mode, per-platform switches, sign-in method switches, posting off. *Pass:* each flips behaviour within the cache time (about 30 s) on a real phone; "switches unreadable" fails open or closed **as designed**.
- [ ] **T12.5 (Both)** **Monitoring reaches a human.** Force an error on web, Android, the admin and a function; force a money "NOT RECORDED" fatal; stop a cron. *Pass:* each produces an alert on your phone or email within five minutes; stack traces are readable (source maps uploaded).
- [ ] **T12.6 (You)** **Uptime monitors** on the `api` health operation, `taskdrop.in` and the admin; an alert path that works at 3 a.m. *Pass:* a deliberate outage is noticed.
- [ ] **T12.7 (Both)** **Background jobs fail safely:** Inngest retries, dead-letter, and idempotent re-runs: kill a function mid-run, send a bad push token, make RazorpayX return an error. *Pass:* it retries, then succeeds or lands in Sentry; nothing runs twice; no old cron job does the same work (Phase 5 box).
- [ ] **T12.8 (Both)** **Failure injection:** Razorpay down, MSG91 down, FCM refusing, Supabase edge cold start, Google Places down, database slow. *Pass:* the app shows a plain message, does not lose money state, and recovers on its own.
- [ ] **T12.9 (You)** **Cost guards:** budgets and alerts for SMS (a global daily ceiling), Maps, Supabase egress and function invocations, ImageKit bandwidth, Vercel bandwidth, Sentry events. *Pass:* each has a cap or an alert you have seen fire in a test.
- [ ] **T12.10 (You)** **Incident drill (a tabletop):** "the service-role key leaked", "a payout was sent twice", "a user reports a stolen account". Walk through `docs/RUNBOOK.md`; time each step. *Pass:* the runbook has the steps, the contacts and who does what; gaps are fixed.
- [ ] **T12.11 (You)** **Edge hardening:** HSTS, TLS grade A (SSL Labs), security headers grade A (securityheaders.com), Vercel firewall/rate limits on, www and apex redirects, DNS records correct, no stray subdomains. *Pass:* screenshots of each report.
- [ ] **T12.12 (Both)** **Environments stay separate:** production secrets exist only in production; a test cannot reach the production database; production deploys need your approval in CI. *Pass:* an attempt to point a test at production is refused.
- [ ] **T12.13 (Both)** **Support readiness:** a report or support ticket reaches the admin queue; you can answer within 24 hours; you can suspend, hide, refund and delete on request. *Pass:* each done once end to end on the test project.

## T13: Privacy, data and compliance checks (the testing side only)

Legal advice is for a lawyer; the checks below prove the app does what the policy says. See `docs/LEGAL_AUDIT.md` and `docs/LAWYER_BRIEF.md`.

- [ ] **T13.1 (Both)** **Data inventory:** every kind of personal data (phone, name, photo, location, address, UPI/bank, PAN if collected, chat, IP, device) → where it is stored → who can read it → how long it is kept → how it is deleted. *Pass:* a table that matches the privacy policy text.
- [ ] **T13.2 (Claude)** **Deletion is complete:** delete an account and search the database, both storage systems, Sentry, Inngest event payloads, push-token tables, logs and exports for the person. *Pass:* nothing personal remains except what the law requires you to keep, and that is listed.
- [ ] **T13.3 (Claude)** **Data minimisation:** the public profile, the feed and search results show only the fields the product rules allow (area name before a worker is chosen; address and contacts only when work starts). *Pass:* T3.11 and T7.5 agree.
- [ ] **T13.4 (You)** **The policy matches reality:** the privacy policy, terms, the in-app text and the Google Play **Data safety** form all describe the same data and SDKs (T11.11). *Pass:* a line-by-line comparison.
- [ ] **T13.5 (You)** **India-specific open items:** DMCA agent, the grievance officer, the lawyer's review of `src/legal/documents.ts`, the answer on the money flow (R3), DPDP obligations. *Pass:* each has a named owner and a date; `EXPO_PUBLIC_LEGAL_REVIEWED=yes` is set only after the lawyer's sign-off.
- [ ] **T13.6 (Both)** **Consent and age:** the age gate and consent are recorded server-side with a time; a withdrawn consent or deleted account stops processing. *Pass:* a record exists for a test user.
- [ ] **T13.7 (Claude)** **Third-party data flows:** nothing personal is sent to analytics or error tools that you did not list (Sentry gets a user id only; `sendDefaultPii` is off). *Pass:* a captured Sentry event is clean.

## T14: Pre-production gate and sign-off

Nothing here is new testing; it is the moment you decide.

- [ ] **T14.1** Phases T0 to T13 have no open box that is neither passed nor deferred with a reason.
- [ ] **T14.2** **Zero open Critical or High findings.** Every open Medium has a written acceptance from you (Part B, section 3).
- [ ] **T14.3** **E2E green for three consecutive scheduled runs**, plus the SQL tests and `npm run check`.
- [ ] **T14.4** **Closed test finished:** at least 12 testers for 14 days on the Play closed test (Google requires it before a production release), with no open serious issue and Sentry crash-free sessions above 99.5 %.
- [ ] **T14.5** **Sentry quiet for 7 days** on the release candidate; monitors green.
- [ ] **T14.6** **Production setup checked** (not the test project): backups on and restored once, MFA everywhere, secrets set and rotated from the test values, live Razorpay/RazorpayX/MSG91 set up, settings from T8.12, lockdown run, CORS locked (T7.4), auth settings from T6.13.
- [ ] **T14.7** **Dress rehearsal on production with small real amounts:** one full flow on web, Android and the admin: sign up, post, bid, pay (a few rupees), complete, withdraw. *Pass:* every balance matches to the paisa; the reconcile run is clean; the alerts you set up fire for a forced error.
- [ ] **T14.8** **Rollback ready and rehearsed** (T12.3); an on-call person (you) and a status message template exist.
- [ ] **T14.9** **Go / no-go** signed by you, with the date and the version (commit and build number).
- [ ] **T14.10** **After launch:** re-run T3 (access grid), T2.3 (bundle scan) and T7.2 (operation grid) after every release for the first month; review Sentry and the money reconcile daily; re-run this plan quarterly and after any big change.

---

# Part B: reference

## 1. Tools (free or free tier), and what each is for

| Need | Tool | Used in |
|---|---|---|
| Secrets in code and git history | `gitleaks`, `trufflehog` | T1.4, T2.6 |
| Static code analysis | Semgrep (OWASP, TypeScript, React, JWT rule packs) | T1.6 |
| Dependency vulnerabilities | `npm audit` (the repo's `audit:gate`), `osv-scanner` | T1.5 |
| Database rules | the repo's SQL tests (`npm run test:db`), `pgTAP` if you want more, Supabase security and performance advisors | T3, T1.7 |
| Web/API probing (your own test project only) | OWASP ZAP baseline scan, Burp Community, `curl`, Postman/Bruno, `sqlmap` | T4, T6, T7 |
| End-to-end browser tests | Playwright (already in the repo) | T1, T9.1, T10 |
| Android UI tests | Maestro (simple YAML flows), the Android emulator | T10 |
| Mobile app inspection | MobSF, `apktool`, `jadx`, `adb`, `frida` only for deliberate tampering tests | T2.4, T11 |
| Traffic inspection | mitmproxy, Chrome DevTools Network + HAR export | T9.3, T11.5 |
| Load | `k6` | T9.11 |
| Web speed | Lighthouse / PageSpeed Insights, WebPageTest | T9.13 |
| Accessibility | `axe`, TalkBack | T10.6 |
| Property-based tests | `fast-check` | T8.1 |
| Edge and TLS checks | SSL Labs, securityheaders.com | T12.11 |
| Monitoring | Sentry (errors), Uptime Robot (uptime), Inngest dashboard (jobs) | T12 |

Commands the agent will use as the first pass (run from the repo root, on a clean checkout, never with a `.env` printed):

```bash
npm run check                      # typecheck, lint, unit tests
npm run test:db                    # SQL tests (needs DATABASE_URL for the test project)
npm run audit:gate                 # dependency advisories
gitleaks detect --redact           # secrets in history (add --log-opts="--all")
semgrep scan --config p/owasp-top-ten --config p/typescript .
osv-scanner --lockfile package-lock.json
npm run web:export && grep -R "service_role\|sk_live\|rzp_live\|AIza\|BEGIN PRIVATE" apps/mobile/dist
npm run test:e2e                   # Playwright against the test project
```

## 2. Test identities and what each must be able to do

| Identity | Purpose | Must be able to | Must not be able to |
|---|---|---|---|
| Anonymous | The public internet | Read public pages and public config | Read any private row, call any money or admin function, list a private bucket |
| A: poster | Owns the task | Post, fund, lock, approve, cancel (with fine), dispute, review | Edit protected columns, see a worker's private contacts before work starts |
| B: worker | Wins the task | Bid, edit own bid, chat, upload proof, withdraw | Read A's other tasks' private data, act on someone else's bid |
| C: attacker | A signed-in stranger | Use the app normally | Read, change or delete anything of A's or B's, by any id or path |
| Suspended | Banned user | Sign-in refused or all actions refused | Withdraw, post, bid |
| Under-18 | Age gate | Be refused at sign-up | Get an account by any route |
| Blocked pair | A blocks C | Block and unblock | C bids on, messages or sees A's open tasks |
| Full admin | Owner | Everything, with the money step-up | Skip the step-up |
| Finance | Money staff | Payouts, refunds, disputes | Change payout method (full admin only) |
| Support | Help staff | Tickets, CRM, moderation | Any money function |
| Sales | Growth staff | Customers, leads, CRM | Any money page, export or live-feed figure |
| Viewer | Read-only | Look | Change anything |

## 3. The findings log

Keep findings in `docs/audit/FINDINGS_TESTING.md` (create it on the first one) in this shape, so every finding is reproducible and has a test:

| Field | Content |
|---|---|
| ID | `TF-001`, increasing |
| Check | The check ID that found it, e.g. `T7.8` |
| Severity | Critical / High / Medium / Low (section above the plan) |
| What and why it matters | One or two plain sentences |
| How to reproduce | Exact steps or the exact request (no secrets) |
| Evidence | A file in `docs/audit/evidence/` or a link |
| Fix | The pull request and migration |
| Regression test | The SQL / `api` / Playwright test that now guards it |
| Status | Open / Fixed and retested / Accepted by owner (date and reason) |

**Acceptance of a Medium or Low finding** is a one-line entry signed by you with the date and the reason. A Critical or High cannot be accepted.

### Leads from reading the code on 2026-10-22 (not confirmed bugs: each is a thing to test)

| Lead | Where | Check |
|---|---|---|
| Search text is placed into a PostgREST `or(...)` filter; the API strips `, ( ) * % \` but not `"`, `.`, `:` | `supabase/functions/api/reads.ts` (`searchTasks`); admin `lib/data/users.ts`, `lib/data/tasks.ts` | T4.2 |
| `Access-Control-Allow-Origin: *` on every function | `supabase/functions/*/index.ts` | T7.4 |
| Several functions run without a JWT (`verify_jwt = false`); each must authenticate another way | `supabase/config.toml` | T7.3 |
| `dev_otp_for_all` exists as a setting and the dev-code path is still in the production function | admin settings; `phone-auth` | T6.5 |
| The app polls (presence every 60 s, live workers every 60 s, config every 5 min) | `PresenceBeat.tsx`, `LiveWorkers.tsx`, `appConfig.ts` | T9.5 |
| Unbounded reads were flagged in the scale review | `SCALE_READINESS.md` seam 3 | T9.7 |
| Promotion tiers are hard-coded in the app but enforced from settings on the server (a settings change would break the buy screen) | `PromoteScreen.tsx`; migration 114 | T8.2 |
| Admin hides commission editing in the UI; make sure the database also refuses a non-full-admin edit | `src/lib/actions.ts`; `settings` trigger | T6.15 |

## 4. Notes from the videos

I could not open Instagram, so these rows are for you. For each link, watch it, write the point in one line, and give it a check ID (or add a new check).

| Date sent | Link | What it says (your note) | Covered by | New check needed? |
|---|---|---|---|---|
| 3 Oct | `instagram.com/reel/Ddt1COOvv1q/` | | | |
| 3 Oct | `instagram.com/reel/DdE2GlYw9lB/` | | | |
| 15 Oct | `instagram.com/reel/DeeR2JyNrx-/` | | | |
| 18 Oct | `instagram.com/p/DehMUh_jdbK/` | | | |
| 21 Oct | `instagram.com/reel/DewSmVZJhZ9/` | | | |
| 21 Oct | `instagram.com/reel/DewM5dMuuK3/` | | | |

If you paste the transcript or the key points of any of them into the chat, they can be turned into checks directly.

## 5. Evidence

- Put evidence in `docs/audit/evidence/<YYYY-MM-DD>-<check id>/`: a test name, an output file, a screenshot. **Redact** tokens, phone numbers, keys and personal data first.
- A box is ticked only with a pointer to its evidence (a file, a test name or a link) in the same line or in the findings log.
- If a check cannot run (no device, no account, no permission), tick `[-]` with the reason, not `[x]`.

## 6. How the phases fit together

```
T0 environment ─▶ T1 CI safety net ─▶ T2 keys ─▶ T3 database/RLS ─▶ T4 injection
                                                        │                │
                                                        ▼                ▼
                         T5 storage ◀──── T6 auth ◀──── T7 API logic ──▶ T8 money
                                                        │
                       T9 speed & calls ─▶ T10 functional ─▶ T11 Android security
                                                        │
                                   T12 operations ─▶ T13 privacy ─▶ T14 gate
```

Run T0 to T2 first. T3 to T8 are the ones where a single bug can cost money or leak data, so they come before polish. Re-run T3, T2.3 and T7.2 after every release.

## 7. Changelog

- **v1.0 (2026-10-22):** First version. Built from your two messages (reduce API calls without changing the design; keys, SQL injection and buckets), public vibe-coding and OWASP checklists, and the repo's own audit. The six Instagram links could not be read (Part B, section 4 is left for you to fill in). Includes eight code-reading leads in Part B, section 3; none has been tested yet.
