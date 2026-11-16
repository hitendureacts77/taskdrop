# Debug round 7 (16 Nov 2026)

Plan task 2.19. You asked for a full pass over the website, the admin, the phone-width view on a computer, **and the Android app on your phone**, always signed in, and later for the map, location and "not smooth" feeling to be found and fixed. The walks and their findings are in `round-7/`: `W1-guest.md`, `W2-signed-in.md`, `W3-golden-path.md`, `A1-admin-live.md`, `P1-phone-signed-in.md`.

**The short answer: not clean yet.** About 90 findings were written down (no Critical, 3 High). Most Highs and Mediums are fixed and merged; every fix still needs the live recheck, and a list of Low items and a few decisions are open.

## Round 8 follow-up (16 Nov, evening)

Fixed and merged after the walks: sign-in leftovers (PR 389: keyboard over the code box, phone digits, new-account step names the number, Test-mode box cleared, password Show/Hide, draft wording), money and forms (PR 391: earnings-clearing line, the 5% fine named in rupees, offer price messages, weekly goal, helper lines under disabled buttons, Withdraw reason, leave-without-saving on web), map, Back, one place source, counts and tap targets (PR 392, plus B152: the Vercel toolbar script is allowed on staging only), admin wording (admin PR 58). Update group 2940f3cf (beta) was published and applied on the phone (version 1.1.0, same build).

Checked live: Back from Explore goes Home on the phone; Earn Home shows the area; map labels no longer overlap and the pill names both counts; panning 0.37% janky frames (270 frames); web sign-in keeps the typed digits and the new-account step names the number big; Wallet shows the clearing line; admin payout not-found page, alerts heading and dashboard caption. Not rechecked: the sign-in code step with the keyboard up (P1-1), Google cancel timing, budget step price sign, draft delete prompt, release dialog fine wording (the phone was in use for something else).

Still open: P1-6 page jump, W3-20 test code auto-fill (owner decision), P1-25, W3-17 sidebar links and B171 (owner decision), W2-9 resume at the last step, the chat button unread dot, "How TaskDrop works" tap area, the 5-hour usage limit stopped nothing else.

## Every open bug in one list (16 Nov, night): fix them all together at the end

You asked for all the bugs to be written down first and fixed together at the end, then published in one update. This is that list. Nothing in it is being fixed now. The ids point to the walk files in `round-7/` and to `LEDGER.md`.

**Fixed and merged, but not on your phone yet (needs the one update):**

| Id | What | Level |
|---|---|---|
| P1-26 | Sign-in number box hidden under the keyboard (PR 395) | Medium |
| P1-27 | Sign-in Test-mode code stays under the keyboard, `RevealWhen` never scrolled on Android (PR 396; the cause is still a guess until it is checked on the phone) | Medium |

**Open bugs, not fixed (my work):**

| Id | What | Level |
|---|---|---|
| P1-6 | The page jumps when the budget step's price changes (the ₹ sign itself was fixed) | Low |
| W2-9 | A draft resumes at the first step, not the last one the person reached | Low |
| W3-17 (part) | The chat button on a task has no unread dot; "How TaskDrop works" has a small tap area | Low |
| P1-25 | Notification permission reads "granted" after "Don't allow" (needs a clean install to tell) | Low, unconfirmed |
| W3-18 | "Offered 4m ago" looked stale (probably an old render) | Low, unconfirmed |
| W3-19, W3-21 and the other info items | See `W3-golden-path.md` | Info |
| A1-9, A1-10 | Admin, info items | Info |
| CI | Semgrep fails on every pull request with a Python 3.14 crash in the CI setup (not a code finding) | Low |

**Fixed but never rechecked live (recheck after the update):** P1-1 (code step, now P1-27), P1-22 Google cancel timing, P1-6 ₹ sign, P1-21 draft delete prompt, the fine wording in the release dialog, W2-12 leave-without-saving on web, the Close-task refresh (P1-15, P1-19).

**Waiting for your decision** (same as the table below): razorpay deploy, B157 migration, W3-5 withdraw-an-offer, W3-10 global sign-out, B164 / P1-3 floating "+" over Apply (seen again on Earn Home on 16 Nov), P1-11 https links (needs an Android build), map intro replay, W3-20 test-code auto-fill, W3-17 sidebar links and B171, the dashboard "workers available now" tile, B169, B140, B99, Do Not Disturb during phone tests.

**Process note, 16 Nov night:** while the phone was in use, one tap and one swipe of mine landed in WhatsApp. Nothing was sent and no chat was read or saved. The phone was left alone until you said it was free.

## What waits for you (first, as the plan asks)

