# Who may do what (plan task 2.18 part B)

One table: every caller across the top, every group of doors down the side. It is written from the row rules, the
database functions and the tests, and it is kept true by two tests:

- `supabase/tests/role_doors.test.sql` (in `npm run test:db`, runs in CI): every table in `public`, read from the
  catalog, against signed out, person A, person B and one login for each staff role.
- `scripts/direct-door-test.mjs` (run by hand on staging, not part of `npm test`): the database's own REST door,
  signed out and as a seed person.

**How the staff roles were tested.** Staff roles were tested on the throwaway database that CI starts, with made-up
logins inside a transaction that is rolled back. No staff account was created, or used, on the hosted staging
project. The hosted checks use only the existing seed people (Meera as person A, Asha as person B), and only reads.

## The table

"Own" means the person's own rows only. "Others'" means rows belonging to someone else. Staff roles are admin (full
admin), finance, support, sales and viewer. A staff login is also an ordinary person, so it always keeps its own rows.

| Door group | Signed out | Person: own | Person: someone else's | Admin | Finance | Support | Sales | Viewer |
|---|---|---|---|---|---|---|---|---|
| Public profile, reviews, open tasks | nothing | read | read (public on purpose) | read | read | read | read | read |
| Settings (fees, limits, switches) | nothing | read | read (see finding F1) | read, change | read | read | read | read |
| Wallet, wallet corrections, payouts | nothing | read | nothing | read | read | read | **nothing** | read |
| Payout details people typed (UPI, bank) | nothing | read, add, remove | nothing | not directly (only through the payout queue) | not directly (payout queue) | nothing | nothing | nothing |
| PAN and legal name for payouts (`payout_profiles`) | nothing | read | nothing | read | read | read | **nothing** | read |
| Private location, birth date check, push tokens | nothing | read | nothing | nothing | nothing | nothing | nothing | nothing |
| A task's exact address (`task_private`) | nothing | poster and the chosen worker | nothing | read | read | read | read | read |
| Chat, offers, proofs, disputes on a task | nothing | the people on that task | nothing, unless on the same task | read | read | read | read | read |
| Roles (`user_roles`) | nothing | read own | nothing | read, change | read | read | read | read |
| Staff roles (`admin_staff`) | nothing | nothing | nothing | read, change (needs the authenticator code) | read | read | own row only | read |
| Audit log, staff alerts, company ledger, app controls | nothing | nothing | nothing | read | read | read | **nothing** | read |
| Live events | nothing | nothing | nothing | read | read | read | read, except money and dispute events | read |
| Sign-in codes, send log, password attempts, SMS and place-search counters | nothing | nothing | nothing | nothing | nothing | nothing | nothing | nothing (server only) |
| CRM: notes, tags, leads, follow-ups, suspensions, warnings, hiding content | nothing | nothing | nothing | do | read only | do | do | read only |
| Money actions: mark a payout, wallet correction, decide a dispute | nothing | their own withdrawal | nothing | do | do | refused | refused | refused |
| Settings, payout method, make someone admin, change a staff role | nothing | nothing | nothing | do | refused | refused | refused | refused |
| Every `admin_*` and `crm_*` database function | no right to call | refused | refused | allowed (per area) | money area only | people area only | people area only | refused |
| Raise your own role or anyone's | refused | refused | refused | a full admin can raise others, not themselves | refused | refused | refused | refused |

Sales are "money blind" on purpose (migration 099): other people's wallets, payouts, the ledger, the audit log, staff
alerts, app controls and the automation rules are closed to them even if they call the database directly.

### Through the direct database door (H3, H52)

Until task 3.9, every signed-in person can also knock on `/rest/v1/<table>` with the public key. The row rules are the
only lock there, so the table above is what that door shows too. `scripts/direct-door-test.mjs --gateway-only` is the
test to run after 3.9: it expects every one of those requests to be refused.

## Server functions that use the master key, and why

The master key (the service-role key) skips all row rules. It lives only in the function secrets and in the admin's
server environment, never in the app. Each of these checks who is asking by another means first.

| Function | Login check by Supabase | Why it needs the master key | How it protects itself |
|---|---|---|---|
| `api` | on | the health check, the guest (signed-out) reads and the limiter bookkeeping; signed-in actions run as the person in the checked token, not with the master key | takes the person from the checked token, never from the request; every action tested as a second person (2.13 G) and as a guest (2.14 J) |
| `app-config` | off (read before sign-in) | reads the admin switches and the banner | answers only what the app needs and holds nothing secret |
| `phone-auth` | off (it is how you sign in) | stores and burns sign-in codes, creates sessions | per-phone and per-address limits, daily text caps, code burns on use |
| `password-auth` | off (it is how you sign in) | looks up a username to the account | limits per username and address |
| `places-search` | on | counts the daily place-search caps | signed-in only, per-person and total caps |
| `razorpay` | on | settles a payment into the caller's own wallet and task | acts on the caller's own wallet and task only |
| `razorpay-webhook` | off (Razorpay has no session) | settles a payment when the person did not come back | signature on the exact bytes, repeats change nothing |
| `razorpayx-payouts` | on | sends a withdrawal | the rules in `_shared/razorpayx.ts` and migration 066 stop a double payment |
| `razorpayx-webhook` | off, but **not written in `supabase/config.toml`** (H73) | records the bank's word on a withdrawal | signature check before a row is read |
| `inngest` | off (Inngest has no session) | runs the background jobs | verifies Inngest's own signature on every request |
| Admin panel server code (`src/lib/supabase/service.ts` in the admin repo) | n/a | reads what a staff session cannot: outstanding refunds, payments, push tokens, a person's phone and email; deletes a deleted person's photos | every call site checks the staff login first; the client is `server-only` |

## Findings from this task

- **F1 (Low).** Every signed-in person can read every row of `settings` (policy `settings_select_authenticated`,
  `using (true)`), including the anti-abuse numbers (text caps, new-account limits, ad limits) and switches such as
  `admin_require_mfa`. Nothing there is a secret key, but it tells an attacker where the limits are.
- **F2 (Low).** `razorpayx-webhook` has no entry in `supabase/config.toml` (known as H73); `scripts/check-endpoints.mjs`
  is meant to learn that.
- **F3 (Info).** The admin's own `scripts/check-endpoints.mjs` already walks every route and fails a route with no
  `checkAdmin()` and no `withinRate()`. It does not check that the route then turns away a plain person (403); only
  `live/token` has a test for that.
