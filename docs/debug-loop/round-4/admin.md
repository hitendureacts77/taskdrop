# Debug round 4, charter E: the admin panel (static review)

Reviewer: Claude (admin charter), 13 Nov 2026. Repo `Taskdrop administrator`, branch `redesigned-2.0`, HEAD `db0161b`.
Staging: `admin.taskdrop.in`. **No live sign-in was used** (owner signs in with Google or username + password; no
password was typed). Everything below is from reading the code, the user-repo migrations and running the local checks.
Nothing was fixed, edited, committed or migrated.

Note: the holes H77-H80 are not on the local `redesigned-2.0` of the user repo yet; they live on branch
`docs/plan-admin-coverage` (`docs/ULTIMATE_PLAN.md` lines 634-637). This review confirms H77 and H78 in the code.

## Local checks

| Check | Result |
|---|---|
| `npm test` (27 files, 169 tests) | pass, 169/169 |
| `npm run lint` | pass |
| `npm run typecheck` | **fails**, only on a stale generated file: `.next/types/validator.ts(5,79): Cannot find module './routes.js'`. `tsconfig.json` includes `.next/types/**` and `.next/dev/types/**`, so an old `.next` folder from an earlier build breaks the check. Not a source bug; delete `.next` or regenerate before trusting the typecheck. |
| Every `*.test.*` file is in the `test` script | yes |

## 1. Role matrix (from the guard code)

Guards: `requireAdmin()` (signed in + `user_roles.admin` + `ADMIN_EMAIL/ADMIN_PHONE` allowlist), `requireSeeing(view)`
(sends Sales to `/`), `staffGate(area)` on every server action (admin = all; finance = money; support and sales =
people; viewer = nothing), `moneyMfaGate()` (aal2 unless `admin_require_mfa` is false). The database re-checks
(`private.staff_can`, aal2 in each `admin_*` function).

### Pages

| Page | Guard | Admin | Finance | Support | Sales | Viewer | Server-side gate on its actions |
|---|---|---|---|---|---|---|---|
| `/` dashboard | requireAdmin, money hidden for Sales | see | see | see | see (no money) | see | n/a |
| `/needs-you` | requireAdmin (money items filtered for Sales) | see | see | see | see | see | n/a |
| `/tasks`, `/tasks/[id]` | requireAdmin; cancel+refund shown only with money | act | act (money) | see | see (no money) | see | cancelTaskWithRefund: money + MFA |
| `/users`, `/users/[id]` | requireAdmin; full contacts only Admin/Support + audit row | act | see, masked | act | act, masked, no money | see, masked | crm-actions people; deleteAccount admin (DB aal2); signOutEverywhere admin |
| `/search` | requireAdmin, wallet zeroed for Sales | see | see | see | see | see | n/a |
| `/crm`, `/crm/tasks`, `/crm/messages`, `/crm/segments`, `/crm/leads` | requireAdmin | act | see | act | act | see | people (staffGate) |
| `/reports-queue`, `/feedback`, `/copyright` | requireAdmin | act | see | act | act | see | people (staffGate) |
| `/support`, `/support/[id]` | requireAdmin | act | see | act | act | see | people (staffGate) |
| `/devices`, `/team/performance`, `/security` | requireAdmin | see | see | see | see | see | n/a (MFA route is own-account) |
| `/alerts` | requireAdmin | act | **act** | **act** | refused by RLS, silent "done" | **act** | **none (R4-X5)** |
| `/money`, `/money/entries`, `/money/reconcile`, `/refunds`, `/disputes`, `/promotions`, `/reports`, `/payouts`, `/payouts/[id]` | requireSeeing('money') | act | act | see | redirected | see | money + MFA; setPayoutMethod admin + MFA |
| `/settings`, `/settings/rules`, `/settings/switches`, `/settings/controls`, `/settings/team`, `/settings/audit`, `/settings/health`, `/settings/integrations` | requireSeeing('settings') | act | see | see | redirected | see | admin (+ MFA for settings, switches, team; controls per key) |

### Routes (`src/app/**/route.ts`)

