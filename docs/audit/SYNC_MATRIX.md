# Sync matrix — admin change → user app (Android + web)

Status 2026-10-04 · **Static analysis only.** Latency was not measured (no staging, no running admin+app pair).
"Current" reflects what the code and the live catalog guarantee, not a timed test.

## How a change reaches a user today

| Channel | What exists | Reach |
|---|---|---|
| Database (single source of truth) | Admin and the app write/read the same Postgres | ✔ always consistent *on next read* |
| Realtime (`postgres_changes`) | **Only `public.messages`** is in the `supabase_realtime` publication | chat only |
| `notifications` rows | Created by `private.notify()` from triggers and some admin RPCs | visible on next fetch |
| Realtime for `notifications` | App subscribes (`data/extras.ts: subscribeToNotifications`) **but the table is not in the publication** | **never fires** |
| Push (Expo, via `pg_net` in `private.push_notification`) | Native only | Android yes, web no |
| Polling | `LiveWorkers` 60 s, `PresenceBeat` 60 s, `AddFundsSheet` interval | not for money state |
| Refetch on focus / reconnect / foreground | not systematically implemented | screens refetch only when they remount |

**Core gap (S-01):** an admin change becomes visible to a user only when that user navigates or refreshes
(or, on Android, gets a push). Web users get neither. There is no push-to-screen path for money state.

## Matrix

Target = max seconds from admin commit to correct pixels on an open screen. "Money" rows are real-time targets.

| # | Admin action (RPC / function) | User surface that must change | Mechanism today | Target | Current |
|---|---|---|---|---|---|
| 1 | Mark payout paid / failed / processing (`admin_mark_payout`) | Wallet, Withdraw, notification | notification row + push (native); wallet = refetch on mount | ≤ 5 s | **Partial** — stale balance until remount; web has no push |
| 2 | RazorpayX status webhook (`record_payout_status`) | Withdraw status, wallet | notification row + push; refetch on mount | ≤ 5 s | **Partial** |
| 3 | Resolve dispute (`admin_resolve_dispute`) | Task screens for poster + worker, wallet | `tasks` UPDATE trigger notifies parties; no realtime on `tasks`/`wallets` | ≤ 5 s | **Partial** — task state and balance stale until refetch |
| 4 | Escrow refund (`razorpay` fn → `record_escrow_refund`) | Poster wallet / task | no notification written by the RPC (`notifies_user=false`) | ≤ 5 s | **Missing** user-visible signal |
| 5 | Wallet adjustment (`wallet_adjustments`) | Wallet history + balance | no admin RPC found that notifies | ≤ 5 s | **Missing** — verify the writer and add notify |
| 6 | Settings change (fees, clearing, min withdraw) | Every price breakdown and withdraw limit | `extras.ts` reads `settings` in one place; **`AiPostScreen`, `TaskManageScreen`, `api.ts` use the compile-time `FEES` constants** | ≤ 60 s | **Wrong/Partial** — display drifts from what the server charges (server recomputes, so no under-payment) |
| 7 | Suspend user (`crm_suspend_user`) | Whole app | auth ban + sessions/refresh tokens deleted; existing access token valid until expiry | ≤ JWT TTL | **OK (Low gap)** — no in-app message; ≤ 1 h residual |
| 8 | Unsuspend (`crm_unsuspend_user`) | Sign-in | notification written | next sign-in | OK |
| 9 | Support reply (`reply_support_ticket`) | Support thread, bell | notification row + push | ≤ 10 s | **Partial** — not live |
| 10 | Support resolve (`resolve_support_ticket`) | Ticket status | none | ≤ 30 s | **Missing** |
| 11 | CRM broadcast (`crm_send_broadcast`) | Bell / push | notification row + push | ≤ 30 s | **Partial** |
| 12 | Role change (`admin_set_admin`) | none user-facing | n/a | n/a | n/a |
| 13 | Promotions (admin read-only today) | n/a | n/a | n/a | n/a |

Rows 3, 4, 5, 6 are the ones with money consequences. Fix order = money first.

## Findings

- **S-01 (High — sync).** Notifications table is not in the realtime publication, so the live subscription
  in the app never delivers; all admin→user effects rely on refetch or native push.
- **S-02 (Medium).** Only chat is live. Wallet, task state, payout status, dispute outcome need a per-user
  live channel.
