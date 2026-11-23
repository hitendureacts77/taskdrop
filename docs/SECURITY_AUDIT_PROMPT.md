# Task 2.20: audit-prompt results (round 1)

Run on 23 Nov 2026 by Claude (Sonnet 5.5), read-only, against origin/redesigned-2.0 of both code folders (user repo: app plus supabase; admin repo: Next.js panel). Prompt: [docs/prompts/AUDIT_PROMPT_2_20.md](prompts/AUDIT_PROMPT_2_20.md), 41 items in 8 sections. No secret value was printed or copied. Items marked "Reasoned, not seen" say what was not checked; everything else was read in the code.

PARTIAL is not a clean pass but is not a FAIL. Every FAIL carries a severity and a one-line fix. H numbers (from H81) are assigned when the owner adds the findings to the holes table; the plan was not edited by this run.

## 1. Security posture rating

**ACCEPTABLE (yellow).** No Critical or High finding in either folder. The database is closed by default (RLS on all tables, client writes revoked, SECURITY DEFINER functions pin search_path), every server function has a lock and a limit, webhooks are signed, uploads are private and checked on the server, and the admin panel has strong cookies, CSP and timeouts. What is left: web sign-in tokens in localStorage, the staging-only any-code sign-in switch, the gateway lockdown still waiting for task 3.9, and a few Low tidy-ups.

| Folder | PASS | FAIL | PARTIAL | N/A |
|---|---|---|---|---|
| Taskdrop user (app + supabase) | 29 | 2 | 9 | 1 |
| Taskdrop administrator | 24 | 1 | 5 | 11 |
| Total (82 verdicts) | 53 | 3 | 14 | 12 |

## 2. Critical and High findings

None.

## 3. Findings

| # | Sev | Folder | Item | Location | What | One-line fix |
|---|---|---|---|---|---|---|
| F1 | MEDIUM | user | 3.5 FAIL | apps/mobile/src/lib/secureStorage.ts:63 | Web build keeps the session in localStorage; an XSS would expose the refresh token | Add a nonce script-src CSP to the web build, or use an httpOnly-cookie sign-in route |
| F2 | MEDIUM | user | 6.2 PARTIAL | supabase/functions/phone-auth/index.ts:76-82 | ALLOW_ANY_OTP=1 on staging accepts code 000000 for any number (known switch, blocked for production by scripts/lib/prod-safety.mjs:19) | Turn it off on staging before outside testers; keep the production check in CI |
| F3 | MEDIUM | user | 3.6 PARTIAL | supabase/lockdown/gateway_only.sql (waits for plan 3.9) | Gateway-only lockdown not on yet: the database also answers calls made with just the public key (reasoned, not seen on the live project) | Run the lockdown when task 3.9 comes |
| F4 | LOW | user | 4.5 FAIL | supabase/functions/razorpay/index.ts:327,343 (also razorpayx-payouts/index.ts:96) | Raw database error text returned to the caller | Log it, return a fixed message |
| F5 | LOW | admin | 4.5 FAIL | src/lib/actions.ts:135,175 | Raw error text shown to staff | Fixed message, log the detail |
| F6 | LOW | admin | 1.6 PARTIAL | src/middleware.ts:75-76 | Missing ADMIN_SESSION_SECRET turns the idle timeout off | Fail closed when it is missing |
| F7 | LOW | admin | 3.1, 3.2 PARTIAL | src/middleware.ts:192-260 | Middleware does not gate; protection is per page and layout | Redirect to /login in middleware except an allow-list |
| F8 | LOW | user | 7.1 PARTIAL | supabase/functions/_shared/cors.ts:18-35 | Unset ALLOWED_ORIGINS falls back to the staging list and localhost | Fail closed in production when unset |
| F9 | LOW | user | 6.3 PARTIAL | supabase/functions/_shared/rateLimit.ts:28-29 | Limiter fails open when its counter is down (designed) | Keep; alarm on limiter errors |
| F10 | LOW | both | 4.1 PARTIAL | supabase/functions/api/core.ts:136-160; admin src/lib/data | Hand-written validators, no schema library on the server | Reuse the packages/schemas Zod types in api ops over time |
| F11 | LOW | user | 5.1 PARTIAL | audit-exceptions.json | 12 moderate advisories in Expo build tools (accepted, review 2 and 13 Dec) | Re-check on the review dates |
| F12 | LOW | user | 5.5 PARTIAL | apps/mobile/package.json | @taskdrop/schemas and expo-symbols unreferenced | Remove if truly unused |
| F13 | LOW | user | 2.8, 5.4 PARTIAL | supabase/migrations | Definer functions sampled, not read one by one; outdated check not possible from the lockfile | Run npm outdated after npm ci; read the definer list in round 2 |