| What | Why it needs you |
|---|---|
| Deploy the `razorpay` Edge Function to staging | The "payments are busy, nothing was charged" wording is in the function; deploy needs your yes (AGENTS rule 7) |
| B157: "Work is waiting for your approval" stays after the task is paid | Needs a database migration (mark that reminder read when the task completes). Your yes |
| W3-5: no way to withdraw an offer | A new feature with a new server operation and a migration. Your yes, and whether you want it |
| W3-10: sign-out ends the account's sessions on every device (`scope=global`) | A decision: one device signing out signs out all of them (and your phone, if two testers share an account) |
| B164 / P1-3: the floating "+" covers Apply on Earn Home | A look change, your choice (same as B164, B173) |
| P1-11: `https://taskdrop.in` links do not open the app | Needs an Android build (intent filter and a verified-links file); builds are out until 1 Dec |
| Map: should a refresh after a pan replay the pin intro? | A design choice (D11 made the intro replay for a new set of pins) |
| B169 (leftover test task), B140 (`psql` for `test:db`), B99 (EXPO_BUILDS_TOKEN), fix/accept/after-launch on the Medium and Low list | Still waiting from earlier rounds |
| Turn on Do Not Disturb on the phone during tests | A Teams banner covered TaskDrop mid-test |
| Cookies | The site sets **no cookies**; sign-in and settings live in browser storage and the privacy page says so. Tell me what you saw (a banner, being signed out, something else) and I will fix it |

## What was run

| Step | Result |
|---|---|
| Guest walk (W1) | B170 to B179 and the guest-place fixes; PRs 378 and 379 |
| Signed-in walk (W2, W3) | 24 + 21 findings; W2 fixes in PR 380; W3 money wording, Withdraw and navigation in PRs 386, 387 |
| Admin, live (A1) | A1-1 to A1-7 fixed in admin PRs 55, 56, 57 (deleted accounts in counts, sideways scroll, money-check rows, past-the-last-page crash, page titles, full payment details) |
| Android app on the phone (P1) | 25 findings; P1-9, P1-15, P1-17 wording, P1-19, P1-10, P1-5 fixed; P1-9 did not reproduce on a second try (a shared-account clash during the walk was the likely cause), and a real session-storage race was fixed anyway |
| Location | One slow GPS read failed indoors; now falls back (PR 381). The "turn on location" sheet came back on every launch even when blocked; now remembered for 3 days (PR 382) |
| Map smoothness | Measured on the phone: panning 0 janky frames; zooming 2.4% janky, 46 ms at the 99th percentile. An Opus audit found the causes; the safe ones are fixed in PR 383 (Android and web) |
| Cookies | None are set (checked on the live site) |
| Checks | `npm run check` green on every branch (595 and 159 tests). `test:db` not run (B140) |

## Fixed this round (all merged into `redesigned-2.0`)

App PRs 376, 378, 379, 380, 381, 382, 383, 384, 385, 386, 387. Admin PRs 55, 56, 57. See each PR for the list; the main ones:

- **Money wording** (386): the release dialog no longer says the whole held figure goes to the worker; the worker sees what they earn, not the poster's total; Withdraw starts empty instead of with the whole balance filled in.
- **Session** (381): phone sign-in storage no longer lets a read land on a half-written session.
- **Close task** (380, 384): the fine is named once the worker started; the list and manage screen show the task closed at once.
- **Forms** (380, 385): offers and the worker profile refuse contacts as you type; an offer under Rs 20 says the lowest price; reviews start with no stars; min above max in the price filter is explained.
- **Navigation** (387): Back from a started job skips "Swipe to start" (new `replace` in `useNav`; the phone side is not run yet).
- **Map** (383): fewer re-renders and remounts on Android; pins no longer fly out again on every pan on web; "Your area" no longer covers a group's tag.

## Still open (fix next round, ids from the walk files)

W3-3 (earnings clearing not shown), W3-6 (the 5% fine is named only after it happens), W3-9 and W3-11 to W3-21; W2-1, 5, 9, 12, 14 (B157), 17; B152 (blocked Vercel feedback script, console error on every page); P1-1, 2, 4, 6, 7, 12, 13, 14, 16, 18, 21 to 25; B171 (full history routing); A1-8 to A1-10; the Opus audit's smaller items (zoom buttons over edge pins, face-stack photos that arrive late, refresh differences between the +/- buttons on web and Android). Semgrep fails on every pull request with a Python 3.14 crash in the CI setup (not a code finding): worth fixing so the check means something.

## Live recheck

Not done at the time of writing: Vercel was still deploying the last merges. Each fix must be rechecked on the live site at the width where it was seen, typing key by key (B167), and the map, location and navigation changes on the phone (needs an app update; builds are out until 1 Dec, so the phone only gets the web fixes through an OTA update, which needs your yes).

## The stop test

Not settled: round 7 found new bugs (S3 no), the new fixes are not all rechecked on staging (S4 no), `test:db` has not run (S5 no), and the golden path ran on the web but not on the phone with real offers and payments (S6 partly). S7 (your fix / accept / after launch answers) has none.
