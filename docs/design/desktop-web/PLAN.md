# Desktop web: a real web design, not a phone screen on a big monitor

> Planned 17 Nov 2026 on branch `feat/worker-setup-simple-desktop-design`. Plan only, nothing built.
> Applies to the **web build at 1024 px wide and up only**. Phone web (under 600), the tablet rail (600 to 1023),
> Android and iOS must look exactly as they do today.
> Builds on "Desktop fit" (`docs/design/desktop-fit/PLAN.md`, built and merged): the page zoom, the
> FULL/FEED/READ/FORM column widths, `TwoPane`, and the one bar of bell/messages/avatar all stay. This plan does not redo them.

## 1. The problem, in the owner's words

"The desktop size looks like a mobile interface just incorporated in a desktop. There's no proper web design,
spaces everywhere. I want a different design for mobile and a different design for web application."

## 2. What is there today (read from the code)

- **The frame.** `App.tsx` → `navigation/ScreenHost.tsx`. On a desktop it draws `SideNav` (264 wide) on the left and
  then one column, centred, whose width depends on a list of screen names (`columnFor`): FULL for the two maps, FEED
  (up to 1680) for 11 list screens, READ (up to 960) for 8 reading screens, two panes for 4 screens, and **FORM (up to
  760) for everything else**, about 25 screens. The page is zoomed 1.0 to 1.35 with the window (`lib/desktopScale.web.ts`).
- **The bar on top.** `navigation/DesktopTopBar.tsx` is a 56 px strip with only the bell, messages and avatar at the
  right. It has **no page title**, so the top-left of every page is empty.
- **The screens still draw phone chrome inside the column.** 23 screen files use `TopBar` (a back arrow and a 20 px
  title, built for a phone), 11 use `BackButton` with their own title row, and 2 (`AiPostScreen`, `OnboardingScreen`)
  draw their own back arrow and step row. So on a desktop you see an empty bar, then a phone header, then the phone page.
- **Forms are phone forms.** Example `WorkerSetupScreen.tsx`: one long column of labels, a wrap of pills, a full-width
  "Start earning" button at the end, all on the bare page background with no card edge. On a 1440 window that is a
  narrow strip floating in the middle with empty space both sides. That is the "spaces everywhere".
- **Some screens already have desktop branches** (`useLayout().desktop / twoPane / columns`): Home (grid), Explore
  (full map + panel), My Tasks, Orders (`Grid`), Notifications (2 columns), Help, Inbox (360 list + chat side by
  side), Wallet (2 columns), Task detail, Profile, Public profile, Settings (`TwoPane`), Manage task (side by side).
- **Phone-safe pattern already used.** `Grid` and `TwoPane` render exactly the old one-column layout when not on a
  wide desktop. Every new piece in this plan follows the same rule.

**Screens by kind (54 names in `navigation/registry.tsx`, sorted by how they are used):**

| Kind | Count | Screens |
|---|---|---|
| Map | 2 | explore (map mode), nearMap |
| Feed or list | 18 | home, explore list, myTasks, orders, saved, wallet, spending, notifications, inbox, search, ideas, myQuotes, regulars, streaks, disputes, analytics, help, pricing |
| Detail (one thing) | 12 | taskDetail, taskManage, detailSheet, profile, publicProfile, account, chat, ideaDetail, active, compare, crew, bigDay |
| Form or step flow | 14 | workerSetup, setup (onboarding), aiPost, create, postDetails, confirm, escrow, swipe, withdraw, promote, review, profileEdit, listing, ticket |
| Sign-in and public | 8 | splash, intro, welcome, signup, terms, privacy, copyright, support (sign-in already has its own desktop frame) |

## 3. Why widening alone did not fix it

Desktop fit made columns wider and text bigger. It did not change the **shape** of a page. A web app page has a page
title at the top left with its buttons on the right, content laid out on cards that use the width (two or three
columns, a side panel, a table), and buttons that are normal size at the end of a form. Our pages still have a phone
header, one column, and full-width phone buttons. So this plan changes the shape, on desktop only, through a few shared
pieces, so each screen needs only a few lines to opt in.

## 4. The design

### 4.1 The desktop shell (every screen, no screen code)

