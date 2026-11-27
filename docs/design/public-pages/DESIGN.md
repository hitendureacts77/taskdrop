# Design: public pages Google can read (plan task 4.3)

Status: DESIGN ONLY, for the owner to approve. Nothing here is built. Mockup: `docs/design/public-pages/mockup.html` (open in a browser; switch pages, Desktop 1100 / Phone 375, light / dark).

Anything marked **IDEA** or **TO CONFIRM** is not a live feature.

## Why

The web app draws itself in the browser, so Google reads it poorly. Plain static HTML pages are fast and readable. Target: 70+ on a phone-sized speed test (F1 in 3.6).

## Pages (7 designed now)

| Page | Path | Main heading (h1) | Facts copied from |
|---|---|---|---|
| Home | `/` | What do you need done? | `HomeSections.tsx` (hero + tagline), `WelcomeStory.tsx` (4 steps) |
| How it works | `/how-it-works` | How taskdrop. works | `WelcomeStory.tsx` HIRE_BEATS (4) and EARN_BEATS (5) |
| Earn | `/earn` | Earn with taskdrop. | `PricingScreen.tsx`, `HowEarnExtras.tsx` |
| Fees | `/fees` | Fees, shown plainly | `PricingScreen.tsx`, `packages/rules` FEES |
| Safety | `/safety` | How taskdrop. keeps you safe | `HowEarnExtras.tsx` tips, `PricingScreen.tsx` |
| Help / Contact | `/help` | Help and contact | `HelpScreen.tsx`, public email only (`hello@taskdrop.in`, plan 2.22) |
| Request your area | `/request-your-area` | Request taskdrop. in your area | IDEA (new form) |

Plan 4.3 also lists **Categories** and the **legal pages**. Same template, later: legal text is rendered from `apps/mobile/src/legal/documents.ts` so there is one copy of the words; Categories needs the owner's list (open question 4). Not mocked here.

## Look

- Tokens from `apps/mobile/src/theme.ts`: bg `#F3F4F1`, ink `#121417`, jade `#0E8F72` / deep `#0A6F58`, hero gradient `#0D8A6F` to `#064A3B`, royal `#2F5BEA` / `#1E40AF`; dark set mirrored. Plus Jakarta Sans (self-hosted in the build, not from a Google CDN, so no extra request or privacy leak).
- Brand: lowercase `taskdrop.` wordmark with the drop+check logo; tagline "Ask for anything. Someone gets it done for you."; tasks shown as nearby AND online.
- Two palettes never merged: Hire / poster = jade, Earn / worker = royal blue (Earn page is blue, Fees shows jade for 3% and blue for 10%).
- White text only on deep shades (4.5:1). Honours `prefers-color-scheme`. Phone layout: 16 px gutter, one column.

## Fees as the code has them today (checked, not taken from the plan)

- `packages/rules/src/index.ts` FEES: service fee 3% (poster, on top), commission 10%, cancel-after-start fine 5%, clearing 7 days.
- Live commission is the `worker_commission_pct` setting: migration 001 seeded 0.20, migration 059 changed it to 0.10. The `0.20` defaults inside migration 195 SQL are only fallbacks. The app reads the real value through `platformFees()` (`data/extras.ts`, fallback 0.10 / 0.03 / 7 days / 0.05).
- Fine goes to the worker (app copy: "Paid to the worker for the time they already put in").
- **TO CONFIRM (Plan B):** AGENTS.md says under Plan B there is no wallet, no top-up, no withdraw, and the worker is paid to bank or UPI on approval. The app still shows wallet and 7 days while `money_flow = 'wallet'`. The public Fees, Earn and Help words must change on the same day as the app. Recommendation: the page text for "when you are paid" is one small file (`payout-words.json`) with two variants, and the build picks the one matching the production `money_flow` setting.
- To avoid a wrong number on a public page: the build script imports `FEES` from `packages/rules` (never typed by hand) and a test fails if the page text and `FEES` disagree. A page showing "10%" while the admin changes it to 12% is a real risk; the page is rebuilt on each merge, and a nightly check compares with the live setting (IDEA).

## SEO checklist (plan 4.3 step 4) mapped per page

Every page gets all of these; the mockup shows each page's exact values below the preview (with character counts).

