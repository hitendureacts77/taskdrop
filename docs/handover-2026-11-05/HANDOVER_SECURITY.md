# Handover: the security work of 4-5 November 2026

Written 5 Nov 2026 (just after midnight IST) by Claude, at the owner's request to stop building and hand over.
Plain words first, then the facts a new session needs. No secret, key, phone number or email is in this file.

**Start the next session with:** "Read `docs/handover-2026-11-05/HANDOVER_SECURITY.md` and continue from section 5."

---

## 1. What the owner asked for (4 Nov)

1. Start every security plan in `docs/ULTIMATE_PLAN.md` and finish them all (not just plan them).
2. First merge everything into `redesigned-2.0` (all local branches and the other design session's work), deploy it to taskdrop.in and the phone app, check the UI is undisturbed, and only then run the security checks on that latest code.
3. Models: Opus 5.5 for hard repeated work, Sonnet 5.5 / Haiku 5.5 for routine work (see memory note "Model split").
4. Rights given: sign in to web, phone (USB debugging, Oppo CPH2585, serial 56b2717c) and the admin app as hitendureacts@gmail.com (Google sign-in on the admin: only pick the account, never type passwords).
5. Late on 4 Nov the owner answered **"Fix the Mediums"**. Seven helpers were started for that and all were cut off by the **5-hour usage limit (resets 12am IST, 5 Nov)** before opening any pull request. Then the owner said: stop building, write this handover. **Nothing for the Mediums is merged.**

## 2. What is DONE and live (all on staging; production untouched)

| Thing | State |
|---|---|
| All local branches + the open security PR merged into `redesigned-2.0` | PR 230 (gstack T1-T3, hunt round 1, 2.13 C-J). The map search box branch `feat/map-search-dim` was NOT merged: it conflicts with the approved D14 map redesign; owner to decide |
| Migrations renumbered (staging already had `142_session_cutoff`) | 143 api_rate_spend, 144 nearby_pulse_indexes, 145 withdrawal_checks_restored. Hunt holes renumbered H32-H34 |
| Guest mode (D15, other design session) | PRs 231, 232 merged by that session |
| Content policy now **blocks** (H9 closed) | PR 233. Checked on taskdrop.in: guest mode and api calls work under it |
| Money doors (H35, H36, H46, H50, B16, B17) | PR 234, migration 147 `check_money_staff`. Admin B19 fix: admin PR 44 |
| **Critical money bugs fixed** (H51 negative quote created money; H53 card-paid job re-hired at a dearer price; H54 old helper could press Start; B20 early dispute) | PR 236, migration 148. Independent review done, CI green, retested live on staging (negative, zero and absurd quotes and a negative task price are refused by the database). An OVERDUE job stays open to the poster's dispute on purpose |
| Plan updated with every finding | PRs 235 and 237 (`docs/ULTIMATE_PLAN.md` + rebuilt HTML) |
| Secrets audit (task 2.15) | Done: Betterleaks 1.9.0, both repos, files + whole history, values hidden. Nothing live exposed. Two Low cards: old Razorpay TEST key in public history (already accepted); beta Android builds carry the App Check debug token (hole **H56**, delete that token in Firebase before launch) |
| Android app test T11 | Passes (no server keys in the app file, phone log clean, session in secure storage, Android backup off) |
| Guest-mode attack (new signed-out door) | 128 api actions tried signed out: only the 24 guest reads answer; bad tokens are never downgraded to guest; nothing Critical or High |
| Hunt round 2 parts A, D, E, F, H | Done (reports copied into this folder, section 7) |
| Basic UI check | Desktop web, the phone's Chrome, the Android app (Home, Profile, Account settings, Find work, full map with D14 sheet), admin sign-in + dashboard: no UI problems seen |

**Deployed versions (4 Nov):** `redesigned-2.0` head at the time was `26209e7` (user repo) and includes PRs up to 237. taskdrop.in follows that branch by itself. Staging database has migrations up to **148**. Admin app deployed from its `redesigned-2.0` with PR 44. Phone: installed the 1.1.0 beta APK (EAS build b79d5cfa) over USB, then published two updates to channel `beta`, runtime 1.1.0: group `00ef021a-233d-4989-bb11-b715d7acdd47` (commit 722e198) and group `c34b80a3-0d99-482e-918a-0cc78b5d8f75` (commit 491426f, includes guest mode). The phone's log never named the running bundle, so "the phone runs the newest update" is **not proven**. Source maps for both were uploaded to Sentry.

## 3. What is NOT done

### 3a. The Medium fixes (owner said "Fix the Mediums")
Zero merged. Helpers were launched in parallel with these briefs; **re-run them** (a new session cannot resume the old helpers). Migration numbers were reserved so helpers do not clash: **149, 150, 151, 152 (153 if needed)**. Every helper appends ONE `-f supabase/tests/<name>.test.sql` to the END of the `test:db` list in `package.json`, and several PRs will clash on that one line when merged: resolve by keeping both lists' files (merge the two `-f` lists), as was done for PRs 234 and 236.

| Branch (user repo unless noted) | Findings | What to build | Migration | Model |
|---|---|---|---|---|
| `fix/hunt2-caps` | H43, H44, H47 | Ads: one counted click per viewer per promotion per day, never count the advertiser's own clicks, cap impressions per viewer, keep `ad_events` bounded. Files: max uploads/day (300) and bytes/day (500 MB) per person where uploads are registered (`media_begin`, `api/media.ts`). Posting: daily cap per account for tasks/listings and feedback posts (20/day; 5/day for new accounts, reusing the 2.11 "new account" rule), crew post counts once, system repeat jobs and seed scripts are not blocked. All numbers are `settings` rows read with `private.setting_num` | `149_abuse_caps` | Sonnet |
| `fix/hunt2-sms-places` | H40, H39 | SMS: daily cap per phone number (10), reserve part of the 500/day global allowance for numbers that already have an account, count only real sends. Places search: daily cap per person (150) and a daily total (3,000), past it fall back to the free OpenStreetMap search the app already has. Edit `phone-auth/index.ts`, `places-search/index.ts` | `150_sms_places_caps` | Sonnet |
| `fix/hunt2-guest` | H61, H62, H63, B31 (+ H66, H67) | Guest reads return an area-only place label (no flat/house number; computed at read time, no data change). `private.guest_task_json` becomes a fixed allow-list of columns, with a test. Guest rate limit: cost-weighted calls, a global per-minute ceiling that degrades gracefully, cap page/limit/batch depth, fail bounded (not open) if the limiter is unreachable. Client: guest drafts and saves must not move into a different already-existing account on a shared phone, drafts cleared on sign-out (`AuthProvider.tsx` ~303-308, `HomeScreen.tsx` ~383, `lib/drafts.ts`, `lib/guestSaves.ts`). `check-endpoints.mjs` should understand the guest door | `151_guest_hardening` | Opus |
| `fix/hunt2-plain-pushes` | H42 (decision 26, recommended answer) | Lock-screen push title/body for chat, payout, wallet, support, security become plain lines ("You have a new message" etc.), no names, amounts or text; in-app notification text and deep links unchanged | `152_plain_pushes` (only if SQL changes) | Sonnet |
| `fix/hunt2-uploads` | H38, H41 | Pictures to ImageKit only in production (Supabase Storage picture fallback refused there); video location data: strip only if the code can touch the bytes, otherwise a plain notice on the upload screen; a weekly Inngest job deleting ImageKit files with no `media` row older than 2 days (max 200 per run, no-op when ImageKit keys are not set); short upload-token expiry | none expected (153 if needed) | Sonnet |
| `fix/hunt2-admin-cookies` (**admin repo**) | H37 | Admin login cookies HttpOnly + Secure + SameSite=Lax with at most 12 h lifetime; the two places using the browser client (live panel, authenticator panel) move to a server route or in-memory token; fix the misleading comment in `app/api/auth/password/route.ts`. Must not lock admins out; needs a manual Google sign-in check on the preview | none | Opus |
| `fix/hunt2-contact-columns` (**admin repo**) | H33 | Only Admin and Support roles see/export full phone and email; other roles get masked values, enforced on the server; audit row when a person page with contacts is opened | none | Sonnet |

**Only partial files that survive:** worktree `C:\complete taskdrop\Taskdrop user\.claude\worktrees\agent-adb32bf21afa9ca8e` (branch `fix/hunt2-sms-places`, uncommitted, never reviewed or tested): `supabase/functions/_shared/sendCaps.ts`, `sendCaps.test.ts`, `supabase/migrations/20261105100000_150_sms_places_caps.sql`. The other four user-repo worktrees (`agent-a2a6b487ee60d481d`, `agent-ae51b4b0f6c83b42a`, `agent-a8d2dc6a1acd81688`, `agent-ac61a83ceca4f099d`) have a branch and no changes. The two admin clones (scratchpad `h33-admin`, `h37-admin`) are clean. Nothing was pushed for any of the seven.

### 3b. Other open items
- **H52 (High):** the database's direct data door is open to every signed-in person (the known hole H3). Closes in task 3.9 (gateway-only); production is built closed from day one (5.9). The H51 price rules reduce the damage until then.
- **H34 (Medium, big build):** wallets have no per-movement record, so the books cannot be proven to balance. Add-only `wallet_movements` written by every money function plus a balance test. Deliberately NOT started: it rewrites every money function. Needed before Step 5.
- **Owner decisions still open:** PAN before withdrawals (decision 17); decision 25 (18+ check for guests, H68); 26 (lock-screen pushes; recommended "plain line", implemented only once the pushes helper is re-run); 27 (posting caps / new-account limits, H47); H30 and H31 (password rules, SMS as main sign-in, from 2.13 part C); H27 owner click: make both GitHub repos private.
- **Task 2.16 Strix (AI attacker): not started.** Needs the owner to install Docker Desktop (not installed on this PC, checked 4 Nov) and save a spending-limited AI key as `STRIX_LLM_API_KEY` in `.env.all-secrets` (never in chat); then the owner says "start 2.16".
- **2.14 part G** (every screen, slow/offline/double-tap/Back, midnight dates, Hindi text, bigger text) is only partly done: the basic screens were opened and looked right; the full checklist is still to do.
- **Low findings, waiting for "fix" or "accept":** H45, H48, H49, H55, H56, H64, H65, H68, B18, B21, B30, B32 (details in the reports and in the plan's security card).
- Cosmetic: staging seed person "Meera" has a leftover test string as her display name (plain text, harmless).
- Branch cleanup: merged branches on GitHub (e.g. `fix/hunt2-money-doors`, `fix/hunt2-critical-money`, `docs/hunt2-fixed`, `feat/security-2-13-rest`, `merge/local-work-4-nov`, `fix/csp-enforce-h9`) were not deleted (the permission check blocked it). Harmless; the owner can ask for them removed. Dependabot PRs 219-225 are still open (not touched).
- Another session has PR 238 open (`feat/keep-draft-after-signin`, guest draft work). It touches the same area as B31: look at it before re-running the guest helper.

## 4. How this repo works (rules a new session must follow)

- Read `AGENTS.md`. Key rules: migrations only ADD (never edit or drop a recorded one); no `begin/commit` inside a migration file; the app asks, the server decides; never print secrets, phone numbers or emails; keys only in `.env.all-secrets` and the server stores; never rotate or regenerate keys.
- All work goes through a short-lived branch and a PR into `redesigned-2.0` (both repos: `Taskdrop user` = hitendureacts77/taskdrop, `Taskdrop administrator` = hitendureacts77/taskdrop-admin). Rule 7: push, open the PR and merge without asking. **Ask first** before: publishing an app update to testers (OTA or EAS build; the owner did ask for it on 4 Nov), a wipe/reseed/reset, rotating a key, anything on `main` or production.
- **Merging to `redesigned-2.0` applies new migrations to staging and redeploys functions and taskdrop.in** (Vercel build script `scripts/vercel-build.mjs`: step 2 migrations, step 5 functions, step 7 web). So a merge IS a deploy.
- Security review before every merge (rule 9). Used this session: an independent read-only reviewer compared every rewritten database function with its previous definition (a past incident: migration 071 silently dropped three withdrawal checks; `scripts/check-lost-refusals.mjs` now guards this).
- CI check "money and access rules" runs the whole SQL suite (`npm run test:db`) on a throwaway database: it is the real test for migrations. In CI the session user is `postgres`, which `private.is_admin()` trusts, so tests that expect "Admins only" for an ordinary person can see the role-rule message instead (this broke one test on PR 234; assert either message).
- Staging project ref `wjxvingpfbfvkfqhrguj` is the only test database. SQL there only as `begin; ... rollback;` or read-only SELECT, through the Supabase `execute_sql` tool (the tool does not show NOTICE output: put results in a temp table and select them before rollback). Seed people: Asha (poster), Ravi and Meera (helpers), user ids `5eed0000-0000-4000-8000-00000000000{1,2,3}`; a task id used by tests: `d1d1e000-0000-4000-8000-000000000003`.
- Signed-in api tests: `scripts/lib/staging-session.mjs` (now requires staging's exact host). `EXPO_PUBLIC_*` values in `apps/mobile/.env` are public; load with `@expo/env` and print nothing else.
- Model split: Opus for money logic, guest/auth/security design; Sonnet for routine code, reviews, docs, checks.
- Plan files: edit `docs/ULTIMATE_PLAN.md`, then `node scripts/build-plan-html.mjs`; commit both.

## 5. Where to continue (in this order)

1. After 12am IST the usage limit is over. `git fetch`, check `gh pr list` in both repos, and check PR 238.
2. Re-launch the seven Medium helpers (table 3a) in **batches of three or four**, not seven at once (seven in parallel plus Opus burned the limit). Give each the brief from the table and the report file in this folder. Review each PR (CI + a read-only reviewer for anything rewriting money or auth functions), merge one at a time, fix the `test:db` list clash, wait for the Vercel build, then retest on staging.
3. Then: H34 ledger (design first, it touches every money function), Strix (after the owner's Docker + key), part G screens on the phone and web, the Low findings, update the plan after each merge.
4. Publish a new OTA only when the owner asks. Recipe: memory note `ota-publish-recipe` (export with `eas env:exec preview "npx expo export -p android --source-maps"`, upload source maps to Sentry without a shell because the repo path has spaces, `eas update --skip-bundler --channel beta --platform android --environment preview`, launch the app twice). The Sentry token is upload-only (reads give 403): read Sentry issues in the browser instead (organization `hitendu`, project `taskdrop`).

## 6. Tools and environment notes

- Claude in Chrome works; Google sign-in on the staging admin works again (`https://taskdrop-admin-git-redesigned-20-hitenduteam.vercel.app/`). One-off Vercel preview addresses are NOT in the servers' allowed-origin list (by design, H8), so api calls from them show status 0; test on taskdrop.in or the `…-git-redesigned-20-…` addresses.
- adb: `C:\Users\naras\android-tools\platform-tools\adb.exe`; use `MSYS_NO_PATHCONV=1` in Git Bash. The app id is `com.taskdrop.app`.
- Betterleaks was installed in the scratchpad (`...\scratchpad\tools\v1.9.0`); its reports are in `...\scratchpad\secrets-audit\` (values hidden). Those temp folders may be cleaned by the system; the audit conclusions are in the plan. Docker, Semgrep and gitleaks are not installed locally (CI runs Semgrep and gitleaks).
- Write long files with the Write/Edit tools, not shell heredocs with backslashes (a regex lost its backslashes in the shell once this session).

## 7. Files in this folder

- `HANDOVER_SECURITY.md` (this file)
- `hunt2-AFH-doors-admin-background.md`: hunt round 2 parts A (every door), F (admin), H (background work); holes H35-H50, bugs B16-B19, with evidence.
- `hunt2-DE-task-life.md`: parts D and E (the task's life, new features); H51-H55, B20-B21, with the failing rolled-back SQL tests.
- `hunt2-guest-mode.md`: the guest-mode attack; H61-H68, B30-B32.
- Round 1 is in `docs/HUNT_ROUND1.md`; the OWASP check is `docs/SECURITY_OWASP.md`; the plan is `docs/ULTIMATE_PLAN.md` (Security section, task 2.14 to 2.16, changelog entry of 4 Nov).
