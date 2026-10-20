# TaskDrop upgrade plan

Version 4.16, 2026-10-20 (scope note 2026-10-20: iOS deferred). The single source of truth for the upgrade. Part A is the to-do list, phase by phase; Part B is the reference (architecture, decisions, testing, costs, risks).

## How to use this file

- `- [ ]` is open, `- [x]` is done, `- [-]` is **deferred to future scope** (not forgotten, not needed now). Tick items as they're completed, in the same pull request as the work.
- **(You)** marks the items only you can do: accounts, payments, approvals, testing with real people.
- Every phase has to-dos for each part of TaskDrop:

| Part | What it means |
|---|---|
| **Backend** | Supabase: database, SQL, edge functions, Inngest functions |
| **Web** | The user app in a browser (`taskdrop.in`) |
| **Android** | The user app on Android phones |
| **iOS** | The user app on iPhones. **Future scope (deferred 2026-10-20)** |
| **Admin** | The admin web app (`admin.taskdrop.in`) |

  A phase is done when every box, including its **Verify** boxes, is ticked or deferred (`[-]`).
- **Nothing is implemented until you say "start Phase N".**

## Ground rules

1. **Old code is never altered.** The existing branches stay exactly as they are:
   - user repo: `main` (renamed from `feature/first-push` on 2026-10-11). `master` and `claude/modest-albattani-3odt95` were deleted on 2026-10-11; all their commits are in `main`.
   - admin repo: `main`
2. **All upgrade work happens on `redesigned-2.0`**, in both repos (it replaced `upgraded-plan-changes` on 2026-10-12; read that name as `redesigned-2.0` throughout this plan). `main` is promoted from it by hand, by you, once it's tested.
   - Each phase gets a short branch, such as `upgrade/phase-1-sentry`, cut from `redesigned-2.0` and deleted after it merges.
   - It merges back through a pull request, after CI and a **CodeRabbit** review.
   - Only `main` and `redesigned-2.0` stay on GitHub and on your PC (decided 2026-10-20). A phase branch lives only until its pull request merges. Your PC has two folders, `Taskdrop user` and `Taskdrop administrator`, and no extra clones or worktrees.
3. **The old app keeps running for your testers**, on its current URLs, until the switch-over (Phase 9).
4. **One shared database until the switch-over.** The old app, the old admin and the upgrade all use the Supabase project `wjxvingpfbfvkfqhrguj`, and its server functions are shared too. Until Phase 9, every backend change must keep the old app and the old admin working:
   - migrations only **add** (new tables, columns, functions); nothing old is dropped or renamed
   - existing `api` operations keep the same inputs and responses; new behaviour goes in new operations or optional fields
   - old functions the old app calls (`phone-auth`, `password-auth`, `razorpay`, …) keep working
   - anything that can't be made compatible waits for Phase 9: the lockdown, retiring the old phone login, and dropping old code
5. **The app asks, the server decides.** Money, permissions, limits, prices and switches are always checked on the server.
6. **Current focus: web, Android and the admin app. iOS is future scope (decided 2026-10-20).** Nothing iOS gets built, enrolled for or tested until you say "start iOS".
   - Every iOS section below is marked `[-]` (deferred). The work stays in this plan so nothing is lost.
   - In any other box that mentions iOS, iPhone, TestFlight or the App Store, read that part as skipped; it doesn't block the phase. The same goes for **Sign in with Apple** and the Apple Developer account ($99/year), which only the iOS work needs; web and Android sign in with Google, phone and username + password for now.
   - Nothing in the code is removed: the app still builds for iOS, and the iOS-only code paths stay.
   - Full list of what waits: Part B, section 12 "Future scope: iOS".
7. **Stage: testing only.** Fake data, you and about 10 testers, no customers. Customer launch (Phase 10) happens only when you decide.
8. **Supabase: the cloud project is the test environment (decided 2026-10-20).** We test directly on the hosted project `wjxvingpfbfvkfqhrguj`; whatever is in the cloud now is treated as testing. No local Supabase and no Docker on your PC.
   - Fake data only. A destructive step (wipe, reseed, reset) still runs only with your OK, and never on production.
   - The one throwaway database is in CI: GitHub Actions starts a temporary one inside each run to execute the SQL tests. It never touches the cloud project.
9. **Order of work: phase by phase (decided 2026-10-20).** We go 0 → 10 in order. A phase is closed when every box is ticked or deferred (`[-]`). If a box waits on something only you can do, work continues on that phase's other boxes, and the blocker is listed on the Progress board.

---

# Part A: To-do list

## Progress board

> iOS items in every phase are deferred (`[-]`). A phase is complete when all its backend, web, Android, admin, You and Verify boxes are ticked.

| Phase | Name | Status |
|---|---|---|
| 0 | Foundations | In progress, 29 of 40 boxes ticked (4 deferred). Built: CI and the old-app compatibility checks, auto-deploy, forward-only migrations, seed and reset, config and env files. Done in the browser 2026-10-20: `taskdrop.in` and `www` connected (Vercel and Spaceship DNS), redirect URLs added, `EXPO_PUBLIC_APP_URL` set. **Blocked on you:** `support@` forwarding, Maps key restriction, EAS keystore backup, install CodeRabbit on the admin repo, lawyer question, 12 testers, OK for the first seed reset. The Verify boxes that need a pushed pull request wait for it |
| 1 | See problems, ship fast | In progress, 1 of 22 boxes ticked |
| 2 | Make it work (stabilize) | Not started, 0 of 18 boxes ticked |
| 3 | Server decides everything | In progress, 10 of 36 boxes ticked |
| 4 | Accounts and sign-in | Not started, 0 of 21 boxes ticked |
| 5 | Background jobs (Inngest) | In progress, 11 of 42 boxes ticked (outbox, alerts, push, prunes built; Inngest Cloud keys are yours to set) |
| 6 | Speed and media (ImageKit) | In progress, 13 of 24 boxes ticked (merged; migration 109 applied 2026-10-19; off until your ImageKit keys are set; device tests open) |
| 7 | Moderation and admin tools | Not started, 0 of 23 boxes ticked |
| 8 | Store readiness | Not started, 0 of 9 boxes ticked |
| 9 | Switch-over to the upgraded app | Not started, 0 of 26 boxes ticked |
| 10 | Customer launch (later, when you decide) | Not started, 0 of 27 boxes ticked |

## Coverage: what each phase changes

| Phase | Backend | Web | Android | iOS (future scope) | Admin |
|---|---|---|---|---|---|
| 0 | Compatibility rules, CI, auto-deploy, seed | `taskdrop.in` on the upgrade | Beta build profile | Apple Developer enrollment | `admin.taskdrop.in`, CI |
| 1 | Sentry in functions, health check | Sentry | Sentry, OTA updates, push fix | First TestFlight build, push | Sentry |
| 2 | Bug fixes, slow queries | E2E tests, fixes | Fixes | iOS fixes | Every page checked |
| 3 | Server rules, app controls | No key in bundle, security headers | Control screens | Control screens | App controls page, gateway header |
| 4 | Phone auth, Apple, linking | Google/Apple browser sign-in | Google/Apple/phone | Native Apple sign-in | Sign-in methods, devices |
| 5 | Inngest, outbox, webhooks | In-app notifications | Push via Inngest | Push via Inngest | Queued payouts, alerts |
| 6 | `media` table, ImageKit signing | Uploads, images, CSP | Camera uploads, images | Camera/HEIC uploads, images | Images via signing |
| 7 | Reports, blocks, admin actions | Report/block | Report/block | Report/block | Reports queue, actions, runbook |
| 8 | — | Privacy and support pages | Play closed test | App Store review prep | Ready for reviewers |
| 9 | Lockdown, retire old code paths | Domains confirmed | Testers move | Testers move | Admin moves |
| 10 | Production project | Production | Play release | App Store release | Production |

---

## Phase 0: Foundations

**Repos and branches**
- [x] This plan written as one file with to-dos for every phase
- [x] Branch `upgraded-plan-changes` created in the user repo from the newest work (commit 3d4bd72)
- [x] Branch `upgraded-plan-changes` created in the admin repo from `main`
- [x] Push the upgrade branch to GitHub in both repos. Done; the branch is now `redesigned-2.0` in both repos (2026-10-20)
- [x] Protect the branches on GitHub (both repos, 2026-10-20): `main` needs a pull request and can't be force-pushed or deleted; `redesigned-2.0` can't be force-pushed or deleted. You, as owner, can still override
- [x] Rule written into the README of both repos: phase branches `upgrade/phase-N-<name>` → pull request into `redesigned-2.0` (admin repo: PR 18)

**AI code review (CodeRabbit)**
- [ ] **(You)** Sign up at coderabbit.ai with GitHub and install the CodeRabbit app on both repos. If they're private: a 14-day trial, then $24/developer/month billed annually; public repos are free.
- [x] Turn on auto-review for pull requests into `redesigned-2.0`. Done in the app repo: `.coderabbit.yaml` lists `^redesigned-2\.0$` and CodeRabbit reviewed PRs 38 and 39 (2026-10-20)
  - It isn't the default branch, so it must be listed under `reviews.auto_review.base_branches` (`^upgraded-plan-changes$`), and check at setup that the setting takes effect.
- [x] Add `.coderabbit.yaml` on `redesigned-2.0` in both repos, with path instructions. Done: the app repo's, and the admin repo's (admin PR 18, merged):
  - `supabase/migrations/**`: RLS on every table, `security definer` functions set `search_path`, money changes are atomic, no grants to `anon`
  - `supabase/functions/**`: caller identity checked, no secrets logged, webhooks verified and idempotent, errors reported to Sentry
  - `apps/mobile/**`: no secrets, no business decisions in the app, platform differences handled for web/Android/iOS
  - `taskdrop-admin` `src/**`: `requireAdmin` on every action, MFA gate on money actions, audit-log writes
  - every repo, until Phase 9: flag anything that would break the old app or the old admin on the shared database (dropped or renamed tables, columns or functions, changed `api` inputs or responses)
- [x] Rule: every CodeRabbit comment is fixed or answered before merging. Written in both READMEs and as a checkbox in the app repo's pull request template (`.github/pull_request_template.md`)

**Checks on every pull request into `redesigned-2.0` (run by GitHub Actions; checks only, nothing is deployed and no secret is stored in GitHub)**
- [x] User repo: typecheck, lint, `npm test` (includes the `api` function tests), a Deno type-check of the Inngest function, and the SQL tests against a throwaway database that GitHub Actions starts for the run (not your cloud project). Running on every pull request (seen on PR 38, 2026-10-20)
- [x] Admin repo: typecheck, lint, tests, audit and build run on every pull request, and a new job regenerates the database types from the live schema and fails if the committed file differs. GitHub holds no secrets (owner decision 2026-10-20), so this job is skipped. Run `npm run db:types` in the admin repo before a pull request that touches the database, and commit the result

**Shared test project (`wjxvingpfbfvkfqhrguj`)**
- [x] Auto-deploy on every push to `redesigned-2.0` (R2), **run by Vercel, not GitHub** (owner decision 2026-10-20: GitHub only stores the code). The `taskdrop` project's build command is `node scripts/vercel-build.mjs` (set in `vercel.json`, which exists only on `redesigned-2.0`, so `main`'s builds are unchanged). On `redesigned-2.0` it applies new migrations, deploys the Edge Functions, runs the Inngest sync, then builds the web app; on every other branch it only builds the web app. A failed backend step fails the build, so the web app is not published against a half-updated backend. Migrations go through `scripts/deploy-migrations.mjs`, not `supabase db push` (see the history box below). Without the two variables it prints a warning and builds the web app only. How it works: `docs/DEPLOY.md`. Dry-run of all four cases tested locally; not yet run on Vercel itself (needs a push)
- [x] **(You)** In Vercel, project `taskdrop`, Environment Variables: `SUPABASE_ACCESS_TOKEN` and `DATABASE_URL`. **Done 2026-10-20** (you pasted the values; I checked the names and scope: type Secret, environment Preview, branch `redesigned-2.0` only, nothing on Production). **Scope later changed at your request to All Environments** (Production, Preview on any branch, Development), so every build can read them; `scripts/vercel-build.mjs` still deploys the backend only for Preview builds of `redesigned-2.0`. Cost of the wider scope: `main`'s builds (the old app) and every other branch's builds now have the database password and Supabase token in their build environment. Before saving, both values were tested from your PC: the token reaches the `taskdrop` project and the database URL connects (a dry run found every migration already applied). Whether Vercel stored them correctly shows on the first build. Nothing goes into GitHub
- [x] Compatibility check in CI, run before every deploy: the old app's `api` operations still accept the same inputs and return the same fields. `npm run test:contract` runs the 100 operations the old app calls (read from `main`'s source) through `main`'s `api` and this branch's, on the same fake database; 74 reach an answer with sample arguments. It fails on a missing operation, refused arguments or lost fields (tried by removing an operation and by adding a required argument). A second check, `scripts/check-old-app-db.mjs`, confirms the tables, functions and function arguments the old app's server code uses still exist (24 tables, 28 functions; passes on the cloud project today). Both run in CI (jobs `compatibility` and `database`) and again inside the deploy workflow
- [x] Before each deploy that changes the backend, a quick check on the old app: sign in, browse, post, chat. Ten-minute checklist in `docs/DEPLOY.md`, and a checkbox in the pull request template for any change under `supabase/**`
- [x] **Migration history: decided not to repair it; deploy forward-only instead (2026-10-20).** The mismatch is far bigger than 101 to 108: 95 migrations carry other version numbers, 11 history rows have no repo file, and 6 repo files (018, 044, 060, 061, 062, 066_razorpayx_hardening) have no row. Those six are in the database under other names (their functions exist), which the admin README had wrongly called "not applied". Repairing would rewrite about 100 rows, and renaming the repo files could break a fresh database. Instead `scripts/deploy-migrations.mjs` treats everything up to the newest recorded version as applied and applies only newer files, each in one transaction, recording its own version. `supabase db push` is not used. Nothing in the cloud history was changed, so this needed no OK from you

