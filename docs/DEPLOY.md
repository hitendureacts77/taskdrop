# Deploying to the test project

How a change reaches the shared test project (`wjxvingpfbfvkfqhrguj`) and what protects the old app on the way. Part of Phase 0 of `docs/UPGRADE_PLAN.md`.

## What deploys what

| Part | How it deploys | Trigger |
|---|---|---|
| Migrations, Edge Functions, Inngest sync | `.github/workflows/deploy-test.yml` | A merge into `redesigned-2.0` that touches `supabase/**` or `packages/**`, or **Run workflow** by hand |
| Web (`taskdrop.in`) and admin (`admin.taskdrop.in`) | Vercel's GitHub link | Every push to `redesigned-2.0` |
| App updates for phones | EAS Update, channel `beta` | Phase 1 |

## One-time setup (you)

In GitHub, repo `Taskdrop user` → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens → Generate. Lets the workflow deploy Edge Functions |
| `TEST_DATABASE_URL` | Supabase dashboard → Connect → **Session pooler** connection string, with the database password filled in |

Until both exist, the workflow stops with a notice and deploys nothing. It never reads them for any other purpose.

The same `TEST_DATABASE_URL` value, saved as `DATABASE_URL=...` in the git-ignored `.env` in this folder, lets you run the commands below from your PC.

## What a deploy does, in order

1. **Old-app contract** (`npm run test:contract`). Runs every operation the old app calls through the `api` function of `main` and through this branch, against the same fake database. It fails if the new version refuses what the old one accepted, answers with fewer fields, or no longer knows an operation. Adding operations, optional arguments and extra fields is fine.
2. **New migrations only** (`node scripts/deploy-migrations.mjs`). Not `supabase db push`: the cloud project's migration history was written by hand and disagrees with the repo's files (checked 2026-10-20: 95 migrations under other version numbers, 11 history rows with no file, 6 files with no row; the six files' changes are in the database under other names). `db push` would re-apply old files. The script treats everything up to the newest recorded version as applied, applies each newer file in its own transaction, and records it.
3. **Old-app database check** (`node scripts/check-old-app-db.mjs`). Every table, function and function argument that the old app's server code uses must still exist.
4. **Edge Functions** (`supabase functions deploy`). JWT settings per function come from `supabase/config.toml`.
5. **Inngest sync.** A warning, not a failure, until the Inngest Cloud keys are set.

The same contract and database checks also run on every pull request (`.github/workflows/ci.yml`, jobs `compatibility` and `database`), so a break shows up before merging, not at deploy time.

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
npm run deploy:migrations                # apply them (the workflow does this on merge)
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

Migrations only add (ground rule 4), so a bad one is fixed forward with a new migration, never by editing a recorded one. A bad function is fixed by merging a revert pull request; the workflow redeploys it.
