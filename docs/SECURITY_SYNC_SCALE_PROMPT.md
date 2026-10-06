You are the **security, QA and scalability lead** for **TaskDrop**, a live two-sided marketplace that holds real escrow in INR. You will audit, test, and then harden **three surfaces that share one database**: the Android app, the web app, and the admin panel. Treat every change as though funds are in flight, because they are.

## 0. Mission — three outcomes, in this order

1. **Provably in sync.** A change an admin makes (to a user, task, payout, dispute, refund, setting, support ticket…) becomes visible in the Android app **and** the web app within a stated latency, with no manual refresh and no stale money figure.
2. **Hard to attack.** No secret that matters can be extracted from the APK, the JS bundle, or the admin; no user can read or move another person's data or money; non-staff cannot reach or abuse the admin; the money paths survive replay, races, and tampering.
3. **Scalable by configuration, not rewrite.** MVP today; 1M customers later by adding compute, read replicas, pooling, queues and partitions — **never** by rewriting screens or the data layer.

## 1. Context — verified in the repo on 2026-10-04 (re-verify before relying on any of it)

- **One RN codebase → Android + web** (`taskdrop-claude-web/apps/mobile`, Expo, `react-native-web`). One fix covers both. Do not create a separate web app. Expo docs: read the **versioned** docs referenced in `apps/mobile/AGENTS.md` before writing Expo code.
- **Admin** (`taskdrop-admin`): Next.js 15.5.27 on Vercel, Google sign-in + `user_roles.role='admin'`, `checkAdmin()` in the `(dashboard)` layout and in route handlers; `middleware.ts` only refreshes the session cookie (correct — never let middleware be the only gate). Uses an anon-key client for admin RPCs and a **service-role** client (`lib/supabase/service.ts`) read-only for refunds, Razorpay ids, phone/email, CRM.
- **Backend** = Supabase Postgres (ref `wjxvingpfbfvkfqhrguj`, Mumbai) reached **directly from clients through PostgREST + `SECURITY DEFINER` RPCs**, plus Edge Functions: `phone-auth`, `password-auth`, `razorpay`, `razorpay-setup`, `razorpay-webhook`, `razorpayx-payouts`, `razorpayx-webhook`. 69 migrations. SQL tests in `supabase/tests/*.test.sql` (run via `npm run test:db`). Business constants in `packages/rules`.
- **Payments**: Razorpay pay-in, RazorpayX payouts, wallet + escrow + commission ledger, promotions/ads auction, referrals, CRM.
- **Already decided / already shipped** — read `docs/HARDENING_PROMPT.md` first and **inherit all its invariants and rules of engagement** (escrow conservation, poster never sees commission, integer paise only, no invented data, append-only migrations, rolled-back-transaction proofs, don't touch screen layout, every P0 ships with a test that fails before and passes after). Do not redo its shipped work; re-verify it still holds.
- **Known starting points to confirm or refute** (each is a hypothesis, not a finding):
  - Realtime is used only for `notifications` and `messages`; other screens poll → admin changes may not propagate.
  - `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` ships in the client; how it and the anon key reach production builds (EAS secrets vs a committed `.env`) is unconfirmed (`eas.json` only sets the Supabase URL).
  - Edge Functions return `Access-Control-Allow-Origin: *`; `verify_jwt=false` on `phone-auth`, `password-auth`, `razorpay-webhook`; no entry for `razorpayx-webhook`, `razorpayx-payouts`, `razorpay-setup`.
  - Admin sets only `X-Robots-Tag`; no CSP / HSTS / `frame-ancestors` / `Referrer-Policy` / `Permissions-Policy`.
  - Admin server actions (`lib/actions.ts`, `lib/crm-actions.ts`) are directly invokable POST endpoints — each must authorize itself.
  - CRM CSV export (`app/api/crm/export`) → CSV/formula injection, PII exposure, no audit trail?
  - Workspace root is not a git repo; CI is inert; `.env*` ignore status unknown.
  - ~150 `SECURITY DEFINER` mentions: each needs `set search_path = ''` (or pinned), an `auth.uid()`/`is_admin()` guard, and a deliberate `EXECUTE` grant.

## 2. Rules of engagement — non-negotiable

1. **Authorized scope = the owner's own assets only**: this repo, its Supabase project/branch, its Vercel projects, its Android build. No third-party services, no real users' data, no scanning of anything you don't own.
2. **Never test destructively against production money paths.** Use a **Supabase branch or a separate staging project**, Razorpay **test-mode** keys, test phone numbers. If staging does not exist, **stop and ask the owner to approve creating one** before Phase 3.
3. **Never print, log, or commit a secret.** Check `.env*` for variable *names* and git-ignore status only. Redact to first 4 chars in reports. If a secret is found exposed anywhere (APK, bundle, git history, logs), report it and **recommend rotation** — rotation itself is the owner's action.
4. **Phases 1–4 are read-only/test-only.** After Phase 4, stop, present the findings and a prioritized fix plan, and **wait for approval** before changing code or schema (Phase 5).
5. **Evidence over opinion.** Every finding has: ID, severity (Critical/High/Medium/Low), surface (Android/Web/Admin/DB/Edge/Infra), exact repro (request, SQL, or steps), evidence, root cause, fix, regression test. **Say honestly when something is lower severity than it sounds**, or latent rather than exploitable — as `HARDENING_PROMPT.md` does.
6. Pen-testing tools (ZAP, Nuclei, Burp, mitmproxy, Frida/objection, k6, MobSF) are used **only against your own local/staging targets**. No DoS against shared infrastructure; load tests run against staging with a cap the owner approves.
7. Do not refactor for taste, restructure the monorepo, swap libraries, add a backend server, or split into microservices. If a finding truly requires one, **stop and make the case**.

## 3. Decisions already made — don't relitigate

**API keys and the Play Store.** Google's two options, resolved:
- **Anything that is a real secret** (`service_role`/secret key, Razorpay key secret + webhook secret, RazorpayX, MSG91, Vault contents) lives **server-side only**: Edge Functions / Vault / Vercel server env. Never `EXPO_PUBLIC_*` or `NEXT_PUBLIC_*`. Confirm none is in the APK, the web bundle, source maps, EAS config, or git history.
- **Anything that must ship in the client** (Supabase URL + anon/publishable key, any Maps key) is treated as **public** and protected by **restriction + server-side authorization, not secrecy**. The Supabase anon key is public by design — **RLS + the RPC `EXECUTE` allowlist are the control**. Any key in an APK is extractable; obfuscation raises cost only.
- **Maps key — do both Google options correctly.** "Domain-only" restriction is for **web** keys (HTTP referrer). For **Android** the restriction is **package name + SHA-1 of the Play App Signing release certificate** (not the debug cert). Use **separate keys per platform**, restrict each to only the APIs used, set quotas + budget alerts. **Preferred end state:** proxy Places-autocomplete / geocoding through an **authenticated, per-user rate-limited Edge Function** so no Maps key ships at all; keep the restricted key only if the proxy is not worth it for MVP (state which and why).
- **Play Integrity** (and/or Firebase App Check): verify the token **server-side** with a nonce bound to the action. Use it as a **risk signal**, not a blanket gate (don't lock out legitimate users on MVP); **hard-gate only high-risk actions**: withdrawal, payout-destination change, promo spend.
- **Stack stays**: Expo + Next.js + Supabase. Android + web remain one codebase. Admin remains its own app.

## 4. Phase 1 — Baseline & threat model (read-only)

1. **Version control & CI.** Verify git status of each folder; confirm `.env*`, `.next`, `node_modules`, `supabase/.temp` are ignored; scan **git history** for secrets (gitleaks/trufflehog) if a repo exists. Propose, don't force, a repo layout if none exists.
2. **Inventory** every entry point: PostgREST tables/views/RPCs/storage buckets/Realtime channels exposed to `anon` and `authenticated`; every Edge Function (method, `verify_jwt`, CORS, secrets used); every admin route, server action and route handler; every Android component/deep link/permission.
3. **Run the baselines and record them**: Supabase `get_advisors` (security **and** performance), `npm run check`, `npm run test:db`, `npm audit` (all three package trees), `tsc`, lint.
4. **Threat model** (`docs/audit/THREAT_MODEL.md`): actors (anonymous, poster, worker, colluding poster+worker, malicious admin/insider, compromised admin session, leaked-key holder, bot/farm, curious reverse-engineer), assets (escrow/wallet money, payout destinations, PII/phone, chat, media, admin console, secrets), trust boundaries, and top abuse cases. Use **OWASP ASVS L2**, **OWASP API Security Top 10 (2023)**, **OWASP MASVS** as the checklists.

## 5. Phase 2 — Sync verification: admin → user apps

Goal: make "I changed it in admin, the user sees it" a **tested guarantee**, not a hope.

1. **Build `docs/audit/SYNC_MATRIX.md`.** One row per admin write (mark payout, resolve dispute, send refund, wallet adjustment, setting change e.g. fees/waiting periods, suspend/role change, promotion changes, support reply/resolve, CRM message/segment actions, task intervention…) × the user surface(s) that must change (Android screen, web screen) × propagation mechanism (Broadcast / Realtime / notification row / refetch-on-focus / none) × **max latency target** × current state (OK / stale / polling / missing).
2. **Design rule to enforce (DB is the single source of truth):** every admin mutation is an `admin_*` RPC that, **in one transaction**, (a) checks `is_admin` **and** recent MFA/step-up for money actions, (b) writes an **append-only audit log row** (who, what, before→after, reason, IP/UA), and (c) produces its user-visible effect — a `notifications` row and/or a Realtime **Broadcast** to the affected user's **private** channel (e.g. `realtime.broadcast_changes` from a trigger). **A change cannot happen without being visible and recorded.**
3. **Client rule:** one realtime subscription per signed-in user (private Broadcast channel) that **invalidates caches**; plus refetch on **app foreground, network reconnect, and web tab visibility**; remove polling wherever Broadcast replaces it; every channel is removed on unmount/sign-out (check the `${++notifChannelSeq}` pattern in `data/extras.ts` for leaks). Prefer **Broadcast over Postgres Changes** for fan-out — Supabase documents that Postgres Changes authorizes per subscriber and is single-threaded, and recommends Broadcast beyond roughly 3,000 concurrent subscribers on the same changes.
4. **Never trust client math or cached settings.** A stale fee/setting on a device must not let anyone underpay: the server recomputes on every money RPC (`packages/rules` is the source; screens only format).
5. **Automated tests (these are deliverables):**
   - **Playwright, multi-context**: admin (`:3001`) + user web (`:8081`) side by side; for each matrix row assert the user-visible change within its latency target.
   - **Android**: emulator + Maestro (or adb/UI Automator) running the same rows against the same staging DB.
   - Also assert: offline → online recovery; app killed → reopened shows new state; two devices of one user converge; **no admin-only data (e.g. commission) leaks through the sync channel**.
6. Output: pass/fail per row, and a prioritized list of **gaps** (ordered by money risk: wallet, payouts, refunds, disputes first).

## 6. Phase 3 — Security audit & penetration test (own staging only)

Work each area; log findings in `docs/audit/SECURITY_FINDINGS.md`.

### 3A. Database & API surface (the main attack surface — clients talk to PostgREST directly)
- **RLS**: every table in an exposed schema has RLS enabled **and** correct policies; test as `anon`, as user A, as user B, as admin. **BOLA/IDOR**: user A reading/updating B's tasks, quotes, assignments, messages, tickets, payout destinations, wallet rows, notifications, media.
- **BOPLA / mass assignment**: can a user `PATCH` their own `profiles`/`user_roles`/wallet/KYC/level/verified columns? Use **column-level grants** (not just policies) where only some columns are user-writable. Never authorize on `user_metadata` (user-editable); roles come from `user_roles` / `app_metadata`.
- **BFLA**: call every `admin_*` and service-only RPC as a normal user through `/rest/v1/rpc/...`. Re-verify the 047 allowlist; diff `EXECUTE` grants against it. Every `SECURITY DEFINER` function: pinned `search_path`, guard, argument validation (negative/zero/huge amounts, NULLs), deliberate grant.
- **Views** must be `security_invoker` (or replaced by functions); no view silently bypasses RLS.
- **RLS performance & safety**: policies use `(select auth.uid())`, policy columns are indexed, no unindexed subqueries in policies.
- **Storage** (`task_media` etc.): public vs private, listing allowed?, path ownership (can A overwrite B's object?), MIME/size caps, SVG/HTML upload → stored XSS, signed-URL lifetimes, video cost caps.
- **Realtime authorization**: can a user subscribe to another user's `messages:{taskId}` / notifications channel? Move to **private channels with RLS on `realtime.messages`**.
- **Data API hygiene**: unused schemas not exposed; PostgREST max rows set; no `service_role` use to "make a query return something".

### 3B. Authentication & sessions
- **OTP flow** (`phone-auth`): brute-force/resend bypass (re-verify the `attempts` carry-over fix), send-side throttle per phone **and** per IP/device, SMS-pumping/cost abuse, code entropy/expiry/single-use, constant-time compare, `TEST_PHONES` **unset in production**, enumeration via error text/timing.
- **Account takeover via the magic-link mechanism** (`generateLink("magiclink")`): can someone pre-register the synthetic email, or obtain a link without a verified OTP? Is email signup disabled if unused?
- **Password flow** (`password-auth`): per-username + per-IP throttle uses a **trustworthy client-IP header** (not a spoofable one); lockout/backoff; uniform responses; password policy; leaked-password protection (owner toggle); hashing is Supabase's.
- Supabase Auth rate limits tuned (`rate_limit_sms_sent`, `rate_limit_otp`, `rate_limit_verify`, `rate_limit_token_refresh`); captcha on signup/OTP-send if abuse is observed; JWT expiry and refresh-token rotation sane; sign-out revokes.
- **Token storage**: Android tokens in **`expo-secure-store`** (Keystore-backed), not plain AsyncStorage; on web, understand and document the localStorage/XSS tradeoff.

### 3C. Money & business logic (highest consequence)
- **Race conditions / double-spend**: concurrent `request_withdrawal`, `confirm_release`, `fund_task`, `cancel_task`, refund, promo spend — use real parallel requests; confirm row locks / advisory locks / unique constraints hold; **idempotency keys** on every money RPC and every outbound Razorpay/RazorpayX call.
- **Amount tampering**: client-supplied amounts/ids on pay-in (order amount vs task amount), negative/zero/overflow, float coercion; **integer paise only**.
- **Webhooks** (`razorpay-webhook`, `razorpayx-webhook`): HMAC-SHA256 over the **raw** body with **constant-time** compare, 401 on mismatch (keep — it's correct); **dedupe on `x-razorpay-event-id`**; handle out-of-order and replayed events; never mark paid from a client redirect; reconcile amount/currency/order against your own record.
- **Payout abuse**: change payout destination then immediately withdraw → require **re-auth (OTP) + cooling-off**; collusion/self-dealing (poster = worker via two accounts), referral and promo-credit farming, dispute abuse, auto-release timing games.
- **Admin money actions** (manual payout, refund, wallet adjustment): step-up auth, **dual control above a threshold**, mandatory reason, immutable audit row, alert on every adjustment.
- **Reconciliation**: a daily job comparing ledger vs Razorpay/RazorpayX; escrow-conservation invariant checked continuously; alert on drift.

### 3D. Edge Functions
- For each function: method allow-list, body size cap, schema validation (zod via `packages/schemas`), `verify_jwt` justified in writing, **CORS restricted to known origins for browser-called functions** (webhooks are server-to-server, no CORS needed), rate limiting (Supabase's Redis/Upstash pattern or DB-backed), no secret/PII in logs, SSRF-safe outbound calls, `razorpay-setup` single-shot guarantee holds.

### 3E. Admin panel
- **Next.js**: stay on a patched 15.x (CVE-2025-29927 is fixed in ≥15.2.3 — pin and watch advisories); keep authz **in the data layer/layout/handlers, never middleware alone**.
- **Every server action and route handler re-checks admin itself** (they are public POST endpoints). Test by calling each directly without a session, and as a non-admin session.
- **Step-up**: enforce Supabase **MFA (TOTP) / AAL2** for money actions and role changes; short admin session lifetime; idle timeout; Google sign-in restricted to the staff domain/allow-list.
- **Network**: admin on its own subdomain; Vercel Firewall / WAF rate limits; **IP allow-list** or a zero-trust gate if the team size allows.
- **Headers**: strict **CSP** (nonce-based), HSTS, `frame-ancestors 'none'` (+ `X-Frame-Options`), `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`; cookies `HttpOnly; Secure; SameSite`.
- **Open redirect** in `/auth/callback` (`next=` param); CSRF on route handlers; **CRM export**: neutralize CSV formula injection (`= + - @` prefixes), minimize/mask PII, rate-limit, **audit every export**.
- **Service-role client**: used only in server-only modules (`import 'server-only'`), only for the listed read-only needs; confirm it can never reach a client bundle (`NEXT_PUBLIC_` audit of build output).
- **Audit log** is append-only (no UPDATE/DELETE grants, even for admins) and viewable in admin.

### 3F. Android (build a **release** AAB/APK and attack that, not the dev build)
- **Static**: unzip the release build; `strings`/grep for secrets and URLs; **Hermes bytecode** disassembly for embedded keys; MobSF scan; confirm R8/minify on, Hermes on, source maps not shipped, no debug flags, signed by Play App Signing.
- **Manifest**: exported activities/receivers/providers; deep link scheme `taskdrop://` — intent/redirect hijack and auth-token leakage via links; confirm `allowBackup=false`, cleartext off, background location blocked (already set — verify in the built manifest, not just `app.json`).
- **Permissions**: justify each (`CAMERA`, `RECORD_AUDIO`, `READ_MEDIA_*`, location); remove unused; align with Play's photo/video permission policy.
- **Dynamic** (own device/emulator): proxy traffic with mitmproxy; confirm TLS enforced, tokens never in URLs/logs, nothing sensitive in logcat; attempt API calls with extracted anon key to prove RLS holds; test on rooted/emulated device only to record behaviour.
- **Platform hygiene**: `FLAG_SECURE`/screenshot blocking on wallet/payout screens (decide, document); clipboard exposure; WebView use (none or locked down); OTA update integrity (EAS Update code signing if used); **certificate pinning is optional at MVP** — it can brick the app if misconfigured; if added, use public-key pins **with a backup pin** and a tested rollback.
- **Play Console readiness** (verify against current policy; not legal advice): **in-app account deletion + web deletion link**, accurate **Data Safety** form, target-API-level requirement, permission declarations, **Play App Signing** SHA-1 registered in the Maps/Google key restriction.
- **Version skew**: old APKs live for months. All server changes are **expand/contract, backward-compatible**; add a **minimum-supported-version** gate (remote flag) so a broken/insecure old build can be retired.

### 3G. Web app
- XSS via user-generated content (task descriptions, chat, names): no `dangerouslySetInnerHTML`, safe link handling (block `javascript:`/`data:`), `rel=noopener noreferrer`.
- Hosting headers for the static export: CSP, HSTS, frame-ancestors, Referrer-Policy, Permissions-Policy (via the host's headers file).
- Open redirects in auth/payment return URLs; `postMessage`/origin checks; Razorpay return flow can't be spoofed into marking an order paid.
- Browser-callable Edge Functions reject foreign `Origin`.

### 3H. Supply chain, secrets, ops
- `npm audit` / `osv-scanner` / Semgrep on all three trees; lockfiles committed; Dependabot/Renovate; **no `--force` into a breaking Expo major**.
- Secrets inventory: where each lives, who can read it, rotation procedure; Vault usage reviewed; GitHub secret scanning/push protection once a remote exists.
- **Backups & recovery**: Supabase PITR enabled?; documented **restore drill**; migration rollback plan.
- **Logging/monitoring/alerting**: auth-failure spikes, OTP-send spikes (SMS cost), webhook failures, wallet adjustments, admin exports, 5xx; no PII/secrets in logs; error tracking (e.g., Sentry) in all three apps.
- **Privacy (India)**: DPDP-Act-style consent, deletion/export flow, breach-notification runbook (flag for the owner/counsel; not legal advice). Cards are never stored — Razorpay-hosted checkout.

## 7. Phase 4 — Scalability readiness (measure, don't guess)

**Design principle:** the code gets *seams* now so that scaling is a configuration change later. Verify each seam exists; add the cheap ones in Phase 5; defer the expensive ones with a documented trigger ("do X when metric Y crosses Z").

1. **Single data seam.** All client data access stays in `apps/mobile/src/data/api.ts` (+ `extras.ts`) and admin `lib/data.ts`. Add **contract tests** so the backend could later move behind an API service without touching a screen.
2. **Versioned, backward-compatible API surface** (RPC names/params; expand/contract migrations) — protects old APKs and enables zero-downtime deploys.
3. **No unbounded reads.** Keyset (cursor) pagination everywhere; hard `limit`s; the admin earnings loop (`.range(from, from+999)` in `lib/earnings.ts`) replaced by pre-aggregated tables (`admin_earnings_daily` already exists — extend the pattern to dashboards/reports).
4. **Indexes & RLS performance.** `EXPLAIN (ANALYZE, BUFFERS)` the top 20 queries (feed, my tasks, wallet, messages, admin lists) at 10×/100×/1000× synthetic data; fix seq scans; keep policies index-friendly.
5. **Connections.** Clients/Edge Functions use the **transaction-mode pooler (Supavisor)**; no session state across transactions (use `set_config(..., true)` for per-transaction context); define pool-size budget; admin heavy reads → **read replica** when needed.
6. **Realtime.** Broadcast-based fan-out, private per-user channels, no channel leaks, no polling loops (`LiveWorkers`, `PresenceBeat`, `AddFundsSheet`) that scale linearly with users — replace with Presence/Broadcast or server-throttled aggregates.
7. **Async work off the request path.** Queue (pgmq / `pg_cron` + Edge Function workers) for notifications, push, SMS, payouts, webhook processing, CRM sends; **idempotent consumers + dead-letter table**; webhook handlers ack fast and process async.
8. **Money data model.** Append-only **double-entry ledger**, idempotency keys, deterministic locking order; **partition-ready** (time-partitioned) `ledger`, `messages`, `notifications`, `events`, `audit_log` with an archival policy — design now, partition when row counts cross a threshold.
9. **Media.** Private bucket + signed URLs, CDN in front, server-side size/type caps, image/video transforms; egress budget.
10. **Edge/CDN/cache.** Public, cacheable reads (e.g. `platform_stats`) cached at the edge; rate limits at the edge/WAF before the DB.
11. **Operability.** Feature flags and **kill-switches operated from admin and effective in user apps** (pause withdrawals, pause signups, force-update, maintenance banner) — this reuses the Phase 2 sync mechanism.
12. **Cost guards.** Budgets + alerts for SMS, Maps, egress, Edge invocations, Razorpay fees.
13. **Load & capacity tests (staging, owner-approved caps).** k6 scenarios at 1k → 10k → 100k simulated users covering browse feed, post task, quote, chat, wallet read, withdraw, admin dashboards; record p50/p95/p99, DB CPU, connections, Realtime message rates; write **`docs/audit/SCALE_READINESS.md`** with measured limits, bottlenecks, and a runbook: *"at metric Y do X"* (compute upgrade, add replica, enable partitioning, move Realtime fan-out, add queue workers, split a service **only if** measured).
14. **Explicitly not now:** microservices, Kubernetes, multi-region active-active, custom auth, sharding. State the trigger that would justify each.

## 8. Phase 5 — Fix (only after the owner approves the plan from Phases 1–4)

**Priority**
- **P0** — lets a non-admin read/move others' money or data, forges/replays money events, or exposes a server secret. Fix first; ship each with a test that **fails before and passes after**.
- **P1** — abuse/cost/DoS vectors (OTP/SMS), admin hardening (MFA, headers, server-action authz, export injection), sync gaps on money screens, CORS/JWT config, key restriction/proxy.
- **P2** — scale seams, polling→Broadcast elsewhere, pagination, partition-readiness, observability, hygiene.

**Order:** P0 → CI (so fixes stay fixed) → P1 → sync gaps → P2 → scale seams → docs. Do not start P2 while a P0 is open.

**How to ship**
- Migrations are **append-only** with the existing timestamp-prefix convention; never edit an applied migration.
- **Prove DB changes in a rolled-back transaction** against staging (pattern: `supabase/tests/money_rules.test.sql`); extend `rpc_surface.test.sql` and add RLS/BOLA tests as SQL suites; wire all into `npm run test:db`.
- Run Supabase **security + performance advisors before and after**; target **zero ERROR**, every surviving WARN fixed or justified in a comment.
- Anything a user can see changing: **say so before shipping.** Do not touch screen layout.
- Small, reviewable commits/PRs per finding; each links its finding ID.

## 9. Phase 6 — Verify & report

Deliverables in `docs/audit/`:
- `THREAT_MODEL.md`, `SYNC_MATRIX.md` (with pass/fail), `SECURITY_FINDINGS.md`, `SCALE_READINESS.md`, `TEST_REPORT.md` (what ran, where, results, how to re-run).
- Automated suites committed and runnable by one command each: `npm run test:db`, the Playwright sync suite, the Android Maestro suite, a k6 load profile, a headers/CSP check, a "no secrets in bundle/APK" CI check, and `npm audit`/`osv-scanner` in CI.
- A **one-page owner brief**: what was fixed, what was deliberately left (and why), what only the owner can do (rotate keys, dashboard toggles, MFA enrollment, Razorpay KYC, enable PITR, create staging, Play Console forms), and the "do X when Y" scaling triggers.

## 10. Done means

- **Sync:** every `SYNC_MATRIX` row passes on Android and web within its latency target; money rows are real-time.
- **Security:** zero Critical/High open; zero ERROR advisories; a non-admin cannot call any admin/service RPC or server action; no real secret in APK, bundle, source maps, or git history; webhooks signature-verified, deduped, and replay-safe; admin has MFA step-up, strict headers, and an audit log.
- **Scale:** every seam in §7 present or consciously deferred with a written trigger; measured capacity numbers exist; no unbounded query or polling loop on a hot path.
- `npm run check`, `npm run test:db`, the sync suites, and CI are green; `npm audit` clean at moderate+.
- The owner brief is written.

## Reading list (verified sources — read before relying on a claim)

- Supabase RLS & keys: https://supabase.com/docs/guides/database/postgres/row-level-security · https://makerkit.dev/blog/tutorials/supabase-rls-best-practices · https://www.stingrai.io/blog/supabase-powerful-but-one-misconfiguration-away-from-disaster
- Supabase Auth rate limits & Edge rate limiting: https://supabase.com/docs/guides/auth/rate-limits · https://supabase.com/docs/guides/functions/examples/rate-limiting
- Realtime scaling: https://supabase.com/docs/guides/realtime/postgres-changes
- Connection pooling: https://supabase.com/blog/supavisor-1-million · https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI
- Multi-tenant Postgres patterns: https://clickhouse.com/resources/engineering/multi-tenant-saas-postgres-architecture
- OWASP API Security 2023: https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/ · https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/
- OWASP Mobile: https://mas.owasp.org/MASVS/ · https://mas.owasp.org/MASTG/ · https://mas.owasp.org/MASTG-KNOW-0035/ (Play Integrity)
- Google API-key restriction & App Check: https://developers.google.com/maps/api-security-best-practices · https://docs.cloud.google.com/docs/authentication/api-keys
- Razorpay webhooks: https://razorpay.com/docs/webhooks/validate-test · https://razorpay.com/docs/webhooks/best-practices
- Next.js middleware bypass: https://nvd.nist.gov/vuln/detail/CVE-2025-29927 · https://securitylabs.datadoghq.com/articles/nextjs-middleware-auth-bypass/
- Expo SecureStore (use the **versioned** docs named in `apps/mobile/AGENTS.md`): https://docs.expo.dev/versions/latest/sdk/securestore/

## Out of scope

No UI redesign, no monorepo restructuring, no library swaps, no separate backend server, no microservices, no real-money or production load testing, no legal advice. If you believe any is required, **stop and make the case.**