| Route | Role check | Rate limit | Notes |
|---|---|---|---|
| `POST /api/auth/password` | after sign-in: checkAdmin, signs out non-admins | 10/min per address (fails open, H77) | OK apart from H77 |
| `POST /api/auth/mfa` | checkAdmin | 10/min per staff (fails open, H77) | OK apart from H77 |
| `GET /api/auth/ping` | none (public by design) | none | answers `{ok:true}` only |
| `GET /api/live`, `GET /api/live/token` | checkAdmin | 120/min, 30/min | token route hands the access token (possibly aal2) to page JS, by design (H37) |
| `GET /api/crm/export` | checkAdmin; money columns hidden for Sales; contacts masked by role | 10/min | audit row before rows; see R4-X3, R4-X6 |
| `GET /api/crm/leads/export` | checkAdmin; contact masked by role | 10/min | audit row before rows |
| `GET /api/reports/export` | checkAdmin + staffCanSee('money') | 10/min | audit row before rows |
| `GET /auth/callback` | none (Supabase checks the code) | none | no `next`/redirect param, so **no open redirect**; see R4-X12 |

Server actions: every exported action in the 12 `'use server'` files calls `requireAdmin()` and a `staffGate()`
except `markAlertsRead` (R4-X5). None has a rate limit (R4-X4).

## 2. Findings

| Id | Level | Class | Title | File:line | Confidence |
|---|---|---|---|---|---|
| R4-X1 | Medium | Backend | A failed read of the staff-role row makes any staff member a full Admin in the panel | `src/lib/auth.ts:65-75`, `src/lib/staff-roles.ts:103-105` | confirmed by code |
| R4-X2 | Medium | Backend | Rate limiter lets every call through on error (H77) | `src/lib/rate-limit.ts:154-162` | confirmed by code |
| R4-X3 | Medium | Both | CRM audiences, segments, tag counts and the People export stop at 1,000 rows (PostgREST row cap), and the "Send to N" count is wrong | `src/lib/crm.ts:273-282, 121, 156, 162, 398-405` | confirmed by code, cap value needs live check |
| R4-X4 | Medium | Backend | No server action has a rate limit or double-submit guard; a support/sales login can broadcast to 5,000 people over and over | `src/lib/crm-actions.ts:265-320` (and every action file) | confirmed by code |
| R4-X5 | Low | Both | Viewer, Finance and Support can mark every team alert read for everyone; Sales gets a false "marked" | `src/lib/alerts-actions.ts:12-22`, `src/components/views/AlertsView.tsx:36,59` | confirmed by code |
| R4-X6 | Medium | Backend | People export calls Supabase Auth once per person, one after another: a big export times out | `src/lib/crm.ts:417-439`, `src/app/api/crm/export/route.ts:85-90` | plausible (needs a big data set) |
| R4-X7 | Medium | Backend | A blank-looking setting value (a space) saves 0: clearing period 0 days releases earnings at once | `src/lib/actions.ts:366, 380-385` | confirmed by code |
| R4-X8 | Medium | Backend | No security events reach Sentry (H78) | whole `src/` (only `error.tsx:9`, `global-error.tsx:9` call Sentry) | confirmed by code |
| R4-X9 | Low | UI | Error text is not cleaned in two places: regex `error:s*` misses its backslash | `src/lib/session-actions.ts:55`, `src/lib/admin-actions.ts:29` | confirmed by code |
| R4-X10 | Low | Backend | Sales (money-blind) still receives the refunds-owed count in the page data | `src/app/(dashboard)/layout.tsx:35,41,47`, `src/lib/data/nav.ts:14,50-53` | confirmed by code |
| R4-X11 | Low | UI | Login page shows any text passed in `?error=` (phishing text on the admin domain) | `src/app/login/page.tsx:29,178-179`, `src/app/auth/callback/route.ts:19-22` | confirmed by code |
| R4-X12 | Low | Both | A non-admin Google sign-in keeps a live session on the admin domain; `/not-authorized` has no sign-out | `src/app/auth/callback/route.ts:25-33`, `src/app/not-authorized/page.tsx` | confirmed by code |
| R4-X13 | Low | Both | Other silent caps: board counts, leads, devices, People "suspended"/tag filter with a huge `in()` list | `src/lib/feedback.ts:80`, `src/lib/leads.ts:56`, `src/lib/controls.ts:33`, `src/lib/data/users.ts:113,137` | plausible |
| R4-X14 | Low | Both | View-only roles see live buttons (switches, team, copyright, tickets, feedback) that the server then refuses | `src/app/(dashboard)/settings/switches/page.tsx:9`, `support/[id]/page.tsx:11`, `copyright/page.tsx`, `feedback/page.tsx` | confirmed by code |
| R4-X15 | Low | Backend | Team page shows every staff member's full email or phone to Viewer, Finance and Sales-less roles, against the H33 masking rule | `src/components/views/AdminConfigViews.tsx:195`, `src/lib/admin-config.ts:65-80` | confirmed by code |
| R4-X16 | Low | Backend | Negative money in exports is turned into text (`'-12.00`), so spreadsheet sums skip it | `src/lib/csv.ts:11`, `src/lib/crm.ts:434`, `src/app/api/reports/export/route.ts:193-194` | confirmed by code |
| R4-X17 | Low | UI | "Paid today" counts payouts by `updated_at`, so a payout touched today (fee, reversal note) counts as paid today; disputes "waiting since" uses `updated_at` too | `src/lib/data/payouts.ts:50-63`, `src/lib/data/disputes.ts:57,84` | plausible |
| R4-X18 | Low | Backend | `getMoneyPosition` hides every error as "migration 066 not applied" | `src/lib/data/payouts.ts:131-135` | confirmed by code |
| R4-X19 | Low | Backend | Tests: the fail-open default is locked in by a test; no test for rate-limit, checkAdmin, moneyMfaGate, updateSetting parsing, middleware timeouts | `src/lib/staff-roles.test.ts` (last test), `package.json` test script | confirmed by code |