```
+-----------+---------------------------------------------------------------+
|           |  < Back to My Work                                            |
|  SideNav  |  Set up your worker profile          [actions]  bell msg (A)  |   page header, 72-88 tall
|  (as now) |  Takes a minute. Same account.                                |
|           |---------------------------------------------------------------|   hairline (colors.line)
|           |        +-------------- page content, max 1280 -------------+  |
|           |        |  (one of the four patterns below)                 |  |
|           |        +---------------------------------------------------+  |
+-----------+---------------------------------------------------------------+
```

- **Page header** replaces today's empty `DesktopTopBar`. Left: an optional small "← Back" text link (muted, 13 px) on
  pushed screens, then the page title (800 weight, 26 px, `colors.ink`) and an optional one-line subtitle. Right: the
  screen's own action buttons (if any), then the bell, messages and avatar (`HeaderTools`, as now). The header lines up
  with the content below it, not with the window edge.
- **Where the title comes from, with no screen edits.** `TopBar` and `BackButton` already hand their title and right
  button to the phone's system header (`nativeHeader.ts`). On a desktop they do the same thing into the page header:
  they draw nothing in the page and their title, subtitle, back action and right button appear in the header (through a
  React portal on web, so buttons keep working with the screen's own state). Tab screens with no `TopBar` (Home,
  Explore list, My Tasks, Wallet, Profile, Messages) get their title from the existing `titleForScreen` names
  ("My work", "Find work" in Earn mode). Home shows no title, only the header tools, because its hero is the title.
- **Content width.** Page content is centred, up to **1280** design px (FEED_MAX drops from 1680 to 1280; with the zoom
  that is about 1450 to 1730 real px on big screens). The side gutter stays as desktop fit set it.
- **Page background and cards.** On desktop the page background is `colors.bg` and content sits on cards
  (`colors.surface`, 1 px `colors.line` border, radius `lg` 18). Light and dark both use the theme tokens, no raw hex.
- **Buttons.** In a desktop action bar a `PrimaryButton` is its natural width (min 160), not full width.
- Maps stay full-bleed with their floating panel and floating tools, as now.

### 4.2 The four page patterns (screens opt in)

Each is one component. When not on a desktop (`useLayout().desktop` false) it renders **exactly what the screen
rendered before**, so no screen has two copies of its content.

**(a) FormPage** - onboarding, worker setup, posting, profile edit, withdraw, review, promote, listing, ticket.
```
 +--------------- card 720 ----------------+   +---- aside 320 ----+
 | WHY YOU WANT TO EARN                    |   | How customers     |
 |  (picker)                               |   | see you  (live    |
 |-----------------------------------------|   | preview card)     |
 | What you do        [ bio field       ]  |   |                   |
 |-----------------------------------------|   | Tips / steps      |
 | Skills             (pills, wrap)        |   +-------------------+
 |-----------------------------------------|      (aside optional; it sticks while the card scrolls)
 | hint text ...          [ Start earning ]|  <- action bar, sticks to the bottom of the window
 +-----------------------------------------+
```
- Pieces: `FormPage` (the card, the optional `aside`, the page scroll), `FormSection` (a titled block with a divider;
  on desktop the title can sit in a 200 px left column beside the fields), `FieldRow` (two fields side by side on
  desktop, stacked on phone), `ActionBar` (hint left, buttons right, sticky bottom, top hairline).
- Phone: `FormPage` renders today's `KeyboardScrollView` with the same props, the children, and the actions either
  inline at the end (worker setup style) or pinned under the scroll (onboarding style): `phoneActions="inline" | "pinned"`.
  `FormSection`, `FieldRow` and `ActionBar` render their children untouched.
- Step flows (onboarding, posting): the `aside` shows the steps as a vertical list (done / current / next) instead of
  "Step 2 of 5" text over a thin bar.

**(b) TwoPane** - task page, manage task, messages and chat, profile. Already built (`components/TwoPane.tsx`).
Kept as is; this plan adds the page header to it and, later and only with owner OK, "click a row on the left, see it
on the right" for Messages and My Work (section 6, packages 11 and 12).

**(c) CardGrid page** - Home, Find work list, My Tasks / My Work, Saved, Orders, Notifications, Search, Ideas.
`Grid` already gives 2 to 4 columns. New: `ListPage` with an optional **filter column** (240 wide, left) and a
**toolbar row** (tabs as a segmented control on the left, sort/filter/count on the right) above the grid. Phone: the
filter column is not drawn (the phone keeps its filter sheet), the toolbar renders the screen's existing tabs untouched.

