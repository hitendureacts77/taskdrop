# TaskDrop upgrade plan

Version 4, 2026-10-07. The single source of truth for the upgrade. Part A is the to-do list, phase by phase; Part B is the reference (architecture, decisions, testing, costs, risks).

## How to use this file

- `- [ ]` is open, `- [x]` is done. Tick items as they're completed, in the same pull request as the work.
- **(You)** marks the items only you can do: accounts, payments, approvals, testing with real people.
- Every phase has to-dos for each part of TaskDrop:

| Part | What it means |
|---|---|
| **Backend** | Supabase: database, SQL, edge functions, Inngest functions |
| **Web** | The user app in a browser (`taskdrop.in`) |
| **Android** | The user app on Android phones |
| **iOS** | The user app on iPhones |
| **Admin** | The admin web app (`admin.taskdrop.in`) |

  A phase is done when every box, including its **Verify** boxes, is ticked.
- **Nothing is implemented until you say "start Phase N".**

## Ground rules

1. **Old code is never altered.** The existing branches stay exactly as they are:
   - user repo: `feature/first-push`, `master`, `claude/modest-albattani-3odt95`
   - admin repo: `main`
2. **All upgrade work happens on `upgraded-plan-changes`**, in both repos.
   - Each phase gets a short branch, such as `upgrade/phase-1-sentry`, cut from `upgraded-plan-changes`.
   - It merges back through a pull request, after CI and a **CodeRabbit** review.
3. **The old app keeps running for your testers**, on its current URLs and its current Supabase project, until the switch-over (Phase 9).
4. **The app asks, the server decides.** Money, permissions, limits, prices and switches are always checked on the server.
5. **Stage: testing only.** Fake data, you and about 10 testers, no customers. Customer launch (Phase 10) happens only when you decide.

---

# Part A: To-do list

## Progress board

| Phase | Name | Status |
|---|---|---|
| 0 | Foundations | In progress |
| 1 | See problems, ship fast | Not started |
| 2 | Make it work (stabilize) | Not started |
| 3 | Server decides everything | Not started |
| 4 | Accounts and sign-in | Not started |
| 5 | Background jobs (Inngest) | Not started |
| 6 | Speed and media (ImageKit) | Not started |
| 7 | Moderation and admin tools | Not started |
| 8 | Store readiness | Not started |
| 9 | Switch-over to the upgraded app | Not started |
| 10 | Customer launch (later, when you decide) | Not started |

## Coverage: what each phase changes

| Phase | Backend | Web | Android | iOS | Admin |
|---|---|---|---|---|---|
| 0 | Beta project, CI, auto-deploy, seed | `taskdrop.in` on the upgrade | Beta build profile | Apple Developer enrollment | `admin.taskdrop.in`, CI |
| 1 | Sentry in functions, health check | Sentry | Sentry, OTA updates, push fix | First TestFlight build, push | Sentry |
| 2 | Bug fixes, slow queries | E2E tests, fixes | Fixes | iOS fixes | Every page checked |
| 3 | Server rules, app controls, lockdown | No key in bundle, security headers | Control screens | Control screens | App controls page, gateway header |
| 4 | Phone auth, Apple, linking | Google/Apple browser sign-in | Google/Apple/phone | Native Apple sign-in | Sign-in methods, devices |
| 5 | Inngest, outbox, webhooks | In-app notifications | Push via Inngest | Push via Inngest | Queued payouts, alerts |
| 6 | `media` table, ImageKit signing | Uploads, images, CSP | Camera uploads, images | Camera/HEIC uploads, images | Images via signing |
| 7 | Reports, blocks, admin actions | Report/block | Report/block | Report/block | Reports queue, actions, runbook |
| 8 | — | Privacy and support pages | Play closed test | App Store review prep | Ready for reviewers |
| 9 | Beta becomes main | Domains confirmed | Testers move | Testers move | Admin moves |
| 10 | Production project | Production | Play release | App Store release | Production |

---

## Phase 0: Foundations