### R4-X1 (Medium, Backend) A failed staff-role read makes the caller a full Admin in the panel

- **Where:** `src/lib/auth.ts:65-75` reads `user_roles` and `admin_staff` together and keeps only `data`; the
  `admin_staff` error is dropped. `asStaffRole(undefined)` (`staff-roles.ts:103-105`) returns `'admin'`.
- **Trigger:** a Viewer or Finance login while the `admin_staff` read fails (timeout, PostgREST hiccup, schema cache
  reload, `API_GATEWAY_SECRET` mismatch on that table only). The `user_roles` read may still succeed.
- **Current:** `staffRole` becomes `'admin'`: every `staffGate()` passes, all settings/team/switch buttons work in
  the panel, full phone/email are shown and exported (contact-mask uses the same role).
- **Expected:** an error on the staff-role read refuses (forbidden or "try again"), only a real "no row" means full
  admin. The database still re-checks most writes (`private.staff_can`, also defaulting to admin when there is no row),
  and the refund/RazorpayX edge functions check money staff themselves, so the damage is mostly panel-side: contacts
  unmasked and exports, plus any action the database does not re-check.
- **Confidence:** confirmed by code (the trigger itself is rare; live check not possible without a staff login).

### R4-X2 (Medium, Backend) Rate limiter fails open (H77)

- **Where:** `src/lib/rate-limit.ts:154-162`: on an RPC error or a throw it returns `true`.
- **Trigger:** `api_rate_hit` unreachable (database busy, service key missing or wrong).
- **Current:** the 10-a-minute admin sign-in limit (`api/auth/password/route.ts:71`) and the 10-a-minute
  authenticator limit (`api/auth/mfa/route.ts:139`) vanish, with only a `console.warn`. Supabase Auth's own MFA limits
  remain.
- **Expected:** fail closed for `admin-signin` and `admin-mfa` (and probably exports), with a Sentry event; keep the
  open behaviour only for `admin-live`.
- **Confidence:** confirmed by code. Already H77.

### R4-X3 (Medium, Both) CRM numbers and exports stop at 1,000 people

- **Where:** `src/lib/crm.ts:273-282` `matchingIds()` calls the set-returning RPC `crm_segment_users` with no paging.
  Supabase's API returns at most `max_rows` rows (default 1,000; `supabase/config.toml` sets no other value). Same
  pattern for `getTags()` (`crm.ts:121`, `.limit(20000)`), `idsWithTag()` (`:156`), `idsSuspended()` (`:162`).
- **Trigger:** more than 1,000 people match (Everyone, Workers), or more than 1,000 tag links.
- **Current:** `getAudiences()` (`crm.ts:398-405`) shows at most 1,000, so the Messages confirm button says
  "Yes, send to 1,000" while `crm_send_broadcast` works the audience out in the database and sends to up to 5,000.
  Segment member lists and totals (`getMembers`, `:311-318`) and the segment People export
  (`api/crm/export/route.ts:73-74`) silently stop at 1,000; tag counts and the People page tag/suspended filters
  undercount. The audit row records the capped number.
- **Expected:** page the RPC (`.range()` loop) or count in the database; the confirm count must equal what is sent.
- **Confidence:** confirmed by code; the actual `max_rows` on staging needs a live look (Supabase dashboard, API
  settings). Staging has about 120 fake people, so it will not show yet.

