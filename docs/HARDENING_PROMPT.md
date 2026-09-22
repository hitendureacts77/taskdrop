# TaskDrop — Production Hardening

This is the plan of record for taking TaskDrop from "works" to "safe to hold
strangers' money". Findings were verified against the live database
(`wjxvingpfbfvkfqhrguj`) on 2026-09-21, not inferred from the source tree.

## Status — 2026-09-21

**All three P0s are shipped**, in migration `20260921180000_047_lock_down_rpc_surface.sql`,
applied to production and proved by `supabase/tests/rpc_surface.test.sql`.
Supabase security advisors now report **zero ERROR-level lints**.

| Item | State |
|---|---|
| Unguarded `settle_cleared_earnings()` | Split. `settle_my_cleared_earnings()` is caller-scoped and granted; the unscoped sweep is revoked and cron-only |
| `sponsored_tasks` SECURITY DEFINER view | Dropped. It went dead when the feed moved to `ad_auction()`; nothing depended on it |
| No default-deny on the RPC surface | Done. `EXECUTE` revoked from `public`/`anon`/`authenticated` schema-wide, granted back to a 28-function traced allowlist. `anon` now holds nothing |
| `settle_finished_campaigns()` | Found during the rebase — same unguarded shape, no caller. Not granted. **Needs scoping before it gets a client caller** |
| CI | `.github/workflows/ci.yml` written. **Inert — no git remote configured** |
| `test:db` | Now runs all 6 SQL suites; `funding_rules` and `withdrawal_rules` existed but were never being run |

Remaining: the P1 list below, minus OTP throttling (shipped separately in
`045_otp_send_throttling`), plus the readiness items. Leaked-password protection
and Razorpay KYC still need the account owner.

To hand the rest to an agent, paste everything below the line.

---

You are hardening **TaskDrop** for production. It is a live two-sided
marketplace holding real escrow. Treat every change as though funds are in
flight, because they are.

## Context

- One Expo/React Native codebase in `apps/mobile` serves Android **and** web via
  react-native-web. One change fixes both. Do not create a separate web app.
- `packages/rules` owns all money math and timing constants. Screens format,
  they never calculate.
- Supabase Postgres at migration 044. There is no server: the client calls
  `SECURITY DEFINER` RPCs directly through PostgREST. `apps/mobile/src/data/api.ts`
  is the entire data layer.
- Razorpay for pay-in. Payouts are manual via `scripts/payouts.mjs`.
- SQL tests in `supabase/tests/*.test.sql` drive real RPCs as several users
  inside a rolled-back transaction.

## Invariants — never break these

1. **Escrow conservation.** `worker_net + worker_commission == locked` and
   `poster_fee == escrow − locked`. Booked by an AFTER UPDATE trigger on
   `tasks.status` (migration 043), deliberately **not** inside `confirm_release`,
   because three functions can finish a task. Keep it that way.
2. **The poster never sees the commission.** No net-payout figure on Confirm or
   Active. Admin-only, in the gated part of AnalyticsScreen. Product decision.
3. **Integer paise only.** Never floats.
4. **No invented data.** If a feature has no backend, the UI says so.

## P0 — the three real problems, and the decided fix for each

### 1. `settle_cleared_earnings()` is unguarded and world-callable

`SECURITY DEFINER`, `authenticated` holds `EXECUTE`, and the body has **no
`auth.uid()` and no `is_admin()` check** — the only such function in the schema.
Any signed-in user can `POST /rest/v1/rpc/settle_cleared_earnings` and drive a
global, row-locking write across every user's tasks.

Be accurate about severity: the sweep is idempotent (`tasks.cleared_at` + row
lock) and settles only genuinely elapsed clearing periods. This is **not** fund
theft or early release. It is unbounded write amplification from one cheap REST
call, plus a caller mutating strangers' rows.

**Do not just revoke it** — WalletScreen and WithdrawScreen call it on purpose
(migration 041), so revoking blanks real balances. Split it:

- `public.settle_my_cleared_earnings()` — identical logic, restricted to tasks
  whose **most recent** assignment is `auth.uid()`. Resolve the worker exactly
  the way the global sweep does (latest `assignments.created_at`), or a worker
  with an older assignment on a reassigned task settles someone else's money.
- `public.settle_cleared_earnings()` — keep for the 02:00 pg_cron job, revoked
  from `authenticated`. Cron runs as the scheduling role and is unaffected.
- Point the client at the scoped one.

### 2. `public.sponsored_tasks` is a `SECURITY DEFINER` view (ERROR lint)

**The documented remediation is wrong here.** `task_promotions` RLS is
own-rows-only (`user_id = auth.uid()`), so setting `security_invoker = true`
would leave every user seeing only their own campaigns and silently kill
sponsored ranking for everyone else. Adding a blanket read policy on
`task_promotions` instead would expose who paid how much — a commercial leak.