**Repos and branches**
- [x] This plan written as one file with to-dos for every phase
- [x] Branch `upgraded-plan-changes` created in the user repo from the newest work (commit 3d4bd72)
- [x] Branch `upgraded-plan-changes` created in the admin repo from `main`
- [ ] Push `upgraded-plan-changes` to GitHub in both repos **(You: approve the push)**
- [ ] Protect the old branches on GitHub so nothing merges into them by accident
- [ ] Rule written into the README: phase branches `upgrade/phase-N-<name>` → pull request into `upgraded-plan-changes`

**AI code review (CodeRabbit)**
- [ ] **(You)** Sign up at coderabbit.ai with GitHub and install the CodeRabbit app on both repos. If they're private: a 14-day trial, then $24/developer/month billed annually; public repos are free.
- [ ] Turn on auto-review for pull requests into `upgraded-plan-changes`
  - It isn't the default branch, so it must be listed under `reviews.auto_review.base_branches` (`^upgraded-plan-changes$`), and check at setup that the setting takes effect.
- [ ] Add `.coderabbit.yaml` on `upgraded-plan-changes`, with path instructions:
  - `supabase/migrations/**`: RLS on every table, `security definer` functions set `search_path`, money changes are atomic, no grants to `anon`
  - `supabase/functions/**`: caller identity checked, no secrets logged, webhooks verified and idempotent, errors reported to Sentry
  - `apps/mobile/**`: no secrets, no business decisions in the app, platform differences handled for web/Android/iOS
  - `taskdrop-admin` `src/**`: `requireAdmin` on every action, MFA gate on money actions, audit-log writes
- [ ] Rule: every CodeRabbit comment is fixed or answered before merging

**CI (GitHub Actions), on every pull request into `upgraded-plan-changes`**
- [ ] User repo: typecheck, `npm test`, `api` function tests, SQL tests against a local Supabase started in CI
- [ ] Admin repo: typecheck, build, and database types generated from Supabase, so they can't drift

**Hosted beta environment (R5)**
- [ ] **(You)** Create a second free Supabase project, `taskdrop-beta`
- [ ] Apply all migrations to it, load the fake-data seed, set its secrets, deploy all functions
- [ ] Auto-deploy on merge into `upgraded-plan-changes` (R2): migrations (`supabase db push`), functions, then the Inngest sync once it exists
- [ ] The old project `wjxvingpfbfvkfqhrguj` gets no upgrade changes

**Local development (your PC)**
- [ ] **(You)** Install Docker Desktop (with WSL 2)
- [ ] `supabase start` and `supabase functions serve`, using a git-ignored `supabase/functions/.env.local` with test keys
- [ ] One command resets the local database to the fake-data seed:
  - poster, worker and admin accounts
  - test phones with fixed codes
  - tasks in every status
  - wallets with fake credits

  The same command can reset the beta project, never production.
- [ ] README section: "Run TaskDrop locally"

**Config in code**
- [ ] Supabase auth settings in `supabase/config.toml`
- [ ] Project ids and keys as env vars; `.env.example` files updated
- [ ] Secrets inventory (Part B, section 7) checked against reality

**Web**
- [ ] **(You)** Buy `taskdrop.in` (Part B, section 8)
- [ ] Vercel project `taskdrop`: assign `taskdrop.in` + `www` to the `upgraded-plan-changes` branch, with that branch's env vars pointing at the beta project
- [ ] Beta project: site URL and redirect URLs for `taskdrop.in`; `EXPO_PUBLIC_APP_URL=https://taskdrop.in` on the upgrade branch
- [ ] **(You)** `support@taskdrop.in` via free email forwarding

**Android**
- [ ] EAS build profile `beta` (Android APK), pointing at the beta project, with EAS Update channel `beta`. The first build happens in Phase 1.
- [ ] **(You)** Restrict the Google Maps key to package `com.taskdrop.app` + signing SHA-1
- [ ] **(You)** Back up the EAS keystore (`eas credentials`)

