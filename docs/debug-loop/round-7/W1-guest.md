# Round 7, job W1: guest walk on the website (taskdrop.in staging)

Date: 16 Nov 2026. Walked as a signed-out guest ("Skip sign-up for now"), no account made, no code requested, nothing posted, sent or downloaded. Widths: 390x844, 768x1024, 1440x900. Source code and data not touched.

How it was driven (and a warning): the built-in browser pane, in my own tab on `https://www.taskdrop.in` (clean storage, no sign-in). The Chrome extension tools were not used because (1) `resize_window` there did not change the page width (`innerWidth` stayed 1920/2560) and (2) the Chrome group already held other helpers' tabs and signed-in sessions on the same origins. Phone and tablet widths are browser emulation (390 and 768 px wide, mobile and desktop user agents as the pane gives them).

**Interference seen (explains B150):** my first pane tab on `taskdrop.in` was taken over mid-walk. With nobody typing in my session, the sign-in screen showed with 98880 00002 in the phone box and the message "Wait 30s before asking for another code", and the tab id changed from `seed` to `tab-1`. Another helper drives the same pane (that number is the fake account of the signed-in walk). So B150 ("a tab signed itself in") is very likely a second driver in the same browser, not an app bug. I moved to my own tab; from then on `localStorage` had no auth token at any check.

Pane caveat: when the pane is hidden the page stops compositing, so screenshots then show animations frozen half-way (an intro card that looked empty, a sheet that looked shifted off the screen). I checked each such case with DOM measurements and dropped the ones that were only frozen animation. Numbers below are from the DOM.

## Seen again (already in the ledger, not re-reported)

- B152: console error on every load, `vercel.live ... feedback.js violates ... script-src`.
- B100 / B145: Explore "Type my area", typing "Madhapur": `POST places-search 401`, then the browser itself calls `GET nominatim.openstreetmap.org/search?...q=Madhapur` (status 200). The sheet says "Searching..." for more than 5 s meanwhile.
- B148: `?task=00000000-0000-0000-0000-000000000000` opens Home silently, URL rewritten to `/`.
- B146: Explore sends `workersNear {radiusKm: 20000, limit: 200}` and `tasksNear {radiusKm: 20000, ...}` from a guest.
- B156: Earn Home with NO area set, as a guest: "Needed today" lists Bangsar (Kuala Lumpur) and Cyber City (Gurugram) in-person jobs. With an area set it is fine ("Matches your skills" showed only remote and Kondapur ones).
- B164 pattern, now on the website at 390 px (new places, see W1-4).
- B150: explained above (second driver).
- Rechecked fixed on the website: B88 (typed "+919876543210" key by key gives "98765 43210"), B94 (hero now "Get help, near or far. Or earn."), B151 (ended Hunts now show "See it", not "I'm looking"), B167 (typing "-5.5e3x😀999" in the Min price gives "5." and "₹5+", "25x5.5e0😀" gives "255.").

## Findings

### W1-1 · Find work shows three different job counts for the same area
- Level: Medium · Class: UI/data · Widths: 390, 768 (map header and list at 1440 also disagree)
- Steps: as a guest pick the area "Madhapur" (Explore, Type my area), switch to Earn, Explore, "List". Read the card at the top, the list line and the Filters button. Then open the map.
- Current: the top card says "40 jobs within 25 km"; the list says "82 jobs within 10 km of Kondapur, plus remote"; Filters says "Show 82 jobs" (Nearby 62, Remote 20); the map header says "90 jobs . Kondapur . within 10 km" (1440 px: "62 jobs within 10 km . 28 remote"). A 10 km count (82) is bigger than the 25 km count (40), and the map's remote count (28) is not the list's (20).
- Expected: one count per radius, computed the same way on card, list and map.
- Proof: request body `{"op":"tasksNear","args":{"lat":17.44,"lng":78.39,"radiusKm":25,"limit":40}}` feeds the card, so "40" is the `limit`, not a count; the map shows "Narsingi +11 . 52 jobs" on one cluster alone. Screenshot taken at 390 and 768.
- Likely cause: `ExploreScreen.tsx` / near-map card uses `tasksNear` result length (capped at limit 40) as the count.

