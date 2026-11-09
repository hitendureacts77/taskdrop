# Map feel, smart panel and Explore list: design and build plan (D21)

Status: **approved 8 Nov (with one addition: a Custom distance, 1 to 100 km), built and merged 9 Nov (PR 297), live on taskdrop.in.** Decisions 36a to 36d took the recommended answers; 36e (cleaning staging test data) was not done. Written 8 Nov 2026 against `redesigned-2.0` at `efc9cab` (after PR 295).
Design canvas: https://claude.ai/artifact/GZWrpbyrk6eYQvbXBNwdoT (a copy of every board is in this folder).
Source: your 3-minute screen recording of 8 Nov (17:53), desktop Chrome on `taskdrop.in`, Earn mode, signed out (guest).

Start words once you have looked: **"approve D21"** (or what to change), then **"build D21"**.

---

## 1. What you asked for (from the video)

| Time | You said | What it means |
|---|---|---|
| 0:00-0:16 | "This is the Google map. Look how it is getting zoomed out ... and zoomed in." | Zoom must feel like Google Maps: smooth, round the pointer, any in-between level |
| 0:16-0:50 | "If I try to zoom in, the entire screen is getting gone ... I can't unzoom. I don't want to use these buttons. I want to just simply zoom like this and minimize like this." | Trackpad pinch and the mouse wheel must zoom the **map**, not the page. The + and − buttons may stay but must not be the only way |
| 0:52-1:08 | "After minimizing everything ... let's go to another country" | Zooming out went dark, then the map drifted to America |
| 1:11-1:20 | "Remove this ... this is a bit confusing" (pointer on the top bar: "7 jobs within 5 km", 5/10/25 km, "Search this area") | The folded top bar is confusing |
| 1:31-2:05 | "This was nice ... plan and optimize this list as well. Why are you displaying this empty one, which is bad." | The List view: fine overall, but the big empty grey box at the top is bad, and the list should be tidier |
| 2:15-2:57 | "Design this card. Why is there this scroll bar here, looks very immature. Not just here, in so many places. It should be even smarter ... this is the main hero ... it is coming in a very small space." | The "Work near you" panel: no scroll bars (anywhere in the app), a smarter card, and the hero (best offer / nearest) needs room |

## 2. What is wrong today, and why (checked in the code)

| # | What you saw | Cause |
|---|---|---|
| F1 | Pinching the trackpad zoomed the whole browser page (0:20, the giant "Hyderabad · 3 jobs") | The web map (`components/JobsMap.tiles.tsx`) only listens for a drag (`PanResponder`) and the two buttons. It has no wheel, pinch or double-click handler, so the browser gets the gesture (a trackpad pinch is a Ctrl+wheel event) |
| F2 | Zooming out with − turned the map dark until it reloaded (0:50) | Zoom jumps a whole level, and the tiles are keyed by zoom (`${zoom}/${x}/${y}`), so every old tile is thrown away before the new ones arrive |
| F3 | The map drifted to America and the Atlantic (1:05) | No bounds: `MIN_ZOOM = 4` and the x tiles wrap round the world |
| F4 | The folded top bar is confusing (1:11) | Three things on one bar ("7 jobs within 5 km" pill, 5/10/25 km, and a separate "Search this area" button that appears after any drag) |
| F5 | The empty grey box on the List view (1:58) | `lib/useMyArea.ts` sets `loaded` only after reading the profile. A guest has no `userId`, so `loaded` stays false and `JobsNearHero` shows its loading shimmer for ever |
| F6 | Three ways to the map on the List view | `JobsNearHero` ("Full map"), the Map pill beside the search box, and the List / Map pills beside "19 jobs" (an in-list map, `JobsMapBlock`) |
| F7 | Scroll bars in the panel and "in so many places" | React Native Web draws the browser's own scroll bar for every `ScrollView` / `FlatList`. 67 places use them; 19 files hide the bar, the rest do not; there is no app-wide scroll-bar style |
| F8 | The hero (best offer / nearest) squeezed; the list shows two rows | The panel stacks title, Show, Within, Filter, a sentence, two tiles, tabs, a list and a 2-line footer in 760 px. The sentence repeats the tiles |
| F9 | The pin says "Financial District · 12 jobs", the Best-paying areas row says "Financial District · 1 task" (2:20) | Pins merge by distance on screen (80 px) and take the top job's area name; the areas list groups by the area's name. Same words, different counts |
| F10 | Test data in the list: a poster called `${7*7}{{7*7...`, "Fake Hyderabad map-test task ... Safe to delete", three copies of "TEST phone check" | Left from the 2.14 security hunt and the map tests on staging. Shown safely as text, but it looks broken. Cleaning it is a data change: **needs your OK** (decision 36e) |

## 3. The design (canvas, 6 boards)

