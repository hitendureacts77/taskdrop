# EAS auto-deploy plan (Android beta only)

Plan only, written 2026-11-04. Nothing here has been built, run or published yet.

## 1. Goal

The owner asked for this: when code lands on GitHub branch `redesigned-2.0`, expo.dev should handle the Android test app by itself. This is the owner's standing OK for automatic beta updates on push. It covers the `beta` channel only. Production stays manual and nobody touches it.

| | Today | After this plan |
|---|---|---|
| Web | Vercel deploys by itself | Same, no change |
| Android JS change | Someone runs `eas update` by hand from this PC | expo.dev publishes an over-the-air (OTA) update to `beta` |
| Android native change | Someone runs `eas build` by hand | expo.dev builds a new beta APK. No OTA goes out |
| Docs / supabase / admin-only change | Nothing on EAS | Still nothing on EAS (paths filter) |
| Brake | n/a | Put `[skip eas]` in the merge commit message, or switch the workflow off (section 4) |

## 2. Design decisions (one-line reasons)

- **File location:** `apps/mobile/.eas/workflows/beta-android.yml`. The Expo docs say `.eas` "should be at the same level as" `eas.json`, which lives in `apps/mobile`.
- **Trigger:** `on: push: branches: ['redesigned-2.0']`. This is the branch the owner merges into. `main` and production stay untouched.
- **Paths filter** (written from the repo root, like the docs example `apps/mobile/**`): `apps/mobile/**`, `packages/**` (the app imports all four workspace packages), `package.json`, `package-lock.json`. Changes only to supabase/, docs/ or the admin repo then cost no EAS minutes.
- **Job graph:** the docs' "build or update" pattern.
  1. `fingerprint` (environment preview) works out a hash of the native code.
  2. `get_build` (platform android, profile `beta`, `fingerprint_hash: ${{ needs.fingerprint.outputs.android_fingerprint_hash }}`) looks for an existing beta APK with that hash.
  3. `build` (profile `beta`) runs only when no match is found: `if: ${{ after.get_build.status != 'success' }}`, written on ONE line.
  4. `update` runs only when a match is found: `if: ${{ needs.get_build.status == 'success' }}`.
  The point: an OTA must never land on an APK whose native code doesn't match it.