### R4-X4 (Medium, Backend) Server actions have no rate limit or idempotency

- **Where:** none of the 60+ actions in `src/lib/*-actions.ts`, `actions.ts`, `session-actions.ts` calls
  `withinRate`. `scripts/check-endpoints.mjs` only walks `route.ts` files, so actions are outside the door check.
  `sendBroadcast` (`crm-actions.ts:265-320`) is the worst case: any Support or Sales login, no authenticator code,
  up to 5,000 people per call (database cap), no "same message just sent" check.
- **Trigger:** replay the server-action POST (copy as fetch from devtools) in a loop, or a double click that lands two
  submits (the button is disabled by `pending`, but a replay or two tabs is enough).
- **Current:** every replay sends another push to the whole audience; notes, tags, warnings and suspensions can be
  flooded the same way.
- **Expected:** a per-staff limit on actions (at least broadcasts, warnings, suspensions, account deletion), and a
  short duplicate check on broadcasts. Money actions are already idempotent in the database (payout status checks,
  refund claim), so they are not the issue.
- **Confidence:** confirmed by code.

### R4-X5 (Low, Both) Any staff role can mark all alerts read for the whole team

- **Where:** `src/lib/alerts-actions.ts:12-22` has `requireAdmin()` but no `staffGate`; the policy
  `admin_alerts_mark_read` (migration 090) lets any `is_admin()` update `read_at`, and `read_at` is one value per alert
  shared by everyone. The "Mark all read" button (`AlertsView.tsx:36`) shows for every role.
- **Current:** a Viewer ("changes nothing") presses "Mark all read" and the alerts disappear from everyone's unread
  list. For Sales, the restrictive select policy hides the rows, the update touches 0 rows, and the action still says
  "All alerts marked as read." (no `.select()` check, unlike `updateSetting`).
- **Expected:** read state per staff member, or at least Viewer refused; report 0 rows as "nothing changed".
- **Confidence:** confirmed by code.

### R4-X6 (Medium, Backend) Big People exports time out

- **Where:** `src/lib/crm.ts:430-436`: for each row, `await service.auth.admin.getUserById(r.id)` in sequence. The
  route collects up to 40 x 500 = 20,000 ids (`api/crm/export/route.ts:85-90`). `memberRows` also ignores read errors
  (`crm.ts:286-293`), so a failed chunk just drops people.
- **Trigger:** export "Everyone" with a few thousand people.
- **Current:** thousands of serial Auth calls; the function hits the Vercel time limit, the download fails after the
  audit row says "N people" were exported. A failed chunk gives a shorter file than the audit row says.
- **Expected:** batch the contact lookup (one `listUsers` pass or a database view the service key reads), stream or
  cap the export, and fail loudly on a read error.
- **Confidence:** plausible (needs a large data set).

### R4-X7 (Medium, Backend) A space typed as a setting saves 0

- **Where:** `src/lib/actions.ts:366` trims the value; `:380` `Number('')` is `0`, which passes `Number.isFinite`.
  `clearing_period_days` (min 0) and `new_account_tasks` (min 0) accept it. The input is `required`
  (`MoreViews.tsx:260`), but a single space passes the browser's `required` check.
- **Trigger:** Settings, "Clearing period", type a space, confirm.
- **Current:** saved as 0 days: new earnings clear at once (money can be withdrawn before the review window), with
  "Saved. It applies from now on."
- **Expected:** an empty value is refused ("Type a number").
- **Confidence:** confirmed by code (admin + authenticator code needed, so only by mistake).

### R4-X8 (Medium, Backend) No security events (H78)

- **Where:** the only Sentry calls are `src/app/(dashboard)/error.tsx:9` and `src/app/global-error.tsx:9`. Failed
  password sign-ins (`api/auth/password/route.ts:100,107,112`), wrong codes (`mfa-route.ts:116-118`), forbidden
  `checkAdmin` results and `staffGate` refusals are not reported.
- **Expected:** `security_event` tagged events so the 2.10 alert covers the admin.
- **Confidence:** confirmed by code. Already H78.

### R4-X9 (Low, UI) Broken regex leaves "ERROR:" in messages

- **Where:** `src/lib/session-actions.ts:55` and `src/lib/admin-actions.ts:29` use `/^(error:s*)/i` (no backslash
  before `s`). Every other file uses `\s*`.