### W1-2 · The web app never changes the address or history: Back leaves the site, reload goes Home, legal pages have no address
- Level: Medium · Class: UI · Widths: all
- Steps: (a) guest opens Home, Explore, a task page, Terms: the address bar stays `/`, `history.length` stays 2 and `history.state` is `null` after each move (checked). (b) Open `https://www.taskdrop.in/privacy`, `/terms`, `/support`, `/copyright`: every one answers 200 with the app shell and shows Home, page title "TaskDrop". `/nonexistent-page-xyz` and `/.env` also answer 200 with the same shell. (c) Open `?task=<real id>`: the task page shows, then the address is rewritten to `/`, so a reload shows Home.
- Current: the browser Back button cannot step back through screens (there is nothing to step to; from a fresh visit it leaves the site, here "no back history"); a reload on any inner screen returns Home; Terms and Privacy cannot be linked to. Only `/get` (title "Get TaskDrop for Android") is a real page.
- Expected: at least the legal pages and task pages keep an address, and Back goes to the previous screen.
- Proof: `fetch('/privacy')` 200 text/html len 1784, same length as every other path; screenshot of Home at `/privacy`.
- Likely cause: web `App.tsx` / `ScreenHost` keeps screens in state, no router (known design for web; the finding is the effect on Back, reload and legal links; a public privacy-policy address is also needed before launch).

### W1-3 · Many tap targets are under 40 px at 390 (and 768)
- Level: Low · Class: UI · Width: 390 (768 and 1440 too for the icons)
- Steps: Home (Earn), Find work, the post wizard Review, sign-in page, Explore map; run a size check on every button and link.
- Current (px): Save for later bookmark 18x18, "Edit skills" 58x17, Hire/Earn switch 54x28, "Apply" 70x36, "Show 6 more" 112x33, "See every open job" 128x17, map chips Jobs/Helpers/Filters 32 high and "10 km" 34, zoom buttons 40x36, "Back to my area" 36x36, wizard "Edit" links 25x17, sign-in "Not now" 57x18, legal links Terms 35x15 / Privacy 42x15 / Copyright 58x15 / Support 48x15, Help topic chips 34 high. At 1440 the bookmark is 20x20.
- Expected: 40 px or more (or a bigger invisible hit area).
- Proof: size list from the page; no screenshot needed.
- Likely cause: shared card and chip components (`HomeSections.tsx`, job card, `Badge`/`Chip`); the web has no `hitSlop`.

### W1-4 · The round "+" button covers content at the bottom right on the website (390)
- Level: Low · Class: UI · Width: 390 (same family as B164 on Android)
- Steps: Earn Home, scroll so the "Matches your skills" Hunt card sits near the bottom. Hire Home: first screen and the "Manage my tasks" grid.
- Current: the button hides the "Ended" tag of the Hunt card (reads "Ende"), part of the "Be there for me" chip and the end of the chip row, and the words of the "Job referral" and "Queue for me" tiles. Screenshots taken.
- Expected: room under the list, or the button moves or hides while scrolling (this is the owner question already on B164).
- Likely cause: the floating action button has no bottom space reserved in the home lists.

### W1-5 · Some white-on-light text is below 4.5:1 (dark and light theme)
- Level: Medium (the chip) / Low (the rest) · Class: UI · Width: 390 and 1440
- Steps: Dark theme, Hire Home: look at the category chips and the "NEW" tag. Light theme: Earn Home hero and Hire composer chips.
- Current (measured text colour on its fill): "Money back" selected chip white on #57D1AE = 1.89:1; "NEW" badge white on #F08A66 = 2.46:1 (9 px); "R", "A", "K", "S" letters in the hero circles blue on white 3.08:1; light theme: "Today / In 2 days / This week" white on #318673 = 4.38:1, Earn hero "Find your next job" 4.25:1, "5 jobs + star 4 to Trusted" and "on the go" 4.45:1, "URGENT" tag 4.42:1.
- Expected: 4.5:1 or more (the design rule: white text only on the deep shades).
- Proof: contrast script result; screenshot of the chip at 390 (dark). Other measured items were gradient false positives and are not listed.
- Likely cause: chip/tag colours in `theme.ts` and `HomeSections.tsx` (selected chip uses the light jade).

