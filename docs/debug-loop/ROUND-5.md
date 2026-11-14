# Debug round 5 (14 Nov 2026)

Plan task 2.19, section 20 of `docs/DEBUGGING_PLAN.html`. Pinned: user repo `445995f` (round 4's fixes plus docs), admin repo `db0161b`, then `253f18a` after PR 51. Target: the staging project, `taskdrop.in` and `admin.taskdrop.in`, fake data only. Round 5 is bigger than the others and was **started, not finished**: the steps below say what was run, what was not, and why. Every entry is in `LEDGER.md` (new bugs B142 to B152).

## Owner steps (section 19), checked at the start

| # | Step | State on 14 Nov |
|---|---|---|
| 1 | `psql` and `DATABASE_URL` for `test:db` | Not done: `psql` is not installed (`DATABASE_URL` is in `.env.all-secrets`). `test:db` did not run (B140 stays open) |
| 2 | One admin login per staff role | Not done, so the role matrix is still code-only |
| 3 | `EXPO_BUILDS_TOKEN` | Not done (B99) |
| 4 | Migration 152 on staging | **Done later the same day, with your yes (14 Nov):** applied as `152_abuse_caps`. Checked first: the helper functions and columns it uses exist, the live `media_begin`, `run_housekeeping` and `record_ad_impression` matched the versions it was written from, and no later migration redefines them. Afterwards: 2 triggers and 10 settings present, permissions as designed, and `abuse_caps.test.sql` (ads, uploads, jobs, crews, repeats, feedback) passed on staging inside a transaction that rolled back, with no leftover users, jobs or changed settings. Not yet rechecked through the app |
| 5 | Sign back in to `admin.taskdrop.in` | Not done, so the live admin walk did not continue |
| 6 | Phone on USB with the staging app | Phone connected (CPH2585) with the older `com.taskdrop.app` build 1.1.0 of 11 Nov; **the staging app `com.taskdrop.app.staging` (task 5.0c) is not installed**. The phone was in a call, so it was not driven |
| 7 | Your answers on Medium and Low bugs | Not given |

## What was run

| Step in section 20 | Result |
|---|---|
| Pin, and check the owner steps | Done (above) |
| Make the test suite honest | In progress by a helper: the three broken e2e areas are being fixed in the test code only. Partial log from its first full run: 43 passed, 13 failed, 13 skipped (33 minutes). The final table goes in this file when it reports |
| The full sweep, twice | **Green both times**: user `npm run check` (518 + 132 unit tests), `test:contract` (100 old-app operations compared, 74 answered), `audit:gate` (3 accepted moderate advisories, review by 2026-12-13); admin typecheck, lint, 169 tests, `npm audit --omit=dev` (0 vulnerabilities). No flaky result. After the admin merge: 206 admin tests. `test:db`: not run. Admin build: not run this round (it ran green in round 4) |
| Recheck round 4's fixes on staging | B87, B88, B90, B91, B92, B94 **Verified** (website, 1920 px). B98 not checkable (needs a signed-in worker mid-task). The 13 admin fixes: see next row |
| (found along the way) The admin fixes of round 4 | They had sat on a local branch, never pushed. An Opus review read the whole diff (13 commits), found and fixed one High money bug (B142), and the branch passed typecheck, lint and 206 of 206 tests. **Merged as admin PR 51**; they reach the staging admin by themselves. Three commits carry the wrong bug numbers: the commits titled B130, B133 and B134 fix ledger **B126, B135 and B136**; the ledger's own B130, B133 and B134 are **not** fixed |
| Guest mode on the website (charter I) | Walked as a guest at 1920 px: about 25 screens, every network answer searched for phones, emails, UPI, tokens, exact places: **nothing private found**. 390 and 768 px by the controller in the built-in browser (intro, Home, Explore at 390; Home at 768): no sideways overflow. Findings B145 to B149 (all Low) and the unexplained auto sign-in B150. Android guest: **not done** |
| Phone sign-up and the age gate | Partly: a new fake number signed up from a guest pop-up (T1 variant) and the guest draft was kept; T5 and T3 checked. Under 18, exactly 18, wrong code and the pasted number were not run |
| Finish the live admin walk; the admin role matrix | **Not run** (owner steps 2 and 5) |
| The golden path on all three, with money on the phone | **Not run** (needs the phone, a second account and your yes) |
| Forms, money ones first (charter J) | **Not run** |
| Security layer parts now possible (charter K, part 2) | **Not run**; migration 152 is now applied, so the abuse-limit checks can run in round 6 |
| Backend collect (logs and advisors, last 24 hours) | Done. Postgres errors are all the app's own plain refusals (the cross-user and closed-door tests); direct calls to closed functions get 401 or 400 as they should. **B97 still happens** (about 35 a day, retries hide it). Security advisor: 149 `SECURITY DEFINER` functions are callable by the signed-in role (known; guarded inside, and covered by the `rpc_surface` tests), leaked-password protection is off (owner, optional). Performance advisor: 8 foreign keys without an index and 15 unused indexes (INFO only) |
| Android (read only) | App 1.1.0 installed 11 Nov; 10,226 lines of device log: no crash, no ANR, and no phone number, email or token in the app's own lines |

## Counts

New bugs this round: **11** (B142 to B152): 1 High (B142, fixed), 1 Medium (B150, cannot reproduce), 9 Low. Verified: 6. Fixed and waiting for a recheck on staging: the 13 admin fixes (B105, B106, B109 to B111, B113 to B116, B118 in part, B126, B135, B136) and B142. Open High: none known. B95 (applied 14 Nov) and B142 await a recheck through the app and the admin.

## The stop test (S1 to S7)

**Not settled.** S1 no (round 4 found 4 High and round 5 found B142). S2 yes by status (no Critical or High is open; B95 and B142 are fixed and waiting for a recheck). S3 no (11 new). S4 no (the admin fixes and B98 are not rechecked). S5 not shown (e2e not yet green, `test:db` not run). S6 no (not run on any surface this round). S7 no (no answers on the Medium and Low bugs yet).

## Not covered, so round 6 repeats it first

The live admin walk and role matrix; the golden path on the phone and the admin; charter J money forms; charter K part 2; guest mode on Android; sign-up edge cases (under 18, exactly 18, wrong code); 390 and 768 px on the signed-in screens and the Post flow; the staging "time machine" does not exist yet, so the 3-day and 7-day money steps are not exercised.

## Open for you

- **Install `psql`** and say yes to loading `DATABASE_URL` into that one command, so `test:db` can run (B140).
- **Install the staging Android app** (task 5.0c): the phone has the older `com.taskdrop.app`.
- **Create the four lower admin logins** and sign in to `admin.taskdrop.in` once, so the role matrix and the admin walk can run.
- **Add `EXPO_BUILDS_TOKEN`** (B99).
- Answer **fix, accept or after launch** on each Medium and Low (S7); the old decisions B21, B54, B55, B56, B85.
- **B150:** if you saw a tab sign itself in during round 5, tell me what you did.
- The helper left one fake account on staging, `+91 98880 99931` ("Tasker 9931"); say if you want it removed.

## Add-on: the signed-in web walk (14 Nov, evening)

You pointed out that the round only walked the site as a guest. So it was walked again **signed in**, on a local web build of `a4fa24c` (http://127.0.0.1:8099; branch previews cannot sign in), against staging, as the fake account Harsha Naidu (+91 98880 00002, Kondapur, both modes). Screens: Home in Hire and Earn, My Tasks (all tabs and the "Needs providers" chip), a task with 5 offers, Compare offers, a completed task, Wallet, Messages, Notifications, Profile, My Work (stats, offers), Explore and a job page as a worker. Nothing was hired, paid, posted or sent; the database was only read.

**10 new: B153 to B162** (4 Medium, 6 Low), each checked against the code or the staging data:

| Bug | Level | In one line |
|---|---|---|
| B153 | Medium | Compare offers shows a "Complete by" date that already passed (ignores `due_at`) |
| B154 | Medium | A hired job running late says "No one picked it" |
| B155 | Medium | A finished, paid task still says "₹5,047 held" |
| B156 | Medium | Earn Home "Matches your skills" and "Needed today" show in-person jobs in Pune, Kuala Lumpur, Gurugram to a Kondapur worker |
| B157 | Low | "Work is waiting for your approval" stays after the task approved itself |
| B158 | Low | A completed task still shows "CHOOSE FROM OFFERS" |
| B159 | Low | "Success" counts offers still waiting as lost (1 won of 6 = 17%) |
| B160 | Low | "Needs providers" shows its list under the Closed tab |
| B161 | Low | The fake seed writes dates out of order (accepted after started; last seen before own offer) |
| B162 | Low | Explore logs "Worker failed to load" from MapLibre (local build; check on taskdrop.in) |

Checked and **not** a bug: Harsha's pending offer on "Edit a 3-minute travel vlog" is on someone else's task with the same title (no one on staging has an offer on their own task). Not walked yet while signed in: posting a task, sending or editing an offer, hiring and paying, chat, Settings, the 390 and 768 px sizes. Those need your yes for anything that moves fake money.

## What is next

1. Fix the Medium and Low app bugs the owner says "fix" to, B97 and B100 and B145 together first (one pull request for guests and places).
2. Recheck the 13 admin fixes and B142 on the staging admin after you sign in.
3. Round 6 runs what is listed under "Not covered", then the stop test again.