- **Trigger:** a database refusal in "End all staff sessions" or a staff-role error.
- **Current:** a leading "ERROR:  " is left in (the regex only strips "error:" followed by letters "s").
- **Expected:** stripped like everywhere else.
- **Confidence:** confirmed by code.

### R4-X10 (Low, Backend) Sales receives the refunds-owed count

- **Where:** `layout.tsx:35` calls `getNavCounts()`, which reads `refunds_outstanding` with the service key
  (`data/money.ts:139`, bypassing the Sales money block), and passes the raw counts to `LiveProvider initialNav`
  (`:41`) and `Sidebar` (`:47`), both client components. `lib/live.ts:51-56` zeroes these numbers for Sales on the
  live refresh, but the first page load does not.
- **Current:** a Sales login's page data (RSC payload) carries the number of refunds owed (and the disputes count).
  The menu items are hidden, so it is only visible in the payload or until the first live refresh.
- **Expected:** zero money counts for Sales in the layout too, and do not read refunds with the service key for a
  role that may not see them.
- **Confidence:** confirmed by code.

### R4-X11 (Low, UI) Any text in `?error=` is shown on the login page

- **Where:** `login/page.tsx:29,178-179` shows `params.get('error')` as is (React escapes it, so no script).
  `auth/callback/route.ts:19-22` also forwards Google's `error_description`.
- **Trigger:** `https://admin.taskdrop.in/login?error=Your account is locked. Call +91...`
- **Current:** that sentence appears in red on the real admin sign-in page.
- **Expected:** map known codes to fixed sentences; ignore unknown text.
- **Confidence:** confirmed by code.

### R4-X12 (Low, Both) Non-admin Google sign-in keeps a session

- **Where:** `auth/callback/route.ts:25-33` exchanges the code and redirects to `/` without checking for an admin
  (the password route signs non-admins out at `api/auth/password/route.ts:110-112`). `/not-authorized` shows the email
  but has no sign-out button.
- **Current:** an ordinary TaskDrop account that tries Google sign-in keeps valid Supabase session cookies on the
  admin domain until they expire (12 h cookie cap); the only way out is the login page or clearing cookies.
- **Expected:** sign out a non-admin in the callback (as the password route does) or offer "Sign out" on
  `/not-authorized`.
- **Confidence:** confirmed by code.

### R4-X13 (Low, Both) Other silent caps

- `feedback.ts:80` board counts `.limit(5000)` (effectively 1,000 with the default cap): tab numbers stop at 1,000
  ideas in total.
- `leads.ts:56` `.limit(2000)`: the Leads list and leads export stop at 1,000 with no notice.
- `controls.ts:33` `.limit(5000)`: device/version shares on Controls and Devices count only the last 1,000 installs.
- `data/users.ts:113,137`: the People filters "Suspended" and a tag pass every id in one `.in()` filter in the URL;
  with a few hundred ids the request grows past the gateway's URL size and the page errors.
- `data/support.ts:16` and `data/disputes.ts:59`: lists stop at 200 while the sidebar count (`nav.ts`) counts all.
- **Confidence:** plausible (depends on data size and the project's `max_rows`).

### R4-X14 (Low, Both) View-only roles see live buttons

- `settings/switches/page.tsx:9` passes `setSwitch` to every role that may see settings (Viewer, Finance, Support);
  the same holds for `support/[id]` (reply/resolve to Finance and Viewer), copyright, feedback and reports-queue
  actions. The server refuses each with "Your staff role (...) can't do this", so this is not a hole, but a Viewer
  sees an active "Developer sign-in" switch and a confirm panel.
- **Expected:** read-only rendering for roles without the area, like `/settings` (`update` undefined) and the team page
  (`manage = meRole === 'admin'`).
- **Confidence:** confirmed by code.

### R4-X15 (Low, Backend) Staff contacts unmasked on the team page

- `AdminConfigViews.tsx:195` shows each staff member's full email or phone (read with the service key in
  `admin-config.ts:65-80`) to every role that may open `/settings/team` (Admin, Finance, Support, Viewer). H33 masks
  customers' contacts for Finance and Viewer; staff contacts are not masked.
- **Expected:** decide whether staff contacts count under H33; if yes, use `emailFor/phoneFor(role, ...)`.
- **Confidence:** confirmed by code.

### R4-X16 (Low, Backend) Negative amounts become text in exports