**Development on your PC (against the cloud test project, ground rule 8)**
- [-] **(You)** Install Docker Desktop (with WSL 2). Not needed: we test on the cloud Supabase project.
- [-] `supabase start` and `supabase functions serve` on your PC. Replaced by: the app and admin read the cloud project's URL and keys from git-ignored env files, and functions are deployed to the cloud project.
- [x] One command resets the **cloud test project** to the fake-data seed (only with your OK, ground rule 8). Built: `npm run seed:reset` (`scripts/reset-test-data.mjs` and `supabase/seed/test_data.sql`; details in `docs/DEPLOY.md`). It accepts only the test project or localhost, makes you type "reset", and touches only its four seed accounts. Tested by loading the seed in a transaction on the cloud project and rolling it back (12 tasks in 10 statuses, 4 profiles, 4 wallets, nothing left behind), and CI loads it twice on the throwaway database (`npm run test:seed`). It has not been run for real yet. It holds:
  - poster, worker and admin accounts
  - test phones with fixed codes
  - tasks in every status
  - wallets with fake credits

  On the shared test project, a reset also changes what old-app testers see, so it only runs with your OK. It never runs on production.
- [ ] **(You)** Say "run the seed" (or run `npm run seed:reset` with `DATABASE_URL` set) when you want the first real reset
- [x] README section: "Run TaskDrop against the cloud test project" (web, Android over USB, admin on port 3001)

**Config in code**
- [x] Supabase auth settings in `supabase/config.toml`: the `[auth]` redirect-address list (taskdrop.in, www, the admin's Vercel callbacks, localhost). The cloud project's other auth settings were set by hand and were not captured, so `supabase config push` must not be run; `scripts/add-redirect-urls.mjs` only ever adds addresses to the cloud's allow-list
- [x] Project ids and keys as env vars; `.env.example` files updated in both repos (`SUPABASE_PROJECT_ID`, `DATABASE_URL`, `SUPABASE_ACCESS_TOKEN`, `EXPO_PUBLIC_APP_URL`, the Edge Function secret names). `db:types` reads the project id from the environment
- [x] Secrets inventory (Part B, section 7) checked against the code and the `.env.example` files, and corrected (2026-10-20). Which secrets are actually *set* in Supabase and Vercel could not be read from here (the Vercel connector is refused on the team scope; `supabase secrets list` needs your login), so compare once with `supabase secrets list --project-ref wjxvingpfbfvkfqhrguj`

**Web**
- [x] **(You)** Buy `taskdrop.in`. **Bought on Spaceship.com** (you confirmed 2026-10-20; Part B, section 8)
- [x] **(You)** Connect `taskdrop.in` to Vercel. **Done 2026-10-20** (done through Chrome with your OK and your Spaceship sign-in). In Vercel, project `taskdrop`: `taskdrop.in` and `www.taskdrop.in` added with "Redirect apex to www" off. In Spaceship Advanced DNS (it had no records): `A @ 216.198.79.1` and `CNAME www 10023d03410c0f46.vercel-dns-017.com`. Vercel shows both as Valid Configuration and `taskdrop.in` loads the redesigned app
  - In Vercel, open the `taskdrop` project → Settings → Domains → add `taskdrop.in` and `www.taskdrop.in`. Vercel then shows the exact DNS records it wants.
  - In Spaceship, open `taskdrop.in` → DNS: remove the default parking records for `@` and `www`, then add what Vercel shows (normally an `A` record for `@` and a `CNAME` for `www` pointing to `cname.vercel-dns.com`).
  - Wait until Vercel shows a valid configuration and the HTTPS certificate. DNS can take from minutes to a few hours.
- [x] Vercel project `taskdrop`: `taskdrop.in` + `www` assigned to the `redesigned-2.0` branch (environment Preview, branch `redesigned-2.0`). The old production domain `taskdrop-five.vercel.app` keeps its Production setting
- [x] Add `taskdrop.in` to the project's redirect URLs (done 2026-10-20 in Supabase, Authentication, URL Configuration: `https://taskdrop.in/**` and `https://www.taskdrop.in/**` added, the 8 old entries untouched, 10 in total). `EXPO_PUBLIC_APP_URL=https://taskdrop.in` set in Vercel for Preview on `redesigned-2.0` only (not Production); it takes effect on the next deployment of that branch
- [ ] **(You)** `support@taskdrop.in` via free email forwarding

**Android**
- [x] EAS build profile `beta` (Android APK) with EAS Update channel `beta` (R1, confirmed), in `apps/mobile/eas.json`. Adding `expo-updates` and the first build happen in Phase 1.
- [ ] **(You)** Restrict the Google Maps key: limit it to the Maps and Places APIs and set a daily quota. Use a separate Android key restricted to package `com.taskdrop.app` + signing SHA-1. The old web bundle keeps exposing the current key until Phase 9, so the restriction matters now.
- [ ] **(You)** Back up the EAS keystore (`eas credentials`)

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] **(You)** Enroll in the Apple Developer Program, $99/year. Approval can take days, and the first TestFlight build in Phase 1 needs it.

**Admin**
- [-] Vercel admin project: assign `admin.taskdrop.in` to the `redesigned-2.0` branch. **Dropped (owner decision 2026-10-20):** there is no admin subdomain; the admin stays on its Vercel addresses (`taskdrop-admin.vercel.app` and the preview address). Revisit when you want one. Read `admin.taskdrop.in` elsewhere in this plan as "the admin's Vercel address" until then
  - **(You)** In Spaceship DNS, add a `CNAME` for `admin` pointing to the value Vercel shows for the admin project (normally `cname.vercel-dns.com`).
- [x] Admin redirect URLs: the admin's Vercel callbacks (`taskdrop-admin.vercel.app`, `taskdrop-admin-hitenduteam.vercel.app`, `localhost:3001`) were already on the Supabase list (checked 2026-10-20), so nothing was needed for the admin. `supabase/config.toml` and `scripts/add-redirect-urls.mjs` still exist for later additions, and no token is needed now
- [x] Admin `.env.example` and README updated for local and beta (README in admin PR 18, plus the types and migration notes; `.env.example` has the project id and Sentry environment)

**You (other)**
- [ ] Ask a lawyer about the money flow (R3; questions in Part B, section 10). The answer is needed before Phase 5.
- [ ] Recruit at least 12 testers. Google Play requires a closed test with at least 12 testers before a production release.

**Verify**
- [ ] A test pull request into `redesigned-2.0` runs the checks (including the compatibility check) and gets a CodeRabbit review
- [ ] A push to `redesigned-2.0` makes the Vercel build deploy to the shared test project (the build log shows migrations, functions, Inngest sync, then the web export). Also check the Vercel build can fetch `main`; if it cannot, the build warns and the two old-app checks must be run by hand
- [x] `taskdrop.in` loads the upgrade branch (checked 2026-10-20: serves the redesigned app, certificate issued). The admin has no domain of its own (see above)
- [x] The whole app (web in a browser, Android over USB or Wi-Fi, admin) runs on your PC against the cloud test project. Web and Android over USB checked 2026-10-20; the admin dev server on port 3001 checked the same day (login page 200, `/` redirects to `/login`)
- [ ] **The old app and old admin still work unchanged** at their current URLs

---

## Phase 1: See problems, ship fast

**Backend**
- [ ] `_shared/monitoring.ts` used in every function: `razorpay`, both webhooks, `razorpayx-payouts`, `phone-auth`, `password-auth`, `places-search`
- [ ] Parsed stack frames
- [ ] Unexpected database errors reported
- [ ] "PAYOUT MADE BUT NOT RECORDED" and "REFUND SENT BUT NOT RECORDED" sent as fatal
- [ ] A `health` op on `api` for uptime checks

**User app (all platforms)**
- [x] `@sentry/react-native` replaces `apps/mobile/src/lib/monitoring.ts`; pick the version that matches Expo SDK 57 (`~7.11.0`; DSN in `EXPO_PUBLIC_SENTRY_DSN`, auth token in `SENTRY_AUTH_TOKEN`; Sentry org `hitendu`, project `taskdrop`)
- [ ] `reportError` (`lib/errors.ts`) stays the single entry point
- [ ] API and network failures reported (they're ignored today)
- [ ] User id only, no phone or email; about 10% performance traces; `environment` and `release` tags
- [ ] `expo-updates` with a runtime-version policy (R1: EAS Update, not EAS Hosting)

**Web**
- [ ] Sentry captures web errors, with readable stacks (source maps uploaded on deploy)

**Android**
- [ ] FCM V1 credentials + `google-services.json` through EAS, which fixes push in builds
- [ ] One new `beta` APK with all the native changes (Sentry native, `expo-updates`, FCM), installed by testers
- [ ] Source maps uploaded from EAS

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] `app.json` → `ios`:
  - `bundleIdentifier: com.taskdrop.app`, `buildNumber`, `supportsTablet: false`
  - permission texts for location (when in use), camera, photos and microphone
  - `ITSAppUsesNonExemptEncryption: false`
  - `LSApplicationQueriesSchemes` for the UPI apps
  - drop the "Always" location permission
- [-] `eas.json`: iOS `beta` profile; `build:ios` script
- [-] **(You)** App Store Connect app record. APNs key added through EAS.
- [-] First TestFlight internal build (Sentry, `expo-updates`, push)
- [-] **(You)** Add iPhone testers to TestFlight internal testing

**Admin**
- [ ] `@sentry/nextjs` (server actions, route handlers, browser), as its own Sentry project

**Alerts**
- [ ] **(You)** Create Sentry and Uptime Robot accounts
- [ ] Sentry alerts: new issues, money fatals, error spikes
- [ ] Uptime Robot: `api` health, `taskdrop.in`, `admin.taskdrop.in`

**Verify**
- [ ] A test error from web, Android, iOS, admin and each function appears in Sentry with a readable stack
- [ ] An update published to channel `beta` appears on an Android phone and an iPhone without reinstalling
- [ ] A push notification arrives on Android and on iPhone
- [ ] The uptime monitors are green

---

## Phase 2: Make it work (stabilize)

**Your list**
- [ ] **(You)** Write down everything you've seen not working or slow
- [ ] Each item becomes a GitHub issue, then is reproduced and fixed, or scheduled into a later phase

**Backend: known bugs**
- [ ] Chat photos can be opened by the recipient (storage policy 075)
- [ ] The `payout_upi` write in `updateProfile` matches migration 073
- [ ] Drop the duplicate 5-minute earnings sweep
- [ ] Promotion checkout (`PromoteScreen.tsx:166` sends `purpose: 'escrow'`)

**Backend: speed**
- [ ] Find the 10 slowest `api` operations and queries, using Sentry traces and `pg_stat_statements`
- [ ] Fix them with indexes, fewer round trips and pagination; measure against Part B, section 5

**User app (all platforms)**
- [ ] Swallowed errors (`.catch(() => {})`) on money screens now show a message and report to Sentry

**Web**
- [ ] Playwright end-to-end tests on the web build against the cloud test project (test accounts only), run in CI:
  - sign-in with a test phone
  - the wallet-funded money path: post → bid → lock → fund → start → proof → done → confirm → review → withdraw request
  - cancel with a fine
  - dispute
- [ ] The core-flow checklist (Part B, 5.2) passes in Chrome and Safari, on desktop and phone sizes

**Android**
- [ ] The core-flow checklist passes on the `beta` APK; failures are fixed

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Swipe-back navigation (`NavProvider.tsx`)
- [-] UPI payment links (`PaymentSheet.tsx`)
- [-] Clear the stored session on first launch after a reinstall (the Keychain keeps it)
- [-] The core-flow checklist passes on TestFlight; failures are fixed

**Admin**
- [ ] Every admin page works against the shared test project: users, tasks, payouts, refunds, disputes, support, CRM, copyright, money, reports, settings, security
- [ ] Failures are fixed

**Verify**
- [ ] The checklist passes on web, Android, iOS and admin
- [ ] Your list is fixed or scheduled
- [ ] Playwright is green in CI
- [ ] The top slow queries are fixed

---

## Phase 3: Server decides everything

**Backend**
- [ ] Contact-detail rule:
  - [ ] `lib/mask.ts` rules move to `supabase/functions/_shared/`, with a sync test
  - [ ] Enforced in `api/writes.ts`: `placeBid`, `updateBid`, `sendMessage`, `submitProof`, `createTask`, `updateListing`, `updateProfile`, `updateProfileExtras`
