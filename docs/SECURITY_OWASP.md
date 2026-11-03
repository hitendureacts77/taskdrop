# The OWASP checklist, line by line (plan task 2.13 part C)

Done on **3 November 2026** by Claude, on staging, from the code and the existing tests. Nothing was run against production or the payment companies. It sits beside `docs/SECURITY_ROUND1.md` (the attacks).

Three lists were used: **OWASP ASVS 4.0.3 level 1** (website, admin, server), the **OWASP API Security Top 10 (2023)** (`api` and the other server functions) and **OWASP MASVS 2.x** (the Android app). The requirement wording below is a short paraphrase; the numbers are the official ones, so each line can be looked up.

## How to read it

| Mark | Meaning |
|---|---|
| **pass** | True today. The *proof* column names the test, file or earlier report that shows it |
| **fixed** | Was not true; fixed in task 2.13 (the change is named) |
| **fail** | Not true today. Written as a hole (H30 onwards) with a severity and who decides |
| **n/a** | Does not apply, with the reason |

**Result: 0 Critical, 0 High.** Two Low holes are open for your "fix" or "accept" (H30, H31), one Low was fixed here (the payment return address), and one Medium already on the list (H9, the website's content policy) is the cause of three lines below. Nothing else failed.

## New holes found by this pass

| # | What | Severity | Decision |
|---|---|---|---|
| H30 | **Password rules are below the checklist.** A password needs only 8 characters (ASVS wants 12), changing it needs only the open session, not the old password (2.1.6), there is no strength hint (2.1.8) and no message is sent after a password change (2.2.3). A password is only an extra way in beside the phone code | Low | Reply "fix" or "accept". Fix = 12 characters, ask for the old password, a strength hint, and a notice after a change (about half a day) |
| H31 | **A text message code is the main way to sign in** (2.2.2 says a text code should only be a second check). It is how phone-first apps in India work, and the code is limited per number, per address and per day (2.8, 2.8b), but a stolen SIM can sign in | Low | Reply "accept" (recommended: it is the product) or "fix" (add a second step such as a password or Google to the account) |
| fixed here | **Razorpay return address.** `razorpay` handed any address the caller sent to Razorpay as the page to send the payer to afterwards, so a script could make a payment page redirect to another website | Low | Fixed: only TaskDrop's own websites (the CORS list) are kept, `_shared/returnUrl.ts`, tested |

Also from the first Semgrep run (all Medium or Low, none fails the check): `scripts/lib/db.mjs` connects to the test database without checking its certificate unless `DATABASE_CA_CERT` is set (a developer script that refuses any database but the test project and localhost; **accept**), `_shared/cors.ts` reads the caller's origin (a false alarm: the origin is compared with the fixed list first, `corsOrigins.test.ts`; **accept**), and Dependabot had no waiting time for brand-new package versions (**fixed**: 7 days, security updates not delayed).

---

## 1. OWASP ASVS 4.0.3, level 1

ASVS chapter V1 (architecture) has no level 1 lines. Chapter V6 (cryptography) has one: TaskDrop writes no encryption of its own; it uses Supabase Auth, the phone's key store and HMAC signatures from the platform (**pass**).

### V2 Authentication

| ID | Requirement (short) | Mark | Proof |
|---|---|---|---|
| 2.1.1 | Passwords at least 12 characters | **fail** | `extras.ts` allows 8. **H30** |
| 2.1.2 | Passwords up to 64 characters allowed | pass | Supabase Auth takes up to 72 bytes |
| 2.1.3 | Password not truncated or changed | pass | Supabase Auth; the admin route only measures length (`api/auth/password/route.ts`) |
| 2.1.4 | Any unicode allowed | pass | Supabase Auth |
| 2.1.5 | Users can change their password | pass | Account → Security (`setPassword`) |
| 2.1.6 | Changing needs the old and the new password | **fail** | Only the open session is needed. **H30** |
| 2.1.7 | New passwords checked against breached lists | **fail** | Supabase "leaked password protection" is a paid-plan setting: **H11**, switched on in production (5.2) |
| 2.1.8 | A password strength hint | **fail** | **H30** |
| 2.1.9 | No forced mix of character types | pass | No such rule |
| 2.1.10 | No forced periodic change | pass | No such rule |
| 2.1.11 | Pasting and password managers allowed | pass | Plain text fields (`AccessScreen`, `AccountScreen`) |
| 2.1.12 | Can show the typed password | n/a | Mobile text fields; not required for the hidden-by-default field |
| 2.2.1 | Protection against guessing and automation | pass | `password_sign_in_gate`, `consume_auth_attempt`, `hit_auth_send_ip`; `scripts/security-round2.mjs` test T6 (task 2.9), `supabase/tests/sms_safety.test.sql` |
| 2.2.2 | Text/email codes only as a second check | **fail** | The text code is the main sign-in. **H31** |
| 2.2.3 | The person is told after a credential change | **fail** | **H30** (part I now ends other devices after a password change, but sends no message) |
| 2.3.1 | No system-made first passwords | pass | None exist |
| 2.4.1 | Passwords stored salted and slow-hashed | pass | Supabase Auth (bcrypt) |
| 2.5.1 | Recovery secret not sent in clear | pass | No recovery secret: recovery is a fresh phone code |
| 2.5.2 | No password hints | pass | None exist |
| 2.5.4 | No shared or default accounts | pass | Seed accounts exist on staging only; none in production (5.9, `dev_otp_for_all` off) |
| 2.5.6 | Forgotten-secret recovery is safe | pass | Same limits as sign-in |
| 2.7.1 | Out-of-band codes expire within 10 minutes | pass | `CODE_TTL_MIN` in `phone-auth`; checked on verify |
| 2.7.2 | A code works once | pass | The row is deleted on use, on expiry and on the guess limit (`phone-auth`) |
| 2.7.3 | The code is long enough and random | pass | Six random digits, 5 guesses, then a new code is needed |
| 2.8.1 | Time-based codes expire | n/a | The app uses no authenticator codes; the admin's authenticator is checked by Supabase |

### V3 Session management

| ID | Requirement (short) | Mark | Proof |
|---|---|---|---|
| 3.1.1 | No session id in the address | pass | Tokens travel in the `Authorization` header |
| 3.2.1 | A new session at sign-in | pass | Supabase Auth makes one per sign-in |
| 3.2.2 | Session tokens are random | pass | Signed by Supabase (JWT) |
| 3.2.3 | Stored safely in the browser | **fail** | On the website the session sits in browser storage, which a script on the page could read. Cause: the content policy is report-only (**H9**, closes in 2.6/5.9). On the phone it is in the encrypted key store |
| 3.3.1 | Sign-out ends the session | **fixed** | "Sign out" ended this device only; now "Sign out of all devices" ends them all and the api refuses older tokens at once (migration 142, `session_cutoff.test.sql`, `api.test.ts`) |
| 3.3.2 | Sessions end after a time | pass | Phone: refresh tokens; admin: 30 idle minutes, 12 hours (`middleware.ts`) |
| 3.4.1 | Cookies are `Secure` | pass | Admin cookies: `secure` in production (`middleware.ts:247`). The app uses no cookies |
| 3.4.2 | Cookies are `HttpOnly` | pass | `middleware.ts:246` |
| 3.4.3 | Cookies use `SameSite` | pass | `lax` (`middleware.ts:248`) |
| 3.4.4 | Cookie name prefix `__Host-` | n/a | Level 2 in practice; the admin's cookie is httpOnly, secure and scoped |
| 3.4.5 | Cookie path is as narrow as possible | pass | Set by `@supabase/ssr` for the whole panel, which is all one app |
| 3.7.1 | Sensitive actions need a live session | pass | `api` checks the token and the account standing on every call |

### V4 Access control

| ID | Requirement (short) | Mark | Proof |
|---|---|---|---|
| 4.1.1 | Checks enforced on the server | pass | Rule 1; `rpc_caller_checks.test.sql` (113 of 113 database functions check the caller) |
| 4.1.2 | Users cannot change their own role or permission data | pass | Column lockdown, `column_lockdown.test.sql`; the cutoff columns too (`session_cutoff.test.sql` step 6) |
| 4.1.3 | Least privilege | pass | Staff roles enforced by the database (`staff_role_db_guards.test.sql`) |
| 4.1.5 | Access control fails closed | pass | An unreadable standing lets a call through only for the limiter and standing outage cases, which are logged and never for admin/money checks (those run in the database as the caller) |
| 4.2.1 | A person cannot reach another's records by id | pass | Row rules, break-it suite (285 probes), and the new two-person test over every `api` operation (part G, `scripts/two-person-test.mjs`) |
| 4.2.2 | Protection against cross-site request forgery | pass | `api` uses a bearer token, not cookies; the admin's server actions are same-origin with `SameSite=lax`; its download routes only read |
| 4.3.1 | Admin screens use a second step | **pass, partly** | Money actions and team changes need an authenticator code; signing in is password only. 2-step sign-in on your accounts is task **2.1b** |
| 4.3.2 | No directory listing or stray files | pass | `scripts/check-exposed-files.mjs` in `npm test`; source maps deleted after upload |

### V5 Validation, sanitising and output

| ID | Requirement (short) | Mark | Proof |
|---|---|---|---|
| 5.1.1 | Repeated parameters do not trick the app | pass | The api reads one JSON body, nothing from the query string |
| 5.1.2 | No mass assignment | pass | Each operation names the columns it writes (`writes.ts`); `column_lockdown.test.sql` |
| 5.1.3 | Input checked against what is allowed | pass | `core.ts` validators (`str`, `int`, `oneOf`, `uuid`) and Zod schemas |
| 5.1.4 | Structured data is typed | pass | Same; `api.test.ts` |
| 5.1.5 | Redirect addresses are on an allow-list | **fixed** | The payment return address (above); sign-in redirect addresses are Supabase's allow-list (`scripts/add-redirect-urls.mjs`) |
| 5.2.1 | HTML from users is cleaned | pass | None is rendered: the app draws text with React Native/React, which escapes it |
| 5.2.2 | Other unstructured data cleaned | pass | Names and posts are refused if they carry contacts; free text is stored and shown as text |
| 5.2.3 | No mail-command injection | n/a | No mail is built from user input |
| 5.2.4 | No `eval` of user data | pass | Searched `apps/mobile/src` and the functions: none |
| 5.2.5 | No template injection | n/a | No server-side templates |
| 5.2.6 | No server request to a user-chosen address | pass | Outbound calls go to fixed hosts (Razorpay, Google, MSG91, Nominatim, ImageKit); the return address is allow-listed |
| 5.2.7 | Uploaded SVG/script files are safe | pass | Only jpeg, png, webp, heic, mp4, mov, webm and documents are accepted; images are checked by ImageKit and as private files by the server |
| 5.3.1 | Output encoded for where it lands | pass | React escapes; CSV downloads defuse formulas (`csv.test.ts`) |
| 5.3.3 | Scripts cannot run from output | pass | See 5.2.1; the report-only policy (H9) is the second layer, not yet enforcing |
| 5.3.4 | Database queries are not built from strings | pass | PostgREST filters and `rpc` arguments; the fuzz test (T4) sent hostile text to every operation |
| 5.3.6 | No JavaScript injection | pass | Searched: no `new Function`, `innerHTML` or `dangerouslySetInnerHTML` |
| 5.3.7 | No LDAP, XPath or XML injection | n/a | None used |
| 5.3.8 | No operating-system command injection | n/a | No commands run from user input |
| 5.3.9 | No local or remote file inclusion | n/a | No dynamic file paths from users |
| 5.5.1 | Serialised objects are integrity-checked | pass | Only JSON, validated |
| 5.5.2 | XML parsers are safe | n/a | No XML parsed |
| 5.5.3 | No unsafe deserialisation | pass | `JSON.parse` only |

### V7 Errors and logs

| ID | Requirement (short) | Mark | Proof |
|---|---|---|---|
| 7.1.1 | Credentials are not logged | pass | Rule 9; `scrub.ts` (app and server) with tests; `scripts/secret-guard.mjs` |
| 7.1.2 | Other sensitive data is not logged | pass | Phone numbers and emails are scrubbed (`scrub.test.ts`) |
| 7.4.1 | Errors are generic | pass | T4 sent hostile input to every operation: no database words, paths or stacks came back |

### V8 Data protection

| ID | Requirement (short) | Mark | Proof |
|---|---|---|---|
| 8.1.1 | Servers do not cache private data | pass | `api` answers are `no-store` |
| 8.2.1 | Browsers told not to cache private data | pass | Same; admin pages are `force-dynamic` |
| 8.2.2 | No private data left in browser storage | **fail** | The website session token (see 3.2.3, **H9**) |
| 8.2.3 | Client data cleared at sign-out | pass | `signOut` clears the stored session |
| 8.3.1 | Private data not sent in the address | pass | The phone number goes in the body; the only query-string secrets are one-time sign-in codes and ImageKit's signed link, which are designed for it |

### V9 Communication, V10 Malicious code, V11 Business logic

| ID | Requirement (short) | Mark | Proof |
|---|---|---|---|
| 9.1.1 | TLS for all client traffic | pass | `Strict-Transport-Security` (`vercel.json`); `usesCleartextTraffic: false` (`app.json`) |
| 9.1.2 | Strong TLS settings | pass | Managed by Vercel and Supabase |
| 9.1.3 | Only current TLS versions | pass | Managed by Vercel and Supabase |
| 10.3.2 | Updates are integrity-protected | pass | App updates come from Expo over TLS; store builds are signed by Google Play. Code-signing of OTA updates is not switched on: **Low, accepted** (no extra holes; revisit with F.13) |
| 11.1.1 | Business steps happen in order | pass | The task and payment states are enforced in the database (`money_rules`, `cancel_rules`, `funding_rules` SQL tests; `e2e/money.spec.ts`) |

### V12 Files, V13 API, V14 Configuration

| ID | Requirement (short) | Mark | Proof |
|---|---|---|---|
| 12.1.1 | Huge uploads are refused | pass | 15 MB for pictures, 50 MB bucket limit, 20 uploads a minute |
| 12.3.1 | File names from users are not trusted | pass | Paths are made by the server (`<user id>/<random>`) |
| 12.3.2 | No file inclusion | n/a | Same as 5.3.9 |
| 12.3.5 | Uploads are never run | pass | They are only served as private files with their type |
| 12.4.1 | Uploads stay out of public reach | pass | Private ImageKit files, private bucket; `scripts/check-private-files.mjs` (new, in `npm test`) and `security:storage` (13 of 13 refused) |
| 12.5.2 | Uploaded files cannot run as pages | pass | Signed links on a separate host (ImageKit / Supabase Storage), not on taskdrop.in |
| 12.6.1 | No request to an address inside a file | n/a | No file is fetched by address |
| 13.1.1 | Same parsers and encoding on every route | pass | One door (`api`), and a test that no direct database path exists (`check-gateway-only.mjs`) |
| 13.1.3 | Keys and tokens not in addresses | pass | Header only (above for the exceptions) |
| 13.2.1 | Only the expected HTTP methods | pass | Functions answer `POST`/`OPTIONS` and refuse the rest with 405 |
| 13.2.2 | JSON bodies are validated | pass | Part A list, `api.test.ts` |
| 13.2.3 | Cookie-based calls are protected from forgery | pass | See 4.2.2 |
| 14.2.1 | Components are not known-vulnerable | pass | `npm audit` gate on every change and every Monday; Dependabot (7-day wait) |
| 14.2.2 | Debug features are off in production | **pass, at launch** | `dev_otp_for_all` is on for staging by design and must be off in production: **H1, closed in 5.9** |
| 14.3.2 | Debug modes are off | pass | Production builds; `EXPO_PUBLIC_APP_ENV=production` |
| 14.4.1 | Responses carry a content type | pass | Platform default |
| 14.4.3 | A content security policy limits scripts | **fail** | The full policy is report-only; only framing, base, object and form rules are enforced. **H9** |
| 14.4.4 | `nosniff` | pass | `vercel.json` |
| 14.4.5 | HSTS | pass | `vercel.json` |
| 14.4.6 | Referrer policy | pass | `strict-origin-when-cross-origin` |
| 14.4.7 | Framing is blocked | pass | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |
| 14.5.1 | Only expected methods | pass | See 13.2.1 |
| 14.5.2 | The `Origin` header is not used to authorise | pass | It only picks the CORS answer (`cors.ts`); authorisation is the token |
| 14.5.3 | Cross-origin sharing is strict | pass | An allow-list of exact origins, no `*` (`corsOrigins.test.ts`, task 2.6) |

---

## 2. OWASP API Security Top 10 (2023), against `api` and the other server functions

| # | Risk | Mark | Proof |
|---|---|---|---|
| API1 | Broken object-level authorisation (someone else's record by id) | pass | Row rules; the person comes from the token (`ctx.userId`), never from an argument; two-person test over every operation (`scripts/two-person-test.mjs`, part G) |
| API2 | Broken authentication | pass, with **H30**, **H31** | Supabase Auth; limits; sessions now endable (part I) |
| API3 | Broken property-level authorisation (too much in an answer, writable fields) | pass | Column lockdown; private address in a separate owner-only table (migration 126); the two-person test looks for private marks in every answer |
| API4 | Unrestricted resource consumption | pass | Limits on every door (part A, `scripts/check-endpoints.mjs`); pages are capped; the rush test is part J |
| API5 | Broken function-level authorisation (admin actions) | pass | Staff roles in the database (`staff_role_db_guards.test.sql`, `staff_role_guards_people_admin.test.sql`) |
| API6 | Unrestricted access to sensitive business flows | pass | Money limits (2.11), new-account limits (`new_account_limits.test.sql`), withdrawal limits, SMS caps |
| API7 | Server-side request forgery | pass | No server request goes to a caller-chosen address (the one candidate, the payment return address, is now allow-listed) |
| API8 | Security misconfiguration | **pass, partly** | CORS allow-list, headers, no stack traces; the content policy is report-only (**H9**); test shortcuts must be off in production (**H1**, 5.9) |
| API9 | Improper inventory | pass | `scripts/check-endpoints.mjs` lists every door in both code folders; staging and production are separate projects (task 5.2) |
| API10 | Unsafe consumption of other services | pass | Webhooks check Razorpay's signature (`razorpay-webhook`, `razorpayx-webhook`); Razorpay and MSG91 answers are checked before use; place-search results are shown as text |

---

## 3. OWASP MASVS 2.x, the Android app

| Control | Meaning | Mark | Proof |
|---|---|---|---|
| STORAGE-1 | Private data stored safely | pass | Session in `expo-secure-store` (Keystore); `allowBackup: false` (`app.json`); drafts hold post text only |
| STORAGE-2 | Private data not leaked (logs, backups, screenshots) | pass, partly | Logs scrubbed; backups off. The app does not hide itself in the recent-apps screen: **Low, not a hole** (nothing secret is on most screens) |
| CRYPTO-1 | Sound cryptography | pass | None written by TaskDrop; platform key store and HTTPS |
| CRYPTO-2 | Keys managed properly | pass | Keys only on the server (rule 8; `secret-guard`) |
| AUTH-1 | Secure sign-in protocol | pass | Supabase Auth (one-time codes, Google, password) |
| AUTH-2 | Local authentication | n/a | No fingerprint or PIN lock in the app |
| AUTH-3 | Extra check for sensitive actions | pass, partly | Withdrawals and payments are checked on the server with limits; no second factor at the moment of withdrawal. Covered by 2.11 limits; **not a hole** |
| NETWORK-1 | Secure traffic | pass | `usesCleartextTraffic: false`; TLS only |
| NETWORK-2 | Certificate pinning | n/a | Not required at this level; revisit with F.13 |
| PLATFORM-1 | Safe links and inter-app calls | pass | One custom scheme `taskdrop://`; no exported components added; payment screens open only addresses the server made |
| PLATFORM-2 | Safe web views | pass, **Low note** | `PaymentSheet` opens only the Razorpay link the server returned; `originWhitelist` is `*`, so a navigation inside the sheet is limited by Razorpay's own page, not by us. Not a hole today |
| PLATFORM-3 | Screens do not leak data | pass | See STORAGE-2 |
| CODE-1 | Up-to-date platform | pass | Expo SDK 58 (task: Expo upgrade) |
| CODE-2 | Old versions can be forced to update | pass | The admin's minimum-version switch (`app-config`) |
| CODE-3 | Dependencies are checked | pass | Audit gate; Dependabot; Semgrep |
| CODE-4 | Input is validated | pass | On the server for everything that matters (rule 1) |
| RESILIENCE-1 to 4 | Root detection, obfuscation, anti-debugging | n/a | Not claimed; these are the optional "R" level. The server never trusts the app |
| PRIVACY-1 to 4 | Data minimised, user informed, user controls | pass | Rough area only until hired; age gate 18; account deletion (087); Privacy Policy drafted (lawyer review open, S.3) |

---

## How it stays true

- Every line that can be tested by a program is in `npm test` or the SQL suite, so it runs again on every change: the door list (`check-endpoints.mjs`), file privacy (`check-private-files.mjs`), the payment return address (`returnUrl.test.ts`), sessions (`session_cutoff.test.sql`, `api.test.ts`), the cross-user test (`two-person-test.mjs`, run by `.github/workflows/two-person.yml`).
- Semgrep reads the code on every change and every Monday; the package audit also runs every Monday.
- Repeat this pass before the go / no-go (6.5) and after any change to sign-in, money or files.
