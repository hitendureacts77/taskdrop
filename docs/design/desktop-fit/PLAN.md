# Desktop fit: plan (D1 to D21)

> Planned 15 Nov 2026 from `docs/prompts/DESKTOP_FIT_PROMPT.md` (Phases 1 and 2). Branch `feat/desktop-fit`, worktree
> `wt-desktop-fit`. Nothing is built yet. Builds on task 1.10 (L1 to L5, 3 Nov), which it does not redo: L1 full-bleed
> map, L2 card grids, L3 reading width, L4 the 1360 XL feed and L5 buttons under the form all stay; D2 replaces the L3/L4
> caps with a fluid system.
> Before-pictures: `before/` (16 files). Desktop only (`useLayout().desktop`, web ≥ 1024). Phone, tablet rail, Android
> and iOS do not change.

## 1. Audit: what was measured

**How.** Claude in Chrome on `taskdrop.in` (staging, fake data, seed account "Tasker 3313", read-only). The Chrome window
was 1920 × 855 and could not be resized, so other widths were measured by overriding `visualViewport.width` and setting
`#root` to that width. That is what react-native-web's `Dimensions` reads (`node_modules/react-native-web/dist/exports/Dimensions`),
so the app lays out exactly as at that window width. The owner's view (2133 CSS px at 90%) was rebuilt the same way, with
`html { zoom: 0.9 }`, and checked against his description. Text sizes come from computed `font-size` weighted by
character count; the column is the widest visible element with a px `max-width`. A script, not the eye, did all the measuring.

**Margins: what the code gives and what was measured (they match exactly).** Empty space on each side of the column, in CSS px:

| Window | Feed screens (Home, My Tasks, Wallet, Inbox) | Reading screens (Profile, Settings, Notifications, Help, AI Post) |
|---|---|---|
| 1024 | 0 (column 760 = all of it) | 0 |
| 1280 | 0 (1016 of 1120 cap) | 128 |
| 1440 | 28 | 208 |
| 1536 | 76 | 256 |
| 1728 | 52 (cap jumps to 1360 at 1600) | 352 |
| 1920 | 148 | 448 |
| **2133 (owner)** | **255** | **555** |
| 2560 | 468 | 768 |

No screen has a horizontal scrollbar at any width (`#root.scrollWidth ≤ width` everywhere).

**Text and controls (the same at every width, because nothing scales).** The most-used sizes: Home 12 px 35%, 13 px 33%;
My Tasks 12.5 px 54%; Wallet 12 px 37%, 13 px 35%; Settings 12 px 52%; Notifications 13 px 51%. The smallest is 9 px (tags).
The median control is 40 px and the smallest 32 px (chips). At the owner's 90% zoom, 12 px renders as 10.8 device px.

**Per screen (1920 unless marked).**