**iOS**
- [ ] **(You)** Enroll in the Apple Developer Program, $99/year. Approval can take days, and the first TestFlight build in Phase 1 needs it.

**Admin**
- [ ] Vercel admin project: assign `admin.taskdrop.in` to the `upgraded-plan-changes` branch, with env vars pointing at the beta project
- [ ] Beta project redirect URL: `https://admin.taskdrop.in/auth/callback`
- [ ] Admin `.env.example` and README updated for local and beta

**You (other)**
- [ ] Ask a lawyer about the money flow (R3; questions in Part B, section 10). The answer is needed before Phase 5.
- [ ] Recruit at least 12 testers. Google Play requires a closed test with at least 12 testers before a production release.

**Verify**
- [ ] A test pull request into `upgraded-plan-changes` runs CI and gets a CodeRabbit review
- [ ] Merging deploys to the beta project
- [ ] `taskdrop.in` and `admin.taskdrop.in` load the upgrade branch against the beta project
- [ ] The whole app (web in a browser, Android over Wi-Fi, admin) runs on your PC against the local stack
- [ ] **The old app still works unchanged**, at its current URLs and on its current database

---

## Phase 1: See problems, ship fast

**Backend**
- [ ] `_shared/monitoring.ts` used in every function: `razorpay`, both webhooks, `razorpayx-payouts`, `phone-auth`, `password-auth`, `places-search`
- [ ] Parsed stack frames
- [ ] Unexpected database errors reported
- [ ] "PAYOUT MADE BUT NOT RECORDED" and "REFUND SENT BUT NOT RECORDED" sent as fatal
- [ ] A `health` op on `api` for uptime checks

**User app (all platforms)**
- [ ] `@sentry/react-native` replaces `apps/mobile/src/lib/monitoring.ts`; pick the version that matches Expo SDK 57
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
- [ ] `app.json` → `ios`:
  - `bundleIdentifier: com.taskdrop.app`, `buildNumber`, `supportsTablet: false`
  - permission texts for location (when in use), camera, photos and microphone
  - `ITSAppUsesNonExemptEncryption: false`
  - `LSApplicationQueriesSchemes` for the UPI apps
  - drop the "Always" location permission
- [ ] `eas.json`: iOS `beta` profile; `build:ios` script
- [ ] **(You)** App Store Connect app record. APNs key added through EAS.
- [ ] First TestFlight internal build (Sentry, `expo-updates`, push)
- [ ] **(You)** Add iPhone testers to TestFlight internal testing

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
- [ ] Playwright end-to-end tests on the web build against the local stack, run in CI:
  - sign-in with a test phone
  - the wallet-funded money path: post → bid → lock → fund → start → proof → done → confirm → review → withdraw request
  - cancel with a fine
  - dispute
- [ ] The core-flow checklist (Part B, 5.2) passes in Chrome and Safari, on desktop and phone sizes

**Android**
- [ ] The core-flow checklist passes on the `beta` APK; failures are fixed

**iOS**
- [ ] Swipe-back navigation (`NavProvider.tsx`)
- [ ] UPI payment links (`PaymentSheet.tsx`)
- [ ] Clear the stored session on first launch after a reinstall (the Keychain keeps it)
- [ ] The core-flow checklist passes on TestFlight; failures are fixed

**Admin**
- [ ] Every admin page works against the beta project: users, tasks, payouts, refunds, disputes, support, CRM, copyright, money, reports, settings, security
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
  - [ ] `app_controls` table and a public `app-config` function, cached about 60 s
  - [ ] Switches, each per platform (web / Android / iOS):
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
    - "require verified phone" (off)
  - [ ] An announcement banner (text, link, platforms, end date)
  - [ ] `api` enforces every switch, using the `x-taskdrop-platform` and `x-taskdrop-app-version` headers
  - [ ] Every change is written to `admin_audit_log`
- [ ] Lockdown on the beta project, after the admin step below: run `supabase/lockdown/gateway_only.sql`

