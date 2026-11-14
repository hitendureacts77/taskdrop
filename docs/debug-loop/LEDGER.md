# The debug loop: bug ledger (plan task 2.19)

Every bug the debug loop has seen, in one place. The plan is in `docs/DEBUGGING_PLAN.html`. Each round starts by reading this file and the last `ROUND-N.md`, and ends by updating both. New bugs take the next number (after round 4: **B141**, the Android explorer's findings). Security holes keep their H numbers in the Security section of `docs/ULTIMATE_PLAN.md`; an entry here links to them.

**Statuses:** New → Confirmed → Fixing → Fixed, not rechecked → Verified → Closed. Side doors: Reopened, Accepted, After launch, Cannot reproduce, Duplicate of B..
**Levels:** Critical, High (always fixed this round), Medium, Low (your "fix", "accept" or "after launch").
**Each new entry also says:** Repo (app or admin), Class (UI, Backend or Both), Current vs Expected, Proof (screenshot, clean console log, security rules for Backend), Rung reached on the dig-deeper ladder (1 quick try … 6 retro), Tries, and Fix path (A one whole fix, B one file rewritten; plan section 8). Read `BUG_PROMPT.md` before fixing.

## Rounds

| Round | Date | Pinned commits (app / admin) | Charter | New | Fixed + verified | Reopened | Open: C / H / M / L | Flaky tests | Settled? |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 12 Nov 2026 | 122965a / n/a | setup: baseline `npm run check` green (102 + 103 tests) | | | | 0 / 1 / 5 / 8 | | No |
| 1 | 12 Nov 2026 | 122965a / n/a | A+B+C sweep of the 11 open bugs (code-only; staging recheck pending) | 0 | 0 (10 fixed, not rechecked) | 0 | 0 / 0 / 0 / 4 after merge | not run twice yet | No |
| 2 | 12 Nov 2026 | 09b8338 / n/a | code hunt: money and task life, access and data exposure, app logic | 22 (B43-B64: 2 High, 11 Medium, 9 Low) | 0 (fixes written, not rechecked) | 0 | B55 M, B63 L open for the owner | not run twice yet | No |
| 3 | 12 Nov 2026 | 07cdb1b / n/a | code hunt: alerts, jobs and webhooks; worker flow and search; screens round 2 had not read | 19 (B67-B85: 2 High, 9 Medium, 8 Low, B85 for the owner) | 0 (fixes written, not rechecked) | 0 | B85 needs the owner; B54/B55/B56 open from round 2 | not run twice yet | No |
| 4 | 13 Nov 2026 | e579a29 / db0161b (admin) | live web walk, backend collect + staging recheck of B30-B86, admin code review + partial live admin walk, sweep (checks, e2e); Android explorer to be added | 54 so far (B87-B140: 4 High, 23 Medium, 27 Low); Android from B141 | 0 yet (fixes in progress); 18 of the B30-B86 bugs rechecked and Verified on staging (some structure only) | 0 | counts after the fixes: to be filled in | none seen (e2e only partly run) | No |

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

Three hunters (money and task life, access and data exposure, app logic) read the code, and I checked their claims against the code and staging. 22 new bugs: B43-B52 (app, fixed in commit 2864173), B53-B64 (backend). Every fix is "Fixed, not rechecked" until PR 336 is merged and it is checked on staging.

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
| B53 | High | A worker can raise an offer's price just before the poster taps Hire and the wallet is charged the new price (`lock_bid` reads the price at call time) | Fixed, not rechecked: migration 167 (expected price) |
| B54 | High | Card-paid job whose worker walked off: the leftover card payment is never returned if the next hire is cheaper | Confirmed, needs the owner. A fix was written (migration 168, card money to the wallet at walk-off) but it contradicts test H53 in `hunt2_money.test.sql`, which keeps the card payment on the job on purpose, so it was taken out of this PR. Owner decides where the leftover goes: wallet at walk-off, or refunded at completion |
| B55 | Medium | Clearing settles a recomputed net, not the amount put into clearing (capped jobs, commission changes) | Confirmed, needs the owner (money design, waits for the lawyer's answer) |
| B56 | Medium | Staging is missing part of migration 066 (payments.wallet_credited_*; older `fund_task_from_payment`) | Confirmed, owner (same decision as B54) |
| B57 | Medium | Old `fund_task(task, payment)` still callable by any signed-in user | Fixed, not rechecked: migration 169 |
| B58 | Medium | Wallet says "full refund" with the full amount after a cancel with a fine; worker's fine never shows | Fixed, not rechecked: `reads.ts` |
| B59 | Medium-High | A user can make another user's private file readable by pointing their own avatar, message or proof at its storage path | Fixed, not rechecked: `writes.ts` + migration 171 |
| B60 | Medium | The hired worker reads the exact pin before work starts (and after a refund) | Fixed, not rechecked: migration 172/173 |
| B61 | Medium | Blocks and suspensions do not stop hiring (lock_bid, auto-hire, contact phone) | Fixed, not rechecked: migration 167 |
| B62 | Low-Medium | Trigger `trg_keep_destination_with_open_payout` is disabled on staging (drift) | Fixed, not rechecked: migration 169/170 |
| B63 | Low | Losing bidders see locked price / payment id; OPEN rows expose `preferred_worker_id` | Confirmed, after launch (needs column-grant change across the app) |
| B64 | Low | Signed-in `worker_proof_photos` skips the deleted/hidden/owner filters the guest version has | Fixed, not rechecked: migration 173 |

Found by the round-2 security review of these fixes (older code, not fixed yet):

| Bug | Level | What | Status |
|---|---|---|---|
| B65 | Medium | `cancel_task` pays the worker the 5% fine into their wallet even when the job was paid by card; for a card job the refund trigger returns early, so the fine is not taken out of the poster's refund (TaskDrop pays it) | Not a bug (checked 12 Nov): the card refund is worked out by `escrow_refund_due` as paid minus the logged fine, so TaskDrop does not pay the fine itself; proved on staging in a rolled-back transaction. A test now locks that in |
| B66 | Low | `private.blocked_between` can be executed by `anon` (tells anyone whether two accounts blocked each other) | Fixed, not rechecked: migration 174 revokes it from anon |

## Round 3 results (12 Nov 2026, same PR 336)

Hunters: alerts, jobs and webhooks (Opus); the worker flow and search (Opus); the screens round 2 had not read (Sonnet). B65 turned out not to be a bug and B66 is fixed (see above). New bugs from B67; every fix is "Fixed, not rechecked" until PR 336 is merged and it is checked on staging.

| Bug | Level | What | Status |
|---|---|---|---|
| B67 | Medium | A worker who walks off still gets credit (jobs done, earnings, streaks, regulars, top helpers) when someone else finishes the job: the counters ignore the assignment status | Fixed, not rechecked: migration 175 |
| B68 | Low | The helper map reads only the newest 500 service listings nationwide, so a nearby older listing can be missing (B34 pattern) | Fixed, not rechecked: `reads.ts` |
| B69 | Low | The username check says "Available" for reserved names (e.g. admin), then Save fails | Fixed, not rechecked: `reads.ts` |
| B70 | Medium | Find work reads the newest 200 open requests nationwide, then filters by distance on the phone (B34 pattern on this screen) | Fixed, not rechecked: `ExploreScreen.tsx` |
| B71 | High | Compare picks and highlights offers by the worker's name; with two same-named workers, the poster can hire and pay the wrong offer | Fixed, not rechecked: `CompareScreen.tsx` |
| B72 | High | A pasted +91 phone number is cut to a different 10-digit number, so the sign-in code goes to another person | Fixed, not rechecked: `lib/phone.ts` |
| B73 | Medium | Phone sign-in shows raw errors ("JSON Parse error") on a bad server reply | Fixed, not rechecked: `AuthProvider.tsx` |
| B74 | Medium | Sign-out never removes the device's push token, so the old account keeps getting alerts on a shared phone | Fixed, not rechecked: `AuthProvider.tsx`, `push.ts`, new api op `forgetPushToken` |
| B75 | Medium | The Light/Dark choice is not saved across app restarts | Fixed, not rechecked: `ThemeProvider.tsx` |
| B76 | Medium | Review form pre-ticks 5 stars and praise tags, so a 1-star review is posted with praise | Fixed, not rechecked: `ReviewScreen.tsx` |
| B77 | Medium | Dark-mode Earn text (`purpleDeep`) fails 4.5:1 contrast | Fixed, not rechecked: `theme.ts` |
| B78 | Low-Medium | Coral error text on white is 3.15:1 (needs `signalDeep`) at 14 sites | Fixed, not rechecked |
| B79 | Low | Username check can show a stale answer; masking turns the word "snap" into dots; Compare shows "1 hrs" and "0.0" ratings | Fixed, not rechecked |
| B80 | Medium-High | A paid promotion switches on only if the payer comes back to the same screen (webhook does not activate it) | Fixed, not rechecked: migration 177 + razorpay functions |
| B81 | Medium | Chat and status notifications go to a worker who already walked off | Fixed, not rechecked: migration 176 |
| B82 | Medium | Re-hiring a worker after others walked off prices the card link and settles clearing against the wrong worker | Fixed, not rechecked: migration 167 |
| B83 | Medium | A newly hired worker can read the previous worker's whole chat | Fixed, not rechecked: migration 176 |
| B84 | Low-Medium | A paid top-up whose credit failed once is never credited | Fixed, not rechecked: webhook + razorpay function |
| B85 | Low-Medium | An escrow refund is recorded as done when requested; a later `refund.failed` from Razorpay is never seen | Confirmed, needs the owner (Razorpay webhook subscription and a new status column) |

Questions for the owner (no bug claimed): after a revision the worker can mark the job done again without new proof (design?); reviews can be edited forever; a poster can ask for unlimited revisions with no timer; "five stars" streak counts hidden reviews; the withdraw screens promise "within 1 working day" while payouts are paused.

Not bugs: migrations 162-166 not on staging yet (they apply when PR 336 merges).

## Round 4 results (13 Nov 2026)

Details: `docs/debug-loop/ROUND-4.md`. Raw reports: `round-4/web.md`, `round-4/backend-collect.md`, `round-4/admin-live.md`, `round-4/admin.md`, `round-4/sweep.md`. 54 new entries so far: B87-B94 web, B95-B104 backend, B105-B119 admin (live walk), B120-B138 admin (code review), B139-B140 sweep gaps. Every entry below under "Round 4 findings" is "Confirmed" unless it says "New" (needs a live check first), and fix path A unless it says otherwise.

### Round 4 summary

- **Counts (B87-B140, 54 entries):** 4 High (B88, B95, B105, B106), 23 Medium, 27 Low. Entries that need the owner or a migration are marked "Owner:" or "Needs migration (owner's yes)".
- **Covered:** the web app as a guest and as a new sign-up (area, phone box, age gate, post flow, composer, sign-in code); the staging database and Edge Functions against the repo (migrations 162-177, deploy dates, advisors, 24 h of logs, table invariants); a staging recheck of the B30-B86 fixes; the whole admin code (role matrix, routes, 60+ server actions); the live admin walk up to "Audit log"; both repos' check, contract, audit and admin build runs.
- **NOT covered:** the live admin walk stopped when the browser's Google session switched to a non-admin account; the pages not walked are listed in `round-4/admin-live.md` (My security, Disputes, Reports queue, Alerts, Help requests, Copyright, Feedback board, Promotions, Customer hub, CRM pages, Business reports, Team performance, Devices, non-People exports). No per-role logins (Viewer, Finance, Support, Sales), so R4-X5, X10, X14 and the role matrix are code-only. The admin was seen at 767 px only, never 390 px or desktop width; the web explorer never reached a 1440 px window either. `npm run test:db` could not run (B140), so the money and access SQL tests are unverified this round. Only part of the e2e suite ran (B139). The Platform controls form was not saved (blocked by the session's permission check).
- Android explorer findings: to be added (B141 onward).
- **Stop test:** not met. New High found (S1 fails), nothing fixed yet (S2), 54 new (S3), most fixes unchecked on staging (S4), e2e partly run (S5, S6).

### Rechecks of B30-B86 on staging (read-only, 13 Nov)

| Bug | Round 4 status | Evidence |
|---|---|---|
| B30 | Verified | `top_earners_live` returns 0 deleted accounts in all three lists |
| B32 | Verified | `platform_highlights_live().openTasks` = 165 = an independent recount |
| B34 | Verified | `guest_open_posts_near` and `guest_helpers_near` take the box arguments; a Hyderabad box gives 10 rows each; anon and authenticated cannot run them |
| B37 | Verified | the two recompute triggers are enabled; the ledger check query returns 0 |
| B38 | Verified | 0 unrounded pins, 0 pinned tasks without a `task_private` row (457 pinned); side finding B96 |
| B53 | Verified | `lock_bid(uuid, payout_mode, bigint)` checks the expected price; the old 2-argument overload wraps it on purpose |
| B54, B55, B56, B85 | Still open (owner) | no database fix this round; `payments` has no `wallet_credited_*` columns |
| B57 | Verified | `fund_task(uuid, uuid)`: anon no, authenticated no |
| B59 | Verified (structure) | the 6 own-path triggers are enabled; not exercised with a write |
| B60 | Verified | policy `task_private_parties_read` uses `private.user_working_task`; `can_read_task_media` exists |
| B61 | Verified (source) | the blocked checks are in `auto_accept_bid`, `task_contact_phone`, `lock_bid`; `crm_suspend_user` touches bids |
| B62 | Verified | `trg_keep_destination_with_open_payout` is enabled |
| B64 | Verified | `worker_proof_photos(uuid)` filters deleted rows, authenticated only |
| B66 | Verified | `private.blocked_between`: anon no, authenticated yes |
| B67 | Verified (source) | stats functions rewritten over assignments; not compared against a walked-off sample |
| B80 | Verified (structure) | `payments.promotion_id` and `activate_promotion_from_payment(uuid)` exist, service role only; 0 promotions on staging, not exercised |
| B81, B83 | Verified (structure) | `task_live_worker`, new `on_message_inserted` / `on_task_changed`, policy `messages_select_participant` uses `can_read_task_message` |
| B82 | Verified (structure) | `auto_accept_bid` and `lock_bid` carry the migration 167 re-hire code; not exercised |
| B84 | Not checkable in SQL | webhook and razorpay function code only; the functions were deployed after HEAD |
| B21 | Grown | 87 OPEN tasks past due (58 on 10 Nov), 8 LOCKED over 2 days (2 on 10 Nov) |
| B35 (web) | Open, by design for guests | a guest still sees a Berlin listing under "Services near you"; the guest branch keeps "newest listings" |
| B72 (web) | Paste fixed, typing not | typing a +91 number one key at a time still changes the number: see B88 |

Other B-numbers from B30-B86 were not rechecked this round.

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
- 13 Nov round 4: grown again to 87 open tasks past due and 8 unpaid locks over 2 days (backend-collect.md section 2). Still needs the owner: end status, refund rule, lock timeout. Fix path: Owner (decision first)

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

## Round 4 findings (13 Nov 2026)

Found in round 4. Sources: `round-4/web.md` (B87-B94), `round-4/backend-collect.md` section 4 (B95-B104), `round-4/admin-live.md` (B105-B119), `round-4/admin.md` (B120-B138), `round-4/sweep.md` (B139-B140). "R4-..." is the id used in that report. Fix path A unless stated. Android findings follow from B141 (not added yet).

### Web explorer (taskdrop.in, staging)

### B87 · A guest's chosen area on Hire Home is forgotten after a reload
- Level: Medium · Status: Fixed in PR 340 (13 Nov) · Area: the poster, guest mode (charter A) · Repo: app · Class: UI · Fix path: A
- Current: guest picks an area, header shows it, a reload brings back "Set your location"; the saved guest area is never read by Home, while maps use it, so Home and Explore disagree. Expected: Home reads and writes the same guest area as `useMyArea`. The post flow's "Where" step also does not pre-fill it
- File: `apps/mobile/src/components/HomeSections.tsx` `choosePlace` (about line 163, `if (!userId) return;`, no storage write) and `loadTop`. Proof: header zoom after reload; local storage key `taskdrop.guest.area.v1` holds an older value; no console errors
- Seen first: 13 Nov round 4 (R4-W1)

### B88 · Typing "+91" plus a number key by key still gives a different valid number (B72 not fully fixed)
- Level: High · Status: Fixed in PR 340 (13 Nov) · Area: sign-in (charter A) · Repo: app · Class: UI · Fix path: A
- Current: typing +91 and ten digits one key at a time leaves the box on a different 10-digit number with a green tick, so the code goes to another person. Pasting the whole string is fixed. Expected: a typed country code is stripped too, or an eleventh digit is refused with a "drop the +91" hint
- File: `apps/mobile/src/lib/phone.ts` `normalizeMobileInput`: typed one key at a time the value is already capped at 10 digits, so the 12-digit "91..." rule never runs. Proof: zoom of the field with the tick. Reopens the typing half of B72
- Seen first: 13 Nov round 4 (R4-W2)

### B89 · The age gate can be passed by trying again with an older birth date
- Level: Low · Status: Confirmed · Area: legal 18+ (charter A) · Repo: app · Class: Both · Fix path: Owner: decision first, then A
- Current: a 17-year-old is turned away, then the same number with an older date gets a code and an account; nothing remembers the refusal. Expected (suggestion): remember it on the device and for the number for some days, or at least for the session
- Seen first: 13 Nov round 4 (R4-W3)

### B90 · The post flow accepts a price of nearly 10,00,00,00,000 rupees
- Level: Medium · Status: Fixed in PR 340 (13 Nov) · Area: the poster, money (charter A/C) · Repo: app · Class: Both · Fix path: A
- Current: minus sign and decimals are dropped, but the budget becomes about Rs 9,99,99,99,999 with "Any amount works", Continue enabled, a fee of about Rs 3 crore on Review and an auto-hire line with the same amount. `createTaskSchema.benchmarkMinor` has no upper bound. Expected: a sane maximum on the client and on the server, with a hint above it
- File: `packages/schemas/src/index.ts`. Related: the admin walk saw a Rs 9,99,99,999 job posted from the Android app the same day (seen in `round-4/admin-live.md`)
- Seen first: 13 Nov round 4 (R4-W4)

### B91 · An "At a place" task can be posted with no place set
- Level: Medium · Status: Fixed in PR 340 (13 Nov) · Area: the poster (charter A) · Repo: app · Class: UI · Fix path: A
- Current: at the Place step, "At a place" with "Set where the job is" left empty continues; Review says "Location not set" and "Post my request" works. Expected: an in-person task needs at least an area (default to the saved area), otherwise it never shows on a distance search or map
- Seen first: 13 Nov round 4 (R4-W5)

### B92 · The composer counter shows 1687/1500 and Next stays enabled
- Level: Low · Status: Fixed in PR 340 (13 Nov) · Area: the poster (charter A) · Repo: app · Class: UI · Fix path: A
- Current: text over 1500 characters (reached by script; a voice transcript or idea chip could do it) shows the counter in the normal colour, Next enabled, and the AI writes from the full text. Expected: counter red and Next disabled over the limit, or the text cut at 1500
- Seen first: 13 Nov round 4 (R4-W6)

### B93 · A wrong sign-in code gives no message
- Level: Medium · Status: Withdrawn (the page does show "That code is not right"; the silence came from the test tool) · Area: sign-in (charter A) · Repo: app · Class: UI · Fix path: A
- Current: after a wrong 6-digit code the page freezes a few seconds, then the boxes are empty again with no "That code is wrong" and no tries-left count. Expected: a plain error under the boxes, focus back on the first box
- Seen first: 13 Nov round 4 (R4-W7)

### B94 · The sign-in hero says "Get help nearby. Or earn nearby."
- Level: Low · Status: Fixed in PR 340 (13 Nov) · Area: copy (charter A) · Repo: app · Class: UI · Fix path: A
- Current: the headline suggests local-only, against the rule that tasks are local AND remote (the card does show a remote example). Expected: wording that covers both
- Seen first: 13 Nov round 4 (R4-W8)

### Backend collect and staging recheck

### B95 · Migration 152 (abuse caps H43/H44/H47) is not applied on staging
- Level: High · Status: Confirmed · Area: abuse limits, security (H43/H44/H47) · Repo: app (`supabase/migrations/20261105150000_152_abuse_caps.sql`) · Class: Backend · Fix path: Needs migration (owner's yes): apply the existing file, do not rewrite it
- Current: staging has no `is_new_account`, `limit_daily_posts` or `limit_daily_feedback`, no `post_cap_day`, `ad_click_viewer_promo_day` or `media_uploads_day` settings, and `record_ad_click` has the old body. So the ad-click, ad-impression, media upload, daily post and feedback caps are not live. Expected: applied (it sorts between 151 and 153 and was skipped)
- Seen first: 13 Nov round 4 (backend-collect N1)

### B96 · 12 `task_private` rows belong to tasks that no longer exist
- Level: Low · Status: Confirmed · Area: privacy, data · Repo: app · Class: Backend · Fix path: Owner: a data cleanup (deleting rows) needs the owner's yes
- Current: 12 orphan rows keep the exact pin and address of deleted tasks, all from 4 Oct 15:28 UTC. The foreign key is ON DELETE CASCADE but DEFERRABLE INITIALLY DEFERRED (migration 074). Expected: no orphans; find out why the cascade missed them
- Seen first: 13 Nov round 4 (backend-collect N2, found while verifying B38)

### B97 · Inngest jobs fail with "JWT issued at future" one to five times an hour
- Level: Medium · Status: Confirmed · Area: background jobs (charter F) · Repo: app · Class: Backend · Fix path: A
- Current: about 40 errors in 24 h across 8 steps (outbox pending, settle cleared earnings, outbox watchdog, media expire, auto-complete, a settings read), one message. Retries hide it, but each failed step is a delayed push or sweep. Expected: tolerate the clock skew (small `iat` margin or a re-issue) instead of relying on retry
- File: `supabase/functions/inngest/jobs.ts` `call()` and the `db` client in `index.ts`
- Seen first: 13 Nov round 4 (backend-collect N3)

### B98 · `submitProof` takes a 5000-character summary and 30 files, the table allows 2000 and 10
- Level: Low · Status: Fixed in PR 340 (13 Nov) · Area: worker flow (charter D) · Repo: app · Class: Backend · Fix path: A
- Current: a direct API call over the limits returns a raw constraint error (log: `task_proofs_summary_check` violated 12 Nov). The app itself caps at 2000 and 10. Expected: the same limits in the API's input check, with a plain message
- File: `supabase/functions/api/writes.ts` lines 438-460
- Seen first: 13 Nov round 4 (backend-collect N4)

### B99 · `app-download` answers 503, so the download page and QR cannot find the newest Android build
- Level: Medium · Status: Confirmed · Area: app delivery · Repo: app · Class: Both · Fix path: Owner: the owner adds the `EXPO_BUILDS_TOKEN` function secret (never printed or put in code); no code change needed
- Current: 2 x 503 "token is not set" on 12 Nov 20:18 UTC, from phones (function v17). Expected: the page finds the newest build
- File: `supabase/functions/app-download/index.ts`
- Seen first: 13 Nov round 4 (backend-collect N5)

### B100 · `places-search` answers 401 to signed-out callers
- Level: Medium · Status: New (needs a guest repro on web and Android) · Area: guest mode, location · Repo: app · Class: UI/Backend · Fix path: A
- Current: 20 x 401 in 24 h (15 within 2 minutes from a browser, 5 from the Android app) with no user role on the request; verify_jwt is on and guest mode has no session, so location search for guests may fail. Expected: guests can search for a place, or the app hides it with a plain message
- File: `apps/mobile/src/lib/location.ts` lines 267-340, `supabase/config.toml` for places-search
- Seen first: 13 Nov round 4 (backend-collect N6)

### B101 · The nightly reconcile reports 14-19 "high" mismatches every night, all on fake-city seed tasks
- Level: Low · Status: Confirmed · Area: test data, money checks · Repo: app · Class: Backend (test data) · Fix path: Owner: fixing the seed means a reseed, which asks first
- Current: 50 findings in 4 nights, all `finished_without_commission` on seed tasks (fa4e0002-*), no real task. The noise can hide a real mismatch. Expected: seed tasks carry commission lines, or are skipped by the check
- File: `supabase/seed/fake_world.sql`
- Seen first: 13 Nov round 4 (backend-collect N7)

### B102 · One payout "processing" for 38 days and 6 "requested" for over 7 days
- Level: Low · Status: Confirmed · Area: money (B41 area) · Repo: app · Class: Backend · Fix path: Owner: payouts are paused on purpose; the owner decides what happens to the old ones
- Seen first: 13 Nov round 4 (backend-collect N8, counts only)

### B103 · 23 DISPUTED tasks are older than 3 days and nothing shows who resolves them
- Level: Low · Status: Confirmed · Area: money, admin queue (seed data) · Repo: app · Class: Backend (seed) · Fix path: A for the admin queue wording, Owner for the seed
- Seen first: 13 Nov round 4 (backend-collect N9, count only; admin shows 23 disputes in "needs you")

### B104 · `payments.promotion_id` has no index on its foreign key
- Level: Low · Status: Confirmed · Area: performance · Repo: app · Class: Backend · Fix path: Needs migration (owner's yes), only if the owner asks
- Evidence: performance advisor `unindexed_foreign_keys` (`payments_promotion_id_fkey`, new in migration 177)
- Seen first: 13 Nov round 4 (backend-collect N10)

### Admin panel, live walk (admin.taskdrop.in, staging, 767 px wide)

### B105 · The admin jobs list paging skips 280 of 748 jobs and repeats others
- Level: High · Status: Confirmed · Area: admin, jobs list · Repo: admin · Class: Backend · Fix path: A
- Current: 25 pages show 748 rows but only 468 distinct jobs; page 2 repeats 19 of page 1's 30. 280 jobs cannot be reached by paging. The People list is fine (198 seen, 198 unique). Expected: each job exactly once
- Cause: ordered by "last change" only; the fake seed wrote hundreds of jobs with one timestamp, so `range()` over a non-unique key is unstable. Add `id` as a tie-breaker. File: the jobs query behind `app/tasks/page.tsx`
- Seen first: 13 Nov round 4 (R4-L1)

### B106 · The Pay screen's QR and copy button use a different UPI id than the one the withdrawal went to
- Level: High · Status: Confirmed · Area: admin payouts (charter C/E) · Repo: admin · Class: Both · Fix path: A
- Current: on one seed worker's Rs 600 payout, step 1 (QR, "UPI", Copy) shows one id while the Details box says "Sent to" another; no warning that they differ. With real money, a worker who changes UPI after asking (or whoever took the account over) is paid to the new id. Also: "Paid: By RazorpayX" on a manual, unpaid withdrawal. Expected: pay the destination saved on the withdrawal (or say clearly the id changed and ask which to use); "Not paid yet" / "By hand"
- Seen first: 13 Nov round 4 (R4-L2)

### B107 · People page and CSV: Phone is empty and the phone number sits unmasked inside "Email"
- Level: Medium · Status: Confirmed · Area: admin people, privacy (H33) · Repo: admin · Class: Both · Fix path: A
- Current: for all 170 phone sign-ups the Phone field is "-" and Email shows the internal sign-in address built from the phone number. In the CSV the Phone column is empty for all 198 rows and the Email column carries the full number for 170 (120 of them fake). 19 deleted accounts are in the "Everyone" export. Expected: Phone shows the phone (masked in list and CSV unless revealed), Email a real email or "-"; deleted accounts left out unless the Deleted filter is chosen
- Seen first: 13 Nov round 4 (R4-L3)

### B108 · Audit gaps: person Audit tab empty, "opened a person page" has no target, tag changes not logged
- Level: Medium · Status: Confirmed · Area: admin audit (H77-H80 area) · Repo: admin · Class: Backend · Fix path: A; may need migration (owner's yes) if the log rows come from a database trigger
- Current: the person's Audit tab says "Nothing recorded" although the global log has suspension rows for that person; the 6 "Opened a person page with phone and email showing" rows have no before/after and never say whose contact was seen; adding and removing a tag wrote no audit line; suspension rows do not name the person. Expected: every staff action names its target and shows on that person's Audit tab; tag changes are logged (SECURITY_ROLES lists tags)
- Seen first: 13 Nov round 4 (R4-L4)

### B109 · Payouts: "Settled" says 10 paid for Rs 12,650 in 30 days, the Paid tab says 0
- Level: Medium · Status: Confirmed · Area: admin payouts · Repo: admin · Class: Both · Fix path: A
- Current: "Last 30 days, paid in total Rs 12,650.00 (10)" beside tabs "All 25 · Paid 0 · Came back 0 · Cancelled 25"; the Paid tab says nothing in the last 30 days; the dashboard repeats Rs 12,650 / 10. Expected: the summary and the tab counts use the same window
- Seen first: 13 Nov round 4 (R4-L5)

### B110 · "Ready to withdraw" includes earnings still clearing
- Level: Medium · Status: Confirmed · Area: admin payouts, money position · Repo: admin · Class: UI · Fix path: A
- Current: "Ready to withdraw Rs 1,58,146.00 (earnings people can still ask for)", which is ready Rs 1,43,301 + clearing Rs 9,945 + on the way Rs 4,900. Clearing money cannot be asked for and money on the way was already asked for. Expected: Rs 1,43,301, or relabel the sum
- Seen first: 13 Nov round 4 (R4-L6)

### B111 · A cancelled job's timeline says "Approved, money released"
- Level: Medium · Status: Confirmed · Area: admin job page · Repo: admin · Class: UI · Fix path: A
- Current: a cancelled, never hired job shows "Approved, money released" at the cancel time, while "Where the money is now" says nobody is hired. Expected: a "Cancelled" step and "Approved" left at "Not yet"
- Seen first: 13 Nov round 4 (R4-L7)

### B112 · Turning on "Authenticator code for money actions" does not warn that no admin has one
- Level: Medium · Status: New (not confirmed by pressing the switch) · Area: admin switches · Repo: admin · Class: UI · Fix path: A
- Current: Team says "Authenticator set up 0 of 6"; the confirm only says every admin must enter a code before moving money, so one click could block every money action for all 6 staff. Expected: refuse or warn loudly when no admin (or not the current admin) has one. Note: the authenticator is future scope (owner, 24 Oct), so this is only the safety guard
- Seen first: 13 Nov round 4 (R4-L8)

### B113 · The money check hides the oldest stuck withdrawals by default
- Level: Medium · Status: Confirmed · Area: admin money check · Repo: admin · Class: UI · Fix path: A
- Current: default "Last 30 days" shows "Withdrawal waiting too long: 2" while 7 wait 13 to 40 days; the 4 oldest appear only under "Last 90 days" (which says 6). The window filters by the date asked, so the worst cases drop out first. Expected: open problems always listed; the window only for closed history
- Seen first: 13 Nov round 4 (R4-L9)

### B114 · Jobs search: the "held" total ignores the search, and `%` and `_` match everything
- Level: Low · Status: Confirmed · Area: admin jobs · Repo: admin · Class: UI · Fix path: A
- Current: "0 jobs, Rs 33,681.00 held in escrow for them"; searching `%` or `___` returns all 748 jobs (LIKE wildcards not escaped). Special characters render safely. Expected: the held sum follows the search; wildcards searched literally
- Seen first: 13 Nov round 4 (R4-L10)

### B115 · CSV dates are UTC while the screen is India time
- Level: Low · Status: Confirmed · Area: admin exports · Repo: admin · Class: Backend · Fix path: A
- Current: a person who joined 5 Nov at 03:47 IST is `2026-11-04` in the CSV (same for Last seen). Expected: India time like the screen, or say UTC in the header. (Good: a tag `=1+1` came out as `'=1+1`, formula cells are neutralised)
- Seen first: 13 Nov round 4 (R4-L11)

### B116 · The record-payment reference accepts a single space
- Level: Low · Status: Confirmed (browser side; the server side was not tested because it would record a payment) · Area: admin payouts · Repo: admin · Class: UI · Fix path: A
- Current: the UTR box is `required` with no pattern; a space or "x" passes. Expected: trim and require a UTR-shaped value (12 digits for UPI), checked on the server too
- Seen first: 13 Nov round 4 (R4-L12)

### B117 · The audit log is flooded by a system line every 10 minutes
- Level: Low · Status: Confirmed · Area: admin audit · Repo: admin · Class: Backend · Fix path: A; may need migration (owner's yes) if the write comes from a trigger
- Current: 1,385 lines, almost all "The system, Settings, Changed public_snapshots_last_ok"; staff actions are buried and there is no "staff only" default. Expected: heartbeat values not written to the audit log, or hidden by default
- Seen first: 13 Nov round 4 (R4-L13)

### B118 · Status contradictions across the admin screens
- Level: Low · Status: Confirmed · Area: admin copy and numbers · Repo: admin · Class: UI · Fix path: A (the seed items are Owner: reseed)
- Current: System health says "Everything is working" while the Money check shows 14 differences (B101); Team text says an authenticator is needed to move money and for role changes while the switch is Off and nobody has one; the oldest payout still shows "You're paying" (claim lock never expires, 40 days); seed people "last seen 13 days ago" yet "joined 5 Nov"; list says "Worker" where the person page says "Worker · Poster"; Devices says iPhone "100% on the latest version (1.0.0)" while the app is 1.1.0
- Seen first: 13 Nov round 4 (R4-L14)

### B119 · The "Not an admin account" page is a dead end
- Level: Low · Status: Confirmed · Area: admin sign-in · Repo: admin · Class: UI · Fix path: A (same fix as B131)
- Current: `/not-authorized` has no Sign out or "Use another account"; the person must open `/login` by hand, which shows only Google's account chooser, not the username + password option. Expected: a Sign out button and links to both sign-in methods
- Seen first: 13 Nov round 4 (R4-L15)

### Admin panel, code review (`Taskdrop administrator`, branch redesigned-2.0, HEAD db0161b; no live sign-in used)

### B120 · A failed staff-role read makes any staff member a full Admin in the panel
- Level: Medium · Status: Confirmed (by code; the trigger is rare) · Area: admin roles (H33, H79) · Repo: admin · Class: Backend · Fix path: A
- Current: `auth.ts:65-75` reads `user_roles` and `admin_staff` together and drops the `admin_staff` error; `asStaffRole(undefined)` returns `'admin'`, so every `staffGate()` passes and full contacts show and export. The database re-checks most writes, so the damage is mostly panel-side. Expected: a read error refuses; only a real "no row" means full admin
- File: `src/lib/auth.ts:65-75`, `src/lib/staff-roles.ts:103-105`
- Seen first: 13 Nov round 4 (R4-X1)

### B121 · The rate limiter lets every call through on error (H77)
- Level: Medium · Status: Confirmed (by code) · Area: admin security (H77) · Repo: admin · Class: Backend · Fix path: A
- Current: on an RPC error or throw `rate-limit.ts:154-162` returns `true`, so the admin sign-in limit (10 a minute) and the authenticator limit vanish with only a console warning. Expected: fail closed for `admin-signin` and `admin-mfa` (probably exports too) with a Sentry event; keep open only for `admin-live`
- Seen first: 13 Nov round 4 (R4-X2)

### B122 · CRM audiences, segments, tag counts and the People export stop at 1,000 rows
- Level: Medium · Status: Confirmed (by code; the staging `max_rows` needs a live look) · Area: admin CRM · Repo: admin · Class: Both · Fix path: A
- Current: `matchingIds()` calls `crm_segment_users` with no paging, so the Messages confirm says "Yes, send to 1,000" while `crm_send_broadcast` sends up to 5,000; segment lists, totals, the segment export and tag counts stop silently; the audit row records the capped number. Staging has about 120 fake people so it does not show yet. Expected: page the RPC or count in the database; the confirm count equals what is sent
- File: `src/lib/crm.ts:273-282, 121, 156, 162, 398-405`
- Seen first: 13 Nov round 4 (R4-X3)

### B123 · No admin server action has a rate limit or double-submit guard
- Level: Medium · Status: Confirmed (by code) · Area: admin security (H77-H80) · Repo: admin · Class: Backend · Fix path: A
- Current: none of 60+ actions calls `withinRate`; `scripts/check-endpoints.mjs` only walks route files. `sendBroadcast` is the worst: any Support or Sales login, no authenticator code, up to 5,000 people per call, no duplicate check, so a replay sends another push each time. Money actions are idempotent in the database. Expected: a per-staff limit on broadcasts, warnings, suspensions and deletions, and a short duplicate check on broadcasts
- File: `src/lib/crm-actions.ts:265-320` and every action file
- Seen first: 13 Nov round 4 (R4-X4)

### B124 · Any staff role can mark all team alerts read for everyone
- Level: Low · Status: Confirmed (by code) · Area: admin alerts · Repo: admin · Class: Both · Fix path: A for refusing Viewer and reporting 0 rows; Needs migration (owner's yes) if the read state becomes per staff member
- Current: `alerts-actions.ts:12-22` has `requireAdmin()` but no `staffGate`; `read_at` is one value shared by everyone, so a Viewer clears the list for all; for Sales the update touches 0 rows yet says "All alerts marked as read." Expected: per-staff read state, or at least Viewer refused and 0 rows reported
- Seen first: 13 Nov round 4 (R4-X5)

### B125 · A big People export calls Supabase Auth once per person
- Level: Medium · Status: New (plausible; needs a large data set) · Area: admin exports · Repo: admin · Class: Backend · Fix path: A
- Current: `crm.ts:417-439` awaits `auth.admin.getUserById` for each row in turn, up to 20,000 ids, so a big export times out after the audit row already says "N people"; `memberRows` also ignores read errors, so a failed chunk gives a shorter file. Expected: batch the lookup, cap or stream the export, fail loudly on a read error
- Seen first: 13 Nov round 4 (R4-X6)

### B126 · A space typed as a setting saves 0
- Level: Medium · Status: Confirmed (by code; needs admin and authenticator code, so only by mistake) · Area: admin settings, money timing · Repo: admin · Class: Backend · Fix path: A
- Current: `actions.ts:366` trims, then `Number('')` is 0 and passes `isFinite`; `clearing_period_days` and `new_account_tasks` (min 0) accept it, so earnings would clear at once, with "Saved". Expected: an empty value is refused ("Type a number")
- Seen first: 13 Nov round 4 (R4-X7)

### B127 · No security events reach Sentry from the admin (H78)
- Level: Medium · Status: Confirmed (by code) · Area: admin monitoring (H78) · Repo: admin · Class: Backend · Fix path: A
- Current: only `error.tsx` and `global-error.tsx` call Sentry; failed password sign-ins, wrong codes, forbidden `checkAdmin` results and `staffGate` refusals are not reported. Expected: `security_event` tagged events so the 2.10 alert covers the admin. See also the Sentry warning in `round-4/admin-live.md` (`beforeSendTransaction` ignored with `traceLifecycle: 'stream'`; check whether scrubbing lives there)
- Seen first: 13 Nov round 4 (R4-X8)

### B128 · A broken regex leaves "ERROR:" in two admin messages
- Level: Low · Status: Confirmed (by code) · Area: admin copy · Repo: admin · Class: UI · Fix path: A
- Current: `session-actions.ts:55` and `admin-actions.ts:29` use `/^(error:s*)/i` (no backslash before `s`); every other file uses `\s*`. Expected: stripped like everywhere else
- Seen first: 13 Nov round 4 (R4-X9)

### B129 · Sales (money-blind) still receives the refunds-owed count in page data
- Level: Low · Status: Confirmed (by code) · Area: admin roles (H33) · Repo: admin · Class: Backend · Fix path: A
- Current: `layout.tsx:35` calls `getNavCounts()`, which reads `refunds_outstanding` with the service key and passes the raw counts to client components; `live.ts` zeroes them only on the live refresh. Expected: zero money counts for Sales in the layout too, and no service-key read for a role that may not see them
- Seen first: 13 Nov round 4 (R4-X10)

### B130 · The login page shows any text passed in `?error=`
- Level: Low · Status: Confirmed (by code) · Area: admin sign-in · Repo: admin · Class: UI · Fix path: A
- Current: `login/page.tsx:29,178-179` shows the parameter as is (React escapes it, so no script), so a link can put a sentence in red on the real admin sign-in page; the callback also forwards Google's `error_description`. Expected: map known codes to fixed sentences, ignore unknown text
- Seen first: 13 Nov round 4 (R4-X11)

### B131 · A non-admin Google sign-in keeps a live session on the admin domain
- Level: Low · Status: Confirmed (by code) · Area: admin sign-in · Repo: admin · Class: Both · Fix path: A (same fix as B119)
- Current: `auth/callback/route.ts:25-33` exchanges the code and redirects without an admin check (the password route signs non-admins out); `/not-authorized` has no sign-out; cookies live until the 12 h cap. Expected: sign out a non-admin in the callback, or offer "Sign out"
- Seen first: 13 Nov round 4 (R4-X12)

### B132 · Other silent row caps in the admin
- Level: Low · Status: New (plausible; depends on data size and `max_rows`) · Area: admin lists · Repo: admin · Class: Both · Fix path: A
- Current: feedback board counts (`feedback.ts:80`), leads (`leads.ts:56`) and device shares (`controls.ts:33`) stop at 1,000 with no notice; the People "Suspended" and tag filters pass every id in one `.in()` URL and fail past a few hundred; support and disputes lists stop at 200 while the sidebar counts all
- Seen first: 13 Nov round 4 (R4-X13)

### B133 · View-only roles see live buttons that the server then refuses
- Level: Low · Status: Confirmed (by code) · Area: admin roles · Repo: admin · Class: Both · Fix path: A
- Current: `settings/switches`, `support/[id]`, copyright, feedback and reports-queue pass their actions to every role that may see the page; the server refuses with "Your staff role (...) can't do this", so no hole, but a Viewer sees an active "Developer sign-in" switch. Expected: read-only rendering like `/settings` and the team page
- Seen first: 13 Nov round 4 (R4-X14)

### B134 · The team page shows every staff member's full email or phone to view-only roles
- Level: Low · Status: Confirmed (by code) · Area: admin privacy (H33) · Repo: admin · Class: Backend · Fix path: Owner: decide whether staff contacts count under H33, then A
- Current: `AdminConfigViews.tsx:195` shows them to Admin, Finance, Support and Viewer, read with the service key in `admin-config.ts:65-80`. Expected (if yes): mask with `emailFor/phoneFor(role, ...)`
- Seen first: 13 Nov round 4 (R4-X15)

### B135 · Negative money in exports is turned into text
- Level: Low · Status: Confirmed (by code) · Area: admin exports · Repo: admin · Class: Backend · Fix path: A
- Current: `csv.ts:11` prefixes any cell starting with `-` (formula guard), so a plain `-12.00` becomes `'-12.00` and column sums skip every negative wallet or revenue day. Expected: keep the guard for text but let plain numbers through
- Seen first: 13 Nov round 4 (R4-X16)

### B136 · "Paid today" and "waiting since" use `updated_at`
- Level: Low · Status: New (plausible; needs a row updated after it was paid or disputed) · Area: admin payouts and disputes · Repo: admin · Class: UI · Fix path: A
- Current: `data/payouts.ts:50-63` counts "paid today" by `updated_at`; `data/disputes.ts:57,84` shows "waiting since" from the task's `updated_at`, which resets on any update. Expected: the real paid and dispute dates
- Seen first: 13 Nov round 4 (R4-X17)

### B137 · The money position hides every error as "migration 066 not applied"
- Level: Low · Status: Confirmed (by code) · Area: admin payouts · Repo: admin · Class: Backend · Fix path: A
- Current: `data/payouts.ts:131-135` returns `null` on any error and the page reads that as "apply migration 066" (the real missing piece is B56). A real outage or a permission change shows a false setup notice. Expected: show the real error
- Seen first: 13 Nov round 4 (R4-X18)

### B138 · Admin test gaps: the fail-open default is locked in by a test
- Level: Low · Status: Confirmed (by code) · Area: admin tests (H79) · Repo: admin · Class: Backend · Fix path: A (after B120, B121, B126)
- Current: the last test in `staff-roles.test.ts` asserts `asStaffRole(undefined) === 'admin'`; no tests for `rate-limit.ts`, `checkAdmin`, `staff.ts`, `moneyMfaGate`, the `middleware.ts` timeouts, `updateSetting` number parsing, `crm.ts exportCsv` or `alerts-actions.ts`; `check-endpoints.test.mjs` only looks for the words `checkAdmin(` and `withinRate(`, so a route that ignores the result passes. Also: `npm run typecheck` fails on a stale generated file in `.next/types` (delete `.next`, not a source bug)
- Seen first: 13 Nov round 4 (R4-X19)

### Sweep gaps

### B139 · User e2e suite is red on `accounts.spec.ts` and `map.spec.ts`
- Level: Medium · Status: Confirmed (red twice, deterministic) · Area: tests (charter G) · Repo: app · Class: Both · Fix path: A after triage
- Current: `accounts.spec.ts` lines 30, 81, 94 time out in `askForCode` because "/" now opens the guest landing page (guest mode D15), not the phone form: a stale test, but the real sign-up is not proven either way, so check it by hand. `map.spec.ts` signed-in and guest tests (lines 36, 58, 75, 88, 127, 214) time out, probably stale after the filters sheet and from-home jobs (D23); the D21 zoom tests (165, 179, 192, 200) never see the zoom change: either headless Chromium has no WebGL, or a real zoom regression after the MapLibre 6.15 / whole-world change. Triage: open the traces in `test-results/`, and wheel-zoom on taskdrop.in by hand. The rest of the suite was never reached (run 1 was interrupted)
- Seen first: 13 Nov round 4 (sweep E2E-1 to E2E-3)

### B140 · `npm run test:db` could not run, so the money and access SQL tests are unverified this round
- Level: Medium · Status: Confirmed · Area: tests (charter G) · Repo: app · Class: Backend · Fix path: Owner: provides `DATABASE_URL` or installs `psql`
- Current: `psql` is not installed on this machine and `DATABASE_URL` is not in the shell (the script does not read `.env.all-secrets`). Expected: run it before any migration or money change counts as checked (AGENTS.md rule)
- Seen first: 13 Nov round 4 (sweep)

### Android explorer findings: to be added (B141 onward)

## Closed

(none yet)
