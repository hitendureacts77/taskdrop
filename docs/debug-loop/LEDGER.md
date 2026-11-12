# The debug loop: bug ledger (plan task 2.19)

Every bug the debug loop has seen, in one place. The plan is in `docs/DEBUGGING_PLAN.html`. Each round starts by reading this file and the last `ROUND-N.md`, and ends by updating both. New bugs take the next number from **B33**. Security holes keep their H numbers in the Security section of `docs/ULTIMATE_PLAN.md`; an entry here links to them.

**Statuses:** New → Confirmed → Fixing → Fixed, not rechecked → Verified → Closed. Side doors: Reopened, Accepted, After launch, Cannot reproduce, Duplicate of B..
**Levels:** Critical, High (always fixed this round), Medium, Low (your "fix", "accept" or "after launch").
**Each new entry also says:** Class (UI, Backend or Both), Current vs Expected, Proof (screenshot, clean console log, security rules for Backend), Rung reached on the dig-deeper ladder (1 quick try … 6 retro), Tries, and Fix path (A one whole fix, B one file rewritten; plan section 8). Read `BUG_PROMPT.md` before fixing.

## Rounds

| Round | Date | Pinned commit | Charter | New | Fixed + verified | Reopened | Open: C / H / M / L | Flaky tests | Settled? |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 12 Nov 2026 | 122965a | setup: baseline `npm run check` green (102 + 103 tests) | | | | 0 / 1 / 5 / 8 | | No |
| 1 | 12 Nov 2026 | 122965a | A+B+C sweep of the 11 open bugs (code-only; staging recheck pending) | 0 | 0 (10 fixed, not rechecked) | 0 | 0 / 0 / 0 / 4 after merge | not run twice yet | No |
| 2 | 12 Nov 2026 | 09b8338 | code hunt: money and task life, access and data exposure, app logic | 22 (B43-B64: 2 High, 11 Medium, 9 Low) | 0 (fixes written, not rechecked) | 0 | B55 M, B63 L open for the owner | not run twice yet | No |

## Round 1 results (12 Nov 2026, PR 336)

Status after the fixes, all "Fixed, not rechecked" until they are live on staging and checked there (S4). Fix path A for every one.

