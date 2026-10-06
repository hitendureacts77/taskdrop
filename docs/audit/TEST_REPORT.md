# Test report — what ran, what didn't

Updated 2026-10-04 (after Phase 5). Target: project `wjxvingpfbfvkfqhrguj`, which holds only fake data; the owner
authorised testing against it directly. Every database test ran inside a transaction that rolled back.

## Ran — and passed

| Check | How | Result |
|---|---|---|
| Reproduce F-01 … F-05 **before** fixing | real roles (`authenticated`, `anon`) with JWT claims, in a rolled-back transaction | **all reproduced** (funded-column update and funded-task insert; anon read of UPI/location/coordinates; cross-user media listing; bid/review/destination tampering) |
| Same probes **after** fixing | same harness | **all refused**; positive controls (edit own task/bid/profile, save a task, add a destination, mark notifications read, remove a listing) **still work** |
| `column_lockdown.test.sql` (new) | 11 task columns + insert, guard-trigger layer, remove_listing, bids, reviews, destinations, profiles, location privacy + rounding + no-overwrite, media scoping | **pass** |
| `audit_and_throttle.test.sql` (new) | audit rows + append-only + admin-only read, notifications on wallet adjustment/ticket resolve, realtime publication, ad throttle (own views, burst, signed-out), atomic OTP cap + service-role-only | **pass** |
| `money_rules`, `chat_access`, `cancel_rules`, `funding_rules`, `withdrawal_rules`, `rpc_surface` | updated to the current wallet-funded flows (they were stale — F-26) | **pass** |
| `phone-auth` v13 over HTTP | wrong guesses 3→4→5, cap reached (even the right code refused and burned), no-code case, correct code reaching the account check, bad body | **pass** (test rows removed) |
| Admin build + headers | `tsc`, `next build`, `next start`; curl for headers; built app loaded in a browser | **pass** after one fix: first attempt blanked `/login` (F-30); final: 11/11 scripts carry the nonce, page hydrates, fonts load |
| `npm run check` (web monorepo) | typecheck, lint, 24 unit tests | **pass** |
| Supabase advisors | security + performance, before and after | security: 0 ERROR; mutable-search_path WARN gone. performance: FK-index and per-row-`auth.uid()` findings gone |
| Git-history secret scan | pattern scan, both repos | clean (test key id only) |

## Did not run — and why

| Check | Blocker |
|---|---|
| End-to-end live delivery of a notification to a signed-in client; the `SyncProvider` refresh at runtime | needs a signed-in client session (no test credentials were created) |
| Admin dashboard pages under the new CSP | need a signed-in admin; only `/login` was exercised. Same Next runtime/nonce mechanism, but unverified. |
| Playwright multi-context sync suite; Android Maestro suite | need a running admin + app pair and a signed-in session |
| k6 load/capacity tests; `EXPLAIN` at scale | no load was generated; no capacity number exists |
| Release APK/AAB analysis (MobSF, Hermes, manifest, mitmproxy) | no release build in the workspace |
| Supabase Auth settings, Google Cloud key restrictions, Vercel edge headers/firewall, PITR | dashboards only |
| Webhook forgery/replay; concurrent-request races | not exercised in this pass |
| `npm run test:db` as a single command | needs `psql` + a local Supabase (Docker), neither installed here; the same SQL was run statement-for-statement through the project's SQL API |

## How to re-run

1. `npm run test:db` (CI does this on a throwaway local Supabase) — now eight suites.
2. `npm run check`.
3. Admin: `npm run build && npm start`, then confirm the response headers and that `/login` renders with no CSP errors in the console.
4. Still to build: the signed-in sync suite and the load profile (see `SYNC_MATRIX.md`, `SCALE_READINESS.md`).