- **Update job settings:** `channel: beta` (and no `branch`, because the two can't be combined), `platform: android`, `environment: preview`, and a message built from the commit, such as `${{ github.commit_message }}` (checked in task 4). Existing beta APKs listen on channel `beta`, so the OTA reaches them.
- **Build profile `beta`** (internal APK, channel beta, environment preview). It matches the existing builds: the latest one is 1.1.0, from 3 Nov, fingerprint `2ceff9c2…`.
- **Environment = EAS `preview`.** The cloud has no local `.env` files, and an `update` job does NOT read the `env` block in `eas.json`. Every non-secret `EXPO_PUBLIC_*` value the app needs must therefore be stored in the EAS `preview` environment (gap below).
- **Sentry maps:** `upload_sentry_sourcemaps: true` on the update job. `SENTRY_AUTH_TOKEN` is already in the `preview` environment. The spaces-in-path workaround in the old recipe isn't needed in the cloud.
- **Rollback:** use the expo.dev Updates page ("republish previous" or "roll back") or `eas update:republish`. An APK can't be rolled back; testers reinstall the older one.
- **Production:** no `production` profile, environment or channel appears anywhere in the workflow.

### Variable gap (checked 2026-11-04 with `eas env:list`, names only)

- The EAS `preview` environment holds: `EXPO_GOOGLE_MAPS_API_KEY`, `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_SERVICES_JSON`, `SENTRY_AUTH_TOKEN`. Builds are fine.
- **Missing for a cloud OTA:**
  - `EXPO_PUBLIC_SUPABASE_URL`. Without it the app cannot reach the server at all (src/lib/supabase.ts falls back to `''`).
  - `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (=beta), `EXPO_PUBLIC_SENTRY_REPLAY_RATE` (=1).
  - The legal names `EXPO_PUBLIC_LEGAL_ENTITY`, `_ADDRESS`, `_EMAIL`, `_JURISDICTION`, `_REVIEWED`, `EXPO_PUBLIC_GRIEVANCE_OFFICER_NAME`, `_EMAIL`. Today these come from this PC's `apps/mobile/.env.local`, so hand-made OTAs show them and APK builds don't.
- All of these are public values that already ship inside the app. They are not secrets. Adding them needs owner approval (owner step O4).

### Risks and unknowns

1. **OTA reaching an older APK (most important).** `runtimeVersion` uses the `appVersion` policy, so every 1.1.0 APK accepts every 1.1.0 OTA. Here is the failure: a push adds a native library, so a new APK is built. The next JS-only push then sends an OTA that also reaches the OLD 1.1.0 APKs, which lack that library, and the app crashes. Two fixes:
   - (a) Bump `version` in app.json on every native change.
   - (b) Switch to `"runtimeVersion": {"policy": "fingerprint"}`. Each OTA then only reaches APKs with matching native code. This is also the setup the docs pattern assumes. Cost: one new APK right after the switch.
   **Recommendation: (b).** Owner question Q1.
2. **Monorepo location.** The docs don't cover monorepos. Check it before merging (task 6). The first real run is the final proof.
3. **`get-build` with no match.** The docs don't say what happens. We assume the job "fails" and the `build` job then runs. If the whole workflow stops instead, task 3 has a fallback: `fingerprint` → `get_build` plus `build` with `after:`, so the build doesn't depend on get_build succeeding.
4. **Plan limits.** The free EAS plan has a monthly build quota and update limits. Native changes are rare, but each one costs a build of about 15-25 minutes. Workflow runs may be billed separately. Owner: check Billing (O5).
5. **The first push after merging triggers the workflow too.** That push will most likely publish an OTA, or a build if the fingerprint computed in the cloud differs from `2ceff9c2…`. That's acceptable: it is the test. If the owner wants it quiet, put `[skip eas]` in that merge commit.
6. **Every merge goes straight to testers' phones.** The CI checks run in parallel on GitHub, not before EAS. A broken merge reaches beta phones within minutes. Brake and rollback are in section 4.
7. **Web-only edits under `apps/mobile/src` also trigger an OTA.** Web and Android share that code, so this is harmless but uses update quota.

## 3. Tasks

**1. [OPUS] Decide the runtimeVersion policy and the final job graph (after the owner answers Q1).**
- File: `apps/mobile/app.json`. If (b) is chosen, edit `runtimeVersion` only.
- Done when: a written YAML spec for task 3 exists, with job ids, `needs`/`after`, and both `if` lines. Each failure mode is noted: get-build no match, a build that fails, an update that fails.
- Do NOT touch: `version`, `eas.json` profiles, production.

**2. [OPUS] Confirm the variable list.**
- Re-run `npx eas env:list --environment preview --format short` from `Taskdrop user/apps/mobile`. The worktree has no node_modules. Strip the values before printing.
- Done when: the list of missing names is final and handed to the owner for O4. Every `process.env.EXPO_PUBLIC_*` in apps/mobile/src is either covered or has a known fallback (APP_URL, FIREBASE_*, RECAPTCHA, COPYRIGHT_AGENT_* are not set anywhere today, so behaviour stays the same).
- Do NOT create any variables yourself, and never print values.

**3. [SONNET] Write `apps/mobile/.eas/workflows/beta-android.yml`** from the task 1 spec.
- Contents: name, `on.push` branches and paths, and the jobs fingerprint / get_build / build / update with `environment: preview`.
- Done when: the file is under 16 KiB, contains no secrets and no literal URLs or keys, and names production nowhere.
- Do NOT touch `eas.json`, `.github/workflows/*`, or `vercel.json`.

**4. [SONNET] Check the workflow file.**
- Run `npx eas workflow:validate .eas/workflows/beta-android.yml` from `Taskdrop user/apps/mobile` after copying the file there, or from the worktree once deps are installed. Validation is read-only.
- Fix any syntax error and confirm the commit-message expression name.
- Do NOT run `eas workflow:run`. That starts a real OTA or build and needs the owner's OK.

**5. [SONNET] Update the docs.**
- In `docs/ULTIMATE_PLAN.md`, add one line under the Android/OTA area, then run `node scripts/build-plan-html.mjs`.
- Add a "Now automatic" note to the OTA recipe section if one exists in docs.
- Do NOT edit any other plan items.

**6. [OPUS] Review the final YAML against the docs page** https://docs.expo.dev/eas/workflows/syntax/ (read past offset 100000 as well).
- Checks: environment key per job, the channel-vs-branch rule, `if` syntax, the fingerprint output name, paths relative to the repo root, and the monorepo answer.
- Done when: a short go/no-go note is posted in the PR.

**7. [SONNET] Open the PR** from `feat/eas-auto-deploy` into `redesigned-2.0` (never `main`).
- Body: what it does, the owner steps O1-O6, and a warning that merging it triggers the first run.
- The house rule says "merge without asking", but this merge publishes to phones. Ask the owner before merging, or merge with `[skip eas]` in the merge message.

## 4. Owner-only steps (in order)

- **O1. Connect GitHub.** On expo.dev, open project **taskdrop** > **Project settings** > **GitHub**. Click **Connect**, install the Expo GitHub app on `hitendureacts77/taskdrop` (that repo only), then pick the repo.
- **O2. Base directory.** On the same GitHub settings page, set **Base directory** = `apps/mobile` and save.
- **O3. Answer Q1** (runtime policy: fingerprint, recommended, or appVersion).
- **O4. Add the missing public values** listed in section 2 to the EAS **preview** environment.
  - Where: expo.dev > Project > **Environment variables** > **Add**. Visibility "Plain text" or "Sensitive". Tick only the **Preview** environment.
  - Copy the values from `apps/mobile/eas.json` (the beta profile) and this PC's `apps/mobile/.env.local` (legal names).
  - Do not add `SENTRY_AUTH_TOKEN` again; it is already there.
- **O5. Check limits.** expo.dev > Account > **Billing / Usage**: builds left this month and update limits.
- **O6. Approve the merge.**

**Brake:**
- One push: put `[skip eas]` (or `[no eas]`) in the commit or merge message.
- Everything: open a PR that deletes `apps/mobile/.eas/workflows/beta-android.yml` and merge it. Quicker: on the expo.dev GitHub settings page, disconnect the repo.
- Undo a bad OTA: expo.dev > **Updates** > branch beta > the earlier update > **Republish**.

### First-run test checklist

- [ ] After the merge, expo.dev > **Workflows** shows a run for that commit. If no run appears, the file location or base directory is wrong (risk 2).
- [ ] `fingerprint` finished, and its Android hash is written down.
- [ ] If the hash equals the latest beta build's: `get_build` succeeds, `build` is skipped, `update` publishes to channel beta (android only, environment preview).
- [ ] If the hash differs: `build` runs once, the new APK appears under Builds > beta, and `update` is skipped. Install it on the phone.
- [ ] On the phone (current beta APK): open the app twice. The new update loads. Sign-in works, which proves `EXPO_PUBLIC_SUPABASE_URL` arrived. The legal pages show the names.
- [ ] Sentry: throw a test error and check that the stack trace is readable (source maps uploaded).
- [ ] Push a docs-only change. No workflow run should appear (paths filter).
- [ ] Push with `[skip eas]` in the message. No run.

## Owner questions

- **Q1.** Switch `runtimeVersion` to `fingerprint` (safer, one new APK) or keep `appVersion` and remember to bump the version on every native change?
- **Q2.** Should the merge of this PR itself publish (it is a good first test), or should it carry `[skip eas]`?

## Final missing variables (task 2)

Checked 2026-11-05 with `eas env:list preview` (project scope; account scope has none), names only. Compared with every `process.env.EXPO_PUBLIC_*` in `apps/mobile/src` and `app.config.js`.

**Already in EAS `preview`:** `EXPO_GOOGLE_MAPS_API_KEY`, `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_SERVICES_JSON`, `SENTRY_AUTH_TOKEN`. No change.

**Missing, must be added before the first cloud OTA (owner step O4).** All four are public values that already ship inside the app. Use exactly the same value as the `beta` profile in `apps/mobile/eas.json`, so builds and OTAs agree:

| Name | Where the value comes from | Without it |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `eas.json` > `build.beta.env` (same value in this PC's `apps/mobile/.env`) | App cannot reach the server at all (falls back to `''`) |
| `EXPO_PUBLIC_SENTRY_DSN` | `eas.json` > `build.beta.env` (same value in `apps/mobile/.env`) | No crash reports from that OTA |
| `EXPO_PUBLIC_SENTRY_ENVIRONMENT` | `eas.json` > `build.beta.env` (value `beta`; not in any local file) | Crashes are filed under `production` in Sentry |
| `EXPO_PUBLIC_SENTRY_REPLAY_RATE` | `eas.json` > `build.beta.env` (value `1`; not in any local file) | Replays drop to the 5% default |

**Correction to section 2: the legal names are NOT needed now.** `EXPO_PUBLIC_LEGAL_ENTITY`, `_ADDRESS`, `_EMAIL`, `_JURISDICTION`, `_REVIEWED`, `EXPO_PUBLIC_GRIEVANCE_OFFICER_NAME` and `_EMAIL` exist in this PC's `apps/mobile/.env.local` but are all EMPTY, and nowhere else. Hand-made OTAs and APKs have both used the fallback wording in `src/legal/company.ts`. Cloud OTAs behave the same. Add them to EAS `preview` only when the owner fills them in (legal open item).

**Not set anywhere today, so behaviour stays the same (fallbacks in code):** `EXPO_PUBLIC_APP_URL`, `EXPO_PUBLIC_COPYRIGHT_AGENT_NAME` / `_EMAIL` / `_ADDRESS` / `_PHONE`. Web only, and not used by Android: `EXPO_PUBLIC_FIREBASE_API_KEY` / `_APP_ID` / `_PROJECT_ID` / `_SENDER_ID` and `EXPO_PUBLIC_RECAPTCHA_SITE_KEY` (`appCheck.web.ts`), and `EXPO_PUBLIC_APP_ENV` (`scripts/web-env-guard.mjs`, Vercel build).

**Side finding:** hand-made OTAs from this PC never had `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (it is only in `eas.json`, which `eas update` does not read), so their crashes went to Sentry's `production` environment. Cloud OTAs fix that once the variable is added.

**Graph correction (task 1):** section 2's `if` lines (`after.get_build.status != 'success'` / `needs.get_build.status == 'success'`) are wrong for the documented behaviour. The docs' own example shows `get-build` SUCCEEDS with an empty `build_id` when nothing matches, so those lines would never build and would publish OTAs nobody can receive. The final graph branches on `build_id`; see `docs/eas-workflow-spec.draft.yml`.

## Status (2026-11-05)

- **Tasks 1 to 5 are done.** Task 1: `runtimeVersion` is `fingerprint` in `app.json` and the spec was written. Task 2: the variable list is final (section above). Task 3: the spec is now the live file `apps/mobile/.eas/workflows/beta-android.yml`, copied unchanged apart from the header comment, and `docs/eas-workflow-spec.draft.yml` was removed. Task 4: validated. Task 5: one open line under task 3.7 and one changelog line in `docs/ULTIMATE_PLAN.md`, and `docs/ULTIMATE_PLAN.html` was rebuilt.
- **Validation (read-only):** `npx eas-cli@latest workflow:validate .eas/workflows/beta-android.yml`, run from the worktree `apps/mobile`, answered "Workflow configuration YAML is valid." The worktree has no `node_modules`, and the first run failed only because the config could not resolve the `expo-font` plugin. It passed once `node_modules` was linked in from the main checkout (links removed afterwards, nothing copied).
- **What the validator does and does not prove:** it checks the YAML schema. Job params are checked strictly (an invented param is rejected), so `profile`, `fingerprint_hash`, `runtime_version`, `wait_for_in_progress`, `channel`, `platform` and `upload_sentry_sourcemaps` are real params, and `concurrency` with `group` and `queue: single` is accepted. It does NOT check what is inside `${{ }}`: a made-up name such as `nonsense_ctx.get_build.foo` also passed. So `after.get_build.outputs.build_id`, `needs.fingerprint.outputs.android_fingerprint_hash` and `github.commit_message` are accepted but not proven. Only the first real run proves them.
- **Not done / remains:** the Opus review against the docs page (task 6), the PR into `redesigned-2.0` (task 7), and the owner steps O1, O2, O4, O5 and O6. Nothing was run, built or published on expo.dev, and no EAS variables were created.

## Review (task 6, Opus, 2026-11-05)

- **Verdict: go, with fixes. All applied.** Every job type, param, output name and expression context in the workflow exists in the Expo docs. No production profile, channel or environment is named.
- **Fix 1:** the `build` condition lost its grouping brackets (the docs never show them). It is now `after.get_build.status != 'skipped' && !after.get_build.outputs.build_id`, which builds on a failed or empty get_build and does nothing when fingerprint failed.
- **Fix 2:** a comment claimed a failed Sentry upload would not fail the job. The docs say the opposite when `upload_sentry_sourcemaps: true` is set. The job fails, so check the Updates page on expo.dev before re-running a red update job (the docs do not say whether the OTA is already live by then). We keep the key so a broken upload is loud.
- **Fix 3:** the comments no longer claim the docs say get-build succeeds on no match. The docs do not state it; their examples imply it.
- **Still unproven (only the first real run settles it):** the status of get-build on no match, whether paths are read from the repo root or the Base directory, how the runtime version is worked out under the fingerprint policy, and whether the fingerprint stays the same across the cloud jobs.
- The YAML was not re-validated after fix 1 to 3. They changed one expression and comments, and the validator does not read expressions.
