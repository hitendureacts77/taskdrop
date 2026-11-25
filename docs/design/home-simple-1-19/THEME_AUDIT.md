# Theme audit, task 1.19 row O (25 Nov 2026)

Scope: `apps/mobile/src`, excluding `theme.ts`. ~300 colour literals found; most are intentional (see "Fine as is" at the end). Paths are relative to `apps/mobile/src`. Line numbers are on origin/redesigned-2.0 at b744085.

CLEAR = safe token swap (done in this PR, marked FIXED). NEEDS-DESIGN = changes the look in a way the owner should see (not touched).

## A. Rows fixed in this PR (CLEAR)

| # | file:line | what | why it breaks | fix | status |
|---|---|---|---|---|---|
| 1 | components/PresenceDot.tsx:28 | online dot `#22C55E` | Raw green, ignores theme; the app already has `online` (deep green light, mint dark) | `t.colors.online` | CLEAR, FIXED |
| 2 | components/PresenceDot.tsx:38,71 | "Active now" text `#16A34A` | Raw green, 3.3:1 on dark surface | `t.colors.online` | CLEAR, FIXED |
| 3 | components/PresenceDot.tsx:58 | avatar presence dot `#22C55E` / offline `#9CA3AF` | Raw hex, light-only greys | `online` / `muted` (added `useTheme`) | CLEAR, FIXED |
| 4 | components/MapMarkers.tsx:32,116,142 | `LIVE = '#22C55E'` module constant, face dot + glow | Same raw green on the map, not theme-aware | `t.colors.online` | CLEAR, FIXED |
| 5 | components/LocationPrompt.tsx:68 | white pin icon on `t.colors.accent` disc | In dark, accent is a light jade / light blue (Earn), white on it is about 2:1 | `t.colors.onAccent` | CLEAR, FIXED |
| 6 | screens/ProfileEditScreen.tsx:177 | white initials on `t.colors.accent` avatar | Same: white on light accent in dark mode | `t.colors.onAccent` | CLEAR, FIXED |
| 7 | screens/ExploreScreen.tsx:617 | white search/send icon on `accent` / `purpleDeep` button | Dark mode: white on light mint or light blue | `t.colors.onBtn` (white in light, deep ink in dark) | CLEAR, FIXED |
| 8 | components/HowItWorks.tsx:54 | step-number colour default `'#FFFFFF'` on the `accentDeep` / `purpleDeep` circle | Dark: those shades are light (#57D1AE, #9DB4FF), white on them fails | default `t.colors.onBtn` | CLEAR, FIXED |
| 9 | components/DateTimeSheet.tsx:569 | 12 px warning note in `signal` (#E0724A) | 3.3:1 on light surface; `signalDeep` exists for text | `t.colors.signalDeep` | CLEAR, FIXED |
| 10 | components/LocationSheet.tsx:683 | 12 px note in `signal` | Same | `signalDeep` | CLEAR, FIXED |
| 11 | screens/ActiveScreen.tsx:494 | "Report a problem" text in `signal` | Same | `signalDeep` | CLEAR, FIXED |
| 12 | screens/ListingEditScreen.tsx:169 | "Take this service down" in `signal` | Same | `signalDeep` | CLEAR, FIXED |
| 13 | screens/OrdersScreen.tsx:110 | "Cancel" in `signal` | Same | `signalDeep` | CLEAR, FIXED |
| 14 | screens/DetailSheetScreen.tsx:208 | rating star text in `gold` (#E0A85A) | Gold fill as 20 px text is about 2.1:1 on white; `goldInk` is the text shade | `t.colors.goldInk` | CLEAR, FIXED |
| 15 | screens/TaskManageScreen.tsx:351 | "Steps" flag icon `t.colors.purple` on the poster's manage page | Poster screens must stay jade; this showed Earn blue in Hire mode | `t.colors.accent` | CLEAR, FIXED |
| 16 | components/kit.tsx:751 | Badge tone `purple`, dark fg `'#9DB4FF'` | Raw hex duplicating `purpleDeep` dark | `t.colors.purpleDeep` (identical value) | CLEAR, FIXED |

## B. Rows left (NEEDS-DESIGN or other session's files)

| # | file:line | what | why it breaks | fix | status |
|---|---|---|---|---|---|
| 17 | components/kit.tsx:749 | Badge tone `blue` light fg `'#2A6CB8'` | Raw hex; no `blueDeep` token exists (adding one means a Palette change and contrast-test update) | add `blueDeep` token (light #2A6CB8, dark = blue) | NEEDS-DESIGN (token decision) |
| 18 | screens/PostDetailsScreen.tsx:471 | Flag option 2 uses `t.colors.purple` | In Hire mode a poster sees Earn blue as a flag colour; status colours mixed (coral, blue, grey) | pick a poster-side set (gold / coral / line) | NEEDS-DESIGN |
| 19 | components/PayoutList.tsx:32 | "Waiting to be sent" in `purpleDeep` | A pending status in worker blue, inconsistent with the other statuses (coral failed, muted cancelled); in Hire mode wallet it reads as blue | gold (pending) or `muted` | NEEDS-DESIGN |
| 20 | components/Trending.tsx:117 | "Active today" `purpleDeep`, "Open tasks" `blue` | Stat colours picked for variety, not meaning; Hire Home shows Earn blue | use accent / gold / muted by meaning | NEEDS-DESIGN |
| 21 | screens/HelpScreen.tsx:374 | "TaskDrop support" label `purpleDeep` | Support is neither Earn nor AI; blue in Hire mode | `accentDeep` or `ink` | NEEDS-DESIGN |
| 22 | components/TaskQuestions.tsx:163 | Send button fill `t.colors.purple` | Used on task detail, which posters also open; blue send button in Hire mode | `t.colors.btn` | NEEDS-DESIGN (check who sees it) |
| 23 | screens/TaskDetailScreen.tsx:127 | Tag ink: SERVICES accent, PRODUCTS `purple`, else `blue` | Categorical colour using the Earn blue | decide category colours | NEEDS-DESIGN |
| 24 | components/ListingCard.tsx:56 | REMOTE tag in `aiInk` (violet) | theme.ts says violet is "AI writer and the remote tag", so by design; but owner rule says violet = AI writer only | confirm remote keeps violet or moves to a neutral | NEEDS-DESIGN |
| 25 | screens/BigDayScreen.tsx:401,551 | "online" item kind in `aiInk` | Same as 24 (online = remote); sparkle icons at 255/522 are AI, fine | same decision as 24 | NEEDS-DESIGN |
| 26 | components/BrandArt.tsx:53-54 | Imports `light` directly (`aiSoft`, `aiInk`, `accentDeep`) | Illustration tile is light-palette only: in dark it is a bright light tile and always jade in Earn mode | take colours from `useTheme()` | NEEDS-DESIGN (changes the tile look) |
| 27 | components/BottomTabBar.tsx:49 | web glass bar `rgba(22,25,28,0.92)` / `rgba(255,255,255,0.92)` | Hand-copied surface values; will drift from `surface` | derive from `t.colors.surface` + alpha | NEEDS-DESIGN (alpha helper) |
| 28 | components/ui.tsx:305, kit.tsx:499,936, ExplainerSheet.tsx:44 | `t.isDark ? '#1A0C06' : '#FFFFFF'` text on coral / gold fills | Raw hex; no `onSignal` / `onGold` token | add tokens | NEEDS-DESIGN (token decision) |
| 29 | components/Hero.tsx:18-21 | gradient stops copied as raw hex for hire / earn / hunt | Duplicates `heroFrom/Mid/To` and WORKER_ACCENT; drifts if tokens change | export WORKER_ACCENT and read stops from tokens | NEEDS-DESIGN (refactor, no look change) |
| 30 | screens/ProfileScreen.tsx:266,276, screens/PublicProfileScreen.tsx:244 | presence dot `#4ADE9A`, "Active now" `#86EFAC` on the hero band | Raw mint on the gradient; readable on both bands, deliberately light | optional `t.colors.online` (dark value) | NEEDS-DESIGN (low) |
| 31 | components/DesktopAuthFrame.tsx:43,67 | uses `light.heroMid` | Sign-in panel is always jade, even in Earn; fine before sign-in, wrong if an Earn guest opens it | read from `useTheme()` | NEEDS-DESIGN |
| 32 | screens/SplashScreen.tsx:120-186 | uses `dark.accent` | Splash is intentionally dark jade, before the mode is known | none, OK | OK |
| 33 | app/_layout.tsx:21, AppProviders.tsx:82, ErrorBoundary.tsx:92-125 | `#0F1012`, `#2FBF96` etc. | Rendered outside the theme providers on purpose (loading and crash screens), dark only | none, OK | OK |

### Other session's files (not touched, issues only)

| # | file:line | what | why it breaks | fix | status |
|---|---|---|---|---|---|
| 34 | components/HomeSections.tsx:1481-1484 | quick tiles `ink: '#FFFFFF'` on `accent`, `blue`, `signal`, `purple` | Dark mode: accent / blue / purple are light shades, white text fails; Hire Home also shows Earn blue for "Price check" | `onAccent` / `onBtn`, and mode colours | NEEDS-DESIGN (Home redesign) |
| 35 | components/HomeSections.tsx:272,278 | prompt box `isDark ? 'rgba(10,12,14,0.55)' : '#FFFFFF'`, hint `rgba(213,217,221,0.75)` | Hand-built surface, raw colours | `surface` / `muted` | CLEAR (waiting on the Home session) |
| 36 | components/HomeSections.tsx:1959,1978-1980 | `#FFFFFF` card and `#4ADE9A` dot on the hero art | Raw colours; light-only white card in dark | `surface`, `online` | CLEAR (waiting on the Home session) |
| 37 | components/NearYou.tsx:104 | presence dot `#22C55E` | Same raw green as rows 1-4 | `t.colors.online` | CLEAR (waiting on the Home session) |
| 38 | components/HomeSections.tsx:1007-1026, 1447-1450, 1529, 1946-1948 | white text and ripples on hero | White on the deep hero shades is correct in both themes | none | OK |
| 39 | screens/MyTasksScreen.tsx:343-349 | `rgba(255,255,255,…)` on hero | Correct on the hero | none | OK |
| 40 | components/JobsNearHero.tsx, HelpersNearHero.tsx, screens/HomeScreen.tsx | no raw colour literals found | none | none | OK |

## C. Fine as is (intentional, not listed per line)

- Scrims and shadows: `rgba(0,0,0,0.x)`, `shadowColor: '#000'` (modals, sheets, lifts, map pins). Black scrims work in both themes.
- White text and icons on hero gradients and photos (WalletScreen, BigDayScreen, CrewScreen, Hunt, GetApp, ProfileScreen, PublicProfileScreen, AccessScreen, PhotoViewer, ProofPhotos, TaskMediaThumb). The hero shades are deep in both themes.
- White text on `signalFill` and `purpleFill` (count badges, avatars): these two tokens exist exactly for white text.
- White toggle knobs (SearchScreen, PostDetailsScreen, PromoteScreen) and the white map rim (`RIM`).
- Brand artwork: Google "G" `#4285F4`, MapPicker pin, QR code black/white (must be high contrast to scan), WelcomeStory coin `₹` on gold, `push.ts` Android light colour.
- `MapMarkers` face tones (`TONES`): muted avatar backgrounds under white initials.
- `lib/contrast.ts`, `lib/webScrollbar.ts`, tests: not UI colours.

## D. Earn / Hire mode

- `RoleTheme` wraps the whole app in `app/_layout.tsx` (`usesWorkerColours({ session, guest, mode })`), and Modal/sheet trees inherit the context, so no screen was found rendered outside it. No hard-coded `light.accent` / `dark.accent` use in screens except BrandArt, DesktopAuthFrame, SplashScreen (rows 26, 31, 32).
- Mode leaks found are all uses of the `purple*` tokens (always Earn blue) on screens a poster sees: rows 15 (fixed), 18-23.
- `purple*` on worker-only surfaces (BidSheet, HelperSheet, JobsMap, StreaksScreen, NearMapParts people layer, Earn-side explainers) is correct by design and left alone.
