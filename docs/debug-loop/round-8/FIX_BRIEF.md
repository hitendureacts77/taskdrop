# Round 8 fix pass: brief for every fixer (17 Nov 2026)

The owner said "complete the debugging flow" on 17 Nov 2026: the round 8 findings (`docs/debug-loop/round-8/S1..S7, L1..L4.md`, counted in `ROUND-8.md`) are now fixed by theme. Each fixer gets one theme and a list of finding ids. Payments stay out of scope (no Razorpay, no money movement code paths beyond the rules named in your theme).

## Rules

1. **Read first:** `AGENTS.md`, `docs/debug-loop/BUG_PROMPT.md` (Phase 2-4), your findings in the round 8 report files (each has Steps, Current, Expected, Proof, Cause).
2. **Code graph:** `graphify query "<question>"` before your first grep or source read; read only the lines it points to.
3. **Your own git worktree and branch** (`fix/r8-<theme>`), cut from the latest `origin/redesigned-2.0`. Never edit, checkout or stash in the shared folder `C:\complete taskdrop\Taskdrop user` (or `...\Taskdrop administrator`). Run `npm ci` in your worktree once.
4. **Check before fixing:** confirm the finding still holds in the current code. Already fixed, not a bug, or a duplicate: skip it and say so in your report.
5. **One whole fix per finding** (fix path A), the smallest change that removes the cause. No new features, no redesigns (feature freeze): copy, states, guards, rules and validation only. Keep every existing feature. Tokens from `theme.ts`, never raw hex. Plain-language errors through `lib/errors.ts`.
6. **The app asks, the server decides.** A rule the server does not enforce is fixed on the server (api Edge Function, RPC or RLS), with the client rule kept for a quick message.
7. **Migrations only add** (never drop or rename a table, column or function the old app uses; changing a function body or a policy is fine). Use only the migration numbers given in your assignment, file name `supabase/migrations/20261117<HHMMSS>_<NNN>_<name>.sql`. Add a SQL test in `supabase/tests/` and list it in `test:db` in the root `package.json` when you change a rule. Merging to `redesigned-2.0` applies migrations and deploys the Edge Functions to staging by itself (Vercel build), so the SQL must be safe to run once on the live staging database and idempotent where it can be.
8. **Tests:** add or extend a unit test for every logic fix you can test (list new test files in the root `test` script). `npm run check` must pass in your worktree before you push.
9. **Security pass before merging:** read your own diff for security (no rule loosened, no secret, phone or email logged, least access kept) and write what you found in the PR body.
10. **Ship:** commit (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` or `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, your model), `git fetch origin && git rebase origin/redesigned-2.0` (fix conflicts, keep both sides' intent, rerun `npm run check`), push, `gh pr create --base redesigned-2.0` (body: finding ids fixed / skipped and why, security pass, ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), then `gh pr merge <N> --merge --delete-branch`. If the merge is refused because the branch is behind, rebase again and retry. Do not touch `main`. No OTA, no EAS build, no reseed, no key changes.
11. **Never** print, log or commit a secret, token, password, real phone number or email.

## Your final message (the controller writes the ledger from it)

A table: finding id | result (Fixed / Skipped: already fixed / Skipped: not a bug / Skipped: needs owner / Not done) | one line on the fix or the reason | file(s). Then the PR number and whether `npm run check` passed. Keep it short.