### W1-6 · A guest sees zero balances and an "Active now" status as if real
- Level: Low · Class: UI · Width: all
- Steps: guest, tap Wallet, My Work, Profile.
- Current: Wallet shows "Available -", "Amount frozen in ongoing tasks ₹0", "Withdrawals on their way to you ₹0", "Your earnings ₹0 / Nothing earned in this period yet", with "+ Add money" and "Withdraw" buttons, under a small "You're looking around as a guest" bar. My Work shows a stats row (Earned -, Completed -, Active 0, Offers 0, Closed 0). Profile says "Guest . Looking around . Active now" although no heartbeat can run for a guest.
- Expected (charter A): a friendly "make your account" screen instead of a zero wallet; no "Active now" for a guest.
- Likely cause: Wallet/MyWork/Profile screens render for `userId == null` with defaults.

### W1-7 · Place picker for a guest: slow, and place names carry double spaces
- Level: Low · Class: UI · Width: 390
- Steps: Explore, "Type my area instead", type "Madhapur" key by key.
- Current: "Searching..." stays for more than 5 s (places-search 401, then the Nominatim call, see B100); results and the saved label read "Madhapur,  Ward 104 Kondapur,  Greater Hyderabad Municipal Corporation West Zone" (a comma followed by two spaces; also "Sirur,  Raikode mandal"); after choosing it the header says "Kondapur" while the user chose Madhapur.
- Expected: results quickly; one space; the header names what was picked.
- Proof: result list text; `taskdrop.guest.area.v1` holds `"label":"Madhapur,  Ward 104 Kondapur,  Greater ..."`.
- Likely cause: `lib/location.ts` label join (", " plus an already spaced part).

### W1-8 · Map labels and bubbles pile up, controls cover bubbles
- Level: Low · Class: UI · Width: 390
- Steps: Earn mode, Explore map around Madhapur, 10 km.
- Current: the "₹4,200" bubble is hidden under "₹4,750"; "Narsingi +10 . 48 jobs" overlaps "Botanical Garden Rd +3 . 4 jobs"; the compass and zoom buttons sit over the "₹1,..." bubble and the "Charminar" label at the right edge. Hire map: "Madhapur +13" cluster label under the "Your area" pin.
- Expected: no label drawn over another; controls do not cover pins.
- Likely cause: `NearMap` bubble collision rules / control position.

### W1-9 · "Services near you" card: the rating wraps onto three lines
- Level: Low · Class: UI · Width: 390
- Steps: Hire Home, scroll to "Services near you".
- Current: "Delivers in ~2 days . Financia..." then the rating " . star 5.0 (4)" wraps into a narrow column of three short lines at the right edge of the card.
- Expected: the rating stays on one line.

### W1-10 · Small items (each Low, one line)
- Price chips overlap at the edges: with "Under ₹300" 9, "₹300-₹1,000" 26, "₹1,000-₹5,000" 54 the three add up to 89 but "Any price" is 82 and nothing is in "₹5,000+" (cause not checked; maybe ₹300 and ₹1,000 sit in two chips).
- Task page eyebrow says "SERVICES" on a request ("Maths tuition for class 8"), while the list card says "Tutoring & Education" (both Hire and Earn mode, 390 and 1440).
- Every screen keeps the page title "TaskDrop" (only `/get` has its own).
- Console on every load (web): `Animated: useNativeDriver is not supported because the native animated module is missing` (warn).
- The Sentry "Report a Bug" box opens with its own purple style, not the app's colours (Profile, Ideas).
- A first-time guest ("Skip sign-up for now") lands in Earn Home (blue) while the tagline starts with "Ask for anything"; check this is intended.
- Empty "Sign in" with nothing typed shows only a short toast "Enter your username and password" (no text under the boxes); the toast is gone in about 2 s.

