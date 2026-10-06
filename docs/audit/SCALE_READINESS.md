# Scale readiness — MVP now, 1M customers later by configuration

Status 2026-10-04 · Static review + live catalog/advisors. **No load test was run** (no staging, and the
rules forbid load against production). Numbers below are therefore *seams and triggers*, not measured limits.

## Verdict

The architecture is sound for scaling by configuration: one data seam, a transactional RPC surface for money,
statement timeouts set, a single codebase for Android+web. The things that will bite first are the
**global cron sweeps, per-subscriber Realtime, unpaginated reads, and polling** — all fixable without
rewriting screens.

## Seam checklist

| # | Seam | Status | Evidence | Trigger / action |
|---|---|---|---|---|
| 1 | Single data seam | ✔ present | all client data via `apps/mobile/src/data/api.ts` + `extras.ts`; admin via `lib/data.ts` | add contract tests so the backend can move behind a service later |
| 2 | Backward-compatible API surface | ◐ partial | migrations are append-only; RPC signatures change in place | adopt expand/contract; add remote **min-supported-version** gate (old APKs live for months) |
| 3 | No unbounded reads | ✖ gap | 72 `.select()` calls vs 15 `.limit()/.range()`; feed query `tasks.select('*')…eq('status','OPEN')` and `bids.select('*')` have no cap; admin `earnings.ts` loops `.range(from, from+999)` | keyset pagination + hard limits; admin dashboards from pre-aggregated tables (`admin_earnings_daily` pattern) |
| 4 | Index & RLS performance | ◐ partial | advisors: 11 unindexed FKs, 1 `auth_rls_initplan` (`task_disputes_read` calls `auth.uid()` per row), 9 multiple-permissive-policy warnings, 10 unused indexes | fix the initplan + FK indexes now (cheap); `EXPLAIN (ANALYZE, BUFFERS)` the top 20 queries on staging at 10×/100×/1000× data |
| 5 | Connection pooling | ◐ unknown | clients use PostgREST (pooled by platform); Edge Functions use service client | use transaction-mode pooler for any direct connections; set per-transaction context with `set_config(…, true)` |
| 6 | Realtime fan-out | ✖ gap | chat uses `postgres_changes` on `messages` (per-subscriber authorization, single-threaded); other state polls | move to **Broadcast** per-user private channels (see SYNC_MATRIX); beyond ~3,000 concurrent subscribers on the same changes Postgres Changes is the wrong tool |
| 7 | Cron sweeps | ✖ gap | `settle-cleared-often` runs **every 5 min** over all tasks, plus a nightly copy; `auto-complete-due` every 15 min; `settle-finished-campaigns` hourly | add partial indexes on `(clear_at) where cleared_at is null`, batch with `limit … for update skip locked`, drop the duplicate nightly job, alert on duration |
| 8 | Async work off the request path | ◐ partial | push via `pg_net` in a trigger; webhooks do work inline | queue (pgmq / `pg_cron` + worker Edge Function) for notifications, payouts, CRM broadcasts; idempotent consumers + dead-letter table; ack webhooks fast |
| 9 | Money data model | ◐ partial | wallet balances are mutable columns (`balance_minor`, `clearing_minor`, `credits_minor`); `platform_ledger` and `wallet_adjustments` exist | add an append-only double-entry ledger as the source of truth; reconcile nightly vs Razorpay/RazorpayX; idempotency keys on every money RPC |
| 10 | Partition-ready tables | ✖ not yet | `messages`, `notifications`, `ad_events`, `platform_ledger`, `payments` are plain tables | design time-partitioning + archival now; partition when a table passes ~10–50 M rows |
| 11 | Media | ✔ good base | private bucket, 50 MB cap, MIME allow-list (no SVG/HTML) | CDN + signed URLs, image/video transforms, egress budget; fix read policy (F-03) |
| 12 | Edge/CDN caching | ✖ gap | public aggregates (`platform_stats`, `trending_categories`, `top_earners`, `platform_highlights`) hit Postgres per call | cache at the edge or a materialised view refreshed on a schedule |
| 13 | Operability | ◐ partial | settings table exists | feature flags + kill-switches from admin that reach clients live |
| 14 | Cost guards | ✖ gap | SMS, Maps, egress, Edge invocations, Razorpay fees | budgets + alerts; global daily SMS ceiling (F-08) |
| 15 | Observability | ✖ gap | no error tracking found; `pg_stat_statements` is installed | add Sentry (all three apps), log drains, slow-query alerts |

## Runbook — "at metric Y, do X"

| When | Do |
|---|---|
| DB CPU > 60 % sustained or p95 > 300 ms | upgrade compute; add read replica; point admin reads at it |
| Pooler or connection saturation > 70 % | tune pool size; ensure all server paths use transaction mode |
| Concurrent realtime subscribers > ~1,500 | finish Broadcast migration; stop using Postgres Changes for fan-out |
| Any table > 10–50 M rows | partition by time; archive cold partitions |
| Cron job duration > 30 s | batch + skip-locked; move to queue worker |
| SMS spend/day > ceiling | CAPTCHA on send, tighten per-IP, review pumping |
| Egress > budget | CDN + transforms; shorten signed-URL reuse |

## Explicitly not now

Microservices, Kubernetes, multi-region active-active, custom auth, sharding. Each needs a measured trigger
first (e.g. a single table's write rate beyond a vertically-scaled primary).

## Load plan (staging only, owner-approved caps)

k6 at 1k → 10k → 100k simulated users over: browse feed, post task, quote, chat, wallet read, withdraw,
admin dashboards. Record p50/p95/p99, DB CPU, connections, Realtime msgs/s. Output a measured-limits table
here. **Not run.**

---

## Status after Phase 5 (2026-10-04)

| Seam | Change |
|---|---|
| #4 Index & RLS performance | **Done:** 11 foreign-key indexes added; `task_disputes_read` no longer re-evaluates `auth.uid()` per row; indexes for the new media-read policy. Advisor: those WARNs are gone. 9 multiple-permissive-policy WARNs remain (harmless at MVP scale). |
| #10 Partition-ready tables | **New table designed for it:** `admin_audit_log` is append-only, indexed on time/actor/target, with no updates — ready to partition by month. |
| #14 Cost guards | **Partly:** ad-impression billing is bounded per viewer (1 / 30 min / promotion, 300 / day). SMS ceiling and Maps budget still open (F-08, F-23). |
| #6 Realtime fan-out | **Improved, not finished:** one subscription per signed-in user on `notifications` replaces the need for per-screen polling for money state. Chat still uses Postgres Changes; move it to Broadcast past ~1.5–3 k concurrent subscribers. |
| Seams 3, 5, 7, 8, 9, 11–13, 15 | **Unchanged** — see the table above; each has a stated trigger. |

No load test was run, so no capacity number has been measured; the first thing to measure is the
`settle-cleared-often` cron (every 5 minutes, global) and the unpaginated feed queries.
