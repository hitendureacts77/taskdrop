# Handoff: admin control center (2026-10-18)

Branch `redesigned-2.0`, both repos: app `C:\complete taskdrop\taskdrop-redesigned`, admin `C:\complete taskdrop\taskdrop-admin`. Hosted test project `wjxvingpfbfvkfqhrguj`.

## State
- Migrations 090, 092-098 are applied to the hosted test DB and recorded in `schema_migrations`.
  - 097: blocking (RLS), Sales role, leads, automation rules, nightly reconcile, verified-phone switch, devices.
  - 098: `admin_cancel_task_with_refund`, `admin_pause_promotion`, `private.assert_money_staff`.
- `api` and `inngest` edge functions are deployed.
- Tests green: api 36, admin 83, admin `tsc` clean, SQL `closeout.test.sql` and `admin_cancel_pause.test.sql` pass on the hosted DB (both are in `test:db`).
- Admin UI: Cancel and refund card on `/tasks/[id]` (OPEN/LOCKED, money staff); Stop button on `/promotions`; plus Sales role, leads, rules, owners, devices, controls, reconcile runs, health card.
- **Nothing is committed** in the app repo, and most of the admin repo (only commit `b671f46`). The user was asked whether to commit both on `redesigned-2.0` (no push); no answer yet.

## Owner steps still open
1. **Authenticator: DEFERRED (owner, 2026-10-24: "no need now"; future scope, see `docs/UPGRADE_PLAN.md` Part B, section 13). Skip this step.** Old instructions: admin panel -> Admin & configuration -> My security -> Set up authenticator app; scan the QR with Google/Microsoft Authenticator or 1Password; enter the 6-digit code. After that, the top-bar "Unlock money actions" chip takes a code per session (needed for money actions and adding staff).
2. **Inngest keys** (`docs/INNGEST.md`): create an Inngest Cloud account and app `taskdrop`; copy the Signing Key and Event Key; run `supabase secrets set INNGEST_SIGNING_KEY=... INNGEST_EVENT_KEY=...`; sync the app at `https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/inngest`; optionally `select vault.create_secret('https://inn.gs/e/<EVENT_KEY>','inngest_event_url');`. Until then `crm-rules` and `nightly-reconcile` don't run.
3. **Second staff account (Sales tester):** add it to `ADMIN_EMAIL` as a comma-separated list (Vercel and local; agents must not read or edit `.env`). They sign in once with Google. Then add them under Team & access -> "+ Add admin" and pick Support/Finance/Sales/Viewer. Then check each role's screens.
4. Sentry card needs `SENTRY_PROJECT_URL`.

## Update 2026-10-18 (later)
- Inngest is synced (12 functions). Items 2 above is done.
- The second staff account is now admin + Sales on the hosted DB. Vercel `taskdrop-admin` has no `ADMIN_EMAIL`, so the DB role decides; no env change needed there.
- A live test as real non-admin users passed 26/26: admin RPCs refused, staff/CRM tables unreadable, blocking hides jobs and refuses bids both ways. This closes the "SQL tests run as postgres" caveat below.

## Update: Sales is money-blind (2026-10-18, uncommitted)
- Admin app: `staffCanSee` in `src/lib/staff-roles.ts`; Sales has no Money, Disputes, Promotions, Business reports or Admin & configuration (menu, pages, live feed, wallet figures, CSV) and gets `SalesDashboardView`.
- Database: migration `099_sales_money_block` applied to the hosted test DB and recorded. Restrictive policies on wallets, payouts, payout profiles, ledger, adjustments, promotions, disputes, audit log, team, controls, rules, live events and the `admin:live` realtime channel; `private.assert_not_money_blind()` added to 15 money functions. SQL test `supabase/tests/sales_money_block.test.sql` is in `test:db`.
- Live test as a real Sales login passed 46/46. Not covered: `tasks.funded_*` and `assignments.escrow_minor` (the job page needs them).
- Found, then fixed by migration 100 (next section): Support, Viewer and Finance could still call money functions like `admin_mark_payout` directly (only the panel stopped them).
- Also fixed an old bug in `getUser` (admin repo) that broke every person page.

