# The debug loop: bug ledger (plan task 2.19)

Every bug the debug loop has seen, in one place. The plan is in `docs/DEBUGGING_PLAN.html`. Each round starts by reading this file and the last `ROUND-N.md`, and ends by updating both. New bugs take the next number from **B33**. Security holes keep their H numbers in the Security section of `docs/ULTIMATE_PLAN.md`; an entry here links to them.

**Statuses:** New → Confirmed → Fixing → Fixed, not rechecked → Verified → Closed. Side doors: Reopened, Accepted, After launch, Cannot reproduce, Duplicate of B..
**Levels:** Critical, High (always fixed this round), Medium, Low (your "fix", "accept" or "after launch").
**Each new entry also says:** Class (UI, Backend or Both), Current vs Expected, Proof (screenshot, clean console log, security rules for Backend), Rung reached on the dig-deeper ladder (1 quick try … 6 retro) and Tries. Read `BUG_PROMPT.md` before fixing.

## Rounds

| Round | Date | Pinned commit | Charter | New | Fixed + verified | Reopened | Open: C / H / M / L | Flaky tests | Settled? |
|---|---|---|---|---|---|---|---|---|---|
| 0 | not run | | setup | | | | 0 / 0 / 0 / 4 | | No |

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
