# Wallet ledger design (security finding H34)

Written 6 Nov 2026. **This is a plan; nothing here is built.** Another session implements it, one pull request at a time, after the owner says **"start H34"**.

**Plain words first.** Today every wallet is a set of running numbers (`wallets.balance_minor`, `clearing_minor`, `credits_minor`) that about twenty database functions change in place. Nothing records *why* a number changed, so nobody can prove the books balance, and a wrong change (like the checks that migration 071 silently dropped) leaves no trace. The fix: an **add-only list of money movements**, `wallet_movements`. Every function that moves money also writes the movement, in the same transaction. A nightly check then proves two things: each wallet's number equals the sum of its movements, and across the whole platform *money in = money out + money held + TaskDrop's fees*. Rows can never be changed or deleted.

Sources read: `AGENTS.md`; `docs/handover-2026-11-05/HANDOVER_SECURITY.md` (3b, H34); `docs/handover-2026-11-05/hunt2-DE-task-life.md`; all 161 files in `supabase/migrations` (latest definition of each function = the last file, in filename order, that redefines it); `supabase/functions/{razorpay,razorpay-webhook,api,inngest,_shared/razorpayx.ts}`; `supabase/seed/*`; `supabase/tests/*`; `scripts/check-lost-refusals.mjs`, `scripts/reset-test-data.mjs`; the admin repo's `src/lib` (it only reads wallets and calls the RPCs listed below).

---

## 0. Things found while taking the inventory (fix or decide; see section 7)