## 4. Quick wins

F4 and F5 (a fixed error message, about 5 minutes each), F6 (one line), F12.

## 5. Fix order

F1, F2 (before outside testers, plan 2.18), F3 (task 3.9), then F4 to F8, then F9 to F13. Per the plan, run round 2 from a fresh session after the fixes; stop when no FAIL is left or after round 3.

## 6. Already done right

RLS on every table with an auto-enable trigger; client writes revoked; definer functions pin search_path; private storage with a scoped read policy; signed, constant-time webhooks; server-side upload checks; per-IP and per-number SMS limits; gitleaks, secret-guard and build scan, with source maps removed after upload; production-safety guards for dev switches; admin HttpOnly cookies, nonce CSP, idle and 12 h timeouts, MFA, admin role check on every route and action; CORS allow-list with no credentials.

## 7. Checklist summary

**User:** 1.1 PASS | 1.2 PASS | 1.3 PASS | 1.4 PASS | 1.5 PASS | 1.6 PASS | 2.1 PASS | 2.2 PASS | 2.3 PASS | 2.4 PASS | 2.5 PASS | 2.6 PASS | 2.7 PASS | 2.8 PARTIAL | 3.1 PASS | 3.2 PASS | 3.3 PASS | 3.4 PASS | 3.5 FAIL | 3.6 PARTIAL | 3.7 PASS | 3.8 N/A | 4.1 PARTIAL | 4.2 PASS | 4.3 PASS | 4.4 PASS | 4.5 FAIL | 4.6 PASS | 5.1 PARTIAL | 5.2 PASS | 5.3 PASS | 5.4 PARTIAL | 5.5 PARTIAL | 6.1 PASS | 6.2 PARTIAL | 6.3 PARTIAL | 7.1 PARTIAL | 7.2 PASS | 8.1 PASS | 8.2 PASS | 8.3 PASS

**Admin:** 1.1 PASS | 1.2 PASS | 1.3 PASS | 1.4 PASS | 1.5 PASS | 1.6 PARTIAL | 2.1 N/A | 2.2 N/A | 2.3 N/A | 2.4 N/A | 2.5 PASS | 2.6 N/A | 2.7 PASS | 2.8 N/A | 3.1 PARTIAL | 3.2 PARTIAL | 3.3 PASS | 3.4 PASS | 3.5 PASS | 3.6 PASS | 3.7 PASS | 3.8 N/A | 4.1 PARTIAL | 4.2 PASS | 4.3 PASS | 4.4 PASS | 4.5 FAIL | 4.6 N/A | 5.1 PASS | 5.2 PASS | 5.3 PASS | 5.4 PASS | 5.5 PASS | 6.1 PASS | 6.2 PASS | 6.3 PARTIAL | 7.1 PASS | 7.2 PASS | 8.1 N/A | 8.2 N/A | 8.3 N/A

## 8. Verdicts: Taskdrop user (app + supabase)