**(d) Settings / Profile** - two columns: a left list (sections or tabs, 240 wide, vertical) and the page on the
right (max 720). Built in desktop fit for Settings and Profile; this plan only moves their titles into the page header
and makes Wallet use the same left list for "Balance / Activity / Withdraw".

### 4.3 Rules every desktop page follows

1. No phone header in the page on desktop: titles live in the page header.
2. No full-width button on desktop except in a sheet; buttons go in an `ActionBar` or the header.
3. Content sits on cards; nothing floats on the bare background except page-level headings.
4. A page never shows one narrow column with more than 160 px empty on both sides at 1440 x 900, except on purpose
   in FormPage, where the `aside` fills the right side.
5. Under 1024 nothing changes. Every new component starts with `if (!desktop) return <old thing>`.

## 5. How we check it (every package)

- **Desktop at 1440 x 900 on localhost**: `npm run web:export` then `node e2e/serve-dist.mjs 8099` from the repo root,
  open `http://127.0.0.1:8099` in Chrome sized 1440 x 900 (or a Playwright viewport of 1440 x 900), sign in as a seed
  test phone with the dev code. Vercel branch previews cannot sign in, so always localhost. Quicker while coding:
  `npm run web` on port 8081. Note: at 1440 the zoom is 1.13, so the app lays out in 1274 design px.
- **Pictures**: before and after at 1440 x 900, light and dark, Hire (jade) and Earn (blue) where it matters, saved in
  `docs/design/desktop-web/before/` and `after/` with names like `1440-worker-setup-earn-light.png`, and put in the PR.
- **Phone unchanged**: package 0 (merged) added `e2e/desktopWeb.spec.ts`: 28 screenshots at 390 x 844 and 820 x 1180.
  Run it after `npm run web:export`: `E2E_PORT=8104 npx playwright test --project=web-phone-same` (add `--no-deps` to
  reuse the saved sign-in in `e2e/.auth`). It answers the app from `e2e/fixtures/desktop-web-api.json`, so it needs no
  fresh data; pictures at 1440 x 900 come from `--project=web-desktop-1440` (`DESKTOP_PICS_DIR=docs/design/desktop-web/after`).
  It is skipped in CI (Linux fonts differ) unless `DESKTOP_GUARD=1`. Each
  package runs it with no update; any pixel difference is a bug, not a new baseline. `npm run check` green.
- **No native files touched**: `git diff --name-only origin/redesigned-2.0...HEAD` shows no `.native.tsx`, nothing
  under `apps/mobile/src/app/`, no `app.json` or `eas.json`.
- Standing rules: `security-review` on the diff, PR into `redesigned-2.0`, merge. No OTA, no EAS build.

## 6. Build plan: small packages, in order

Who: **O** = Opus 5.5 (shared pieces, risky), **S** = Sonnet 5.5 (routine screen work).
Look: **show** = merge, then show before/after pictures to the owner (one PR to undo if he says no);
**ask first** = show pictures from localhost and wait for "yes" before merging (bigger layout change).