| Item | Rule | Home | How | Earn | Fees | Safety | Help | Area |
|---|---|---|---|---|---|---|---|---|
| One h1 | logo is not a heading | yes | yes | yes | yes | yes | yes | yes |
| Title (~60) | unique | brand + tagline | How taskdrop. works... | Earn with... | fees 3% / 10% | Safety... | Help and contact | Request... |
| Description (~150) | unique | yes | yes | yes | yes | yes | yes | yes |
| Canonical | production address only | yes | yes | yes | yes | yes | yes | yes |
| Share tags + 1200x630 image | og:*, twitter:card, WhatsApp + LinkedIn check | yes | yes | yes | yes | yes | yes | yes |
| Schema.org | | Organization + WebSite | BreadcrumbList + HowTo | BreadcrumbList | BreadcrumbList + FAQPage | BreadcrumbList | BreadcrumbList + FAQPage + ContactPage | BreadcrumbList |
| Favicon | drop+check, 32, 180, svg | shared | | | | | | |
| Sitemap + robots | allow production, block staging | all 7 listed | | | | | | |

Notes: Organization and WebSite schema appear once, on Home. FAQPage text must match the visible text exactly (no hidden answers). Share images: 7 PNGs generated in the build from one template (gradient + page title), so they cannot drift from the page. Staging keeps `noindex` and a blocking robots.txt (already done by `apps/mobile/scripts/web-env-guard.mjs`: it writes `robots.txt` that blocks everyone on staging and nothing on production; `vercel.json` also sends `X-Robots-Tag: noindex` for `taskdrop.in`).

## How they are served (recommendation)

Plain static HTML files, written by a small build script, placed in the same `apps/mobile/dist` folder as the Expo web export, so the same project and the same deploy publish both. No new server, no framework.

The one real design problem: `/` is the app today (`vercel.json` rewrites everything to `/index.html`; Vercel and Cloudflare both serve a real file before the rewrite, so `/how-it-works/index.html` wins, but `/` is the app's `index.html`). Options:

- **A (recommended): public pages on the root address, app on a subdomain** (`app.<production address>`). Cleanest for Google, no cloaking, the app stays untouched. Cost: sign-in redirect allow-lists (Supabase, Google OAuth, App Check, CSP, CORS) get the new address; this is the same work 5.12 already does for new addresses (step 5 and 7), so do it once.
- B: app under `/app`. Needs an Expo `baseUrl` change and breaks existing links and sign-in return addresses. More risk.
- C: keep the app at `/` and only publish inner pages. Google then has no readable Home. Not recommended.

### Hosting (task 5.12)

PR 476 and 479 (merged into the plan) make 5.12 start now: the user web moves from Vercel to Cloudflare Workers static assets, built in GitHub Actions and uploaded with wrangler; `_headers` is generated per site (staging: noindex; production: production CSP). Because the public pages are just files in `dist`, they ride along with no extra work: add the build step before that `_headers` step. The mockup's design does not depend on which host wins. If 5.12 slips, the same files work on the current Vercel build (`scripts/vercel-build.mjs`, before the "scan the web build" step). Also: the page CSP must allow the form post (Request your area) and the fonts; `_headers` for the public pages should be stricter than the app (no `unsafe-eval`).

## Build steps (when approved)

1. `apps/mobile/scripts/build-public-pages.mjs`: one template file + `pages.json` (text, titles, descriptions) + `FEES` from `packages/rules`; writes `dist/index.html`-style pages (or `dist/<slug>/index.html`), `sitemap.xml`, `robots.txt` handled by the existing guard, share images, favicon set. (If option A, the app's own `index.html` moves to the app host's build.)
2. Test: page text vs `FEES`; each page has exactly one h1, a title within 70 characters, a description within 160, a canonical on the production host, no `taskdrop.in` canonical; links all resolve.
3. Add to the web build before the secret scan (`scripts/scan-build.mjs`) so it covers the pages too.
4. Staging check: view source, Lighthouse mobile (70+), real WhatsApp message preview, LinkedIn Post Inspector, rich results test. Search Console comes in 6.4.
5. Go live with the production address at launch (5.10).

## Request-your-area form (IDEA, needs decision)

New table `area_requests(id, created_at, name, area, contact, interest)`, insert through a small Edge Function with a hidden spam field and a per-address rate limit, rows visible in the admin. No third-party form service (keeps data in India, per the data-in-India rule). Consent line under the button. Contact is personal data: privacy policy line needed, and never logged.

## Open questions for the owner

1. App at a subdomain (A, recommended), under `/app` (B), or accept no readable Home (C)?
2. Fees/Earn/Help payout words: wallet wording (today) or Plan B wording at launch? Which money flow will be live on launch day?
3. Request-your-area: where do submissions go (admin table, recommended) and who reads them?
4. Categories page: the owner's list of categories to show, and are real public task examples allowed on Home (IDEA), or fixed examples only?
5. Public email: only `hello@taskdrop.in` on Help, correct?
