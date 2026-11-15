# Production go: your checklist (task 5.9)

Plain words, in order. Claude built the machinery (pull request "Production connect", 15 Nov 2026). Nothing reaches production until **you** do steps 4 and 5. The production Supabase project is `dyzskuzqcqbexssyrrxc` (Mumbai). Staging (`wjxvingpfbfvkfqhrguj`) is never touched by any of this.

Where production stands: on 15 Nov Claude built its database once by hand (all 182 migrations, test shortcuts off, the direct door shut; plan task 5.9). So the first approved run below applies only migrations newer than that, re-applies the safety switches (they are already right, so nothing changes) and then does what is still missing: the server functions, their secrets, and the checks.

## What exists now

| Piece | What it does | When it runs |
|---|---|---|
| `.github/workflows/production-database.yml` | Puts the code's database changes and server functions on production, switches every test shortcut off, closes the direct database door, then checks all of it | When you promote code to `main` that changes `supabase/`, or when you press **Run workflow**. It always **waits for your Approve** |
| `.github/workflows/production-alarm.yml` | Every hour, reads production. If a test shortcut is on or a door is open, Sentry emails you and the run turns red | Every hour, from `main` |
| `.github/workflows/production-backup.yml` | Every night, an encrypted copy of the production database, kept 30 days in a separate **private** repository `taskdrop-backups` | 03:00 India time, from `main` |
| `supabase/production/first_day.sql` | The switches: test sign-in off, admin authenticator code on, environment "production", GraphQL off, signed-out table rights none | Inside the first workflow, production only |
| `docs/RELEASE.md` sections 4 and 7 | How a production change goes out, and how to restore the nightly copy | Reading |

The scripts refuse staging, refuse any other database, and refuse to run on a laptop unless you deliberately allow it (see "Emergency" at the end).

## Your steps

**1. A decision first: keep `taskdrop` public for now.** The repository `taskdrop` is **public** today (checked 15 Nov), and that is what makes the free plan work here: on GitHub's free plan the **Approve** button (required reviewers) works only in public repositories, environment secrets only in public repositories, and branch protection (step 7) only in public repositories. Making it private (plan 2.13) would silently remove your Approve step unless you pay for GitHub Enterprise (checked in GitHub's docs, 15 Nov). So: nothing secret is in the code, the workflow logs print names and codes only, and the database copies go to a **separate private repository** instead (step 4). If you still want `taskdrop` private, tell Claude: the deploy then needs another approval design.

**1b. Make the private backup repository.** GitHub → **New repository** → name `taskdrop-backups` → **Private** → tick **Add a README file** (a release needs one commit) → Create. Then GitHub → your picture → **Settings** → **Developer settings** → **Fine-grained tokens** → **Generate new token**: name `taskdrop-backups-writer`, expiry 1 year (put a reminder in your calendar), **Only select repositories** → `taskdrop-backups`, permissions → **Contents: Read and write**. Copy it once into the `PROD_` section of `.env.all-secrets` as `PROD_BACKUP_REPO_TOKEN`.

**2. Fill the approval environment.** GitHub → `taskdrop` → **Settings** → **Environments** → `production-database` (it exists, you are its reviewer). Add these **secrets** (values from the `PROD_` section of `.env.all-secrets`; or SAY "set the production GitHub secrets" and Claude copies them from that file without showing them):