- `csv.ts:11` prefixes any cell starting with `-` (formula guard, intended and tested in `csv.test.ts:8`). Money
  columns are formatted numbers (`crm.ts:434`, `reports/export/route.ts:193-194`), so `-12.00` becomes `'-12.00`, which
  Excel treats as text: column sums leave out every negative wallet or revenue day.
- **Expected:** keep the guard for text, but let plain numbers through (`/^-?\d+(\.\d+)?$/`).
- **Confidence:** confirmed by code.

### R4-X17 (Low, UI) Dates taken from `updated_at`

- `data/payouts.ts:50-63` counts "paid today" by `updated_at`; any later update to a paid row (fee, tax, reversal
  fields from migration 066) moves it into today. `data/disputes.ts:57,84` shows "waiting since" from the task's
  `updated_at`, which resets on any task update.
- **Confidence:** plausible (needs a row updated after it was paid or disputed).

### R4-X18 (Low, Backend) Money position error hidden

- `data/payouts.ts:131-135` returns `null` on any error, and the page reads `null` as "apply migration 066". A real
  outage or a permission change shows a false setup notice.
- **Confidence:** confirmed by code.

### R4-X19 (Low, Backend) Test gaps

- The last test in `staff-roles.test.ts` asserts `asStaffRole(undefined) === 'admin'`, which makes R4-X1's fail-open
  default the tested behaviour.
- Important files with no test: `rate-limit.ts` (H77 path), `auth.ts` (`checkAdmin`), `staff.ts`, `mfa.ts`
  (`moneyMfaGate`), `middleware.ts` idle and absolute timeouts (only `idle-activity.ts` and `cookie-options.ts` are
  tested), `actions.ts` `updateSetting` number parsing (R4-X7), `crm.ts` `exportCsv`, `alerts-actions.ts`.
- `scripts/check-endpoints.test.mjs` only checks that the words `checkAdmin(` and `withinRate(` appear in a route file;
  a route that calls `checkAdmin()` and ignores the result passes (H79).
- **Confidence:** confirmed by code.

## 3. Checked and fine

- No open redirect: `/auth/callback` has no `next` parameter and always redirects to its own origin.
- Cookies: HttpOnly, Secure in production, SameSite=Lax, 12-hour cap (`supabase/cookie-options.ts`); idle (30 min)
  and absolute (12 h) limits in `middleware.ts`, idle cookie signed and bound to the session id. Idle limit switches
  off only if `ADMIN_SESSION_SECRET` is missing, which the Vercel prebuild refuses.
- CSRF: server actions get Next's Origin check; mutating routes are POST with SameSite=Lax cookies; exports are GET
  (a cross-site link can trigger a download and an audit row but cannot read it).
- CSP: nonce + `strict-dynamic`, `frame-ancestors 'none'`. Only `UpiQr` uses `dangerouslySetInnerHTML`, on SVG made
  by the `qrcode` library; the UPI link is built with `URLSearchParams`.
- Money actions: every one checks money (or admin) role and the authenticator code before calling the database;
  refunds are claimed in the edge function (`claim_escrow_refund`), payouts refuse a second settle.
- Exports: CSV formula guard on `= + - @ tab CR`; an audit row is written before any row is built and its failure
  stops the export; filters are logged by name only; contacts masked by role on the server.
- Audit: settings, roles and money writes are logged by database trigger (`private.audit_change`, migration 076) and
  by each `admin_*` function.
- `updateSetting` and `setSwitch` treat an RLS "0 rows" as a failure.

## 4. Needs a live check later (owner signed in, one login per staff role)

1. `max_rows` on staging (Supabase API settings) to size R4-X3 and R4-X13.
2. As Viewer: press "Mark all read" on `/alerts` and confirm it clears for an Admin (R4-X5); open `/settings/switches`
   and see the live switches (R4-X14).
3. As Sales: view the page source / RSC payload of `/` for `refunds` (R4-X10).
4. As Support: replay a `sendBroadcast` POST to a one-person audience twice and confirm two pushes (R4-X4).
5. Type a single space for "Clearing period" and see whether it saves 0 (R4-X7) — on staging only, then put it back.
6. Open `/login?error=test` (R4-X11); sign in with a non-admin Google account and check the cookies left (R4-X12).
7. Trigger "End all staff sessions" refusal to see the "ERROR:" prefix (R4-X9).
8. Export People with the 120 fake people and time it, to estimate R4-X6 at scale.
9. Golden path per role from H80 (every menu page loads, hidden pages refuse by address).
