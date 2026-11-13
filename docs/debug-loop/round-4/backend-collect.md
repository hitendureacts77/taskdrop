# Round 4 backend collect and recheck (13 Nov 2026, read-only)

Staging project `wjxvingpfbfvkfqhrguj`. Only selects, advisor reads and log reads. Nothing edited, applied, deployed or reseeded. No phones, emails, tokens or secrets are printed. Repo HEAD checked: e579a29 (PR 336); redesigned-2.0 has since moved to a87dfe5 (PR 337, docs only).

## 1. Migrations and deploy

- Staging has every repo migration 162-177 applied (162, 163, 164, 166, 167, 169-177). The repo has no 165 or 168 (168 was taken out on purpose, B54).
- In the repo but not applied on staging:
  - **152_abuse_caps** (H43/H44/H47 caps). Proof: no `is_new_account`, `limit_daily_posts` or `limit_daily_feedback` functions or triggers, no `post_cap_day`, `ad_click_viewer_promo_day` or `media_uploads_day` settings rows, and `record_ad_click` still has the old body (no advisory lock). Candidate N1.
  - 060_admin_earnings_daily, 061_fix_admin_resolve_dispute, 062_escrow_refund_claim: not listed by name, but `admin_earnings_daily`, `admin_resolve_dispute` and `claim_escrow_refund` exist, so they were most likely applied under other names (old drift, not checked in depth).
  - 066_razorpayx_hardening: this is the known B56 (`payments.wallet_credited_*` columns are missing).
- Applied on staging but missing in the repo: none, apart from renames (016-032 and 043-046 were applied under unnumbered names such as `vault_secrets_rpc` and `task_promotions`). Old naming drift, harmless.
- Edge functions: all 10 were redeployed together on 2026-11-13 05:59 UTC (api v414, razorpay v422, razorpay-webhook v416, inngest v410, app-download v17). The repo's last `supabase/functions` commit is be19f80 (12 Nov 18:25 IST = 12:55 UTC), so the deploy is newer than HEAD and the B80/B84 code is live.
- Vercel: web `taskdrop` latest READY deploy is PR 337 (a87dfe5); the PR 336 deploy is also READY. Admin's latest deploy is 11 Nov. Runtime errors in the last 24 h: none on either project.

## 2. Ledger rechecks (staging, select-only)

| Bug | Verdict | Evidence |
|---|---|---|
| B30 | Verified | `top_earners_live` for top_rated, most_active and new returns 0 deleted accounts (30 rows each) |
| B32 | Verified | `platform_highlights_live().openTasks` = 165; an independent recount with the same rules = 165 |
| B34 | Verified | `guest_open_posts_near` and `guest_helpers_near` exist with the box arguments; a Hyderabad box returns 10 rows each; anon and authenticated cannot execute them (service role only) |
| B37 | Verified | triggers `reviews_recompute_totals` and `review_moderation_recompute_totals` enabled; the ledger check query returns 0; rating average vs reviews mismatch is 0 (worker and poster) |
| B38 | Verified | 0 tasks with an unrounded pin; 0 pinned tasks without a `task_private` row (457 pinned). Side finding N2 |
| B53 | Verified | `lock_bid(uuid, payout_mode, bigint)` exists and checks expected price and blocks; the old 2-arg overload is kept on purpose (migration 167) and wraps it with null |
| B57 | Verified | `fund_task(uuid, uuid)` execute: anon no, authenticated no |
| B59 | Verified (structure) | 6 triggers `profiles_avatar_own_path_*`, `messages_media_own_path_*`, `task_proofs_files_own_path_*` enabled; not exercised with a write |
| B60 | Verified | policy `task_private_parties_read` now uses `private.user_working_task`; `can_read_task_media` exists, authenticated only |
| B61 | Verified (source) | `auto_accept_bid`, `task_contact_phone` and `lock_bid` carry blocked checks; `crm_suspend_user` touches bids |
| B62 | Verified | `trg_keep_destination_with_open_payout` on payout_destinations is enabled (O) |
| B64 | Verified | `worker_proof_photos(uuid)` exists, source filters deleted, authenticated only |
| B66 | Verified | `private.blocked_between` execute: anon no, authenticated yes |
| B67 | Verified (source) | `my_stats`, `my_streaks`, `public_profile_stats`, `top_earners_live` rewritten over assignments; not compared against a walked-off sample |
| B80 | Verified (structure) | `payments.promotion_id` column and `activate_promotion_from_payment(uuid)` exist, service role only; 0 promotions on staging so not exercised |
| B81, B83 | Verified (structure) | `task_live_worker`, new `on_message_inserted` and `on_task_changed`; policy `messages_select_participant` uses `can_read_task_message` |
| B82 | Verified (structure) | `auto_accept_bid` and `lock_bid` carry the 167 re-hire code; not exercised |
| B84 | Not checkable in SQL | webhook and razorpay function code only; functions were deployed after HEAD |
| B54, B55, B85 | Still open (owner) | no DB fix this round |
| B56 | Still open (owner) | `payments` has no `wallet_credited_*` columns |
| B21 | Grown | 87 OPEN tasks past due (58 on 10 Nov), 8 LOCKED over 2 days (2 on 10 Nov) |

