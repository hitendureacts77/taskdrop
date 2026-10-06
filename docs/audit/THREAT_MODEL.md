# Threat model — TaskDrop (Android + web + admin, one Supabase project)

Checklists used: OWASP ASVS L2, OWASP API Security Top 10 (2023), OWASP MASVS. 2026-10-04.

## Architecture and trust boundaries

```
 Android app (Expo) ─┐                       ┌─ Edge Functions: phone-auth, password-auth,
 Web app (same code) ┼─ anon key + user JWT ─┤   razorpay, razorpay-setup, razorpay-webhook,
                     │   PostgREST + RPC     │   razorpayx-payouts, razorpayx-webhook
 Admin (Next.js) ────┘   (+ service role,    └─ Postgres: RLS, SECURITY DEFINER RPCs, triggers,
   Google sign-in         server-only)           pg_cron, Vault, Storage (task-media), Realtime
 External: Razorpay (pay-in), RazorpayX (payouts), MSG91 (SMS), Google Maps/Places, Expo push
```

Boundaries that matter: (1) public client ↔ database — **the client talks to PostgREST directly, so RLS,
column privileges and the RPC `EXECUTE` allowlist are the entire authorization layer**; (2) public function
endpoints (`verify_jwt=false`) ↔ service-role code; (3) admin browser ↔ admin server ↔ service key;
(4) Razorpay/RazorpayX ↔ webhooks; (5) APK/bundle ↔ anyone who downloads it.

## Assets

Escrow/wallet money · payout destinations and PAN · phone numbers (held as a synthetic email
`p<phone>@phone.taskdrop.app`) · chat and task media · locations · admin console · server secrets
(service role, Razorpay/RazorpayX, MSG91, Vault) · ad budgets.

## Actors

Anonymous visitor · poster · worker · colluding poster+worker (two accounts) · bot/farm (SMS, referral,
ad-click) · curious reverse-engineer of the APK · leaked-key holder · malicious insider/admin ·
compromised admin session.

## Top abuse cases → where defended / gap

| # | Abuse case | Defence today | Gap (finding) |
|---|---|---|---|
| 1 | Obtain work without paying escrow | funding gate in RPCs; amount read server-side | gate depends on a client-writable column (**F-01**) |
| 2 | Read other users' private data via the open Data API | RLS on all tables | public profile + task columns (**F-02, F-04**), storage read policy (**F-03**) |
| 3 | Edit own rows to forge state (rating, review, destination, bid) | profile column guard | no guards elsewhere (**F-05**) |
| 4 | Call admin/service RPCs as a normal user | default-deny EXECUTE + in-body `is_admin` | none found; keep tests (rpc_surface) |
| 5 | Account takeover via OTP | 6-digit CSPRNG, 5 attempts, 10 min TTL, per-phone/IP limits | non-atomic counter, spoofable IP key (**F-07, F-08**) |
| 6 | SMS-pumping cost attack | per-phone + per-IP budget | IP key spoofable; no global ceiling (**F-08**) |
| 7 | Webhook forgery / replay | HMAC over raw body, 401 | add event-id dedupe + amount/currency reconciliation |
| 8 | Withdraw immediately after tampering with payout destination | RPC checks ownership | client-writable `rzp_*` columns; no re-auth/cool-off (**F-05**) |
| 9 | Drain a rival's ad budget | daily budget cap | unthrottled impressions (**F-09**) |
| 10 | Insider / compromised admin moves money | `is_admin` in every RPC | no MFA, no dual control, no audit log (**F-10, F-11**) |
| 11 | Extract secrets from APK/bundle | server secrets not `EXPO_PUBLIC_*`; Maps key is client-side | verify Maps restriction / proxy (**F-23**); release build not yet inspected |
| 12 | Admin web attacks (XSS/clickjacking/CSRF) | server actions re-check admin; Next 15.5.27 patched for CVE-2025-29927 | no CSP/HSTS/frame-ancestors (**F-12**) |
| 13 | Race conditions on money RPCs | `for update` row locks on most money RPCs | needs real parallel tests; add idempotency keys |
| 14 | Spoofed or stale prices on client | server recomputes on every RPC | display drift (**S-03**) |

## Residual risk accepted for MVP (owner to confirm)

Public leaderboards that name earners (`top_earners`); push notifications on native only; certificate
pinning not used (risk of bricking the app outweighs benefit at this stage — rely on TLS + Play Integrity
signal for high-risk actions).
