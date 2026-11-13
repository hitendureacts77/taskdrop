# The bug template (debug loop, task 2.19)

Read this at the start of every debug round and before fixing any bug the owner reports. It is the standing version of the dig-deeper ladder in `docs/DEBUGGING_PLAN.html` (section 7). Started 11 Nov 2026 from the Starter Story lesson "Debugging in Lovable", changed for TaskDrop (Claude Code, Supabase, the `api` Edge Function, Chrome, the Android phone). The second lesson, "Advanced Debugging (Day 6)", added the same day, is section 8 of the plan page: its steps are marked **(Day 6)** below. **Rung 6 adds to "Lessons learned" at the bottom after any bug that needed three or more tries.**

## Phase 0: patch or rebuild? (Day 6)

If the file at fault already has three or more fix commits, or its area reopened in two rounds, say whether this bug gets a patch (fix path A) or a clean rewrite of that **one file** (fix path B), and why. Never restart the whole app. A rewrite that changes how a screen looks is the owner's question (the freeze).

## Phase 1: evidence (collect before changing any code)

1. Reproduce in a fresh browser tab (or on the phone). Clear the console first.
2. Class: **UI** (screen wrong, data right), **Backend** (sign-in, row-level security, storage, Edge Function, database function) or **Both**.
3. Screenshot of the exact element or state.
4. Current behaviour and expected behaviour, one or two plain sentences each.
5. Every console line and failed network call, copied right after reproducing.
6. Backend or Both: the security rules on the tables involved (`select * from pg_policies where tablename in (...)`), the storage bucket rules (`pg_policies` on `storage.objects`) when files are involved, and the `api` Edge Function and Supabase logs for that minute.
7. The pinned commit and where it was seen (website, Android build, admin). For an admin bug: the Vercel `taskdrop-admin` logs, Sentry project `taskdrop-admin`, the audit-log rows, and the staff role used; the fix is a pull request into the admin's `redesigned-2.0`.
8. **Both places (Day 6).** The code is the repo; the live backend is Supabase staging. Check they agree: applied migrations against `supabase/migrations`, and the deployed `api` against the pinned commit.
9. **The files at fault (Day 6).** `graphify query` for the `api` operation and every app call site, before reading code. Never make a repo public or upload code to an outside site (the lesson's RepoMix step is replaced by this).
10. **Context first, don't fix yet (Day 6).** Backend or Both: columns, every rule (`pg_policies`) and the bucket rules for the tables involved, saved as `docs/debug-loop/diagnostics/B<n>-context.md`. Then answer for each action the bug touches: "Would a rule stop this person from reading, adding, changing, renaming or deleting here?" yes or no, with the rule's name.
11. **Logs before code (Day 6).** A failed server call: the last hour of `api` Edge Function and Postgres logs, Vercel runtime errors and the Sentry event, saved as `docs/debug-loop/diagnostics/B<n>-logs.json` with phones, emails, tokens and exact addresses removed. Revise the plan from what the logs say.

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
- **Choose one fix path, never both (Day 6).** **A, one whole fix** (default): 3 to 5 sentences on why it will work, written before changing code, plus the keep-as-is list (sign-in checks stay, secrets stay in the secret stores, no rule loosened, the `api` operation keeps its inputs and replies). **B, rewrite the one failing file** as a full drop-in replacement from its current code and the failing logs, keeping its exported names and contract. The ledger entry says "Fix path: A" or "B".
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
| Still failing? Logs again at once. A **different** error is a new bug with its own entry (Day 6) | staging logs |

## What not to do

- Guess and patch without evidence.
- Stack several fixes, then test.
- Patch over patches after two failed tries.
- Log a phone number, email, secret or exact address.
- Change a security rule to "allow all" to make an error go away.
- Mark a bug fixed before it is rechecked on staging.
- Add a feature while fixing (the freeze holds).
- Make a repo public, even for a minute, or paste code, logs or keys into an outside chat or website (Day 6).
- Save logs or context files that still hold a phone number, email, token or exact address.
- Fold a new, different error into the old bug's entry.

## Owner's bug report (paste in chat)

```
Read docs/debug-loop/BUG_PROMPT.md. I have a bug.
What happens now:
What should happen:
Where: website / Android / admin, Hire or Earn, which screen
Screenshot or video:
```

Claude then collects Phase 1 itself, says the cause and plan, and fixes Critical and High at once; Medium and Low go into `LEDGER.md` for the owner's "fix", "accept" or "after launch".

## The four Day 6 prompts (owner can paste; Claude uses them on itself)

A. Start a bug:

```
Read docs/debug-loop/BUG_PROMPT.md. Bug B<n>: <what happens now>.
Find the files likely at fault with graphify (the api operation and every app call site),
explain the cause in plain words, and write one fix plan. Ask me for anything you cannot read yourself.
```

B. Context first, don't fix yet:

```
Bug B<n> is Backend. Don't fix yet. Load the database context first:
the columns and every security rule for <tables>, and the storage bucket rules if files are involved.
Then say, for each action the bug touches, whether a rule would stop this person, with the rule's name.
```

C. Logs, then update the plan:

```
Bug B<n>: pull the last hour of api Edge Function, Postgres and Vercel logs and the Sentry event,
save them with personal details removed, find the root cause from them,
and update your fix plan so it fixes the real cause.
```

D. Rewrite the whole file:

```
Bug B<n>: <file> has been patched too often. Using the failing logs and its current code,
write the whole file again as a drop-in replacement that keeps its names, inputs and replies,
with the failing test first. Fix path B.
```

## Lessons learned (rung 6 adds here)

(none yet)