## 3. Advisors, logs, runtime errors

Security advisors: 14 INFO `rls_enabled_no_policy` (deny-all private and system tables, by design); WARN `get_app_controls` executable by anon (by design, the app asks before sign-in); WARN 149 authenticated SECURITY DEFINER functions (by design; a scan of all `admin_*`, `crm_*` and money functions found none without an auth or staff check in the body); WARN `auth_leaked_password_protection` is off (Auth setting, owner). Performance advisors: 8 INFO unindexed foreign keys (new: `payments_promotion_id_fkey` from 177), 15 INFO unused indexes. No ERROR level.

Logs, last 24 h: postgres_logs had 2 error lines (1 `task_proofs_summary_check` violation, 1 the statement text of migration 176 logged once). Non-2xx function responses: inngest 206 x1825 (normal), places-search 401 x20, phone-auth 400 x4, app-download 503 x2, api 401 x1. Auth `GET /user` 401 with no bearer about 15 times (signed-out client checks). Inngest function logs: 36 "Inngest step error" and about 40 `JWT issued at future` errors, spread evenly (1-5 an hour). nightly-reconcile logged 14 differences.

## 4. New candidate bugs

| # | Title | Class | Level | Evidence | Likely file |
|---|---|---|---|---|---|
| N1 | Migration 152 (abuse caps H43/H44/H47) is not applied on staging, so ad-click, ad-impression, media upload, daily post and feedback caps are not live | Backend | High | list_migrations has no 152; no `limit_daily_posts` trigger, no cap settings rows, `record_ad_click` has the old body | `supabase/migrations/20261105150000_152_abuse_caps.sql` (sorts after 151 and before 153, was skipped) |
| N2 | 12 `task_private` rows have no task (exact pin and address of deleted tasks kept), all from 4 Oct 15:28 UTC; the FK is DEFERRABLE INITIALLY DEFERRED | Backend | Low | 12 orphans with the same `updated_at`; FK is ON DELETE CASCADE | data cleanup; migration 074 |
| N3 | Inngest jobs fail with "JWT issued at future" 1-5 times an hour (outbox_pending, settle_cleared_earnings, run_outbox_watchdog, media_expire_pending, run_auto_complete_due, settings read) | Backend | Medium | about 40 errors in 24 h across 8 steps, one message; Inngest retries hide it, but each failed step is a delayed push or sweep | `supabase/functions/inngest/jobs.ts` `call()` and `index.ts` `db` client (platform clock skew; retry is the only guard) |
| N4 | `submitProof` accepts a 5000-character summary and 30 files, the table allows 2000 and 10, so a longer one returns a raw constraint error | Backend | Low | postgres log `task_proofs_summary_check` violated 12 Nov 11:16 UTC; constraints `summary <= 2000`, `files <= 10`; the app caps at 2000 and 10, so only a direct API call hits it | `supabase/functions/api/writes.ts` lines 438-460 |
| N5 | `app-download` returns 503 "EXPO_BUILDS_TOKEN is not set": the download page and QR cannot find the newest Android build | Both | Medium | 2 x 503 and 2 error logs, 12 Nov 20:18 UTC, from phones; function v17 | `supabase/functions/app-download/index.ts` plus the missing function secret (owner adds it, never printed) |
| N6 | `places-search` answers 401 to signed-out callers (15 in 2 minutes from a browser, 5 from the Android app), no JWT role on the request; location search for guests may fail | UI/Backend | Medium (needs a guest repro on web and Android) | 20 x 401 in 24 h; verify_jwt is on; guest mode has no session | `apps/mobile/src/lib/location.ts` lines 267-340 (`functions.invoke`), `supabase/config.toml` for places-search |
| N7 | Nightly reconcile reports 14-19 "high" mismatches every night, all `finished_without_commission` on fake-city seed tasks (fa4e0002-*) | Backend (test data) | Low | 50 findings over the last 4 nights, all seed refs, no real task; noise can hide a real mismatch | `supabase/seed/fake_world.sql` |
| N8 | One payout stuck "processing" for 38 days and 6 "requested" over 7 days old | Backend | Low | counts only; payouts are paused on purpose (B41) | owner decision |
| N9 | 23 DISPUTED tasks older than 3 days, nothing shows who resolves them | Backend (seed) | Low | count only | fake-city seed or admin queue |
| N10 | `payments.promotion_id` foreign key has no index (new in 177) | Backend | Low | performance advisor `unindexed_foreign_keys` | a new migration, only if the owner asks |

Invariants that held (0 rows): negative wallets, wallets without a profile, live task status without a live assignment, OPEN task with a live assignment, more than one live assignment or locked bid per task, completed without `completed_at`, refunded over amount, paid top-up without `credited_at`, rating average out of step.
Also noted, not bugs: 15 escrow payments still "created" over 3 days old (unpaid links); 8 LOCKED over 2 days (B21).
