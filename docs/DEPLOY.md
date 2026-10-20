# Deploying to the test project

How a change reaches the shared test project (`wjxvingpfbfvkfqhrguj`) and what protects the old app on the way. Part of Phase 0 of `docs/UPGRADE_PLAN.md`.

## What deploys what

GitHub only stores the code. **Vercel runs every deploy.** There is no GitHub Actions deploy and no secret in GitHub.

| Part | How it deploys | Trigger |
|---|---|---|
| Migrations, Edge Functions, Inngest sync, then the web app (`taskdrop.in`) | The `taskdrop` Vercel project's build, `scripts/vercel-build.mjs` (set in `vercel.json`) | Every push to `redesigned-2.0` |
| Admin (its Vercel address) | The `taskdrop-admin` Vercel project | Every push to `redesigned-2.0` |
| App updates for phones | EAS Update, channel `beta`, from your PC | Phase 1 |

`vercel.json` exists only on `redesigned-2.0`, so the old app's builds from `main` use the project's own build command (`npm run web:export`) and are unchanged. On any branch other than `redesigned-2.0`, and for production builds, the script only builds the web app and never touches the backend.

## One-time setup (you)

In Vercel, open the `taskdrop` project, then Settings, then Environment Variables. Add these two with **only Preview ticked**, and set the branch to `redesigned-2.0`:

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com, Account, Access Tokens, Generate. Lets the build deploy Edge Functions |
| `DATABASE_URL` | Supabase dashboard, Connect, **Session pooler** connection string, with the database password filled in |

Until both exist, the build prints a warning, deploys no backend and still builds the web app.

The same two values, saved as `DATABASE_URL=...` and `SUPABASE_ACCESS_TOKEN=...` in the git-ignored `.env` in this folder, let you run the commands below from your PC.

## What a push to `redesigned-2.0` does, in order

1. **Fetch `main`.** Vercel clones only the pushed branch, so the build fetches `main` to compare against. If that fails the build says so in a warning and skips steps 2 and 4; run those two by hand before merging.
2. **Old-app contract** (`npm run test:contract`). Runs every operation the old app calls through the `api` function of `main` and through this branch, against the same fake database. It fails if the new version refuses what the old one accepted, answers with fewer fields, or no longer knows an operation. Adding operations, optional arguments and extra fields is fine.
3. **New migrations only** (`node scripts/deploy-migrations.mjs`). Not `supabase db push`: the cloud project's migration history was written by hand and disagrees with the repo's files (checked 2026-10-20: 95 migrations under other version numbers, 11 history rows with no file, 6 files with no row; the six files' changes are in the database under other names). `db push` would re-apply old files. The script treats everything up to the newest recorded version as applied, applies each newer file in its own transaction, and records it.
4. **Old-app database check** (`node scripts/check-old-app-db.mjs`). Every table, function and function argument that the old app's server code uses must still exist.
5. **Edge Functions** (`supabase functions deploy`). JWT settings per function come from `supabase/config.toml`.
6. **Inngest sync.** A warning, not a failure, until the Inngest Cloud keys are set.
7. **Web export** (`npm run web:export`).

A failed step 2 to 5 fails the build, so the web app is not published against a half-updated backend and the previous deployment stays live. Fix the cause and push again. Vercel's build log shows each step.

The unit, type and SQL tests that GitHub runs on pull requests (`.github/workflows/ci.yml`) are checks only: they deploy nothing and hold no secrets.

## Before a backend change goes in: ten-minute check on the old app

Because the old app and old admin share the database and functions, do this on their current URLs before merging (and again after the deploy) any pull request that touches `supabase/**`:

1. Old app: sign in with a test phone, look at the feed, open a task.
2. Post a small task, then open **My Tasks** and see it there.
3. Place a quote from a second test account, then open the chat and send a message.
4. Old admin: open the dashboard and the tasks list.

If anything fails, do not merge. Tick the matching box in the pull request checklist when it passes.

## Local commands (from your PC, against the cloud test project)

```bash
npm run deploy:migrations -- --dry-run   # list the migrations the project has not seen
npm run deploy:migrations                # apply them (the Vercel build does this on a push to redesigned-2.0)
npm run test:contract                    # old-app API contract; reads `main` from git
node scripts/check-old-app-db.mjs        # old-app tables and functions still in the database
npm run seed:reset                       # fake-data reset, asks you to type "reset"
SUPABASE_ACCESS_TOKEN=... node scripts/add-redirect-urls.mjs --apply   # add sign-in redirect addresses
```

## The fake-data reset

`npm run seed:reset` deletes and rebuilds only the four seed accounts in `supabase/seed/test_data.sql` (everything they own goes with them; nobody else's data is touched):

| Account | Phone | Role | Wallet |
|---|---|---|---|
| Asha | 9990000001 | poster | Rs 5,000 credits |
| Ravi | 9990000002 | worker | Rs 2,000 available, Rs 1,000 clearing, one withdrawal waiting |
| Meera | 9990000003 | both | Rs 500 available |
| Test Admin | none | admin | none; sign in with Google or set a password |

Twelve tasks in all ten statuses (open, locked, started, overdue, work done, revision requested, completed, auto-completed, cancelled, disputed), local and remote, a request and a service listing. Sign-in codes: while the `dev_otp_for_all` setting is on (it is on the test project), any number gets a code that the app fills in. Once real SMS is set up, add the three numbers to the `phone-auth` secret `TEST_PHONES`.

The command accepts only the test project or localhost, always asks first, and also runs in CI against the throwaway database (`npm run test:seed`). It never runs on production.

## Rolling back

Migrations only add (ground rule 4), so a bad one is fixed forward with a new migration, never by editing a recorded one. A bad function is fixed by pushing a revert; the Vercel build redeploys it.