| # | Finding | Evidence | Effect today |
|---|---|---|---|
| F1 | **A rewrite silently dropped a money branch, the 071 pattern again.** `20260929150000_066_razorpayx_hardening.sql` gave `private.refund_wallet_on_cancel()` a branch that moves a card payment to the poster's wallet when a helper walks off a card-paid job (`perform private.move_card_payment_to_wallet(...)`). About an hour and a half later `20260929163637_066_single_wallet_pool.sql` rewrote the same trigger from an older copy **without that branch**; 079 and 128 kept the loss. `private.move_card_payment_to_wallet` has had **no caller since**. `check-lost-refusals.mjs` cannot see this: no `raise exception` was lost, a behaviour was. | grep `move_card_payment_to_wallet(` in migrations: only callers are in 066_razorpayx_hardening | This is the root cause of H53 (card money stays on the reopened job). Migration 148 contained it with a refusal ("That quote is higher than what you paid..."). The ledger will make this class of loss visible (section 4), and section 6 adds a guard that catches lost behaviour, not just lost refusals. |
| F2 | The orphan `move_card_payment_to_wallet` (latest: 128) credits **`credits_minor`**, a column that is dead since 066 (always 0, never spendable: `fund_task_from_wallet` reads only `balance_minor`). | 128, line ~371 | If anyone re-wires it, money lands where it cannot be spent or withdrawn. |
| F3 | `private.book_revenue_on_completion()` (043) books commission as `locked - round(locked * (1 - pct))` **without** `private.cap_worker_net` (added in 148). When the cap applies (paid in less than needed), TaskDrop books revenue that was never held. | 043 vs 148 | Rare after 148, but the platform total can exceed the money behind it. |
| F4 | `settle_cleared_earnings` / `settle_my_cleared_earnings` (066) recompute the worker's net with **today's** commission setting and without the cap, then move `least(net, clearing)`. If the commission changes between release and clearing, or the cap applied, the wrong amount leaves clearing for that job (money from another job's clearing, or a remainder stuck forever). | 066 vs `confirm_release` (148) | Small, silent drift between jobs. The ledger records each job's real net, so clearing can move exactly that (decision D3). |
| F5 | `confirm_release` and `private.auto_complete_due` (148) `update wallets ... where user_id = worker` without first making sure the row exists (`admin_resolve_dispute` does `insert ... on conflict do nothing`). If the wallet row were missing, the job completes and the worker is paid nothing, silently. | 148 | Low (sign-up always makes a wallet), but silent. |
| F6 | `private.settle_campaign` (046) refunds unspent promotion budget only `if found` (wallet row exists); otherwise the campaign is marked settled and the refund vanishes. | 046 | Same as F5. |
| F7 | `public.fund_task(uuid, uuid)` (027) is still executable by every signed-in person. It marks a card-paid job funded without setting `funded_via` / `funded_minor`. 047 lists it as "candidate for removal once confirmed dead"; no code calls it. | 027, 047 line ~145 | A second door to the same state as `fund_task_from_payment`. |
| F8 | When Razorpay accepted a refund but `record_escrow_refund` failed, `supabase/functions/razorpay/index.ts` (~line 495) writes `payments.refund_claimed_at = 'infinity'` directly: money left, no database record of the amount. | razorpay/index.ts | A person must reconcile by hand; the ledger check will list these as "refund owed" until recorded. |

None of F1-F8 is fixed by this plan automatically; the rollout records today's behaviour truthfully first, then offers small, separate fixes (section 6, PR 11+).

---

## 1. Inventory: everything that moves money or changes a balance

### 1a. Where money lives today

| Holder | Columns / rows | Notes |
|---|---|---|
| Wallet, spendable and withdrawable | `wallets.balance_minor` | One pool since 066 (top-ups, earnings, refunds). Can be negative in theory (087 mentions "below zero"). |
| Wallet, earnings waiting to clear | `wallets.clearing_minor` | Moved to `balance_minor` after `clearing_period_days`. |
| Wallet, old credits | `wallets.credits_minor` | Dead since 066, must stay 0. Only the orphan F2 writes it. |
| Money held for a job | `tasks.funded_at`, `funded_via` ('wallet' / 'payment' / null), `funded_minor`, `funded_credits_minor` (always 0), `funding_payment_id`, `wallet_refunded_at`; the amount held is `private.task_paid_in_minor(task)` (148) | Wallet-paid: `funded_minor` until refunded. Card-paid: `payments.amount_minor - refunded_minor`. |
| What a hire costs | `assignments.escrow_minor` (offer + 3% fee); `tasks.locked_minor` (offer) | Inputs, not balances. |
| Money from outside | `payments` (purpose `escrow` / `topup` / `promotion`; `status`, `amount_minor`, `refunded_minor`, `credited_at`, `wallet_credited_minor`, `wallet_credited_at`, `refund_claimed_at`) | Rows created by the `razorpay` edge function, marked paid by `razorpay` / `razorpay-webhook`. |
| Money going out to banks | `payouts` (`status` requested / processing / paid / failed / cancelled, `amount_minor`, `via` manual / razorpayx) | |
| Promotion budgets | `task_promotions` (`amount_minor`, `payment_id`, `settled_at`); spend in `ad_events.cost_minor` | |
| TaskDrop's earnings | `platform_ledger` (kinds `worker_commission`, `poster_fee`, `ad_revenue`, `adjustment`; unique per task+kind for the first two) | Add-only by convention (no write grants), not by trigger. |
| Hand corrections | `wallet_adjustments` | Only `settle_campaign` writes it. No admin "adjust wallet" function exists (admin repo only reads it). |
| Card refunds owed | view `refunds_outstanding` (033/036) | Cancelled card-paid jobs not yet refunded. |

### 1b. Functions that change a balance or a money record (latest definitions)

"Latest" = the last migration, in filename order, that runs `create or replace function` for it. Re-check this at implementation time (section 6, rule R1): another PR may have redefined a function since 6 Nov.

| Function | Latest definition | Called by | What it moves | Columns / rows it touches |
|---|---|---|---|---|
| `private.fund_task_from_wallet(task)` | `20261104200000_148_hunt2_money_guards` | `lock_bid` (148), `private.auto_accept_bid` (148), `pay_task_from_wallet` (063) | Poster wallet → job (full escrow, or the difference after a dearer re-hire) | `wallets.balance_minor` −; `tasks.funded_at/via/minor/credits_minor/wallet_refunded_at` |
| `public.fund_task_from_payment(payment)` | `20260929150000_066_razorpayx_hardening` | `razorpay` and `razorpay-webhook` edge functions (service role) | Card payment → job | `tasks.funded_at/via/funding_payment_id` |
| `public.fund_task(task, payment)` | `20260914200000_027_task_funding` | nobody (F7); executable by `authenticated` | Card payment → job (legacy) | `tasks.funded_at/funding_payment_id` |
| `private.refund_wallet_on_cancel()` (trigger `trg_refund_wallet_on_cancel`, after insert on `cancellations_log`) | `20261031150000_128_plain_notification_wording` | every `cancellations_log` insert: `cancel_task`, `admin_resolve_dispute` (poster wins), `admin_cancel_task_with_refund` | Job → poster wallet (escrow less the fine). Card-paid jobs: nothing (F1) | `wallets.balance_minor` +; `tasks.funded_*` cleared (OPEN) or `wallet_refunded_at` set |
| `private.move_card_payment_to_wallet(task)` | `20261031150000_128_plain_notification_wording` | **nobody since 066_single_wallet_pool** (F1) | Card money on a reopened job → poster | `wallets.credits_minor` + (F2); `payments.wallet_credited_*`; `tasks.funded_*` cleared |
| `public.cancel_task(task, reason)` | `20261031150000_128_plain_notification_wording` | `api` | Poster cancels after start: 5% fine from the job → helper's wallet (refund itself via the trigger above) | `wallets.balance_minor` + (helper); `assignments`, `bids`, `tasks`, `cancellations_log` |
| `public.confirm_release(task)` | `20261104200000_148_hunt2_money_guards` | `api` (poster) | Job → helper's clearing (net after commission, capped by what was paid) | `wallets.clearing_minor` +; `assignments.status`; `tasks.status/completed_at/clear_at` (fires revenue trigger) |
| `private.auto_complete_due()` | `20261104200000_148_hunt2_money_guards` | pg_cron `auto-complete-due` (057); `public.run_auto_complete_due` (090, Inngest sweep when `INNGEST_MONEY_JOBS=on`) | Same as `confirm_release`, after the review window | same |
| `public.admin_resolve_dispute(task, outcome, note)` | `20261104200000_148_hunt2_money_guards` | admin app (`src/lib/actions.ts`) | Worker wins: job → helper clearing, or straight to balance when `clearing_period_days <= 0`. Poster wins: via `cancellations_log` trigger | `wallets.clearing_minor` or `balance_minor` +; `dispute_decisions`; `cancellations_log` |
| `private.book_platform_revenue(task, locked, net, escrow)` via trigger `tasks_book_platform_revenue` → `private.book_revenue_on_completion()` | both `20260921120000_043_platform_commission_ledger` | any status change into COMPLETED / AUTO_COMPLETED | Job → TaskDrop (commission and poster fee) | `platform_ledger` insert (on conflict do nothing) |
| `public.settle_cleared_earnings()` | `20260929150000_066_razorpayx_hardening` | pg_cron `settle-cleared-often` (063) and nightly (041); Inngest sweep when on | Helper clearing → balance, per job whose `clear_at` passed | `wallets.clearing_minor` −, `balance_minor` +; `tasks.cleared_at` |
| `public.settle_my_cleared_earnings()` | `20260929150000_066_razorpayx_hardening` | `api` (the helper themselves) | same, for the caller only | same |
| `public.request_withdrawal(amount, dest, dest_id)` | `20261104090200_145_withdrawal_checks_restored` | `api` `writes.ts` | Wallet → withdrawal on its way | `wallets.balance_minor` −; `payouts` insert |
| `public.cancel_withdrawal(payout)` | `20260914150100_019_cancel_withdrawal` | `api` | Withdrawal → back to wallet | `payouts.status`; `wallets.balance_minor` + |
| `public.admin_mark_payout(payout, status, note)` | `20261031150000_128_plain_notification_wording` | admin app, `scripts/payouts.mjs` | `paid`: money left by hand; `failed`: back to wallet | `payouts.*`; `wallets.balance_minor` + on failed |
| `public.fail_unsent_payout(payout, note, attempts, quiet)` | `20261031150000_128_plain_notification_wording` | `_shared/razorpayx.ts` | Never sent → back to wallet | `payouts.status`; `wallets.balance_minor` + |
| `public.record_payout_status(payout, provider_id, status, ...)` | `20261031150000_128_plain_notification_wording` | `_shared/razorpayx.ts` | `processed` → money left; failed/rejected/cancelled while open → back to wallet; `reversed` after paid → back to wallet (bank returned it) | `payouts.*`; `wallets.balance_minor` + |
| `public.credit_topup(payment)` | `20260929163637_066_single_wallet_pool` | `razorpay`, `razorpay-webhook` | Card top-up → wallet | `wallets.balance_minor` +; `payments.credited_at` |
| `public.record_escrow_refund(payment, ref, amount)` | `20260916092000_035_fix_is_admin_signature_in_refunds` | `razorpay` edge function after Razorpay accepts a refund | Card refund sent back to the payer | `payments.refunded_minor/refund_ref/refunded_at` |
| `public.activate_promotion(promo, payment)` | `20261021100100_111_activate_promotion_checks` | `api` `activatePromotion` | Card payment → promotion budget | `payments.credited_at`; `task_promotions.status/payment_id/...` |
| `private.settle_campaign(promo)` | `20260921120400_046_refund_unspent_campaign_budget` | `cancel_promotion` (046), `admin_pause_promotion` (098), `admin_cancel_task_with_refund` (128), `settle_finished_campaigns` (046; pg_cron `settle-finished-campaigns`, Inngest sweep when on) | Unspent budget → wallet; spent → TaskDrop | `wallets.balance_minor` +; `wallet_adjustments` insert; `platform_ledger` (`ad_revenue`); `task_promotions.settled_at` |

### 1c. Money-related functions that change no balance (no ledger row needed, listed so nobody wonders)

| Function | Latest | Why no movement |
|---|---|---|
| `lock_bid`, `private.auto_accept_bid`, `pay_task_from_wallet` | 148, 148, 063 | Only call `fund_task_from_wallet` (which records). |
| `admin_cancel_task_with_refund` | 128 | Money moves inside the `cancellations_log` trigger and `settle_campaign`. |
| `cancel_promotion`, `admin_pause_promotion`, `settle_finished_campaigns`, `start_promotion` | 046, 098, 046, 114 | Status changes; money moves in `settle_campaign` / `activate_promotion`. |
| `claim_escrow_refund`, `release_escrow_refund_claim`, `escrow_refund_due` | 066, 066, 106 | Claim flags and a read. |
| `claim_payout_for_sending`, `record_payout_sent`, `unclaim_payout`, `admin_set_payout_method` | 070, 070, 070, 100 | Status, attempts, `via`; amounts untouched. |
| `private.task_paid_in_minor`, `private.cap_worker_net`, `admin_money_position`, `private.reconcile_rows`, `run_reconciliation` | 148, 148, 099, 123, 097 | Reads. |
| `handle_new_user` | 115 | Creates a zero wallet. |
| `private.delete_account` | 108 | Refuses while any money is in the wallet, clearing, a withdrawal or a job (087 blockers). Keeps money rows. |

### 1d. Writers that are not database functions

| Writer | What | Plan |
|---|---|---|
| One-off data updates in migrations 031, 039, 064, 066_single_wallet_pool (credits merged into balance) | Historic | Covered by the opening balance (section 5). |
| `supabase/seed/test_data.sql` (sets the seed wallets), `demo_account.sql` (sets a wallet), `demo_account_remove.sql` (zeros it), `scripts/reset-test-data.mjs` (deletes the seed `auth.users`, which cascades) | Staging/CI only | Move to a staging-only helper (PR 6). |
| 34 SQL test files `update`/`insert` wallets directly (e.g. `money_rules`, `funding_rules`, `hunt2_money`, `withdrawal_rules`, `notification_wording`) | CI only | Move to the same helper (PR 6) before enforcement. |
| `razorpay` edge function: inserts `payments` rows, sets `refund_claimed_at = 'infinity'` (F8) | External facts | No wallet change; checked by the nightly job. |
| `phone-auth` deletes "squatter" auth users (`admin.auth.admin.deleteUser`) | Cascades to `wallets` | `wallet_movements.user_id` uses `on delete restrict`, so an account that ever moved money cannot be hard-deleted (matches 087's "money records are kept"). Squatters never have money; a test proves deletion still works for an empty account. |

---

## 2. The `wallet_movements` table

### 2a. Shape: transfers with two legs

Every money event is a **transfer** of a positive amount from one **pot** to another. A transfer is stored as **two rows (legs)** with the same `transfer_id`: the "from" leg is negative, the "to" leg positive, so every transfer sums to zero. A person's wallet history is simply their legs; the platform totals fall out of the zero sum.

**Pots** (`pot`, with `owner_id`):

| pot | owner_id | Mirrors | Expected sum |
|---|---|---|---|
| `balance` | user id | `wallets.balance_minor` | equal |
| `clearing` | user id | `wallets.clearing_minor` | equal |
| `credits` | user id | `wallets.credits_minor` | equal (and 0) |
| `escrow` | task id | money held for the job | `private.task_paid_in_minor(task)` while the job is open or funded; 0 once closed |
| `payout` | payout id | a withdrawal on its way | `amount_minor` while requested/processing; 0 after |
| `refund_due` | payment id | card refund owed | `refunds_outstanding.due_minor`; 0 once refunded |
| `promo` | promotion id | paid, unsettled promotion budget | `amount_minor` until settled; 0 after |
| `platform` | null | TaskDrop's earnings | `sum(platform_ledger.amount_minor)` |
| `outside` | null | Razorpay / banks (the world) | none: negative = money that came in |
| `opening` | null | opening balances at books-open (section 5) | none |
| `seed` | null | fake money given by seeds and tests (staging/CI only) | none |

### 2b. Columns

```text
public.wallet_movements
  id              bigint generated always as identity primary key
  transfer_id     uuid        not null            -- both legs of one transfer
  leg             smallint    not null            -- 1 = from (negative), 2 = to (positive)
  idem_key        text        not null            -- one per transfer, shared by its two legs
  kind            text        not null            -- see 2c
  pot             text        not null            -- see 2a
  owner_id        uuid                            -- per 2a; null for platform/outside/opening/seed
  user_id         uuid        references auth.users(id) on delete restrict
                                                  -- the person: wallet owner for balance/clearing/credits,
                                                  -- poster for escrow/refund_due/promo, payee for payout; null otherwise
  delta_minor     bigint      not null            -- signed paise
  task_id         uuid                            -- references kept as plain uuids (no FK) so a
  assignment_id   uuid                            -- deleted/cancelled row never blocks or cascades;
  payout_id       uuid                            -- the nightly check verifies them
  payment_id      uuid
  promotion_id    uuid
  cancellation_id uuid                            -- cancellations_log.id
  reverses_transfer_id uuid                       -- only for kind 'correction'
  actor_id        uuid                            -- auth.uid() at the time; null for jobs and webhooks
  source_fn       text        not null            -- e.g. 'confirm_release'
  note            text                            -- plain words, max 300 chars, never a phone/email/UPI id
  is_opening      boolean     not null default false
  created_at      timestamptz not null default now()

constraints
  unique (idem_key, leg)
  check (leg in (1, 2))
  check ((leg = 1 and delta_minor < 0) or (leg = 2 and delta_minor > 0))
  check (pot in ('balance','clearing','credits','escrow','payout','refund_due','promo','platform','outside','opening','seed'))
  check (kind in (... 2c ...))
  check ((pot in ('platform','outside','opening','seed')) = (owner_id is null))
  check (is_opening = (kind = 'opening_balance'))
  check (kind <> 'correction' or reverses_transfer_id is not null)

indexes
  (pot, owner_id) include (delta_minor)      -- per-pot sums (nightly check, wallet guard)
  (user_id, created_at desc)                 -- a person's history
  (task_id) where task_id is not null
  (payout_id) where payout_id is not null
  (payment_id) where payment_id is not null
  (transfer_id)
```

### 2c. Kinds (each kind allows exactly one from-pot → to-pot pair; `record_transfer` refuses any other pair)

| kind | from → to | Written by |
|---|---|---|
| `topup_in` | outside → balance | `credit_topup` |
| `card_escrow_in` | outside → escrow | `fund_task_from_payment`, `fund_task` |
| `promo_in` | outside → promo | `activate_promotion` |
| `escrow_from_wallet` | balance → escrow | `fund_task_from_wallet` |
| `escrow_refund_wallet` | escrow → balance | `refund_wallet_on_cancel` (wallet-paid) |
| `escrow_refund_card_due` | escrow → refund_due | `refund_wallet_on_cancel` (card-paid, new ledger-only branch) |
| `card_refund_sent` | refund_due → outside | `record_escrow_refund` |
| `card_walkoff_to_credits` | escrow → credits | `move_card_payment_to_wallet` (orphan, F1/F2) |
| `cancel_fine` | escrow → balance | `cancel_task` |
| `release_to_clearing` | escrow → clearing | `confirm_release`, `auto_complete_due`, `admin_resolve_dispute` |
| `release_to_balance` | escrow → balance | `admin_resolve_dispute` when clearing days ≤ 0 |
| `commission` | escrow → platform | `book_platform_revenue` |
| `poster_fee` | escrow → platform | `book_platform_revenue` |
| `clearing_cleared` | clearing → balance (or balance → clearing if the old formula moves a negative amount) | `settle_cleared_earnings`, `settle_my_cleared_earnings` |
| `withdrawal_hold` | balance → payout | `request_withdrawal` |
| `withdrawal_return` | payout → balance | `cancel_withdrawal`, `admin_mark_payout` (failed), `fail_unsent_payout`, `record_payout_status` (failed while open) |
| `withdrawal_paid` | payout → outside | `admin_mark_payout` (paid), `record_payout_status` (processed) |
| `withdrawal_reversed` | outside → balance | `record_payout_status` (reversed after paid) |
| `promo_refund` | promo → balance | `settle_campaign` |
| `ad_revenue` | promo → platform | `settle_campaign` |
| `opening_balance` | opening ↔ any per-owner pot or platform | books-open migration only (section 5) |
| `test_set` | seed ↔ balance / clearing | `private.test_set_wallet` (staging/CI only) |
| `correction` | any → any, with `reverses_transfer_id` and a note | a migration or a future staff function; none is built now |

### 2d. Idempotency key

One key per real-world event, derived from the row that makes the event unique. Both legs share it; `unique (idem_key, leg)` makes a second identical move impossible.

| Event | Key |
|---|---|
| wallet funding (per hire, per amount already paid) | `fund:<assignment_id>:<paid_before>` |
| card funding / top-up / promotion payment | `payment:<payment_id>:escrow` / `:topup` / `:promotion` |
| card refund recorded | `payment:<payment_id>:refund:<refunded_minor after>` |
| cancellation refund to wallet / card refund owed | `cancel:<cancellations_log.id>:refund` / `:refund_due` |
| fine | `fine:<assignment_id>` |
| release (any of the three functions) | `release:<assignment_id>` |
| commission / poster fee | `revenue:<task_id>:worker_commission` / `:poster_fee` (same as `platform_ledger`'s unique index) |
| clearing | `clear:<task_id>` |
| withdrawal hold / return / paid / reversed | `payout:<payout_id>:hold` / `:return` / `:paid` / `:reversed` |
| promotion refund / spend | `promo:<promotion_id>:refund` / `:spent` |
| walk-off (orphan) | `payment:<payment_id>:walkoff` |
| opening balance | `opening:<pot>:<owner_id or 'all'>` |
| test/seed | `test:<user_id>:<pot>:<gen_random_uuid()>` |

The shared keys are a second guard on purpose: a withdrawal can be returned only once whichever of the four functions returns it, and paid only once whether by hand or by RazorpayX.

What happens on a repeated key: in modes `off`/`shadow`/`warn` (section 6) nothing is written, a row goes to `private.wallet_ledger_drift` (`problem = 'duplicate_key'`), and the money function carries on as today. In `enforce` mode `record_transfer` raises **"This money movement was already recorded"**, which rolls back the whole money function, wallet update included.

### 2e. The one writer: `private.record_transfer`

```text
private.record_transfer(
  p_key text, p_kind text,
  p_from_pot text, p_from_owner uuid,
  p_to_pot text,   p_to_owner uuid,
  p_amount bigint,
  p_refs jsonb default '{}'::jsonb,   -- task_id, assignment_id, payout_id, payment_id, promotion_id,
                                      -- cancellation_id, reverses_transfer_id, note, source_fn
  p_user_from uuid default null,      -- person for the from-leg when the pot is not a wallet pot
  p_user_to   uuid default null
) returns uuid                        -- transfer_id, or null when nothing was written
language plpgsql security definer set search_path = ''
```

- Reads the mode (`private.ledger_mode()`: `public.settings` key `wallet_ledger_mode`, text `off` / `shadow` / `warn` / `enforce`; missing = `off`). In `off` it returns null immediately: the writer PRs deploy dormant.
- `p_amount = 0`: returns null, writes nothing. `p_amount < 0` or null: a programming error; drift row in shadow/warn, raise in enforce.
- Checks the kind's allowed pot pair (2c) and the owner rules; for `balance`/`clearing`/`credits` sets `user_id` = owner. For `seed` and `test_set` it also requires `app_controls.environment = 'staging'` (row `'all'`, migration 127).
- Sets `set_config('taskdrop.ledger_write', <transfer_id>, true)`, inserts both legs in **one** `insert ... values (...), (...)`, then clears the setting.
- In `off`/`shadow`/`warn` the body runs inside `begin ... exception when others then` → one `private.wallet_ledger_drift` row (`problem = sqlerrm`, key, kind, amount) and return null. A bug in the ledger can never break a payment before `enforce`. In `enforce` there is no catch.
- `revoke all on function private.record_transfer(...) from public, anon, authenticated, service_role`. Only security-definer money functions (owned by `postgres`) reach it.

`private.wallet_ledger_drift` (private schema, staff read through a function only): `id, at, problem, idem_key, kind, amount_minor, user_id, pot, column_value, ledger_value, source_fn, txid`. It is the "something is off" inbox for shadow and warn modes; the nightly check alerts on any row from the last day.

### 2f. Who can read and write: RLS and triggers

- `alter table public.wallet_movements enable row level security;` then `revoke all on public.wallet_movements from public, anon, authenticated, service_role;` (Supabase grants new public tables to all three by default; revoke explicitly, as `platform_ledger` does).
- `grant select on public.wallet_movements to authenticated;` with two select policies: own rows (`user_id = (select auth.uid())`), and staff (`private.is_admin()`; money-blind staff are kept out by reading through an admin function that calls `private.assert_not_money_blind()`, as `admin_money_position` does). No insert/update/delete policy or grant for anyone. The open data door (H52) therefore cannot write here.
- **Insert guard** (`before insert for each row`): refuse unless `current_setting('taskdrop.ledger_write', true) = new.transfer_id::text`. Even a future security-definer function cannot insert a row without going through `record_transfer`.
- **Add-only** (`before update or delete for each row`): raise **"Money movements cannot be changed or deleted. Add a correction instead."** One narrow exception for staging resets: a delete is allowed only when `current_setting('taskdrop.ledger_forget', true) = 'on'`, `app_controls.environment = 'staging'`, and `old.user_id` (or the escrow task's poster) is one of the seed/demo accounts (`5eed0000-0000-4000-8000-00000000000{1,2,3,9}` and the demo account id from `private.demo_seed`). Only `private.ledger_forget_test_accounts(uuid[])` sets that flag (PR 6).
- **No truncate** (`before truncate for each statement`): always raise.
- Residual: someone with the database password can still `set session_replication_role = replica` (triggers off) or drop the trigger. Any change made that way breaks a sum, so the nightly check reports it. A hash chain over rows would detect it too; that is future scope, not part of this plan.

---

## 3. The exact change to each money function

Rules for every rewrite (they are what stops a silent loss):

- **R1.** Start from the **latest** definition (table 1b, re-checked with the same regex as `scripts/check-lost-refusals.mjs` on the day you start), copied verbatim. Two files are numbered 066; filename order is apply order (`..._066_razorpayx_hardening` then `..._066_single_wallet_pool`). Copying the earlier one is exactly how F1 happened.
- **R2.** Only **add** lines. The only allowed edits to existing lines are listed below per function (marked *edit*), and they go in the manifest of the new `scripts/check-ledger-additions.mjs` (section 6, PR 1).
- **R3.** Every call is `perform private.record_transfer(...)`, schema-qualified, placed **right after** the statement that changes the matching column, inside the same branch, so the movement exists exactly when the money moved.
- **R4.** Keep grants/revokes identical to the previous migration (re-issue them after `create or replace`).

Notation below: `T(key, kind, from_pot, from_owner → to_pot, to_owner, amount; refs)`.

### PR 2 (migration 159): job funding and cancelling

1. **`private.fund_task_from_wallet`** (from 148).
   *edit:* the assignment select also returns the id: `select a.id, a.escrow_minor into v_assign_id, v_escrow ...` (new variable `v_assign_id uuid`).
   After `update public.wallets set balance_minor = balance_minor - v_charge ...`:
   `T('fund:'||v_assign_id||':'||coalesce(v_paid,0), 'escrow_from_wallet', 'balance', v_task.poster_id → 'escrow', p_task_id, v_charge; task_id, assignment_id, source_fn)`.
2. **`public.fund_task_from_payment`** (from 066_razorpayx_hardening). After the final `update public.tasks set funded_at = now(), funded_via = 'payment' ...`:
   `T('payment:'||p_payment_id||':escrow', 'card_escrow_in', 'outside', null → 'escrow', v_task.id, v_payment.amount_minor - coalesce(v_payment.refunded_minor,0); payment_id, task_id, user_to = v_task.poster_id)`.
   (The full payment amount is what `task_paid_in_minor` counts, overpayment included.)
3. **`public.fund_task`** (from 027). Same transfer and same key as 2, after its `update public.tasks`. If the owner agrees to D7, this PR instead revokes its execute grant and leaves the body alone.
4. **`private.move_card_payment_to_wallet`** (from 128; orphan). After `update public.wallets set credits_minor = credits_minor + v_amount`:
   `T('payment:'||v_pay.id||':walkoff', 'card_walkoff_to_credits', 'escrow', v_task.id → 'credits', v_task.poster_id, v_amount; payment_id, task_id)`. Records today's behaviour; F1/F2 stay for decision D2.
5. **`private.refund_wallet_on_cancel`** (trigger, from 128).
   - *Add, at the top (after loading `v_task`), a ledger-only branch for card-paid jobs:* if `v_task.status = 'CANCELLED' and v_task.funded_at is not null and v_task.funded_via is distinct from 'wallet' and v_task.funding_payment_id is not null`, then `v_due := greatest(private.task_paid_in_minor(v_task.id) - coalesce(new.penalty_or_refund_minor,0), 0)` and
     `T('cancel:'||new.id||':refund_due', 'escrow_refund_card_due', 'escrow', v_task.id → 'refund_due', v_task.funding_payment_id, v_due; cancellation_id, task_id, payment_id, user_to = v_task.poster_id)`, then `return new` (same as the existing early return for card jobs). It changes no money column; it moves the job's held money into "refund owed" so the books match `refunds_outstanding`.
   - Wallet branch: after `update public.wallets set balance_minor = balance_minor + v_refund`:
     `T('cancel:'||new.id||':refund', 'escrow_refund_wallet', 'escrow', v_task.id → 'balance', v_task.poster_id, v_refund; cancellation_id, task_id)`.
   - A helper walking off (status OPEN) moves nothing, as today.
6. **`public.cancel_task`** (from 128). Inside `if v_fine > 0`, after the helper's wallet update:
   `T('fine:'||v_assign.id, 'cancel_fine', 'escrow', p_task_id → 'balance', v_assign.worker_id, v_fine; task_id, assignment_id)`.
   The fine is taken from the job's held money for both wallet- and card-paid jobs; the trigger then returns the rest (wallet) or records it as refund owed (card), so the job's pot ends at 0.

### PR 3 (migration 160): release, revenue, clearing

7. **`public.confirm_release`** (from 148).
   *edit:* `select id, worker_id, escrow_minor into v_assign_id, v_worker, v_escrow ...`.
   *add (F5, safe):* `insert into public.wallets (user_id) values (v_worker) on conflict (user_id) do nothing;` before the wallet update.
   After `update public.wallets set clearing_minor = clearing_minor + v_net`:
   `T('release:'||v_assign_id, 'release_to_clearing', 'escrow', p_task_id → 'clearing', v_worker, v_net; task_id, assignment_id)`.
8. **`private.auto_complete_due`** (from 148). Same *edit* (select `a.id`), same F5 insert, same transfer after its wallet update, `actor_id` null.
9. **`public.admin_resolve_dispute`** (from 148). Worker wins, after each wallet update:
   - `clearing_period_days <= 0`: `T('release:'||v_assign.id, 'release_to_balance', 'escrow', p_task_id → 'balance', v_assign.worker_id, v_net; ...)`
   - else: same key, `'release_to_clearing'`, to `'clearing'`.
   Poster wins: no change here (the trigger in 5 records it).
   Because all three release functions share `release:<assignment_id>`, a job can be paid out once only.
10. **`private.book_platform_revenue`** (from 043).
    *edit:* each `insert into public.platform_ledger ... on conflict do nothing` gains `returning id into v_row_id` (new variable), so the transfer is written only when the revenue row was really inserted:
    `if v_row_id is not null then T('revenue:'||p_task_id||':worker_commission', 'commission', 'escrow', p_task_id → 'platform', null, v_commission; task_id) end if;` and the same for `poster_fee` with `v_fee`.
    `book_revenue_on_completion` is unchanged (F3 stays for decision D4).
11. **`public.settle_cleared_earnings`** and **`public.settle_my_cleared_earnings`** (from 066_razorpayx_hardening).
    *edit (same arithmetic, made explicit):* replace the single `update public.wallets w set clearing = clearing - least(v_net, clearing), balance = balance + least(...)` with
    `select clearing_minor into v_have from public.wallets where user_id = <worker> for update; v_move := least(v_net, coalesce(v_have, 0));`
    `update public.wallets set clearing_minor = clearing_minor - v_move, balance_minor = balance_minor + v_move where user_id = <worker>;`
    then `if v_move > 0: T('clear:'||v_task.id, 'clearing_cleared', 'clearing', <worker> → 'balance', <worker>, v_move; task_id)`; `if v_move < 0`: same key and kind, pots reversed, amount `-v_move` (records today's odd behaviour truthfully). The sweep behaviour is unchanged; F4 is decision D3.

### PR 4 (migration 161): withdrawals

12. **`public.request_withdrawal`** (from 145). After `insert into public.payouts ... returning * into v_row`:
    `T('payout:'||v_row.id||':hold', 'withdrawal_hold', 'balance', v_me → 'payout', v_row.id, p_amount_minor; payout_id, user_to = v_me)`. Every refusal of 145 stays (check-lost-refusals guards this one already: it is the H32 function).
13. **`public.cancel_withdrawal`** (from 019). After the wallet update:
    `T('payout:'||v_row.id||':return', 'withdrawal_return', 'payout', v_row.id → 'balance', v_me, v_row.amount_minor; payout_id, user_from = v_me)`.
14. **`public.admin_mark_payout`** (from 128).
    - `failed`, after the wallet update: `T('payout:'||v_row.id||':return', 'withdrawal_return', 'payout', v_row.id → 'balance', v_row.user_id, v_row.amount_minor; payout_id, note 'marked failed by staff')`.
    - `paid`: `T('payout:'||v_row.id||':paid', 'withdrawal_paid', 'payout', v_row.id → 'outside', null, v_row.amount_minor; payout_id, note 'paid by hand')`.
15. **`public.fail_unsent_payout`** (from 128). After the wallet update: the `:return` transfer as in 13.
16. **`public.record_payout_status`** (from 128).
    - Reversed after paid, after the wallet update: `T('payout:'||v_row.id||':reversed', 'withdrawal_reversed', 'outside', null → 'balance', v_row.user_id, v_row.amount_minor; payout_id)`.
    - `processed`, after `update public.payouts set status = 'paid'`: `T('payout:'||v_row.id||':paid', 'withdrawal_paid', 'payout', v_row.id → 'outside', null, v_row.amount_minor; payout_id)`.
    - failed/rejected/cancelled/reversed while open, after the wallet update: the `:return` transfer.
    - The "second payout reported" and "already given back but RazorpayX shows a live payout" branches move no money: no transfer.

### PR 5 (migration 162): money in from cards, card refunds, promotions

17. **`public.credit_topup`** (from 066_single_wallet_pool). After the wallet update:
    `T('payment:'||p_payment_id||':topup', 'topup_in', 'outside', null → 'balance', v_pay.user_id, v_pay.amount_minor; payment_id)`.
18. **`public.record_escrow_refund`** (from 035). After `update public.payments ... returning * into v_pay`:
    `T('payment:'||p_payment_id||':refund:'||v_pay.refunded_minor, 'card_refund_sent', 'refund_due', p_payment_id → 'outside', null, p_amount_minor; payment_id, user_from = v_pay.user_id)`.
    A refund recorded for a payment with no refund owed (a top-up or a promotion) drives that `refund_due` pot below zero, and the nightly check reports it as High. Today such a refund would leave money in the wallet silently.
19. **`public.activate_promotion`** (from 111). After the `task_promotions` update:
    `T('payment:'||v_pay.id||':promotion', 'promo_in', 'outside', null → 'promo', v_row.id, v_row.amount_minor; payment_id, promotion_id, task_id, user_to = v_me)`. An overpaid excess stays outside the books and is listed by the check (L12).
20. **`private.settle_campaign`** (from 046).
    *add (F6, safe):* `insert into public.wallets (user_id) values (v_promo.user_id) on conflict (user_id) do nothing;` before the `select ... for update`, so the `if found` branch always runs. If the owner prefers to keep today's exact behaviour, drop this line; the check then reports the stuck budget.
    After the wallet update (and the existing `wallet_adjustments` insert, kept): `T('promo:'||v_promo.id||':refund', 'promo_refund', 'promo', v_promo.id → 'balance', v_promo.user_id, v_refund; promotion_id, task_id)`.
    After the `platform_ledger` insert: `T('promo:'||v_promo.id||':spent', 'ad_revenue', 'promo', v_promo.id → 'platform', null, v_spent; promotion_id, task_id, user_from = v_promo.user_id)`.

Unchanged callers (`lock_bid`, `auto_accept_bid`, `pay_task_from_wallet`, `cancel_promotion`, `admin_pause_promotion`, `admin_cancel_task_with_refund`, `settle_finished_campaigns`, `run_auto_complete_due`, the edge functions) need no edit: the movement is written inside the function they already call.

---

## 4. Proving the books balance

### 4a. The checks (`private.ledger_check_rows()`, migration 164)

Returns `(check_code, severity, ref_type, ref_id, expected_minor, ledger_minor, detail)`, whole-state (not a date window), at most 100 rows plus one summary row.

| Code | Severity | Rule |
|---|---|---|
| L1 `wallet_balance_mismatch` | high | for every wallet: `balance_minor = sum(delta) where pot='balance' and owner_id = user` |
| L2 `wallet_clearing_mismatch` | high | same for `clearing` |
| L3 `wallet_credits_mismatch` | high | same for `credits`, and `credits_minor = 0` |
| L4 `ledger_without_wallet` | high | wallet-pot legs for a user with no wallet row |
| L5 `escrow_mismatch` | high | tasks with `funded_at` set and status not COMPLETED / AUTO_COMPLETED / CANCELLED: escrow pot = `private.task_paid_in_minor(id)` |
| L6 `escrow_left_on_closed_task` | medium | closed tasks whose escrow pot ≠ 0 (overpaid card job, cap residue, a missed refund) |
| L7 `escrow_negative` | high | any escrow pot < 0 (more paid out of a job than came in: F3 shows up here) |
| L8 `payout_mismatch` | high | payout pot = `amount_minor` when requested/processing, else 0 |
| L9 `refund_due_mismatch` | high | refund_due pot per payment = `refunds_outstanding.due_minor` (0 when absent); never < 0 |
| L10 `promo_mismatch` | high | promo pot = `amount_minor` for paid, unsettled promotions, else 0 |
| L11 `platform_mismatch` | high | platform pot = `sum(platform_ledger.amount_minor)` |
| L12 `payment_in_mismatch` | high | per paid payment: money taken from `outside` with that `payment_id` = amount applied (top-up: amount; escrow: amount; promotion: the campaign amount). Paid and not applied is already reported by `reconcile_rows` (`paid_not_credited`) |
| L13 `money_out_mismatch` | high | per paid payout: `withdrawal_paid` = amount (minus a `withdrawal_reversed` if reversed); per payment: `card_refund_sent` total = `refunded_minor` |
| L14 `transfer_not_balanced` | high | any `transfer_id` whose legs do not number 2 or do not sum to 0 |
| L15 `drift_logged` | high | any `private.wallet_ledger_drift` row in the last 26 hours |
| L0 `platform_equation` | info, or high if it fails | one summary row, below |

**Platform equation (L0).** With `in = −sum(delta) over outside legs < 0`, `out = sum(delta) over outside legs > 0`, `held = sum(delta) over balance + clearing + credits + escrow + payout + refund_due + promo`, `fees = sum(delta) over platform`, `opening = −sum(delta) over opening`, `seed = −sum(delta) over seed`:

> **money in + opening + seed = money out + held + fees**

Because every transfer sums to zero this holds by construction; if it ever fails, a row got in without `record_transfer` (a bypassed trigger), which is High. The useful part is that each side is also compared with the source tables: `in` with `payments` (L12), `out` with `payouts` and `refunded_minor` (L13), `fees` with `platform_ledger` (L11), and `held` with `admin_money_position().held_for_people_minor` (reported as info; the known difference is `payments_unapplied`, which has no ledger leg). The summary row gives all six numbers so the admin Money check page can show them.

### 4b. Recording and alerting (`public.run_ledger_check()`, migration 164)

- `perform private.assert_service_caller();` (same as `run_reconciliation`).
- If no `opening_balance` row exists yet (books not open), return `{"skipped": "books not open"}`.
- Insert one `public.reconciliation_runs` row (`kind = 'ledger'`, `checked` = number of rules, `mismatches` = rows with severity high/medium, `detail` = the rows). The `kind` check (097) allows only `internal` / `razorpay`, so 164 replaces `reconciliation_runs_kind_check` with the superset `('internal','razorpay','ledger')`, the same widening 046 did for `platform_ledger`. Nothing existing becomes invalid.
- If mismatches > 0: `public.record_admin_alert('reconcile', 'Ledger check: N thing(s) do not add up', 'Open Money check in the admin panel to see which.', {run, count})`.
- Returns `{run, mismatches, summary}` with counts and totals only.

### 4c. The nightly Inngest job (PR 8, code only, no new pg_cron)

In `supabase/functions/inngest/index.ts`, next to `nightlyReconcile`:

```ts
const ledgerCheck = inngest.createFunction(
  { id: "ledger-check", triggers: [{ cron: "TZ=Asia/Kolkata 45 2 * * *" }], concurrency: 1, retries: 2, onFailure: reportFailure("ledger-check") },
  async ({ step }) => {
    const r = await step.run("check the books", () => call<LedgerResult>(rpc, "run_ledger_check"));
    if (Number(r?.mismatches ?? 0) > 0) {
      await step.run("tell Sentry", async () => {
        await logServer("error", "ledger-check", "wallet ledger does not add up", { differences: Number(r.mismatches) });
        await captureServerError(new Error(`Ledger check found ${r.mismatches} difference(s)`), { fn: "ledger-check" }, "fatal");
      });
    }
    return { skipped: r?.skipped ?? null, mismatches: Number(r?.mismatches ?? 0) };
  },
);
```

Added to the `functions` list always (not behind `INNGEST_MONEY_JOBS`: it only reads). Counts only, never an amount, name or id in Sentry or step output (same rule as `nightly-reconcile`). The Sentry fatal reaches the owner by email through the alert rule from plan task 2.10. One run per night is negligible against the Inngest Hobby limit. A unit test in `jobs.test.ts` covers "skipped", "clean" and "mismatch → Sentry".

Optional admin-repo PR: the Money check page lists `reconciliation_runs` of kind `ledger` with the L0 numbers. Not needed for the alert to work.

---

## 5. Opening the books on staging (backfill)

Staging already holds money (seed wallets, testers' tasks, payouts). The ledger cannot rebuild that history truthfully, so it starts with **opening balances**: one clearly marked transfer per pot, equal to what the database holds at that moment.

How (migration 164, one transaction, run by the normal deploy):

1. `lock table public.wallets, public.tasks, public.payouts, public.payments, public.task_promotions, public.platform_ledger in share row exclusive mode;` so no money function runs while the snapshot is taken (the deploy holds this for seconds; money calls during that time wait, they do not fail).
2. Because the writers were deployed with mode `off` (section 6), the ledger is empty, so the opening value of every pot is simply its expected value from the table in 2a:
   - `balance` / `clearing` / `credits`: every wallet with a non-zero column.
   - `escrow`: every task with `funded_at` set and status not closed: `private.task_paid_in_minor(id)` when > 0.
   - `payout`: every payout requested or processing: `amount_minor`.
   - `refund_due`: every row of `refunds_outstanding`: `due_minor`.
   - `promo`: every promotion with `payment_id` set and `settled_at` null: `amount_minor`.
   - `platform`: one row, `sum(platform_ledger.amount_minor)`.
   Positive values: transfer `opening → pot`; a negative value (a wallet below zero): `pot → opening`. Kind `opening_balance`, `is_opening = true`, key `opening:<pot>:<owner|all>`, `source_fn = 'migration 164'`, note **"Opening balance when the books were opened on staging. Not a real payment."**
3. Pre-ledger leftovers on closed tasks (an overpaid card job completed in October) are **not** given an opening row: closed jobs are expected to hold 0 and their history is outside the books.
4. Set `wallet_ledger_mode = 'shadow'` in the same transaction. From this commit on, every money function writes movements and the books are complete.
5. Safety: the migration only inserts into `wallet_movements` and updates one `settings` row; it never changes a balance. It is idempotent (`on conflict (idem_key, leg) do nothing`, and a guard `if exists (select 1 from public.wallet_movements where is_opening) then return`). On a fresh database (CI, and production in Step 5) everything is zero, so it inserts nothing and production's books start empty and complete.
6. Check right after deploy (read-only, through `execute_sql`): `select public.run_ledger_check()` is service-only, so run `select * from private.ledger_check_rows()` inside `begin; ... rollback;` and expect only the L0 info row.

---

## 6. Rollout: small PRs, safe order

**Modes** (settings key `wallet_ledger_mode`): `off` → writers are deployed but write nothing; `shadow` → movements written, problems logged, never blocking; `warn` → plus a wallet guard that logs any wallet change without a matching movement; `enforce` → duplicates and unmatched wallet changes are refused.

Each PR: its own branch, `npm run check` (which runs `check-lost-refusals` and, from PR 1, `check-ledger-additions`), `npm run test:db` green in CI, the `security-review` skill on the diff (rule 9), and an independent read-only reviewer comparing every rewritten function with its previous definition. Each new SQL test file goes at the **end** of the `test:db` list in `package.json` (merge clashes on that line: keep both lists). Remember: **merging to `redesigned-2.0` applies the migration to staging**.

| PR | Migration | What | What could silently drop a check, and how it is tested |
|---|---|---|---|
| 1 | `158_wallet_movements` | Table, indexes, RLS, the three triggers, `private.record_transfer` (mode `off` = no-op), `private.ledger_mode()`, `private.wallet_ledger_drift`, settings row `wallet_ledger_mode = 'off'`. New `scripts/check-ledger-additions.mjs` + test in `npm test`: for each function in its manifest, the newest definition minus lines containing `private.record_transfer` and minus the listed *edits* must equal the previous definition (whitespace-normalised). This catches **lost behaviour** (F1), which `check-lost-refusals` cannot. | No existing function changes, so nothing can be lost. Test `wallet_ledger_table.test.sql`: authenticated/anon/service_role cannot insert/update/delete; postgres update/delete raise; truncate raises; a direct insert without `record_transfer` raises; mode `off` writes nothing; in mode `shadow` (set inside the test transaction) a transfer writes two legs summing to 0; a repeated key writes a drift row, not a third leg; a wrong pot pair, a negative amount and `seed` outside staging are refused (drift in shadow, raise in enforce); a person reads only their own legs. |
| 2 | `159_ledger_task_funding` | Section 3 items 1-6. | Rewrites `fund_task_from_wallet` (148 money guards: H51 "no valid price", H53 "higher than what you paid"), `refund_wallet_on_cancel`, `cancel_task`. Risk: copying a pre-148 body brings H51/H53 back. Tests: `hunt2_money.test.sql`, `funding_rules`, `cancel_rules` stay green unchanged; new `wallet_ledger_funding.test.sql` (mode shadow inside the transaction): for each path (wallet fund, dearer re-hire charge, card fund, poster cancel before start, after start with fine, card cancel with fine, dispute poster-wins) assert each wallet column's change = sum of new legs on that pot, the job's escrow pot ends at the right value (0 after cancel), keys as in 2d. |
| 3 | `160_ledger_release_clearing` | Items 7-11. | Rewrites `confirm_release`, `auto_complete_due`, `admin_resolve_dispute` (148: cap, H54 "started" checks, money-staff and money-blind guards). Risk: losing `cap_worker_net` or `assert_money_staff`. Tests: existing suites; new `wallet_ledger_release.test.sql`: release, auto-complete, dispute worker-wins with clearing days 0 and 7, revenue rows → `commission` + `poster_fee` legs equal `platform_ledger`, completion then clearing sweep moves exactly the release amount, a second release attempt refused and writes nothing. |
| 4 | `161_ledger_withdrawals` | Items 12-16. | Rewrites `request_withdrawal` (the H32 function: suspended, min, max, destination, bank-name checks). `check-lost-refusals` covers the refusals; the additions script covers the rest. Tests: `withdrawal_rules`, `withdrawal_limits`, `manual_payout` green; new `wallet_ledger_payouts.test.sql`: request → hold; cancel → return; staff failed → return; staff paid → paid; `fail_unsent_payout` → return; `record_payout_status` processed → paid, failed → return, reversed after paid → reversed; a second return of the same payout writes a drift row only. |
| 5 | `162_ledger_money_in_promotions` | Items 17-20. | Rewrites `credit_topup` (idempotent by `credited_at`), `record_escrow_refund` (over-refund refusal), `activate_promotion` (111 payment checks), `settle_campaign` (settled once). Tests: `promotion_payments`, `admin_cancel_pause` green; new `wallet_ledger_money_in.test.sql`: top-up twice → one movement; card refund partial then rest → two `card_refund_sent` with distinct keys; promotion activate → cancel → refund + spent legs; refund on a top-up payment → `refund_due` negative (proved in a rolled-back check call). |
| 6 | `163_ledger_test_helpers` | `private.test_set_wallet(user, balance, clearing)` (staging/CI only: sets the columns and writes `test_set` transfers for the difference) and `private.ledger_forget_test_accounts(uuid[])` (staging only, seed/demo ids only). Convert the 34 test files, `supabase/seed/test_data.sql`, `demo_account.sql`, `demo_account_remove.sql`; `scripts/reset-test-data.mjs` calls the forget function before deleting the seed users. | Risk: a test that set a wallet now sets something else and passes for the wrong reason. Each converted line is a 1:1 replacement; the reviewer checks the diff of `supabase/tests` contains only those replacements. `npm run test:seed` (local/CI) runs the seed twice. Refusal tests: both helpers refuse in `production`; forget refuses a non-seed id. |
| 7 | `164_ledger_open_books` | `private.ledger_check_rows()`, `public.run_ledger_check()`, widened `reconciliation_runs` kind check, opening balances and mode `shadow` (section 5). | This is the first PR that makes the writers live. Risk: a writer bug now runs in real calls; in `shadow` it can only log drift, never block. Test `wallet_ledger_check.test.sql`: on a database with seed money, run the opening logic, then the check returns only L0; then break one wallet with a direct update (as postgres) → L1 reported; delete-protection still on. After merge: run the read-only check on staging (5.6) and do one of each money action on staging as the seed people (fund, cancel, release, withdraw, cancel withdrawal) and look again. |
| 8 | none (code) | Inngest `ledger-check` (4c) + `jobs.test.ts`; optional admin-repo PR for the Money check page. | Reads only. Risk: the job silently skipping. Test: unit test for skipped/clean/mismatch; after deploy, trigger the function once from the Inngest dashboard and see a `reconciliation_runs` row of kind `ledger`. |
| 9 | `165_ledger_warn_guard` | Merge after **3 clean nights**. Deferred constraint trigger `wallets_match_ledger` (`after insert or update of balance_minor, clearing_minor, credits_minor on public.wallets, deferrable initially deferred, for each row`): at commit, re-reads the wallet row and compares each column with its pot sum; in `warn` writes a drift row (and the nightly job alerts), in `enforce` raises **"Wallet changed without a matching money record"**. Sets mode `warn`. | This is the net that catches any money path the inventory missed (a future function, a hand-written SQL fix). Risk: a hot path slowed: the pot sums use the `(pot, owner_id) include (delta_minor)` index; measure `confirm_release` and `request_withdrawal` timing before/after on staging. Test: a direct wallet update in mode warn → one drift row; in enforce → refused; every money test suite still green. |
| 10 | `166_ledger_enforce` | Merge after **7 clean nights in warn** and the owner's OK (D5). Sets mode `enforce`: duplicate keys and unmatched wallet changes are refused, and `record_transfer` no longer swallows errors. | Risk: an undiscovered path now fails for users instead of logging. That is why it comes last and only after a clean week; the change is one settings row, so going back to `warn` is one row too (by migration, as staff, with the audit log). Test: full `test:db` under enforce (the CI database runs every migration, so enforce is on there from this PR). |
| 11+ | `167`+ | Behaviour fixes, one per PR, only with the owner's answer: D2 (card walk-off), D3 (clearing moves the recorded amount: read `release:<assignment>` from the ledger), D4 (revenue capped at money held), D7 (retire `fund_task`). | Each is a real behaviour change: separate PR, its own failing-then-passing test, money reviewer. |

**Production (Step 5).** The production database is built from the migrations, so it gets the ledger from the start. Because a fresh database has nothing to open, 164 writes no opening rows there; set production's mode to `enforce` from day one (plan task 5.x), so production never runs without the ledger.

**Do not** batch PRs 2-5 into one: each is reviewable in an hour and testable alone, because the writers stay dormant (`off`) until PR 7.

---

## 7. What the owner must decide

| # | Decision | Recommendation |
|---|---|---|
| D1 | Start the work: say **"start H34"**. Merging each PR applies its migration to staging. | Yes, before Step 5 (the plan already says H34 is needed before Step 5). |
| D2 | Card-paid job, helper walks off (F1/F2). Today the card money stays on the job and a dearer quote is refused (148). Keep that, or bring back "move the card money to the poster's wallet" (fixed to the real balance, not `credits_minor`)? | **Keep today's behaviour.** It is simple, already tested, and the ledger records it. Retire `move_card_payment_to_wallet` in a later PR. |
| D3 | Clearing (F4): move each job's **recorded** net from clearing to balance, instead of recomputing it with today's commission. | **Yes, use the recorded amount** (PR 11+). |
| D4 | Revenue on an under-paid job (F3): book only what the job really held. | **Yes** (PR 11+). |
| D5 | When to switch to `enforce` on staging, and production from day one. | After 7 clean nights in `warn`; production starts in `enforce`. |
| D6 | Show people a "wallet history" from the ledger in the app. | Later, as a design task; the data and read rule are ready from PR 1. |
| D7 | Retire the legacy `fund_task` door (F7). | **Yes**, revoke execute (PR 11+, or in PR 2 if you say so). |
| D8 | Staging resets: allow deleting ledger rows of the seed and demo accounts only, staging only, through one function. | **Yes**; without it `npm run seed:reset` stops working once the books are open. |
| D9 | `settle_campaign` refund when the wallet row is missing (F6) and the release functions' missing-wallet case (F5): create the wallet row and pay, instead of losing the money silently. | **Yes** (small additions in PRs 3 and 5). |

No new tools, services or pg_cron jobs are needed. No key, secret or environment variable is added.