| Secret name | Where the value comes from |
|---|---|
| `PROD_SUPABASE_DB_PASSWORD` | Supabase production → Project Settings → Database → password |
| `PROD_SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens → new token, name `github-production` (signed in as hitendureacts@gmail.com) |
| `PROD_INNGEST_EVENT_KEY`, `PROD_INNGEST_SIGNING_KEY` | Inngest production environment |
| `PROD_INNGEST_MONEY_JOBS`, `PROD_INNGEST_PUSH_RECEIPT_WAIT` | Settings, same as staging's |
| `PROD_IMAGEKIT_PUBLIC_KEY`, `PROD_IMAGEKIT_PRIVATE_KEY`, `PROD_IMAGEKIT_URL_ENDPOINT`, `PROD_IMAGEKIT_ENV` | Production ImageKit (5.5) |
| `PROD_SENTRY_DSN`, `PROD_SENTRY_ENVIRONMENT` | Sentry project `taskdrop-production` (5.6); environment `production` |
| `PROD_EXPO_BUILDS_TOKEN` | Expo, read-only token for the production project |
| `PROD_GOOGLE_MAPS_API_KEY`, `PROD_FIREBASE_PROJECT_NUMBER` | Production Google Cloud / Firebase (5.3) |
| `PROD_ALLOWED_ORIGINS` | The production website and admin addresses, comma separated |
| `PROD_MSG91_AUTHKEY`, `PROD_MSG91_TEMPLATE_ID` | MSG91 (6.1); leave out until then |

A name you leave out is skipped and listed in the run, never blanked. **Never** add `PROD_ALLOW_ANY_OTP`, `PROD_TEST_PHONES` or any App Check debug token: the workflow does not pass them and the alarm fires if they appear in production.

Optional **variables** of the same environment: `PROD_SUPABASE_POOLER_HOST` (only if Supabase → **Connect** → **Session pooler** shows a host other than `aws-0-ap-south-1.pooler.supabase.com`), and `PROD_DASHBOARD_DONE` = `yes` after step 3.

**3. The Supabase dashboard clicks** (production project; these cannot be done from code): Auth → Hooks → **Before User Created** → `hook_before_user_created` **on**; Auth → Sign In / Providers → **Phone** off and **Anonymous** off; Auth → Rate Limits to the 2.8b values with IP forwarding on (task 5.9 table). Then set `PROD_DASHBOARD_DONE` = `yes` (step 2). Until then the deploy reports these as warnings; the hourly alarm reports them as problems.

**4. Create the no-click environment for the alarm and the copy.** Settings → Environments → **New environment** → name `production-backup` → **no** required reviewer (a nightly job cannot wait for a click) → **Deployment branches**: Selected branches → `main` only. Secrets:

| Secret name | Value |
|---|---|
| `PROD_SUPABASE_DB_PASSWORD` | the same production database password |
| `PROD_BACKUP_PASSPHRASE` | a new random value of **at least 32 characters**, also saved in the `PROD_` section of `.env.all-secrets` (without it no copy can ever be opened) |
| `PROD_BACKUP_REPO_TOKEN` | the fine-grained token from step 1b (it can touch `taskdrop-backups` only) |
| `PROD_SENTRY_DSN` | the production Sentry DSN (where the alarm goes) |
| `PROD_SUPABASE_ACCESS_TOKEN` | the same token as in step 2. Recommended: without it the alarm cannot see function secrets, function login settings or the sign-up hook |

Why two environments: the deploy must wait for you, but an hourly or nightly job cannot. Both are limited to `main`, so only code you promoted can use them. The trade-off: code on `main` can read `production-backup`'s password without your click. Your click still guards every change, because nothing reaches `main` without you (step 7).

In Sentry (project `taskdrop-production`): Alerts → the rule "a new issue is created → email me" must exist (5.6). The alarm sends a **fatal** event.

**5. Promote to `main`.** Merge `redesigned-2.0` into `main` (as you always do, by hand).

**6. Approve.** GitHub → **Actions** → "Production database and functions" → the waiting run → **Review deployments** → tick `production-database` → **Approve and deploy**. If no run started (step 5 changed nothing in `supabase/`), press **Run workflow** on branch `main` first. Read the run: every step green, and the last step ends "production's first-day checks passed". Then **Actions** → "Production safety alarm" → **Run workflow** once: it must end "all clear".

**7. Protect `main`.** After you say OK, Claude runs this (or paste it yourself in a terminal signed in to `gh`). It requires a pull request and the four CI checks for `main`, and blocks force-pushes and deletion:

```bash
gh api -X PUT repos/hitendureacts77/taskdrop/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": [
      "typecheck, lint, unit tests",
      "Edge Functions type-check",
      "old app still works (api contract)",
      "money and access rules"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

From then on you promote with a pull request from `redesigned-2.0` into `main` and merge it when the checks are green (no reviewer is needed, so you can merge your own). This works on the free plan because the repository is public (step 1).

**8. The rest of 5.9,** each with Claude: your admin account on production (Google sign-in with hitendureacts@gmail.com); a Google sign-in test; once Inngest shows production synced, push messages through Inngest (`supabase/cutover/inngest_background_jobs.sql`, Claude asks first); delete the App Check debug token in Firebase and check the production Expo project has no `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN` (H56). TELL Claude "done 5.9" when all are done.

## What the checks prove after each deploy (and every hour)

Test sign-in (`dev_otp_for_all`) off · admin authenticator code (`admin_require_mfa`) on · environment `production` · no `ALLOW_ANY_OTP`, `TEST_PHONES` or App Check debug token as a function secret or in the Vault · no Razorpay test key id in the Vault · GraphQL (`pg_graphql`) off · signed-out table rights none · the database defaults closed for new tables and functions · the direct database door closed and no live table broadcasts · the gateway secret present · each server function's login setting as in `supabase/config.toml` (including `razorpayx-webhook`) · the sign-up guard hook on, Supabase's own phone and anonymous sign-in off. The money settings (fees, 7-day clearing, limits) are compared with task 5.9's table and shown as a warning if the admin changed one.

Not covered from outside: a Razorpay key or debug token held as a function secret **value** (Supabase shows only names). The Inngest job `safety-alarm` checks those values from inside, every hour, once Inngest runs on production.

## Emergency: running a production script from a laptop

Only with you watching, and only if GitHub Actions is down. Every script refuses production unless `PRODUCTION_DEPLOY=1` is set **and** it runs in GitHub Actions, or `TASKDROP_PRODUCTION_FROM_LAPTOP` is set to the exact words `yes, this is production`. Even then, a seed or reset script has no production path at all.