| Bug | Result |
|---|---|
| B34 High | Fixed, not rechecked. Distance reads narrow to a lat/lng box in SQL before the cap (`reads.ts` `nearBox`, guest functions in migration 162). Tests: 25 newer far tasks + 1 near |
| B35 | Fixed, not rechecked. Home uses the saved area (25 km) plus up to 10 remote listings |
| B33 | Fixed, not rechecked. `taskPageView(mode, kind)` in `lib/taskView.ts` |
| B36 | Fixed, not rechecked. Tab is "Closed" |
| B37 | Fixed, not rechecked. Triggers in migration 163 recompute totals on delete or change |
| B38 | Fixed, not rechecked. Migration 164 backfills older pins (idempotent) |
| B30, B32 | Fixed, not rechecked. Migration 166 and `listActiveWorkers` |
| B40 | Fixed, not rechecked. People list sorted nearest first |
| B41 | Fixed, not rechecked. Pending withdrawals show with "Waiting: payouts are paused for now". Caveat: found from the wallet title text ("Withdrawal request"), no status field |
| B21 | Needs the owner: nothing closes past-due OPEN tasks or releases unpaid locks (the `overdue-tasks` job only marks started jobs OVERDUE, and is off until the Inngest cutover). Owner decides the end status, the refund rule and the unpaid-lock timeout. Home now says "Date passed · not shown" instead of "Waiting for offers" |
| B18 | Recommended: accept (owner's answer needed) |
| B39 | Cause found: the 8 accounts all pre-date the age gate (13-27 Sep, gate is migration 082); a trigger blocks new sign-ups without a passed check, and the app's AgeGate asks on next open. Recommended: accept, or after launch |
| B42 | Waits for the owner's yes (reseed) |

Not a bug (checked 12 Nov): the Explore "Turn on location" sheet showed "Location is switched off on this device" on open because the phone's location really was off (`settings get secure location_mode` = 0). The sheet reads the live status, so the message is right.

## Round 2 results (12 Nov 2026, same PR 336)

Three hunters (money and task life, access and data exposure, app logic) read the code, and I checked their claims against the code and staging. 22 new bugs: B43-B52 (app, fixed in commit 2864173), B53-B64 (backend). Status below is "Fixing" until the PR is merged and the fix is rechecked on staging.

| Bug | Level | What | Status |
|---|---|---|---|
| B43 | Medium | Home: a 400 ms timer ended "loading" before the data arrived, so slow networks showed "No services listed yet", and a mode switch drew old rows with the new card | Fixed, not rechecked |
| B44 | Medium | Failed loads looked empty on Home, Find work, Messages and Active job; now an error with retry | Fixed, not rechecked |
| B45 | Medium | Chat chose the other person's role from the Hire/Earn mode, not from the task | Fixed, not rechecked |
| B46 | Low | Chat: the first fetch could wipe a message that had just arrived; contact block stayed after work started | Fixed, not rechecked |
| B47 | Medium | Posting and hiring showed the held amount in whole rupees (Rs 50 task: Rs 52, server holds Rs 51.50) | Fixed, not rechecked |
| B48 | Low | Closing a task said "Could not close that task" when only the refresh failed | Fixed, not rechecked |
| B49 | Low | Messages: search showed "No messages yet", list did not refresh on return | Fixed, not rechecked |
| B50 | Low | Releasing payment added the worker's net to the poster's balance shown in the app | Fixed, not rechecked |
| B51 | Low | Unhandled rejections in the offer sheet and offer checks | Fixed, not rechecked |
| B52 | Low | "1 reviews", "Last seen 2 days ago" at 36 h, "Success 0%" with no stats, "Show 60 tasks" when capped, saved filters overwritten | Fixed, not rechecked |
| B53 | High | A worker can raise an offer's price just before the poster taps Hire and the wallet is charged the new price (`lock_bid` reads the price at call time) | Fixing: migration 167 (expected price) |
| B54 | High | Card-paid job whose worker walked off: the leftover card payment is never returned if the next hire is cheaper | Fixing: migration 168 |
| B55 | Medium | Clearing settles a recomputed net, not the amount put into clearing (capped jobs, commission changes) | Confirmed, needs the owner (money design, waits for the lawyer's answer) |
| B56 | Medium | Staging is missing part of migration 066 (payments.wallet_credited_*; older `fund_task_from_payment`) | Fixing: migration 168 |
| B57 | Medium | Old `fund_task(task, payment)` still callable by any signed-in user | Fixing: migration 169 |
| B58 | Medium | Wallet says "full refund" with the full amount after a cancel with a fine; worker's fine never shows | Fixing: `reads.ts` |
| B59 | Medium-High | A user can make another user's private file readable by pointing their own avatar, message or proof at its storage path | Fixing: `writes.ts` + migration 171 |
| B60 | Medium | The hired worker reads the exact pin before work starts (and after a refund) | Fixing: migration 172/173 |
| B61 | Medium | Blocks and suspensions do not stop hiring (lock_bid, auto-hire, contact phone) | Fixing: migration 167 |
| B62 | Low-Medium | Trigger `trg_keep_destination_with_open_payout` is disabled on staging (drift) | Fixing: migration 169/170 |
| B63 | Low | Losing bidders see locked price / payment id; OPEN rows expose `preferred_worker_id` | Confirmed, after launch (needs column-grant change across the app) |
| B64 | Low | Signed-in `worker_proof_photos` skips the deleted/hidden/owner filters the guest version has | Fixing: migration 173 |

Found by the round-2 security review of these fixes (older code, not fixed yet):

| Bug | Level | What | Status |
|---|---|---|---|
| B65 | Medium | `cancel_task` pays the worker the 5% fine into their wallet even when the job was paid by card; for a card job the refund trigger returns early, so the fine is not taken out of the poster's refund (TaskDrop pays it) | New, to confirm on staging data, then fix in round 3 |
| B66 | Low | `private.blocked_between` can be executed by `anon` (tells anyone whether two accounts blocked each other) | New, round 3 |

Not bugs: migrations 162-166 not on staging yet (they apply when PR 336 merges).

## Stop test (from the plan)

S1 two rounds with no new Critical or High · S2 none open · S3 last round found 2 or fewer new, and fewer than the round before · S4 every fix rechecked on staging · S5 no flaky test in the last two rounds · S6 golden path passes on web, Android and admin · S7 every open Medium and Low has your answer. Floor 3 rounds, ceiling 8, then a hot-spot review.

## Open

Carried over from the hunt (2.14) on 10 Nov 2026, before round 0. Each waits for your "fix" or "accept".

### B18 · Rare double push or double alert after a slow moment
- Level: Low · Status: Confirmed · Area: talk and alerts (charter F)
- Seen first: hunt round 2, 4 Nov · Recommended: accept

### B21 · Nothing ever expires
- Level: Low · Status: Confirmed · Area: money and a task's life (charter C)
- Open tasks stay open after their due time, and a locked task that is never paid stays locked (on staging, 21 open tasks past due and 2 unpaid locks over 2 days, 4 Nov)
- Seen first: hunt round 2, 4 Nov
- 10 Nov: grown to 58 open tasks past due (2 unpaid locks still); Home "Your published tasks" shows them as "WAITING FOR OFFERS" with an "overdue" tag

### B30 · The "New talent" list shows deleted accounts
- Level: Low · Status: Confirmed · Area: the poster (charter A)
- 3 of 30 cards on staging, shown to guests and signed-in people
- Seen first: hunt round 2, 4 Nov

### B32 · The home counter "open tasks" counts posts nobody can see
- Level: Low · Status: Confirmed · Area: the poster (charter A)
- 59 shown, 38 live (4 Nov)
- Seen first: hunt round 2, 4 Nov

Found on 10 Nov 2026 in a sweep after loading the fake city (`supabase/seed/fake_world.sql`), before round 0. Full write-up with fixes and checks: `docs/debug-loop/BUGS-2026-11-10.html`.

### B33 · In Hire mode, someone's request opens as if it were their service
- Level: Medium · Status: Confirmed · Area: task page (charter A/B)
- "THEIR RATE", "Jobs completed: 3 requests posted", "Send <name> a task" on a request; Earn mode is right. `TaskDetailScreen.tsx` uses the Hire/Earn mode (line 132), not the task's kind
- Seen first: 10 Nov sweep

### B34 · A distance search keeps the newest 20 first, then filters by distance
- Level: High · Status: Confirmed · Area: search and maps (charter B)
- `api/reads.ts` `searchTasks` limits in SQL, then filters by km, so nearby tasks drop out once there is volume; same pattern in `tasksNear` (200), `workersNear` (300), `recommendedTasks` (60)
- Seen first: 10 Nov sweep

### B35 · Home "Services near you" is the newest 20 worldwide
- Level: Medium · Status: Confirmed · Area: the poster (charter A)
- A Berlin listing shows to a Hyderabad user; `HomeScreen.tsx` sends no `near` outside a search. Fix after B34
- Seen first: 10 Nov sweep

### B36 · My Work "Done 3" while Completed is 0
- Level: Low · Status: Confirmed · Area: the worker (charter D)
- The Done tab counts offers that were not picked
- Seen first: 10 Nov sweep

### B37 · Rating totals are not recalculated when a review is removed
- Level: Medium · Status: Confirmed · Area: trust and reviews
- Profile says "★ 5.0 · 1 review", list is empty (0 review rows). Set only by `submit_review` (008). 1 profile out of step on 10 Nov
- Check: `select count(*) from profiles p where worker_rating_count <> (select count(*) from reviews r where r.subject_id = p.id and r.about_role = 'worker')` → 0
- Seen first: 10 Nov sweep

### B38 · 13 older tasks still publish their exact pin
- Level: Medium · Status: Confirmed · Area: privacy
- 4-decimal public lat/lng and no `task_private` row (13 Sep – 31 Oct; 5 still open or locked); written with triggers off so the 074 rounding never ran. Backfill needs the owner's OK
- Seen first: 10 Nov sweep

### B39 · 8 live accounts onboarded without a passed age check
- Level: Low · Status: Confirmed · Area: legal (18+)
- 27 onboarded profiles with no passed `age_checks`; 8 not deleted, newest 26 Oct
- Seen first: 10 Nov sweep

### B40 · People map list order disagrees with the "nearest person" card
- Level: Low · Status: Confirmed · Area: maps
- Card sorts by km (`NearMap.tsx` 734), list keeps active-first. Owner to choose
- Seen first: 10 Nov sweep

### B41 · A withdrawal "requested" since 5 Oct, hidden from the Withdrawals list, no explanation
- Level: Low · Status: Confirmed · Area: money (copy)
- Payouts are paused on purpose; the screen should say so and list the pending request
- Seen first: 10 Nov sweep

### B42 · Seed account 9990000003 is named with a security-test string
- Level: Low · Status: Confirmed · Area: test data
- Renders as plain text (no injection); `npm run seed:reset` fixes it (asks first)
- Seen first: 10 Nov sweep

## Closed

(none yet)
