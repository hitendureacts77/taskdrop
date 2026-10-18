# TaskDrop: agent guide

TaskDrop is a live marketplace. People post a task in plain words; others nearby, or online from anywhere, send offers; the poster picks one; TaskDrop holds the money until the poster approves the work. India first (₹, UPI, Indian names and places).

Tagline: "Ask for anything. Someone gets it done for you." Tasks are **local AND remote**. No copy may suggest local-only.

## Read first

- `docs/UPGRADE_PLAN.md` is the single source of truth for the upgrade (phases, decisions, to-dos). Update it, and its changelog, when a decision changes. Tick checkboxes in the same PR as the work.
- **Do not implement a phase until the owner says "start Phase N".**
- Design work: confirm the static design and animations with the owner **before** building any clickable prototype. See `TASKDROP_REDESIGN_PROMPT.md` in the parent folder.

## Stack

- **App:** one React Native codebase, `apps/mobile`. Expo SDK 57, React Native 0.86, React 19. Runs on Android, iOS and web (`react-native-web`). Web is deployed on Vercel. EAS is for app builds only.
- **Expo has changed.** Before writing Expo code, read https://docs.expo.dev/versions/v57.0.0/ (see `apps/mobile/AGENTS.md`).
- **Monorepo:** npm workspaces + Turborepo. `packages/rules` (money constants), `packages/schemas` (Zod, shared by app and Edge Functions), `packages/supabase` (client factory), `packages/db-types` (generated).
- **Backend:** Supabase (Postgres, RLS, Edge Functions in Deno) in `supabase/`. Project ref `wjxvingpfbfvkfqhrguj`, region ap-south-1.
- **Payments:** Razorpay escrow, RazorpayX payouts. **Background jobs:** Inngest only. Postgres owns the rules and money and writes events to an outbox; Inngest runs schedules, retries and outside calls (`supabase/functions/inngest/`, `docs/INNGEST.md`). n8n was removed (owner decision, 2026-10-12); the money sweeps stay on pg_cron until the Inngest cutover. Push, deleted-account file cleanup, overdue tasks and the prunes are built (migration 101) and switch over with `supabase/cutover/inngest_background_jobs.sql`. Payouts, refund retries and webhook hand-off wait for the lawyer's answer on the money flow. **Images:** ImageKit; video and documents stay in Supabase Storage.
- **Sign-in:** phone OTP, Google, Apple, username + password.
- **Admin app:** separate repo, `../taskdrop-admin` (Next.js 16, port 3001). It controls the user apps, enforced server-side.
- Rejected, do not suggest: Clerk, Stripe, Pinecone, Flutter.

## Commands

```bash
npm run web          # app in a browser, http://localhost:8081
npm run android      # Expo dev server
npm run check        # typecheck + lint + unit tests (CI runs this)
npm run test:db      # SQL money/access tests (needs DATABASE_URL)
npm run db:types     # regenerate packages/db-types after a schema change
```

Run `npm run check` before calling anything done. Run `npm run test:db` for any migration or money/permission change.

## Rules that must not break

1. **The app asks, the server decides.** Money, permissions, limits, prices and switches are always checked on the server (RLS, RPCs, Edge Functions), never only in the client.
2. **One shared database until Phase 9.** The old app, old admin and the upgrade share the Supabase project. Migrations only **add**; never drop or rename. Existing `api` operations keep their inputs and responses. Old functions (`phone-auth`, `password-auth`, `razorpay`, ...) keep working.
3. **`main` is never altered by agents** (user and admin repos). All new work goes into **`redesigned-2.0`** (both repos), which Vercel deploys as a preview and where the owner tests it; the owner promotes it to `main` by hand. Use a short-lived branch per change, merged into `redesigned-2.0` by PR and then deleted: on GitHub only `main` and `redesigned-2.0` should exist. (`upgraded-plan-changes` and `taskdrop-redesigned` were retired on 2026-10-12.)
4. **Backend changes are built against a local Supabase stack (Docker) first**, then deployed to the hosted test project.
5. **Stage is testing only:** fake data, the owner plus ~10 testers, free plans. No real customer data until the owner decides to launch.
6. **Secrets:** never read, print, commit or paste `.env` values. Use `.env.example` for shape. Never put a service-role or Razorpay secret key in client code.
7. **Do not push, merge, deploy, or touch the hosted database without being asked.**
8. **No n8n for background work.** Schedules, retries, digests and alerts are Inngest functions; events leave the database only through `private.emit_event` (the outbox). Do not add n8n calls or new pg_cron jobs. Phase 5 is under way: move one job at a time, removing the old job in the same deploy as its replacement.

## Product rules (keep in code, copy and design)

- **Keep every existing feature**, including remote tasks. Redesign changes look and motion only.
- **No "go live" switch.** Presence is automatic: "Active now" (heartbeat every minute), "Active today", or time since last seen.
- One account does both. A mode switch flips Hire and Earn; "My Tasks" becomes "My Work", "Explore" becomes "Find work".
- Money (constants live in `packages/rules`, never hard-code): poster pays the offer + 3% service fee, held until approval; worker pays admin-set commission (currently 10%); cancelling after work starts costs the poster a 5% fine; poster has 3 days to approve or report, otherwise auto-complete; earnings clear after 7 days, then withdraw to UPI or bank.
- Privacy: only the area name shows until a worker is chosen; exact address and contacts unlock when work starts. Users must be 18+.
- Media: photos, videos up to 60 s, proof of work files up to 50 MB.
- Legal open items: DMCA agent, legal env vars and lawyer review are still open. Do not claim compliance in copy.

## Design and UI

- Brand: water drop with a check; lowercase wordmark `taskdrop.` with a jade dot. Never a map pin.
- Colours: jade `#0E8F72` (deep `#0A6F58`) = hiring and protected money; royal blue `#2F5BEA` = earning; violet `#7F77DD` = AI writer; gold `#E0A85A` = verified; coral `#E0724A` = warnings. White text only on the deep shades (4.5:1 minimum).
- Type: Plus Jakarta Sans; money uses tabular figures. Use tokens from `apps/mobile/src/theme.ts`, never raw hex in screens.
- Light, dark and System themes. Dark must be first-class.
- One component set for all three platforms. Phone: 390x844 with the bottom tab bar. Web desktop: left side menu (`SideNav`).
- Navigation today is custom: `BottomTabBar`, `SideNav`, `NavProvider`, `ScreenHost`. Do not introduce expo-router or react-navigation (including native tabs) without owner approval; see open decisions.
- Motion should respect reduced-motion settings.

## Code style

- TypeScript strict. No `any` without a comment saying why. Validate input with the shared Zod schemas.
- Match the surrounding file's style, naming and comment density. No unrelated refactors in a feature PR.
- Platform splits use the `.web.tsx` / `.native.tsx` suffix pattern already in `components/` and `lib/`.
- Errors go through `lib/errors.ts` and `lib/monitoring.ts`. Show people plain-language messages, not raw errors.

## Open decisions (ask the owner, do not assume)

- **Native tabs:** moving to Expo native tabs needs expo-router and a navigation rewrite, and web keeps its own side menu. Decide before any navigation work.
