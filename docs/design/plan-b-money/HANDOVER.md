# Plan B money flow: handover (task 2.21)

Last updated 21 Nov 2026. **21 Nov:** PRs 428 and admin 66 were closed in the move to `main`; the code is back on `main` as PR 455 and admin PR 69, migration renumbered 195. Steps A1, A3 and A5 below now refer to those PRs, and "merge into redesigned-2.0" means: merge into `main`, then sync `redesigned-2.0` from `main` (Vercel builds `redesigned-2.0` and that build applies migrations and deploys the Edge Functions). Read this first when you pick Plan B up again. The design itself is in [DESIGN.md](DESIGN.md); this file says what is built, what is left and how to finish it.

**To start again, say:** "continue Plan B from the handover" (Claude reads this file, then works through "What is left" in order).

---

## Where it stands, in one look

| Piece | State |
|---|---|
| Design | Done 18 Nov ([DESIGN.md](DESIGN.md)). Razorpay Route only since 19 Nov (decision 3); Cashfree removed everywhere |
| User app + server code | Built, in PR [hitendureacts77/taskdrop#428](https://github.com/hitendureacts77/taskdrop/pull/428), branch `feat/plan-b-money`, worktree `C:\complete taskdrop\wt-plan-b`. **Not merged** |
| Admin app code | Built, in PR [hitendureacts77/taskdrop-admin#66](https://github.com/hitendureacts77/taskdrop-admin/pull/66), branch `feat/plan-b-money-admin`, worktree `C:\complete taskdrop\wt-admin-plan-b`. **Not merged**; it needs #428 first (it calls the new database functions) |
| Database change | Migration 195 (`supabase/migrations/20261121120000_195_plan_b_money.sql`). **Not applied anywhere yet.** Merging #428 into `redesigned-2.0` applies it to staging by itself |
| Tests | `npm run check` passes locally (637 + 202 tests). The SQL test `supabase/tests/plan_b_money.test.sql` runs only in CI (no local Postgres); its first run failed on one line, fixed 19 Nov, waiting for the next CI run |
| Staging behaviour after merge | Nothing changes for users: the `money_flow` setting stays `wallet` until you switch it |
| Real money | Waits for Razorpay's written answer (S.4), the lawyer's yes (S.3) and Razorpay test keys |
| Seen on a screen | **Web: yes (21 Nov).** The walk-through `e2e/planB.spec.ts` passed on the web build against staging with the simulated provider (PR 459). Not yet on an Android phone |

---

## What is left, in order

### A. Claude can do these (no owner input needed)

1. **Get CI green on #428.**
   - Check: `gh pr checks 428`.
   - The "money and access rules" job (the SQL tests) failed on 19 Nov with `permission denied for table task_holds`. The cause was the test reading `task_holds` while acting as a normal user, near the "wallet flow must not open a hold" check. Fixed by switching to the operator first. If it fails again, read `gh run view <run> --log-failed`, then fix the migration or the test. The test file stops at the first failing `assert` and prints its message.
   - "Semgrep code scan" crashed inside the tool (Python 3.14), not on our code. It was fixed on `redesigned-2.0` by PR 429, and that fix was merged into this branch on 19 Nov.
   - "Edge Functions type-check" passes since commit c188858.
2. **Run the security review once more** (the `security-review` skill) on the final diff, and fix any Critical or High finding. The last review's four findings are all fixed (see "Fixed in review" below).
3. **Merge #428:** `gh pr merge 428 --merge --delete-branch`. That applies migration 195 to staging. If it ever has to be taken out, the undo is in [undo_195.sql](undo_195.sql).
4. **Deploy the new Edge Functions to staging:** `money`, `money-webhook` and the changed `inngest`, `razorpay` and `api`. Check how earlier merges deployed them (some deploy on merge, some by hand) before doing it.
5. **Merge the admin PR #66** into the admin's `redesigned-2.0`: `gh pr merge 66 -R hitendureacts77/taskdrop-admin --merge --delete-branch`. Its Semgrep failure is the same tool crash. Port the PR 429 workflow fix to the admin repo first if it still fails there.
6. **DONE on web 21 Nov (PR 459); Android still to do.** Results: Get paid, hire, pay, hold, approve, release; cancel before start (full refund); cancel after start (5% to the worker); disputes both ways (admin RPC, by SQL); Money stop refuses releases (rolled-back test). Two fixes came out of it: a waiting release or refund now runs when either person opens the task, and approving or cancelling runs it even before the app has read the money flow. Found: Inngest has barely run on staging since 20 Nov ~17:00 UTC (probably the Hobby run quota; owner to check the Inngest dashboard), so anything only Inngest moves waits. Staging is back on `wallet`. Original step: **Look at it on staging with the simulated provider.** Use the web build on localhost (`feedback-test-branch-on-localhost`), then Android.
   - Switch staging to Plan B: as admin, set `money_flow` = `plan_b` and `money_provider` = `simulated`.
   - Run the whole job with two test accounts: the worker adds "Get paid" details; the poster hires, pays on the test sheet, approves; the worker's Money screen shows the release.
   - Then: cancel before start (full refund), cancel after start (5% to the worker), dispute both ways, and the emergency stop on and off from the admin page `/money/plan-b`.
   - Switch `money_flow` back to `wallet` afterwards unless you say to keep it on.
7. Run `graphify update .` after the merge, and update the memory note `planb-payment-pay-per-task.md`.

### B. Only the owner can do these

| # | What | Why it blocks |
|---|---|---|
| S.4 | Get Razorpay's **written** answer: can a new TaskDrop use Route? Its documented rule needs more than ₹40 lakh domestic turnover. Also ask whether they will hold the money until the poster approves | No Route, no Plan B on Razorpay. If the answer is no, decision 3 has to be opened again |
| S.3 | The lawyer's written yes on Plan B | Needed before any real money |
| keys | Create Razorpay **test** keys with Route turned on. Put `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in `.env.all-secrets` and the staging function secrets, never in chat or code. Point a Razorpay test webhook at the `money-webhook` function (events: `payment.captured`, `order.paid`, `account.*`, `transfer.failed`, `refund.failed`) | The simulated provider is the only one that runs until then |
| switch | Say when to switch staging to `plan_b` for everyone | Staging stays on the wallet until you say |

After the keys: Claude sets `money_provider` = `razorpay_route` on staging, reruns step A6 with Razorpay test money, and checks the nightly money match (`moneyMatch`, 02:30 IST). Live keys come only in Step 6 (task 6.1).

---

## What was built (so nobody rebuilds it)

**Database: migration 195**
- New settings:
  - `money_flow`: `wallet` (default) or `plan_b`.
  - `money_provider`: `razorpay_route` or `simulated`.
  - `money_paused`: the emergency stop; refunds still run while it is on.
  - `plan_b_unpaid_hours` = 24.
- New tables:
  - `payout_accounts`: the worker's payee. The provider account id is not readable by the app.
  - `task_holds`: one per hire. States: `awaiting_payment`, `held`, `release_asked`, `released`, `refund_asked`, `refunded`, `split_asked`, `split`, `expired` and `failed`.
  - `money_ledger`: append-only by trigger, with a unique `idem_key`. It closes H34.
  - `money_match_runs` and `money_webhook_events`: the latter dedupes webhooks.
- Rewritten, with a Plan B branch beside the wallet path: `lock_bid`, `auto_accept_bid`, `pay_task_from_wallet`, `credit_topup`, `confirm_release`, `auto_complete_due`, `cancel_task`, `admin_resolve_dispute` and `admin_cancel_task_with_refund`. New hires follow the setting; existing tasks follow whether they have a hold. Plan B completions stamp `cleared_at`, so the old sweep never pays twice.
- Server-only functions:
  - Checkout and payment: `plan_b_checkout_terms`, `plan_b_set_order`, `plan_b_mark_paid` (a late payment for an ended hire goes straight to refund).
  - Money moves: `plan_b_claim_move`, `plan_b_record_move`, `plan_b_moves_due`, `plan_b_expire_unpaid`.
  - Payees: `plan_b_save_payee`, `plan_b_payee_status`.
  - Webhooks, the nightly match and config: `plan_b_first_webhook`, `record_money_match`, `plan_b_config`.
- App reads: `my_money_mode`, `my_task_hold`, `my_money_ledger`.
- Admin: `admin_set_money_paused` (full admin with the authenticator only), `admin_plan_b_overview`, `admin_plan_b_retry_move`.

**Every money move:** claim it in the database, make one call to Razorpay, then record the answer. Each move has its own key (`release:<id>`, `fine:<id>`, `refund:<id>`). If Razorpay's answer is unknown (a timeout or 5xx), nothing is recorded; the claim runs out after 10 minutes and the same key is sent again.

**Amounts** (`planBSplit` in `packages/rules`):
- charged = offer × 1.03
- commission = offer × the commission % setting
- worker share = offer − commission
- late-cancel fine = offer × 5%

**Edge Functions**
- `supabase/functions/_shared/money/`: the provider interface, the Razorpay Route adapter, the staging-only simulated provider (it needs both `environment = staging` and a staging address), the move runner and payee checks. 11 tests.
- `supabase/functions/money/`: checkout, sync, payout-setup, payout-status and settle. Needs login.
- `supabase/functions/money-webhook/`: public. It checks the `X-Razorpay-Signature` before anything else.
- `supabase/functions/razorpay/`: the old Payment Link path refuses a task that has a Plan B hold.
- `supabase/functions/inngest/`: `moneyMoves` (hourly and on `taskdrop/money.move`) and `moneyMatch` (nightly). Alerts `money.mismatch` and `money.move_failed`.
- Registered in `supabase/config.toml`, `scripts/check-endpoints.mjs`, `scripts/check-gateway-only.mjs` and the CI type-check.

**App (Expo, web and Android)**
- Screens: the Money screen (a read-only record; the wallet body shows only under the wallet flow), the "Get paid" sheet, and Plan B checkout on the escrow screen (with the simulated test sheet on staging).
- Hold line on the task screens; Compare, Manage, Hunt, AI post and the header follow `useMoneyMode`.
- API reads `getMoneyMode`, `getTaskHold` and `getMoneyLedger` go through the gateway.

**Admin app (PR #66):** the `/money/plan-b` page shows holds, failed moves with retry, and the money stop (admin role, authenticator and a reason).

**Docs:**
- [DESIGN.md](DESIGN.md) and [undo_195.sql](undo_195.sql).
- `docs/integrations/razorpay-route.md`: the provider brief.
- AGENTS.md, `docs/KEY_SECURITY_PLAN.md` and ULTIMATE_PLAN task 2.21.

**Fixed in review (security review, 18–19 Nov):**
1. `cleared_at` was not stamped, so the old sweep could pay twice.
2. The admin cancel did not refund a hold.
3. The Payment Link path could bypass Plan B.
4. The simulated provider was not locked to the staging address.

The CI fixes were the Deno type error on the event hold id (c188858) and the SQL test permission line (19 Nov).

---

## Rules that still apply

- Never read, print or commit `.env` values. Razorpay secrets live only in `.env.all-secrets` and the server's secret stores, never in `EXPO_PUBLIC_*`, code, docs or chat.
- Never touch `main`. Work goes by pull request into `redesigned-2.0`. Pushing, opening a PR and merging need no extra ask. Ask before a wipe, key rotation (never rotate), OTA publish or anything in production.
- Run `npm run check` and `npm run test:db` (the money tests) before calling it done, and the security review before every merge.
- Model split: Opus 5.5 for money logic and reviews, Sonnet 5.5 for routine screen work and checks.