- [ ] Promotion:
  - [ ] Price tiers in `settings`, checked by `start_promotion`
  - [ ] A `promotion` purpose in `razorpay` that computes the amount on the server
- [ ] Fees: `feesSince` and `workerShareOfEscrow` (`api/reads.ts`) read live `settings`
- [ ] `places-search` gains reverse lookup and the OpenStreetMap fallback
- [ ] App controls:
  - [x] `app_controls` table and a public `app-config` function, cached about 60 s (migration 092, `functions/app-config`; built, not yet applied or deployed)
  - [x] Switches, each per platform (web / Android / iOS):
    - maintenance mode with a message
    - minimum app version
    - new sign-ups
    - each sign-in method
    - posting
    - bidding
    - top-ups
    - withdrawals
    - promotions
    - chat photos
    - [x] "require verified phone" (off by default; migration 097, enforced by `api` for posting, offers and withdrawals). Before switching it on: phone sign-in must set `phone_confirmed_at` on the auth user (it only stores the number in user metadata today), or everyone counts as unverified
  - [x] An announcement banner (text, link, platforms, end date)
  - [x] `api` enforces every switch, using the `x-taskdrop-platform` and `x-taskdrop-app-version` headers
  - [x] Every change is written to `admin_audit_log`
  - [x] Requests without the platform header (the old app) are treated as "old app": they still work, and the switches and minimum version can target them in Phase 9
- [ ] The lockdown itself waits for Phase 9: on the shared database it would break the old admin, which calls the database directly

**User app (all platforms)**
- [x] Platform and app-version headers sent on every `api` call
- [x] The app reads `app-config` at start-up, on return to the foreground, every 5 minutes and right after a server refusal (no realtime ping: the user channel only exists once signed in)
- [x] Maintenance screen, "Update the app" screen, announcement banner, and a message when a switch is off
- [ ] Fee previews come from the `platformFees` op
- [ ] Address search goes through `places-search`

**Web**
- [ ] `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` removed from the web build
- [ ] `vercel.json`: SPA rewrites and security headers (CSP, HSTS, frame-ancestors, referrer policy)

**Android**
- [ ] The native map keeps only the restricted Android key
- [ ] Control screens checked on the APK

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Control screens checked on TestFlight. The iOS map is Apple Maps, so no key is needed.

**Admin**
- [ ] New **App controls** page: every switch per platform, minimum versions, maintenance, banner
- [ ] Prepare for the lockdown (harmless before it runs):
  - [ ] Set `API_GATEWAY_SECRET` in the upgraded admin's env
  - [ ] Send the `x-taskdrop-gateway` header from the admin's Supabase server client
  - [ ] Redeploy the upgraded admin

**Verify**
- [ ] The new web bundle contains no Google key
- [ ] A bid containing a phone number sent straight to the API is rejected, on the old app too
- [-] Posting switched off for iOS only: refused on iPhone, even by direct API call; still works on web and Android
- [ ] Maintenance mode for Android only shows the screen on Android only
- [ ] An older upgraded build sees "Update the app" on Android and iOS
- [ ] The old app and old admin still work

---

## Phase 4: Accounts and sign-in

**Backend**
- [-] **(You)** In Apple Developer: App ID with Sign in with Apple, a Services ID and a Sign in with Apple key
- [-] Enable Apple in Supabase Auth, with redirect URLs (`taskdrop://auth-callback`, `https://taskdrop.in`, localhost) added to the existing list
- [ ] The upgraded app's phone login uses Supabase's built-in phone auth, with a Send-SMS hook calling MSG91
- [ ] Every existing protection kept:
  - throttles
  - birth date before the first code
  - admin numbers refused
  - test numbers with fixed codes
