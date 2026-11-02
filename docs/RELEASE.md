# Release guide: how a change goes out, and how to undo it

Plan task 3.7. Written 2 November 2026 from how the project really deploys (see `docs/DEPLOY.md` for the build steps and `docs/RUNBOOK.md` for incidents). Where something does not exist yet (production, Step 5), it says so.

Four habits make a bad release small and short:

1. **Small slices.** Reach a few people first, watch, then everyone.
2. **Database first, and it only adds.** The database change goes out before the code that needs it, and never drops or renames anything.
3. **A button, not a command, for production.** Only the owner's approval moves production.
4. **Every change can be undone, and the undo is written before the change goes out.**

## 1. The path of a change

| Part | Staging today | Production (from Step 5) | Who triggers it |
|---|---|---|---|
| Website and admin | Vercel builds `redesigned-2.0` as a **Preview** (projects `taskdrop`, `taskdrop-admin`, team `hitenduteam`) | Vercel **Production** build of `main` (separate projects, 5.8) | Staging: merging a PR into `redesigned-2.0`. Production: the owner merges `redesigned-2.0` into `main` by hand |
| Database changes (migrations) | `scripts/deploy-migrations.mjs`, run by the Vercel build of `redesigned-2.0` | A GitHub workflow in the `production-database` environment (section 4) | Staging: automatic on merge. Production: the owner's approval |
| Edge Functions, Inngest sync | The same Vercel build (`scripts/vercel-build.mjs`) | Same workflow, after the database step | Same as above |
| Phone app, screens and text | An EAS update on channel `beta` (`eas update`) | An EAS update on the production channel | **Ask the owner first**, then publish |
| Phone app, built-in parts | A new EAS build (`eas build`) | A new store file (AAB) to Google Play | Ask the owner first |

Order inside one release: **database, then server functions, then website and admin, then the phone update.** A phone running old code must keep working against the new database (the old-app contract test in the build checks this).

`vercel.json` and the deploy script only touch the backend for Preview builds of `redesigned-2.0`. Feature branches build a preview website and nothing else.

## 2. Small slices

- **Google Play (new store versions):** release to **20%** of phones first (a staged rollout). Watch Sentry for a day (no new crashes, the "Security spike" rule quiet, uptime green), then go to 100%. If it looks bad: **Halt rollout** in Play Console, then fix forward.
- **Phone app updates (EAS):** `eas update --rollout-percentage 20` sends the update to a fifth of phones. Raise it with `eas update:edit <update group id> --rollout-percentage 100` once Sentry is quiet. Staging updates (channel `beta`) go to everyone on the test list at once, which is fine because they are the testers.
- **Money features:** also behind a switch in the admin (**App controls**). A feature can be turned off for everyone in a minute, with no release. Prefer this to a rollback for a new money screen.

## 3. Database first, and it only adds

- A migration adds tables, columns and functions. It never drops or renames (rule 2 in `AGENTS.md`). A mistake is fixed **forward** with a new migration.
- **Every new migration ships with an undo file** in `supabase/undo/`, named like the migration (`141_marketplace_numbers.down.sql`). It is the exact SQL that removes what the migration added, and it is only for emergencies. The undo is read by a person; it is never run by the build. If the migration cannot be undone safely (it changes data), the undo file says so and says what to do instead (usually "fix forward"; restore is section 7).
- Run `npm run test:db` for any migration or money change before merging.

## 4. A button, not a command, for production

- The GitHub environment **`production-database`** exists in the `taskdrop` repository (created 2 November 2026). It has the owner as the **required reviewer** and accepts only the `main` branch. Nothing uses it yet.
- In Step 5 (task 5.9) a workflow with `environment: production-database` runs the production migrations and function deploys. The job waits until the owner presses **Approve** in GitHub. The approval is recorded, which keeps the rule that only the owner promotes to `main`.
- The existing environments `Production` and `Preview` belong to Vercel. Do not put a reviewer on them: it would hold Vercel's own deployments.
- Open question for 5.9: the Vercel build today deploys the backend only for Preview builds of `redesigned-2.0`. For production the backend step must move to the workflow above, with the **production** Supabase secrets stored as secrets of that environment only (never in the repository).

## 5. The 5-minute check after every release

Claude runs this after each deploy (task 7.2 repeats it for the first month):