| # | Package | Files (under `apps/mobile/src/` unless noted) | Who | Risk | Look |
|---|---|---|---|---|---|
| 0 | Baseline pictures and phone guard | new `e2e/desktopWeb.spec.ts`, `playwright.config.ts` (projects `web-desktop-1440`, `web-phone-same`), `docs/design/desktop-web/before/` | S | low | none |
| 1 | Page header in the shell; `TopBar` and `BackButton` move their title into it on desktop | new `navigation/DesktopPage.tsx`, new `components/pageHeader.tsx` + `pageHeader.web.tsx`, `navigation/DesktopTopBar.tsx` (becomes the header), `navigation/ScreenHost.tsx`, `components/kit.tsx` (`TopBar`, `BackButton`), `lib/layout.ts` (FEED_MAX 1280) | O | **high**: every desktop screen | show |
| 2 | Shared FormPage pieces | new `components/FormPage.tsx` (`FormPage`, `FormSection`, `FieldRow`, `ActionBar`), `components/kit.tsx` (`PrimaryButton` natural width inside `ActionBar`), unit test | O | medium | none (not used yet) |
| 3 | Worker setup on FormPage, with "How customers see you" preview aside | `screens/WorkerSetupScreen.tsx`, maybe new `components/WorkerPreviewCard.tsx` | S | low | show |
| 4 | Onboarding (setup) on FormPage, steps listed in the aside | `screens/OnboardingScreen.tsx` | S | medium (step logic) | show |
| 5 | `ListPage` piece: toolbar row + optional filter column | new `components/ListPage.tsx`, unit test | O | medium | none |
| 6 | Find work / Explore list on ListPage: filters on the left (same `jobFiltersStore`), cards in a grid | `screens/ExploreScreen.tsx` (list mode only; map untouched) | S | medium | show |
| 7 | My Tasks / My Work on ListPage: tabs in the toolbar, grid below | `screens/MyTasksScreen.tsx` | S | low | show |
| 8 | Task detail and Manage task: title, Share and Report move to the header; offer/price card stays sticky right | `screens/TaskDetailScreen.tsx`, `screens/TaskManageScreen.tsx` | S | low | show |
| 9 | Home: two columns (feed left, a 320 "Your day" side column right: needs attention, money held, quick post), same sections in the same order inside each column | `screens/HomeScreen.tsx`, `components/HomeSections.tsx` | O | medium (Home order rule) | **ask first** |
| 10 | Profile, Public profile, Settings: titles to header, card surfaces, check left list | `screens/ProfileScreen.tsx`, `screens/PublicProfileScreen.tsx`, `screens/AccountScreen.tsx` | S | low | show |
| 11 | Wallet: 3 summary cards across the top, activity as a table (date, what, amount, status) on desktop, left list for Balance / Activity / Withdraw | `screens/WalletScreen.tsx`, maybe new `components/DataTable.tsx` | S | medium (money display) | **ask first** |
| 12 | Messages: open a chat in the right pane instead of a new page (master-detail) | `screens/InboxScreen.tsx`, `screens/ChatScreen.tsx` | O | **high** (navigation, read state) | **ask first** |
| 13 | Posting: AI writer with a live post preview on the right; Post details on FormPage | `screens/AiPostScreen.tsx` (1956 lines), `screens/PostDetailsScreen.tsx`, `screens/CreateScreen.tsx` | O | **high** (biggest screen, money step) | **ask first** |
| 14 | Other forms on FormPage, one PR each or two per PR: profileEdit, listing, withdraw, review, promote, confirm, escrow, ticket/support | the matching `screens/*Screen.tsx` | S | low each | show |
| 15 | Other lists on ListPage / Grid: saved, orders, notifications, search, ideas, myQuotes, regulars, streaks, disputes, analytics | the matching `screens/*Screen.tsx` | S | low each | show |
| 16 | Guard and docs: e2e checks for rules 1, 2 and 4 at 1440 on all screens; plan note in `docs/ULTIMATE_PLAN.md`, `node scripts/build-plan-html.mjs` | `e2e/desktopWeb.spec.ts`, docs | S | low | none |

Order of work: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8, then 10, 14, 15 (routine, any order), and 9, 11, 12, 13 when
the owner has said yes to their pictures. Packages 3 to 8 can run in parallel once 1 and 2 are merged (different files).

**Risky packages, and what to watch:**
- **1** touches the frame of every desktop screen. Watch: kept-alive tabs (several screens mounted at once; only the
  shown screen's title may appear), screens with two `TopBar`s depending on state (Wallet, Crew, Streaks, Task
  manage), the tour target `headerTools`, sheets and the map screens (no header on FULL screens).
- **12** changes how Messages navigates: unread counts, the browser Back button, and deep links to a chat must still work.
- **13** `AiPostScreen` is the largest screen and leads to payment; split it into "layout only" and nothing else.
- **9** must keep the Home section order and content of the live app (owner rule): only placement changes.

**Owner sign-off without blocking:** packages 0, 1, 2 and 5 are the foundation and go ahead. After package 1 and after
each "show" package, the PR carries before/after pictures at 1440 x 900 and the owner is sent them; if he rejects a
look it is one revert. "Ask first" packages are built on a branch, pictured on localhost, and merged only after his
yes. Before package 3 starts, send the owner the package 1 pictures plus a one-page sketch of the four patterns
(section 4) so he can stop us early.