| Screen | Seen / measured | Picture |
|---|---|---|
| Home | "Money back" rail: 4 cards fill 4 of the 5 grid columns (`Rail min 220` → `floor((1316+12)/232)=5`), so the row stops at ~80%. Hero: composer is 58% of the banner, `HeroArt` (220×220) floats in the rest. "Only on TaskDrop": 5 tiles of 54 px icons + 2-line 11 px labels spread across 1316 px | `before/1920-home.jpg`, `before/2133-owner90-home.jpg` |
| Explore | Full map (L1, good). Panel 400 px. No bell/messages/avatar on this screen. With zoom 1.2 the map canvas draws 1336 px stretched to 1603, so it is **blurry** (see D8) | `before/1920-explore.jpg`, `before/zoomtest-…-explore-map-blurry.jpg` |
| My Tasks | 3 columns in 1360; fine apart from the margins and small type | `before/1920-my-tasks.jpg`, `before/2133-owner90-my-tasks.jpg` |
| Manage task | Already two panes (Overview / Worker offers) from raw `width >= 1280` (`TaskManageScreen.tsx:285`) | `before/1920-task-manage.jpg` |
| Task detail (worker view) | One 760 column (`TaskDetailScreen`, not in `WIDE`); the offer button is far below the facts. Read from the code; the seed account had no other person's task one click away | — |
| Wallet | Two columns, left fixed `width: 420`; with an empty ledger the right side is blank | `before/2133-owner90-wallet.jpg` |
| Messages | Split view `360 + flex` already fills the column | — |
| Notifications | 760 column, 555 px empty each side at 2133 | `before/2133-owner90-notifications.jpg` |
| Profile | 760 column of long rows; the bell cluster moves to x=1306 (the column's edge) here but sits at x=1606 on Home | `before/1920-profile.jpg`, `before/2133-owner90-profile.jpg` |
| Settings | 760 column, three tabs on top, short forms | `before/1920-settings.jpg` |
| Help | 760 column, 13 px 36%, 11 px 24% | — |
| AI Post | 760 form; fine as a form | `before/1920-ai-post.jpg` |
| Sheets | `kit.tsx` dialog 560 wide (`maxHeight 88%`); scales correctly under `zoom` (verified) | `before/1920-home-just-posted-sheet.jpg`, `before/zoomtest-…-sheet.jpg` |
| Sign-in frame | `DesktopAuthFrame`: 50/50 brand + form card 440. From the code only: localhost:8081 was still bundling and the owner's session could not be signed out | — |
| Top bar | `AppHeader` (bell, messages, avatar) is drawn only by Home, My Tasks, Wallet and Profile, right-aligned to whichever column is used (x=1606 or x=1306 at 1920); Explore, Settings, Notifications, Help and Messages have none | all |

**Not reached:** Search, Saved, Orders and guest mode (these use the same column classes as the measured screens, so the
margin numbers above apply); real window heights other than 855; the 1366 and 1680 widths (computed in §3). Chrome stopped
sending frames for screenshots partway through (requestAnimationFrame fell to 1–2/s on every screen, including Home, so the
browser window was not being painted; this was not the app). That is why Help, Messages and Settings have no picture at 2133.

**Zoom spike (done during the audit, decides Q2).** `document.documentElement.style.zoom = 1.2` at 1920:
`#root.offsetWidth` = 1600 (react-native-web's `onLayout` uses `offsetWidth`, so it sees design px), no horizontal scroll,
`scrollHeight` = `innerHeight`, sheets scale with the page, and the only breakage is the blurry map canvas.

## 2. The six design decisions

### Q1. Width system: four column classes, a scaling gutter and a larger cap
`lib/layout.ts` replaces `WIDE_CONTENT` / `XL_CONTENT` / `XL_MIN_WIDTH` / `NARROW_CONTENT` (desktop only; the tablet
`TABLET_CONTENT` 720 stays) with:

```
FEED_MAX 1680   READ_MAX 960   FORM_MAX 760   GUTTER_MIN 24   GUTTER_MAX 40   CARD_MIN 290
gutter  = clamp(24, round(0.025 * main), 40)      main = designWidth - SIDEBAR_WIDTH (264)
FULL : the whole area right of the menu (nearMap, explore)
FEED : min(main - 2*gutter, FEED_MAX)             home, explore list, myTasks, orders, saved, wallet, spending,
                                                   inbox, taskManage, taskDetail, profile, account, publicProfile, help
READ : min(main - 2*gutter, READ_MAX)             notifications, search, chat, legal pages, ideas, ideaDetail
FORM : min(main - 2*gutter, FORM_MAX)             aiPost, create, postDetails, withdraw, promote, review,
                                                   workerSetup, profileEdit, listingEdit, confirm, escrow
```

Why: a fixed cap is what leaves 255 / 555 px of dead space at 2133. With a fluid feed and the scale from Q2, the margin
at every width is just the gutter. Two-pane pages (Q3) move to FEED because two panes use the width. READ and FORM keep a
cap **on purpose** (line length, focus on one form). They are the only places allowed wider margins at 1920+, and the
proof check names them. Every screen not listed keeps its current class: FEED if it is in today's `WIDE`, FORM otherwise.

### Q2. Desktop scale: CSS `zoom` on `<html>`, from one curve in `layout.ts`
```
scale = clamp(1, 1 + (W - 1024) / 3200, 1.35), then min(scale, H / 650), round to 0.01; 1 if !desktop or zoom unsupported
designWidth = W / scale        (everything in the app, onLayout included, works in design px)
```
`lib/desktopScale.web.ts` sets `document.documentElement.style.zoom` (and clears it below 1024);
`lib/desktopScale.ts` (native) is a no-op. `useLayout()` returns `scale` and, on desktop, `width = W / scale`,
`height = H / scale`, plus `gutter` and `contentWidth(cls)`.

Why zoom: the app has **1,539 literal `tx(weight, size, …)` calls** and the `typography` tokens are used **0 times**, and
control heights, paddings and icon sizes are literals too. A token or `useLayout()` font scale would mean touching every
screen, and it would scale text but not the 36–44 px boxes around it. `transform: scale` does not reflow and breaks scrolling.
`zoom` reflows, scales text, controls, spacing and icons together, sheets included (verified), works in Chrome, Edge,
Safari and Firefox ≥ 126 (guarded by `CSS.supports('zoom','1.1')`), and lives in one `.web.ts` file that native never loads.
The `H / 650` cap is the short-window rule (Q6): the design height never drops under 650.

| Window W | scale | design W | main | gutter | FEED width | cols (CARD_MIN 290) | body 13 px renders at |
|---|---|---|---|---|---|---|---|
| 1024 | 1.00 | 1024 | 760 | 24 | 712 | 2 | 13.0 |
| 1280 | 1.08 | 1185 | 921 | 24 | 873 | 2 | 14.0 |
| 1366 | 1.11 | 1231 | 967 | 24 | 919 | 3 | 14.4 |
| 1440 | 1.13 | 1274 | 1010 | 25 | 960 | 3 | 14.7 |
| 1536 | 1.16 | 1324 | 1060 | 27 | 1006 | 3 | 15.1 |
| 1680 | 1.21 | 1388 | 1124 | 28 | 1068 | 3 | 15.7 |
| 1920 | 1.28 | 1500 | 1236 | 31 | 1174 | 3 | 16.6 |
| **2133** | **1.35** | 1580 | 1316 | 33 | 1250 | **4** | 17.6 (15.8 device px at 90%) |
| 2560 | 1.35 | 1896 | 1632 | 40 | 1552 | 4 | 17.6 |

At 2133 the side margin becomes 33 × 1.35 = **45 real px** (from 255), and a 40 px button is 54 px.
`columns` becomes `clamp(1, floor((contentWidth + 16) / (CARD_MIN + 16)), 4)` from the real column width, not from the window.

### Q3. Two-pane pages: Task detail, Profile, Settings. Collapse rule: `twoPane = desktop && contentWidth >= 940`
That is true from about 1440 wide (FEED 960); at 1366 it is 919, so one column. Below it, and on every tablet and phone, the screen renders exactly as today (same JSX
path, one column). Shared `components/TwoPane.tsx`: `left` (fixed width), `right` (flex, `maxWidth`), gap = gutter, each
pane with its own `ScrollView`. The right pane is `position: sticky` (top: gutter) on web.
- **Task detail** (worker view): left = header, media, description, details card (flex, max 760); right 360 = price,
  the offer/bid button that opens `BidSheet`, poster card (`PersonSheet` trigger), report/share. The fixed bottom bar
  is not rendered on desktop.
- **Manage task**: already two panes; switch its test from raw `width >= 1280` to `twoPane`.
- **Profile**: left 380 = identity hero, mode switch, "Finish your profile", "My regulars"; right (max 720) = the
  `rows` menu (`MenuRow`s) and the sections below them.
- **Settings/Account**: left 240 = the same three tabs (`TABS`) as a vertical list (`UnderlineTabs` gets a
  `vertical` prop used only on desktop); right (max 720) = the active tab's form.
- Not two-pane: Notifications and Search (READ, one list), Help (FEED, its cards in a 2-column `Grid`), AI Post (FORM).

### Q4. Home on desktop
- Hero (`HomeSections.tsx`, `wideHero`): a 7/5 row, with the composer column at flex 7 (max 720) and `HeroArt` centred in
  flex 5, art 220 → 260 when `contentWidth >= 1100`. No empty band inside the banner.
- "Only on TaskDrop" (`OnlyOnTaskDrop`): on desktop each of the 5 items is a card (`cardSurface`), icon 44 left of a
  one-line title, 5 equal columns. Same items, same copy.
- Rails (`Rail.tsx`): desktop/tablet grid uses `cols = min(cols, childCount)`, so 4 "Money back" cards fill the row;
  `min` 220 → 240 for the Home rails.
- "Manage my tasks" (`ManageTile`, `flexBasis: '30%'`): on desktop `flexBasis` from `columns` (3 or 4 per row).
- Recommended/published grid: unchanged components; they pick up 3–4 columns from the new `columns`.

### Q5. Top bar: one shell bar on every desktop screen, aligned to the column
`navigation/DesktopTopBar.tsx`, rendered by `ScreenHost` above the column on every desktop non-FULL screen. It is 56 tall,
uses the same width and gutter as the screen's column, and holds the bell, messages and avatar cluster at the column's right edge (no longer at
x=1606 on one screen and x=1306 on the next). It reuses `AppHeader`'s internals: extract `HeaderTools` (bell + count,
messages, avatar + `AccountDrawer`, `GuestSignInPill` for guests). `AppHeader` returns `null` on desktop. On FULL map
screens the cluster floats top-right inside the map area, 16 from the edge (as Explore's panel floats left).
The tour target `headerTools` moves with it. Search stays where it is today (screen-level bars); no new search box.

### Q6. Short windows (650 to 720 tall)
The `min(scale, H/650)` cap keeps design height ≥ 650 (1920 × 700 → scale 1.08, not 1.28). Then:
`SideNav` hides `SideNavAppCard` when design height < 720 and its menu scrolls (the `ScrollView` already exists);
`kit.tsx` dialogs keep `maxHeight 88%` with inner scroll; the Home hero gets `minHeight` not fixed height; two-pane
right column `maxHeight: 100%` with its own scroll so the offer button is always reachable.

## 3. The fixes

`C` = complex (Opus 5.5), `R` = routine (Sonnet 5.5). All paths are under `apps/mobile/src/`.

| # | Screen(s) | Problem (measured) | Exact fix | Files | C/R | Proof |
|---|---|---|---|---|---|---|
| D1 | All desktop | Text 12–13 px and controls 40 px at every width; 10.8 device px for the owner | Scale curve from Q2; `zoom` on `<html>` when desktop; `useLayout()` returns `scale` and design `width`/`height`; re-applied on resize | `lib/layout.ts`, new `lib/desktopScale.web.ts` + `lib/desktopScale.ts`, `App.tsx` (call the hook once at the web root) | C | At 2133: `getComputedStyle(html).zoom` = 1.35, `#root.offsetWidth` = 1580; most-used body ≥ 15 CSS px at ≥ 1536; at 1023 zoom = '' |
| D2 | All desktop | Margins 255 (feed) / 555 (reading) at 2133, 468 / 768 at 2560 | Column classes FULL/FEED/READ/FORM + gutter from Q1; `ScreenHost` maps screen → class and sets `maxWidth = contentWidth(cls)`, `paddingHorizontal = gutter` | `lib/layout.ts`, `navigation/ScreenHost.tsx` | C | FEED margin = gutter ±1 at 1280–2560 (script in §5); READ/FORM centred |
| D3 | Feeds | `columns` max 3, worked out from the window | `columns` 1–4 from `contentWidth` and `CARD_MIN 290`; `Layout['columns']` becomes `1\|2\|3\|4` | `lib/layout.ts`, `components/ui.tsx`, `components/kit.tsx` (`Grid`) | R | 4 cards per row in My Tasks at 2133, 3 at 1920, 2 at 1280 |
| D4 | Home rails | "Money back" 4 cards fill 80% of the row | `Rail` grid: `cols = min(cols, React.Children.count(children))`; Home rails `min={240}` | `components/Rail.tsx`, `components/HomeSections.tsx` | R | Last card's right edge = column's right edge ±1 |
| D5 | All desktop | Bell/messages/avatar only on 4 screens, at different x | `DesktopTopBar` + `HeaderTools` from Q5; `AppHeader` returns null on desktop | new `navigation/DesktopTopBar.tsx`, `components/AppHeader.tsx`, `navigation/ScreenHost.tsx` | C | Cluster right edge = column right edge on Home, Profile, Settings, Notifications, Help; badge counts match |
| D6 | Explore, Manage task | Raw window widths in desktop branches (`width >= 1280`, `XL_MIN_WIDTH`) | Use `twoPane` / `contentWidth('feed')` | `screens/TaskManageScreen.tsx:285`, `screens/ExploreScreen.tsx:133` | R | `grep -rn "XL_MIN_WIDTH\|WIDE_CONTENT\|XL_CONTENT" src` empty outside layout.ts |
| D7 | Tour, welcome story | `useWindowDimensions` + `measureInWindow` give real px; under zoom the overlay sits inside design px | Divide measured rects and window size by `scale` in one helper | `components/tour/targets.ts`, `TourHost.tsx`, `TourPractice.tsx`, `components/WelcomeStory.tsx` | C | `e2e/tour.spec.ts` passes at 1280 and 1920; spotlight hugs the bell at 2133 |
| D8 | Explore, Work/Helpers near you | Map canvas 1336 backing px drawn at 1603 (blurry) under zoom | MapLibre `pixelRatio: devicePixelRatio * scale`, `map.setPixelRatio` on scale change; check pointer maths (`maplibre-gl` 6.15) | `components/GlMap.web.tsx` | C | `canvas.width == round(rect.width * dpr)`; clicking a pin opens that pin's card; drag pans 1:1; `e2e/map*.spec.ts` pass |
| D9 | Home | Art floats right of a 58% composer | 7/5 hero row (Q4) | `components/HomeSections.tsx` (`wideHero`, `HeroArt`) | R | Composer + art span ≥ 95% of banner width at 1440/1920/2133 |
| D10 | Home | 5 tiny tiles across 1316 px | `OnlyOnTaskDrop` desktop card row (Q4) | `components/HomeSections.tsx` | R | 5 equal cards, row filled, labels one line at ≥ 1280 |
| D11 | Home | Manage tiles at `flexBasis 30%` | `flexBasis` from `columns` on desktop | `components/HomeSections.tsx` (`ManageTile`) | R | Rows complete at 1440 and 2133 |
| D12 | Wallet | Left column fixed 420 | `width: clamp(380, 0.36*contentWidth, 480)` | `screens/WalletScreen.tsx:718` | R | Summary + ledger fill column at 1440/2133 |
| D13 | My Work, Saved, Orders, My services, Inbox | Fine apart from width and scale | Nothing extra (D1–D3); check only | — | R | 3/4 columns as per table; Inbox split still `360 + flex` |
| D14 | Task detail | One 760 column; offer button below the fold | `TwoPane` (Q3); screen moves to FEED; bottom bar hidden on desktop | new `components/TwoPane.tsx`, `screens/TaskDetailScreen.tsx`, `navigation/ScreenHost.tsx` | C | At 1440+: offer button visible without scrolling at 1440 × 650; one column at 1023 (pixel-same as before) |
| D15 | Profile | 760 strip of long rows, 555 empty each side at 2133 | `TwoPane` 380 / max 720 (Q3) | `screens/ProfileScreen.tsx` | C | Both panes in view at 1440/2133; guest rows unchanged |
| D16 | Settings/Account | 760 column, tabs on top | Vertical tabs left 240, form right max 720 | `screens/AccountScreen.tsx`, `components/kit.tsx` (`UnderlineTabs` `vertical`) | R | Tab switching works by click and keyboard; one column below 1024 |
| D17 | Help | 760 column of cards | FEED class, cards in `Grid` 2 columns | `screens/HelpScreen.tsx`, `ScreenHost.tsx` | R | 2 columns at ≥ 1280 |
| D18 | Notifications, Search, Chat, legal | 760 → fits READ 960 | Class READ (D2); nothing else | `ScreenHost.tsx` | R | Centred, max 960 design px |
| D19 | All, short windows | SideNav + app card need about 700 px | Q6 rules | `components/SideNav.tsx`, `components/HomeSections.tsx`, `components/TwoPane.tsx` | R | At 1366 × 650 and 1920 × 700: no clipped control, every primary button reachable |
| D20 | Sign-in frame | 54 px headline × scale may overflow the brand half at short heights | Brand half scrolls; `DesktopAuthFrame` checks design height | `components/DesktopAuthFrame.tsx` | R | Sign-in at 1280 × 650 and 2133 × 950 fits with no scroll in the form card |
| D21 | Docs | — | `docs/ULTIMATE_PLAN.md` 1.10/1.14 note + changelog; `node scripts/build-plan-html.mjs` | docs | R | Plan HTML rebuilt |

## 4. Build order (small PRs into `redesigned-2.0`)

1. **Foundation** (Opus): D1, D2, D3, D6, D5. Then run the mobile-unchanged proof (§5) here first, because this slice touches the
   shared `layout.ts` and `ScreenHost.tsx`.
2. **Zoom fallout** (Opus): D7 tour, D8 map. Kept separate because the map and tour e2e specs are the risk.
3. **Home** (Sonnet): D4, D9, D10, D11.
4. **Feeds** (Sonnet): D12, D13, D17, D18.
5. **Two-pane** (Opus builds `TwoPane` + D14 + D15; Sonnet does D16 on the same component).
6. **Polish** (Sonnet, Opus final review): D19, D20, after-pictures, D21.

Each slice: `npm run check` green, `security-review` on the diff, PR, merge (owner standing rule). No OTA, no EAS build.

## 5. Proofs

**Desktop fixed** (`e2e/desktopFit.spec.ts`, new, project `web-desktop-fit`, viewports 1024×720, 1280×800, 1366×650,
1440×900, 1536×864, 1728×1000, 1920×1080, 1920×700, 2133×950, 2560×1440, served by `e2e/serve-dist.mjs`). For the 12 screens:
- `document.documentElement.scrollWidth <= innerWidth` (no sideways scroll).
- FEED screens: `(colRect.left - sideNavRect.right)` and `(innerWidth - colRect.right)` ≤ `gutter * scale + 1`.
- The most-used text size (weighted by character count) ≥ 15 CSS px at W ≥ 1536, and ≥ 14.5 at 1440.
- No element with `getBoundingClientRect().bottom > innerHeight` that is a primary button on a FORM or two-pane screen.
- Light and dark, Hire (jade) and Earn (blue): after-pictures in `after/` at 1280, 1440, 1920, 2133.

**Mobile and APK unchanged.**
1. On `redesigned-2.0` *before* slice 1: `npx playwright test e2e/mobileSame.spec.ts --update-snapshots`. The spec covers
   the 12 screens at 320×640, 390×844, 600×960 and 820×1180, `animations: 'disabled'`, the ticker paused, seed data from
   `auth.setup.ts`, and `expect(page).toHaveScreenshot()`.
2. On each slice: run the same spec with no update. Every snapshot must match (`maxDiffPixels: 0`); any diff is
   explained in the PR or fixed.
3. `git diff --name-only origin/redesigned-2.0...HEAD | grep -E '\.native\.tsx$|^apps/mobile/src/app/|^apps/mobile/(app\.json|eas\.json)$|^apps/mobile/android/'`
   prints nothing.
4. `npx playwright test --project=web-phone` and `--project=web-desktop` pass.
5. Native safety by construction: `desktopScale.ts` (native) is a no-op; every new branch is behind `desktop`, which is
   `false` on Android/iOS (`Platform.OS === 'web'` check in `useLayout`).

## 6. Risks to watch

- **Map pointer under zoom** (D8): if MapLibre's mouse maths is off, fall back to `zoom: 1/scale` on the map container
  and scale only its overlays. Decide in slice 2 with the e2e map specs.
- **Raw `getBoundingClientRect` users** (`KeyboardScrollView`, `useKeyboardClearance`): they only act with an on-screen
  keyboard, so they are inert on desktop. Recheck in slice 2.
- **Owner's own 90% Chrome zoom** multiplies on top of this. The curve is tuned so that 2133 at 90% reads like a 1920
  window at about 120%. If it reads too big, lower the 1.35 cap (one constant).