- [ ] Test users migrated: the phone copied from each synthetic email into `auth.users.phone`. The synthetic email stays, so both the old and the new phone login find the same account.
- [ ] `task_contact_phone`, `verificationState` and the admin SMS block read `auth.users.phone` first, then fall back to the synthetic email
- [ ] The old `phone-auth` function stays deployed and working for the old app; it's retired in Phase 9
- [ ] `password-auth` keeps username + password working, looking up the username and signing in with the account's phone or email
- [ ] `handle_new_user` takes names from Google/Apple
- [ ] Manual identity linking enabled
- [-] Account deletion revokes the Apple token for Apple users (App Store rule; check Apple's current rules when building)

**User app (all platforms)**
- [ ] `expo-crypto` added; PKCE uses S256 (`lib/supabase.ts`)
- [ ] Onboarding doesn't prefill Apple relay emails as names (`OnboardingScreen.tsx:55`)
- [ ] Account screen: shows linked methods; link Google/Apple (`linkIdentity`); add or verify a phone

**Web**
- [ ] Google and Apple sign-in through the browser flow (`providers/AuthProvider.tsx`)
- [ ] Phone and username + password work

**Android**
- [ ] Google and Apple sign-in through the browser flow; phone; username + password

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Apple sign-in native: `expo-apple-authentication` → `signInWithIdToken` with an `expo-crypto` nonce; `usesAppleSignIn: true`
- [-] Google sign-in through the browser flow; phone; username + password

**Admin**
- [ ] User page: sign-in methods (phone / Google / Apple), devices with platform and app version, last seen
- [ ] "Sign out everywhere"
- [ ] The sign-in-method switches from Phase 3 are tested
- [ ] Admin's own login stays Google + `admin` role + MFA

**Verify**
- [ ] New sign-up works with each method on each platform, and each passes the age gate:

  | | Google | Apple | Phone | Username + password |
  |---|---|---|---|---|
  | Web | [ ] | [ ] | [ ] | [ ] |
  | Android | [ ] | [ ] | [ ] | [ ] |
  | iOS (later) | [-] | [-] | [-] | [-] |
- [ ] Existing test users still sign in with their phone
- [ ] Linking a second method works; no duplicate accounts
- [-] Deleting an Apple account revokes its token

---

## Phase 5: Background jobs (Inngest)

Before starting: the lawyer's answer on the money flow (R3). If Razorpay Route is advised, the payout items are built for Route.

**Backend: setup**
- [x] Edge function `supabase/functions/inngest/` using `serve` from `inngest/edge`, `servePath: "/functions/v1/inngest"`, `verify_jwt = false`
- [-] Your PC: an Inngest dev server against a local Supabase. Not needed now; we use Inngest Cloud with the cloud test project (ground rule 8). The lines below apply only if a local stack is ever added.
  - run `npx inngest-cli@latest dev -u http://127.0.0.1:54321/functions/v1/inngest` (UI at `localhost:8288`)
  - functions run with `INNGEST_DEV=1`
  - the local database sends events to `host.docker.internal:8288`
- [ ] **(You)** Create an Inngest Cloud free account
  - [ ] Set `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` on the shared test project
  - [ ] CI syncs the app URL `https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/inngest` on deploy
- [x] The Inngest event address and key live in Vault, so one migration works locally and hosted
- [ ] The jobs serve both apps, since they share the database. The old app sees the same results, just more reliably.

**Backend: events out of the database**
- [x] `private.emit_event` writes to a new `private.outbox` in the same transaction
- [x] Fast path: pg_net posts each outbox event to Inngest immediately
- [x] Safety net: a one-minute sweeper (an Inngest cron, so no new pg_cron job) re-sends anything unconfirmed. The outbox id is the event id, so duplicates are dropped.

**Backend: move the work** (the old job is removed in the same deploy as its replacement)
- [ ] `auto-complete-due` → Inngest cron (built, off until `INNGEST_MONEY_JOBS=on`; cutover SQL in `supabase/cutover/`)
- [ ] `settle-cleared-earnings` → Inngest cron (built every 5 min, off until cutover)
- [ ] `settle-finished-campaigns` → Inngest cron (built, off until cutover)
- [x] Daily digest → Inngest cron (`daily-digest`, writes to `admin_alerts`)
- [ ] Push (pg_net trigger) → `notification.created`: send the Expo push, read receipts, remove dead tokens (built; the trigger keeps the direct send until the `push_via_inngest` switch, `supabase/cutover/inngest_background_jobs.sql`)
- [ ] Withdrawal → `withdrawal.requested`: payout with retries and an idempotency key, one at a time per user. `requestWithdrawal` returns immediately.
- [ ] Stuck payouts → reconciliation every 15 minutes
- [ ] Refund "sent but not recorded" → retrying function + Sentry fatal
- [ ] Account deletion → `user.deleted`: delete storage files with retries (ImageKit added in Phase 6). Built, not yet applied. The api function still removes them at once; `account-files` finishes whatever it missed.
- [ ] New: an overdue-tasks cron (`OVERDUE` from `due_at`), built, not yet applied
- [x] Team alerts (support, withdrawal, dispute, payout failed) → `admin_alerts` rows (Sentry on final failure)

**Backend: webhooks**
- [ ] `razorpay-webhook` and `razorpayx-webhook`:
  - [ ] verify the signature
  - [ ] record the event id in `webhook_events`
  - [ ] send an Inngest event
  - [ ] return 200 immediately
- [ ] Tested locally with sample signed payloads, and on the test project with Razorpay test mode
- [ ] `requestWithdrawal` keeps the same response shape, so the old app still shows the withdrawal correctly

**Backend: housekeeping**
- [ ] Missing prunes added (in Inngest `housekeeping`, not pg_cron; built, not yet applied): `auth_codes`, `auth_send_log`, `places_quota`, notifications older than 90 days; sent outbox rows were already pruned by `outbox-prune`
- [x] Every Inngest function reports its final failure to Sentry
- [x] The old automation tool is gone: its triggers, cron jobs, tables and function (migrations 090 and 102), its doc and the privacy-policy line
- [x] Leftovers dropped (`private.automation_*`, `private.send_daily_digest()`, the log-prune job): migration 102, applied on the hosted test project 2026-10-18
- [x] Events and alerts carry no free text (help-request subject, job title, payout failure note); team alerts are pruned after 30 days

**Web**
- [ ] In-app notifications and the realtime pings still arrive (the web has no push)

**Android**
- [ ] Push for every notification type arrives through Inngest
- [ ] Tapping a push opens the right screen

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Push for every notification type arrives through Inngest
- [-] Tapping a push opens the right screen

**Admin**
- [ ] Payout queue shows the "queued" state
- [ ] New admin alerts view
- [ ] `check-all`, `give-back` and `balance` still work

**Verify**
- [ ] Every function runs in the dev server, then in Inngest Cloud for the test project
- [ ] A forced failure (bad push token, RazorpayX test error) retries, then succeeds or lands in Sentry
- [ ] A withdrawal request returns in under 1 second on web, Android and iOS
- [ ] No old pg_cron job still does the same work

---

## Phase 6: Speed and media (ImageKit)

**Backend**
- [ ] **(You)** Create an ImageKit account. Folders: `/local`, `/beta`, later `/prod`. (Account exists; set the secrets and rotate the private key that was pasted into chat. See `docs/MEDIA.md`.)
- [x] New `media` table (R4), migration 109, applied on the hosted test project 2026-10-19:
  - `id`, `owner`, `provider` (imagekit | supabase), `provider_file_id`, `path`
  - `purpose` (task | avatar | proof | chat), `kind`, `bytes`
  - `status` (pending → attached → hidden → deleted), `created_at`
- [x] New uploads referenced as `media:<id>` in `tasks.media_path`, `profiles.avatar_url`, `task_proofs.files` and chat messages; old values still readable (the server checks the reference is the caller's own finished upload)
- [x] The old app can still show new photos: `signMedia` accepts `media:<id>` and returns a URL in the old response shape. Old-app uploads keep working through Supabase Storage.
- [x] `createUpload` (`api/media.ts`) for images returns ImageKit params signed on the server:
  - token, expiry and HMAC-SHA1 signature
  - public key
  - folder `/<env>/u/<uid>/`
  - allowed types and max size
- [x] Videos and documents keep Supabase signed uploads, also recorded in `media` (referred to by storage path, `attached` from the start)
- [x] Attach (`attachMedia`): the server checks through the ImageKit API that the file exists at the exact path it chose, is private, is a picture and is under 15 MB, then marks it attached
- [x] `signMedia`:
  - applies `private.can_read_task_media` plus chat participants
  - returns signed URLs at thumb, card and full sizes, auto WebP/AVIF
  - rounds expiry to the hour, so URLs can be cached
- [x] Inngest: pending media older than 24 h deleted; account deletion acts through `media.status`, and ImageKit files are deleted with retries (`media-purge`, `account-files`). Takedowns still detach and keep the file; hiding and deleting by moderators is Phase 7.

**User app (all platforms)**
- [x] `apps/mobile/src/lib/media.ts` uploads images to ImageKit
- [x] Each screen requests the right size (thumb for the header avatar and small tiles, card for the feed, profiles and chat, full to open a proof photo)
- [x] `expo-image` renders images, with a disk cache (cached under the URL without its signature)
- [x] Slow long lists move to a virtualised list: Browse jobs (Explore, up to 60 results) and the Home search results use `ScreenList` (`components/ui.tsx`, a `FlatList`); the other lists are short and stay as they are

**Web**
- [ ] CSP allows ImageKit (uploads and CDN): the user app has no CSP yet (Phase 3 `vercel.json` item); the directives to include are in `docs/MEDIA.md`
- [x] Drag-and-drop works on web (`useFileDrop`, `pickedFromFile`): the attach area on a post and the profile and onboarding photo pickers accept a dropped file and send it through `uploadMedia`; native is unchanged
- [ ] Upload from file picker and drag-and-drop lands in ImageKit (needs migration 106 and the ImageKit secrets on the test project; until then the server hands out Supabase Storage uploads)

**Android**
- [ ] Camera and gallery uploads work
- [ ] Images load fast on mobile data

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Camera and library uploads work, including HEIC photos (check ImageKit converts them)
- [-] Images load fast

**Admin**
- [ ] Copyright, user and task views show ImageKit images through server-side signing

**Verify**
- [ ] New photos are stored in ImageKit and recorded in `media`
- [ ] The feed downloads thumbnails and meets the targets in Part B, section 5, on web, Android and iOS
- [ ] Users without access can't get a URL
- [ ] Chat photos open for the recipient on every platform
- [ ] Abandoned uploads are cleaned up after 24 h

---

## Phase 7: Moderation and admin tools

**Backend**
- [ ] `reports` table (task, message, review, person) and `blocks` table
- [ ] Blocked users can't bid on, message or see each other's tasks, enforced in `api` and SQL
- [ ] Admin SQL functions:
  - [ ] hide/unhide a listing, cancel a task with refund, change a task's category
  - [ ] pause a promotion, cancel a promotion with refund
  - [ ] hide a message or photo (`media.status = hidden`), remove a review
- [ ] `worker_commission_pct` and promotion price tiers are editable settings
- [ ] Every new admin action writes to `admin_audit_log`

**User app (all platforms)**
- [ ] "Report" on tasks, messages, reviews and profiles
- [ ] "Block" on profiles and chats; a blocked-users list in Account
- [ ] Hidden content disappears for everyone

**Web**
- [ ] Report and block work in the browser

**Android**
- [ ] Report and block work on the APK

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Report and block work on TestFlight. Apple requires this (guideline 1.2).

**Admin**
- [ ] Reports queue:
  - see the reported content
  - act on it: remove, hide, warn, suspend, delete
  - aim to act within 24 hours
- [ ] Task actions on the task page: hide/unhide, cancel with refund, change category
- [ ] Promotion actions: pause; cancel with refund
- [ ] Settings page: `worker_commission_pct` and promotion price tiers, behind the money MFA gate (`src/lib/actions.ts:276`)
- [ ] Broadcasts target by platform (web / Android / iOS) and app version as well as segments, sent as push + in-app
- [ ] Dashboard: users and active devices by platform and version; links to Sentry, Inngest and ImageKit
- [ ] Runbook: what to do for a stuck payout, a failed refund, a report, a dispute, and maintenance mode

**Verify**
- [ ] A reported message hidden from admin disappears for both users on web, Android and iOS
- [ ] A blocked user can't contact the blocker on any platform
- [-] A broadcast to "iOS only" reaches only iPhones
- [ ] Every action is in the audit log

---

## Phase 8: Store readiness

**Web**
- [ ] Privacy policy, terms and support pages live on `taskdrop.in`, needed by both stores. (Built 2026-10-19 as `?page=terms`, `?page=privacy`, `?page=support`, all public; text traced to code in `docs/LEGAL_AUDIT.md`. Open: the domain, `EXPO_PUBLIC_LEGAL_*` values, lawyer review.)
- [ ] Map tiles (`MapPicker`) and the fallback search use a provider's free tier, or the volume is confirmed low. OpenStreetMap's public servers don't allow heavy commercial use.

**Android**
- [ ] **(You)** Google Play Console app ($25 one-time, if not paid), store listing, screenshots, data-safety form
- [ ] EAS `production`-style Android build (AAB) for the closed test
- [ ] **(You)** Closed test with at least 12 testers for 14 days (required before a production release)

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] **(You)** App Store listing: screenshots, privacy labels, support and privacy URLs
- [-] Reviewer demo login (a test phone with a fixed code), plus review notes
- [-] Before review:
  - [-] Apple sign-in works
  - [-] report and block are live
  - [-] account deletion works
  - [-] the iOS promotion switch is ready
- [-] `submit.ios` in `eas.json`

**Admin**
- [ ] Ready to handle reviewer reports within 24 hours; runbook checked

**Verify**
- [ ] On the Play closed test and on TestFlight: post → bid → pay → complete → withdraw works
- [-] Apple sign-in works on iPhone
- [ ] Push arrives on both platforms
- [ ] An EAS Update installs on both

---

## Phase 9: Switch-over to the upgraded app

- [ ] Phases 0–8 done; the last tester round has no open serious issues
- [ ] **(You)** Approve the switch-over
- [ ] **Move everyone to the upgraded app:**
  - [ ] **Android:** testers install the upgraded build; the old APK retires
  - [-] **iOS:** TestFlight continues on `main` (iOS only ever had the upgraded app)
  - [ ] **Web:** the old Vercel URL redirects to `taskdrop.in`
  - [ ] **Admin:** the old admin URL redirects to `admin.taskdrop.in`
  - [ ] The old app (requests without the platform header) gets the "Update the app" screen, set from app controls
- [ ] **Backend: lockdown**, now that the old admin is retired:
  - [ ] The upgraded admin already sends the gateway header (Phase 3)
  - [ ] Run `supabase/lockdown/gateway_only.sql`. It turns on `require_gateway` and removes `messages`/`notifications` from the realtime feed.
- [ ] **Backend: retire old code paths:**
  - [ ] Remove the old `phone-auth` function and the synthetic emails
  - [ ] Remove the compatibility code kept for the old app
  - [ ] Remove the old `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` from Google Cloud, now that no web bundle uses it
  - [ ] Drop what nothing uses any more, in clean-up migrations
  - [ ] Turn off the compatibility check in CI
- [ ] **Repos:**
  - [ ] Create `main` from `upgraded-plan-changes` and make it the default branch
  - [ ] The old branches stay exactly as they are
  - [ ] CodeRabbit config moves to `main`
- [ ] **Web:** `taskdrop.in` follows `main`
- [ ] **Admin:** `admin.taskdrop.in` follows `main`

**Verify**
- [ ] Every tester is on the upgraded app on web, Android and iOS
- [ ] Admin works on `admin.taskdrop.in`
- [ ] After the lockdown, a direct database call with the public key + a user token is refused, while web, Android, iOS, admin and the E2E tests still work
- [ ] The old branches are unchanged

---

## Phase 10: Customer launch (later, when you decide)

- [ ] **(You)** Decide to launch; confirm recommendations A and D
- [ ] **Backend:**
  - [ ] Production Supabase project on Pro ($25/month, backups); migrations from `main`, secrets from the inventory, functions deployed
  - [ ] Auth providers on, with production redirects
  - [ ] Lockdown run (same steps as Phase 9)
  - [ ] Inngest production environment, ImageKit `/prod`, Sentry production
  - [ ] Production deploys need your approval in CI
- [ ] **(You)** Razorpay and RazorpayX live keys (business KYC + current account); MSG91 DLT templates
- [ ] **Web:** production on `taskdrop.in`; the beta moves to `beta.taskdrop.in`; Vercel Pro ($20/month)
- [ ] **Admin:** production on `admin.taskdrop.in`; beta admin on `beta-admin.taskdrop.in`
- [ ] **Android:** Play production release
- [-] **iOS:** App Store submission and release
- [ ] **Legal:**
  - [ ] **(You)** Register the DMCA agent (`EXPO_PUBLIC_COPYRIGHT_AGENT_*`)
  - [ ] `EXPO_PUBLIC_LEGAL_*` and the grievance-officer variables set
  - [ ] Lawyer review of `src/legal/documents.ts`, then `EXPO_PUBLIC_LEGAL_REVIEWED=yes`
  - [ ] DPDP compliance
  - [ ] The money-flow answer (R3) is implemented
- [ ] **Rollback ready:**
  - [ ] Vercel instant rollback
  - [ ] EAS Update rollback
  - [ ] Supabase backups
  - [ ] a written undo step for every migration
- [ ] **Launch gate:**
  - [ ] E2E green
  - [ ] Sentry quiet for 7 days
  - [ ] Monitors green
  - [ ] The full flow passes on web, Android, iOS and admin with live keys and small real amounts

---

# Part B: Reference

## 1. Goals

You started this because the app felt clumsy and parts weren't working as expected. So the first job is to **make what exists work reliably**, then upgrade it. We are evolving the existing app, not rebuilding it; features and flows stay the same.

1. **Fix and protect:** fix what's broken, and add automated tests so it stays fixed.
2. **See problems:** Sentry across the user app (web, Android, iOS), the admin app and every server function, with uptime alerts.
3. **Ship to testers fast:** app updates reach testers without reinstalling.
4. **Server decides everything:** only UI ships to users.
5. **Admin controls every app:** web, Android and iOS, enforced on the server.
6. **Sign-in:** Google, Apple, phone OTP and username + password, with account linking.
7. **Reliable background work:** Inngest.
8. **Faster app:** ImageKit and query fixes.
9. **Three platforms:** web and Android are tested in every phase now; iOS joins later (future scope, section 12).
10. **Customers:** a customer launch when you decide.

## 2. Decisions

### Made by you

| Topic | Decision |
|---|---|
| Codebase | Evolve the existing code; same features |
| Branch | All upgrade work on **`upgraded-plan-changes`**; old code never altered |
| Code review | **CodeRabbit** AI review on every pull request, plus CI |
| Stage | Testing only: fake data, you + ~10 testers, no customers |
| Platforms | User app on web + Android + iOS (one Expo app); admin as a separate web app. **iOS is future scope (2026-10-20): web, Android and admin first** |
| Sign-in | Google, Apple, phone OTP, username + password. No separate email sign-in. Admin login unchanged |
| Phone login | Supabase's built-in phone login with a Send-SMS hook to MSG91 |
| Phone number | Optional; the "require verified phone" switch is off |
| Payments | Existing Razorpay escrow + RazorpayX payouts, audited not rewritten |
| Promotion on iOS | Razorpay, with a per-platform switch to hide it on iOS if Apple objects |
| Media | Images to ImageKit; videos and documents stay in Supabase Storage |
| Background jobs | Inngest Cloud free plan with the cloud test project (no local dev server needed) |
| Expo / EAS | No EAS Hosting (web is on Vercel). EAS for app builds, and **EAS Update** for over-the-air updates to testers (R1) |
| Database | **One shared test project** (`wjxvingpfbfvkfqhrguj`) for the old app and the upgrade until Phase 9; upgrade changes stay compatible with the old app |
| Deploys | **Vercel runs every deploy** (owner decision 2026-10-20). A push to `redesigned-2.0` makes the `taskdrop` project's build deploy the backend to the shared test project, then the web app (R2). GitHub only stores the code: no deploy workflow, no secrets in GitHub |
| Hosting now | Free plans (Vercel Hobby, Supabase free) while testing |
| Supabase testing | **The cloud project is the test environment** (2026-10-20): test directly on `wjxvingpfbfvkfqhrguj`; no local Supabase or Docker. CI uses a throwaway database only to run the SQL tests |
| Domain | **`taskdrop.in` is bought on Spaceship.com** (2026-10-20); the admin app has no subdomain for now and stays on its Vercel address (decided 2026-10-20). DNS stays at Spaceship; `A @` and `CNAME www` point at Vercel |
| Admin control | The admin controls web, Android and iOS, enforced on the server |

### Recommendations

| # | Recommendation | Why | Status |
|---|---|---|---|
| R1 | **EAS Update** for testers (over-the-air updates, not EAS Hosting) | App changes reach installed Android/iOS apps without rebuilding or reinstalling | **Confirmed** |
| R2 | **Auto-deploy** to the test project on every push to `redesigned-2.0`, run by the Vercel build (not GitHub Actions) | Testers always run the latest upgrade; nothing to forget | **Confirmed** (Vercel-run since 2026-10-20) |
| R3 | **Ask a lawyer about the money flow now** | If the wallet or escrow needs a different setup (e.g. Razorpay Route), Phase 5 must be built that way | Your action, Phase 0 |
| R4 | A **`media` table** for every uploaded file | Moderation, takedowns, deletion and cleanup need it | Phase 6 |
| R5 | A second free Supabase project for the upgrade | It would keep the old app's database untouched | **Not chosen.** The project is shared, under the compatibility rules (ground rule 4) |
| A | At customer launch: a new **production** project on Supabase Pro ($25/month); the test project becomes staging | Clean production, safe staging | Deferred to Phase 10 |
| D | **Vercel Pro** ($20/month) at customer launch | The free plan is non-commercial | Deferred to Phase 10 |
| E | The admin app stays in **its own repo** | Already deployed; merging repos adds risk | Applies |

## 3. Architecture

### 3.1 Overview

```
 USERS                                          ADMINS
 ┌───────────────────────────────┐              ┌──────────────────────────────┐
 │ Expo app (UI only)            │              │ Admin web app (Next.js 16)   │
 │ Web: taskdrop.in (Vercel)     │              │ admin.taskdrop.in (Vercel)   │
 │ Android: APK → Play           │              │ server actions only          │
 │ iOS: TestFlight → App Store   │              └──────────────┬───────────────┘
 └──────────────┬────────────────┘                             │ server-side, gateway header
                │ HTTPS + user token + platform/version headers │
                ▼                                              ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ SUPABASE (shared test project now; staging + production at customer launch) │
 │                                                                              │
 │ Edge Functions (server code, never shipped to users)                         │
 │  api ............ gateway for every app read/write: auth check, rate limits, │
 │                   app controls, contact-detail rule, blocks, media signing   │
 │  app-config ..... public: maintenance, minimum version, switches, banner     │
 │  password-auth .. username + password · Send-SMS hook → MSG91                │
 │  razorpay, razorpay-webhook, razorpayx-webhook, razorpayx-payouts            │
 │  places-search .. Google Places + OpenStreetMap, server-side                 │
 │  inngest ........ serves all background functions                           │
 │                                                                              │
 │ Postgres: tables + RLS, SQL money rules, media registry, triggers → outbox   │
 │ Auth (phone, Google, Apple) · Storage (videos, documents) · Realtime pings   │
 └───────┬──────────────────────────┬─────────────────────────┬────────────────┘
         │ events (outbox)          │ signed uploads/URLs      │ errors, traces
         ▼                          ▼                          ▼
 ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
 │ Inngest       │          │ ImageKit      │          │ Sentry        │
 │ schedules,    │          │ images: store,│          │ web, Android, │
 │ retries, logs │          │ resize, CDN   │          │ iOS, admin,   │
 └───────────────┘          └───────────────┘          │ functions     │
                                                       └───────────────┘
 Other services: Razorpay / RazorpayX · MSG91 · Google Places · Expo Push → FCM
 (Android) / APNs (iOS) · EAS Build + EAS Update · Vercel · GitHub (code and checks only) ·
 CodeRabbit · Uptime Robot.
```

### 3.2 What runs where

| Code | Runs on | Visible to users? |
|---|---|---|
| Expo app screens and formatting | Browser / Android / iPhone | **Yes.** Any app bundle can be read, so it holds no secrets and no authority |
| Edge functions (`api`, `app-config`, auth, payments, `inngest`…) | Supabase servers | No |
| SQL functions, RLS policies, triggers | Supabase Postgres | No |
| Admin server actions and pages | Vercel servers | No (admins see rendered pages only) |
| Secrets (section 7) | Supabase secrets / Vault, Vercel env (none in GitHub) | No |
| Public keys (Supabase anon key, Sentry DSN, ImageKit public key, restricted Android Maps key) | App bundle | Yes, by design. Safe only because the server enforces everything |

### 3.3 Tech stack: each tool's job

| Tool | Responsible for | Not responsible for |
|---|---|---|
| **Expo** (SDK 57, React Native 0.86, React 19) | One user app for web, Android and iOS | Business rules or secrets |
| **EAS Build / Submit / Update** | Android and iOS app files, store submission, over-the-air updates | Web hosting (no EAS Hosting) |
| **Next.js 16** | Admin panel UI and server actions | Being reachable by normal users |
| **Supabase** | Database, auth (phone, Google, Apple), RLS, SQL money rules, edge functions, Storage for videos/documents, Realtime | Image resizing, retrying schedules |
| **Inngest** | Scheduled jobs, event work, retries, step logs | Holding data (Postgres is the source of truth) |
| **ImageKit** | Signed image uploads, storage, resizing, WebP/AVIF, CDN, private signed URLs | Videos and documents |
| **Sentry** | Errors, crashes and traces across web, Android, iOS, admin and functions; alerts | Behaviour analytics |
| **Razorpay / RazorpayX** | Collecting payments; paying workers | Deciding amounts (the server does) |
| **MSG91** | Sending OTP SMS (via the Send-SMS hook; DLT templates) | Deciding who may get a code |
| **Google Places / OpenStreetMap** | Address search and reverse lookup, only through `places-search` | Being called from the app |
| **Expo Push → FCM / APNs** | Delivering push notifications to Android and iPhone | Deciding what to send |
| **Vercel** | Hosting `taskdrop.in` (web) and `admin.taskdrop.in` | Server logic for the user app |
| **GitHub** | Code, pull requests and test checks only. No deploys, no secrets | Nothing deploys from it, by design |
| **CodeRabbit** | AI review of every pull request: bugs, security, missing checks, against our path rules | Approving merges alone; CI and you still decide |
| **Playwright** | Automated end-to-end tests of the core flows on the web build | Native-only behaviour (checked by hand on Android/iOS) |
| **Uptime Robot** | Alerts when web, admin or API is down | Error details |
| **Spaceship** | Owning `taskdrop.in` and its DNS | Hosting |

### 3.4 Tools we're not using

| Tool | Decision | Reason |
|---|---|---|
| Clerk | No | Supabase Auth already does phone, Google and Apple; RLS, the age gate and deletion depend on Supabase user ids |
| Stripe | No | Razorpay is built for India and already integrated |
| Cloudflare | Later | Vercel already gives CDN and SSL. Add later for DDoS/WAF/Turnstile; re-test per-IP throttles first (F-08) |
| PostHog | Later | Useful once there are real users; needs consent and a privacy update |
| Pinecone | No | No AI search. If ever needed, use `pgvector` in Supabase |
| Resend | Later | Email isn't core; add for receipts or admin email alerts |
| Flutter | No | Would mean rewriting everything in Dart |
| Apper | No | Builds and hosts apps on its own platform |
| EAS Hosting | No | Websites stay on Vercel |

### 3.5 Environments

| | Old app (code untouched) | Upgrade: your PC | Upgrade: hosted beta |
|---|---|---|---|
| Code | `main` (and the other old branches) | Phase branches | `upgraded-plan-changes` |
| Supabase | `wjxvingpfbfvkfqhrguj`, **shared** with the upgrade | The same cloud project (no local stack) | `wjxvingpfbfvkfqhrguj`, **shared** (compatibility rules apply) |
| Web | Current Vercel URL | `expo start` in a browser | `taskdrop.in` |
| Android | Existing preview APK | Your phone over Wi-Fi | `beta` APK + EAS Update channel `beta` |
| iOS | — | — (needs a build) | TestFlight internal + channel `beta` |
| Admin | Current Vercel URL | `npm run dev` (port 3001) | `admin.taskdrop.in` |
| Background jobs | Shared: Inngest for schedules, retries and outside calls; pg_cron only for the money sweeps until cutover | Inngest dev server (`localhost:8288`) | Inngest Cloud free plan |
| Images | Supabase Storage (can also show new ImageKit photos via `signMedia`) | ImageKit `/local` | ImageKit `/beta` |
| Razorpay | Test keys | Test keys | Test keys |
| Sentry | — | Off | `environment: beta` |

Because the database and functions are shared, a backend change deployed for the upgrade also runs for the old app. That's why ground rule 4 (compatibility) and the CI compatibility check exist. After Phase 9 the old column is retired. At Phase 10, production is added and the test project becomes staging (`beta.taskdrop.in`). Free Supabase projects pause after about a week of inactivity; resume them from the dashboard.

### 3.6 How a change reaches testers

```
upgrade/phase-N-… branch → pull request into upgraded-plan-changes
   → CI (typecheck, unit, SQL, api, compatibility check, Playwright E2E) + CodeRabbit review → fix or answer → merge
   → Vercel build (R2): migrations · functions · Inngest sync → shared test project (wjxvingpfbfvkfqhrguj), then the web app
                       web + admin → taskdrop.in / admin.taskdrop.in (Vercel)
                       app JS/UI → EAS Update channel "beta" → Android + iPhone
   → native changes only: new EAS build (beta APK / TestFlight)
   → tester round with the checklist (section 5)
```

### 3.7 Key flows after the upgrade

- **Sign-in:**
  - iPhone: Apple uses the native sheet.
  - Elsewhere: Google and Apple use a browser flow.
  - Phone uses a Supabase OTP; username + password goes through `password-auth`.
  - Every method leads to the age gate and onboarding. More methods can be linked later.
- **Post a task with a photo:**
  1. `api` creates a pending `media` row and an ImageKit signature.
  2. The app uploads straight to ImageKit.
  3. `api` checks the file, the contact rule and the switches, then attaches it.
  4. The task is saved.
- **Pay escrow:**
  1. The server computes the amount and creates a Razorpay link.
  2. The webhook is verified and recorded once.
  3. Inngest processes it, with retries.
- **Withdraw:**
  1. `api` records the request and returns at once.
  2. Inngest sends the RazorpayX payout, with retries.
  3. A 15-minute check catches stuck payouts.
- **Notify:**
  1. A database change writes a notification and an outbox row.
  2. Inngest receives the event immediately; the sweeper re-sends it on failure.
  3. Inngest sends the push to Android and iPhone; web shows it in-app.
- **Admin switch:**
  1. Admin flips "posting off on iOS"; the change is audited.
  2. `app-config` and `api` pick it up within a minute.
  3. The iPhone app shows a message, and `api` refuses iOS posts.

### 3.8 Database changes (summary)

| Change | Phase |
|---|---|
| Chat-photo read policy, drop duplicate sweep, `payout_upi` fix | 2 |
| Promotion price tiers; `app_controls` | 3 |
| Phone in `auth.users.phone`; test users migrated | 4 |
| `private.outbox`, `webhook_events`, push receipts | 5 |
| `media` registry | 6 |
| `reports`, `blocks`; admin task, promotion and content actions | 7 |

## 4. Where we are today (code scan, 2026-10-07)

**Repos**
- User app + backend: `C:\complete taskdrop\taskdrop-claude-web` → GitHub `hitendureacts77/taskdrop`.
  - The newest work is commit 3d4bd72, on `claude/modest-albattani-3odt95` and now also on `upgraded-plan-changes`.
  - The Vercel project `taskdrop` deploys `main` (renamed from `feature/first-push` on 2026-10-11).
- Admin: `C:\complete taskdrop\taskdrop-admin` → GitHub `hitendureacts77/taskdrop-admin`, branch `main`, deployed to Vercel. Google + `admin` role login, MFA for money actions.

**Known bugs**
- Promotion checkout (`PromoteScreen.tsx:166`).
- Chat photos for the recipient (policy 075).
- The `payout_upi` mismatch.
- Android push in builds (no FCM credentials).
- Swallowed errors (`.catch(() => {})`) on money screens.

**Server boundary**
- The lockdown is off (`gateway_only.sql` never run): signed-in users can call 68 database functions directly.
- The Google Maps key is in the web bundle (`location.ts:41`).
- The contact rule runs in the app only.
- Promotion prices are set by the app (`PromoteScreen.tsx:95-99`).
- `feesSince` takes the commission from the app.

**Background work**
- pg_cron + pg_net, with no retries.
- The earnings sweep runs twice.
- Stuck payouts are never retried; withdrawals call RazorpayX inside the user's request.
- No job marks tasks `OVERDUE`; push receipts are never read.

**Media**
- One private bucket, no resizing, videos up to 50 MB.
- Orphaned files are never cleaned up.

**Monitoring**
- Sentry is hand-written: no native crashes, API errors ignored, no DSN in builds.
- Payment functions only `console.error`.

**Sign-in and platforms**
- **Web:** works; Google sign-in.
- **Android:** preview APK, no store release, Google sign-in.
- **iOS:** no config, no build, no Apple sign-in.
- Phone accounts use synthetic emails, and there's no account linking.
- **No report or block feature.**

**Tests**
- Unit, `api` and 11 SQL test files exist.
- No end-to-end tests, no CI, no code review tool.

**Admin today**
- Users (search, suspend, delete, notes, tags), payouts, refunds, disputes, support, CRM segments and broadcasts, copyright, money, reports, MFA.
- 5 editable settings.

## 5. Testing

### 5.1 Quality bar (every pull request)

- **Code:** typecheck clean in both repos.
- **Tests:**
  - unit tests, `api` tests and SQL tests pass
  - new tables, policies and functions get SQL tests, and new `api` ops get tests
- **E2E:** Playwright green (from Phase 2).
- **Review:** CodeRabbit comments fixed or answered.
- **Database:** Supabase security and performance advisors show no new warnings.
- **Monitoring:** no new Sentry errors after the beta deploy.
- **Privacy:** no secrets in the app bundle; no phone numbers or emails in Sentry or logs.
- **This plan:** the boxes for the work are ticked.

### 5.2 Core-flow checklist (by hand on Web, Android, iOS; Admin column for admin flows)

| # | Flow | Web | Android | iOS |
|---|---|---|---|---|
| 1 | Sign-in: Google, Apple, phone, username + password; age gate; onboarding; link a method; sign out | ☐ | ☐ | ☐ |
| 2 | Post a task: photo, video, map location, address search, deadline | ☐ | ☐ | ☐ |
| 3 | Browse, search, filter, map view, save | ☐ | ☐ | ☐ |
| 4 | Bid, edit bid, compare, lock | ☐ | ☐ | ☐ |
| 5 | Fund from wallet; Razorpay test payment (card, UPI) | ☐ | ☐ | ☐ |
| 6 | Start, chat (text + photo), proof, done, revision, confirm, auto-complete, review | ☐ | ☐ | ☐ |
| 7 | Cancel before and after start (fine), dispute, refund | ☐ | ☐ | ☐ |
| 8 | Top up, withdraw (manual + RazorpayX test), payout status | ☐ | ☐ | ☐ |
| 9 | Notifications: in-app (all); push (Android, iOS) | ☐ | ☐ | ☐ |
| 10 | Promotion: buy, placement, end, refund unspent | ☐ | ☐ | ☐ |
| 11 | Profile edit, avatar, report, block, delete account | ☐ | ☐ | ☐ |
| 12 | Maintenance screen, update screen, banner, switched-off messages | ☐ | ☐ | ☐ |

**Admin checklist:**
- sign-in with MFA
- every app-control switch per platform
- broadcast by platform
- reports queue
- dispute, payout, refund, copyright
- task and promotion actions
- settings
- audit log

### 5.3 Tester rounds

At the end of every phase:
- testers get the new version (EAS Update, or a new build) with a short "what to test" note
- they report problems through the in-app support ticket, which lands in the admin support queue
- serious issues are fixed before the next phase starts

## 6. Performance targets (measured with Sentry from Phase 1)

| Measure | Target |
|---|---|
| Home feed first screen, 4G, mid-range Android and iPhone | under 2 s |
| Web home feed first load (4G) | under 3 s |
| Feed thumbnail size | under 50 KB each |
| `api` reads / writes, 95th percentile | under 500 ms / 800 ms |
| Withdrawal request response | under 1 s |
| Crash-free sessions (Android, iOS) | above 99.5% |

## 7. Secrets and config inventory

| Where | What |
|---|---|
| **App bundle (public by design)**: `EXPO_PUBLIC_*` | Supabase URL and anon key, Sentry DSN, environment and replay rate, app URL, legal and copyright-agent display values; the Android-only Maps key, restricted. (`EXPO_PUBLIC_USE_RN_FETCH`, `_FOLDER` and `_PROJECT_ROOT` are build-tool switches.) **Nothing else.** |
| **Supabase function secrets** (read by the code today) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, `RAZORPAYX_WEBHOOK_SECRET` (`scripts/push-payment-secrets.sh`); `MSG91_AUTHKEY`, `MSG91_TEMPLATE_ID`; `TEST_PHONES`, `ALLOW_ANY_OTP` (test project only); `GOOGLE_MAPS_API_KEY` (server key for `places-search`); `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_ENV`; `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_MONEY_JOBS` (plus optional `INNGEST_DEV`, `INNGEST_PUSH_RECEIPT_WAIT`); `SENTRY_DSN`, `SENTRY_ENVIRONMENT`; `API_GATEWAY_SECRET`. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` itself. **Planned, no code reads them yet:** Apple team id, key id, private key and Services ID (Phase 4, iOS-deferred) |
| **Supabase Vault** (read by SQL) | `API_GATEWAY_SECRET`, Inngest event URL and key, existing app secrets (migration 037) |
| **Admin (Vercel env, per branch)** | Read today: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_GATEWAY_SECRET`, `ADMIN_EMAIL`, `ADMIN_PHONE`, `ADMIN_SESSION_SECRET`, `ADMIN_IDLE_MINUTES`, `ADMIN_SESSION_HOURS`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN`, `SENTRY_PROJECT_URL`. **Planned (Phase 6):** ImageKit private key and endpoint |
| **Vercel env, backend deploy** (project `taskdrop`, Preview, branch `redesigned-2.0`) | `SUPABASE_ACCESS_TOKEN` and `DATABASE_URL` (the Vercel build deploys migrations and functions with them, set up in Phase 0). Later: `EXPO_TOKEN` if EAS Update runs from Vercel (Phase 1; otherwise from your PC), Sentry auth token (source maps). **GitHub holds no secrets** |
| **CodeRabbit** | AI review of every pull request: bugs, security, missing checks, against our path rules | Approving merges alone; CI and you still decide |
| **Playwright** | Automated end-to-end tests of the core flows on the web build | Native-only behaviour (checked by hand on Android/iOS) |
| **Uptime Robot** | Alerts when web, admin or API is down | Error details |
| **Spaceship** | Owning `taskdrop.in` and its DNS | Hosting |

### 3.4 Tools we're not using

| Tool | Decision | Reason |
|---|---|---|
| Clerk | No | Supabase Auth already does phone, Google and Apple; RLS, the age gate and deletion depend on Supabase user ids |
| Stripe | No | Razorpay is built for India and already integrated |
| Cloudflare | Later | Vercel already gives CDN and SSL. Add later for DDoS/WAF/Turnstile; re-test per-IP throttles first (F-08) |
| PostHog | Later | Useful once there are real users; needs consent and a privacy update |
| Pinecone | No | No AI search. If ever needed, use `pgvector` in Supabase |
| Resend | Later | Email isn't core; add for receipts or admin email alerts |
| Flutter | No | Would mean rewriting everything in Dart |
| Apper | No | Builds and hosts apps on its own platform |
| EAS Hosting | No | Websites stay on Vercel |

### 3.5 Environments

| | Old app (code untouched) | Upgrade: your PC | Upgrade: hosted beta |
|---|---|---|---|
| Code | `main` (and the other old branches) | Phase branches | `upgraded-plan-changes` |
| Supabase | `wjxvingpfbfvkfqhrguj`, **shared** with the upgrade | The same cloud project (no local stack) | `wjxvingpfbfvkfqhrguj`, **shared** (compatibility rules apply) |
| Web | Current Vercel URL | `expo start` in a browser | `taskdrop.in` |
| Android | Existing preview APK | Your phone over Wi-Fi | `beta` APK + EAS Update channel `beta` |
| iOS | — | — (needs a build) | TestFlight internal + channel `beta` |
| Admin | Current Vercel URL | `npm run dev` (port 3001) | `admin.taskdrop.in` |
| Background jobs | Shared: Inngest for schedules, retries and outside calls; pg_cron only for the money sweeps until cutover | Inngest dev server (`localhost:8288`) | Inngest Cloud free plan |
| Images | Supabase Storage (can also show new ImageKit photos via `signMedia`) | ImageKit `/local` | ImageKit `/beta` |
| Razorpay | Test keys | Test keys | Test keys |
| Sentry | — | Off | `environment: beta` |

Because the database and functions are shared, a backend change deployed for the upgrade also runs for the old app. That's why ground rule 4 (compatibility) and the CI compatibility check exist. After Phase 9 the old column is retired. At Phase 10, production is added and the test project becomes staging (`beta.taskdrop.in`). Free Supabase projects pause after about a week of inactivity; resume them from the dashboard.

### 3.6 How a change reaches testers

```
upgrade/phase-N-… branch → pull request into upgraded-plan-changes
   → CI (typecheck, unit, SQL, api, compatibility check, Playwright E2E) + CodeRabbit review → fix or answer → merge
   → Vercel build (R2): migrations · functions · Inngest sync → shared test project (wjxvingpfbfvkfqhrguj), then the web app
                       web + admin → taskdrop.in / admin.taskdrop.in (Vercel)
                       app JS/UI → EAS Update channel "beta" → Android + iPhone
   → native changes only: new EAS build (beta APK / TestFlight)
   → tester round with the checklist (section 5)
```

### 3.7 Key flows after the upgrade

- **Sign-in:**
  - iPhone: Apple uses the native sheet.
  - Elsewhere: Google and Apple use a browser flow.
  - Phone uses a Supabase OTP; username + password goes through `password-auth`.
  - Every method leads to the age gate and onboarding. More methods can be linked later.
- **Post a task with a photo:**
  1. `api` creates a pending `media` row and an ImageKit signature.
  2. The app uploads straight to ImageKit.
  3. `api` checks the file, the contact rule and the switches, then attaches it.
  4. The task is saved.
- **Pay escrow:**
  1. The server computes the amount and creates a Razorpay link.
  2. The webhook is verified and recorded once.
  3. Inngest processes it, with retries.
- **Withdraw:**
  1. `api` records the request and returns at once.
  2. Inngest sends the RazorpayX payout, with retries.
  3. A 15-minute check catches stuck payouts.
- **Notify:**
  1. A database change writes a notification and an outbox row.
  2. Inngest receives the event immediately; the sweeper re-sends it on failure.
  3. Inngest sends the push to Android and iPhone; web shows it in-app.
- **Admin switch:**
  1. Admin flips "posting off on iOS"; the change is audited.
  2. `app-config` and `api` pick it up within a minute.
  3. The iPhone app shows a message, and `api` refuses iOS posts.

### 3.8 Database changes (summary)

| Change | Phase |
|---|---|
| Chat-photo read policy, drop duplicate sweep, `payout_upi` fix | 2 |
| Promotion price tiers; `app_controls` | 3 |
| Phone in `auth.users.phone`; test users migrated | 4 |
| `private.outbox`, `webhook_events`, push receipts | 5 |
| `media` registry | 6 |
| `reports`, `blocks`; admin task, promotion and content actions | 7 |

## 4. Where we are today (code scan, 2026-10-07)

**Repos**
- User app + backend: `C:\complete taskdrop\taskdrop-claude-web` → GitHub `hitendureacts77/taskdrop`.
  - The newest work is commit 3d4bd72, on `claude/modest-albattani-3odt95` and now also on `upgraded-plan-changes`.
  - The Vercel project `taskdrop` deploys `main` (renamed from `feature/first-push` on 2026-10-11).
- Admin: `C:\complete taskdrop\taskdrop-admin` → GitHub `hitendureacts77/taskdrop-admin`, branch `main`, deployed to Vercel. Google + `admin` role login, MFA for money actions.

**Known bugs**
- Promotion checkout (`PromoteScreen.tsx:166`).
- Chat photos for the recipient (policy 075).
- The `payout_upi` mismatch.
- Android push in builds (no FCM credentials).
- Swallowed errors (`.catch(() => {})`) on money screens.

**Server boundary**
- The lockdown is off (`gateway_only.sql` never run): signed-in users can call 68 database functions directly.
- The Google Maps key is in the web bundle (`location.ts:41`).
- The contact rule runs in the app only.
- Promotion prices are set by the app (`PromoteScreen.tsx:95-99`).
- `feesSince` takes the commission from the app.

**Background work**
- pg_cron + pg_net, with no retries.
- The earnings sweep runs twice.
- Stuck payouts are never retried; withdrawals call RazorpayX inside the user's request.
- No job marks tasks `OVERDUE`; push receipts are never read.

**Media**
- One private bucket, no resizing, videos up to 50 MB.
- Orphaned files are never cleaned up.

**Monitoring**
- Sentry is hand-written: no native crashes, API errors ignored, no DSN in builds.
- Payment functions only `console.error`.

**Sign-in and platforms**
- **Web:** works; Google sign-in.
- **Android:** preview APK, no store release, Google sign-in.
- **iOS:** no config, no build, no Apple sign-in.
- Phone accounts use synthetic emails, and there's no account linking.
- **No report or block feature.**

**Tests**
- Unit, `api` and 11 SQL test files exist.
- No end-to-end tests, no CI, no code review tool.

**Admin today**
- Users (search, suspend, delete, notes, tags), payouts, refunds, disputes, support, CRM segments and broadcasts, copyright, money, reports, MFA.
- 5 editable settings.

## 5. Testing

### 5.1 Quality bar (every pull request)

- **Code:** typecheck clean in both repos.
- **Tests:**
  - unit tests, `api` tests and SQL tests pass
  - new tables, policies and functions get SQL tests, and new `api` ops get tests
- **E2E:** Playwright green (from Phase 2).
- **Review:** CodeRabbit comments fixed or answered.
- **Database:** Supabase security and performance advisors show no new warnings.
- **Monitoring:** no new Sentry errors after the beta deploy.
- **Privacy:** no secrets in the app bundle; no phone numbers or emails in Sentry or logs.
- **This plan:** the boxes for the work are ticked.

### 5.2 Core-flow checklist (by hand on Web, Android, iOS; Admin column for admin flows)

| # | Flow | Web | Android | iOS |
|---|---|---|---|---|
| 1 | Sign-in: Google, Apple, phone, username + password; age gate; onboarding; link a method; sign out | ☐ | ☐ | ☐ |
| 2 | Post a task: photo, video, map location, address search, deadline | ☐ | ☐ | ☐ |
| 3 | Browse, search, filter, map view, save | ☐ | ☐ | ☐ |
| 4 | Bid, edit bid, compare, lock | ☐ | ☐ | ☐ |
| 5 | Fund from wallet; Razorpay test payment (card, UPI) | ☐ | ☐ | ☐ |
| 6 | Start, chat (text + photo), proof, done, revision, confirm, auto-complete, review | ☐ | ☐ | ☐ |
| 7 | Cancel before and after start (fine), dispute, refund | ☐ | ☐ | ☐ |
| 8 | Top up, withdraw (manual + RazorpayX test), payout status | ☐ | ☐ | ☐ |
| 9 | Notifications: in-app (all); push (Android, iOS) | ☐ | ☐ | ☐ |
| 10 | Promotion: buy, placement, end, refund unspent | ☐ | ☐ | ☐ |
| 11 | Profile edit, avatar, report, block, delete account | ☐ | ☐ | ☐ |
| 12 | Maintenance screen, update screen, banner, switched-off messages | ☐ | ☐ | ☐ |

**Admin checklist:**
- sign-in with MFA
- every app-control switch per platform
- broadcast by platform
- reports queue
- dispute, payout, refund, copyright
- task and promotion actions
- settings
- audit log

### 5.3 Tester rounds

At the end of every phase:
- testers get the new version (EAS Update, or a new build) with a short "what to test" note
- they report problems through the in-app support ticket, which lands in the admin support queue
- serious issues are fixed before the next phase starts

## 6. Performance targets (measured with Sentry from Phase 1)

| Measure | Target |
|---|---|
| Home feed first screen, 4G, mid-range Android and iPhone | under 2 s |
| Web home feed first load (4G) | under 3 s |
| Feed thumbnail size | under 50 KB each |
| `api` reads / writes, 95th percentile | under 500 ms / 800 ms |
| Withdrawal request response | under 1 s |
| Crash-free sessions (Android, iOS) | above 99.5% |

## 7. Secrets and config inventory

| Where | What |
|---|---|
| **App bundle (public by design)**: `EXPO_PUBLIC_*` | Supabase URL and anon key, Sentry DSN, app URL, legal and copyright-agent display values; the Android-only Maps key, restricted. **Nothing else.** |
| **Supabase function secrets** | Razorpay key id, secret and webhook secret; RazorpayX secrets (see `scripts/push-payment-secrets.sh`); MSG91 key and template; Google Places server key; ImageKit private and public key and URL endpoint; Inngest signing and event keys; Sentry DSN; Apple team id, key id, private key and Services ID (token revocation) |
| **Supabase Vault** (read by SQL) | `API_GATEWAY_SECRET`, Inngest event URL and key, existing app secrets (migration 037) |
| **Admin (Vercel env, per branch)** | Supabase URL and anon key, service-role key, `ADMIN_SESSION_SECRET`, `API_GATEWAY_SECRET`, Sentry DSN, ImageKit private key and endpoint |
| **Vercel env, backend deploy** | Supabase access token and DB connection string (deploys), `EXPO_TOKEN` (EAS Update, if run from Vercel), Sentry auth token (source maps). GitHub holds none |
| **CodeRabbit** | No secrets; installed as a GitHub app |
| **Your PC** (git-ignored) | `.env` (also `DATABASE_URL`, `SUPABASE_ACCESS_TOKEN` for the deploy and seed scripts), `apps/mobile/.env.local`, admin `.env.local`; all test keys. There is no local functions server, so no `supabase/functions/.env.local` |

## 8. Accounts and costs

| Item | Cost | When |
|---|---|---|
| Domain `taskdrop.in` | ~$5–6/year. **Already bought on Spaceship.com**; keep auto-renew on | done |
| Supabase (shared test project) | Free | now |
| Vercel (web + admin) | Free (Hobby) while testing | now |
| CodeRabbit | Free for public repos; private repos 14-day trial, then $24/developer/month (annual) | Phase 0 |
| Apple Developer Program | $99/year | Phase 0 |
| Docker Desktop | Not needed (we test on the cloud Supabase project) | n/a |
| Sentry, Uptime Robot, EAS Build and Update | Free tiers to start; check limits | Phase 1 |
| Inngest | Dev server free; Inngest Cloud free plan | Phase 5 |
| ImageKit | Free tier to start; check limits | Phase 6 |
| Google Play developer account | $25 one-time (if not paid) | Phase 8 |
| MSG91 SMS; Google Maps/Places | Pay per use | ongoing |
| Supabase Pro (production) | $25/month | Phase 10 |
| Vercel Pro | $20/month per member | Phase 10 |
| Razorpay / RazorpayX | Per-transaction fees; KYC | Phase 10 |
| DMCA agent | ~$6 every 3 years | Phase 10 |

### Domain: where to buy `taskdrop.in`

**Bought on Spaceship.com (you confirmed 2026-10-20), so the comparison below is history.** DNS stays at Spaceship; connect it to Vercel as described in Phase 0, Web.

Prices for `.in` from tld-list.com on 2026-10-07 (USD, 1 year, incl. fees); availability of `taskdrop.in` not checked.

| Registrar | 1st year | Renewal | 3-year total |
|---|---|---|---|
| Sav | $5.39 | $5.39 | $16.17 |
| Above.com | $5.45 | $5.45 | $16.35 |
| Dynadot | $5.54 | $5.54 | $16.62 |
| **Spaceship** | $5.97 ($5.03 with code `SPSR86`, unverified) | $5.97 | $17.91 |
| Porkbun | $5.08 | $6.45 | $17.98 |
| Hostinger | $6.99 | $9.99 | $26.97 |
| Wix | $11.00 | $11.00 | $33.00 |
| Namecheap | $9.98 | $11.98 | $33.94 |
| Gandi | $5.97 | $16.32 | $38.61 |
| Instra | $6.15 | $108.49 | ~$223 (avoid) |

**Pick: Spaceship.** Skip add-ons, turn on auto-renew, and check the renewal price in the cart. DNS stays at the registrar; Cloudflare isn't needed.

## 9. Assumptions (not confirmed by you)

1. Admin alerts become in-app admin notifications + Sentry; email comes later.
2. Test images in Supabase Storage are not moved to ImageKit (the data is fake).
3. Users link sign-in methods themselves; no automatic merging.
4. "Control from admin" means the Phase 3 and Phase 7 lists. Categories, help text and home sections aren't admin-editable yet.
5. Pure-SQL housekeeping stays in pg_cron; anything calling outside services or needing retries goes to Inngest.
6. The performance targets in section 6.
7. Automated E2E runs on the web build. Android and iOS are checked by hand each phase (Maestro can automate Android later).
8. Admin end-to-end checks are by hand, since its login needs Google + MFA.

## 10. Open risks

| Risk | Impact | Mitigation |
|---|---|---|
| **RBI rules:** a withdrawable wallet and platform-held escrow may count as a prepaid payment instrument or payment aggregation | Legal; payout design | Lawyer in Phase 0 (R3). Ask: does the wallet need RBI authorisation? May the platform hold escrow, or must Razorpay (Route)? |
| India's DPDP Act | Legal | Lawyer review with Terms and Privacy |
| Apple rejects Razorpay-paid promotion | iOS approval delay | iOS promotion switch (Phase 3) |
| Apple Developer enrollment takes days | First iOS build slips | Enroll in Phase 0 |
| Google Play closed test (12+ testers, 14 days) | Android launch delay | Recruit in Phase 0; test in Phase 8 |
| RazorpayX live needs KYC and a current account | Payout launch delay | Start KYC early; manual payout mode exists |
| MSG91 DLT registration | OTP fails in production | Register before Phase 10 |
| **Shared database:** an upgrade deploy breaks the old app or old admin | Current testers blocked | Ground rule 4 (additive changes only), CI compatibility check, CodeRabbit rule, old-app check before each backend deploy; breaking changes wait for Phase 9 |
| The old web bundle still exposes the Google Maps key until Phase 9 | Key misuse, bills | Restrict APIs and set a quota now (Phase 0); delete the key in Phase 9 |
| Moving phone login touches every sign-in | Testers locked out | Old and new phone login both work until Phase 9; migrate test users; E2E sign-in test; sign-in switches |
| CodeRabbit on private repos is paid after the trial | Cost | Decide after the trial; CI and Claude reviews still run |
| CodeRabbit only auto-reviews the default branch unless configured | Pull requests not reviewed | `base_branches` setting (Phase 0) |
| Free-tier limits (Supabase, Inngest, ImageKit, Sentry, EAS) | Throttling or a paused project | Check at sign-up; resume paused projects |
| OpenStreetMap tile and search policies | Blocked at volume | Provider in Phase 8 |
| Edge function time limits | Long jobs cut off | Long work runs as Inngest steps |
| Inngest outage | Delayed jobs | Outbox + sweeper |
| Per-platform switches rely on a header | A user could fake their platform | Platform switches are operational; global switches apply to all |

## 11. Changelog

- **v4.16 (2026-10-20):** Decision: **GitHub only stores the code; Vercel runs every deploy.** The GitHub deploy workflow (`deploy-test.yml`) and the manual Inngest-sync workflow are removed. New `scripts/vercel-build.mjs` plus `vercel.json` (on `redesigned-2.0` only, so `main`'s builds are unchanged) make the `taskdrop` Vercel build apply new migrations, deploy the Edge Functions, run the Inngest sync and then build the web app; a failed backend step fails the build. The two secrets move from GitHub to Vercel environment variables (Preview, branch `redesigned-2.0`). The admin repo's types-drift job stays but is skipped (no token in GitHub); run `npm run db:types` before admin pull requests. Pull request checks (tests, type-check, SQL tests, CodeRabbit) stay on GitHub because Vercel cannot run the SQL tests; they deploy nothing and hold no secrets. Open: the first real run on Vercel needs a push, and the build's fetch of `main` for the two old-app checks is untested there (it warns and skips if it fails).
- **v4.15 (2026-10-20):** Phase 0, the domain work, done through Chrome with the owner's OK. `taskdrop.in` and `www` are connected to the Vercel project `taskdrop` on the `redesigned-2.0` branch, with the two DNS records added at Spaceship; both show Valid Configuration and `taskdrop.in` serves the redesigned app. `https://taskdrop.in/**` and `https://www.taskdrop.in/**` were added to Supabase's redirect URLs (old ones untouched), and `EXPO_PUBLIC_APP_URL=https://taskdrop.in` was set for Preview on `redesigned-2.0` only. **Decision: no `admin.taskdrop.in`;** the admin stays on its Vercel address, and its callbacks were already on the redirect list. The admin-domain boxes are deferred or done accordingly.
- **v4.14 (2026-10-20):** Phase 0, everything that can be built without you. **Decision changed: no `supabase db push`.** The cloud's migration history disagrees with the repo far beyond 101 to 108 (95 migrations under other version numbers, 11 rows without a file, 6 files without a row, those six being in the database under other names), so instead of rewriting about 100 history rows, `scripts/deploy-migrations.mjs` applies only files newer than the newest recorded version. Added: the old-app compatibility checks (`npm run test:contract` and `scripts/check-old-app-db.mjs`, in CI and before every deploy), the deploy workflow (`deploy-test.yml`), the fake-data seed and `npm run seed:reset`, `docs/DEPLOY.md`, the pull request template with the CodeRabbit rule, the `[auth]` redirect list and `scripts/add-redirect-urls.mjs`, env-driven `db:types`, the admin repo's types-drift CI job, updated `.env.example` files and a corrected secrets inventory. The database scripts use the `pg` driver (new dev dependency) because the owner's PC has no `psql`. Open: the boxes that need your accounts (GitHub secrets, Vercel and DNS, Maps key, keystore, lawyer, testers) and the Verify boxes that need a pushed pull request.
- **v4.13 (2026-10-20):** Phase 0, the boxes that don't need you. Branch protection on `main` and `redesigned-2.0` in both repos; EAS `beta` profile with channel `beta`; README rules and a "run against the cloud test project" section in both repos; `.coderabbit.yaml` for the admin repo (admin PR 18); `AGENTS.md` rule 4 changed from "local Docker stack first" to "the cloud project is the test environment". **Corrected:** migration 108 was already applied on the cloud (earlier entries said it wasn't). **Found, open:** migration version numbers for 101 to 108 differ between the repo and the cloud history, so `db push` is not safe yet. Also checked: DNS for `taskdrop.in` is not connected to Vercel yet, and the Vercel connector here has no access to your team, so the domain steps stay with you.
- **v4.12 (2026-10-20):** three owner decisions. (1) **Supabase is tested directly in the cloud**: the hosted project is the test environment, with no local Supabase or Docker (new ground rule 8; Docker, `supabase start` and the local Inngest dev server marked `[-]`; CI keeps its throwaway database for SQL tests only). (2) **`taskdrop.in` is bought on Spaceship.com**; DNS check the same day: still on Spaceship's default addresses, not connected to Vercel, no `admin` record; the connection steps are now in Phase 0. (3) **Work goes phase by phase** (new ground rule 9); the Progress board now shows ticked boxes per phase and what is blocked on you.
- **v4.11 (2026-10-20):** repo clean-up, merge and phone test. Both repos keep only `main` and `redesigned-2.0`, locally and on GitHub; Dependabot branches were deleted (it reopens them on its schedule, aimed at `main`). Everything outstanding was merged into `redesigned-2.0` by PR 38: migration 108 (account deletion also erases chat messages), native headers on the remaining pushed screens (the old PR 33), the legal drafts (`docs/LEGAL_AUDIT.md`, `docs/legal/`), the Support page, web file-drop upload and the Home/Explore polish. Checked on `redesigned-2.0`: typecheck, lint, 46 user-app and 85 admin unit tests, web and admin production builds, and an Android pass over USB in Expo Go (all five tabs, Earn mode, task detail, Messages, Help & support, Account & settings, Edit profile, Terms). **Correction (checked 2026-10-20):** migration 108 is already applied on the cloud test project; only its version number differs between the repo file (`20261019120000`) and the cloud history (`20261018110017`), see the new open box under Phase 0, Shared test project. **Not done:** the legal settings (`EXPO_PUBLIC_LEGAL_*`) and the lawyer review are still open, so Terms and Privacy show the draft banner; money flows, push notifications and the signed-in admin were not retested; iOS stays future scope.
- **v4.10 (2026-10-20):** scope decision. **iOS is future scope**: focus is web, Android and the admin app. Every iOS section is marked `[-]` (deferred); Sign in with Apple and the Apple Developer account wait with it; a phase is done when its boxes are ticked or deferred. New Part B section 12 lists what waits. No code removed.