| Item | Verdict | Proof or note |
|---|---|---|
| 1.1 Hardcoded secrets | PASS | Grep for sk_/rzp_/ghp_/AKIA/eyJ/github_pat_ across apps, supabase, scripts: hits only in scanner rules and tests (scripts/lib/secret-patterns.mjs:13-18, secret-guard.test.mjs, keyMode.test.ts use generated fakes). |
| 1.2 .gitignore + history | PASS | .gitignore:13-15 (.env, .env.*, !.env.example); git log --all for .env files shows only .env.example and apps/admin/.env.example; a history scan for key-shaped text finds only scanner commits with fixtures (82f78ca, 9b0684a, 27ec0aa). |
| 1.3 Public-prefix leaks | PASS | EXPO_PUBLIC_* holds only public values (Supabase URL and anon key, Firebase web key, Sentry DSN, reCAPTCHA site key, legal text). EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN (appCheck.ts:32) is blocked for production (apps/mobile/variant.cjs:89, scripts/lib/prod-safety.mjs:21-22). |
| 1.4 Console/error leaks | PASS | Only 4 console calls in the app (errors.ts:88 and monitoring.ts:136 are __DEV__ only; AuthProvider.tsx:322,336 log an error code and message, no tokens). Edge functions log request ids only (api/index.ts:197). |
| 1.5 Source maps | PASS | Web export uses --source-maps (apps/mobile/package.json:11) but scripts/upload-web-sourcemaps.mjs:41-51 sends them to Sentry and deletes the .map files before deploy; scripts/check-exposed-files.mjs:43 and scan-build.mjs check the build. |
| 1.6 Startup validation | PASS | scripts/vercel-build.mjs:87-91 fails the deploy on missing or short required env (scripts/lib/required-env.mjs); edge functions answer 503/500 and log when secrets are missing (money-webhook/index.ts:33-36, api/index.ts:195-198). |
| 2.1 RLS on every table | PASS | All 80 tables created across 188 migrations are covered: 70 have an explicit ENABLE RLS; the rest (crm_*, user_suspensions) are enabled in a loop in the same migration, and the ensure_rls event trigger (public.rls_auto_enable, supabase/tests/auto_enable_rls.test.sql) enables RLS on any new public table. |
| 2.2 RLS policies exist | PASS | Read policies exist (profiles_select_all, settings_select_authenticated, staff read policies). By design there are no client INSERT/UPDATE policies: writes are revoked from anon and authenticated ('revoke insert, update, delete on all tables in schema public from authenticated') and go through the api function and definer RPCs. |
| 2.3 WITH CHECK | PASS | The only write policies (settings_admin_*, roles_admin_*) carry WITH CHECK (private.is_admin()); direct table writes are revoked for authenticated, so there is no ownership-swap path. |
| 2.4 Policy identity source | PASS | grep user_metadata over all 188 migrations: 0 hits. Policies use auth.uid() and private.is_admin(). |
| 2.5 Service-role isolation | PASS | Service key is used only in supabase/functions and packages/supabase createServiceClient; apps/mobile never imports it. |
| 2.6 Storage buckets | PASS | Bucket task-media is public=false, 50 MB, mime allow-list; read policy 'task media: scoped reads' limits to the owner folder or private.can_read_task_media. |
| 2.7 SQL injection | PASS | No SQL built from strings. PostgREST .or() text filters strip , ( ) * % \ first (api/reads.ts:257-258); other filters use validated uuids and timestamps. |
| 2.8 SECURITY DEFINER | PARTIAL | 573 SECURITY DEFINER definitions; every one sets search_path (script check: 0 without); execute revoked from public/anon (535 revoke lines); tested by supabase/tests/rpc_caller_checks.test.sql and rpc_surface.test.sql. Each function's own caller check was sampled, not read one by one. Reasoned, not seen. |
| 3.1 Auth middleware | PASS | Adapted: no Next middleware. The api function verifies a token on every call (api/index.ts:187-233, verify_jwt = true in config.toml) and scripts/check-endpoints.mjs confirms every function has a lock and a limit or a written reason. |
| 3.2 Default-deny | PASS | api refuses every request without a verified token (index.ts:187, 233-237); the only open paths are an explicit guest allowlist (handleGuest, api/guest.ts) and signed webhooks. |
| 3.3 getUser vs getSession | PASS | Token checked with getClaims against the project's public keys (api/index.ts:228-231); no getSession on the server. |
| 3.4 Auth callback | PASS | OAuth code exchanged with exchangeCodeForSession (apps/mobile/src/providers/AuthProvider.tsx:336); errors log code and message only; return address validated by _shared/returnUrl.ts. |
| 3.5 Session storage | FAIL (MEDIUM) | Web build keeps the Supabase session (access and refresh token) in localStorage via AsyncStorage (apps/mobile/src/lib/secureStorage.ts:63, web branch). The phone build uses SecureStore (Keystore) and is fine. An XSS on the web app could read the refresh token; mitigations present: no innerHTML sinks in app code, frame/base/object CSP (vercel.json:16). Fix: Add a nonce script-src CSP to the web build, or move web sign-in to an httpOnly-cookie server route. |
| 3.6 Protected API routes | PARTIAL | Every op goes through api (token check) and the other functions pass check-endpoints.mjs. Gap (reasoned, not seen on the live project): the gateway-only lockdown (private.require_gateway, supabase/lockdown/gateway_only.sql) is built but waits for task 3.9 (docs/ULTIMATE_PLAN.md:2600), so until then PostgREST also answers calls made with only the public key; row rules and revoked write grants are the barrier. |
| 3.7 OAuth security | PASS | PKCE code exchange through Supabase (AuthProvider.tsx:336); state handled by supabase-js; return-URL allow-list (_shared/returnUrl.ts). |
| 3.8 Password reset | N/A | No email or password-reset flow. Users sign in by phone code or username and password; password-auth only checks and records attempts (password-auth/index.ts:113). |
| 4.1 Schema validation | PARTIAL | Server validates every field with hand-written helpers (api/core.ts:136-160 uuid/uuids/oneOf/bad; writes.ts:106,117 path checks). Zod lives only in packages/schemas (client forms). It works, but there is no single schema library on the server. |
| 4.2 Identity from session | PASS | api/writes.ts:14 states and the code follows it: user id comes from ctx.userId (the verified token), never from args; media paths must start with the caller's own id (writes.ts:106,117). |
| 4.3 XSS sanitising | PASS | grep dangerouslySetInnerHTML and innerHTML in apps/mobile: 0 hits; React Native renders text. |
| 4.4 HTTP methods | PASS | api accepts POST only (index.ts handle(): BAD_METHOD 405); money and auth functions are POST. |
| 4.5 Error leaks | FAIL (LOW) | supabase/functions/razorpay/index.ts:327 and :343 return error.message (a raw database error) to the signed-in caller; same pattern in razorpayx-payouts/index.ts:96 and razorpay-webhook/index.ts:124 (server-to-server). Fix: Log the error and return a fixed 'Something went wrong' text, as api/core.ts does. |
| 4.6 Webhook signatures | PASS | Razorpay: HMAC-SHA256 with constant-time compare (razorpay-webhook/index.ts:41-89); money-webhook through provider.verifyWebhook (index.ts:44-50); Inngest verifies INNGEST_SIGNING_KEY (inngest/index.ts:56). |
| 5.1 npm audit | PARTIAL | npm audit on the lockfile: 12 moderate, 0 high, 0 critical; all in Expo build tools and listed with reasons and review dates in audit-exceptions.json (2026-12-02 and 2026-12-13). |
| 5.2 Hallucinated packages | PASS | All 46 mobile dependencies and the edge npm import (inngest@4.23.0) are well-known packages. |
| 5.3 Lockfile | PASS | package-lock.json committed; scripts/check-lockfile.mjs runs in CI. |
| 5.4 Outdated | PARTIAL | npm outdated could not be evaluated from the lockfile alone (0 entries returned); known advisories are covered by 5.1. Not verified. |
| 5.5 Unused deps | PARTIAL | Not referenced anywhere in apps/mobile: @taskdrop/schemas and expo-symbols (the other flagged ones are Expo runtime/plugin packages). |
| 6.1 Limits on paid calls | PASS | Paid calls (SMS, Razorpay, Places) are limited: phone-auth per IP, number and day (phone-auth/index.ts:268-290, hit_auth_send_ip); razorpay and money use withinRate; places-search uses take_places_daily (index.ts:118); scripts/check-endpoints.mjs enforces it. |
| 6.2 Limits on auth endpoints | PARTIAL | OTP: 5 guesses (phone-auth/index.ts:57,425) and sends per IP; password: lockout per username and IP (password-auth). Caveat: ALLOW_ANY_OTP=1 on staging accepts code 000000 for every number (phone-auth/index.ts:76-82), see F2. |
| 6.3 Limiter implementation | PARTIAL | Server-side counters in Postgres (api_rate_hit, _shared/rateLimit.ts) survive deploys. They fail open when the counter is unreachable (rateLimit.ts:28-29) by design; the SMS limiter refuses instead. |
| 7.1 CORS origins | PARTIAL | _shared/cors.ts uses an allow-list (no *) and guarded() decides CORS for every function (monitoring.ts:170-190). The public app-version endpoint answers * on purpose (app-download/index.ts:69). Gap: if ALLOWED_ORIGINS is unset, the staging list and localhost are allowed (cors.ts:18-35); production must set it (plan 5.9). |
| 7.2 CORS credentials | PASS | Access-Control-Allow-Credentials is never set (grep of the whole functions folder); tokens travel in the Authorization header. |
| 8.1 Upload validation | PASS | Image type from an allow-list (api/media.ts:99); size re-read from ImageKit file details on the server before attach (media.ts:178-186); the storage bucket enforces size and mime. |
| 8.2 Upload permissions | PASS | Files are private and delivered by signed URLs (media.ts:179, 223); path must start with the owner's id; bucket private. |
| 8.3 Execution prevention | PASS | Files go to ImageKit or Supabase Storage, never to a server directory; nothing is executed or served from the function. |

