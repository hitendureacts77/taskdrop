# 1.19 F, G, I: build plan (after your OK on the design)

Design: `index.html` in this folder (light and dark, phone frames, one desktop frame). Feature map: `FEATURES.md` (74 features, 0 removed).

**Rules for every PR:** look and motion only, no database, server or money change. Every feature stays reachable (FEATURES.md is the checklist). Hire stays jade and Earn stays royal blue, guests too. Light and dark are both checked, plus reduce-motion. `npm run check` is green. The e2e specs below run on a free port (not 8099 or 8123). The phone check comes after the OTA, and only once you say yes to it.

## Build order (small PRs, each mergeable alone)

| # | PR | Files (main ones) | e2e to update | Who |
|---|---|---|---|---|
| 1 | **New task cards** (row G): the status pill, the title with Nearby or Remote, a person row with face and active-now dot, the money block (held safely / not paid yet), a thin 5-step track, the date line, one main button (filled only when the step is yours) | `components/myTasks/PosterCard.tsx`, `WorkerCard.tsx`, `bits.tsx`, `DeskTable.tsx` rows | `topup.spec.ts` (keep the "Task options" and "Top up" labels), `planB.spec.ts` (the card title stays tappable; "Review the offer" and "Choose offer" are on the task page, not changed), `desktopWeb` snapshots re-baselined | Sonnet, Opus review |
| 2 | **Shared tab header** (2c): a `TabTitle` part (name, one live line, one action) on My tasks, My work, Wallet, Profile, and the Explore / Find work list. The same row 1 on every tab | new `components/TabTitle.tsx`, `AppHeader.tsx`, the four screens, `ExploreScreen.tsx` headers | `desktopWeb` + `sizes` snapshots | Sonnet |
| 3 | **My tasks / My work top**: the "at a glance" card and the 4 stat tiles become the live line; search behind the magnifier (same placeholder "Search tasks, category…"); Drafts as one row; sticky tab pills | `MyTasksScreen.tsx` | `topup.spec.ts` helper `openMyTasks` taps the magnifier before filling the search | Sonnet |
| 4 | **Hire Home** (F): area row with the live pill; the live sheet (Just posted + Busy on TaskDrop); trust line in the hero opening the `SafeOnTaskDrop` text as a sheet; Needs you now on Home (reuses `NeedsNow`); one Ideas block with chips (merges `HomeTemplates`, `PosterIdeas`, `MANAGE`); the feedback card moves to Profile's Ideas & feedback row | `HomeSections.tsx` (PostTop), `SafeOnTaskDrop.tsx`, `HomeFeedbackCard.tsx`, `ProfileScreen.tsx` | `testID="home-hire-map"` kept; `desktopWeb` home snapshots; any spec reading "Busy on TaskDrop" or "Quick templates" from Home (none found on 25 Nov) | Opus (layout), Sonnet (chips) |
| 5 | **Earn Home** (F): hero with the search inside; Needs you now; one "Jobs for you" list with chips For you / Near you (radius inside) / Remote / Today; trust line; Ways to earn rail | `HomeSections.tsx` (EarnTop) | `testID="home-jobs-map"` kept; `desktopWeb` home-earn snapshots; `map.spec.ts` untouched (its "Remote work" / "Work near you" are on the map) | Opus |
| 6 | **Explore header and live counts** on the map; the web bottom tab says "Find work" in Earn mode (today it says Explore on the web; the phone already says Find work) | `ExploreScreen.tsx`, `BottomTabBar.tsx` | `map.spec.ts`, `mapPeek.spec.ts` (header height), snapshots | Sonnet |
| 7 | **Desktop Home rail**: live card, Just posted, Busy on TaskDrop, helpers map; Needs you now as a short table | `HomeSections.tsx` (DesktopColumns), `PublishedTable` | `desktopWeb`, `desktopRules.spec.ts` | Sonnet |
| 8 | **Motion and the check** (row I): live-dot ring, ticker speed, "1 new" pop, chip cross-fade, all off with reduce-motion; dark-mode pass; then the 5-person check ("find X" tasks for a new customer and a new worker) | `motion` tokens, the parts above | none new | Opus plan, you run the 5-person check |

PRs 1 to 3 do not touch Home, so they can start while you think about the Home questions. PR 4 and PR 5 wait on answers 1, 3, 4 and 5 below.

## Open questions for you (max 5)

1. **Ideas:** the four idea sections become one "Ideas to post" block with chips (4 cards showing, the rest one tap away, all of them in Explore's list). OK, or keep Quick templates as its own row?
2. **Your face in the header:** keep opening the account drawer, or open the Profile tab on phones (every drawer row is also on Profile or Wallet)? The desktop keeps the drawer either way.
3. **Safety text:** "Why hiring through TaskDrop is safer" and "Your pay is protected" become one line in the hero that opens the same three points in a sheet. OK?
4. **Suggest a feature:** the card leaves both Homes and lives in Profile, Ideas & feedback (and the account menu). OK?
5. **Earn's first chip:** for a new worker with no skills yet, should "Jobs for you" open on For you or on Near you?

## Notes

- Gold marks "waiting on you" on the cards (Review the work, Pay to start), as the app's `statusBadge` tones already do. If you want gold kept only for verified, these become jade with a bold word instead.
- The walk was done on taskdrop.in as a guest (Hire and Earn, 390 x 844); the signed-in screens (My tasks, My work, Wallet, Profile) were read from the source, not walked. Names, areas and prices in the mock are sample data. The copy comes from the source.
- Plan line to update when you OK it: ULTIMATE_PLAN task 1.19 rows F, G, I ("design drawn 25 Nov, waiting for your OK on docs/design/home-simple-1-19").