## What I checked and found fine

- Overflow: `scrollWidth` equals the window width on every screen at 390, 768 and 1440 (Home both modes, Explore map and list, Find work, task page, Wallet, My Work, Messages, Notifications, Profile, Terms, Privacy, Help, Copyright, Ideas, /get, wizard steps 1 to 8). Elements past the edge were only decorative circles and map markers.
- Account gates: Save for later keeps a local guest list (`taskdrop.guest.saves.v1`, no server call); "Apply" opens the offer sheet and "Send a counteroffer" opens "Your offer is ready. One step left." with Create account / Sign in / Not now; Messages and Notifications say "Alerts need an account". The username sign-in sheet opens; empty Sign in is refused. The phone box drops letters, emoji and "<script>" and cannot be submitted empty ("Text me a code" greyed until a number).
- Wrong input: `<script>alert(1)</script>`, emoji, `OR 1=1`, "9999999999999999" in the offer price, Min price, budget and the composer: all shown as plain text or limited (budget shows "The lowest price is ₹20" and "From ₹20 up to ₹1,00,000"); nothing executed. The composer title is the raw text including the script tag (rendered as text).
- Rapid triple tap on "Apply": one sheet only.
- Post wizard as a guest, 8 of 8 steps to Review with a draft kept on the device (`taskdrop.postWizard.v1`, owner "guest"), area pre-filled from the guest area; I stopped before "Post my request".
- Privacy in answers: every guest read I captured (about 40 calls: Home batches, tasksNear, workersNear, searchTasksWithPosters, getTaskDetail, listTaskQuestions, getPosterStats, listReviewsAbout, listFeedbackBoard, platformFees) was scanned for phone numbers, emails, UPI ids, tokens and full-precision coordinates: none. Task coordinates come back with 2 decimals (about 1 km), `address` is null. Sensitive field names present: only `loc_lat`, `loc_lng`, `address` (null). The guest's own chosen place is stored with 7 decimals in `taskdrop.guest.area.v1` and sent in the near-reads (known, B147 family).
- Light and dark theme: dark text contrast was clean apart from W1-5; light theme checked on Profile, Home both modes, Explore.
- Console: besides B152 and the `useNativeDriver` warn, one `401` (places-search). No other errors. Failed network calls: only that 401.
- `/robots.txt` says "Staging copy ... Disallow: /".

## Walked

Intro (all 5 slides, auto-advance), "Skip sign-up for now", the sign-in/sign-up page (390 and 1440; phone box, Username sheet, legal links; stopped before sending a code), Hire Home and Earn Home (390, 768, 1440), Explore map and list in both modes, place search and location sheet, Find work with every filter (All/Nearby/Remote, 2-100 km, price chips, Min and Max, Auto-hire, Counter offers, Due in 24 hours, sort), a task page and the poster's public sheet, My Work, Wallet, Profile, Terms, Privacy, Help & support, Copyright, How fees work, Ideas & feedback, Report a Bug, the Get-the-app popover and `/get`, the Drop-a-task wizard to Review, deep links `?task=`, `/privacy` and others.

## Not covered

Google sign-in (leaves the site), the SMS code and age-gate steps, "Post my request", "Send offer", sending a question (the Enter key on it was refused by the permission check), the Copyright notice form, "Download the app" (a download), the Android app, offline and slow-3G runs, reload on every deep link kind (only task and unknown task), a helper's public page and proof photos, a real task Q and A thread, Big Days / City Hunt / Together screens, Hire-mode Find-work filters, the search results page and the post wizard at 768 and 1440, Light theme beyond the five screens above, real finger touch (clicks were mouse clicks).