## 8. Verdicts: Taskdrop administrator

| Item | Verdict | Proof or note |
|---|---|---|
| 1.1 Hardcoded secrets | PASS | Same grep over src, scripts, next.config.mjs: no key-shaped literals; scripts/secret-guard.mjs and scan-build.mjs guard commits and the build. |
| 1.2 .gitignore + history | PASS | .gitignore:6-8 (.env, .env.*, !.env.example); history has only .env.example. |
| 1.3 Public-prefix leaks | PASS | Only NEXT_PUBLIC_SUPABASE_URL, _ANON_KEY, SENTRY_DSN, SENTRY_ENVIRONMENT; the service key is server-only (lib/supabase/service.ts:1-27, import 'server-only'). |
| 1.4 Console/error leaks | PASS | Only 3 console calls: security-event.ts:12 (scrubbed fields), middleware.ts:75 (names the missing variable, not a value), middleware.ts:243 (request path facts). |
| 1.5 Source maps | PASS | next.config.mjs has no productionBrowserSourceMaps; the Sentry plugin uploads maps and hides them (withSentryConfig). |
| 1.6 Startup validation | PARTIAL | scripts/check-required-env.mjs:15 fails the build when variables are missing, but ADMIN_SESSION_SECRET only needs to be present, and if missing at runtime the idle timeout silently turns off (src/middleware.ts:75-76). |
| 2.1 RLS on every table | N/A | The admin has no schema or migrations; the database it uses is audited in the user folder. |
| 2.2 RLS policies exist | N/A | Same: no schema here. |
| 2.3 WITH CHECK | N/A | Same: no schema here. |
| 2.4 Policy identity source | N/A | Same: no schema here. |
| 2.5 Service-role isolation | PASS | Service client only in server code (lib/supabase/service.ts:1 import 'server-only'); no NEXT_PUBLIC variant. |
| 2.6 Storage buckets | N/A | No storage buckets defined in this folder. |
| 2.7 SQL injection | PASS | Search text goes through likeTerm() (lib/data/users.ts:116,160; tasks.ts:96) and keyset filters use isTimestamp/isUuid (lib/data/activity.ts:92-94); no raw SQL. |
| 2.8 SECURITY DEFINER | N/A | No SQL functions defined in this folder. |
| 3.1 Auth middleware | PARTIAL | src/middleware.ts only refreshes the session and enforces idle and 12 h limits (lines 192-260); it does not redirect signed-out visitors. Gating is in (dashboard)/layout.tsx:26 requireAdmin(), in every dashboard page, every server action and every /api route. |
| 3.2 Default-deny | PARTIAL | Default-deny comes from the shared (dashboard) layout plus requireAdmin on pages; a new page outside that group would not be protected automatically. |
| 3.3 getUser vs getSession | PASS | lib/auth.ts:61 and middleware.ts:192 use getUser(); getSession() appears only after getUser to read claims (middleware.ts:198, api/live/token/route.ts:25 after checkAdmin). |
| 3.4 Auth callback | PASS | app/auth/callback/route.ts exchanges the code, checks admin, ends non-admin sessions and sends only fixed error codes. |
| 3.5 Session storage | PASS | Auth cookies are HttpOnly, Secure, max 12 h (lib/supabase/cookie-options.ts, middleware.ts:171-175). |
| 3.6 Protected API routes | PASS | All 8 /api routes: 7 call checkAdmin or withinRate; app/api/auth/ping/route.ts returns only {ok:true} by design. |
| 3.7 OAuth security | PASS | Google through Supabase code exchange; the callback re-checks the admin role (callback/route.ts). |
| 3.8 Password reset | N/A | No password-reset flow in the admin. |
| 4.1 Schema validation | PARTIAL | Hand-written checks (isUuid, cleanCode in lib/mfa-route.ts:30, likeTerm); no schema library. Server actions re-check the role on each call. |
| 4.2 Identity from session | PASS | Identity comes from checkAdmin()/requireAdmin() in every action (lib/actions.ts, admin-actions.ts). |
| 4.3 XSS sanitising | PASS | The only dangerouslySetInnerHTML is components/UpiQr.tsx:24, rendering an SVG made by the qrcode library from our own link; strict nonce CSP in middleware.ts:19-37. |
| 4.4 HTTP methods | PASS | State changes are POST routes and server actions; the GET routes (crm/export, reports/export, live) only read. |
| 4.5 Error leaks | FAIL (LOW) | src/lib/actions.ts:135 and :175 return 'Could not reach the payout service: ' plus error.message to the screen (staff only). Fix: Show a fixed message and log the detail. |
| 4.6 Webhook signatures | N/A | The admin receives no webhooks. |
| 5.1 npm audit | PASS | npm audit on package-lock.json: 0 vulnerabilities. |
| 5.2 Hallucinated packages | PASS | 8 runtime dependencies, all well known (next, react, react-dom, @sentry/nextjs, @supabase/ssr, supabase-js, qrcode, server-only). |
| 5.3 Lockfile | PASS | package-lock.json committed. |
| 5.4 Outdated | PASS | npm outdated: every dependency is at its latest version within range (next 16.4.6, react 19.3.1, supabase-js 2.119.2). |
| 5.5 Unused deps | PASS | All 8 dependencies are used (react-dom is required by Next). |
| 6.1 Limits on paid calls | PASS | Money and payout actions run behind admin role checks; live token 30 per minute (api/live/token/route.ts:19). |
| 6.2 Limits on auth endpoints | PASS | Admin sign-in 10 per minute per address (api/auth/password/route.ts:45) plus MFA route and per-username throttle in the shared database function. |
| 6.3 Limiter implementation | PARTIAL | Counter is the database function api_rate_hit (lib/rate-limit.ts:19), so it survives deploys; fail-open behaviour is the same as in the user folder. |
| 7.1 CORS origins | PASS | No CORS headers anywhere; same-origin only; Cross-Origin-Resource-Policy same-origin (next.config.mjs:25). |
| 7.2 CORS credentials | PASS | No Access-Control-Allow-Credentials. |
| 8.1 Upload validation | N/A | The admin has no file upload. |
| 8.2 Upload permissions | N/A | No uploads. |
| 8.3 Execution prevention | N/A | No uploads. |

