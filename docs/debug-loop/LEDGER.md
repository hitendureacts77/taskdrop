# The debug loop: bug ledger (plan task 2.19)

Every bug the debug loop has seen, in one place. The plan is in `docs/DEBUGGING_PLAN.html`. Each round starts by reading this file and the last `ROUND-N.md`, and ends by updating both. New bugs take the next number from **B33**. Security holes keep their H numbers in the Security section of `docs/ULTIMATE_PLAN.md`; an entry here links to them.

**Statuses:** New → Confirmed → Fixing → Fixed, not rechecked → Verified → Closed. Side doors: Reopened, Accepted, After launch, Cannot reproduce, Duplicate of B..
**Levels:** Critical, High (always fixed this round), Medium, Low (your "fix", "accept" or "after launch").

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

### B30 · The "New talent" list shows deleted accounts
- Level: Low · Status: Confirmed · Area: the poster (charter A)
- 3 of 30 cards on staging, shown to guests and signed-in people
- Seen first: hunt round 2, 4 Nov

### B32 · The home counter "open tasks" counts posts nobody can see
- Level: Low · Status: Confirmed · Area: the poster (charter A)
- 59 shown, 38 live (4 Nov)
- Seen first: hunt round 2, 4 Nov

## Closed

(none yet)
