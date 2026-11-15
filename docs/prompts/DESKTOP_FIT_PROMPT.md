# Prompt: make the desktop website fit a desktop Chrome window

> Written 15 Nov 2026 from what the owner saw in Google Chrome on a 1920×1080 monitor.
> Run it as a **planning** prompt first (output: `docs/design/desktop-fit/PLAN.md`), then build from that plan.

## The problem (seen, not guessed)

Owner's Chrome on `taskdrop.in`, signed in, 1920×1080 screen, **browser zoom 90%**. The page is therefore
**2133 × 950 CSS px** (`innerWidth` 2133, `devicePixelRatio` 0.9). What looks wrong:

1. **Dead space.** The feed is capped at 1360 (`XL_CONTENT`), so about 230 px of empty background shows on each side of
   Home, My Tasks, Wallet. Profile, Settings and other reading screens are capped at 760, a thin strip in the middle of a
   2133-wide page.
2. **Everything is small.** Type and controls are sized for a phone (14 px body, 36 px buttons) and never grow on a
   large monitor. At 90% zoom they are smaller still. The window looks empty AND hard to read at once.
3. **Sections do not fill their row.** On Home the four "Money back" cards stop about three-quarters of the way across
   the 1360 column; the hero image floats right with empty space inside the banner; the "Only on TaskDrop" row is five
   tiny tiles spread across a wide box.
4. **Pages are one narrow column of long rows** (Profile menu, Task page, Settings) where a desktop would use two panes.
5. Corner icons (bell, messages, avatar) sit far from the content they belong to.

## Hard rules (do not break)

- **Desktop web only.** Everything new applies only when `useLayout().desktop` is true (browser width ≥ 1024).
  **Do not change** the phone layout (< 600 wide web, and every Android/iOS native file: `*.native.tsx`, `src/app/**`,
  `navigation/NativeRoot.tsx`, `NavProvider.native.tsx`) or the tablet rail layout (600–1023) unless a shared component
  would otherwise differ, in which case branch inside it on `desktop`. No change to `app.json`, `eas.json`, `android/`.
  No OTA, no EAS build, so the installed APK cannot change.
- **Layout and density only.** No new features, no new copy, no removed features, no new colours. Use tokens from
  `apps/mobile/src/theme.ts` and the layout constants in `apps/mobile/src/lib/layout.ts`. Keep both palettes (poster jade,
  worker blue) and light + dark themes first-class.
- Keep every existing feature (including remote tasks). Keep the brand (`taskdrop.` wordmark, drop+check logo).
- Stack rules in `AGENTS.md` apply: TypeScript strict, `.web.tsx` / `.native.tsx` split, no secrets, `npm run check` green,
  security-review skill on the diff before merge, work on branch `feat/desktop-fit` in worktree `wt-desktop-fit`, PR into
  `redesigned-2.0`, then merge (owner standing rule).
- Respect reduced-motion. Do not add heavy dependencies.

## What to do

### Phase 1: audit (plan input)
Measure the real thing in Chrome (Claude in Chrome tools or Playwright against `npm run web` on :8081 / the staging site).
Windows to test, as **CSS px of the page**: 1024, 1280, 1366, 1440, 1536, 1728, 1920, 2133 (= 1920 @ 90% zoom), 2560, plus
short windows (height 650–720). For each of these screens, signed in as a seed account (fake data only) and as a guest:
Home, Explore (map + list), Post (AI post), My Tasks (Hire and Earn), Task detail, Manage task, Wallet, Inbox/Chat,
Notifications, Profile, Account/Settings, Help, Search, Saved, Orders, Onboarding/sign-in frame.
Record per screen and width: content width used vs available, empty margin each side, smallest body text size, any
horizontal scroll, any overlap, any element stuck to a window corner.
Save before-screenshots under `docs/design/desktop-fit/before/`.

### Phase 2: plan (the deliverable of this prompt)
Write `docs/design/desktop-fit/PLAN.md`, a table of numbered fixes (D1, D2, ...). For each: the screen(s), what is wrong
(with the measured number), the exact fix, files touched, **complexity: complex or routine**, and the check that proves
it. The plan must decide, with reasons, these design questions:

1. **A width system for desktop.** Replace the fixed 760 / 1120 / 1360 caps with something that fills big windows
   sensibly (for example fluid content up to a larger cap such as ~1680 for feeds, ~1040 for reading screens, a gutter
   that scales with width, and full-bleed for maps). State the numbers per breakpoint (1024, 1280, 1440, 1680, 1920+).
2. **A desktop scale.** Body text 15–16 px, larger headings, 40–44 px controls, and card grids that use 3–4 columns at
   large widths, applied through tokens so every screen picks it up, not screen by screen. Say how it is done on
   react-native-web without touching the phone (a `useLayout()`-driven scale, a `desktop`-only token set, or Chrome
   `zoom` on the desktop root, and why).
3. **Two-pane pages.** Task detail (details left, offers/actions right), Profile (identity left, settings right),
   Settings/Account. Pick which, and how each collapses back to one column below 1024.
4. **Home on desktop.** Hero + rails that fill the row; recommended grid.
5. **Top bar.** Where search, bell, messages, avatar live so they are not stranded in a corner.
6. **Short windows.** Make sure nothing needs a taller window than 650 px.

### Phase 3: build, in this order
Foundation first (layout constants + scale + shell), then the screens. Open the PR in small slices
(foundation; Home; feeds; two-pane pages; polish).

### Phase 4: prove it
- **Desktop fixed:** after-screenshots at the widths above in `docs/design/desktop-fit/after/`; no horizontal scroll;
  empty side margin at 1920+ no larger than the gutter; smallest body text ≥ 15 px; dark and light checked.
- **Mobile and APK unchanged:** screenshots of the same 12 screens at 320, 390, 600 and 820 wide before and after must be
  pixel-identical (or the diff explained); `git diff --stat` must list no `*.native.tsx`, `src/app/**`, `app.json`,
  `eas.json` or `android/` file; the existing Playwright `web-phone` project still passes.
- `npm run check` green; existing e2e `web-desktop` project passes.
- Update `docs/ULTIMATE_PLAN.md` (task 1.10/1.14 note) and its changelog; run `node scripts/build-plan-html.mjs`.

## Model split (owner rule)

- **Opus 5.5** for the complex parts: the width system, the desktop scale, the shell/top bar, the two-pane Task page and
  Profile, the Explore map overlays, and the final review.
- **Sonnet 5.5** for routine parts: applying the new tokens/grids to the list screens, the audit screenshots, the
  before/after runs, plan-doc edits, and the mobile-unchanged comparison.