- **v1–v2.2 (2026-10-07):**
  - first plan, then architecture, stack, environments and the admin control center
  - testing stage with fake data; built-in phone login; optional phone
  - Inngest dev server + Inngest Cloud; no EAS Hosting
  - sign-in = Google, Apple, phone, username + password
- **v3 (2026-10-07):** rethink.
  - "Make it work" phase, Playwright E2E, EAS Update, auto-deploy
  - the lawyer question and the domain moved early
  - sign-in moved before the admin views; `media` table
  - testing, secrets and owner-action sections
- **v4 (2026-10-07):** your requests, plus a rethink.
  - Part A is now **checkbox to-do lists for every phase**, split into Backend / Web / Android / iOS / Admin / You / Verify, with a progress board and a coverage table.
  - **Branch `upgraded-plan-changes`** created in both repos; old branches are never altered. Phase branches merge into it.
  - **CodeRabbit** reviews every pull request (`.coderabbit.yaml` with path rules; `base_branches` set for the upgrade branch).
  - **R5:** a separate free Supabase beta project, so the old app and its database keep working untouched; `taskdrop.in` and `admin.taskdrop.in` serve the upgrade.
  - **The first iOS TestFlight build moved from Phase 8 to Phase 1**, so every phase is checked on iPhone, not only at the end.
  - **iOS fixes moved to Phase 2.**
  - **New Phase 9, "Switch-over"**, moves testers to the upgraded app before any customer launch (now Phase 10).
