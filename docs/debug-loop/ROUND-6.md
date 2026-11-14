# Debug round 6 (15 Nov 2026)

Plan task 2.19, run after you asked "are there no open vulnerabilities or bugs? If not, run the cycle one more time, find more bugs and resolve them". Pinned: user repo `a76b9d8`, admin repo `d8762b7` (after admin PR 52). Target: staging (`taskdrop.in`, `admin.taskdrop.in`, Supabase `wjxvingpfbfvkfqhrguj`), fake data only. Every entry is in `LEDGER.md`.

**The short answer to your question: no, it was not clean.** Before this round the ledger still had 1 High (B34, partly), 26 Medium and about 40 Low open, including 10 admin security bugs found by code review in round 4 (B119 to B124, B127 to B134). The security review I ran last time only covered my own last change.

## What was run

| Step | Result |
|---|---|
| Pin | Done (above) |
| Collect: Supabase advisors and logs | Security advisor unchanged: 1 public function (`get_app_controls`, public on purpose), signed-in functions guarded inside (known), leaked-password protection off (owner), 14 locked tables with no policy (server-only tables, correct). No database or `api` 5xx errors in the last 24 hours |
| Sweep | Admin: typecheck, lint, 206 tests, `npm audit` 0, all green; after the fixes 216 tests. App: `npm run check` green on every fix branch (521 to 527 + 132 tests). `test:db` still not run (B140, needs `psql`) |
| Fix: admin security (Opus) | **Admin PR 53 merged.** B120, B121, B138, B130, B131, B119, B129, B128 fixed; B124 and B133 partly (see the ledger) |
| Fix: places and distance (Opus) | **PR 350 merged.** B156 fixed; B34's last unfixed read (`recommendedTasks`) fixed. No migration |
| Fix: task status wording (Sonnet) | **PR 351 merged.** B153, B154, B155, B158, B159, B160 fixed. B157 needs a backend change, left open |
| Explore: charter J, money forms (website, 375 px, signed in as a fake person) | **New B167 (Medium, money)**: typing 250.50 in a rupee box gave ₹25,050. Fixed the same round in **PR 352** (8 boxes, one helper, tests). Also tried: a blank display name (correctly refused with "Add a display name"), HTML, emoji, Arabic and SQL characters in a task (shown as plain text, nothing ran), a price over the limit (correctly refused) |
| Explore: charter K part 2 | Tried a person-A-against-person-B read through SQL, but the SQL tool's session counts as admin, so it cannot prove anything either way; this stays with `test:db` (B140) |
| Recheck on the live sites, after the deploys | **Verified:** B113 (the money check lists all 6 late withdrawals, it showed 2), B130 (a crafted `?error=` text no longer shows), B119 (Sign out and both sign-in methods), B156 on the website (a guest in Madhapur sees only Kondapur jobs under "Needed today"). B120: the "could not check your access" page works and the real admin still gets in. B162 closed (no worker error on the live site). **Failed: B167.** Typed key by key on taskdrop.in, 250.50 still became ₹25,050: the boxes rebuild their text, so the point vanished as soon as it was typed. Fixed again in **PR 354** and proved on a local build by real typing ("Workers see ₹250"). Lesson: the first test fed a pasted string, not one key at a time |
| Found during the recheck | **B168** (admin, Low): the real admin opening `/not-authorized` was told "not an admin account"; fixed in **admin PR 54**. **B169** (Low): a test task "[2p-test] tlo78d" open since 6 Nov shows on everyone's Home (removing it needs your yes). **B151** confirmed live: an Ended hunt still offered "I'm looking"; fixed in **PR 356**. After the PR 354 deploy, **B167 Verified** on taskdrop.in (typed key by key: "Workers see ₹250") and **B168 Verified** |

## Counts

New this round: B163 to B169 (1 Medium, 6 Low), all listed in the ledger with their round. Fixed this round: 30 bugs across 9 pull requests (admin 52, 53, 54; app 350 to 354, 356). Verified live: B113, B119, B130, B156 (web), B167 (after PR 354), B168; plus 9 admin fixes rechecked in the round 5 add-on. Reopened then verified: B167. Open High: none.

## Deploys

Merging into `redesigned-2.0` deploys the website, the `api` function and the admin by themselves (Vercel). The app merge also ran the existing "Beta Android" EAS workflow, which published an update to the **beta** channel (the APK build step failed as expected, EAS builds are out until 1 Dec). Your phone's app is `com.taskdrop.app` 1.1.0; whether it takes that beta update depends on its channel.

## Still open, for your answer or later

- **Needs you:** B169 (your yes to remove the leftover test task), B164 (a look change: the floating + button), B124 per-staff alert read state (a migration), B140 `test:db` (`psql` and your yes), B99 `EXPO_BUILDS_TOKEN`, the admin role matrix (add the 4 staff accounts to the admin allowlist), the staging APK, leaked-password protection.
- **Open bugs to fix next round:** B157, B165, B107, B108, B112, B117, B118, B122, B123, B125, B127, B132, B133 (rest), B134, B137, B143, B144, B145 to B149, B151, B152, B161.
- **Your fix / accept / after launch** on the Medium and Low list (S7), still not given.

## The stop test

Not settled: round 6 found new bugs (S3 no), the new fixes are not all rechecked on staging (S4 no), `test:db` has not run (S5 no), the golden path has not run on all three (S6 no), and S7 has no answers.
