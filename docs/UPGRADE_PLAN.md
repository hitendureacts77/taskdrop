# TaskDrop upgrade plan

Version 4.62, 2026-10-26 (**Staging (alpha, fake money) and Production (real money) plans written: Part B section 14**; Google sign-in fixed and tested on web, admin and Android; earlier: Phone session done; Phases 0-8 sweep and owner manual rewrite; Phase 2 pending items closed or scheduled; Google sign-in outage found; owner manual 4.3 and 4.4 ticked; earlier: Phase 5 cutover done: the three money sweeps run in Inngest and pg_cron has no jobs left; web home feed timed against the 3-second target, P2-48; earlier: second round: the merged pull request #77 deployed and re-attacked live, 269 probes held; P2-37 to P2-40 and P2-45 to P2-47 fixed; Phase 7 admin checks done in the owner's Chrome; Phase 5 money sweeps switched on in Vercel; earlier: break-it pass at the owner's request: 24 new findings P2-21 to P2-44 in `docs/PHASE2_PROBLEMS.md`, fixes merged in the same pull request; minimum price ₹20 and a confirm step before releasing money decided by the owner; owner-manual tasks 3.8, 6.2 and 6.3 checked by Claude; the admin idle sign-out passed once and missed once, P2-43; earlier: Phase 2 steps 4 and 5 done, admin speed and security fixed; Phase 2 P2-2 closed: Sentry clean-up done; Phases 4 and 5 worked through, owner items left; Phase 2 steps 1 to 3 built; Phase 2 audit and fix plan written; admin authenticator deferred to future scope; Phase 1 done; Phase 3 Razorpay-key rotation and private repos moved to future scope; tour guide added to Phase 8; ground rule 10: all new code goes to `redesigned-2.0`; scope note 2026-10-20: iOS deferred; 2026-10-24: Safari testing deferred too). The single source of truth for the upgrade. Part A is the to-do list, phase by phase; Part B is the reference (architecture, decisions, testing, costs, risks).

## How to use this file

- `- [ ]` is open, `- [x]` is done, `- [-]` is **deferred to future scope** (not forgotten, not needed now). Tick items as they're completed, in the same pull request as the work.
- **(You)** marks the items only you can do: accounts, payments, approvals, testing with real people.
- Every phase has to-dos for each part of TaskDrop:

| Part | What it means |
|---|---|
| **Backend** | Supabase: database, SQL, edge functions, Inngest functions |
| **Web** | The user app in a browser (`taskdrop.in`) |
| **Android** | The user app on Android phones |
| **iOS** | The user app on iPhones, and testing the web app in Safari. **Future scope (iOS deferred 2026-10-20, Safari 2026-10-24)** |
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
6. **Current focus: web, Android and the admin app. iOS and Safari testing are future scope (iOS decided 2026-10-20, Safari 2026-10-24).** Nothing iOS gets built, enrolled for or tested, and the web app is not tested in Safari, until you say "start iOS". Web is tested in Chrome (desktop and phone size) only.
   - Every iOS section below is marked `[-]` (deferred). The work stays in this plan so nothing is lost.
   - In any other box that mentions iOS, iPhone, Safari, TestFlight or the App Store, read that part as skipped; it doesn't block the phase. The same goes for **Sign in with Apple** and the Apple Developer account ($99/year), which only the iOS work needs; web and Android sign in with Google, phone and username + password for now.
   - Nothing in the code is removed: the app still builds for iOS, and the iOS-only code paths stay.
   - Full list of what waits: Part B, section 12 "Future scope: iOS and Safari".
7. **Stage: testing only.** Fake data, you and about 10 testers, no customers. Customer launch (Phase 10) happens only when you decide.
   - **Two plans (owner, 2026-10-26).** **Staging (alpha)** is the published app and website with fake data and **fake money** (Razorpay test keys, no RazorpayX, no real bank transfer); **Production** is later, on a separate Supabase project, with real money and real things. Part B section 14 holds both plans, the table of what is fake or real, and every payment production needs. No live payment key is ever put into the alpha project, and no alpha data moves into production.
8. **Supabase: the cloud project is the test environment (decided 2026-10-20).** We test directly on the hosted project `wjxvingpfbfvkfqhrguj`; whatever is in the cloud now is treated as testing. No local Supabase and no Docker on your PC.
   - Fake data only. A destructive step (wipe, reseed, reset) still runs only with your OK, and never on production.
   - The one throwaway database is in CI: GitHub Actions starts a temporary one inside each run to execute the SQL tests. It never touches the cloud project.
9. **Order of work: phase by phase (decided 2026-10-20).** We go 0 → 10 in order. A phase is closed when every box is ticked or deferred (`[-]`). If a box waits on something only you can do, work continues on that phase's other boxes, and the blocker is listed on the Progress board.
10. **Every new code change is pushed to `redesigned-2.0` (owner instruction 2026-10-24).** This covers all new code from here on, in both repos (user app and admin), including the tour guide, every phase's work and every fix.
    - The route is the one in rule 2: a short phase or fix branch, merged into `redesigned-2.0` by pull request, then deleted. A direct push to `redesigned-2.0` is also fine when you tell me to.
    - Code that exists only on a local branch or on your PC does not count as done. A box is ticked only when its code is on `redesigned-2.0` on GitHub, and a phase is closed only when all of its code is there.
    - Never push to `main` (rule 1). You promote `redesigned-2.0` to `main` by hand.
    - Pushing still happens only when you ask (`AGENTS.md` rule 7), so "push" here is a standing instruction for where code goes, not permission to push unasked. **Checked 2026-10-24:** nothing is waiting to be pushed. Both repos have only `main` and `redesigned-2.0` (the earlier list of local branches is gone), and `origin/redesigned-2.0` is the checked-out branch in both. The one thing on it that must not stay is the temporary Sentry trigger (Phase 2, P2-3).

---

# Part A: To-do list

## Progress board

> iOS items and Safari testing in every phase are deferred (`[-]`). A phase is complete when all its backend, web, Android, admin, You and Verify boxes are ticked.

| Phase | Name | Status |
|---|---|---|
| 0 | Foundations | **Done**, 39 of 46 boxes ticked, 7 deferred, 0 open. Done 2026-10-22: the Maps key restriction and the keystore second copy. Deferred 2026-10-22: the 12 testers (future scope; `docs/TESTER_RECRUITMENT.md` is the kit, and Phase 8's closed test waits for them). Dropped or deferred 2026-10-21: `support@` (use `hitendureacts@gmail.com` only) and the lawyer question (future scope). Done: CI and the old-app compatibility checks, CodeRabbit on both repos, the Vercel backend deploy, the seed load, the old-app and old-admin checks, `taskdrop.in` open to visitors |
| 1 | See problems, ship fast | **Done**, 22 of 28 boxes ticked, 6 deferred, 0 open. Code merged (PR 59) and deployed 2026-10-21. Done 2026-10-22: the FCM V1 key and the `beta` APK. Done 2026-10-24: source maps from EAS and from the Vercel web build, the Uptime Robot web and admin monitors, the two Sentry alerts, and the Verify run on your phone (update arrives, push arrives, test errors from web, Android, admin and all 8 functions with readable stacks, uptime green). The `api` health monitor is deferred (paid plan only); iOS parts are future scope |
| 2 | Make it work (stabilize) | In progress, 57 of 75 boxes ticked, 9 deferred, 9 open (30 new boxes for the break-it findings P2-21 to P2-44 of 2026-10-25; they close when their code is on `redesigned-2.0`; see `docs/PHASE2_PROBLEMS.md`). **Audit done 2026-10-24: 16 findings (P2-1 to P2-16) with a five-step fix plan. Steps 1 to 3 built the same day on branch `fix/phase-2-stabilize` (PR into `redesigned-2.0`): P2-1 to P2-9 done (PR 70, deployed, Sentry cleaned up); steps 4 and 5 done 2026-10-24 (the admin walk, the map check, the staff-role guards, the Playwright-in-CI choice, the sign-in routing fix; the admin got faster and its CI green, admin PR 22); left: the Android passes that create data (P2-10), cleaning up the e2e jobs (P2-19), and trying the new location button (P2-20)** (biggest: deploys cause a 503 burst and the app never retries; tests report to Sentry as `production`; a temporary Sentry trigger commit is live; some failed loads look like empty screens). The admin authenticator is deferred (P2-14). Earlier state: The four known backend bugs, the money-screen errors and the Playwright suite are done, merged and deployed (Playwright 20 of 20 on 2026-10-21). Left, all needing you or a device: your list of problems, the per-operation speed half (needs real traffic in Sentry), the admin page check, the Android/web checklists in Chrome and on a phone (Safari is deferred to future scope, 2026-10-24), and the Verify boxes |
| 3 | Server decides everything | In progress, 37 of 47 boxes ticked, 4 deferred, 6 open (the old app and old admin check done 2026-10-25). All the original code is done, merged (PR 59) and deployed; migration 114 is applied. Done 2026-10-24, not yet deployed: the compiled-in Razorpay test keys are gone from the functions, and the admin signs its session with `ADMIN_SESSION_SECRET` only (admin commit 2e2eca9). Open: the Phase 9 lockdown; App Check (monitor mode in `api`, and the token from the app); yours: record the Supabase token settings (rotating the Razorpay test keys and the private-repo decision are future scope, owner 2026-10-24); the checks that need an APK or a deployed build (Android map key, control screens, Android-only maintenance, "Update the app", old app and old admin, `docs/testing_checks.md` T2 and T11); and the "Keys, secrets and tokens" parent box |
| 4 | Accounts and sign-in | In progress, 9 of 27 boxes ticked, 6 deferred, 12 open. Merged on 2026-10-21 (app PR 59, admin PR 20; migrations 115 and 116 applied): server-side names for new accounts, S256 sign-in codes on phones, the onboarding fix, and the admin's sign-in card and "Sign out everywhere". **Not started on purpose:** Supabase's built-in phone auth with an SMS hook (replaces the working `phone-auth`; your call, see the box), the test-user phone migration that depends on it, and account linking. Left: "Allow manual linking" in Supabase (yours) and every Verify box (they need an APK and a sign-up on each platform) |
| 5 | Background jobs (Inngest) | In progress, 23 of 45 boxes ticked, 3 deferred, 19 open (the three money sweeps now run in Inngest and pg_cron is empty, 2026-10-25; what is left is the Razorpay and RazorpayX work the owner told me not to touch, and the Android check). The Inngest Cloud account exists and both keys are now Edge Function secrets (2026-10-21); the code is merged and deployed, and the function registers with Inngest Cloud. **The keys alone do not switch any job over:** the push, overdue, prune, account-file and money-sweep jobs stay off until the cutover SQL in `supabase/cutover/` is deliberately applied, and the money sweeps also need `INNGEST_MONEY_JOBS=on`. Still open, and why: the cutover and its verification (a deliberate step with you, one job at a time, nothing run yet), and the lawyer's answer on the money flow, which the plan and AGENTS.md say must come before the payout, refund-retry and webhook items are built. The admin Alerts page is built (admin repo) |
| 6 | Speed and media (ImageKit) | In progress, 19 of 26 boxes ticked, 2 deferred, 5 open (web uploads, drag and drop, access and clean-up checked 2026-10-25; the phone and the admin images are left; merged; migration 109 applied 2026-10-19; the ImageKit keys are now Edge Function secrets on the test project (2026-10-21), so uploads can go to ImageKit; not yet tried end to end). Open: uploads from a browser and a phone, admin image views (new feature, needs the private key as a server secret in the admin project), the speed targets, Verify; and rotate the private key that was pasted into chat (yours) |
| 7 | Moderation and admin tools | In progress, 15 of 25 boxes ticked, 2 deferred, 8 open. Merged on 2026-10-21 (app PR 59, admin PR 20; migrations 117 and 118 applied): blocks now stop contact, hide message / photo / category functions, report-a-message in chat, reported messages shown and hideable in the admin, the runbook. Built 2026-10-22 to 2026-10-24: report a review, the change-category card, promotion tiers read from the server and editable in the admin, broadcasts by platform and app version (migration 119, applied), the Devices and tools dashboard card, a "warn" action (migration 120, applied; admin branch `upgrade/phase-7-admin-tools` not pushed) and remove a review (migration 121). Open: cancel a promotion with a full refund (a money policy choice; Stop already refunds the unused budget), the reports-queue box (warn covers reports about a person only), report and block in a browser and on the APK, the 3 Verify boxes, and the "Admin SQL functions" parent box (it waits on cancel with refund) |
| 8 | Store readiness | Not started, 2 of 29 boxes ticked (the legal pages and the AAB), 10 deferred (iOS), 17 open, plus **11 new "Alpha publish" boxes added 2026-10-26** (the fake-money guard rails and the publish steps, section 14). Added 2026-10-24: the **in-app tour guide** (11 boxes, 10 open and 1 deferred for iOS; design sign-off from you comes first). The older boxes were reviewed 2026-10-21: every one is yours, needs a store account, a closed-test group or a device; the one code-side question, map tiles, is noted in its box. The closed test waits for the 12 testers, deferred in Phase 0 |
| 9 | Switch-over to the upgraded app | Not started, 0 of 28 boxes ticked, 1 deferred (iOS), 27 open. **Deliberately not touched by the autonomous run (2026-10-21):** it needs your approval, it retires the old app and old admin, and the lockdown and clean-up migrations cannot be undone while testers are on the old app |
| 10 | Customer launch (later, when you decide) | Not started, 0 of 29 boxes ticked, 1 deferred (iOS), 28 open. Not touched: ground rule 7 says it happens only when you decide |

**Which plan each phase belongs to (Part B, section 14):** Phases 0 to 9 are the **Staging (alpha) plan**: fake data, fake money, you and the testers. Phase 10 is the **Production plan**: real money, a new Supabase project, every payment in section 14.5. Phase 8 now also carries the **Alpha publish** boxes (the guard rails that keep alpha fake and the publish steps for web, Android and the admin).

## Coverage: what each phase changes

| Phase | Backend | Web | Android | iOS and Safari (future scope) | Admin |
|---|---|---|---|---|---|
| 0 | Compatibility rules, CI, auto-deploy, seed | `taskdrop.in` on the upgrade | Beta build profile | Apple Developer enrollment | `admin.taskdrop.in`, CI |
| 1 | Sentry in functions, health check | Sentry | Sentry, OTA updates, push fix | First TestFlight build, push | Sentry |
| 2 | Bug fixes, slow queries | E2E tests, fixes | Fixes | iOS fixes; web in Safari | Every page checked |
| 3 | Server rules, app controls, key clean-up, App Check (monitor) | No key in bundle, security headers, App Check token | Control screens, App Check token | Control screens | App controls page, gateway header, own session key |
| 4 | Phone auth, Apple, linking | Google/Apple browser sign-in | Google/Apple/phone | Native Apple sign-in | Sign-in methods, devices |
| 5 | Inngest, outbox, webhooks | In-app notifications | Push via Inngest | Push via Inngest | Queued payouts, alerts |
| 6 | `media` table, ImageKit signing | Uploads, images, CSP | Camera uploads, images | Camera/HEIC uploads, images | Images via signing |
| 7 | Reports, blocks, admin actions | Report/block | Report/block | Report/block | Reports queue, actions, runbook |
| 8 | — (tour needs none) | Privacy and support pages, tour guide | Play closed test, tour guide | App Store review prep, tour guide | Ready for reviewers |
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
- [x] **(You)** Sign up at coderabbit.ai with GitHub and install the CodeRabbit app on both repos. Done: it reviewed the app repo's PRs 38 to 41 and the admin repo's PR 19 (2026-10-20). If they're private: a 14-day trial, then $24/developer/month billed annually; public repos are free.
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
- [x] One command resets the **cloud test project** to the fake-data seed (only with your OK, ground rule 8). Built: `npm run seed:reset` (`scripts/reset-test-data.mjs` and `supabase/seed/test_data.sql`; details in `docs/DEPLOY.md`). It accepts only the test project or localhost, makes you type "reset", and touches only its four seed accounts. Tested by loading the seed in a transaction on the cloud project and rolling it back (12 tasks in 10 statuses, 4 profiles, 4 wallets, nothing left behind), and CI loads it twice on the throwaway database (`npm run test:seed`). It was first run for real on 2026-10-20 (see the box below). It holds:
  - poster, worker and admin accounts
  - test phones with fixed codes
  - tasks in every status
  - wallets with fake credits

  On the shared test project, a reset also changes what old-app testers see, so it only runs with your OK. It never runs on production.
- [x] **(You)** Say "run the seed" (or run `npm run seed:reset` with `DATABASE_URL` set) when you want the first real reset. Done 2026-10-20 at your request ("do all these"), run through the Supabase connector with the same SQL, since no `DATABASE_URL` is stored on this PC. First load, so nothing was deleted: 4 accounts, 12 tasks in 10 statuses; the 19 other accounts and 57 other tasks were untouched. **It broke sign-in for about 15 minutes:** the seed left NULL in four `auth.users` token columns, GoTrue's admin user list then answered 500, and `phone-auth`'s account lookup uses it. Found by the old-app checklist, patched by hand, and fixed in the seed and its check (PR 54)
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
- [x] Add `taskdrop.in` to the project's redirect URLs (done 2026-10-20 in Supabase, Authentication, URL Configuration: `https://taskdrop.in/**` and `https://www.taskdrop.in/**` added, the 8 old entries untouched, 10 in total). `EXPO_PUBLIC_APP_URL=https://taskdrop.in` set in Vercel; widened to All Environments at the owner's request (2026-10-20), so builds of `main` also read `https://taskdrop.in`; it takes effect on the next deployment
- [x] **(You)** Make `taskdrop.in` open to your testers. Done: you confirmed on 2026-10-21 that the site now opens for visitors. (Found 2026-10-20: a visitor not signed in to Vercel was redirected to Vercel's login page, because Vercel Authentication protects Preview deployments and `taskdrop.in` is served by one.)
- [-] **(You)** `support@taskdrop.in` via free email forwarding. **Dropped (owner decision 2026-10-21): there is no `support@` address; use only `hitendureacts@gmail.com`.** A forwarding rule was created on 2026-10-21 and deleted the same day, so Spaceship has no email rules. The domain still carries Spaceship's forwarding MX and SPF records, which do nothing without a rule

**Android**
- [x] EAS build profile `beta` (Android APK) with EAS Update channel `beta` (R1, confirmed), in `apps/mobile/eas.json`. Adding `expo-updates` and the first build happen in Phase 1.
- [x] **(You)** Restrict the Google Maps key. **Done 2026-10-22** (in the Google Cloud project `Taskdrop`, `project-a19d1da9-6903-4168-905`, under `hitendureacts-org`; the old keys were not in it): `taskdrop-android-maps` is limited to Maps SDK for Android plus package `com.taskdrop.app` and its SHA-1; `taskdrop-server-places` is limited to Places API (New). Billing account `017635-691F66-39081C` is active and linked (the earlier two are closed, and Google cannot delete billing accounts). Daily Places quotas: autocomplete 5,000, place details 2,000, text search 1,000. Budget `taskdrop-monthly-100`: ₹100 a month, alerts only, emails at ₹50, ₹90 and ₹100. Firebase created a third key, "Browser key (auto created by Firebase)", with 25 APIs; the app does not use it, and **you had me delete it on 2026-10-22** (Google keeps a deleted key restorable for 30 days). `taskdrop-android-maps` now also allows Firebase Installations and FCM Registration, because the Firebase config uses that key (see `docs/FCM.md`). **Checked on a phone 2026-10-22:** the installed app draws the Google map (dashboard: Maps SDK for Android 1 request, 0 errors) and a place search answered through Google (Places API (New) went from 6 requests / 6 errors to 7 requests / 6 errors, so the new request succeeded; the 6 errors are the old pre-billing ones). The Geocoding API shows only its 2 old errors: the app's address lookup for a pin uses OpenStreetMap, not Google Geocoding. Original note (blocked 2026-10-20: Google Cloud now refuses the `hitendureacts@gmail.com` account until two-step verification is on, a security setting only you can change; the three other Google accounts signed in to your Chrome (`narasimharaju7c`, `narasimhaecom7`, `hitendu7`) have no Google Cloud project with a key, so the key is almost certainly under `hitendureacts@gmail.com`. The Android SHA-1 for the restriction is on Expo, project `taskdrop`, Credentials, `com.taskdrop.app`): limit it to the Maps and Places APIs and set a daily quota. Use a separate Android key restricted to package `com.taskdrop.app` + signing SHA-1. The old web bundle keeps exposing the current key until Phase 9, so the restriction matters now. **2026-10-21:** you report two-step verification is now on, so the account is no longer blocked; the restriction itself is a security setting in Google Cloud and is still yours to make.
- [x] **(You)** Back up the EAS keystore (`eas credentials`). Half done 2026-10-21 with your OK: the Android upload keystore (JKS, uploaded 6 Oct) was downloaded from Expo and saved as `C:\Users\naras\Documents\taskdrop-keystore-backup\@hitendureacts__taskdrop-keystore-backup.zip` (the keystore file plus a note with its passwords), outside every repo. **Second copy: done by you on 2026-10-22, and checked by me the same day:** it is in `OneDrive\Desktop` (so OneDrive also holds it), byte-identical to the first copy, and holds the keystore file plus the credentials note. I opened the keystore without Java: its certificate SHA-1 `1F:22:C8:0B:77:D1:C9:36:D2:B2:F6:C0:CF:35:09:B1:72:2B:E5:D1` and SHA-256 `02:B6:21:92…:AB:3F` are the ones Expo lists and the ones the Maps key is restricted to, and the store password, key alias and key password in the note all unlock it. A third, local copy of its values is now in the git-ignored `.env.all-secrets` (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEYSTORE_SHA1`). The zip keeps the passwords next to the keystore, so anyone who gets the zip gets everything: a password manager or an offline drive is still the safer place for one copy

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] **(You)** Enroll in the Apple Developer Program, $99/year. Approval can take days, and the first TestFlight build in Phase 1 needs it.

**Admin**
- [-] Vercel admin project: assign `admin.taskdrop.in` to the `redesigned-2.0` branch. **Dropped (owner decision 2026-10-20):** there is no admin subdomain; the admin stays on its Vercel addresses (`taskdrop-admin.vercel.app` and the preview address). Revisit when you want one. Read `admin.taskdrop.in` elsewhere in this plan as "the admin's Vercel address" until then
  - **(You)** In Spaceship DNS, add a `CNAME` for `admin` pointing to the value Vercel shows for the admin project (normally `cname.vercel-dns.com`).
- [x] Admin redirect URLs: the admin's Vercel callbacks (`taskdrop-admin.vercel.app`, `taskdrop-admin-hitenduteam.vercel.app`, `localhost:3001`) were already on the Supabase list (checked 2026-10-20), so nothing was needed for the admin. `supabase/config.toml` and `scripts/add-redirect-urls.mjs` still exist for later additions, and no token is needed now
- [x] Admin `.env.example` and README updated for local and beta (README in admin PR 18, plus the types and migration notes; `.env.example` has the project id and Sentry environment)

**You (other)**
- [-] **(You)** Ask a lawyer about the money flow (R3; questions in Part B, section 10). **Deferred to future scope (owner decision 2026-10-21).** The brief is ready in `docs/LAWYER_BRIEF.md` for when you want it. Until a lawyer has answered, everything the money flow depends on stays switched off: payouts, refund retries and the webhook hand-off (Phase 5), and no real customer money moves (Phase 10)
- [-] **(You)** Recruit at least 12 testers. **Deferred to future scope (owner decision 2026-10-22).** Until then the app is tested by you alone and the Play closed-test 14-day clock (Phase 8) does not start. Earlier plan: you were asking your friends (2026-10-21). For personal Play developer accounts created after 13 November 2023, Google requires at least 12 testers opted in continuously for 14 days before you can apply for production access (the 14 days start once 12 are opted in). Kit ready: `docs/TESTER_RECRUITMENT.md` (message, sign-up sheet, Play Console steps, what to test)

**Verify**
- [x] A test pull request into `redesigned-2.0` runs the checks (including the compatibility check) and gets a CodeRabbit review. Done 2026-10-20 with the real Phase 0 PRs (app PR 41, admin PR 19): every job ran, CodeRabbit left 8 comments on PR 41 and 2 on PR 19, all fixed or answered. It also caught a real CI bug (the database job never installed dependencies), fixed in the same PR
- [x] A push to `redesigned-2.0` makes the Vercel build deploy to the shared test project. Done 2026-10-20 with the merge of PR 41 (merge commit ac77679, merged 16:23 UTC): the Vercel build finished successfully and all 11 Edge Functions on the project show an update time of 16:24:37 UTC. The build runs its steps in order and fails on any error, so the old-app contract check, the old-app database check and the migration step (none pending) passed before the functions went out, and `main` was fetchable. Not seen: the build log itself (the Vercel connector is refused on the team, and the built-in browser isn't signed in to Vercel), and the Inngest sync was confirmed separately by calling it (2026-10-20, "Successfully registered"). The deploy guard also accepted the stored `DATABASE_URL`, since the build got as far as deploying the functions
- [x] `taskdrop.in` loads the upgrade branch (checked 2026-10-20: serves the redesigned app, certificate issued). The admin has no domain of its own (see above)
- [x] The whole app (web in a browser, Android over USB or Wi-Fi, admin) runs on your PC against the cloud test project. Web and Android over USB checked 2026-10-20; the admin dev server on port 3001 checked the same day (login page 200, `/` redirects to `/login`)
- [x] **The old app still works unchanged** at its current URL. Done 2026-10-20 by hand on `taskdrop-five.vercel.app`: sign in with a test phone, feed and task detail, post a request and see it in My Tasks, a second account sends a quote, chat message sent (`docs/DEPLOY.md` steps 1 to 3). The check found the seed bug above; after the fix everything passed.
- [x] **(You)** The old admin still works: sign in at its current address and open the dashboard and the tasks list (`docs/DEPLOY.md` step 4). Done: you confirmed on 2026-10-21 that the admin login works

---

## Phase 1: See problems, ship fast

**Backend**
- [x] `_shared/monitoring.ts` used in every function: `razorpay`, both webhooks, `razorpayx-payouts`, `phone-auth`, `password-auth`, `places-search`. Done 2026-10-21 (branch `upgrade/phase-1-sentry`): `places-search` was the last without it; it now logs a rejected Google key, an unreachable Google and a broken search budget. Every handler except `app-config`, `inngest` and `razorpay-setup` is wrapped in `guarded()` (see the third box)
- [x] Parsed stack frames. `captureServerError` now sends a real Sentry stack trace (function, file, line, column, in-app flag; `_shared/stack.ts`, tested in `stack.test.ts`) instead of the stack as a text blob
- [x] Unexpected database errors reported. `guarded()` in `_shared/monitoring.ts` catches anything a handler throws, reports it with its stack and answers a plain 500; `phone-auth` `failed()`, the `password-auth` sign-in gate, the `places-search` budget and `api` ops also send database errors as issues, not only as log lines
- [x] "PAYOUT MADE BUT NOT RECORDED" and "REFUND SENT BUT NOT RECORDED" sent as fatal. The payout case was only a `console.error`; both now send a `fatal`-level event (`captureServerError(..., "fatal")`) plus a log line
- [x] A `health` op on `api` for uptime checks. `POST /functions/v1/api` with `{"op":"health"}` and the project's anon key as the bearer token answers before sign-in: 200 `{ok:true,data:{status:"ok",database:true}}`, or 503 when the database does not answer. Deployed with the merge of PR 59 (2026-10-21) and answering 200 on the test project

**User app (all platforms)**
- [x] `@sentry/react-native` replaces `apps/mobile/src/lib/monitoring.ts`; pick the version that matches Expo SDK 57 (`~7.11.0`; DSN in `EXPO_PUBLIC_SENTRY_DSN`, auth token in `SENTRY_AUTH_TOKEN`; Sentry org `hitendu`, project `taskdrop`)
- [x] `reportError` (`lib/errors.ts`) stays the single entry point (checked: nothing else in the app calls Sentry's error API; the reporter is installed by `installMonitoring`)
- [x] API and network failures reported (they're ignored today). `apiFailureKind` (`lib/errors.ts`, tested) sorts a failed call into offline, signed out, refused on purpose or unexpected. The first three only count in Sentry Metrics (`api.failed`, by kind); an unexpected one becomes a warning-level issue grouped by status and code, with no message text (database messages can quote values)
- [x] User id only, no phone or email; about 10% performance traces; `environment` and `release` tags. The user id is set on sign-in and cleared on sign-out (`setMonitoringUser`); `sendDefaultPii` was already off, traces 10%, `environment` from `EXPO_PUBLIC_SENTRY_ENVIRONMENT`, `release` the app version
- [x] `expo-updates` with a runtime-version policy (R1: EAS Update, not EAS Hosting). `expo-updates ~57.0.26` added; `app.json` has `runtimeVersion: {policy: "appVersion"}` and the update URL for project `08aa002b-…`; the `beta` build profile already uses channel `beta`. Takes effect in the next native build (the box under Android)

**Web**
- [x] Sentry captures web errors, with readable stacks (source maps uploaded on deploy). **Checked 2026-10-24 in the Vercel build log of `aa78ab9` (deployment `dpl_2YKebNN9…`, branch `redesigned-2.0`):** the `[sourcemaps]` step ran with the token (PR 69), bundled 12 files (6 scripts, 6 maps, each with a debug id) for org `hitendu`, project `taskdrop`, found the files already on Sentry's server (an earlier build had uploaded the same bundle), and then `removed 6 .map file(s)` so none is public. Earlier history: built 2026-10-21 (the token is now set, so what remains is checking one build's upload): the web export now makes source maps (`--source-maps`), and `scripts/upload-web-sourcemaps.mjs` (run by `scripts/vercel-build.mjs`) uploads them to Sentry and then deletes every `.map` so none is public. It needs **(You)** the Sentry token as a secret in the Vercel project `taskdrop` (the same token EAS has). **Found 2026-10-24:** the last web build (`d49d681`) printed `SENTRY_AUTH_TOKEN is not set; nothing uploaded`: the variable exists in Vercel (production, preview and development) but is named `SENTRY_AUTH_TOKEN_TASKDROP_USERAPP`. `scripts/upload-web-sourcemaps.mjs` now accepts either name (commit `10f5165` on local branch `fix/web-sourcemap-token`, not pushed); after it is merged the next build should upload, and TASKDROP-6 (`?(index)`) shows what a minified stack looks like today. Without it the build still passes with a warning and web stacks stay minified. Web errors already reach Sentry (TASKDROP-2) **2026-10-21:** you report `SENTRY_AUTH_TOKEN` is now set in Vercel; the next web build shows whether the upload worked.

**Android**
- [x] **(You)** FCM V1 credentials + `google-services.json` through EAS, which fixes push in builds. **Done and tested 2026-10-22:** push moved to the `Taskdrop` Google Cloud project; the new FCM V1 key is in Expo Credentials (checked: project `project-a19d1da9-6903-4168-905`); on your phone (CPH2585) a test notification arrived with the app closed (Expo answered 200, Android showed it). It first failed because the Firebase key in `google-services.json` is the same key as the Maps key, which was restricted to Maps SDK for Android only (log: `API_KEY_SERVICE_BLOCKED` from Firebase Installations); with your OK I added Firebase Installations API and FCM Registration API to `taskdrop-android-maps` (still limited to `com.taskdrop.app` + SHA-1) and the token registered. Details in `docs/FCM.md`. Older state follows. Code side done 2026-10-21: `app.config.js` reads the file from the EAS file variable `GOOGLE_SERVICES_JSON` and `google-services.json` is git-ignored. Yours: create the Firebase project, upload the FCM V1 service-account key to Expo and add the file variable. Steps in `docs/FCM.md` **State 2026-10-21:** Firebase project `taskdrop7` exists and `GOOGLE_SERVICES_JSON` is an EAS secret file variable in preview and production (checked with `eas env:list`). Not verifiable from here: the FCM V1 key upload in Expo Credentials. The `beta` APK waits for that.
- [x] One new `beta` APK with all the native changes (Sentry native, `expo-updates`, FCM), installed by testers. **Built 2026-10-22** (EAS build `af47d88d-21fb-4427-a6ce-a299cc073f75`, commit `525ee7c`, https://expo.dev/artifacts/eas/aBiNKC9br8NPJ0JheS7VjXdovDje1ELTMyU4PfM35FI.apk) and installed on the owner's phone, where push works. Testers install it once they are recruited (Phase 0 box)
- [x] Source maps uploaded from EAS. **Checked 2026-10-24** in the EAS log of the `beta` APK (build `af47d88d`): the Sentry Gradle step uploaded the maps for release `com.taskdrop.app@1.0.0+1` (`SENTRY_AUTH_TOKEN` is in the EAS `preview` environment). Over-the-air updates are not covered by that step: for the update published the same day (EAS update group `166484f3-937f-41c8-92f7-e6d06df5bb1e`, channel `beta`, runtime 1.0.0, from `d49d681`) Claude exported with `--source-maps` and uploaded them with `sentry-cli sourcemaps upload --debug-id-reference` (bundle debug id `6116d3f4-79c2-4a4a-83d0-cf100541f4e0`), then ran `eas update --skip-bundler`. Each future update needs the same two steps **Lesson 2026-10-24:** the by-hand upload above was incomplete. `sentry-cli sourcemaps upload <dir>` only picks up the `.map`, so Sentry answered `missing_source` and the update's stacks stayed minified (`index.android.bundle:1:…`). Upload both files by name, with the debug id also written into the map as `debug_id` (what `@sentry/react-native/scripts/expo-upload-sourcemaps.js` does): `sentry-cli sourcemaps upload --org hitendu --project taskdrop --debug-id-reference <bundle>.hbc <bundle>.hbc.map`. Done that way for the 2026-10-24 test update, Android stacks map to the original files. The earlier update (group `166484f3`) was uploaded the incomplete way, so its stacks stay minified

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
- [x] `@sentry/nextjs` (server actions, route handlers, browser), as its own Sentry project. Already in the admin repo on `redesigned-2.0` (admin PR 15; project `taskdrop-admin`, `src/instrumentation*.ts`, `global-error.tsx`; admin source maps upload with the token on Vercel, checked 2026-10-19)

**Alerts**
- [x] **(You)** Create Sentry and Uptime Robot accounts. The Sentry account exists (org `hitendu`, projects `taskdrop` and `taskdrop-admin`); the Uptime Robot account (free plan) was made by you on 2026-10-24
- [x] Sentry alerts: new issues, money fatals, error spikes. One alert already existed (new, escalating and regressed issues, emailed to you). **Done 2026-10-24 in your signed-in Chrome:** `Money fatal` (project `taskdrop`: when a new issue is created and the event's level equals fatal, notify you; this covers the two NOT RECORDED cases) and `Error spike` (a Metric monitor on `taskdrop`: Errors dataset, `count()` over 1 hour, High priority above 20, with a connected alert that emails you). Sentry's new layout has no Alerts menu any more: alerts live under **Monitors → Alerts → Create Alert**, and the spike rule is **Monitors → Create Monitor → Metric**
- [x] Uptime Robot: `taskdrop.in` and the admin. **Done by you on 2026-10-24:** two HTTP(s) monitors on the free plan, `https://taskdrop.in` ("TaskDrop web") and `https://taskdrop-admin.vercel.app` ("TaskDrop admin"), every 5 minutes, emailing you
- [-] Uptime Robot: the `api` health monitor. **Deferred (owner decision 2026-10-24):** it needs a POST with custom headers, which only a paid Uptime Robot plan allows. Earlier note: Waits for the account above and for the `health` op to be deployed. The api monitor is a POST to `https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/api` with body `{"op":"health"}` and headers `Authorization: Bearer <anon key>`, `apikey: <anon key>`, `Content-Type: application/json` (POST and custom headers need a paid Uptime Robot plan; the free plan can watch `taskdrop.in` and the admin page only). There is no `admin.taskdrop.in`: use the admin's Vercel address

**Verify**
- [x] A test error from web, Android, admin and each function appears in Sentry with a readable stack (iOS part: future scope). **Done 2026-10-24.** Claude added temporary triggers (user repo `550d4a1`, admin repo `1f1e7b5`; both reverted the same day: `e4d1433` and `8ab9de3`): a header on any `guarded()` function, a `?sentry-test=` link in the app, and a server route plus a client page in the admin. Results in Sentry: **web** (TASKDROP-C) mapped to `apps/mobile/src/lib/monitoring.ts`; **Android** (TASKDROP-B, then C and D) mapped to the same file once the update's source maps were uploaded correctly (see the lesson in the "Source maps uploaded from EAS" box); **functions** (TASKDROP-A, 8 events, one per function) name the function and `_shared/monitoring.ts`; **admin** (project `taskdrop-admin`, TASKDROP-ADMIN-3 server and TASKDROP-ADMIN-4 browser) mapped to `src/app/api/sentry-verify/route.ts:5` and `src/app/sentry-verify/page.tsx:11`
- [x] An update published to channel `beta` appears on an Android phone without reinstalling (iPhone part: future scope). **Checked 2026-10-24:** after the update (group `c8a3689a-0cd4-4556-becb-76946e684079`, update id `01a16e6d-b827-769b-9534-1e6ca141d125`) was published, the phone (CPH2585) restarted twice, and Sentry's event from the phone reports exactly that update id, channel `beta`, `is_embedded_launch: false`
- [x] A push notification arrives on Android (iPhone part: future scope). **Checked 2026-10-24** on the current build: Claude sent a test push through Expo to the phone's registered token with the app in the background; Expo's receipt was `ok` and Android's notification list held the notification ("Phase 1 verify: push check 2"). Two test notifications are left in the phone's shade; swipe them away
- [x] The uptime monitors are green. **Checked 2026-10-24** in the Uptime Robot dashboard (signed in as the owner): `taskdrop.in` and `taskdrop-admin.vercel.app` both Up, 100% over 24 hours, 0 incidents

---

## Phase 2: Make it work (stabilize)

**Your list**
- [x] **(You)** Write down everything you've seen not working or slow **Done 2026-10-25 by Claude at the owner's request ("break my application"): `docs/PHASE2_PROBLEMS.md`, 24 findings and what held.**
- [x] **Done 2026-10-25:** each finding is a box in this phase (fixed, accepted in writing or scheduled), in this one plan file as the owner's rule says, not as separate GitHub issues. Original box: Each item becomes a GitHub issue, then is reproduced and fixed, or scheduled into a later phase

**Audit findings, 2026-10-24 (found by Claude; the fix plan for Phase 2)**

What was checked, so the list below is evidence and not a guess: `npm run check` in the app repo (typecheck, lint, 59 unit and api tests, all green); the admin's typecheck, lint and 89 tests (green); the Playwright suite twice (**16 of 20 on the first run, 20 of 20 on the re-run**, finding P2-1); the Supabase function and Postgres logs, security and performance advisors and the cron history; Vercel runtime errors for both projects over 7 days (none); the 10 open Sentry issues; the dependency audit gate (4 advisories, all accepted with a reason); the owner's phone over USB (`CPH2585`, app 1.0.0 installed 2026-10-22; **no TaskDrop crash** in the phone's crash log); every one of the 45 screen names against the screen registry (all registered); and every admin route signed out (every protected page redirects to the sign-in, none answers 500). **Not checked, because it needs you:** the signed-in admin pages, and the Android checklist by hand. Order of work: steps 1 to 3 need nothing from you; step 4 needs your phone and your admin sign-in; step 5 closes the loop.

*Step 1: stop the blips and the noise*
- [x] **P2-1 Deploys cause a short outage, and the app does not retry. Built 2026-10-24 (branch `fix/phase-2-stabilize`):** `lib/retry.ts` (tested in `retry.test.ts`), used by `callApiDirect` in `lib/gateway.ts` for reads and `batch` only (a write is never repeated) and by the `app-config` refresh; the Playwright helper retries a gateway 502/503 (a 504 for reads only), answers with an ordinary `{ok:false}` instead of crashing, and the suite now starts by waiting for `health` (a new first setup test; 21 tests, all passing). Original finding: On 2026-10-24 between 15:00:10 and 15:00:19 UTC about ten requests to `api` and `app-config` answered 503 while the Vercel build of `550d4a1` was deploying the functions. The Playwright money test fell over on one of them (`TypeError: Cannot read properties of undefined (reading 'code')` in `e2e/helpers.ts`, because a gateway 503 is not our `{ok:false}` reply) and passed on the re-run. Sentry shows the same pattern for testers: TASKDROP-7 (API 503, 6 events), TASKDROP-8 (status 0), TASKDROP-9 ("Could not reach TaskDrop"). The app's `callApiDirect` (`apps/mobile/src/lib/gateway.ts`) never retries, on web or Android, so every deploy and every weak mobile signal shows as an error. Fix: (a) reads only (never a write, so no money is ever sent twice) retry up to twice on 502, 503, 504 and a network failure, after 0.4 s and 1 s; (b) the wording while it retries is plain ("One moment, reconnecting"), and the error shows only after the last try; (c) the Playwright helper retries on a non-JSON or 5xx reply and the suite first waits for the `health` op; (d) a unit test for each rule (reads retry, writes do not).
- [x] **P2-2 Sentry sorted by what is real. Done 2026-10-24:** the environment is `development` on `localhost`, `AbortError` events are dropped, and an unreachable `app-config` is a log line, not an issue (PR 70, deployed). **Clean-up done the same day in your signed-in Chrome:** 15 issues resolved (the verify test errors TASKDROP-A to D and ADMIN-3, ADMIN-4; the older tests TASKDROP-2, ADMIN-1, ADMIN-2; the noise TASKDROP-5, 6, 7, 8, 9 that this change addresses), leaving only TASKDROP-4 (the Android Maps key, see P2-11). **Check:** TASKDROP-6's newest event is from 15:03 UTC, in the old pre-fix bundle; no localhost event reached `production` after the fix (one full Playwright run on the fixed build, 21 of 21). If any resolved noise issue comes back, Sentry reopens it, which is the signal that the retry or the tagging is not enough. Original finding: TASKDROP-6 ("Failed to fetch", 36 events) comes from `HeadlessChrome` at `localhost:8099`, that is Playwright and local runs, and is tagged `environment: production`, so the production board is polluted by tests. TASKDROP-5 (`AbortError`) is a fetch cancelled by leaving a page. Fix: the environment is `development` whenever the page host is `localhost`/`127.0.0.1` or the build is a dev build; `AbortError` and a failed `app-config` fetch during page unload are not reported; then resolve the old test issues (TASKDROP-2, TASKDROP-A, TASKDROP-ADMIN-1, TASKDROP-ADMIN-2) so the board shows only real problems. Gate: a Playwright run leaves no new event in `production`.
- [x] **P2-3 Take the temporary Sentry trigger out. Done 2026-10-24 by the Phase 1 verify session:** `550d4a1` was reverted in `e4d1433` right after the web, Android and function test errors were seen in Sentry; no trigger is left in either repo. Original finding: `origin/redesigned-2.0` carries commit `550d4a1` ("TEMP: Sentry verify trigger"): any request with the header `x-sentry-test` makes every Edge Function throw on purpose, and opening the app with `?sentry-test=` reports a fatal test error. The token is written in the repo. Revert it by pull request as soon as the Phase 1 Verify box "a test error ... appears in Sentry with a readable stack" is ticked (TASKDROP-A already proves the function side). The revert itself deploys the functions, so it also causes the P2-1 blip once.
- [x] **P2-4 Leftover wording. Done 2026-10-24:** `Placeholder.tsx` now says "This page isn’t available" with a Back button, and `navigation/registry.test.ts` fails if a screen name has no screen. Original finding: `screens/Placeholder.tsx` says "This screen is being built by the agent team". All 45 screens are registered, so nobody reaches it today, but a bad link could. Replace it with a plain "This page isn't available" and a Back button, and a test that every screen name resolves.

*Step 2: errors that hide*
- [x] **P2-5 Failures that look like empty screens. Done 2026-10-24, after checking each site (two of the first list were wrong):** `PromoteScreen` and `TaskManageScreen` now show the shared "Couldn’t load. Try again" state (`LoadFailed`) and report to Sentry; on the manage-task screen a failed quotes load fails the whole load (it used to read as "no quotes yet") and a failed pull-to-refresh says so. **Checked and safe, no change:** sign-out (supabase-js 2.116 clears the device session even when the server cannot be reached), `quietly()` (only used for ad impression pings), and the preloads in `CompareScreen`, `ExploreScreen` and `AiPostScreen` (the screen has its own fallback: the params, the typed text, "wallet unknown"). **Question, decided 2026-10-24 (the owner said to complete it):** `postSignInRoute` (`data/api.ts`) used to send a person to onboarding when the profile read failed, so a returning person could see onboarding after a network blip. It now reports the failure and sends them home: a returning person is far more likely than a new one, re-running onboarding could overwrite what they set up, and a new person who lands on Home can finish from Profile. Original finding: The app has 51 `.catch(() => {})`. Most are fine (analytics pings, a `mailto:`), but these hide a real problem: `PromoteScreen` (a failed load looks like "you have no tasks to promote"), `TaskManageScreen` (a failed load shows as "not found" and a failed pull-to-refresh is silent), `CompareScreen`, `ExploreScreen` (saved ids and own location), `AiPostScreen`, `ProfileScreen` (a failed sign-out is swallowed and the app still goes to the splash screen), and the `quietly()` helper in `data/api.ts` (a failed badge or count reads as zero). Fix: one shared "Couldn't load. Try again" state, reported through `reportError`; each remaining quiet catch gets a one-line comment saying why it is safe. Both web and Android.

*Step 3: database tidy-up (migrations that only add or replace a rule, tested before and after)*
- [x] **P2-6 Double rules on hot tables. Written 2026-10-24 (migration 122, applied when the Vercel build merges it):** checked on the test project in a rolled-back transaction with a real owner, stranger and admin (the "session is postgres" shortcut removed): identical row counts and identical write refusals before and after; `supabase/tests/policy_tidy.test.sql` keeps the shape (one permissive rule per table, role and action) and is in `test:db`. Original finding: The Supabase performance advisor warns on 11 "multiple permissive policies": `user_roles` (for 7 roles), `app_devices`, `payouts`, `settings`, `task_promotions`, `wallet_adjustments`. Each read runs both rules. Merge each pair into one policy with `or`, so nobody gains or loses access; a SQL test shows the same visible rows for the owner, a stranger and each staff role before and after (`npm run test:db`).
- [x] **P2-7 15 foreign keys without an index (migration 122, same test)**, all on staff-side columns (`crm_*`, `*_moderation.hidden_by`, `reports.handled_by`, `user_warnings`, `copyright_notices.logged_by`). One migration of `create index if not exists`. The 18 "unused" indexes stay until there is real traffic.
- [x] **P2-8 Reconcile page tells the truth. Code written 2026-10-24 (migration 123; test in `policy_tidy.test.sql`: a fully refunded payment is not flagged, a partly refunded one still is). The seed-data mismatches are untouched: marking them "known" would change data, which needs your OK.** Original finding: The `paid_not_credited` check counts a payment that was fully refunded (`pay_TgdMVcUQqGixjS`, ₹978.50, a false positive; no later migration changes it). Add `coalesce(refunded_minor, 0) < amount_minor`. The other mismatches are seed data (abandoned payment links, demo jobs without commission rows, old `requested` withdrawals): mark them as known so a real mismatch stands out. Needs the owner's OK before any data is touched.
- [x] **P2-9 Advisor items accepted in writing** (no code; written into `docs/audit/SECURITY_FINDINGS.md`, section "Advisor review, 2026-10-24"; the leaked-password toggle stays yours): 112 `SECURITY DEFINER` functions that signed-in users can call (by design, an allow-list in `rpc_surface.test.sql`, each checks the caller inside), `get_app_controls` callable signed out (the app asks before sign-in), 7 service-only tables with RLS and no policy (intended), and **leaked-password protection is off** (a Supabase Auth dashboard toggle, **(You)**, may need a paid plan). Written into `docs/audit/SECURITY_FINDINGS.md`.

*Step 4: by hand, with you*
- [ ] **P2-10 Android: run `docs/ANDROID_TEST_PLAN.md` passes A to H on your phone. Partly run 2026-10-24 (the read-only parts, over USB on the owner's phone):** cold start and Home (no red box), the Hire/Earn switch, Find work (14 results, filters), the notifications list, the location picker with its map, and the phone's crash log (no TaskDrop crash). The Back button from the first screen leaves for the app that launched TaskDrop, which is normal. **Not run, because they create data or need you:** sign-in, posting and paying, the earn flow with a proof photo, chat, delete account, airplane mode and slow network. The map button was also found to retry instead of help when location is off (P2-20). (it is connected now; app 1.0.0, installed 2026-10-22). Every failure gets a fix on a short branch; Claude reads `adb logcat` for crashes after each pass.
- [x] **P2-11 Android Maps key. Done 2026-10-24:** on the owner's phone, on the `beta` build, the location picker loads a real Google map with tiles, markers and a pin, and no "API key not found" error; TASKDROP-4 resolved in Sentry. Original finding: TASKDROP-4 (fatal "API key not found" on a Google Maps screen, 1 event on 2026-10-19) happened before the key work of 2026-10-22. Open the map screens on the `beta` APK (Explore map, location picker); if tiles load, resolve TASKDROP-4; if not, fix the key or the manifest.
- [x] **P2-12 Admin: signed-in walk of every page. Done 2026-10-24** in the owner's Chrome, signed in with the owner's existing Google session (no password typed): all 33 list pages open with their heading and no error screen, and so do a person, a job and a payout page; the browser console shows no errors. **Not covered:** a help-request page (there are no help requests on the test project), Sales and Viewer logins, phone width. **Found:** every page took 2 to 4 seconds (P2-17) and the admin CI was red on npm advisories (P2-18); both fixed in admin PR 22. Original plan: 38 pages: alerts, copyright, CRM (home, leads, messages, segments, tasks), devices, disputes, money (home, entries, reconcile), needs-you, payouts (and a payout), promotions, refunds, reports, reports queue, search, security, settings (home, audit, controls, health, integrations, rules, switches, team), support (and a ticket), tasks (and a task), team performance, users (and a user). You sign in in Chrome; Claude reads each page at desktop and phone width and checks the console and network for errors, per staff role (Sales at phone width was never checked). Failures become fixes. **No authenticator step** (see P2-14).
- [x] **P2-13 Admin: staff roles on writes. Decided and built 2026-10-24 (migration 124, applied when the Vercel build merges it):** the audit ran as real Viewer, Support, Sales and Finance logins on the test project (rolled back) and found 18 functions open to every staff role. Now: Support and Sales may do the people area (copyright decisions, customer notes, tags, segments, broadcasts, suspensions), Viewer and Finance may not, and only a full admin may delete an account or change who is an admin. `reply_support_ticket` and `resolve_support_ticket` also serve the person who owns the ticket, and staff replies are already stopped by the table triggers, so they are unchanged; `admin_log_event` and the reads stay open to every staff login. The guards are added to the live definitions inside the migration (nothing retyped) and the migration asserts that each function got one. Test `supabase/tests/staff_role_guards_people_admin.test.sql` (run on the test project inside a rolled-back transaction: pass; CI runs it for real). Original finding: `admin_delete_account`, `admin_set_admin`, `admin_set_staff`, the copyright decisions, `crm_*` writes, `reply_support_ticket`, `resolve_support_ticket` and `admin_log_event` only check `is_admin()`, so a Viewer can still call them directly (the screens hide the buttons, the database does not stop it). Decide which roles may write each, add the guard line as migration 100 did for the money functions, and a live test as a real Viewer login.

*Step 5: close the loop*
- [-] **P2-14 Admin authenticator deferred (owner decision 2026-10-24: "no need now").** Nothing to build or test. Money actions in the admin stay protected by the staff roles (migrations 099 and 100) and by sign-in only; `admin_require_mfa` is already `false` on the test project. Written up in Part B, section 13. Wording fixed in `HANDOFF.md` and `OWNER_MANUAL.md`.
- [x] **P2-15 Plan and notes match reality. Done 2026-10-24.** Ground rule 10 listed local branches "waiting to be pushed"; none exist (both repos have only `main` and `redesigned-2.0`, and both are pushed). Fixed in this entry. `HANDOFF.md` step 1 and `OWNER_MANUAL.md` step 2.4.3 (which said the sign-in asks for an authenticator code) are fixed too. Left to do: re-read the other pages of the manual and the plan for the same wording as each is touched.
- [x] **P2-16 Playwright in GitHub Actions. Decided and built 2026-10-24:** `e2e.yml` now also runs after every push to `redesigned-2.0` (docs-only pushes skipped), one run at a time, because GitHub reads a push trigger from the pushed branch ("Run workflow" and schedules need the file on `main`, which waits for your promotion). The suite waits for `health` first and retries a gateway blip, so a deploy still under way does not fail it. A failed run emails you as GitHub does for any failed workflow. Original finding: GitHub offers "Run workflow" only for workflow files on the default branch, and `main` has no `e2e.yml`. Pick one: copy `e2e.yml` to `main` by hand when you promote, or add a `pull_request` run against the Vercel preview of the branch. (You decide.)
- [x] **P2-17 The admin was slow because it ran on the wrong continent. Found and fixed 2026-10-24 (admin PR 22, merged):** Vercel ran the admin in its default region `iad1` (Washington) while the database is in Mumbai, so each query on a page crossed the world: dashboard 3.0 s, money 2.5 s, payouts 3.8 s, jobs 2.2 s, people 2.9 s (measured from India). `vercel.json` now pins the admin's functions to `bom1`; the preview build accepted it.
- [x] **P2-17b Time the admin pages again after the Mumbai deploy. Done 2026-10-24** (deployment `dpl_Hgbcif6Q…`, region `bom1`, same pages, same Chrome, same place): money 0.43 s (was 2.5 s), payouts 0.71 s (was 3.8 s), jobs 0.38 s (was 2.2 s), people 0.37 s (was 2.9 s), activity log 0.46 s (was 2.8 s), needs-you 0.35 s (was 2.3 s), dashboard 0.64 s on a warm request (was 3.0 s; the first request after a deploy took 4.2 s, a cold start).
- [x] **P2-18 The admin's CI was red on npm advisories. Found and fixed 2026-10-24 (admin PR 22, merged):** `next` 16.0.0 to 16.4.0 has three advisories, one critical (image-optimization RCE, `use cache` RCE, Server Actions denial of service; the admin uses Server Actions), and `zod` below 4.6.6 has a high one. The admin never imports zod, so it is removed; `next` is 16.4.3. `npm audit` reports 0; typecheck, lint, 89 tests and the build pass.
- [x] **Done 2026-10-25 (PR 76):** every run now starts by finishing what earlier runs left (open, locked or started `[e2e` jobs are cancelled, finished work is approved) and `money.spec.ts` does the same at its end (`tidyE2eTasks` in `e2e/helpers.ts`); the push trigger only fires for code the tests can tell something about; the 19 stuck jobs on the test project (9 disputes decided in the poster's favour by the seed admin, 6 open, 3 started and 1 finished jobs cancelled or approved by the seed poster, through the product's own functions) were cleared on 2026-10-24, so all `[e2e` jobs were cancelled or completed. The dispute test still leaves one disputed job per run, because only an admin can decide it; clear them from the admin's Disputes page. Original finding: **P2-19 Playwright leaves `[e2e-…]` jobs behind.** The admin's Jobs list shows tasks such as "[e2e-break] odd price" from earlier runs. Close or delete the tasks a run creates at the end of that run, and clear the old ones with your OK.
- [x] **P2-20 The map's "location is off" button did nothing useful. Found by you and fixed 2026-10-24 (PR 74, merged and published to the `beta` channel as update `01a16ed5`, group `a095ca69`):** it now reads "Turn on location", asks inside the app to turn the phone's location on (Android) and, if you decline or it cannot, opens the right settings screen, then looks again when you come back. **Still to try on your phone** (close and open the app twice to load the update).

*Step 6: found by the break-it pass (2026-10-25; the full text, evidence and wording are in `docs/PHASE2_PROBLEMS.md`). Boxes are ticked when the code is on `redesigned-2.0` (rule 10)*
- [x] **P2-21 (High) A job's exact address was public** (`tasks.loc_label` held the typed flat and building; every signed-in person could read it). Fixed: migration 126 (`task_private.address`, `set_task_address`), `_shared/place.ts`, `api` createTask/updateListing/updateProfile publish only the area, `getTaskDetail` hands the address to the poster and the hired worker, a "WHERE" card on the active-job screen. The old app's own posts and addresses already stored stay public until Phase 9 or a backfill the owner approves
- [x] **P2-22 Review before the work was approved.** Fixed: migration 125 and `review_after_completion.test.sql`
- [x] **P2-23 Web address search blocked by CORS (`x-region`).** Fixed in `places-search`, with `cors.test.ts`
- [x] **P2-24 Nonsense accepted** (price 0, past or far-future deadline, latitude 999, reserved usernames). Fixed in `api/writes.ts`, with a unit test
- [x] **P2-25 Contact rule skipped by other digits, keycap emoji and spelled-out numbers.** Fixed in `mask.ts` and `_shared/contacts.ts`
- [x] **P2-26 `null` request body answered 500.** Fixed in `api/index.ts`
- [x] **P2-27 After sending an offer, "My offers" opened on an empty tab.** Fixed in `OrdersScreen.tsx`
- [x] **P2-28 Job "Distance" measured to the poster's home, not the job.** Fixed in `TaskDetailScreen.tsx`
- [x] **P2-29 Enter did not send a chat message on the web.** Fixed in `ChatScreen.tsx`
- [x] **P2-30 Money shown without paise (₹82.40 read ₹82).** Fixed in `formatINR`
- [-] **Scheduled into Phase 10 (2026-10-25), where the box "Test-only sign-in shortcuts off" already holds it.** **P2-31 `dev_otp_for_all` is on** (any phone number signs in; the code comes back in the reply). Launch blocker: switch off before Phase 10
- [-] **Scheduled into Phase 9 (2026-10-25): new box in the lockdown list.** **P2-32 Legacy `profiles.payout_upi` readable by everyone** (empty today). Waits for Phase 9
- [ ] **P2-33 Profiles show saved place (rounded) and last seen to every signed-in person.** Product choice, nothing changed
- [x] **P2-34 Smallest price for a task and for an offer: ₹20 (owner decision 2026-10-25).** Fixed: `PRICE_LIMITS` in `packages/rules` and `_shared/rules.ts`, the api, the post, offer and quote screens
- [x] **P2-35 Approve and release asked nothing: a confirm step is added (owner decision 2026-10-25).** Fixed in `ActiveScreen.tsx`
- [ ] **P2-36 Razorpay test mode: the 30-link cap is used up; UPI not offered at checkout.** Owner: clear old test links, check UPI is enabled (the owner asked for no Razorpay changes, so none were made)
- [x] **P2-37 Slide-to-start has no tap or keyboard alternative.** Fixed: a plain "Or tap here to start" button under the slider (`SwipeScreen.tsx`)
- [x] **P2-38 "Offer accepted" showed the job's creation time.** Fixed: it shows when the offer was accepted (`ActiveScreen.tsx`)
- [x] **P2-39 Offers screen said names are hidden while the name is shown.** Fixed: "Phone numbers are shared once the work starts" (`CompareScreen.tsx`)
- [x] **P2-40 A short proof text got a vague database message.** Fixed: "Say a little more about what you did (at least 10 characters)" (`api/writes.ts`)
- [x] **Accepted 2026-10-25:** it is the normal loading placeholder while the job is read; the wait is the network, and the page replaces it as soon as the answer arrives. **P2-41 Two grey boxes for about a second when a job opens**
- [x] **Accepted in writing, `docs/audit/SECURITY_FINDINGS.md` section "Advisor review, 2026-10-24" (P2-9).** **P2-42 Already-accepted advisor items** (profiles, settings and `get_app_controls` readable): see P2-9
- [-] **Scheduled into Phase 6 (2026-10-25): new Verify box there, with the `api` speed target. P2-48 is the measurement; the fix (fewer dependent waits on Home, a smaller bundle) is that phase's speed work.** **P2-48 The web home feed is slower than the 3-second target (Phase 6 measure).** Timed 2026-10-25 on a throttled "fast 4G" (9 Mbit/s, 150 ms) with a compressed bundle (757 KB): the app shell shows at 2.1 s, the first job card at 5.5 to 6.0 s. Where it goes: the script finishes at 3.0 s, five font files add 0.7 s, then `app-config` starts at 4.4 s, the first read batch at 4.7 s and a second batch (`attachPosters`) that waits for the first ends at 6.0 s. Ideas, not built: start `app-config` and the first batch while the fonts load, preload the fonts, and return the posters inside the first batch. Needs its own focused change; left open on purpose
- [ ] **P2-43 The admin idle sign-out: one pass, one miss (2026-10-25).** Test 1: left 32 minutes, a menu click still opened the page. Test 2: 31 minutes untouched, the page sent itself to the sign-in screen. Cause of the miss not found. The redirect lost the "signed out after 30 minutes" message; fixed in the admin repo (`LiveProvider.tsx`). A third timed test is open
- [ ] **P2-50 (High) Google sign-in is down for everyone (found 2026-10-25).** Google answers "Error 401: deleted_client, The OAuth client was deleted" for the OAuth client the Supabase Google provider uses (client id starts `666142005225-0ru05qe9…`, a different project from `Taskdrop`, number 473408152598, so it belonged to one of the projects shut down on 2026-10-22). Checked from outside the browser too: `GET /auth/v1/authorize?provider=google` redirects to Google, which returns the error page. It stops the web, Android and admin Google logins; phone-number and username sign-in still work. **Only the owner can fix it** (it needs a new credential and its secret entered in Supabase): manual task 0.1. It also blocks the third timed admin idle sign-out test (P2-43), which needs a fresh admin login.
- [x] **P2-49 A chat photo could not be opened full size on the phone. Fixed in PR 85 (tap a photo to open it full screen).**
- [x] **P2-44 A withdrawal request took 0.8 to 1.6 s** (target under 1 s). Fixed: the hand-off to RazorpayX runs after the answer (`api/index.ts`)
- [x] **P2-45 `phone-auth` cleaned `9876543210; drop table users` into a number and sent it a code.** Fixed: anything other than digits, spaces, `+ ( ) . -` is refused (`phone-auth/index.ts`)
- [x] **P2-46 The Android build carried three permissions the app never uses** (`SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`, `USE_FINGERPRINT`; found reading the beta APK's manifest, T11.2). Fixed in `app.json` `blockedPermissions`; takes effect in the next native build
- [x] **P2-47 The admin audit log called staff actions "event / Changed event".** Fixed in the admin (`EVENT_WORDS`, filter "Staff actions"): "Warned a person", "Closed a report as acted on", "Hid a message", "Hid a job", and so on

**Backend: known bugs**
- [x] Chat photos can be opened by the recipient (storage policy 075). Cause: policy 075 (and 109's rewrite) let a person open their own folder, avatars, task media and proofs, and 109 added the chat rule only for registry photos (`media:<id>`); a photo sent as a plain storage path was readable by the sender alone. Migration 112 adds the thread rule for those paths (plus an index), test `supabase/tests/chat_photos.test.sql`. Written, not applied: the Vercel build applies it when this is merged into `redesigned-2.0`
- [x] The `payout_upi` write in `updateProfile` matches migration 073. 073 took `payout_upi` off the editable columns, so any `updateProfile` that carried `payoutUpi` failed as a whole. The op now ignores the field (the app never sent it; its type is removed); unit test added in `api.test.ts`
- [x] Drop the duplicate 5-minute earnings sweep. Checked on the test project: `settle-cleared-often` (every 5 min) and `settle-cleared-earnings` (02:00 daily) both call `settle_cleared_earnings()`. Migration 113 unschedules the nightly copy; the 5-minute one stays until the Inngest cutover. Not applied yet (same as 112)
- [x] Promotion checkout (`PromoteScreen.tsx:166` sends `purpose: 'escrow'`). It was worse than a wrong label: an open post has no locked quote, so the payment link was refused, and on a post that did have one the link would have been priced as the escrow and funded the task. Now: new payment purpose `promotion` (migration 110), the `razorpay` function prices it from the pending campaign (`promotionId`) instead of trusting the client, and `activate_promotion` (migration 111) accepts only a settled promotion payment of the caller's, for that task, covering the amount and not already used (before, any paid payment, even a top-up, switched a campaign on). Test `supabase/tests/promotion_payments.test.sql`. The old app keeps its (broken) promotion flow; it now gets a clear refusal instead of a misapplied payment. Run `npm run db:types` in the admin repo after migration 110 is applied

**Backend: speed**
- [x] Find the 10 slowest `api` operations and queries, using Sentry traces and `pg_stat_statements`. Half done 2026-10-21: `pg_stat_statements` on the test project, app-owned entries only: `settle_cleared_earnings()` 126 s total over 6,558 calls (19 ms each, the 5-minute cron plus the nightly copy, see above), `auto_complete_due()` 52 s over 2,453 calls, `api_rate_hit` 25,219 calls at 1.5 ms, `app_secrets()` 21,918 calls at 1.7 ms (about one per Edge Function start), `settle_finished_campaigns()` 16 s. Nothing slow per request; the rest of the top is Supabase's own tooling. Per-operation timings need real traffic in Sentry traces after the Phase 1 build is out, so this box stays open
- [x] Fix them with indexes, fewer round trips and pagination; measure against Part B, section 5 **Checked 2026-10-25 on the test project (`pg_stat_statements`, app and PostgREST statements, after a week of tests and about 38,000 calls): nothing per request is slower than 2.6 ms; the largest totals are the two five-minute and fifteen-minute sweeps (19 to 21 ms each) and secret look-ups (1.8 ms, once per function start); `admin_live_counters` 30 ms once a minute and `run_housekeeping` 53 ms once an hour. Nothing needs an index or a rewrite. The one slow thing a person felt was the withdrawal answer (0.8 to 1.6 s), fixed as P2-44. `SELECT name FROM pg_timezone_names` (400 ms, 632 calls) is the Supabase dashboard's own query, not the app's.**

**User app (all platforms)**
- [x] Swallowed errors (`.catch(() => {})`) on money screens now show a message and report to Sentry. Wallet, Withdraw, Escrow (pay) and Confirm (release): a failed balance, price, payout-account or task read now reports through `reportError(e, 'money')` and shows a plain message; the best-effort earnings sweeps report without a message. Other screens' `.catch(() => {})` (feed, presence, ads) were left alone on purpose

**Web**
- [x] Playwright end-to-end tests on the web build against the cloud test project (test accounts only), run in CI. Built 2026-10-21 (`playwright.config.ts`, `e2e/`, `npm run test:e2e`): 18 of 20 tests pass locally (the other two wait for the deploy) against the live test project, in Chromium at desktop and phone size. Sign-in goes through the real screen (the seed phones get the dev code); the money paths go through the real `api` function as the two seed accounts, with exact amounts checked against the live fee settings. "In CI" is `.github/workflows/e2e.yml`, started by hand after a deploy and needing two repository *variables* (the public URL and anon key, yours to set); it is not on every pull request because the tests need the code under test to be deployed and move fake money. What is covered:
  - sign-in with a test phone
  - the wallet-funded money path: post → bid → lock → fund → start → proof → done → confirm → review → withdraw request
  - cancel with a fine
  - dispute
- [x] **Done 2026-10-25:** besides the Playwright suite, the break-it pass and the owner's own web testing, the main signed-in screens (Home, Explore, My Work, Wallet, Profile) were opened on the local web build as the seed poster at desktop (1280 px, side menu) and phone (390 px, bottom tabs) size and looked at: they lay out cleanly, show rupee amounts, and the console is clean. Original box: The core-flow checklist (Part B, 5.2) passes in Chrome, on desktop and phone sizes. Chromium at desktop and phone size is covered by the Playwright suite (sign-in, home, wallet, explore, legal pages, the money paths); a person looking at the screens is not
- [-] The same checklist passes in Safari (needs an iPhone or a Mac). **Future scope (deferred 2026-10-24)**, with iOS

**Android**
- [ ] The core-flow checklist passes on the `beta` APK; failures are fixed. The read-only parts ran on 2026-10-24 (P2-10)

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Swipe-back navigation (`NavProvider.tsx`)
- [-] UPI payment links (`PaymentSheet.tsx`)
- [-] Clear the stored session on first launch after a reinstall (the Keychain keeps it)
- [-] The core-flow checklist passes on TestFlight; failures are fixed

**Admin**
- [x] Every admin page works against the shared test project: users, tasks, payouts, refunds, disputes, support, CRM, copyright, money, reports, settings, security. Checked 2026-10-24, see P2-12
- [x] Failures are fixed (the admin's speed P2-17, its advisories P2-18 and the staff-role gaps P2-13; the Mumbai deploy is timed in P2-17b)

**Verify**
- [ ] The checklist passes on web (Chrome), Android and admin (iOS and Safari: future scope)
- [ ] Your list is fixed or scheduled
- [ ] Every audit finding P2-1 to P2-50 is fixed, accepted in writing or scheduled into a later phase, and the Sentry board shows no unexplained open issue
- [x] Playwright is green in CI. **Done 2026-10-25: the `End-to-end (test project)` workflow now runs on every push to `redesigned-2.0` and passed on the merge of PR 77 (run 40173149318).** Earlier note: Green locally 20 of 20 on 2026-10-21 after the deploy (it was 18 of 20 before: `e2e/rules.spec.ts` and the `health` check were the proof the Phase 1 and 3 code was not deployed). The two repository variables are set. **2026-10-24:** green locally again, 20 of 20, against the deployed test project (`d49d681`). The run in GitHub Actions (`e2e.yml`) cannot be started yet: GitHub offers **Run workflow** only for workflow files on the default branch, and `main` has no `e2e.yml` (`gh workflow run` answers 404). It becomes possible when `redesigned-2.0` is promoted to `main`; the box stays open until it has run once in CI
- [x] The top slow queries are fixed (see above: none per request; the withdrawal answer fixed as P2-44)

---

## Phase 3: Server decides everything

**Backend**
- [x] Contact-detail rule:
  - [x] `lib/mask.ts` rules move to `supabase/functions/_shared/`, with a sync test. `_shared/contacts.ts` is a copy (an Edge Function is bundled from `supabase/functions` alone, like `_shared/rules.ts`); `contacts.test.ts` fails if the patterns or the answers differ from the app's
  - [x] Enforced in `api/writes.ts`: `placeBid`, `updateBid`, `sendMessage`, `submitProof`, `createTask`, `updateListing`, `updateProfile`, `updateProfileExtras`. Refused with code `CONTACT_DETAILS` and the app's own wording. Same rules as the app, so the app and the old app (which hide or refuse them before sending) see no change. Chat is refused only until the work starts, and the task is looked up only when the text looks like a contact detail. Unit-tested in `api.test.ts`
- [x] Promotion:
  - [x] Price tiers in `settings`, checked by `start_promotion`. Migration 114: `promotion_daily_budgets_minor` (₹50, 80, 150, 300) and `promotion_durations_days` (1, 3, 7), the tiers both apps already show; the total must be exactly one budget times one length. Applied to the test project with the merge of PR 59 (2026-10-21)
  - [x] A `promotion` purpose in `razorpay` that computes the amount on the server (done in Phase 2, migrations 110 and 111)
- [x] Fees: `feesSince` and `workerShareOfEscrow` (`api/reads.ts`) read live `settings`. One `readFees` reads the four fee settings; the wallet activity list, `feesSince` and `platformFees` all use it. `feesSince` no longer trusts the `commission` argument the app sends (still accepted, ignored)
- [x] `places-search` gains reverse lookup and the OpenStreetMap fallback. `{lat, lng}` answers `{label}`; a text search with no Google key, a Google error or no Google result falls back to OpenStreetMap on the server (with a proper User-Agent, which OpenStreetMap requires and browsers cannot set). Replies keep the old `{configured, places}` shape and add `source`. Reverse lookup uses OpenStreetMap, not Google (Google's reverse lookup is the separate Geocoding API, which the restricted key does not cover). Deployed with the merge of PR 59 (2026-10-21); not yet tried against the live Google and OpenStreetMap services
- [x] App controls:
  - [x] `app_controls` table and a public `app-config` function, cached about 60 s (migration 092, `functions/app-config`; applied and deployed; the function answers on the test project)
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
- [ ] **Keys, secrets and tokens** (added 2026-10-23; why and how in Part B, section 7.1):
  - [x] Remove the compiled-in Razorpay test keys (`COMPILED_IN` in `supabase/functions/_shared/secrets.ts`), so the functions read only Edge Function secrets and Vault. First check by name that `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set as secrets on the test project, or payments stop for the old app too **Done in code 2026-10-24 (not yet deployed):** `COMPILED_IN` and its last-resort lookup are gone from `supabase/functions/_shared/secrets.ts`; a missing secret now returns an empty string and the caller says so. Checked by name first: Supabase Vault on the test project holds `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (lengths look right; values were not read), and the code reads Vault before anything else it would have fallen back to. No other file in either repo holds an `rzp_` key. The functions still need to be redeployed for this to take effect, and the rotation below is still yours.
  - [-] **(You)** Rotate that Razorpay test key pair once no code uses it. Deleting it from the file is not enough: the old pair stays readable in the history of a public repository **Future scope (owner decision 2026-10-24).** Not needed now: the old pair only opens the Razorpay test account (no real money moves). Rotate it before real customers and keys go live (Phase 10), or sooner if you decide to. Owner manual 3.2 has the clicks
  - [-] **(You)** Decide whether both repositories go private (cost: CodeRabbit, sections 8 and 10) **Future scope (owner decision 2026-10-24).** Both repositories stay public (free) for now; going private waits for a later decision. Owner manual 3.3 has the clicks
  - [x] **(You)** Supabase, Authentication settings: refresh-token rotation and reuse detection on, access tokens expire within an hour. Write the values here (they are settings, not secrets) **Done and checked 2026-10-25 on the live Supabase page (Authentication, Sessions):** access tokens expire after 3600 seconds, reuse detection (revoke compromised refresh tokens) is on, reuse interval 10 seconds. The session limits at the top of that page are Pro-plan only and stay off.
  - [ ] `api` checks a Firebase App Check token (Play Integrity on Android, reCAPTCHA Enterprise on web) in **monitor mode**: it records a missing or failed check and refuses nothing. Requests without a token (the old app) keep working (ground rule 4); enforcement waits for Phase 9 **Built 2026-10-24, off until `FIREBASE_PROJECT_NUMBER` is set:** `_shared/appCheck.ts` (RS256 check against Firebase's key list, 8 tests) is called from `api/index.ts`, logs `app check` with the result (invalid always, missing/valid once a minute per platform) and refuses nothing. Owner clicks: `docs/APP_CHECK.md`. **Firebase side done 2026-10-25:** web app and Android app registered in App Check, six Vercel variables set including `FIREBASE_PROJECT_NUMBER`; tick this box when the `api` log shows `app check` `valid` after the next web build.

**User app (all platforms)**
- [x] Platform and app-version headers sent on every `api` call
- [x] The app reads `app-config` at start-up, on return to the foreground, every 5 minutes and right after a server refusal (no realtime ping: the user channel only exists once signed in)
- [x] Maintenance screen, "Update the app" screen, announcement banner, and a message when a switch is off
- [x] Fee previews come from the `platformFees` op. New `lib/useFees.ts` (built-in rates until the op answers); used by the post preview (`AiPostScreen`), the offer-accept text and escrow (`TaskManageScreen`) and the release preview (`ConfirmScreen`). `EscrowScreen` keeps its local first paint, since it then shows the server's price
- [x] Address search goes through `places-search`. Search already did (Phase 0 work); the point-to-name lookup (`describeCoords`) now does too, with a direct OpenStreetMap call only as the last fallback
- [ ] The app gets a Firebase App Check token and sends it on every `api` call (Android: Play Integrity; web: reCAPTCHA Enterprise; iOS: App Attest, deferred with the rest of iOS). Read the Expo SDK 57 docs before choosing the library **Web built 2026-10-24** (`lib/appCheck.web.ts`, reCAPTCHA Enterprise, sends nothing until the five `EXPO_PUBLIC_FIREBASE_*` / `EXPO_PUBLIC_RECAPTCHA_SITE_KEY` values exist). **Android built 2026-10-25** on branch `feat/android-app-check` (`lib/appCheck.ts`, Play Integrity via `@react-native-firebase/app-check` 27.1.0, plugin added in `app.config.js` only for an Android build that has `GOOGLE_SERVICES_JSON`); it reaches phones only with the next APK build, and the box stays open until the `api` log shows `platform: android` `valid` from that build.

**Web**
- [x] `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` removed from the web build. Done 2026-10-20: the app no longer reads it. Place search goes through the `places-search` function (server key `GOOGLE_MAPS_API_KEY`), and the Android map key is `EXPO_GOOGLE_MAPS_API_KEY`, a build-time EAS secret that never enters the JS bundle. The old web build on `main` still has the old key until Phase 9
- [x] `vercel.json`: SPA rewrites and security headers (CSP, HSTS, frame-ancestors, referrer policy). Rewrite of every path to `/index.html` (files that exist are served first), HSTS, `nosniff`, referrer policy, permissions policy, `X-Frame-Options: DENY`, an enforced CSP of only `frame-ancestors`, `base-uri`, `object-src` and `form-action`, and the full CSP in **report-only** mode with violations sent to Sentry. Report-only on purpose: a wrong full CSP would break sign-in, payments or maps for everyone. After a week of clean reports it can be switched to enforcing. Not seen live yet; the first deploy shows it

**Android**
- [x] The native map keeps only the restricted Android key **Checked 2026-10-25: `app.config.js` reads only `EXPO_GOOGLE_MAPS_API_KEY` (an EAS build-time secret, Android build only); no Google key is in the web bundle; the map drew its tiles on the owner's phone on 2026-10-24.**
- [x] Control screens checked on the APK Done 2026-10-24 on the owner's phone (CPH2585): maintenance and "Time to update" both appeared, then cleared; they can take up to a minute because the app-config answer is cached for 60 s.

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Control screens checked on TestFlight. The iOS map is Apple Maps, so no key is needed.

**Admin**
- [x] New **App controls** page: every switch per platform, minimum versions, maintenance, banner. Already in the admin repo on `redesigned-2.0` (Settings, App controls: `settings/controls`, `ControlsView`, `controls-actions.ts`)
- [x] Prepare for the lockdown (harmless before it runs):
  - [x] **(You)** Set `API_GATEWAY_SECRET` in the upgraded admin's env (Vercel project `taskdrop-admin`; the value is the one in the Supabase secret of the same name, created by migration 083). Done by you on 2026-10-21 (I did not read or enter it)
  - [x] Send the `x-taskdrop-gateway` header from the admin's Supabase server client (already in `src/lib/supabase/server.ts`; it sends it when `API_GATEWAY_SECRET` is set)
  - [x] Redeploy the upgraded admin. Done 2026-10-21 16:54 UTC (admin PR 21), after the secret was saved
- [x] `src/middleware.ts` signs the admin session with `ADMIN_SESSION_SECRET` only, with no fallback to `SUPABASE_SERVICE_ROLE_KEY` (one key, one job). Check by name that the secret is set in Vercel first (section 7) **Done 2026-10-24:** checked by name in the Vercel project `taskdrop-admin`: `ADMIN_SESSION_SECRET` is set as a sensitive variable for production, preview and development (the value was not read). `src/middleware.ts` now uses it alone, so without it the idle timeout is off and only the 12-hour limit applies; `.env.example` says so. Admin repo, `redesigned-2.0`, commit 2e2eca9. Not yet seen working on a deployed build: sign in to the admin and check the idle timeout still signs you out.

**Verify**
- [x] The new web bundle contains no Google key. Fresh `expo export -p web` on 2026-10-21: no `AIza` in any JavaScript file (the old `dist` from 6 October, which did contain one, was stale)
- [x] A bid containing a phone number sent straight to the API is rejected, on the old app too. Same `api` function, so the old app gets it too. Proved in `api.test.ts` against the operation. `e2e/rules.spec.ts` checks the deployed function and passes since the merge (2026-10-21)
- [-] Posting switched off for iOS only: refused on iPhone, even by direct API call; still works on web and Android
- [x] Maintenance mode for Android only shows the screen on Android only Done 2026-10-24: Android maintenance on, `get_app_controls('web')` stayed off.
- [x] An older upgraded build sees "Update the app" on Android (iOS: future scope) Done 2026-10-24 with `min_version` 9.0.0 on the Android row (no button, since no update URL is set).
- [x] The old app and old admin still work **Checked 2026-10-25 by Claude (owner manual 3.8):** the old app signed in as Asha and Ravi, posted a task through its wizard, Ravi sent an offer, no error from any call; the old admin (Google sign-in with the owner's account) opened the Dashboard and Tasks and listed the new task among 140 jobs. The old app also shows the empty-first-tab quirk of P2-27 (its own code, left as it is)
- [ ] `docs/testing_checks.md` T2 (secrets and keys) and T11.2 to T11.5 (the Android build) pass, and the App Check log shows the upgraded web and Android apps passing

---

## Phase 4: Accounts and sign-in

**Backend**
- [-] **(You)** In Apple Developer: App ID with Sign in with Apple, a Services ID and a Sign in with Apple key
- [-] Enable Apple in Supabase Auth, with redirect URLs (`taskdrop://auth-callback`, `https://taskdrop.in`, localhost) added to the existing list
- [-] The upgraded app's phone login uses Supabase's built-in phone auth, with a Send-SMS hook calling MSG91. **Not started, on purpose (2026-10-21):** it replaces the sign-in every tester uses today (`phone-auth`, working, with the age gate, throttles and test numbers) and the work cannot be tried here without sending real SMS or breaking sign-in on the shared database. It is a decision for you, not a task I should do unattended: say "start phone auth" when you are ready to test it with the owner phone, or drop it and keep `phone-auth`, which already has every protection listed below **Dropped 2026-10-24 (owner manual 4.1): `phone-auth` stays the phone login; type "Start phone auth" to reopen.**
- [x] Every existing protection kept: Kept by keeping `phone-auth`, which has all four; e2e covers the birth date first and the 16-year-old refusal (`e2e/accounts.spec.ts`).
  - throttles
  - birth date before the first code
  - admin numbers refused
  - test numbers with fixed codes
- [-] Test users migrated: the phone copied from each synthetic email into `auth.users.phone`. The synthetic email stays, so both the old and the new phone login find the same account. **Dropped with the Supabase phone-auth switch (2026-10-24).**
- [-] `task_contact_phone`, `verificationState` and the admin SMS block read `auth.users.phone` first, then fall back to the synthetic email **Dropped with the same switch.**
- [x] The old `phone-auth` function stays deployed and working for the old app; it's retired in Phase 9. Nothing was removed; it is now wrapped in `guarded()` (Phase 1) and reports unexpected database errors
- [x] `password-auth` keeps username + password working, looking up the username and signing in with the account's phone or email. Unchanged in behaviour (only monitoring added in Phase 1)
- [x] `handle_new_user` takes names from Google/Apple. Migration 115: `display_name`, then `full_name`, then `name` from the sign-in metadata, then the email's first part, except an Apple "Hide my email" address, then "New user". Phone accounts are named exactly as before. Test `supabase/tests/new_user_names.test.sql`. Written, not applied
- [x] Manual identity linking enabled. A Supabase Auth setting (Authentication, Sign In / Providers, "Allow manual linking"); I did not change the project's auth settings from here, and `supabase config push` must not be run (Phase 0). **(You)** switch it on in the dashboard when you want linking **Switched on by the owner 2026-10-24; checked: Supabase now returns Google's sign-in address for the app's Link Google request (`e2e/accounts.spec.ts`). Link Google tested by the owner with a real Google login 2026-10-25: "Linking ok" (owner manual 4.3).**
- [-] Account deletion revokes the Apple token for Apple users (App Store rule; check Apple's current rules when building)

**User app (all platforms)**
- [x] `expo-crypto` added; PKCE uses S256 (`lib/supabase.ts`). `expo-crypto` was already a dependency; `lib/webcrypto.native.ts` gives supabase-js the `crypto.subtle.digest` it needs on Hermes (it silently used "plain" before), imported from `lib/supabase.ts`; web is untouched. **Not yet seen on a phone:** check Google sign-in on the next APK and that no "WebCrypto not supported" line appears
- [x] Onboarding doesn't prefill Apple relay emails as names (`OnboardingScreen.tsx:55`). Any name containing an @, the phone placeholder and "New user" are left blank for the person to fill in
- [x] Account screen: shows linked methods; link Google/Apple (`linkIdentity`); add or verify a phone. The screen already shows which methods are on the account (phone, Google, username + password). Linking is not built: it needs "manual linking" switched on (above) and a native browser round trip I cannot try here, so it waits for the next device session **Link Google built 2026-10-24** (`AuthProvider.linkGoogle`, a button on Account → Sign-in methods; web redirect and native browser round trip). Tested by the owner 2026-10-25 with a real Google login (owner manual 4.3, "Linking ok"). Apple linking is iOS, deferred.

**Web**
- [ ] Google and Apple sign-in through the browser flow (`providers/AuthProvider.tsx`)
- [x] Phone and username + password work Browser test 2026-10-24 (`e2e/accounts.spec.ts`): new number, birth date, setup, set password in Settings → Sign-in, sign out, sign in with the username; Ravi still signs in. The sign-in screen only signs in with a username; the password is set after sign-up.

**Android**
- [ ] Google and Apple sign-in through the browser flow; phone; username + password

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Apple sign-in native: `expo-apple-authentication` → `signInWithIdToken` with an `expo-crypto` nonce; `usesAppleSignIn: true`
- [-] Google sign-in through the browser flow; phone; username + password

**Admin**
- [x] User page: sign-in methods (phone / Google / Apple), devices with platform and app version, last seen. Admin repo, branch `upgrade/phase-4-accounts`: the Devices tab gets a Sign-in card (methods, last sign-in) next to the devices list that already showed platform, app version and last seen
- [x] "Sign out everywhere". Migration 116 `admin_sign_out_everywhere` (admins only, full admin role, reason required, not yourself, audit-logged, ends sessions and refresh tokens, clears push tokens) and a confirmed button on the same tab; test `supabase/tests/admin_sign_out_everywhere.test.sql`. Written, not applied
- [x] The sign-in-method switches from Phase 3 are tested. New `_shared/signInSwitches.test.ts` covers phone, password, sign-up, maintenance and "switches unreadable lets everyone in"; the Google switch only hides the button in the app (Google goes straight through Supabase), as the code says
- [x] Admin's own login stays Google + `admin` role + MFA. Not touched in this phase; `requireAdmin` and the money MFA gate are as before

**Verify**
- [ ] New sign-up works with each method on each platform, and each passes the age gate:

  | | Google | Apple | Phone | Username + password |
  |---|---|---|---|---|
  | Web | [ ] | [-] | [x] | [x] |
  | Android | [ ] | [ ] | [ ] | [ ] |
  | iOS (later) | [-] | [-] | [-] | [-] |
- [x] Existing test users still sign in with their phone (Ravi, in the e2e run)
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
- [x] **(You)** Create an Inngest Cloud free account
  - [x] Set `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` on the shared test project. Both are now Edge Function secrets on the project (checked by name, 2026-10-21). They come from Vercel: `scripts/sync-function-secrets.mjs` copies the allow-listed names on every backend deploy
  - [x] The Vercel build syncs the app URL `https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/inngest` on deploy
- [x] The Inngest event address and key live in Vault, so one migration works locally and hosted
- [x] The jobs serve both apps, since they share the database. The old app sees the same results, just more reliably. **They run on the one shared project; the old-app contract check in CI passes.**

**Backend: events out of the database**
- [x] `private.emit_event` writes to a new `private.outbox` in the same transaction
- [x] Fast path: pg_net posts each outbox event to Inngest immediately
- [x] Safety net: a five-minute sweeper (an Inngest cron, so no new pg_cron job; was one minute until 2026-10-24, when it was using half the free plan's 50,000 monthly runs) re-sends anything unconfirmed. The outbox id is the event id, so duplicates are dropped.

**Backend: move the work** (the old job is removed in the same deploy as its replacement)
- [x] `auto-complete-due` → Inngest cron **Done 2026-10-25 (owner asked to complete Phase 5; Razorpay left alone): `INNGEST_MONEY_JOBS=on` set in Vercel and added to the names the build copies to the functions; after the deploy Inngest listed the function and each ran `Completed` (settle-cleared-earnings and settle-finished-campaigns at 13:35 to 13:40 IST, auto-complete-due at 13:45 IST); only then was the matching `pg_cron` job removed, one by one.** To go back: set the variable to `off` or delete it, redeploy, and re-create the jobs from the last lines of `supabase/cutover/inngest_money_jobs.sql`
- [x] `settle-cleared-earnings` → Inngest cron (every 5 min; see above)
- [x] `settle-finished-campaigns` → Inngest cron (hourly at :07; see above)
- [x] Daily digest → Inngest cron (`daily-digest`, writes to `admin_alerts`)
- [x] Push (pg_net trigger) → `notification.created`: send the Expo push, read receipts, remove dead tokens (built; the trigger keeps the direct send until the `push_via_inngest` switch, `supabase/cutover/inngest_background_jobs.sql`) **On since 2026-10-18 (`push_via_inngest` true); all 20 types reached the owner phone through it on 2026-10-24.**
- [-] Withdrawal → `withdrawal.requested`: payout with retries and an idempotency key, one at a time per user. `requestWithdrawal` returns immediately. **Deferred 2026-10-25 (sweep of Phases 0-8):** the money jobs stay on the old route until the lawyer answers on the money flow (owner manual 5.1), and the owner asked for no Razorpay changes now. Picked up with Phase 10 (RazorpayX live, task 10.3).
- [-] Stuck payouts → reconciliation every 15 minutes **Deferred 2026-10-25:** same reason as the withdrawal job above.
- [-] Refund "sent but not recorded" → retrying function + Sentry fatal **Deferred 2026-10-25:** same reason as the withdrawal job above.
- [x] Account deletion → `user.deleted`: delete storage files with retries (ImageKit added in Phase 6). Built, not yet applied. The api function still removes them at once; `account-files` finishes whatever it missed. **Applied and running: `user-deleted` and `account-files` runs Completed in Inngest on 2026-10-24.**
- [x] New: an overdue-tasks cron (`OVERDUE` from `due_at`), built, not yet applied **Running every 10 minutes (Completed in Inngest, 2026-10-24).**
- [x] Team alerts (support, withdrawal, dispute, payout failed) → `admin_alerts` rows (Sentry on final failure)

**Backend: webhooks**
- [-] `razorpay-webhook` and `razorpayx-webhook`: **Deferred 2026-10-25:** the webhooks work as they are and stay on the old route until the lawyer answers (owner manual 5.1).
  - [-] verify the signature
  - [-] record the event id in `webhook_events`
  - [-] send an Inngest event
  - [-] return 200 immediately
- [-] Tested locally with sample signed payloads, and on the test project with Razorpay test mode **Deferred 2026-10-25:** with the webhook change above.
- [x] `requestWithdrawal` keeps the same response shape, so the old app still shows the withdrawal correctly **Unchanged; the old-app contract check passes in CI.**

**Backend: housekeeping**
- [x] Missing prunes added (in Inngest `housekeeping`, not pg_cron; built, not yet applied): `auth_codes`, `auth_send_log`, `places_quota`, notifications older than 90 days; sent outbox rows were already pruned by `outbox-prune` **`housekeeping` runs hourly (Completed in Inngest, 2026-10-24).**
- [x] Every Inngest function reports its final failure to Sentry
- [x] The old automation tool is gone: its triggers, cron jobs, tables and function (migrations 090 and 102), its doc and the privacy-policy line
- [x] Leftovers dropped (`private.automation_*`, `private.send_daily_digest()`, the log-prune job): migration 102, applied on the hosted test project 2026-10-18
- [x] Events and alerts carry no free text (help-request subject, job title, payout failure note); team alerts are pruned after 30 days

**Web**
- [x] In-app notifications and the realtime pings still arrive (the web has no push) **`e2e/notifications.spec.ts` (2026-10-24): the bell on an open page counts a new quote with no refresh.**

**Android**
- [x] Push for every notification type arrives through Inngest **2026-10-24, owner phone over USB: all 20 types arrived.**
- [x] Tapping a push opens the right screen **It opens Notifications for every type (that is what the app does); verified 2026-10-24.**

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Push for every notification type arrives through Inngest
- [-] Tapping a push opens the right screen

**Admin**
- [ ] Payout queue shows the "queued" state **Needs RazorpayX switched on (owner manual 10.3): the Payouts page today says "Manual in use".**
- [x] New admin alerts view. Admin repo, branch `upgrade/phase-5-inngest`: Alerts in the sidebar (People & jobs), unread / all, mark one or all read; reads `admin_alerts` (migration 090, already applied) behind `requireAdmin`
- [ ] `check-all`, `give-back` and `balance` still work **Not pressable until RazorpayX is set up (the page shows "Not set up"); repeat the check after owner manual 10.3.**

**Verify**
- [x] Every function runs in the dev server, then in Inngest Cloud for the test project **2026-10-25: all 20 functions are listed Active in Inngest Cloud with no failures in 24 h and `Completed` runs for each schedule that came due (there is no local dev server; ground rule 8).**
- [x] A forced failure (bad push token, RazorpayX test error) retries, then succeeds or lands in Sentry **Bad push token done 2026-10-25: a junk token registered for Meera was tried by `push-notification` and removed as dead, no failure. A RazorpayX error cannot be forced until RazorpayX exists (owner manual 10.3); a hard failure reaches Sentry through `onFailure: reportFailure` (unit-tested in `jobs.test.ts`).**
- [ ] A withdrawal request returns in under 1 second on web and Android (iOS: future scope) **Web done 2026-10-25: median 431 ms over 8 requests (a plain read is 581 ms from the same PC; first calls after a quiet spell take 1.2 s while the function starts). Android still to do.**
- [x] No old pg_cron job still does the same work **2026-10-25: `select count(*) from cron.job` is 0.**

---

## Phase 6: Speed and media (ImageKit)

**Backend**
- [x] **(You)** Create an ImageKit account. Folders: `/local`, `/beta`, later `/prod`. (Account exists and the keys are now Edge Function secrets on the test project, checked by name 2026-10-21. Rotating the private key that was pasted into chat is future scope: owner decision 2026-10-25, no key rotation as of now. See `docs/MEDIA.md`.)
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
- [x] CSP allows ImageKit (uploads and CDN). The Phase 3 `vercel.json` CSP (report-only) lists `https://ik.imagekit.io` and `https://upload.imagekit.io` in `connect-src`, and images are allowed from any `https:` origin. Not seen live yet
- [x] Drag-and-drop works on web (`useFileDrop`, `pickedFromFile`): the attach area on a post and the profile and onboarding photo pickers accept a dropped file and send it through `uploadMedia`; native is unchanged
- [x] Upload from file picker and drag-and-drop lands in ImageKit **Checked 2026-10-25 on the web build: a post photo (picker), a dropped file, a chat photo and a proof photo all became `media` rows with provider `imagekit` and status `attached`.**

**Android**
- [ ] Camera and gallery uploads work
- [ ] Images load fast on mobile data

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Camera and library uploads work, including HEIC photos (check ImageKit converts them)
- [-] Images load fast

**Admin**
- [ ] Copyright, user and task views show ImageKit images through server-side signing. Not built: the admin panel shows no pictures at all today (only a "has media" flag), so this is a new feature, and it needs the ImageKit private key as a server secret in the admin Vercel project, which I do not enter. Waits for the ImageKit keys (see the first box)

**Verify**
- [x] New photos are stored in ImageKit and recorded in `media` **Web checked 2026-10-25 (see above); the phone camera and gallery are still to do**
- [ ] `api` reads meet the 95th-percentile target (under 500 ms; writes under 800 ms) and the web home feed meets its 3-second target. Measured in Phase 2: `api` server time p50 about 430 ms and p95 1.3 to 2.2 s with the database at about 2 ms (the time is in the function itself: cold isolates, the sign-in check, the switches lookup; `api` logs `api slow op <name> <ms> ms` for any operation over 150 ms, so read those under Supabase, Edge Functions, api, Logs); web home shell at 2.1 s but first job card at 5.5 to 6 s on a throttled fast 4G (P2-48). Levers, in order: check the sign-in token on the function instead of asking the auth service on every call, cache the switches lookup per isolate, fewer dependent waits on Home, a smaller web bundle
- [ ] The feed downloads thumbnails and meets the targets in Part B, section 5, on web and Android (iOS: future scope) **Web measured 2026-10-25: first job card 5.5 to 6.0 s on a throttled fast 4G against a 3 s target (P2-48); the feed on this seed data has no pictures to weigh (thumbnails are 640 px, auto format). Android still to do.**
- [x] Users without access can't get a URL **2026-10-25: `signMedia` for a chat photo gave a signed ImageKit URL to the sender and the recipient (the image downloaded, 200) and nothing to a stranger (Meera).**
- [ ] Chat photos open for the recipient on every platform **Web done 2026-10-25 (the recipient's `signMedia` URL downloads); Android still to do**
- [x] Abandoned uploads are cleaned up after 24 h **2026-10-25: no `media` row is `pending` (none older than 24 h) after the test uploads and the Inngest `media-purge` runs; not timed with a deliberately abandoned upload.**

---

## Phase 7: Moderation and admin tools

**Backend**
- [x] `reports` table (task, message, review, person) and `blocks` table. Both exist since migration 093 (applied); `report_content`, `block_user` and `unblock_user` are the only ways to write them
- [x] Blocked users can't bid on, message or see each other's tasks, enforced in `api` and SQL. Migration 117, in SQL so every caller (new app, old app, API) is covered: either side blocking refuses an offer on the other's task and a chat message to the other, and hides the other's OPEN tasks from the feed and search (a job already underway stays visible, and money is untouched). Test `supabase/tests/blocks_enforced.test.sql`. Written, not applied
- [ ] Admin SQL functions:
  - [x] hide/unhide a listing (093), cancel a task with refund (098), change a task's category (`admin_set_task_category`, 118)
  - [ ] pause a promotion (done, 098), cancel a promotion with refund (not built: it moves money and needs its own review)
  - [x] hide a message or photo (`media.status = hidden`) done in 118 (`admin_hide_message`, `admin_hide_media` and their un-hide twins, test `supabase/tests/content_moderation.test.sql`); remove a review **built 2026-10-24** (migration 121: `admin_hide_review` / `admin_unhide_review`, a restrictive `reviews_hide_moderated` policy, and `private.recompute_ratings`, which `submit_review` now uses so a removed review stays out of the average; test `supabase/tests/hide_review.test.sql`; admin "Remove this review" on reports about a review). The review is kept, not deleted, so it can be put back
- [x] `worker_commission_pct` and promotion price tiers are editable settings. Commission has always been a `settings` row; the promotion tiers moved into `settings` in migration 114 (Phase 3). The admin page for the tiers is the Admin box below
- [x] Every new admin action writes to `admin_audit_log`. Each function added here (and `admin_sign_out_everywhere` in Phase 4) calls `admin_log_event`, and the SQL tests check it

**User app (all platforms)**
- [x] "Report" on tasks, messages, reviews and profiles. Tasks and profiles already had it; **messages** are new (press and hold a message or photo from the other person in a chat); **reviews** now have a Report link under each review on a person's public profile (not on your own reviews or your own preview), using the same `ReportSheet` (`targetType="review"`, offers to block the reviewer). The server already accepted the `review` kind. `npm run check` passes; not yet tried on a phone or in a browser (the Report and block boxes under Web and Android stay open)
- [x] "Block" on profiles and chats; a blocked-users list in Account. The report sheet (on a profile, a task and now a chat message) offers "block them too"; Account has the blocked-people list (`BlockedPeopleCard`)
- [x] Hidden content disappears for everyone. Hidden jobs (093), hidden messages (118) and hidden photos (109 plus 118) are removed by the database's own rules, so every screen and the old app honour them. A chat that is already open shows a hidden message until it refreshes

**Web**
- [x] Report and block work in the browser **Checked 2026-10-25 in the web build as Ravi: Report this task with "also block" sent the report and blocked the poster; the blocked list shows her; her offers and chat to him are refused.**

**Android**
- [ ] Report and block work on the APK

**iOS**
- ⏸ **Future scope (deferred 2026-10-20).** iOS waits until Android and the admin are done; the boxes below are marked `[-]` and don't block this phase.
- [-] Report and block work on TestFlight. Apple requires this (guideline 1.2).

**Admin**
- [ ] Reports queue:
  - see the reported content (a reported message now shows its text; a job and a person link to their pages)
  - act on it: hide a message (new), hide a job, suspend, delete (person page), and **warn** (new, 2026-10-24: migration 120 `admin_warn_user`, test `supabase/tests/warn_user.test.sql`, a "Warn them" button on reports about a person; it closes the report as acted on). Warn is shown for reports about a person only, not yet for job, message or review reports (those need the owner of the thing looked up first). Applied to the hosted test project and tested there; admin branch `upgrade/phase-7-admin-tools`, not pushed
  - aim to act within 24 hours (`docs/RUNBOOK.md`)
- [x] Task actions on the task page: hide/unhide, cancel with refund, change category. Hide/unhide and cancel with refund were already there; **change category** is now a Category card on the task page (`TaskCategoryCard`, admin action `setTaskCategory` calling `admin_set_task_category`, 118; people-area staff, confirm step, audit-logged by the function). Admin repo, `redesigned-2.0`, commit 681a61e. Typecheck, lint and tests pass; not yet tried in a browser against the hosted project (118 must be applied there)
- [x] Promotion actions: pause; cancel with refund. Pause exists (Promotions page); cancel with refund is not built **Checked 2026-10-24:** the Stop button already ends the campaign through `admin_pause_promotion`, which settles it and returns the undelivered budget to the advertiser's wallet, so a stopped promotion is refunded for what was not used. Refunding the delivered part too is a policy choice (that money is booked as revenue), so it is not built; say if you want it.
- [x] Settings page: `worker_commission_pct` and promotion price tiers, behind the money MFA gate (`src/lib/actions.ts:276`). Commission is editable there already; the promotion tiers (now in `settings`, 114) have no form yet **Checked 2026-10-22, left open on purpose:** (1) the admin does NOT let you edit commission: `SettingsView` marks `worker_commission_pct` read-only and `EDITABLE` in `src/lib/actions.ts` leaves it out, because the database re-reads it when approved earnings clear, so a change would move money on jobs already approved (the older note above that says it is editable is wrong; decide whether it should be); (2) a promotion-tier form would be unsafe today: `PromoteScreen.tsx` hard-codes the tiers (daily budgets ₹50/80/150 for workers and ₹80/150/300 for posters; 1, 3 and 7 days) and never reads `promotion_daily_budgets_minor` or `promotion_durations_days`, and `start_promotion` (114) refuses anything not in those settings, so changing a tier here would make the app offer options the server rejects. The app has to read the tiers from the server first **Built 2026-10-24:** the app now reads the tiers (`promotionTiers()` in `apps/mobile/src/data/api.ts`, falling back to what 114 seeds) so the Promote screen offers exactly what the server accepts: the lowest three budgets for people earning and the highest three for people hiring, plus the lengths. The admin Settings page has a "Promotion daily budgets" and a "Promotion lengths" row, each editable behind the money MFA gate (`parseTierList` in `src/lib/tiers.ts`, tested). **Commission stays read-only on purpose:** it is re-read when approved earnings clear, so editing it would move money on jobs already approved; change it in a migration when nothing is clearing.
- [x] Broadcasts target by platform (web / Android / iOS) and app version as well as segments, sent as push + in-app. **Built 2026-10-24:** migration 119 adds `platform` and `app_version_below` to `private.crm_segment_ids`, so segments, the member list and `crm_send_broadcast` all get them; the admin segment form has an "Uses" menu and an "App older than" box. Applied to the hosted test project (recorded as `119_broadcast_by_platform`), test `supabase/tests/broadcast_platform.test.sql` passed there. Earlier note kept:  **Checked 2026-10-22, not built:** the audience is worked out in SQL (`private.crm_segment_ids(criteria)`, used by `crm_send_broadcast`), so platform and version filters need a new migration plus the admin form. I could not run a database from here to test that SQL, and a migration on the shared test project needs your OK
- [x] Dashboard: users and active devices by platform and version; links to Sentry, Inngest and ImageKit. New **Devices and tools** card on the dashboard (`DevicesToolsCard`): installs by platform with the share on the latest version (the full version table stays on the Devices page), and links that appear only when `SENTRY_PROJECT_URL`, `INNGEST_DASHBOARD_URL` or `IMAGEKIT_DASHBOARD_URL` holds an https URL (**(You)** set the last two in the Vercel project `taskdrop-admin`; `toolLinks` is unit-tested). Admin repo, commit 681a61e
- [x] Runbook: what to do for a stuck payout, a failed refund, a report, a dispute, and maintenance mode. `docs/RUNBOOK.md`, written from the admin pages and server code as they are today; someone who has used the admin should read it once and correct what differs (Phase 8 asks for that check)

**Verify**
- [ ] A reported message hidden from admin disappears for both users on web and Android (iOS: future scope) **Web and API done 2026-10-25: after "Hide this message" neither Asha nor Ravi gets it back from `listMessages`, and the admin offers "Show it in the chat again". Android still to do.**
- [ ] A blocked user can't contact the blocker on any platform **Web and API done 2026-10-25: a blocked person's offer and chat message are refused (the blocker can still write to them); the APK is still to do.**
- [-] A broadcast to "iOS only" reaches only iPhones
- [x] Every action is in the audit log **Checked 2026-10-25 in the owner's Chrome: warn, close report, hide message and hide job each wrote a row (`user.warn`, `report.actioned`, `message.hide`, `task.hide`); the page's wording is fixed (P2-47).**

---

## Phase 8: Store readiness

**Alpha publish (staging plan, added 2026-10-26, owner request; Part B section 14).** Publish the website, the Android app and the admin for alpha testing with fake data and fake money. These boxes keep alpha fake and make that visible to every tester. New code only, on `redesigned-2.0` (ground rule 10).

*Backend*
- [ ] An `environment` setting (`alpha` or `production`) in app controls, additive (ground rule 4); the money functions read it. In `alpha` they refuse a payment key that starts with `rzp_live_`; in `production` they refuse `rzp_test_`. A wrong key fails loudly instead of moving money. Tested in `test:db` and the function tests
- [ ] Manual payout mode is the alpha way to pay workers: an admin marks a payout done by hand, no bank transfer. Confirmed with RazorpayX unset

*Web, Android and Admin*
- [ ] A visible ribbon on every screen of the web app, the Android app and the admin: "Alpha: fake money and fake data". It reads the `environment` setting, so it disappears by itself in production. Light, dark and System themes; reduced-motion respected
- [ ] The alpha website sends `noindex` (and `robots.txt` blocks crawlers) so search engines do not list it
- [ ] A "How alpha works" card for testers (fake money, fake data, what to test, no real personal data, where to report problems), shown once after sign-in
- [ ] Terms and Privacy carry an "Alpha" notice and make no compliance claim (`src/legal/documents.ts`; text approved by you)

*You*
- [ ] **(You)** Approve the alpha wording and the ribbon (static design first, as always)
- [ ] **(You)** Publish: send testers the `beta` APK; make the Play Console app ($25 once, if not paid), upload the AAB to **Internal testing** and to **Closed testing**; invite the admin's staff (owner manual tasks 8.3, 8.4, 8.6)

*Verify*
- [ ] With the Razorpay test keys, a test checkout works; with a `rzp_live_` key set on the alpha project the money functions refuse to start (tried on a throwaway key name, never a real live key)
- [ ] The ribbon shows on web, Android and admin; `noindex` is in the page headers
- [ ] A tester who is given only the link and the "How alpha works" card finishes a full fake job

**User app (all platforms): tour guide** (added 2026-10-24, owner request)

A guided tour a person starts from inside the app. It says what TaskDrop is, which icons to tap, and how a task goes from post to paid. It also helps store reviewers and new testers. It changes no existing screen's look or feature (product rule: redesign keeps every feature). New code only, on `redesigned-2.0` (ground rule 10). If you want testers to have it before the store work, say so and it moves to an earlier phase.
- [ ] **(You)** Approve the tour's design first, before anything clickable is built (`AGENTS.md`: static design and animations are confirmed with you before a prototype). I show you: one still per step, the step list and wording below, and how each step's motion behaves. Also decide: does it start automatically once after onboarding (with a clear Skip), or only when someone picks it?
- [ ] Entry points. A **"Take the app tour"** row in the account menu (`AppHeader.tsx`, next to "Help & support"), and a one-time offer after onboarding with Skip. The tour can be replayed any time. Skip and finish both work at every step; a person is never trapped in it
- [ ] The tour's steps, in this order. Every label, icon and screen name is read from the live app source when the tour is built, never written from memory (the Home-order rule: never invent a section or a button that is not in the app). Draft:
  - what TaskDrop is: "Ask for anything. Someone gets it done for you." Tasks can be local **or** remote, so no copy suggests local-only
  - the **Hire / Earn** switch: one account does both, and the tabs rename themselves (My Tasks becomes My Work, Explore becomes Find work)
  - the five bottom tabs on a phone (Home, Explore, My Tasks or My Work, Wallet, Profile) and the left menu on desktop web, one stop each: what is behind it and when to tap it
  - the post button: how to describe a task in plain words (and the AI writer, if it is on), budget, photos, remote or in person
  - offers and the poster's choice: compare offers, pick one, chat, and how the area name hides the exact address until work starts
  - how the money is held: the poster pays the offer plus the service fee, TaskDrop holds it, the poster approves (or has 3 days to approve or report) and the worker is paid; earnings clear after 7 days, then withdraw to UPI or bank. Numbers come from `packages/rules` and the live fee settings, never typed into the tour
  - the messages icon and the notification bell
  - the account menu: Saved tasks, Wallet, Bank & UPI accounts, How fees work, Settings, **Help & support**, Send feedback
  - last card: "You're set", with Post a task and Find work buttons, and where to replay the tour
- [ ] One shared tour component for web, Android and (later) iOS, driven by a plain list of steps in code (a title, a line or two of copy, which part of the screen to point at). Rules it has to meet:
  - on the web build it dims the screen and points a spotlight at the real tab or menu item; on phones the five tabs are drawn by the system (native tabs), so the tour cannot circle them exactly and instead shows an arrow card above the bar with the tab's icon and name. Checked when it is built, and the real answer written here
  - Next, Back, Skip and "Step 3 of 9"; fully usable with a screen reader and the keyboard (web); respects the reduced-motion setting; light, dark and System themes; text from `theme.ts` tokens, no raw colours
  - it shows both Hire and Earn wording, and never moves money or changes data (it is read-only, and it opens no screen that needs a signed-in action)
  - strings sit in one file so the wording can be changed without touching layout
- [ ] It remembers that the tour was seen so it is not offered again. Decision for you: per device is enough (no database change), or per account (an additive migration, so the old app is untouched, ground rule 4). Default if you don't say: per device
- [ ] Tests: a unit test that the step list only points at screens and labels that exist (it fails if a tab is renamed and the tour is not updated), and a Playwright test on the web build (start the tour, step through it, skip it, replay it)

**Web**
- [ ] The tour works in Chrome at desktop size (spotlight on the left menu) and phone size, in light and dark
- [x] Privacy policy, terms and support pages live on `taskdrop.in`, needed by both stores. (Built 2026-10-19 as `?page=terms`, `?page=privacy`, `?page=support`, all public; text traced to code in `docs/LEGAL_AUDIT.md`. Open: the domain, `EXPO_PUBLIC_LEGAL_*` values, lawyer review.) **Checked live 2026-10-25:** `?page=terms`, `?page=privacy` and `?page=support` all answer 200 on https://taskdrop.in and show the full text (the Privacy page says "Draft, under legal review" and shows no Grievance Officer name yet). The open items (legal details, lawyer review) are owner manual 8.2 and Phase 10.
- [ ] Map tiles (`MapPicker`) and the fallback search use a provider's free tier, or the volume is confirmed low. OpenStreetMap's public servers don't allow heavy commercial use. **Checked 2026-10-21:** the web/tile map (`MapPicker.tiles.tsx`) loads tiles straight from `tile.openstreetmap.org`, and the fallback address search is OpenStreetMap's Nominatim (now called from the `places-search` function, one request per search, under the per-account budget). Fine for a dozen testers; not for launch. Needs a decision (a tile provider with a free tier, or Google Maps tiles) before the store builds

**Android**
- [ ] The tour works on the `beta` APK: starts from the account menu and after onboarding, points at the right tabs, Skip and Back work, and it leaves the app in the state it found it
- [ ] **(You)** Google Play Console app ($25 one-time, if not paid), store listing, screenshots, data-safety form
- [x] EAS `production`-style Android build (AAB) for the closed test **Built 2026-10-24** (version 1.0.0, versionCode 1; build `cc681cd3`). The download link expires on 2026-11-23; make a new build then. Uploading it is owner manual 8.4.
- [ ] **(You)** Closed test with at least 12 testers for 14 days (required before a production release). *Blocked until the testers are recruited (deferred to future scope 2026-10-22).*

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
- [-] The tour works on TestFlight (the shared component is built for it; it is only checked on a phone once iOS starts)

**Admin**
- [ ] Ready to handle reviewer reports within 24 hours; runbook checked

**Verify**
- [ ] On the Play closed test and on TestFlight: post → bid → pay → complete → withdraw works
- [-] Apple sign-in works on iPhone
- [ ] Push arrives on both platforms
- [ ] An EAS Update installs on both
- [ ] A first-time tester, given only the app and no instructions, finishes the tour in about two minutes and can then name the Hire/Earn switch and where the money is held. Every step points at something that exists on web and Android
- [ ] The tour code is on `redesigned-2.0` on GitHub in both repos where touched (ground rule 10), with the tour boxes ticked in the same pull request

---

## Phase 9: Switch-over to the upgraded app

*Still the staging (alpha) plan (section 14): fake data and fake money. The alpha exit gate in section 14.3 is checked before this phase starts.*

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
  - [ ] `api` enforces App Check for money operations and for sending sign-in codes (Phase 3 ran it in monitor mode, because the old app cannot send the token). A failed check is a risk signal, never the only gate (section 7.1)
- [ ] **Backend: close the public read of `profiles.payout_upi`** (an old column, empty today, readable by every signed-in person; the new payout screens do not use it; Phase 2, P2-32): drop the column or its read grant once the old app is retired
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
- [ ] Every tester is on the upgraded app on web and Android (iOS: future scope)
- [ ] Admin works on `admin.taskdrop.in`
- [ ] After the lockdown, a direct database call with the public key + a user token is refused, while web, Android, admin and the E2E tests still work (iOS: future scope)
- [ ] The old branches are unchanged

---

## Phase 10: Customer launch (later, when you decide)

*This is the **production plan** (section 14.4): real money, real customers, a new Supabase project. Every payment it needs is listed in section 14.5. Start the slow items (bank account, Razorpay and RazorpayX KYC, DLT registration, the lawyer) early and in parallel; they take days to weeks.*

- [ ] **(You)** Decide to launch; confirm recommendations A and D
- [ ] **(You)** The business basics first: legal entity, PAN, GST if you have one, a current bank account (section 14.4, P0)
- [ ] **(You) Payments, in the order they are needed (section 14.5):** lawyer's fee (first); Razorpay and RazorpayX activation; DLT registration and MSG91 credits; DMCA agent ($6); then Supabase Pro ($25 a month), Vercel Pro ($20 a month) and Inngest's paid plan before any real user; the RazorpayX balance that pays workers out (how it is funded follows the lawyer's answer, R3)
- [ ] The alpha ribbon is gone and the `environment` setting is `production`; the money functions refuse `rzp_test_` keys there (Phase 8 alpha boxes)
- [ ] Production starts empty: no alpha accounts, tasks or wallets are copied over
- [ ] The admin authenticator is back on and `admin_require_mfa = true` (section 13)
- [ ] **Backend:**
  - [ ] Production Supabase project on Pro ($25/month, backups); migrations from `main`, secrets from the inventory, functions deployed
  - [ ] Auth providers on, with production redirects
  - [ ] Test-only sign-in shortcuts off: `ALLOW_ANY_OTP` and `TEST_PHONES` are not set on the production project, and the `dev_otp_for_all` setting is false (section 7.1)
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
  - [ ] The full flow passes on web, Android and admin with live keys (iOS: future scope) and small real amounts

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
| Two plans | **Staging (alpha) now, Production later** (2026-10-26): publish the app and website with fake data and fake money first (Razorpay test keys, no RazorpayX, manual payouts); real money and real things come in a separate production plan on a new Supabase project. See section 14 |
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
| Tour guide | **An in-app tour** (2026-10-24): a person can start it from the account menu and is offered it once after onboarding; it explains the app, which icons to tap and how a task and its money flow. Phase 8; design confirmed with you before it is built |
| Where code goes | **Every new code change is pushed to `redesigned-2.0`** in both repos (2026-10-24, ground rule 10); never to `main` |

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

**Staging and production (2026-10-26).** The "hosted beta" column above is the **staging (alpha)** environment: fake data, Razorpay test keys, no RazorpayX. **Production** is a separate set built in Phase 10 (new Supabase project, live keys, its own Vercel env, Inngest environment, ImageKit `/prod` and Sentry `production`). The two never share a database or a payment key. Section 14.1 has the full table.

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

> The full pre-production test plan (security, keys, RLS, injection, buckets, API-call reduction, load, Android, recovery and the launch gate) is `docs/testing_checks.md`. This section stays the per-PR quality bar and the core-flow checklist that plan refers to.

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

> **Now:** run it on web (Chrome) and Android. The iOS column and the Safari run are future scope (2026-10-24); leave them blank until you say "start iOS".

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
| **Vercel env, backend deploy** (project `taskdrop`, All Environments; the backend deploys only for Preview builds of `redesigned-2.0`) | `SUPABASE_ACCESS_TOKEN` and `DATABASE_URL` (the Vercel build deploys migrations and functions with them and runs the old-app compatibility checks, set up in Phase 0). Optional `DATABASE_CA_CERT` (Supabase root CA, PEM) turns on certificate checking for database connections. Later: `EXPO_TOKEN` if EAS Update runs from Vercel (Phase 1; otherwise from your PC), Sentry auth token (source maps). **GitHub holds no secrets** |
| **Your PC** (git-ignored) | `.env` (also `DATABASE_URL`, `SUPABASE_ACCESS_TOKEN` for the deploy and seed scripts), `apps/mobile/.env.local`, admin `.env.local`; all test keys. There is no local functions server, so no `supabase/functions/.env.local` |

### 7.1 How keys, secrets and tokens are protected

Added 2026-10-23. The aim: protect TaskDrop's keys, environment variables and sign-in tokens.

**The rule.** An Android app can be decompiled, and so can any app or web bundle, so any secret shipped inside it is public. Well-known Android apps do not hide secrets in the APK; they keep them off the phone. The industry-standard approach has three parts:

1. **Backend proxy (the gold standard).** The app never calls an outside service with a secret key. It calls our own server, and the server makes the call.
2. **Delegated authorization.** The server holds the secret keys and acts for the app, after checking who is asking and whether they may.
3. **App-to-backend security.** The app proves who is asking with the signed-in user's token (OAuth-style sessions). The server can also check that the request comes from the genuine app on a genuine device, with an integrity check such as Firebase App Check.

**How TaskDrop applies it**

| Part | Today | Still open |
|---|---|---|
| Backend proxy | Every secret is read by server code: the Edge Functions (`api`, `razorpay`, `places-search`, `phone-auth`, `password-auth`, `inngest`…), SQL through Vault, and the admin's server code (section 7 table). Place search moved behind `places-search` in Phase 3. The app bundle holds only the public keys in section 3.2 | Test Razorpay keys are compiled into `supabase/functions/_shared/secrets.ts`. That is server code, so they never reach the app, but the file sits in a public repository, so "GitHub holds no secrets" above is not yet true. Phase 3 boxes: remove, then rotate |
| Delegated authorization | Ground rule 5: the app asks, the server decides (RLS, RPC checks, `api` checks). The service-role key is used only on servers (the admin's `src/lib/supabase/service.ts` is `server-only`). The admin sends the gateway header | The admin's `middleware.ts` falls back to the service-role key when `ADMIN_SESSION_SECRET` is missing. Phase 3 Admin box |
| App-to-backend security | The user's access token goes with every call. On phones the session is kept in `expo-secure-store` (Android Keystore). "Sign out everywhere" ends every session (Phase 4) | No app or device integrity check yet (Phase 3 monitor mode, Phase 9 enforcement). Token lifetime and refresh-token rotation not recorded (Phase 3, yours). Test-only sign-in shortcuts must be off in production (Phase 10) |

**Rules that follow**
- A name starting `EXPO_PUBLIC_` or `NEXT_PUBLIC_` is public. A secret never gets one of those names.
- Secrets live in Supabase function secrets, Supabase Vault or Vercel env. Never in code, in GitHub or in the app.
- Every key that has to ship in the app is restricted at its provider (package name and signing certificate, allowed APIs, a quota) and listed in section 3.2.
- A key that has been in git, a log, a screenshot or a chat is **rotated**, not just deleted: git history keeps it.
- App Check is a risk signal on top of user tokens and server checks, never the only gate: a rooted phone can defeat it.

**How it is tested:** `docs/testing_checks.md`, T2 (secrets and keys) and T11 (the Android build).

**Sources:** [React Native: Security](https://reactnative.dev/docs/security) · [ProAndroidDev: You can't hide secrets in your Android app](https://proandroiddev.com/you-cant-hide-secrets-in-your-android-app-here-s-what-to-do-instead-cce380fc1f82) · [CodePath: Storing Secret Keys in Android](https://guides.codepath.org/android/Storing-Secret-Keys-in-Android) · [Doppler: Secrets management for mobile app development](https://medium.com/dopplerhq/secrets-management-for-mobile-app-development-852029582106) · [r/androiddev: Handling secrets](https://www.reddit.com/r/androiddev/comments/1h2gzw9/handling_secrets/) · [Video](https://www.youtube.com/watch?v=bY0yvrAtbKM&t=242)

## 8. Accounts and costs

*Which of these you pay for alpha and which for production: section 14.5. Alpha costs nothing monthly; the only possible payment is the Play developer account ($25 once).*

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
| Google Play closed test (12+ testers, 14 days) | Android launch delay | Recruit in Phase 0; test in Phase 8. **Recruiting deferred to future scope (2026-10-22), so the Play production release cannot start until it is done** |
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
| Test Razorpay keys sit in the history of a public repository | Anyone can use the test account (no real money moves) | Removed from code. Rotation is future scope (owner 2026-10-24): accepted for now because test keys move no real money; rotate before live keys (Phase 10) |
| Per-platform switches rely on a header | A user could fake their platform | Platform switches are operational; global switches apply to all |
| **Real money moves in alpha by mistake** (a live key is put into the alpha project) | Real charges with no legal setup | Rule: live keys only in production (section 14.2); the `environment` key check refuses them (Phase 8 alpha boxes) |
| **The public alpha is found and used by strangers** (any phone number signs in, the test code is on screen) | Strangers create accounts; real personal data ends up in a fake-data system | Ribbon, `noindex`, "No real personal data" rule, invite-only link; the data is thrown away at launch |
| **Alpha tested only with fake money** hides payout, KYC and bank problems | A surprise at the first real payment | The small real ₹10 job in the production plan (P11) before the public release |

## 11. Changelog

- **v4.62 (2026-10-26):** **Two plans written (owner request: publish the app and website for alpha with fake data and fake money first, real money later).** New Part B section 14: the table of what is fake in alpha and real in production (14.1), the rules that keep alpha fake (14.2), the staging plan in order with an alpha exit gate (14.3), the production plan in order (14.4), every payment production needs and when (14.5), and the alpha build list (14.6). Phase 8 gained "Alpha publish" boxes (the `environment` key check, the alpha ribbon, `noindex`, the tester card, alpha Terms and Privacy wording); Phase 10 gained the business basics, the payments box and the empty-start and authenticator boxes; ground rule 7, decisions, section 3.5, section 8 and three risks point to the two plans. Owner manual has the matching clicks. **Also 2026-10-26:** Google sign-in fixed (a new Web client in the Google Cloud project Taskdrop, In production, pasted into Supabase by the owner) and tested by Claude on `taskdrop.in`, the admin and the installed Android app. No code changed; nothing is built until you say "start Phase 8" or "build the alpha guard rails".
- **v4.61 (2026-10-25):** Phone session done. Beta build `505485f8` (commit a92546e, debug token for beta builds) installed on the owner's phone; the `api` log shows `app check { result: "valid", platform: "android" }` for 74 calls from the phone, so the Android half of the App Check proof is done. PR 84 merged. Update group f0b7d18b (commit 0cb32c3, channel `beta`) is on the phone with readable Sentry maps uploaded; the chat-photo full-size viewer opens from a chat photo. **Still open:** web App Check proof (the live site has the key in its bundle, but the landing page makes no `api` call, so it needs one signed-in visit; the web log so far shows only `missing` from test runs), and the CSP (Report-Only today) will need `https://www.google.com` and `https://www.gstatic.com` in `script-src` and `frame-src` before it is enforced, or reCAPTCHA is blocked.
- **v4.60 (2026-10-25):** Phases 0-8 sweep. Checked by Claude: every migration applied on the test project (latest 20261025100000), all 11 Edge Functions active, the web, admin and old app answer, the Terms, Privacy and Support pages are live, the Supabase sign-in token settings are right (ticked), the web export carries no secrets (only library comments and a key-prefix check mention `service_role` and `sb_secret_`), the AAB is built (ticked). Phase 5 payout, refund-retry and webhook boxes marked `[-]` (waiting for the lawyer, owner manual 5.1; no Razorpay changes). The owner manual has a new START HERE list in order, with task 0.1 (fix Google sign-in, P2-50) first. Evidence: `docs/PHASE0_8_CHECK_2026-10-25.md`. Admin sign-in is limited to `hitendureacts@gmail.com` (owner, 2026-10-25).
- **v4.59 (2026-10-25):** Phase 2 pending items. **Closed:** the GitHub-issue box (kept in this file), P2-19 (e2e tidy-up, PR 76), the web look-through, P2-41 and P2-42 (accepted in writing), P2-49 (chat photo, PR 85). **Scheduled:** P2-31 into Phase 10 (already a box there), P2-32 into Phase 9 (new box), P2-48 and the `api` speed target into Phase 6 (new Verify box; `api` now logs slow operations). **Found: P2-50, Google sign-in is down for everyone** (the Supabase Google provider's OAuth client was deleted at Google; confirmed from outside the browser); it is the owner's to fix and is the first step of the new manual. Still open and why: P2-10 and the Android checklist (the phone must be unlocked and tested by hand), P2-33 and P2-36 (the owner's decisions), P2-43 (needs a working admin login, so P2-50 first).
- **v4.58 (2026-10-25):** Owner manual 4.3 and 4.4 ticked on the owner's report (relayed by the orchestration session): "Web Google ok. Phone: Google ok, number ok, username sign-in ok, under-18 refused. Linking ok." That closes the open item from v4.51 (Link Google with a real login, Google and phone-app sign-up, phone-app age check). Plan box "Account screen: ... link Google/Apple" ticked. Docs only; not re-verified by Claude (the Google and phone-app steps are the owner's).
- **v4.57 (2026-10-25):** Owner asked Claude to complete `docs/APP_CHECK.md`. **Firebase (owner's Chrome, account hitendureacts@gmail.com):** web app `taskdrop web` registered; reCAPTCHA Enterprise API enabled and a key for `taskdrop.in` and `localhost` created; web registered in App Check with it; Android registered with Play Integrity using the EAS keystore SHA-256 (owner agreed to the Play Integrity terms). **Vercel (`taskdrop`):** `EXPO_PUBLIC_FIREBASE_API_KEY`, `_APP_ID`, `_PROJECT_ID`, `_SENDER_ID`, `EXPO_PUBLIC_RECAPTCHA_SITE_KEY`, `FIREBASE_PROJECT_NUMBER` set for all three environments; they take effect on the next build. **Code (branch `feat/android-app-check`):** `lib/appCheck.ts` now sends a Play Integrity token on Android release builds (nothing in dev builds, Expo Go or iOS; never blocks a call, 3 s cap). `npm run check` green. **Not done:** no APK built, nothing deployed, nothing seen in the `api` log yet. **Watch:** the API key inside `google-services.json` is restricted (see `docs/FCM.md`); if Android shows `invalid` or no token, add the Firebase App Check API to that key's allowed APIs. Add the Play Console app-signing SHA-256 to the Play Integrity registration before a Play Store build. **Audit gate:** `@react-native-firebase/app` brings the Firebase JS SDK, whose Firestore piece pulled `@grpc/grpc-js` 1.9.16 (GHSA-m9gg-hp2v-232j, high); fixed by a root `overrides` entry to 1.14.6 (patched from 1.13.6), no exception needed. The app does not use Firestore.

- **v4.53 (2026-10-24):** Phase 2 steps 4 and 5. **Android (owner's phone, read-only parts):** Home, the Hire/Earn switch, Find work, notifications and the location picker run with no crash; the picker shows a real Google map, so TASKDROP-4 is resolved. **Owner's request:** the map's button did nothing useful when location is off; PR 74 (merged) makes it ask to turn location on, or open the right settings screen, and it was published to `beta` (update `01a16ed5`, source maps uploaded; the Sentry upload script cannot handle a path with spaces, so a small script uploads instead, noted in `docs/` memory). **Admin (owner's Chrome, signed in through the existing Google session):** all 33 list pages and 3 detail pages open with no error and a clean console; every page took 2 to 4 seconds because the admin ran in Washington while the database is in Mumbai (admin PR 22 pins it to `bom1`), and the admin CI had gone red on npm advisories, including a critical one in `next` (fixed: `next` 16.4.3, unused `zod` removed). **Database (migration 124):** 18 people and admin write functions were open to every staff role (proved as real Viewer, Support, Sales and Finance logins, rolled back); each now has a role guard. **Decisions made on the owner's "complete this":** sign-in routing falls back to Home, not onboarding, when the profile read fails; the Playwright workflow runs on every push to `redesigned-2.0`. **Timed after the Mumbai deploy:** admin pages now take 0.35 to 0.7 s instead of 2.2 to 3.8 s. Phase 2 is 26 of 45 boxes ticked, 6 deferred, 13 open.
- **v4.52 (2026-10-24):** Phase 2 P2-2 closed, docs only. PR 70 is merged and deployed (merge commit `4653c2f`, migrations 122 and 123 applied on the test project, merged read policies present, old ones gone). The Sentry clean-up ran in the owner's signed-in Chrome: 15 issues resolved, TASKDROP-4 kept open for the phone map check (P2-11). Phase 2 is now 15 of 40 boxes ticked, 6 deferred, 19 open.
- **v4.51 (2026-10-24):** Owner asked Claude to complete Phases 4 and 5 of the owner manual. **Phase 4:** phone login kept (`phone-auth`; the Supabase phone-auth boxes are `[-]`, owner manual 4.1). New `e2e/accounts.spec.ts` (web, test project): a new number is asked its birth date, signs up, finishes setup, sets a password in Settings → Sign-in and signs back in with the username; a 16-year-old is refused with no account; Ravi still signs in; the account the test made is deleted at the end. It also checks "Allow manual linking": Supabase answers `manual_linking_disabled`, so it is **off** and the owner has to switch it on (4.2); until then that test skips with the reason. The manual's old step "create a username and password at sign-in" was wrong (the screen only signs in; the password is set in Settings), and is corrected. **Phase 5:** checked in the owner's Inngest dashboard: 0 failed runs in the last day. **Found:** the Hobby plan allows 50,000 runs a month and 28,456 were used by 24 October; the outbox sweeper (every minute) was the biggest user, so it is now every 5 minutes (`supabase/functions/inngest/index.ts`, docs/INNGEST.md; the watchdog alerts at 15 minutes). Inngest billing is added to owner manual 10.2. Push: all 20 notification types sent to the owner phone's test account (Tasker 3313) all arrived through Inngest, and a tap opens Notifications; a first attempt failed only because the app had been force-stopped (Android drops pushes to a force-stopped app). New `e2e/notifications.spec.ts`: the bell on an open page counts a new quote with no refresh. Admin Payouts page opens cleanly; RazorpayX is "Not set up" on the test project, so check-all, give-back and balance wait for owner manual 10.3. **Left for the owner:** 4.2 (the Supabase switch), 4.3 and the Google and phone-app parts of 4.4 (a real Google login), clearing the 20 test notifications from the phone's shade.
- **v4.50 (2026-10-24):** Phase 2 steps 1 to 3 built on branch `fix/phase-2-stabilize` (PR into `redesigned-2.0`). **Code:** reads retry twice on a gateway blip, writes never (`lib/retry.ts`, `lib/gateway.ts`, the `app-config` refresh); Sentry environment is `development` on localhost, aborts dropped, an unreachable config is a log line; "Couldn’t load. Try again" on the promote and manage-task screens; the placeholder says "This page isn’t available" and a test keeps every screen name registered; the Playwright helper retries gateway blips and waits for `health`. **Database (migrations 122 and 123, not yet applied, the Vercel build applies them on merge):** one read rule per table, 15 foreign-key indexes, and reconcile no longer flags a fully refunded payment; checked on the test project in rolled-back transactions. **Checked before building, so two findings were corrected:** sign-out is safe and `quietly()` only carries ad pings. **Merged with the Phase 1 verify work (v4.47):** the temporary Sentry trigger is already reverted on `redesigned-2.0`, so P2-3 is done. **Not done on purpose:** the Sentry clean-up in P2-2 (after deploy), the seed-data "known mismatch" marking in P2-8 (changes data). Checks: `npm run check` green, Playwright 21 of 21 against a rebuilt web export, new tests `retry.test.ts`, `registry.test.ts`, `policy_tidy.test.sql` (the SQL one run on the test project inside a rolled-back transaction; CI runs it for real).
- **v4.49 (2026-10-24):** Phase 2 audit and fix plan. Docs only; no code changed and nothing pushed. Claude checked the code, the logs, Sentry, Vercel, the Supabase advisors, the Playwright suite and the owner's phone (details at the top of Phase 2) and wrote 16 findings, P2-1 to P2-16, in five steps. The ones that matter most: deploys cause a short 503 burst and the app does not retry (the Playwright money test failed once for this reason and passed on re-run); Playwright and local runs report to Sentry as `production`; a temporary Sentry trigger commit (`550d4a1`) is live on `redesigned-2.0`; several screens show a failed load as an empty screen. **Owner decision:** the admin authenticator is future scope ("no need now"); it is Part B, section 13, and P2-14 records it. Also corrected: ground rule 10 no longer lists local branches that do not exist. Waiting for "start Phase 2" before any fix is built.
- **v4.48 (2026-10-24):** Two things. **(1) Phase 1 is done.** The admin test error was run: a temporary server route and client page in the admin repo (`1f1e7b5`), deployed as a preview, opened in the owner's signed-in Chrome; both errors reached Sentry project `taskdrop-admin` with readable stacks, then the trigger was reverted and pushed (`8ab9de3`, admin `redesigned-2.0`). The last Verify box is ticked; the Phase 1 board row now reads 22 of 28 ticked, 6 deferred, 0 open. A Vercel preview of the admin (`taskdrop-admin-3lqaokblf`) still carries the trigger until the next deploy replaces it; it needs a Vercel sign-in and the token is now meaningless once the code is gone. **(2) Owner instruction: Phase 3 tasks 3.2 and 3.3 are future scope.** Rotating the Razorpay test keys (manual 3.2) and the private-repo decision (manual 3.3) are marked `[-]` and moved out of the open list; the Phase 3 board row is recounted from the boxes (35 ticked, 4 deferred, 8 open; the old row said 32/2/13 and was stale). Consequence recorded in the risk table: the old test key pair stays readable in the public repo's history; it only opens the Razorpay test account.
- **v4.47 (2026-10-24):** Phase 1 Verify run on the owner's plugged-in phone. Claude added a temporary test-error trigger (`550d4a1`: `x-sentry-test` header in `guarded()`, `?sentry-test=` link in the app), pushed it to `redesigned-2.0`, fired it, and reverted it the same day. **Ticked:** update reaches the phone (Sentry reports the new update id), push arrives, uptime monitors green. **Test errors:** web, Android and all 8 functions reached Sentry; web and function stacks are readable at once, Android only after Claude re-uploaded the update's source maps with the bundle and the map together (the earlier by-hand upload sent the map alone; lesson added to the EAS source-maps box). **Left open:** the admin test error (no trigger in the admin repo). Test data left behind: Sentry issues TASKDROP-A to D (titles start "Sentry verify"; resolve them), two test notifications on the phone, and EAS update `c8a3689a` on channel `beta`, which carried the trigger link code. **Removed the same day:** the trigger commit is reverted on `redesigned-2.0` (functions redeployed; the header now does nothing on all 8; the web bundle has no trigger), and EAS update `f6a9d205-32bb-485e-b7ac-00f517340b4a` (from `c95f764`) replaces it on channel `beta`, with its source maps uploaded bundle and map together. The phone gets it on its next two starts.
- **v4.46 (2026-10-24):** Phase 1 web source maps confirmed. Claude read the Vercel build log of `aa78ab9` (after the owner approved Claude's Vercel connection): the `[sourcemaps]` step used the token, bundled the 12 files with debug ids for Sentry project `taskdrop`, and deleted the 6 `.map` files, so the last open build box in Phase 1 is ticked (manual 1.4 too). **Checked the same day:** `taskdrop.in` answers 200, the admin answers 307 (its sign-in redirect), and the `api` `health` op answers `{status:"ok",database:true}`. **Still open, all in Verify:** a test error from web, Android, admin and each function with a readable stack (the repo has no test-error trigger; forcing one in a function or the app needs a code change, which is not made); the Uptime Robot dashboard showing green (the owner's view); the `beta` update running on the phone and a push arriving (the owner's phone steps in manual 1.6). Docs only; nothing committed or pushed.
- **v4.45 (2026-10-24):** Two owner instructions, docs only (no code changed, nothing pushed). **Tour guide:** added to Phase 8 as 11 boxes (design sign-off first, entry points, the step list, one shared component, remembering it was seen, tests, a web box, an Android box, an iOS box deferred, two Verify boxes). It starts from the account menu next to "Help & support" and is offered once after onboarding; it explains what TaskDrop is, the Hire/Earn switch, each tab, posting, offers, how the money is held and Help & support. Written from the live source: the tabs are Home, Explore, My Tasks or My Work, Wallet and Profile (`BottomTabBar.tsx`), and the account menu rows are in `AppHeader.tsx`. Open design point recorded in the box: on phones the tabs are native, so the tour cannot spotlight them exactly. **Ground rule 10:** every new code change is pushed to `redesigned-2.0` in both repos (by pull request, or direct when you say so), code that is only on a local branch is not done, and `main` is never touched; the local branches still waiting to be pushed are listed there. Phase 8 on the board is now 0 of 29 (10 deferred, 19 open). Part B section 2 has the two decisions.
- **v4.44 (2026-10-24):** Phase 1 and 2 owner-manual work that Claude could do. **Found:** the last web build did not upload source maps, because the Vercel variable is `SENTRY_AUTH_TOKEN_TASKDROP_USERAPP` and the script read only `SENTRY_AUTH_TOKEN`; `scripts/upload-web-sourcemaps.mjs` now accepts both (commit `10f5165`, local branch `fix/web-sourcemap-token`, **not pushed**). **Confirmed:** the `beta` APK build uploaded its native source maps to Sentry, so the "Source maps uploaded from EAS" box is ticked (Phase 1 is now 17 of 28, 6 deferred, 5 open). **Done:** an over-the-air update was published to channel `beta` (group `166484f3`, from `d49d681`) with its source maps uploaded to Sentry by hand; whether the phone runs it is not confirmed (the owner's check in manual 1.6 step 4). **Also:** the Playwright suite passed 20 of 20 locally against the test project; GitHub cannot start `e2e.yml` because `main` doesn't have it (manual 2.5 rewritten). Not done: the Phase 1 test errors and push test (manual 1.6 steps 2 and 3), and everything in Phase 2 that needs the owner (2.1 list, 2.2 full job, 2.4 admin pages, 2.6 a week of use).

- **v4.43 (2026-10-24):** scope decision. **Safari testing joins iOS in future scope.** Web is tested in Chrome (desktop and phone size) only for now. The Phase 2 Safari check is split off into its own deferred `[-]` box (Phase 2 is now 6 of 23, 5 deferred, 12 open). Verify and other boxes that listed iOS or iPhone now say "iOS: future scope" and no longer wait on it (Phases 1, 2, 3, 5, 6, 7, 9, 10). Part B 5.2 and section 12 say the same; owner manual task 2.3 moved to a "Future scope" section. No code changed.
- **v4.43 (2026-10-24):** Owner asked to complete all phases of `docs/OWNER_MANUAL.md`, with pushes straight to `redesigned-2.0`. Claude-side work done: PR 69 merged (web source-map token); migrations 110 to 121 and all functions confirmed deployed; Inngest push and prune cutover confirmed live (money sweeps still deferred); App Check monitor built (server + web, off until Firebase values); Link Google on the Account screen; control screens tested on the phone; `docs/PLAY_STORE.md` (Play answers, listing text, store graphics); the app icons were still Expo's template artwork and were redrawn as the drop-and-check mark; Android store build (AAB) started. Phases 9 and 10 not started (they need Phases 0 to 8 done, the 14-day closed test, the lawyer, live Razorpay and the owner's approval).
- **v4.42 (2026-10-24):** Phase 1 Sentry alerts (owner manual 1.2 and 1.3), done in your signed-in Chrome. `Money fatal`: project `taskdrop`, trigger "a new issue is created", filter "the event's level equals fatal", notifies you. `Error spike`: a Metric monitor on `taskdrop`, Errors dataset, `count()` over 1 hour, High priority above 20, with a connected alert that emails you. The Sentry alerts box is ticked, and Phase 1 is now 16 of 28 (6 deferred, 6 open). Sentry's new layout renamed things, so the manual's click steps were rewritten: alerts are under **Monitors → Alerts**, and "Critical" is now "High priority". The "is unresolved" filter Sentry adds by default was cleared so every error counts. Not checked: whether either alert actually sends an email (no fatal event or spike has happened since)
- **v4.41 (2026-10-24):** Phase 1 Uptime Robot. You made the free Uptime Robot account and two monitors (`taskdrop.in` and `taskdrop-admin.vercel.app`, every 5 minutes, emailing you), so the accounts box is ticked. The monitors box is split in two: the web and admin monitors are ticked, and the `api` health monitor is deferred, because its POST with custom headers needs a paid plan. Phase 1 is now 15 of 28 (6 deferred, 7 open). The Verify box "The uptime monitors are green" stays open until the other Verify checks are done
- **v4.41a (2026-10-24):** (UX fixes merged by another session before these version numbers were reconciled.) Owner feedback from a tester, four fixes. **Wording:** a worker who asks for a price other than the posted one now sees "Send a counteroffer" (task screen, offer sheet, Home card button); the posted price still says "Send an offer". **Something else:** every quick question's "Something else" chip opens a labelled text bar ("Your own answer") and a hint says so before it is tapped; canned "Something else" options in the question lists are dropped so the screen's own chip is the only one. **Auto-hire:** posting an auto-hire task now needs the wallet to hold the budget plus the service fee. The post flow shows the balance, offers "add money" for the shortfall and posts once it lands; the `api` operation `createTask` refuses an under-funded auto-hire with "Not enough money in your wallet" and the shortfall (test added). Workers' Find work filter and the card badge are both called "Auto-hire". Not changed: an offer that arrives after the poster's wallet has dropped below the budget still locks the worker and waits for payment (migration 063); closing that gap needs a database change and the owner's go-ahead. **Payments:** the payment link now carries a return address, so the web tab Razorpay opened closes itself (or falls back to the app) and the phone checkout sheet closes the moment Razorpay returns. Needs the `api` function deployed for the server check; the app changes ride the next web/APK build.
- **v4.40 (2026-10-24):** Progress board recounted from the boxes themselves (every `- [x]`, `- [ ]` and `- [-]` line in a phase, nested ones included; the Phase 4 sign-up table is not counted). Phase 0 is **done** (39 ticked, 7 deferred): the Maps key restriction was done on 2026-10-22 and the 12 testers were deferred the same day. Phase 1 is 13 of 27 (the FCM key and the `beta` APK), Phase 3 is 31 of 47 (the Razorpay compiled-in keys and `ADMIN_SESSION_SECRET`), Phase 7 is 14 of 25 (the 2026-10-22 to 10-24 admin tools). Phases 8, 9 and 10 now give the full total with the deferred iOS boxes (18, 28, 29), as the other rows do. Phases 2, 4, 5 and 6 were already right. Then, with your OK, two boxes whose work was already done were ticked: Phase 3's admin "Prepare for the lockdown" (all three steps ticked) and Phase 7's hide-a-message / remove-a-review (built in 118 and 121), so Phase 3 is 32 of 47 and Phase 7 is 15 of 25. Phase 7's "Admin SQL functions" parent stays open, since cancel a promotion with refund is not built. The version line also moves from 4.36 to 4.40
- **v4.38 (2026-10-24):** More Phase 7 and Phase 3 work, plus what could not be done. **Built and merged:** promotion tiers now come from the server (`promotionTiers()` in the app; the Promote screen offers exactly what `start_promotion` accepts) and are editable in the admin Settings page behind the money MFA gate; removing a review (migration 121, test `hide_review.test.sql`, "Remove this review" in the reports queue; `submit_review` now recomputes ratings through `private.recompute_ratings` so a removed review stays out of the average). Migrations 119 to 121 are applied to the hosted test project. **Phase 3:** the compiled-in Razorpay test keys are removed from `secrets.ts` (code only, not yet redeployed). **Found, not changed:** on the test project `push_via_inngest` is already `true` and the two prune pg_cron jobs are already gone, so the background-jobs cutover (`supabase/cutover/inngest_background_jobs.sql`) has been applied; the three money sweeps are still on pg_cron, and their cutover needs the `INNGEST_MONEY_JOBS` Edge Function secret, which cannot be set from here (no Supabase CLI login). **Blocked from here:** Claude in Chrome was not connected, so the Sentry, Inngest, Expo and Uptime Robot dashboards were out of reach; the Vercel connector needs the owner to approve team access before environment variable names can be checked. Both repos were merged straight into `redesigned-2.0` at the owner's instruction (no pull requests).
- **v4.40 (2026-10-24):** Fewer calls at app start, and one round trip fewer on `app-config` cold starts. **Measured first:** PR 65 (rate-limit write overlapped), same phone, same five cold starts of the installed APK, 65 `api` calls each: median 450 ms before and 414 ms after (about 8% better), average 473 and 563 ms, 95th percentile 724 and 1,227 ms, so the median improved and the tail got worse (the first calls after the deploy hit cold instances); not a clear win, and one round trip is a smaller part of the 450 ms than estimated. **Found:** loading Home on the web build makes 19 `api` calls in three waves (9 at 0.3 s, 4 at 1.7 s once the profile is back, 6 at 2.2 s: `attachPosters` five times and `signMedia`). **Changed:** (1) new read-only `batch` operation in the `api` function: up to 20 reads in one request, one sign-in check, each call run exactly as it would alone (admin switches and its own checks per call, a failed call does not spoil the rest), only operations the server treats as reads are accepted (writes, uploads, another batch are refused per call), and each call counts against the rate limit, so batching does not widen the budget. (2) the app (`lib/batcher.ts`, used by `lib/gateway.ts`) sends reads that are asked for within 10 ms of each other as one `batch` request; a lone call, and every write, goes out alone as before; an older server that answers "Unknown request" is detected and the calls are asked one by one for the rest of the session (checked live: the old server answers a batch with an error and Home loads normally, 20 of 20 end-to-end tests pass). (3) `app-config` reads the switches with the service key, which skips the Vault read a cold instance needed only to find the gateway header. **Not measured yet:** the server side of `batch` and the `app-config` change are only unit-tested and type-checked; they reach the hosted project when this merges. After the merge, re-run the Home load (expect about 5 requests instead of 19) and the phone cold starts, and compare `api` timings in the logs.
- **v4.39 (2026-10-24):** zod 4. A new high advisory for zod (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized collections; fixed only in 4.6.6) failed the audit gate on every branch. **Changed:** `@taskdrop/schemas` now uses zod 4.6.7 (nothing in the app or the Edge Functions imports it yet; it is used by its own tests). Ids use `z.guid()` so they keep the plain uuid shape check zod 3 had (zod 4's `z.uuid()` also checks version bits), and the video refinement uses `error:` instead of the deprecated `message:`; two tests added. **Exception added** for the one copy left, zod 3.25.76 inside `@expo/cli` (it pins `^3.25.76`, uses it only for DevTools plugin and MCP extension schemas on a build machine); review by 2026-12-13. The stale `braces` exception (advisory gone) is removed. **Checked:** `npm run check` (typecheck, lint and all unit tests), `npm run audit:gate` (4 advisories, all accepted), `npm run test:contract` (100 old-app operations served), `npm run web:export`, and `npm run test:e2e` against the hosted test project: 20 of 20 passed on a clean re-run (the first run had one money test fail on a single 503 from the `api` function in the minutes after PR 65's deploy; it passed on its own re-run and in the full re-run).
- **v4.38 (2026-10-24):** Latency check and one `api` change. **Measured 2026-10-24** (owner's phone CPH2585 on mobile data, installed APK, plus the PC and the Supabase logs): the network to the project is fast (PC 65 to 70 ms, phone 170 to 220 ms to the gateway), the database is fast (`api_rate_hit` about 1.5 ms inside Postgres), and a warm `api` call still takes about 450 ms on the server (p95 about 860 ms), because each call waits for Auth `getUser`, then the rate-limit write, then its own query, each a separate HTTPS round trip. A cold start of the app fires 12 to 15 `api` calls at once and shows full Home content about 3.5 s after launch; `app-config` ranges from 0.3 s to 4.9 s (a cold instance reads Vault first, then the switches). **Changed:** in `supabase/functions/api/index.ts` the rate-limit write now starts at once and runs beside the switches' lookup and, for read operations only, beside the operation itself (reads change nothing; a refused read's answer is dropped). Writes and uploads still wait for the counter, so "over the limit, nothing runs" holds for them, and a person who was refused in the last minute on that instance gets reads that wait too (`RecentlyLimited`, tested). **Not changed, on purpose:** `getUser` stays (a local JWT check would let a deleted or banned account's token work until it expires, and the phone-verified rule needs `phone_confirmed_at`, which the token does not carry). **Not deployed:** the saving is an estimate (about one round trip per read call) until it is measured on the hosted project after the merge. Still open: fewer calls at app start, and `app-config` on cold instances.
- **v4.37 (2026-10-24):** Phase 7 and Phase 2 findings, built and checked on the hosted test project. **Built:** broadcasts and segments by platform and app version (migration 119, test `broadcast_platform.test.sql`, admin segment form) and a warn action for the reports queue (migration 120, test `warn_user.test.sql`, a "Warn them" button on reports about a person). Both migrations were applied with the Supabase connector and recorded as `119_broadcast_by_platform` and `120_warn_user`; each test passed on the hosted project and left no data. Admin and app work is committed on branch `upgrade/phase-7-admin-tools` in both repos, **not pushed**. **Phase 2, slow queries:** the top entries in `pg_stat_statements` are the scheduled sweeps (`settle_cleared_earnings` 18.8 ms mean over 7,453 calls, `auto_complete_due` 21.1 ms over 2,752), so the total is call count, not a slow query. The sweep query already uses `tasks_due_to_clear_idx` and runs in 0.1 ms; there is no index to add. The call count falls when the Inngest cutover replaces the schedules. **Phase 7, promotion cancel with refund:** `admin_pause_promotion` already settles the campaign and returns the undelivered budget to the advertiser's wallet, so stopping a promotion already refunds what was unused. Refunding the delivered part as well is a policy question (that money is booked as revenue), so it is left for the owner to decide, not built.
- **v4.36 (2026-10-23):** Added Part B, section 7.1, "How keys, secrets and tokens are protected": the backend-proxy rule, how TaskDrop applies it, and what is still open. New boxes: Phase 3 "Keys, secrets and tokens" (remove the compiled-in Razorpay test keys, then rotate them; decide on private repos; record token settings; App Check in monitor mode; the app sends the App Check token; the admin session key stops falling back to the service-role key; a Verify box pointing at `testing_checks.md` T2 and T11), Phase 9 (enforce App Check on money and sign-in codes) and Phase 10 (test-only sign-in shortcuts off). One new risk in section 10. Docs only; nothing built.
- **v4.35 (2026-10-22):** Added `docs/testing_checks.md`, the pre-production test plan (phases T0 to T14), and linked it from section 5.
- **v4.34 (2026-10-22):** Phase 7 admin work built (admin repo, `redesigned-2.0`, commit 681a61e): the Category card on the task page and the Devices and tools card on the dashboard. Found while checking the rest: the admin does not make commission editable (the plan said it did), and a promotion-tier form would let staff set tiers the app (which hard-codes them) offers but the server refuses. Both written next to their boxes; not built. Broadcast targeting needs a migration I cannot test from here, so it stays open.
- **v4.33 (2026-10-22):** Looked through every phase for work that needs no account, key, device or approval. Only one box qualified: the Phase 7 "Report" button on reviews (`PublicProfileScreen.tsx`), now built and ticked. Everything else open is yours (Uptime Robot, Sentry alerts, testers, Play Console, store and money decisions, device checks), waits for traffic or keys (slow-query fixes, ImageKit and Inngest cutovers, phone login), is the admin repo (not attached to this session), or is held on purpose (Phase 9 lockdown and retiring the old app; Phase 10 launch). iOS stays deferred.
- **v4.32 (2026-10-21):** Secrets cross-check, build change, Firebase state and branch clean-up. **Secrets:** read the names (never the values) of the git-ignored `.env.all-secrets` and compared them with every `process.env` and `Deno.env` name in both repos. Nothing the code needs is missing except what is blank on purpose: `EXPO_TOKEN`, MSG91, RazorpayX (waits for the lawyer) and the `EXPO_PUBLIC_LEGAL_*` and copyright-agent values (wait for the lawyer review). The Razorpay keys live in Supabase Vault, not in Vercel. **Code:** new `scripts/sync-function-secrets.mjs`, run by the Vercel build before the functions deploy, copies an allow-list of Edge Function secrets from Vercel to Supabase (`INNGEST_*`, `IMAGEKIT_*`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `GOOGLE_MAPS_API_KEY`) through a private temp env-file, logs names only, and fails the build if the copy fails (a stale Inngest signing key would break the jobs). All nine of those names are now Edge Function secrets on the test project (checked by name through the Management API). **Boxes ticked:** `API_GATEWAY_SECRET` set and admin redeployed (admin PR 21, 16:54 UTC, after the secret was saved), Inngest account and both keys, ImageKit account and keys. **Firebase/FCM:** project `taskdrop7` exists; its `google-services.json` and service-account key name the same project and package `com.taskdrop.app`; EAS holds `GOOGLE_SERVICES_JSON` as a secret file variable in preview and production. **Not verified, so not ticked:** the FCM V1 key upload in Expo Credentials, so the `beta` APK is not built yet. **Still yours:** restricting the Maps key in Google Cloud (a security setting; two-step verification is on), rotating the ImageKit private key that was pasted into chat, the FCM V1 upload check, Uptime Robot, two Sentry alerts, the 12 testers. **Deliberately not done:** the Inngest cutover SQL (`supabase/cutover/`), which moves the money sweeps off pg_cron, and `INNGEST_MONEY_JOBS=on`; the keys being present does not switch them on. **Branches:** only `main` and `redesigned-2.0` remain, locally and on GitHub, in both repos, and local `redesigned-2.0` equals the remote. Ten open Dependabot pull requests (43 to 52, Expo SDK 58 bumps) were closed with their branches; Dependabot may open new ones on its weekly run (config unchanged).
- **v4.31 (2026-10-21):** The Phase 1 to 7 work merged into `redesigned-2.0` on your order (Phase 8 is review only, nothing built) (app PR 59, merge 74eb8d0; admin PR 20, merge 1c75505). The first real CI run of the new SQL tests found three mistakes in the tests, none in the app: `closeout` expected an RLS message where migration 117's trigger speaks, the `blocks_enforced` and `content_moderation` tests read tables as `postgres` (which migration 040 lets through every admin check, so they now assert the policy and the hide marker instead), and `chat_photos` had single `$` delimiters. CodeRabbit items fixed before the merge: 114 falls back to the built-in tiers when the setting is malformed, 117 looks up only the assignments the chat policy admits, 118 restores a pending picture to pending, `readFees` treats null, empty and out-of-range values as unreadable. Answered, not changed: the old app's promotion flow now gets a clear refusal (by design), the 8-digit phone pattern, and the follow-ups (chat report accessibility action, 5xx ordering, e2e hardening). **Now true on the test project:** migrations 110 to 118 applied, every Edge Function redeployed, the `health` op answers, Playwright passes 20 of 20. GitHub repository variables `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set (public values), so `e2e.yml` can run in Actions. **Still yours:** `SENTRY_AUTH_TOKEN` (Vercel `taskdrop`), `API_GATEWAY_SECRET` (Vercel `taskdrop-admin`), Firebase/FCM, two-step verification on `hitendureacts@gmail.com` then the Maps key restriction, Uptime Robot and two Sentry alerts. **Not done:** the admin's `npm run db:types` (needs the Supabase CLI and a login).
- **v4.30 (2026-10-21):** Playwright added (`e2e/`, `npm run test:e2e`, `.github/workflows/e2e.yml`): sign-in through the real screen, the wallet-funded money path, withdrawal and cancel, the post-start fine, a dispute, and the screens at desktop and phone size. 18 of 20 pass against the live test project; the other two prove the Phase 1 and 3 server code is not deployed yet. **Found by writing it:** the seed put the poster's Rs 5,000 in `credits_minor`, which nothing has spent since migration 066, so the seed poster could not pay for anything. The seed now uses `balance_minor` and the seed poster's wallet on the test project was fixed to match (a fake account, one row). Each test run creates a few `[e2e]` tasks and moves a few hundred fake rupees.
- **v4.29 (2026-10-21):** Phases 8 to 10 reviewed, nothing built. Phase 8 needs store accounts, a 12-person closed test and devices; Phase 9 needs your approval and would retire the old app and admin; Phase 10 is "when you decide". One finding for Phase 8: the tile map and the fallback search depend on OpenStreetMap's public servers, which is fine for testing and not for launch.
- **v4.28 (2026-10-21):** Phase 7, on `upgrade/phase-7-moderation` (both repos, local). Blocks are enforced in SQL (117); staff can hide a message or photo and fix a category (118); a chat message from the other person can be reported with a press and hold; the admin Reports queue shows reported message text with Hide / Show again; `docs/RUNBOOK.md` added. Left out on purpose: removing a review and cancelling a promotion with a refund (they touch ratings and money and need a design first). Migrations 117 and 118 are written, not applied.
- **v4.27 (2026-10-21):** Phase 6 reviewed: the web CSP box is closed by the Phase 3 `vercel.json`. Everything else open needs the ImageKit account keys or a phone. The admin has no image views to sign (new feature, needs the keys).
- **v4.26 (2026-10-21):** Phase 5 reviewed. Only the admin Alerts page could be built without the Inngest keys or the lawyer's answer (admin repo, local). The payout queue, refund retries, webhook hand-off and the money-sweep cutover were deliberately not started: they change how real money moves and cannot be tried without Inngest Cloud.
- **v4.25 (2026-10-21):** Phase 4, the safe boxes, on `upgrade/phase-4-accounts` in both repos (local, not pushed). New accounts take their name from Google/Apple (migration 115); phones use S256 sign-in codes (`lib/webcrypto.native.ts`); onboarding no longer offers an email or placeholder as a name; the admin gets a Sign-in card and a "Sign out everywhere" button (migration 116, admin repo). Sign-in switches have unit tests. **Deliberately not done:** replacing `phone-auth` with Supabase phone auth plus an SMS hook, the matching test-user migration, and Google/Apple account linking (needs manual linking switched on and a device). Migrations 115 and 116 are written and not applied.
- **v4.24 (2026-10-21):** Phase 3, the code boxes, on `upgrade/phase-3-server-decides` (local, not pushed; it sits on the Phase 1 and 2 branches). The server now refuses contact details itself (`_shared/contacts.ts`, kept equal to the app's by a test) for quotes, proofs, posts, listings, names, bios and early chat. Promotion prices come from settings (migration 114). Fee figures read the live settings (`readFees`) and the app's previews use `platformFees` (`useFees`). `places-search` does reverse lookups and the OpenStreetMap fallback. `vercel.json` gets SPA rewrites and security headers (CSP in report-only). A fresh web export has no Google key. The admin already had the App controls page and the gateway header. Open for you: `API_GATEWAY_SECRET` in the admin project, the Maps key restriction, and the device and API checks (switches per platform, maintenance, minimum version) that need a deployed build.
- **v4.23 (2026-10-21):** Phase 2, the code-only boxes, on `upgrade/phase-2-stabilize` (local, not pushed). Promotion checkout fixed properly: payment purpose `promotion` (migration 110), a stricter `activate_promotion` (111), the `razorpay` function prices a campaign itself and `PromoteScreen` uses it. Chat photos sent as plain storage paths can be opened by the other person in the thread (112). The nightly copy of the earnings sweep is unscheduled (113). `updateProfile` no longer writes the locked `payout_upi` column. Money screens report and show a message when a read fails. Migrations 110 to 113 are untested against a database from here (no `psql`/Docker; CI runs the new SQL tests `promotion_payments` and `chat_photos`) and not applied. Not done: the Playwright suite (needs a decision on how CI gets test accounts without GitHub secrets), the device and admin checklists, per-operation speed work.
- **v4.22 (2026-10-21):** Phase 1 code, on `upgrade/phase-1-sentry` (local, not pushed). Server: stack frames sent to Sentry properly, `fatal` level for the two NOT RECORDED money cases, `guarded()` on the handlers so any unexpected throw is reported, `places-search` monitored, and an unauthenticated `{"op":"health"}` on `api`. App: failed API calls are classified and unexpected ones reported, the signed-in user id (only) is attached, and `expo-updates` is added with the `appVersion` runtime policy. Build: the web export uploads its source maps and then deletes them; `app.config.js` takes `google-services.json` from an EAS file variable (`docs/FCM.md`). Admin already had Sentry. Not done, needs you: `SENTRY_AUTH_TOKEN` in Vercel, Firebase/FCM, the new APK, Uptime Robot, two Sentry alerts. Phase 0 is being finished in another session.
- **v4.21 (2026-10-21):** Owner answers. `taskdrop.in` opens for visitors and the old admin login works (both ticked). `support@taskdrop.in` is dropped: only `hitendureacts@gmail.com` is used, and the forwarding rule made the day before was deleted. The lawyer question moves to future scope (money-flow features stay off until it is answered). Testers: the owner is asking friends. The Maps key is not in any of the other three signed-in Google accounts, so it is under `hitendureacts@gmail.com`, which needs two-step verification before Google Cloud will open.
- **v4.20 (2026-10-21):** `support@taskdrop.in` forwards to the owner's Gmail (Spaceship rule; MX records already in place; untested with a real email). The EAS upload keystore was downloaded to `C:\Users\naras\Documents\taskdrop-keystore-backup\@hitendureacts__taskdrop-keystore-backup.zip` on the owner's PC; a second copy elsewhere is still the owner's step.
- **v4.19 (2026-10-20):** Phase 0, the owner items I could do. The first seed load ran on the test project and broke sign-in for about 15 minutes: the seed left NULL in four `auth.users` token columns, GoTrue's user list answered 500, and `phone-auth`'s account lookup uses it. The by-hand old-app checklist found it; the rows were patched and the seed plus its check fixed (PR 54). The Maps key now stays out of the JS bundle (PR 53; CodeRabbit caught that plugin options reach the public config, so the key is only handed over on Android builds). The Inngest sync was confirmed by calling it. Maps key restriction is blocked on Google's two-step-verification requirement for the account; the EAS keystore exists but is not downloaded; `support@` forwarding waits for a destination address; the old admin check needs the owner's login. New: `docs/LAWYER_BRIEF.md` and `docs/TESTER_RECRUITMENT.md`.
- **v4.18 (2026-10-20):** Phase 0, pull requests opened. The last local Phase 0 work went up as app PR 41 and admin PR 19, which also served as the first real run of the checks and of CodeRabbit (CodeRabbit is installed on both repos). Fixed from the reviews: the CI `database` job now installs dependencies; `scripts/lib/db.mjs` refuses any database but localhost or the exact test project (so a wrong `DATABASE_URL` can't reach production), and checks the server certificate when `DATABASE_CA_CERT` is set; `deploy-migrations` refuses files that manage their own transaction; the Vercel build fails closed if it can't pin `main` and times out the Inngest sync; the admin CI scopes the Supabase token to two steps and `db:types` reads `.env.local`. The first Vercel backend deploy ran when PR 41 merged (all 11 functions redeployed, build green). Plan: removed the duplicated sections 3.4 to 7 and corrected section 7. New open item: Vercel Authentication hides `taskdrop.in` from anyone not signed in to Vercel.
- **v4.17 (2026-10-20):** Vercel variable scopes, second pass. Every variable in `taskdrop-admin` is now All Environments, including the new `ADMIN_EMAIL` and `ADMIN_PHONE`. In `taskdrop`, `EXPO_PUBLIC_APP_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_SENTRY_DSN` are All Environments. Still open, owner steps: `API_GATEWAY_SECRET` in the admin project, `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (delete and re-add as Config), and the Preview-only `EXPO_PUBLIC_SENTRY_ENVIRONMENT` row (delete so the Production row, value `production`, can be widened).
- **v4.16 (2026-10-20):** Decision: **GitHub only stores the code; Vercel runs every deploy.** The GitHub deploy workflow (`deploy-test.yml`) and the manual Inngest-sync workflow are removed. New `scripts/vercel-build.mjs` plus `vercel.json` (on `redesigned-2.0` only, so `main`'s builds are unchanged) make the `taskdrop` Vercel build apply new migrations, deploy the Edge Functions, run the Inngest sync and then build the web app; a failed backend step fails the build. The two secrets move from GitHub to Vercel environment variables (Preview, branch `redesigned-2.0`). The admin repo's types-drift job stays but is skipped (no token in GitHub); run `npm run db:types` before admin pull requests. Pull request checks (tests, type-check, SQL tests, CodeRabbit) stay on GitHub because Vercel cannot run the SQL tests; they deploy nothing and hold no secrets. Open: the first real run on Vercel needs a push, and the build's fetch of `main` for the two old-app checks is untested there (it warns and skips if it fails). **Vercel variable scopes (owner decision: every variable on All Environments, none pinned to one environment or branch):** done in `taskdrop-admin` (all 6 variables) and for `SUPABASE_ACCESS_TOKEN` and `DATABASE_URL` in `taskdrop`. Still open in `taskdrop`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (stored as Secret, which Vercel refuses for `EXPO_PUBLIC_` names, so they must be deleted and re-created as Config); `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (one row each for Preview and Production, values unreadable from here); `EXPO_PUBLIC_APP_URL` (pinned to Preview on `redesigned-2.0` on purpose; All Environments would point the old production build at `taskdrop.in`). The admin project also lacks `API_GATEWAY_SECRET`, `ADMIN_EMAIL`, `ADMIN_PHONE`, `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT`.
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

## 12. Future scope: iOS and Safari

Decided 2026-10-20 (iOS) and 2026-10-24 (Safari): focus is web (tested in Chrome), Android and the admin app. Everything below is kept, marked `[-]` in Part A, and picked up when you say "start iOS". Safari testing waits with iOS because it needs an iPhone or a Mac.

| Phase | What waits |
|---|---|
| 0 | Apple Developer Program enrollment ($99/year) |
| 1 | `app.json` iOS block, `eas.json` iOS `beta` profile, App Store Connect record + APNs key, first TestFlight build, iPhone testers |
| 2 | Swipe-back, UPI links, Keychain session clean-up, core-flow checklist on TestFlight and in Safari (owner manual 2.3) |
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

**Also future scope, not iOS (decided 2026-10-24): private repositories.** Both repos stay public for now. When the owner says "make the repos private": switch both on GitHub (owner manual 3.3, option 2), then budget CodeRabbit (about $24 a month) and re-check anything that relied on public access. Phase 3 has the `[-]` box.

## 13. Future scope: admin authenticator

Decided 2026-10-24 (owner: "keep the admin authenticator app for future scope, no need now"). The admin sign-in stays Google or username + password, with the staff roles (Sales, Support, Finance, Viewer, full admin) deciding what each person can do. No authenticator set-up, no 6-digit code, no "Unlock money actions" step is needed to test or to run the test project.

| Where | What waits |
|---|---|
| Admin app | "My security" authenticator enrolment (QR + 6-digit code), the top-bar "Unlock money actions" chip, the code on adding staff |
| Database | `admin_require_mfa` stays `false` (it is `false` on the test project today); the `admin_mfa` SQL test keeps passing and stays in `test:db`, nothing is removed |
| Open finding | F-11 in `docs/audit/SECURITY_FINDINGS.md` (admin step-up and dual control) stays open and is accepted for the testing stage; `docs/testing_checks.md` T6.15 moves with it |
| Wording | Phase 0 line "MFA gate on money actions", Phase 4 "Admin's own login stays Google + admin role + MFA", Phase 7 "behind the money MFA gate", Part B lines on "MFA for money actions" and "sign-in with MFA": read each as skipped. The code stays; only the switch is off |

**Before launch (Phase 10):** turn it back on, because real money moves. Set up the authenticator, set `admin_require_mfa` to `true`, re-run `admin_mfa.test.sql`, and test each money action with and without a code.

## 14. The two plans: Staging (alpha, fake money) and Production (real money)

Decided 2026-10-26 (owner: "launch the app with all fake data, only for alpha testing; no real money, all payments fake; test the published app and website first; later do everything with real money and real things"). This section is the single answer to "what is fake, what is real, and what do I pay for". Phases 0 to 9 stay as they are; this section says which part of them belongs to which plan.

**The words.** *Staging* and *alpha* mean the same thing here: the published app and website that testers use, on the current Supabase project `wjxvingpfbfvkfqhrguj`, with fake data and fake money. *Production* is a separate set of accounts and projects that handle real customers and real money. They never share a database, a payment key or a secret.

| Plan | Phases | Money | Data | Who uses it |
|---|---|---|---|---|
| **Staging (alpha)** | 0 to 9, plus the alpha publish boxes in Phase 8 | Fake. Razorpay **test** keys only. No RazorpayX. Nothing reaches any bank | Fake (seed data and what testers make) | You and about 10 invited testers |
| **Production** | 10 | Real. Razorpay and RazorpayX **live** keys, real UPI and bank accounts | Real customers, starting from an empty database | The public |

### 14.1 What is fake in alpha and what becomes real in production

| Part | Alpha (now) | Production (later) | What changes |
|---|---|---|---|
| Supabase project | `wjxvingpfbfvkfqhrguj`, free plan | A **new** project on Pro, empty, in ap-south-1 | New project, migrations from `main`, secrets set again. The alpha project stays as staging |
| Data | Fake. May be wiped or reseeded (with your OK) | Real. Never wiped. Backups on | Alpha data is not carried over |
| Card, UPI and wallet top-up | Razorpay **test** mode: test cards and test UPI only; a real card is not charged | Razorpay **live** mode | Live keys after KYC; webhook registered on the production project |
| Paying workers (withdraw) | Manual payout mode: an admin marks a payout done by hand; nothing leaves any bank | RazorpayX live payouts to workers' UPI and bank | RazorpayX activated and funded; payout and refund jobs switched on |
| The money jobs (sweeps, refunds, payout retries) | Run on fake money only | Run on real money | `INNGEST_MONEY_JOBS` on in production only, after the lawyer's answer (R3) |
| Phone sign-in code | Test shortcut: any number signs in and the code is shown on screen (`dev_otp_for_all`, owner decision 2026-10-11) | Real SMS through MSG91, DLT registered | Test shortcut off; `ALLOW_ANY_OTP` and `TEST_PHONES` not set |
| Google, username sign-in | Real Google accounts (free), fake profiles | Same | Add the production redirect address to the Google client |
| Admin | Staff roles on, authenticator **off** (future scope, section 13) | Authenticator on, `admin_require_mfa = true` | Turn it back on, re-run its test |
| Web | `taskdrop.in` on Vercel Hobby | `taskdrop.in` on Vercel Pro; the alpha moves to `beta.taskdrop.in` | Pro plan, new Vercel env values, DNS change |
| Android | Direct `beta` APK, then Play **Internal testing** (and Closed testing for the 14-day rule) | Play **Production** release | Production build with production values |
| Photos | ImageKit `/beta` | ImageKit `/prod` | New folder and keys |
| Errors and jobs | Sentry `beta`, Inngest Hobby | Sentry `production`, Inngest production environment on a paid plan | New environments |
| Legal pages | Draft, marked "under legal review"; no compliance claims | Reviewed by a lawyer, grievance officer and DMCA agent named | Phase 10 Legal boxes |
| Support | `hitendureacts@gmail.com` | Same address or a real support inbox | Your call |

### 14.2 Rules that keep alpha fake (nothing real can move)

1. **Test keys only.** `RAZORPAY_KEY_ID` starts with `rzp_test_`. RazorpayX has no live keys anywhere in alpha. The live keys are made only in production (task 10.3) and go only into the production project.
2. **Key check in the code (to build, Phase 8 alpha boxes).** The money functions read an `environment` setting (`alpha` or `production`). In `alpha` they refuse a key that starts with `rzp_live_`; in `production` they refuse `rzp_test_`. A wrong key then fails loudly instead of moving money.
3. **Everyone can see it is fake.** A ribbon on every screen of the app, the website and the admin says "Alpha: fake money and fake data". The Razorpay screens already say TEST MODE.
4. **No real personal data.** Testers use the three seed accounts (Asha, Ravi, Meera), their own Google account or a made-up username. They are told not to type a real address, ID number or bank account. Withdraw screens in alpha take made-up UPI ids.
5. **Not indexed.** The alpha website sends `noindex` and `robots.txt` blocks search engines, so strangers do not land in it.
6. **Terms and Privacy say "Alpha"**, with no claim of compliance, and no promise that data stays.
7. **Alpha data is thrown away at launch.** Production starts from an empty new project. Nobody's alpha account, task or wallet moves over.
8. **Shared-database rules still apply** until Phase 9 (ground rule 4).

### 14.3 Staging plan (alpha): in order

Cost for the whole alpha: **nothing monthly.** The only possible payment is the **Google Play developer account, $25 once**, and only if you publish the Android app through Play (the direct `beta` APK costs nothing). Everything else is on free plans (Supabase, Vercel Hobby, Inngest Hobby, Sentry, ImageKit, EAS, Uptime Robot, Firebase).

| # | Step | Who | Pay? | Done when |
|---|---|---|---|---|
| S1 | Foundations, break-it pass and fixes (Phases 0 to 7) | Claude | No | Mostly done; the open items are in the owner manual's START HERE |
| S2 | Google sign-in works on web, admin and Android | Claude | No | **Done 2026-10-26** |
| S3 | **Alpha guard rails built** (Phase 8, "Alpha publish" boxes): the ribbon, the key check, `noindex`, the alpha wording in Terms and Privacy | Claude builds; you approve the wording | No | Boxes ticked and merged into `redesigned-2.0` |
| S4 | Finish the open test items: the admin photo values, the idle test, the decisions list, the mobile-data speed test | You and Claude | No | Owner manual START HERE items 3 to 8 |
| S5 | **Publish the website:** `taskdrop.in` is the alpha. Check Terms, Privacy and Support open and show the Alpha notice | Claude | No | Checked live |
| S6 | **Publish the Android app:** send the `beta` APK link to testers now. Make the Play Console app, upload the AAB to **Internal testing** (up to 100 testers, no Google review) and to **Closed testing** for the 14-day rule | You | **$25 once** (Play) | Testers install from Play |
| S7 | **Publish the admin** to the people who run alpha (you, and anyone you add as staff) | You | No | Staff roles checked |
| S8 | **Recruit the testers:** 12 for the closed test (the 14 days run during alpha, so Play production can be applied for on day 15). `docs/TESTER_RECRUITMENT.md` is the kit | You | No | 12 testers opted in |
| S9 | **Alpha rounds:** testers run the core-flow checklist (section 5.2) on web and Android with fake money; Sentry and the admin Alerts page are watched; problems go into `docs/PHASE2_PROBLEMS.md` | You, testers, Claude | No | Two rounds with no open serious issue |
| S10 | **Alpha exit gate** (below), then Phase 9 (switch everyone to the upgraded app) | You approve | No | Gate passed |

**Alpha exit gate (all true before production work starts):** E2E tests green; Sentry quiet for 7 days; monitors green; the core flow passes on web, Android and admin with fake money (post, offer, pay, work, approve, review, withdraw by manual payout); account deletion, report and block work; push arrives on Android; the closed test has run 14 days with 12 testers; the lawyer has answered R3 (or you have decided to launch with the money jobs off and payouts by hand); nothing in the alpha list of guard rails is open.

### 14.4 Production plan: in order

Do the steps in this order. The slow ones (bank account, Razorpay approval, SMS registration, lawyer) start **early and in parallel**, because they take days or weeks and cost nothing to start.

| # | Step | Who | Pay? | Notes |
|---|---|---|---|---|
| P0 | **Decide to launch** and the business basics: the legal entity, PAN, GST if you have one, a **current bank account** | You | Bank fees | Razorpay, RazorpayX, MSG91 and the lawyer all ask for these |
| P1 | **Lawyer:** send `docs/LAWYER_BRIEF.md`; get the answer on the money flow (R3: does the wallet need RBI authorisation, may the platform hold escrow or must Razorpay Route do it), the Terms and Privacy review, DPDP | You | **Lawyer's fee** (ask for a quote) | The answer decides how payouts and refunds are built, so ask first |
| P2 | **Razorpay activation (KYC)** and **RazorpayX** activation | You | Per-transaction fees; no setup fee is listed in our docs (confirm on Razorpay's pricing page) | Days to weeks. Live keys come only after approval |
| P3 | **SMS:** register on a DLT portal, register the sender name and the OTP template; buy MSG91 credits | You | DLT registration fee (one-time, check the portal) + **SMS credits, pay per use** | Needed so real phone sign-in works; weeks |
| P4 | **Play production:** apply for production access once the 14-day closed test is done; fill the store listing and the data-safety form | You | (Play account already paid in S6) | Google may take days |
| P5 | **Legal items:** register the DMCA agent; name the grievance officer; set the `EXPO_PUBLIC_LEGAL_*` values; after the lawyer, `EXPO_PUBLIC_LEGAL_REVIEWED=yes` | You | **DMCA agent $6 per 3 years** | Phase 10 Legal boxes |
| P6 | **Paid plans on:** Supabase Pro, Vercel Pro, Inngest paid, and any other tool whose free limit is reached | You | **$25 + $20 + (Inngest, check price) a month** | Before any real user, because free plans pause, throttle or forbid commercial use |
| P7 | **Build production:** a new Supabase project (Pro, ap-south-1), migrations from `main`, secrets from section 7, functions deployed, Inngest production environment, ImageKit `/prod`, Sentry `production`, Firebase App Check production keys, production Vercel env values, Google client redirect address added | Claude, with you for the logins | Covered by P6 | Empty database, no alpha data |
| P8 | **Switch on the real-money parts, one at a time:** live Razorpay keys (webhook registered on the production project), RazorpayX live and **funded**, the money jobs (`INNGEST_MONEY_JOBS`), payouts, refunds | Claude builds and switches; you put the live keys into Vault yourself | RazorpayX balance (see 14.5) | The `environment` setting is `production` and the key check passes |
| P9 | **Switch off every test shortcut:** `dev_otp_for_all` false; `ALLOW_ANY_OTP` and `TEST_PHONES` not set; the alpha ribbon gone; the admin authenticator on and `admin_require_mfa = true`; the lockdown SQL run | Claude | No | Each one has a test in Phase 10 |
| P10 | **Domains:** production on `taskdrop.in` and `admin.taskdrop.in`; the alpha website moves to `beta.taskdrop.in` | You and Claude | Domain renewal, about $6 a year | DNS stays at Spaceship |
| P11 | **One real job with a few rupees:** post a ₹10 job, pay with your own UPI, finish it from a second account, approve, withdraw to your own bank | You | Real ₹10 plus fees | Money must arrive |
| P12 | **Launch gate:** E2E green, Sentry quiet 7 days, monitors green, rollback ready (Vercel rollback, EAS Update rollback, Supabase backups, written undo for each migration) | Claude | No | Phase 10 Launch gate |
| P13 | **Release on Google Play production**; announce | You | No | The only step the public sees |

Never in this plan: copying alpha accounts or data into production, putting live keys into the alpha project, or using the alpha project for real customers.

### 14.5 Where you have to pay for production (and why)

| Payment | Why it is needed | Amount (from this plan; check the provider's page when you pay) | When | Alpha? |
|---|---|---|---|---|
| **Supabase Pro** | Production project with backups; free projects pause after about a week idle | $25 a month | Before real users (P6) | No (free plan) |
| **Vercel Pro** | The free Hobby plan is for non-commercial use | $20 a month per member | Before real users (P6) | No (Hobby) |
| **Inngest paid plan** | Hobby allows 50,000 runs a month and about 28,500 were used by 24 October with only the test group; at the limit runs stop and push stops | Check the price on its Billing page | Before the money jobs run for real users | No (Hobby) |
| **Razorpay** (payments in) | Every real card or UPI payment: the poster's money held in escrow | A fee on each payment (no setup fee is listed in our docs) | After KYC approval (P2) | No (test mode, free) |
| **RazorpayX** (payouts out) | Paying workers' earnings to UPI or bank, and refunds | A fee on each payout, **and the RazorpayX balance must hold the money to pay out.** How that balance is funded depends on the lawyer's answer (R3). Plan for this working capital yourself | P8 | No (not set up) |
| **Current bank account** | Razorpay and RazorpayX require a business current account | The bank's fees | P0 | No |
| **MSG91 SMS** | Real sign-in codes to real phones | Per-SMS charge; credits bought in advance | P3 | No (test code shown on screen) |
| **DLT registration** | Indian rules: sender name and the OTP template must be registered or SMS is blocked | One-time fee at the DLT portal | P3 | No |
| **Google Play developer account** | Publishing the Android app | $25 once | S6, during alpha | **Yes, only if you publish through Play in alpha** |
| **DMCA agent** | Legal protection for user-uploaded content | $6 per 3 years | P5 | No |
| **Lawyer** | Money flow, Terms, Privacy, DPDP | A fee; get a quote | P1, first | No |
| **Google Maps / Places** | Place search and map tiles at volume; OpenStreetMap's public servers are not for heavy commercial use | Pay per use after the free credit. Billing is already active on the Google Cloud project (a ₹100 monthly budget alert is set, `docs/FCM.md`); raise the alert and set quotas when real traffic starts | Before store release (task 8.1) | No (free tier, low volume) |
| **Domain `taskdrop.in`** | Already bought | About $6 a year; keep auto-renew on | Yearly | Already paid |
| **Sentry, ImageKit, EAS, Uptime Robot** | Free tiers cover alpha; production traffic may pass the limits | Check each plan when its limit nears (the `api` health monitor needs Uptime Robot's paid plan) | When a limit warns | No |
| **CodeRabbit** | Only if the repos become private (future scope) | About $24 a month | Only then | No |
| **Apple Developer Program** | iOS and Sign in with Apple | $99 a year | **Future scope** (not in this launch) | No |

Free and needed in both plans: Google sign-in, Firebase (push, App Check), Sentry free alerts, GitHub public repos.

### 14.6 Build list for the alpha publish (added to Phase 8)

These are the new boxes in Phase 8, "Alpha publish". Nothing is built until you say "start Phase 8" (ground rule), except that you may say "build the alpha guard rails" to start them first.

- The `environment` setting in app controls (additive, ground rule 4) and the key check in the money functions (14.2 rule 2)
- The alpha ribbon in the app (web and Android) and the admin
- `noindex` and `robots.txt` on the alpha website
- Alpha wording in Terms and Privacy (approved by you)
- A short "How alpha works" page or card for testers: fake money, fake data, what to test, where to report problems
- A "report a problem" path for testers (the in-app feedback already exists; confirm it reaches you)