## 7. Ready-to-paste briefs: the first three packages

### Brief: Package 0, baseline pictures and phone guard

> Repo `C:\complete taskdrop\Taskdrop user`, app in `apps/mobile`. Read `AGENTS.md` and
> `docs/design/desktop-web/PLAN.md` (sections 5 and 6). Make a short-lived branch from `redesigned-2.0`.
> Goal: pictures of today's desktop look and a test that proves the phone and tablet look never change.
> 1. In `playwright.config.ts` add two projects that depend on `setup` (like `web-desktop`): `web-desktop-1440`
>    (viewport 1440 x 900) and `web-phone-same` (viewports 390 x 844 phone with `isMobile`, and 820 x 1180).
> 2. New `e2e/desktopWeb.spec.ts`. Use the signed-in state from `auth.setup.ts` and the helpers in `e2e/helpers.ts`.
>    For these screens: home, explore (list), myTasks, taskDetail (first task from the feed), workerSetup, setup
>    (onboarding, if reachable for the seed account; skip with a note if not), wallet, profile, account, inbox,
>    notifications, aiPost. Desktop project: save a full-page screenshot to
>    `docs/design/desktop-web/before/1440-<screen>-<hire|earn>-<light|dark>.png` (Hire light for all; Earn light for
>    home, explore, myTasks, workerSetup). Phone project: `expect(page).toHaveScreenshot('<screen>-<w>.png',
>    { animations: 'disabled', maxDiffPixels: 0 })`; pause the Home "Just posted" ticker and any clock text with a
>    style mask (`mask:` option) so the picture is stable.
> 3. Make the baselines with `--update-snapshots` on `redesigned-2.0` code (no app changes in this PR), then run again
>    without it and confirm it passes twice in a row.
> 4. Build and serve: `npm run web:export` (in `apps/mobile`), then `npx playwright test --project=web-desktop-1440
>    --project=web-phone-same` from the repo root (the config serves `apps/mobile/dist` on 8099).
> Done when: the before pictures are in the folder, the phone test passes twice with no update, `npm run check` is
> green. Do not change any file in `apps/mobile/src`. Then security-review, PR into `redesigned-2.0`, merge.

### Brief: Package 1, page header in the desktop shell