1. **Desktop map** (`Main.dc.html`). Scroll, pinch or double-click to zoom; a one-time tip says so. Small + / − and "my area" at the bottom right, like Google Maps. No top bar and no "Search this area": the jobs refresh by themselves when the map stops, and a quiet pill says "15 jobs in this part of the map". The **panel**: title with the area name, a big **hero card** (best offer ₹2,000 large, the job, Open) with three smart tiles under it (Nearest, Open jobs, Most pay), then one row for Jobs / Helpers and 5 / 10 / 25 km, then Jobs · 15 / Best-paying areas tabs with ₹1,000+ beside them, then the list filling the rest with a soft fade and "8 more below" instead of a scroll bar, and a one-line privacy note.
2. **Zoom motion** (`ZoomStory.dc.html`). Street (every job spread) → city (areas fold into one pin, gliding, 200 ms) → while zooming (the old map shrinks under your fingers, the sharper one fades in; never blank) → country (one pin per city; the map stops at India's edge). Wheel ≈ 250 ms per notch round the pointer, pinch follows the fingers exactly, double-click one level in 300 ms, flicks glide. Reduced motion: no glide.
3. **List view, desktop** (`ListDesktop.dc.html`). No empty box: a short live map strip ("15 jobs within 25 km · best offer ₹2,000 · Open the map"). One List / Map switch at the top right. The search box without its own Map button. Filters and categories in one sliding row with no bar. Cards all the same height: category + at most one tag, the title in two lines, area · distance · poster, price + time left + Apply on one line.
4. **Phone map** (`PhoneMap.dc.html`): pinch to zoom; top pill "Work near you · 15 jobs · 25 km" + List; the sheet resting low shows the hero card.
5. **Phone sheet up** (`PhoneSheet.dc.html`): Best-paying areas as bars, no scroll bar.
6. **Phone list** (`PhoneList.dc.html`): a guest or anyone without an area sees a one-line "Set your area" card, never an empty box.

**Kept, every one:** Jobs / Helpers / My people layers, 5 / 10 / 25 km, ₹1,000+, Best-paying areas, the job card above its pin, the D12 spread, D13 helper services, D14 side panel and phone sheet, D20 map-first Explore and List pill, the in-list filters, categories, Busy now, How it works, voice search, saves, Apply.

## 4. Decisions (defaults taken so building can start; say the word to change)

| # | Question | Default (recommended) | Why |
|---|---|---|---|
| 36a | **Web map engine.** (A) MapLibre GL with OpenFreeMap's free map, (B) keep our own tile map and add wheel, pinch and smoother tiles, or (C) Google Maps on the web too | **A.** MapLibre GL (open source) with OpenFreeMap tiles: no key, no account, no request limit, a dark style, and the same smooth zoom, pinch, inertia and bounds as Google Maps | B needs about 400 lines of our own gesture and tile code and still uses `tile.openstreetmap.org`, whose rules do not allow an app's traffic (decision 35c, open). C looks exactly like Google but needs a browser key and billing (10,000 free map loads a month, then paid) |
| 36b | Drop "Search this area" and refresh by itself? (It was approved in D14) | **Yes.** Refresh 0.6 s after the map stops, only when it moved more than a third of the reach or zoomed out past it; one request at a time; results cached by rounded centre | It is what Google Maps does and removes the confusing bar (F4). Fits the API-call budget: at most one read per stop |
| 36c | The + and − buttons | **Keep, small, bottom right** (desktop only; phones pinch) | People without a wheel or trackpad, and keyboard users, still need a way (accessibility rule: every drag needs a button) |
| 36d | The List view's in-list map (`JobsMapBlock`) | **Remove it; the one List / Map switch opens the full map with the same filters** (₹1,000+, category, search) | One map, one switch (F6). Nothing is lost: the full map shows the same filtered jobs |
| 36e | Clean the staging test data (F10) | **Ask first, then yes:** close the "map-test" and "TEST phone check" tasks and rename the hunt test accounts | It is a data change on staging; the rule says ask before any wipe or reset |

D20 and decision 35 belong to the map-first Explore work (PR 291); this design is D21 and its decisions are 36a to 36e.

## 5. Work packages (one writer per file)

Model split (your rule of 4 Nov): Opus 5.5 for WP1 (the engine and gestures), Sonnet 5.5 for the rest and for checks.

| Wave | WP | What | Owns (only writer) |
|---|---|---|---|
| 1 | WP1 Web map engine | Add `maplibre-gl` (exact version pinned, at least two weeks old). New `components/GlMap.web.tsx`: one MapLibre map, OpenFreeMap style per theme (light: Positron, dark: Dark, our colours on top), `maxBounds` round India (lat 5 to 38, lng 66 to 99), zoom 4 to 18, rotate and tilt off, scroll / pinch / double-click / keyboard zoom on, inertia on, attribution "© OpenStreetMap, OpenFreeMap". Loaded with `import()` only when a map opens, so other pages stay light. New `components/JobsMap.web.tsx` keeps the **same props** as `JobsMap.tiles.tsx` (`me`, `pins`, `fit`, `ringKm`, `focusId`, `onMoveEnd`, `callout` ...) and draws the same React Native pin views in an overlay placed with `map.project()`, re-laid out once per animation frame while moving; `groupPins` / `layoutPins` run with the fractional zoom; merges and splits cross-fade in 200 ms. If WebGL is missing, it falls back to `JobsMap.tiles.tsx`. `JobsMap.tsx` (web re-export) points to the new file. The native app (Google Maps) and the Expo Go fallback (tiles) do not change | `package.json`, `apps/mobile/package.json`, lockfile, `components/GlMap.web.tsx` (new), `components/JobsMap.web.tsx` (new), `components/JobsMap.tsx`, `lib/mapLayout.ts` (fractional zoom only) + test |
| 1 | WP4 No scroll bars | One web style: overlay panels, sheets and chip rows hide the bar (`scrollbar-width: none`, `::-webkit-scrollbar { display: none }`), page scroll keeps a thin bar that shows on hover. A small `NoBarScroll` helper (`showsVerticalScrollIndicator={false}` + the class on web) used in the panel, sheets and every chip row; a fade at the bottom where more is hidden. Audit the 67 `ScrollView` / `FlatList` places and list each one in the PR | `App.tsx` (web style tag) or the web HTML template, `components/NoBarScroll.tsx` (new), the chip-row files the audit names (not NearMap*, not ExploreScreen) |
| 1 | WP5a Guest area fix | `useMyArea`: when there is no `userId`, read and save the guest's area on the device (the same place guest mode keeps its other choices, `lib/guest.ts`) and set `loaded` at once. Also fixes the 8 Nov phone note ("after confirming the area as a guest, the list still said Set your area") | `lib/useMyArea.ts` + test |
| 2 | WP2 Area picker | `MapPicker` on the web uses `GlMap` too (same feel when you choose your area) | `components/MapPicker.web.tsx` (new), `components/MapPicker.tsx` |
| 2 | WP3 Smart panel | The D21 panel and phone sheet: hero card + three tiles, one controls row, tabs with ₹1,000+, the list filling the space with a fade and "N more below", one-line footer; the top bar and "Search this area" removed; refresh by itself (decision 36b) through a pure `lib/mapRefresh.ts` (when to fetch) with tests; pin label fixed (F9): a merged pin says "12 jobs · Financial District and nearby" and Best-paying areas counts the same way | `components/NearMap.tsx`, `components/NearMapParts.tsx`, `components/MapSheet.tsx`, `lib/mapRefresh.ts` (new) + test, `lib/mapReach.ts` |
| 2 | WP5b Explore list | `JobsNearHero` becomes the short map strip (with an area) or the one-line "Set your area" card (without); one List / Map switch at the top; the Map pill beside the search and the in-list map removed (decision 36d), the full map opens with the list's filters; cards the same height (title 2 lines, at most one tag, price + time + Apply on one row) | `components/JobsNearHero.tsx`, `screens/ExploreScreen.tsx`, the job card component it uses |
| 3 | WP6 Tests and checks | Unit: `mapRefresh`, fractional-zoom layout, `useMyArea` guest. e2e (`e2e/map.spec.ts`): a wheel and a Ctrl+wheel over the map change the map's zoom and **not** the page's; double-click zooms; panning stops at India; while zooming the map canvas is never empty; the panel has no visible scroll bar; a guest's List view has no empty box. `npm run check`, the e2e suite, then the browser check at 390, 820, 1440 and 1920 wide, light and dark | `e2e/map.spec.ts`, `e2e/ui.spec.ts` |
| 3 | WP7 Docs | This plan's status, ULTIMATE_PLAN task 1.12 ticks, changelog | docs only |

## 6. Order of work and what you do

1. LOOK at the [canvas](https://claude.ai/artifact/GZWrpbyrk6eYQvbXBNwdoT): the desktop map, the zoom motion row, the list, the three phone screens.
2. TELL Claude "approve D21" (or what to change), and any decision 36a to 36e you want different.
3. Claude builds waves 1 to 3 in one pull request into `redesigned-2.0` (merging puts it on `taskdrop.in` by itself), checks it in Chrome at the four sizes, and sends you screenshots.
4. TRY it on your laptop: pinch, scroll, double-click, zoom right out, open the List view signed out.
5. The panel and list changes also reach the Android app, which needs an app update (OTA). Claude asks you before publishing it.

**Time:** about 2 working days of building (WP1 is most of it), plus your look.

## 7. Risks

| Risk | What protects you |
|---|---|
| MapLibre adds about 220 KB (zipped) to the web app | Loaded only when a map opens; the Home page does not pay for it |
| A computer without WebGL | Falls back to today's tile map |
| OpenFreeMap is a free service with no promise of uptime | The same code works with a paid MapLibre host (MapTiler, Stadia) by changing one style address; this is decision 35c for production |
| The dark style is marked "not yet complete" by OpenFreeMap | Our own colour overrides on top of it; light style as a fallback |
| Auto-refresh sends more reads | Only after the map stops, only after a real move, one at a time, cached; counted in the e2e run |
| Pins drawn as React views over a WebGL map can lag with many pins | At most 60 jobs (today's cap); layout once per frame; clusters merge at country zoom |