## Update: database enforces staff roles on money writes (2026-10-18, uncommitted)
- Migration `100_staff_role_db_guards` (version 20261018130000) applied to the hosted test DB and recorded. `admin_mark_payout`, `admin_resolve_dispute` and `admin_set_payout_method` got one guard line, `perform private.assert_money_staff();`, right after the Sales guard; signatures and bodies unchanged. Only a full admin or Finance passes (with the authenticator code while `admin_require_mfa` is on; it is currently `false` on the hosted DB).
- Audit result: no other public money-write function executable by `authenticated` lacked the guard. `record_escrow_refund` is service-role only; `escrow_refund_due` is a read the poster uses (Sales-blocked since 099); wallet adjustments are table writes (staff-role trigger from 089), not a function.
- Finance still can't change the payout method, because the `settings` table trigger (089) allows full admins only ("Ask a full admin"). The new guard does not change that.
- The helper needs `auth.uid()`, so a bare service-role or owner call to these three is now refused. Nothing calls them that way (the admin panel uses the staff member's own session).
- SQL test `supabase/tests/staff_role_db_guards.test.sql` is in `test:db`; it passed on the hosted DB (support and viewer refused, no-code refused, Finance and full admin allowed). A plain non-staff user can't be asserted in SQL tests (session_user is postgres, so `is_admin()` is true); the live test covers it.
- Live test as real logins (password sign-in, calls through PostgREST) passed 13/13: Support and Viewer refused on all three, a plain user refused on all three, payout unchanged, Finance reached the dispute rules, moved a throwaway payout and was stopped by the settings trigger on the payout method. The throwaway users, payout and job were deleted afterwards (checked: zero left). The users were created with SQL into `auth.users` plus an email identity (agents have no service-role key), then signed in through the normal `/auth/v1/token` endpoint.
- Not rerun after 100: the other `test:db` files. `admin_mfa`, `staff_roles` and `sales_money_block` call these functions and their expected messages still match the new guard's, but run the full `npm run test:db` once with `DATABASE_URL`.
- Still open (non-money writes that only check `is_admin()`): `admin_delete_account`, `admin_set_admin`, `admin_set_staff`, copyright takedown/restore/counter/reject, `crm_*` writes, `reply_support_ticket`, `resolve_support_ticket`, `admin_log_event`. Support and Sales are meant to do the CRM and ticket ones; check whether Viewer should be blocked on them.

## Update: closing the gaps (2026-10-17, uncommitted)
- Phase 6: `private.reconcile_rows` proven to catch a planted bad payment (inserted in a block that raised, so rolled back; nothing left). A real `run_reconciliation(3)` run was recorded (`reconciliation_runs`, internal, 1 mismatch). The Inngest cron itself was not triggered from the Inngest dashboard.
- The 24 mismatches on the test DB are mostly seed/demo data: 14 abandoned payment links (oldest 14 Sept), 4 finished demo jobs with no commission ledger rows, 4 old test withdrawals still `requested` (6 are waiting on the Payouts page), 1 demo RazorpayX payout with a reference in `reference` but no `provider_payout_id`, and 1 real payment (`pay_TgdMVcUQqGixjS`, ₹978.50, 26 Sept) that was fully refunded. The `paid_not_credited` check does not exclude fully refunded payments, so that one is a false positive; consider a migration 101 adding `and coalesce(pay.refunded_minor,0) < pay.amount_minor`.
- Role screens checked in Chrome as real logins (the second account's role switched with SQL, restored to `sales`): Finance, Support and Viewer see the money pages (view only); Sales sees none. Support/Viewer used to still see Pay links and settings Change buttons (the server refused them). Fixed: `/payouts` shows "Open" instead of "Pay", `/payouts/[id]` shows a "look, not pay" notice, and settings Change buttons show only to full admins (matches the 089 trigger). Finance therefore also can't change settings in the UI, as in the database.
- Not checked: Sales at phone width. The Chrome window would not shrink below desktop width and the built-in browser has no panel sign-in.
- Phase 0: `src/lib/data.ts` (1569 lines) split into `src/lib/data/{shared,totals,payouts,people,money,settings,activity,tasks,users,disputes,promotions,support,nav}.ts` with `index.ts` re-exporting, so `@/lib/data` imports are unchanged. Lint added: `eslint.config.mjs` (typescript-eslint + react-hooks, not eslint-config-next, which fails `npm audit`), `npm run lint`, and a lint step in `.github/workflows/ci.yml`. Admin `tsc`, lint (0 errors), 85 unit tests and `next build` pass.

## Caveats
- SQL tests run as postgres, where `is_admin()` is true, so they can't prove "non-admin refused" or RLS row visibility; the live tests with real logins (26/26, 46/46, 13/13) cover that.
- The Razorpay comparison can't run until Razorpay keys are set on the Inngest function.
- Admin `npm run db:types` needs `supabase` on PATH. Use `npx supabase@latest gen types typescript --project-id wjxvingpfbfvkfqhrguj --schema public` to a temp file and copy it to both repos' `database.types.ts`.

## Next
1. Commit both repos on `redesigned-2.0` if the user says yes. Don't push.
2. After the owner steps, check each role in the browser pane at desktop and phone width.