> Repo `C:\complete taskdrop\Taskdrop user`, app in `apps/mobile`. Read `AGENTS.md`, `docs/design/desktop-web/PLAN.md`
> (sections 4.1, 4.3, 6), `navigation/ScreenHost.tsx`, `navigation/DesktopTopBar.tsx`, `components/AppHeader.tsx`
> (`HeaderTools`), `components/kit.tsx` (`TopBar` ~line 1049, `BackButton` ~line 1033), `navigation/nativeHeader.ts`,
> `navigation/webAddress.ts` (`titleForScreen`), `lib/layout.ts`. Package 0 must be merged. Desktop only (web, >= 1024).
> 1. New `navigation/DesktopPage.tsx`: `DesktopPageFrame` renders, inside the desktop column, a header row (left: back
>    link + title + subtitle; right: an actions host, then `<HeaderTools />`), a hairline (`colors.line`), then the
>    screen. It provides a context with a DOM node for the title area and one for the actions area (`ref` on a `View`
>    is a DOM element on web). Default title = the screen's name from `titleForScreen` without " · TaskDrop" (export a
>    plain `nameForScreen` from `webAddress.ts`); no title on `home`. Title `tx('800', 26, colors.ink)`, subtitle
>    `tx('400', 13, colors.muted)`, back link `tx('600', 13, colors.muted)` with the `back` icon, hover colour
>    `colors.ink`, `accessibilityRole="link"`, label "Back".
> 2. New `components/pageHeader.web.tsx` exporting `DesktopHeaderPortal({ title, subtitle, onBack, right })`: if a
>    frame context exists, `createPortal` (from `react-dom`) the title block into the title node and `right` into the
>    actions node, and return null; if not, return `undefined` so the caller falls back. `components/pageHeader.tsx`
>    (native) is a stub that returns `undefined`. A portal keeps the screen's own state and handlers working.
> 3. `ScreenHost.tsx` desktop branch: wrap **each** kept-alive tab and the current screen in its own
>    `DesktopPageFrame` (so a hidden tab's header is hidden with it), instead of one `<DesktopTopBar />`. FULL screens
>    (maps) get no frame, as now. `ExploreScreen` list mode, which draws `DesktopTopBar` itself (line ~279), must not
>    end up with two headers: let the frame cover it and remove that call only for desktop.
> 4. `kit.tsx`: in `TopBar`'s web path and `BackButton`'s web path, when `useLayout().desktop`, render
>    `DesktopHeaderPortal` with the same title, subtitle, onBack and right; fall back to today's JSX if it returns
>    `undefined`. A screen with a `BackButton` keeps its own in-page title for now; only the back link moves.
> 5. `lib/layout.ts`: `FEED_MAX` 1680 → 1280. Update the desktop-fit comment.
> 6. Move the tour target `headerTools` with `HeaderTools` (check `components/tour/targets.ts`); run `e2e/tour.spec.ts`.
> Check at 1440 x 900 on localhost (PLAN section 5): Worker setup, Saved, Notifications, Task detail, Wallet (both its
> `TopBar` and its tab view), Settings, Messages, Explore list and map, Home. Each shows its title top-left in the
> header, no in-page back arrow row, tools top-right, no double headers, nothing jumps when switching tabs. Phone test
> from package 0 passes with no update. `npm run check`, `tour.spec.ts`, `map.spec.ts` pass.
> Save after-pictures to `docs/design/desktop-web/after/` and put before/after in the PR. Then security-review, PR, merge.

### Brief: Package 2, shared FormPage pieces

> Repo `C:\complete taskdrop\Taskdrop user`, app in `apps/mobile`. Read `AGENTS.md`, `docs/design/desktop-web/PLAN.md`
> (section 4.2 a), `components/KeyboardScrollView.tsx` (`hugContent`), `components/TwoPane.tsx` (the phone-fallback
> pattern to copy), `components/kit.tsx` (`PrimaryButton`, `Field`), `screens/WorkerSetupScreen.tsx` and
> `screens/OnboardingScreen.tsx` (the two phone layouts FormPage must reproduce). Do not change any screen here.
> New `components/FormPage.tsx`:
> - `FormPage({ children, actions, aside, phoneActions = 'inline', scrollProps })`. Not desktop: return exactly
>   `<KeyboardScrollView {...scrollProps}>{children}{phoneActions === 'inline' ? actions : null}</KeyboardScrollView>`
>   followed by `{phoneActions === 'pinned' ? actions : null}` (wrapped in a Fragment), so a screen's phone tree is
>   unchanged when it swaps its scroll view for FormPage. Desktop: one page `ScrollView`, content row centred
>   (`gap: 24`), a card (max width 720, flex 1, `colors.surface`, 1 px `colors.line`, radius `lg`, padding 28) holding
>   `children` then `actions`; `aside` (width 320) beside it, `position: 'sticky', top: 24` on web.
> - `FormSection({ title, hint, children, first })`: desktop: a block with a top hairline (none when `first`), title
>   `tx('700', 15, colors.ink)` and hint `tx('400', 13, colors.muted)` above the children; with `side` prop, title and
>   hint in a 200 px left column beside the children. Not desktop: render `children` untouched (screens keep their
>   own phone labels by passing them as children on phone; document this in the comment).
> - `FieldRow({ children })`: desktop: children side by side, equal width, gap 16. Not desktop: children untouched.
> - `ActionBar({ hint, children })`: desktop: a row with a top hairline, `hint` text left (13 px muted), buttons right,
>   `position: 'sticky', bottom: 0`, `colors.surface` background, padding 16 0. Not desktop: `children` then `hint`
>   (worker setup's order). Provide `ActionBarContext` so `PrimaryButton` inside it on desktop is natural width
>   (`alignSelf: 'flex-end'`, `minWidth: 160`, `paddingHorizontal: 24`); outside it nothing changes.
> - Light and dark from theme tokens only. Respect reduced motion (no new animation needed).
> Tests: a unit test next to `components/` (same style as existing `*.test.ts(x)`) that with `desktop` false each piece
> returns its children / the same scroll view, and with `desktop` true renders the card. `npm run check` green; phone
> test from package 0 passes untouched (no screen uses it yet). Add a 1440 x 900 picture of a throwaway test page only
> if it helps review; do not commit the test page. Then security-review, PR, merge.