Convert it to a narrow `SECURITY DEFINER` **function**,
`public.sponsored_task_budgets()`, returning the same three aggregate columns
the view already returned (`task_id`, `daily_budget_minor`, `ends_at`) and drop
the view. Clears the ERROR, preserves ranking, adds no exposure. It will trip
the function-level WARN instead; that is intentional and gets a comment saying
so.

### 3. No default-deny on the RPC surface

All 44 migrations contain **zero `REVOKE` statements**, so Postgres' default
`EXECUTE` to `PUBLIC` stands and 24 `SECURITY DEFINER` functions are reachable
by any signed-in user. Most defend themselves (`auth.uid()` ownership or
`private.is_admin()`), so this is mostly latent rather than 24 holes — **audit,
do not mass-revoke blindly.**

Revoke `EXECUTE` from `public`, `anon` and `authenticated` across schema
`public`, then grant back exactly this allowlist, which was derived by tracing
every caller:

- **Client** (`api.ts`): `activate_promotion`, `cancel_promotion`, `cancel_task`,
  `cancel_withdrawal`, `confirm_release`, `lock_bid`, `mark_work_done`,
  `my_stats`, `open_dispute`, `platform_stats`, `request_revision`,
  `request_withdrawal`, `set_default_payout_destination`, `start_promotion`,
  `start_task`, `submit_review`, plus the two new functions.
- **Edge function calling as the user**: `escrow_refund_due`.
- **Admin-guarded, called as an admin user** (AnalyticsScreen, `payouts.mjs`):
  `admin_payout_queue`, `admin_mark_payout`, `admin_resolve_dispute`,
  `admin_set_admin`, `platform_earnings`.
- **Service-role only — grant to nobody**: `settle_cleared_earnings`,
  `fund_task_from_payment`, `record_escrow_refund`, `set_app_secret`,
  `app_secrets`, `handle_new_user`.

`fund_task` has no remaining caller (the Razorpay function uses
`fund_task_from_payment`) but is poster-guarded. Keep its grant for now rather
than risk a payment path you cannot see; flag it for removal.

## P1

- **OTP attempt counter resets on resend.** `phone-auth` caps verification at
  `MAX_ATTEMPTS = 5`, but the resend path upserts `attempts: 0`, so alternating
  resend-and-guess never exhausts the cap. There is also no send-side rate
  limit, which is an SMS cost and abuse vector.
- **`auth_codes` has RLS on with zero policies** — an implicit deny-all that is
  almost certainly intentional. Make it explicit so nobody later "helpfully"
  adds a policy.
- **Leaked-password protection is off.** Dashboard toggle; account owner only.
- **10 moderate npm advisories.** No `--force` into a breaking Expo major.

## Do not regress

The Razorpay webhook verifies HMAC-SHA256 over the **raw** body with a
constant-time compare and 401s on mismatch. That is correct. Keep all three
properties if you touch it.

## Production readiness

- **No CI exists.** `.github/workflows/` is absent, so `npm run check` and
  `npm run test:db` are enforced by memory alone. This is the highest-leverage
  item here — the P0 fixes need something keeping them fixed.
- **`scripts/payouts.mjs` is untracked.** Money-handling code outside version
  control. Commit it.
- **`.agents/` is untracked and unignored** and will be swept in by `git add -A`.
- Razorpay is on a test key with an unactivated account, so UPI is unavailable.
  That is a KYC blocker, not a code change — do not work around it in code.
- Photo proof needs a storage bucket; Promote and Pro have no backend.

## Rules of engagement

- **Migrations are append-only.** Never edit an applied migration. Add `045_`,
  `046_` with the existing timestamp-prefix convention.
- **Prove it against the live database in a rolled-back transaction** before
  claiming it works, the way `money_rules.test.sql` does. Leave no rows behind.
- **Every P0 ships with a test that fails before and passes after.**
- **Run the Supabase security advisor before and after.** Target: zero ERROR;
  every surviving WARN either fixed or explained in a comment.
- Do not touch screen layout. The screens are an exact port of
  `docs/design/_design_markup.html` and parity was expensive.
- Anything a user can see changing: say so before shipping.

## Order

P0, then CI so the fixes stay fixed, then P1, then readiness. Do not start
readiness while a P0 is open.

## Done means

- Zero ERROR-level security lints.
- `npm run check` and `npm run test:db` green, with new tests covering each P0.
- CI green on every push.
- `npm audit` clean at moderate and above.
- A written summary of what changed, what was deliberately left, and what needs
  the account owner (KYC, dashboard toggles, secrets).

## Out of scope

No refactoring for taste, no monorepo restructuring, no library swaps, no
backend server. If you think one is required, stop and make the case.