- **v4.1 (2026-10-07):** your answers.
  - **R5 not chosen:** the old app and the upgrade **share** the Supabase project `wjxvingpfbfvkfqhrguj` until Phase 9. Added ground rule 4 (backend changes stay compatible), a CI compatibility check, a CodeRabbit rule and an old-app check before backend deploys.
  - **Lockdown moved from Phase 3 to Phase 9**, because the old admin calls the database directly.
  - **Old phone login and synthetic emails kept until Phase 9**, so the old app keeps signing in.
  - **Maps key:** restrict it now, delete it in Phase 9.
  - **R1 (EAS Update) and R2 (auto-deploy) confirmed.**
  - **Push to GitHub:** not yet; the branch is on your PC only.
- **v4.9 (2026-10-19):** "implement it" (Phase 6, ImageKit). Built on branch `phase-6-imagekit`, branched from `inngest-all-jobs` because the clean-up jobs use that branch's Inngest setup and migration numbers. Migration 106 adds `public.media` and its functions (`media_begin`, `media_attach`, `media_resolve`, `media_discard`; server-only `media_expire_pending`, `media_account_deleted`, `media_purge_batch`, `media_mark_purged`) and extends the read rule to `media:<id>`. The api function gets `attachMedia`, ImageKit-aware `createUpload` and `signMedia`, and checks every saved reference is the caller's own; the `inngest` function gets `media-purge` and a new step in `account-files`; the app uploads pictures to ImageKit and shows them with expo-image at the right size. Without the ImageKit secrets everything falls back to Supabase Storage exactly as before. Decisions: only pictures use `media:<id>`; videos and documents keep their storage paths. **Not done:** the migration is unapplied and untested against a database (no Docker here; it parses and the SQL test is written); nothing deployed; device tests (HEIC, camera, Android, web), drag-and-drop upload and virtualised lists are open; the user app has no CSP to update yet. See `docs/MEDIA.md`.
- **v4.9 (2026-10-19):** "Make sure delete account works; delete all user data, chat messages included." The button, the two-step check (blockers, then a confirm dialog) and the server deletion (087) already worked. Owner decision: chat messages are erased too; only money and legal records stay. Migration 108 (tested in a rolled-back transaction, then **applied to the hosted test project**: its history shows `108_account_deletion_erases_more` at version 20261018110017, and the live `private.delete_account` deletes messages, CRM leads and referrals; checked 2026-10-20) makes `delete_account()` also delete the person's chat messages, the chats of their unpaid requests (and empty those requests, open or cancelled), device records, referrals, blocks and CRM leads/owners/follow-ups. Test: `supabase/tests/account_deletion.test.sql`. The Account card, the confirm dialog and the Privacy Policy no longer say messages stay.
- **v4.7 (2026-10-18):** "Have the Inngest events and functions for users: created, updated, deleted, in sync with Supabase." Migration 103 adds `public.user_sync` (one row per person: state, counts, field names; no names or contact details), the new `user.updated` event (from profile edits and sign-in email or phone changes, field names only, only after the age check), a `user.deleted` event for accounts removed from auth outright, and `user_sync_apply` / `user_sync_repair`. Inngest functions `user-created`, `user-updated`, `user-deleted` (one person at a time) and a nightly `user-sync-repair`. Applied, deployed (function v4) and synced on the hosted test project; tested with a rolled-back SQL run and a live run through Inngest Cloud (sign-up, profile edit, email change, heartbeat ignored, self-delete, removal from auth). `user.signed_up` stays the "created" event on purpose: it fires after the age check.
- **v4.8 (2026-10-18):** "Develop Inngest jobs wherever necessary, finish the Inngest setup, act on CodeRabbit." Migration 104 (CodeRabbit's open suggestions): the admin live feed hides a task title that holds a phone number (8+ digits) or an email; the four task-access helpers are no longer executable by signed-out visitors (PUBLIC revoked too); one payment per Razorpay payment link (unique partial index, no duplicates existed); the live feed's clean-up leaves the insert trigger and joins `housekeeping` (rows nobody else holds, 5,000 a run). Not changed, with reasons: `confirm_release` wallet guard (every profile gets a wallet at sign-up and none is missing). Migration 105 adds two Inngest jobs: `outbox-watchdog` (every 10 min; one team alert if events sit unsent for 15+ minutes) and `task-reminders` (every 15 min; poster told finished work is approved for them within 24 hours, worker told a job is due within the hour; once each). Setup: Inngest variables in `.env.example`, a Deno type-check job in CI, a manual "Inngest sync" workflow, Dependabot no longer proposes Expo/React Native major bumps (the app is on SDK 57), the audit-gate test helper keeps both advisories of one package. Applied, deployed (function v5) and synced on the hosted test project; SQL tests run rolled back. Payouts, refund retries and webhook hand-off still wait for R3.
- **v4.9 (2026-10-18):** CodeRabbit's review of PR 28, acted on. Migration 106: an assigned worker keeps sight of a job a moderator hid; an overlong app version can no longer switch every control off (6 digits per part, in SQL and TypeScript; migration 107 applies the same limit to the minimum version an admin saves); `user_sync_apply` refuses a null event; `escrow_refund_due` applies the Sales money block only to other people's tasks; daily business numbers and the money check date finished jobs by `completed_at`. Also: `Vary` header on `app-config`, a network error or 10 s timeout on one Razorpay lookup is no longer a failed night, the Report sheet says "blocked" only when the block worked, CI and sync workflows get least-privilege tokens (Deno action pinned to a commit, the sync URL fixed), weak SQL assertions that could not fail now use `is distinct from`, staff email removed from HANDOFF. Not changed, with reasons: migration 102 keeps its drops (the owner ordered all n8n changes removed); the stage-pipeline query rewrite (test-sized data, revisit before launch); phone sign-in does not yet set `phone_confirmed_at` (the "require verified phone" switch is off; noted at the switch above, fix before turning it on).
- **v4.6 (2026-10-18):** "Remove all n8n related changes". Migration 102 drops the last leftovers (`private.automation_log`, `private.automation_config`, `private.send_daily_digest()`, the log-prune cron job); applied on the hosted test project after checking nothing else referenced them (the old app and admin never used them). `supabase/cutover/phase9_drop_n8n.sql` is deleted. The older migrations (080, 082, 087, 090) stay as applied; they are history.
- **v4.5 (2026-10-18):** "I want Inngest to manage all my background jobs". Scope chosen: everything except the payout, webhook and refund jobs, which wait for the lawyer's answer on the money flow (R3).
  - **Built (migration 101, `inngest` function, not applied or deployed):** `push-notification` (event `notification.created`: Expo send, receipts after 15 minutes, dead devices removed), `account-files` (event `user.deleted`: leftover storage files removed with retries), `overdue-tasks` (every 10 minutes: a started job past `due_at` becomes OVERDUE, no money moves), `housekeeping` (hourly: replaces the two pg_cron prunes and adds `auth_codes`, `auth_send_log`, `places_quota`, notifications older than 90 days).
  - **Push has a switch.** The trigger still sends directly from the database until the settings row `push_via_inngest` is `true`, so phones keep buzzing while Inngest is set up. `supabase/cutover/inngest_background_jobs.sql` flips it and unschedules the two old prune jobs; one line puts it back.
  - **Events carry no text:** `notification.created` holds ids and the kind only; the title and body are read by the Edge Function and never stored by Inngest. Device tokens are matched back by a one-way key.
  - **Still on Postgres or the old path, waiting for R3:** withdrawal payouts with retries, stuck-payout reconciliation, refund retries, webhook hand-off. The three money sweeps stay on pg_cron until `INNGEST_MONEY_JOBS=on` and their own cutover.
- **v4.4 (2026-10-13):** Phase 5 started ("implement it and remove n8n, use Inngest").
  - **Architecture: Postgres owns the rules and the money; Inngest owns schedules, retries and outside calls.** The bridge is an outbox (migration 090): `emit_event` writes `private.outbox` in the same transaction, pg_net pushes it straight away, and an Inngest cron re-sends anything unconfirmed. The outbox id is the Inngest event id, so duplicates are dropped.
  - **n8n is removed**: its triggers, cron jobs, `private.automation_*` tables, `docs/N8N.md` and the privacy-policy line. (Ground rule 2 says "never drop"; these were private n8n-only objects the old app and admin never touched.)
  - **Built:** the `inngest` Edge Function (outbox sweeper and prune, team alerts into the new `admin_alerts` table, 9:00 IST digest, Sentry on final failure) and the three money sweeps, which stay OFF (`INNGEST_MONEY_JOBS`) while pg_cron keeps running them. `supabase/cutover/inngest_money_jobs.sql` switches pg_cron off once Inngest is verified live. See `docs/INNGEST.md`.
  - **Not live until you act:** create the Inngest Cloud account, set `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY`, add the `inngest_event_url` Vault secret, and say when to apply migration 090 and deploy.
  - **Still to move, one at a time:** push, withdrawal payouts, reconciliation, refund retries, account-deletion file cleanup, overdue-tasks cron, webhook hand-off, missing prunes. No new pg_cron jobs meanwhile.
- **v4.3 (2026-10-12):** background jobs and code review.
  - **n8n is not used for any background job.** Inngest is the only tool for scheduled and retried work. Nothing new goes into n8n or pg_cron. The existing pg_cron jobs and the `n8n-*` hooks keep running (they only write to a log, because no n8n address is set) until Phase 5 replaces them; the n8n triggers, config and `automation_*` tables are then removed.
  - Phase 5 is still "Not started": no Inngest code until you say "start Phase 5".
  - **CodeRabbit:** `.coderabbit.yaml` added on `redesigned-2.0` with `base_branches: ^redesigned-2.0$` and the path rules above, because CodeRabbit only auto-reviews the default branch (`main`) unless told otherwise. Pull request #12 had been skipped for that reason.
- **v4.2 (2026-10-12):** your branch decision.
  - **`redesigned-2.0` replaces `upgraded-plan-changes`** in both repos. Everything is merged and tested there (Vercel preview); you promote it to `main` by hand. Only `main` and `redesigned-2.0` stay on GitHub; phase branches are deleted once merged.
  - The Redesign v2 work (was `taskdrop-redesigned`), the staff-roles migration 089 and the Phase 1 Sentry work all live on `redesigned-2.0`.

## 12. Future scope: iOS

Decided 2026-10-20: focus is web, Android and the admin app. Everything below is kept, marked `[-]` in Part A, and picked up when you say "start iOS".

| Phase | What waits |
|---|---|
| 0 | Apple Developer Program enrollment ($99/year) |
| 1 | `app.json` iOS block, `eas.json` iOS `beta` profile, App Store Connect record + APNs key, first TestFlight build, iPhone testers |
| 2 | Swipe-back, UPI links, Keychain session clean-up, core-flow checklist on TestFlight |
| 3 | iOS control-screen checks; iOS-only posting switch test (the switch itself stays in app controls) |
| 4 | Sign in with Apple (Apple Developer IDs/keys, Supabase Apple provider, native `expo-apple-authentication`, token revocation on account deletion) |
| 5 | Push through Inngest on iPhone |
| 6 | Camera/library uploads, HEIC, image speed on iPhone |
| 7 | Report/block on TestFlight (Apple guideline 1.2); "iOS only" broadcast test |
| 8 | App Store listing, reviewer demo login, `submit.ios`, Apple sign-in and promotion-switch readiness |
| 9 | TestFlight tester move |
| 10 | App Store submission and release |

**Why it can wait:** the app is one Expo codebase, so iOS reuses the same screens; most of the cost is accounts, store setup and device testing. App controls already has an iOS platform switch, so nothing needs undoing later.

**When iOS starts:** enroll first (approval takes days), then re-read the iOS sections of Phases 0 to 10 and turn `[-]` back into `[ ]`.