**User app (all platforms)**
- [ ] Platform and app-version headers sent on every `api` call
- [ ] The app reads `app-config` at start-up and on the realtime ping
- [ ] Maintenance screen, "Update the app" screen, announcement banner, and a message when a switch is off
- [ ] Fee previews come from the `platformFees` op
- [ ] Address search goes through `places-search`

**Web**
- [ ] `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` removed from the web build
- [ ] `vercel.json`: SPA rewrites and security headers (CSP, HSTS, frame-ancestors, referrer policy)

**Android**
- [ ] The native map keeps only the restricted Android key
- [ ] Control screens checked on the APK

**iOS**
- [ ] Control screens checked on TestFlight. The iOS map is Apple Maps, so no key is needed.

**Admin**
- [ ] New **App controls** page: every switch per platform, minimum versions, maintenance, banner
- [ ] Before the lockdown:
  - [ ] Set `API_GATEWAY_SECRET` in the admin env
  - [ ] Send the `x-taskdrop-gateway` header from the admin's Supabase server client
  - [ ] Redeploy
- [ ] Raise the minimum app version, so testers update before the lockdown

**Verify**
- [ ] The web bundle contains no Google key
- [ ] A bid containing a phone number sent straight to the API is rejected
- [ ] Posting switched off for iOS only: refused on iPhone, even by direct API call; still works on web and Android
- [ ] Maintenance mode for Android only shows the screen on Android only
- [ ] An older build sees "Update the app" on Android and iOS
- [ ] After the lockdown:
  - [ ] A direct database call with the public key + a user token is refused
  - [ ] Web, Android, iOS, admin and the E2E tests still work

---

## Phase 4: Accounts and sign-in

**Backend**
- [ ] **(You)** In Apple Developer: App ID with Sign in with Apple, a Services ID and a Sign in with Apple key
- [ ] Enable Apple in Supabase Auth (beta project), with redirect URLs (`taskdrop://auth-callback`, `https://taskdrop.in`, localhost)
- [ ] Phone login moves to Supabase's built-in phone auth, with a Send-SMS hook calling MSG91
- [ ] Every existing protection kept:
  - throttles
  - birth date before the first code
  - admin numbers refused
  - test numbers with fixed codes
