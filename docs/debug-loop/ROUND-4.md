# Debug round 4 (13 Nov 2026)

Plan task 2.19. Pinned commits: user repo `e579a29` (PR 336; `redesigned-2.0` has since moved to `a87dfe5`, docs only), admin repo `db0161b`. Target: the staging project and `taskdrop.in` / `admin.taskdrop.in`, fake data only. Every entry is in `LEDGER.md` (B87 to B140, plus B21 grown and the B30-B86 rechecks). The Android explorer's findings are added after this report, from B141.

Reports (raw material, one per charter):

- [Web explorer](round-4/web.md): guest and new sign-up on taskdrop.in
- [Backend collect and recheck](round-4/backend-collect.md): migrations, deploys, advisors, logs, staging recheck of B30-B86
- [Admin, live walk](round-4/admin-live.md): admin.taskdrop.in as the owner's Admin account, up to "Audit log"
- [Admin, code review](round-4/admin.md): role matrix, routes, actions, local checks
- [Sweep](round-4/sweep.md): both repos' checks, contract, audit, build and e2e runs

## What was run and what came out

| Charter | What was done | Result |
|---|---|---|
| Web (A/B) | Guest and new sign-up on taskdrop.in at about 852 px: area, phone box, age gate, post flow, composer, sign-in code | 8 findings B87-B94: 1 High (typing a +91 number still changes it, B88), 4 Medium, 3 Low |
| Backend (C/F) | Select-only on staging: migrations 162-177, deploy dates, advisors, 24 h of logs, 10 invariants, recheck of B30-B86 | 18 bugs Verified (some structure only), B84 not checkable, B54/B55/B56/B85 still open for the owner; 10 new B95-B104 (1 High: migration 152 not applied) |
| Admin live (E) | Walk of Dashboard, Needs you, Earnings, Payouts, Money check, Jobs, People, Settings pages; edge cases on tags, suspend, fee editor, rules, CSV | 15 findings B105-B119 (2 High: jobs paging skips 280 of 748 jobs, Pay screen QR shows a different UPI id) |
| Admin code (E) | Every guard, route and server action read; 169 admin tests, lint | 19 findings B120-B138 (0 High, 7 Medium, 12 Low); H77 and H78 confirmed in code |
| Sweep (G) | `check` x2, contract x2, audit gate x2, admin typecheck, lint, tests, audit and build, e2e | all green except `test:db` (not run, B140) and e2e (red, B139); no `[DBG-` lines left; no flaky test seen |

Invariants that held on staging (0 rows): negative wallets, wallets without a profile, live task status without a live assignment, an OPEN task with a live assignment, more than one live assignment or locked bid per task, completed without a date, refunded over the amount, a paid top-up not credited, rating averages out of step. Security advisors showed no ERROR; no runtime errors on either Vercel project in 24 h.

## Counts (B87-B140, 54 entries)

| Level | Count | Where |
|---|---|---|
| Critical | 0 | |
| High | 4 | B88 (typed +91 number), B95 (migration 152 not applied), B105 (admin jobs paging), B106 (Pay screen UPI id) |
| Medium | 23 | B87, B90, B91, B93, B97, B99, B100, B107-B113, B120-B123, B125-B127, B139, B140 |
| Low | 27 | the rest |

By source: web 8, backend 10, admin live 15, admin code 19, sweep 2.

## Not covered this round

- Android explorer: reported separately, added from B141.
- Live admin walk stopped when the browser's Google session switched to a non-admin account. Not walked: My security, Disputes, Reports queue, Alerts, Help requests, Copyright, Feedback board, Promotions, Customer hub, Follow-ups and pipeline, Leads, Segments, Messages, Business reports, Team performance, Devices, exports other than People. Needs the owner signed in again as Admin, then charter E from "My security".
- No per-role logins (Viewer, Finance, Support, Sales): B124, B129, B133 and the role matrix are code-only.
- Widths 390 px and a real desktop width: the window would not resize (admin seen at 767 px, web at about 852 px).
- `npm run test:db`: money and access SQL tests unverified (B140). e2e: only `accounts` and `map` specs ran (B139).
- Platform controls form (banner link, minimum version, end date) was not saved; blocked by the session's permission check.
- B84 (Razorpay top-up retry) cannot be checked in SQL.

## Open for the owner

- **B95**: say yes to applying migration 152 (abuse caps) on staging.
- **B99**: add the `EXPO_BUILDS_TOKEN` secret to the `app-download` function (server store only).
- **B140**: provide `DATABASE_URL` or install `psql`, so `test:db` can run.
- **B21** (grown to 87 overdue open tasks and 8 stuck locks), **B54, B55, B56, B85**: the old money and expiry decisions.
- **B89** (age-gate retry), **B134** (do staff contacts count under H33), **B96, B101, B102, B103** (data cleanup or reseed), **B104** (index, only if asked).
- Sign back in to the admin as Admin so the live walk can finish; also look at wheel zoom on taskdrop.in by hand to settle B139's zoom half.
- B112 reminder: the authenticator is future scope, so turning the switch on stays blocked until an admin has one.

## What is next

1. Fix the four High first: B88, B105, B106 in the apps (fix path A, one whole fix each), B95 after the owner's yes.
2. Then the Medium bugs by area (web sign-in and post flow, admin money screens, admin hardening B120-B123/B126/B127, B97/B100), one pull request per area, written fix path first.
3. Add the Android findings (B141 onward) and fill in the open counts in the rounds table.
4. Round 5 rechecks everything on staging (S4), re-runs the full e2e suite and `test:db`, and walks the pages round 4 could not reach.
5. Stop test is not met yet: new High found, nothing fixed, many fixes unchecked on staging. Floor is 3 rounds, ceiling 8.
