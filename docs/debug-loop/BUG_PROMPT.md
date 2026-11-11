# The bug template (debug loop, task 2.19)

Read this at the start of every debug round and before fixing any bug the owner reports. It is the standing version of the dig-deeper ladder in `docs/DEBUGGING_PLAN.html` (section 7). Started 11 Nov 2026 from the Starter Story lesson "Debugging in Lovable", changed for TaskDrop (Claude Code, Supabase, the `api` Edge Function, Chrome, the Android phone). **Rung 6 adds to "Lessons learned" at the bottom after any bug that needed three or more tries.**

## Phase 1: evidence (collect before changing any code)

1. Reproduce in a fresh browser tab (or on the phone). Clear the console first.
2. Class: **UI** (screen wrong, data right), **Backend** (sign-in, row-level security, storage, Edge Function, database function) or **Both**.
3. Screenshot of the exact element or state.
4. Current behaviour and expected behaviour, one or two plain sentences each.
5. Every console line and failed network call, copied right after reproducing.
6. Backend or Both: the security rules on the tables involved (`select * from pg_policies where tablename in (...)`), the storage bucket rules (`pg_policies` on `storage.objects`) when files are involved, and the `api` Edge Function and Supabase logs for that minute.
7. The pinned commit and where it was seen (website, Android build, admin).

## Phase 2: find the cause (checklist)

- **UI:** overflow or clipping, layer order (z-index), width or flex, text input focus and caret, stale state after a server reply, web vs native split (`.web.tsx` / `.native.tsx`), dark mode tokens, Hire vs Earn mode used where the task's kind was meant.
- **Security rules (RLS):** which policy refuses or lets the action through; is the owner check (`auth.uid() = ...`) present for every command (select, insert, update, delete); does a `using` clause differ from `with check`.
- **Storage:** does the object exist at the path the row stores; do the bucket rules match the same owner check as the table.
- **Edge Function / database function:** which guard fails; is the server reading a cached value instead of the row; does the function run as the user or with service rights.
- **Data:** totals out of step, rows written with triggers off, fake-data-only shapes.

Write the cause and the smallest fix in one or two lines **before** changing code.

## Phase 3: one whole fix

- One bug at a time; prove it before touching the next.
- The smallest change that removes the cause, not the symptom.
- Backend fix: the exact policy or SQL change and why it is still least-access, written in the pull request. A new migration waits for the owner's yes.
- Two failed tries: go back to the pinned commit and re-plan as one fix. Never a third patch on top.
- Still unclear: rung 4 (diagnostic SQL in `docs/debug-loop/diagnostics/B<n>.sql`, numbered STEP 1..N, read-only, rolled back, results saved as JSON) or rung 5 (`[DBG-B<n>]` log lines on each step of the path, ids only, removed in the same pull request).

## Phase 4: verify

| Check | Where |
|---|---|
| The new test fails before the fix and passes after | unit, `test:db`, `test:contract` or Playwright |
| The whole sweep passes | `npm run check` and the other checks in the plan's step 3 |
| No `[DBG-` line is left | search the code |
| The original steps, after the fix is live | staging, after a hard refresh (Ctrl+F5); clear site data for sign-in mix-ups |
| Android, if the bug was seen there | after the next app update (ask the owner first) |
| Hire and Earn, light and dark, phone and desktop width | if the fix touched a screen |

## What not to do

- Guess and patch without evidence.
- Stack several fixes, then test.
- Patch over patches after two failed tries.
- Log a phone number, email, secret or exact address.
- Change a security rule to "allow all" to make an error go away.
- Mark a bug fixed before it is rechecked on staging.
- Add a feature while fixing (the freeze holds).

## Owner's bug report (paste in chat)

```
Read docs/debug-loop/BUG_PROMPT.md. I have a bug.
What happens now:
What should happen:
Where: website / Android / admin, Hire or Earn, which screen
Screenshot or video:
```

Claude then collects Phase 1 itself, says the cause and plan, and fixes Critical and High at once; Medium and Low go into `LEDGER.md` for the owner's "fix", "accept" or "after launch".

## Lessons learned (rung 6 adds here)

(none yet)
