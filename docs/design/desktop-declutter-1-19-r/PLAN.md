# Desktop declutter (task 1.19 row R)

Owner, 26 Nov: "the desktop version, the Chrome version, is looking so cluttered ... On mobile I could see you are
handling it with show more or cards ... reduce this clutter."

Built on top of PR 519 (shared tab header) and PR 521 (simpler Home), both merged 26 Nov. Pictures in `before/` were
taken after those two merges (the Meera fixture, `e2e/desktopWebKit.ts`), so they show what is live today; `after/`
shows this branch. File names: `<width>-<screen>-<hire|earn>.png`, 1440 x 2400 (desktop, the page zoom of a 1440 x 900
window) and 390 x 2400 (phone, Home only: the phone is unchanged; the other 390 pictures matched before and after except where live data changed between the two runs).

## Rules

- Desktop only (`useLayout().desktop`, 1024 px and up). The phone and tablet layout is not touched: phone pictures
  taken before and after on the same data match pixel for pixel, except where live data changed between runs. (The
  `web-phone-same` zero-pixel guard fails on 26 Nov on live-data drift since its baselines: a new task, counts.)
- Nothing is removed. Long lists start short and open in place with "Show N more" / "Show less", the same pattern the
  phone already uses. Every full list is still one click away, and the "See all" / "All N in My tasks" links stay.
- Earn stays royal blue and Hire jade: every new control uses the mode's accent tokens.
- Section order and content come from the live source; no new sections.

## What made each screen cluttered, and the change

| Screen | Cluttered by | Change (desktop) |
|---|---|---|
| Hire Home, main column | Needs you now table 4 rows; Ideas to post 6 cards (2 rows); Services near you every card (3 x N rows) | Table 3 rows (link to all stays); Ideas one row of 3 + Show more; Services one row + Show more |
| Hire Home, right rail | 4 stacked cards, Just posted 5 rows and Busy on TaskDrop 5 rows, the helpers map last | Live card, then the helpers map (the tool) up top; Just posted and Busy on TaskDrop 3 rows each + Show more |
| Earn Home | Jobs for you: 3 cards on a 2-column grid (a lone card on row 2); Ways to earn 7 cards in 3 rows | Jobs: one full row (2) + Show more; Ways to earn one row + Show more (Add a skill inside) |
| Explore (Hire list) | "Explore" said twice (page header + tab title); Start from a template: every template as huge 2-column cards | One title (the tab title with its live line and List/Map switch); templates in 3 columns, first 6 + Show more; "People often ask for" in 3 columns |
| My tasks | Status pill cut ("Date pas…") and task titles cut while the button column was 290 px wide for one button; Needs you now 4 rows | Wider status and task columns, button column 230 px; Needs you now 3 rows on desktop (the table lists every task) |
| Profile | Right column 4 cards long, left column ends early | Theme and Reviews cards move under "you" on the left; right keeps the menu, Suggest a feature and the links |
| Find work, Messages | Already a calm two-pane desktop layout | Unchanged |

## Layout grid at desktop width

Side menu 240 px, then the page column (`FEED_MAX` 1280, gutters 24-40). Home: main column + 300 px right rail
(`DesktopColumns`). Cards: equal columns at least 170-230 px measured from the column they sit in. Every section
shows at most one row of cards, or three list rows, before Show more.