1. **Website:** the home page loads, and Vercel shows the latest deployment of the project as Ready for the commit just merged.
2. **Sign in:** a test phone signs in and the feed loads.
3. **The job:** post a small task, send an offer from a second account, open the chat. (The money steps run on staging with fake money; in production use the ₹10 test only in 6.3.)
4. **Admin:** the dashboard and **Reports** open.
5. **Sentry:** no new issue since the deploy, and the "Security spike" rule has not fired.
6. **Uptime monitors:** `api` health, the website and the admin are green.
7. **Safety alarm:** `get_app_controls` shows test shortcuts off (production only, holes H1 and H15).

Any red: undo first (section 6), investigate after.

## 6. How to undo each part

Rule of thumb: **for a feature, turn its switch off; for a bad deploy, roll back; for a bad database change, fix forward.**

| Part | The undo | Time | Notes |
|---|---|---|---|
| A new feature | **Admin, App controls:** switch the feature off, or set **Maintenance** with a message | 1 minute | No release needed. Apps notice within about a minute |
| Website or admin, **production** | Vercel, project, **Deployments**, the last good one, **⋯ → Instant Rollback** | 1 minute | Only production deployments can be rolled back this way |
| Website or admin, **staging** | There is no Instant Rollback on a Preview (checked 2 Nov: none of the project's deployments is a rollback candidate). Either point the branch address at the last good deployment (`vercel alias set <good deployment URL> taskdrop-git-redesigned-20-hitenduteam.vercel.app`, then it moves again on the next merge), or merge a revert PR (about 3 minutes) | 1 to 3 minutes | Rehearsed 2 Nov, see section 8 |
| Edge Functions | Revert the pull request on `redesigned-2.0` (or `main` for production). The build redeploys the old function. Nothing about the database changes | about 3 minutes | If the function and the database were changed together, check the database change is still compatible (section 3: it only adds, so it is) |
| Database change | **Fix forward** with a new migration. Emergency only: the undo file for that migration (section 3), run by hand after Claude has checked what depends on it. Data lost or broken: maintenance mode first, then the restore in section 7 | 5 to 30 minutes | Never edit or delete a recorded migration |
| Phone update (EAS) | `eas update:rollback <update group id>` (the id must be the newest update for its branch; the update before it is published again, or the update built into the app if there is none), or `eas update:republish` for a chosen earlier update group | 2 minutes, then phones take their next two opens | Phones fetch on the first open and run it on the second |
| Play Store version | **Halt rollout** in Play Console. Google Play cannot go back to a lower version number: publish the old code again as a new version, as a staged rollout | hours | This is why the 20% slice matters |
| Inngest functions | Revert the pull request; the build re-syncs. A single misbehaving job can be paused in the Inngest dashboard | 3 minutes | |
| A leaked key | `docs/KEY_RUNBOOK.md` | | Never "just add a new key": cancel the old one first |

## 7. Restore (data deleted or broken)

1. Switch on **maintenance mode** in the admin so nothing new is written on top.
2. Restore into a **scratch** project, never over the live one. Staging's free plan has no Supabase backups, so staging is restored from a nightly copy made by the dump script in `scripts/` (written in task 3.6, T12). Production uses Supabase's backups plus the nightly copy outside Supabase (5.9).
3. Check the missing rows in the scratch copy. Copy back only those rows, after Claude has looked at them.
4. Write two lines in the audit trail of what was restored and why.

One real restore is practised before launch (task 6.5, hole H16).

## 8. Rehearsal log

| Date | What was practised | Result |
|---|---|---|
| 2 Nov 2026 | Database: ran the undo file for migration 141 on staging inside a transaction, then forced a rollback | Worked. The function was gone after the undo and back after the rollback (checked by a second query). Under a second |
| 2 Nov 2026 | Staging website: moved the branch address `taskdrop-git-redesigned-20-hitenduteam.vercel.app` from the newest deployment (commit 52a20c8) to the one before (c810570), then back | Worked. Vercel confirmed the address pointed at the older deployment, then at the newest again. About 10 seconds each way. This proves the address moves; the page contents behind a Vercel login were not opened. `taskdrop.in` and `www.taskdrop.in` (still on staging until 5.10) were not touched |
| Not rehearsed | Phone update rollback (`eas update:rollback`), Play halt rollout, production Instant Rollback | The first is a publish to testers, so it waits for your OK. The other two need production (Step 5) or a live store release. The commands and flags were checked against the installed EAS CLI help only |