- [ ] Test users migrated: the phone copied from each synthetic email into `auth.users.phone`
- [ ] `task_contact_phone`, `verificationState` and the admin SMS block updated; the synthetic-email code retired
- [ ] `password-auth` keeps username + password working, looking up the username and signing in with the account's phone or email
- [ ] `handle_new_user` takes names from Google/Apple
- [ ] Manual identity linking enabled
- [ ] Account deletion revokes the Apple token for Apple users (App Store rule; check Apple's current rules when building)

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
- [ ] Apple sign-in native: `expo-apple-authentication` → `signInWithIdToken` with an `expo-crypto` nonce; `usesAppleSignIn: true`
- [ ] Google sign-in through the browser flow; phone; username + password

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
  | iOS | [ ] | [ ] | [ ] | [ ] |
- [ ] Existing test users still sign in with their phone
- [ ] Linking a second method works; no duplicate accounts
- [ ] Deleting an Apple account revokes its token

---

## Phase 5: Background jobs (Inngest)

Before starting: the lawyer's answer on the money flow (R3). If Razorpay Route is advised, the payout items are built for Route.

**Backend: setup**
- [ ] Edge function `supabase/functions/inngest/` using `serve` from `inngest/edge`, `servePath: "/functions/v1/inngest"`, `verify_jwt = false`
- [ ] Your PC:
  - run `npx inngest-cli@latest dev -u http://127.0.0.1:54321/functions/v1/inngest` (UI at `localhost:8288`)
  - functions run with `INNGEST_DEV=1`
  - the local database sends events to `host.docker.internal:8288`
- [ ] **(You)** Create an Inngest Cloud free account
  - [ ] Set `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` on the beta project
  - [ ] CI syncs the app URL on deploy
- [ ] The Inngest event address and key live in Vault, so one migration works locally and on beta

**Backend: events out of the database**
- [ ] `private.emit_event` writes to a new `private.outbox` in the same transaction
- [ ] Fast path: pg_net posts each outbox event to Inngest immediately
- [ ] Safety net: a one-minute sweeper re-sends anything unconfirmed. The outbox id is the event id, so duplicates are dropped.

**Backend: move the work** (the old job is removed in the same deploy as its replacement)
- [ ] `auto-complete-due` → Inngest cron
- [ ] `settle-cleared-earnings` → hourly Inngest cron
- [ ] `settle-finished-campaigns` → Inngest cron
- [ ] `n8n-daily-digest` → Inngest cron
- [ ] Push (pg_net trigger) → `notification.created`: send the Expo push, read receipts, remove dead tokens
- [ ] Withdrawal → `withdrawal.requested`: payout with retries and an idempotency key, one at a time per user. `requestWithdrawal` returns immediately.
- [ ] Stuck payouts → reconciliation every 15 minutes
- [ ] Refund "sent but not recorded" → retrying function + Sentry fatal
- [ ] Account deletion → `user.deleted`: delete storage files with retries (ImageKit added in Phase 6)
- [ ] New: an overdue-tasks cron (`OVERDUE` from `due_at`)
- [ ] n8n alerts (support, dispute, payout failed) → admin in-app notifications + Sentry

**Backend: webhooks**
- [ ] `razorpay-webhook` and `razorpayx-webhook`:
  - [ ] verify the signature
  - [ ] record the event id in `webhook_events`
  - [ ] send an Inngest event
  - [ ] return 200 immediately
- [ ] Tested locally with sample signed payloads, and on beta with Razorpay test mode

**Backend: housekeeping and n8n**
- [ ] Missing prunes added in pg_cron: `auth_codes`, `auth_send_log`, `places_quota`, old notifications, sent outbox rows
- [ ] Every Inngest function reports its final failure to Sentry
- [ ] n8n removed: triggers, config, `automation_*` tables

**Web**
- [ ] In-app notifications and the realtime pings still arrive (the web has no push)

**Android**
- [ ] Push for every notification type arrives through Inngest
- [ ] Tapping a push opens the right screen

**iOS**
- [ ] Push for every notification type arrives through Inngest
- [ ] Tapping a push opens the right screen

**Admin**
- [ ] Payout queue shows the "queued" state
- [ ] New admin alerts view
- [ ] `check-all`, `give-back` and `balance` still work

**Verify**
- [ ] Every function runs in the dev server, then in Inngest Cloud for beta
- [ ] A forced failure (bad push token, RazorpayX test error) retries, then succeeds or lands in Sentry
- [ ] A withdrawal request returns in under 1 second on web, Android and iOS
- [ ] No old pg_cron job or n8n hook still does the same work

---

## Phase 6: Speed and media (ImageKit)

**Backend**
- [ ] **(You)** Create an ImageKit account. Folders: `/local`, `/beta`, later `/prod`.
- [ ] New `media` table (R4):
  - `id`, `owner`, `provider` (imagekit | supabase), `provider_file_id`, `path`
  - `purpose` (task | avatar | proof | chat), `kind`, `bytes`
  - `status` (pending → attached → hidden → deleted), `created_at`
- [ ] New uploads referenced as `media:<id>` in `tasks.media_path`, `profiles.avatar_url`, `task_proofs.files` and chat messages; old values still readable
- [ ] `createUpload` (`api/media.ts`) for images returns ImageKit params signed on the server:
  - token, expiry and HMAC-SHA1 signature
  - public key
  - folder `/<env>/u/<uid>/`
  - allowed types and max size
- [ ] Videos and documents keep Supabase signed uploads, also recorded in `media`
- [ ] Attach: the server checks through the ImageKit API that the file exists in the caller's folder, then marks it attached
- [ ] `signMedia`:
  - applies `private.can_read_task_media` plus chat participants
  - returns signed URLs at thumb, card and full sizes, auto WebP/AVIF
  - rounds expiry to the hour, so URLs can be cached
- [ ] Inngest: pending media older than 24 h deleted; account deletion and takedowns act through `media.status`, and ImageKit files are deleted with retries

**User app (all platforms)**
- [ ] `apps/mobile/src/lib/media.ts` uploads images to ImageKit
- [ ] Each screen requests the right size
- [ ] `expo-image` renders images, with a disk cache
- [ ] Slow long lists move to a virtualised list

**Web**
- [ ] CSP allows ImageKit (uploads and CDN)
- [ ] Upload from file picker and drag-and-drop works

**Android**
- [ ] Camera and gallery uploads work
- [ ] Images load fast on mobile data

**iOS**
- [ ] Camera and library uploads work, including HEIC photos (check ImageKit converts them)
- [ ] Images load fast

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
- [ ] Report and block work on TestFlight. Apple requires this (guideline 1.2).

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
- [ ] A broadcast to "iOS only" reaches only iPhones
- [ ] Every action is in the audit log

---

## Phase 8: Store readiness

**Web**
- [ ] Privacy policy, terms and support pages live on `taskdrop.in`, needed by both stores
- [ ] Map tiles (`MapPicker`) and the fallback search use a provider's free tier, or the volume is confirmed low. OpenStreetMap's public servers don't allow heavy commercial use.

**Android**
- [ ] **(You)** Google Play Console app ($25 one-time, if not paid), store listing, screenshots, data-safety form
- [ ] EAS `production`-style Android build (AAB) for the closed test
- [ ] **(You)** Closed test with at least 12 testers for 14 days (required before a production release)

**iOS**
- [ ] **(You)** App Store listing: screenshots, privacy labels, support and privacy URLs
- [ ] Reviewer demo login (a test phone with a fixed code), plus review notes
- [ ] Before review:
  - [ ] Apple sign-in works
  - [ ] report and block are live
  - [ ] account deletion works
  - [ ] the iOS promotion switch is ready
- [ ] `submit.ios` in `eas.json`

**Admin**
- [ ] Ready to handle reviewer reports within 24 hours; runbook checked

**Verify**
- [ ] On the Play closed test and on TestFlight: post → bid → pay → complete → withdraw works
- [ ] Apple sign-in works on iPhone
- [ ] Push arrives on both platforms
- [ ] An EAS Update installs on both

---

## Phase 9: Switch-over to the upgraded app

- [ ] Phases 0–8 done; the last tester round has no open serious issues
- [ ] **(You)** Approve the switch-over
- [ ] **Backend:** the beta project becomes the main test environment. The old project `wjxvingpfbfvkfqhrguj` is paused, not deleted, and kept for reference.
- [ ] **Repos:**
  - [ ] Create `main` from `upgraded-plan-changes` and make it the default branch
  - [ ] The old branches stay exactly as they are
  - [ ] CodeRabbit config moves to `main`
- [ ] **Web:** `taskdrop.in` follows `main`; the old Vercel URLs retire
- [ ] **Admin:** `admin.taskdrop.in` follows `main`
- [ ] **Android:** testers install the upgraded build; the old APK retires
- [ ] **iOS:** TestFlight continues on `main`

**Verify**
- [ ] Every tester is on the upgraded app on web, Android and iOS
- [ ] Admin works on `admin.taskdrop.in`
- [ ] The old branches are unchanged

---

## Phase 10: Customer launch (later, when you decide)

- [ ] **(You)** Decide to launch; confirm recommendations A and D
- [ ] **Backend:**
  - [ ] Production Supabase project on Pro ($25/month, backups); migrations from `main`, secrets from the inventory, functions deployed
  - [ ] Auth providers on, with production redirects
  - [ ] Lockdown run (same steps as Phase 3)
  - [ ] Inngest production environment, ImageKit `/prod`, Sentry production
  - [ ] Production deploys need your approval in CI
- [ ] **(You)** Razorpay and RazorpayX live keys (business KYC + current account); MSG91 DLT templates
- [ ] **Web:** production on `taskdrop.in`; the beta moves to `beta.taskdrop.in`; Vercel Pro ($20/month)
- [ ] **Admin:** production on `admin.taskdrop.in`; beta admin on `beta-admin.taskdrop.in`
- [ ] **Android:** Play production release
- [ ] **iOS:** App Store submission and release
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
9. **Three platforms:** web, Android and iOS all tested in every phase.
10. **Customers:** a customer launch when you decide.

## 2. Decisions

### Made by you

| Topic | Decision |
|---|---|
| Codebase | Evolve the existing code; same features |
| Branch | All upgrade work on **`upgraded-plan-changes`**; old code never altered |
| Code review | **CodeRabbit** AI review on every pull request, plus CI |
| Stage | Testing only: fake data, you + ~10 testers, no customers |
| Platforms | User app on web + Android + iOS (one Expo app); admin as a separate web app |
| Sign-in | Google, Apple, phone OTP, username + password. No separate email sign-in. Admin login unchanged |
| Phone login | Supabase's built-in phone login with a Send-SMS hook to MSG91 |
| Phone number | Optional; the "require verified phone" switch is off |
| Payments | Existing Razorpay escrow + RazorpayX payouts, audited not rewritten |
| Promotion on iOS | Razorpay, with a per-platform switch to hide it on iOS if Apple objects |
| Media | Images to ImageKit; videos and documents stay in Supabase Storage |
| Background jobs | Inngest replaces n8n. Dev server on your PC; Inngest Cloud free plan for the hosted beta |
| Expo / EAS | No EAS Hosting (web is on Vercel); EAS for app builds |
| Hosting now | Free plans (Vercel Hobby, Supabase free) while testing |
| Admin control | The admin controls web, Android and iOS, enforced on the server |

### Recommendations

| # | Recommendation | Why | Status |
|---|---|---|---|
| R1 | **EAS Update** for testers (over-the-air updates, not EAS Hosting) | App changes reach installed Android/iOS apps without rebuilding or reinstalling | **Confirm** |
| R2 | **Auto-deploy** to the hosted beta on merge into `upgraded-plan-changes` | Testers always run the latest upgrade; nothing to forget | **Confirm** |
| R3 | **Ask a lawyer about the money flow now** | If the wallet or escrow needs a different setup (e.g. Razorpay Route), Phase 5 must be built that way | Your action, Phase 0 |
| R4 | A **`media` table** for every uploaded file | Moderation, takedowns, deletion and cleanup need it | Phase 6 |
| R5 | A **second free Supabase project (`taskdrop-beta`)** for the upgrade | Upgrade migrations never touch the database the old app uses, so the old app keeps working | **Confirm** |
| A | At customer launch: a new **production** project on Supabase Pro ($25/month); the beta becomes staging | Clean production, safe staging | Deferred to Phase 10 |
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
 │ SUPABASE (beta project now; staging + production at customer launch)        │
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
 (Android) / APNs (iOS) · EAS Build + EAS Update · Vercel · GitHub Actions ·
 CodeRabbit · Uptime Robot.
```

### 3.2 What runs where

| Code | Runs on | Visible to users? |
|---|---|---|
| Expo app screens and formatting | Browser / Android / iPhone | **Yes.** Any app bundle can be read, so it holds no secrets and no authority |
| Edge functions (`api`, `app-config`, auth, payments, `inngest`…) | Supabase servers | No |
| SQL functions, RLS policies, triggers | Supabase Postgres | No |
| Admin server actions and pages | Vercel servers | No (admins see rendered pages only) |
| Secrets (section 7) | Supabase secrets / Vault, Vercel env, GitHub secrets | No |
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
| **GitHub + Actions** | Code, pull requests, CI, auto-deploy to beta | Production deploys without your approval |
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
| n8n | Removed | Replaced by Inngest |
| EAS Hosting | No | Websites stay on Vercel |

### 3.5 Environments

| | Old app (untouched) | Upgrade: your PC | Upgrade: hosted beta |
|---|---|---|---|
| Code | `feature/first-push` (and the other old branches) | Phase branches | `upgraded-plan-changes` |
| Supabase | `wjxvingpfbfvkfqhrguj` | Local Docker stack | `taskdrop-beta` (free, R5) |
| Web | Current Vercel URL | `expo start` in a browser | `taskdrop.in` |
| Android | Existing preview APK | Your phone over Wi-Fi | `beta` APK + EAS Update channel `beta` |
| iOS | — | — (needs a build) | TestFlight internal + channel `beta` |
| Admin | Current Vercel URL | `npm run dev` (port 3001) | `admin.taskdrop.in` |
| Background jobs | pg_cron + n8n | Inngest dev server (`localhost:8288`) | Inngest Cloud free plan |
| Images | Supabase Storage | ImageKit `/local` | ImageKit `/beta` |
| Razorpay | Test keys | Test keys | Test keys |
| Sentry | — | Off | `environment: beta` |

After Phase 9 the old column is retired. At Phase 10, production is added and the beta becomes staging (`beta.taskdrop.in`). Free Supabase projects pause after about a week of inactivity; resume them from the dashboard.

### 3.6 How a change reaches testers

```
upgrade/phase-N-… branch → pull request into upgraded-plan-changes
   → CI (typecheck, unit, SQL, api, Playwright E2E) + CodeRabbit review → fix or answer → merge
   → auto-deploy (R2): migrations · functions · Inngest sync → taskdrop-beta
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
| `private.outbox`, `webhook_events`, push receipts; n8n dropped | 5 |
| `media` registry | 6 |
| `reports`, `blocks`; admin task, promotion and content actions | 7 |

## 4. Where we are today (code scan, 2026-10-07)

**Repos**
- User app + backend: `C:\complete taskdrop\taskdrop-claude-web` → GitHub `hitendureacts77/taskdrop`.
  - The newest work is commit 3d4bd72, on `claude/modest-albattani-3odt95` and now also on `upgraded-plan-changes`.
  - The Vercel project `taskdrop` deploys `feature/first-push`, which is 8 commits behind. There is no `main`.
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
- Events go to n8n.

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
| **GitHub Actions secrets** | Supabase access token and DB password (deploys), `EXPO_TOKEN` (EAS Update), Sentry auth token (source maps) |
| **CodeRabbit** | No secrets; installed as a GitHub app |
| **Your PC** (git-ignored) | `.env`, `apps/mobile/.env.local`, `supabase/functions/.env.local`, admin `.env.local`, all test keys |

## 8. Accounts and costs

| Item | Cost | When |
|---|---|---|
| Domain `taskdrop.in` | ~$5–6/year | Phase 0 |
| Supabase: old project + `taskdrop-beta` | Free | now |
| Vercel (web + admin) | Free (Hobby) while testing | now |
| CodeRabbit | Free for public repos; private repos 14-day trial, then $24/developer/month (annual) | Phase 0 |
| Apple Developer Program | $99/year | Phase 0 |
| Docker Desktop | Free for personal and small-business use | Phase 0 |
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

1. Admin alerts that n8n handled become in-app admin notifications + Sentry; email comes later.
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
| Moving phone login touches every sign-in | Testers locked out | Migrate test users; E2E sign-in test; sign-in switches |
| CodeRabbit on private repos is paid after the trial | Cost | Decide after the trial; CI and Claude reviews still run |
| CodeRabbit only auto-reviews the default branch unless configured | Pull requests not reviewed | `base_branches` setting (Phase 0) |
| Free-tier limits (Supabase 2 free projects, Inngest, ImageKit, Sentry, EAS) | Throttling or a paused project | Check at sign-up; resume paused projects |
| OpenStreetMap tile and search policies | Blocked at volume | Provider in Phase 8 |
| Edge function time limits | Long jobs cut off | Long work runs as Inngest steps |
| Inngest outage | Delayed jobs | Outbox + sweeper |
| Per-platform switches rely on a header | A user could fake their platform | Platform switches are operational; global switches apply to all |

## 11. Changelog

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