- **S-03 (Medium).** Fee/clearing display uses constants in several screens while the server uses
  `settings`; live clearing is 0 days vs. constant 7 (see F-19).
- **S-04 (Low).** Suspension is enforced at the auth layer; residual access-token lifetime and no user
  message.
- **S-05 (Medium).** No admin audit log, so an admin change cannot be traced back from the user's view
  (F-10).

## Design to adopt (Phase 5, after approval)

1. **Rule:** every admin mutation is one RPC that, in one transaction, checks `is_admin` (+ AAL2 for money),
   writes an append-only audit row, and emits its user-visible effect (a `notifications` row **and** a
   Broadcast to the affected user).
2. **One live channel per signed-in user.** Use Realtime **Broadcast** from a trigger
   (`realtime.broadcast_changes`) on a private topic `user:{uid}` with RLS on `realtime.messages`; the client
   treats each event as a cache-invalidation hint and refetches the affected query. Broadcast avoids the
   per-subscriber authorization cost and single-threaded limit of Postgres Changes at scale.
3. **Fallbacks:** refetch on app foreground, network reconnect, and web tab visibility; remove the 60 s
   polling loops where Broadcast covers them.
4. **Settings:** read fees/limits from `settings` through one cached hook; `packages/rules` becomes defaults
   only; a settings change emits a broadcast so open apps refresh.
5. **Kill switches** (pause withdrawals / signups, force-update, maintenance banner) ride the same channel.

## Tests to build once staging exists (deliverables)

- Playwright, three contexts: admin (`:3001`) + user web (`:8081`) + a second user; one test per row 1–11
  asserting the visible change within its target; offline→online recovery; reload shows new state.
- Android: emulator + Maestro running rows 1, 3, 6, 7, 9 against the same staging project.
- Negative: no admin-only field (commission, other users' data) appears on the user channel payload.

---

## Status after Phase 5 (2026-10-04)

What changed, and what was proven:

| Gap | Change | Proven how |
|---|---|---|
| **S-01** notifications never delivered live | `notifications` added to the `supabase_realtime` publication (migration 076). The existing subscription in `data/extras.ts` (bell badge, notification list, push bridge) now fires. | publication membership asserted in `audit_and_throttle.test.sql`. End-to-end delivery to a signed-in client was **not** exercised. |
| **S-02** only chat was live | New `SyncProvider` bumps one counter on every live notification and whenever the app returns to the foreground (web: tab visible); `useFocusTick()` now includes it, so wallet, feed, explore, my-tasks and profile — which already refetch on that tick — refresh with no per-screen edits. Bursts are coalesced (400 ms). | `npm run check` (typecheck, lint, tests) passes; **runtime refresh not exercised** (needs a signed-in client). |
| Matrix row 5 — wallet adjustment gave no signal | Trigger notifies the user (076). | asserted in `audit_and_throttle.test.sql` |
| Matrix row 10 — ticket resolved gave no signal | Trigger notifies the user when someone *else* resolves it (076). | asserted |
| Every admin change untraceable | `admin_audit_log` + triggers on payouts, wallet adjustments, suspensions, roles, dispute decisions, settings, broadcasts (076). | asserted |

Updated matrix state:

| # | Admin action | Now |
|---|---|---|
| 1 | Mark payout | **Live signal** (notification already written by the RPC, now delivered) → refetch |
| 2 | RazorpayX status | **Live signal** (same) |
| 3 | Resolve dispute | **Live signal** (task trigger notifies both parties) → refetch |
| 4 | Escrow refund | **Still missing** — no notification is written by the refund path; add one in `record_escrow_refund` |
| 5 | Wallet adjustment | **Fixed** |
| 6 | Settings change | **Still partial** — `AiPostScreen`, `TaskManageScreen`, `api.ts` still read compile-time `FEES`; make `packages/rules` defaults only and read `settings` through one cached hook, then notify on change |
| 7 | Suspend | unchanged (auth-layer ban; ≤ JWT lifetime) |
| 9 | Support reply | **Live signal** |
| 10 | Support resolve | **Fixed** |
| 11 | CRM broadcast | **Live signal** |

Not done and why: a Broadcast-based per-user channel and a timed Playwright/Maestro suite. They need a signed-in
client and a running admin + app pair; the notification path above is the smaller change that closes the
reported gap now, and it stays correct when the transport is swapped for Broadcast later because screens only
depend on the counter.
