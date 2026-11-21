# Round 7, job W2: the website signed in (taskdrop.in, staging, fake data)

Walked 16 Nov 2026 in the built-in browser pane (Claude in Chrome was NOT used: its tabs on taskdrop.in and www.taskdrop.in already held a signed-in session of an existing account, and signing in as Harsha there would have replaced it; see W2-0). Signed in as the fake person Harsha Naidu (+91 98880 00002, Kondapur) by typing the number and the on-screen test code key by key. Widths: 390x844, 768x1024, 1440x900 (viewport emulation). Nothing was hired, paid, posted, sent or saved. Every network answer made by the page was scanned for phone numbers, emails and exact coordinates: only the person's own sign-in email was found (see "Private data"). Screenshots were taken at each screen (kept in the tool results, not saved to disk).

The file is appended to as the walk goes on. Status line at the bottom says how far it got.

## Findings

### W2-0 (note, not a bug) · The Chrome profile and the built-in pane share one login per site, so two helpers on taskdrop.in can sign each other out
- Level: Low (test setup) · Width: all
- Steps: Claude in Chrome tabs for taskdrop.in and www.taskdrop.in each held a Supabase session for an existing account (ec7ca544..., not Harsha). The built-in pane also showed a second helper's tab on taskdrop.in beside mine, so a tab of one helper can change the saved sign-in of the other (same browser storage). This is a likely explanation for B150 (a guest tab that "signed itself in").
- Expected: each helper uses its own browser profile, or the guest and signed-in walks run one after the other.
- Proof: local storage key `sb-...-auth-token` present on both origins before I signed in; the pane listed 3 tabs on taskdrop.in. Also: when the other helper's tab is in front, my screenshots fail ("pane not displayed"); I had to bring my tab to the front each time.

### W2-1 · Many tap targets are under 40 px on the phone width
- Level: Low · Width: 390 (also 768)
- Steps: open Home, My Tasks, Profile, Post flow, Account at 390 and measure the buttons.
- Current: Hire/Earn switch 54x28; Home chips 63-126 x 32-34; "How TaskDrop works" 28-32 px; "Task options" (the three dots) 18x18; bookmark "Save for later" 18x18; Edit links on the Review step 23-25 x 15-17; top-up percent buttons 36x28; text links "See all >" 44x15, "See as others >" 91x17, "Full map" 52x17, "Preview" 51x17; tab labels "You" and "App" 26x42 and 28x42; category chips 36 high. Expected: 40 px or more.
- Proof: element sizes measured in the page (e.g. `Task options 18x18`, `Edit Budget 25x17`, `Top up 2 percent 36x28`). Likely cause: small `hitSlop`-less Pressables across `components/` and screens.

### W2-2 · The offer "proposal" box takes a phone number and an email with no warning
- Level: Low (Medium if a saved offer shows the number; the worker profile text is masked on display, see W2-21, but the offer view was not checked because sending is forbidden) · Width: 390
- Steps: Earn mode, open a job from Home ("Build a one-page website for a yoga studio"), tap "Price + proposal", click the proposal box, type `I can do it. Call me 9876543210 or mail a@b.com <script>x</script>`. NOT sent.
- Current: the counter reads 69 / 500, no message, the send button stays enabled. The bio box (Edit profile) refuses the same text with "You can't put a phone number / an email address on your profile", and the question box says contacts are removed.
- Expected: the same warning (or a visible note that contacts are removed) before sending. Not confirmed on the server because sending is forbidden: whether the saved offer strips contacts is open.
- Proof: text read from the page after typing; note a screenshot was taken.

### W2-3 · "Close task" on a job whose work has started promises a full refund and does not mention the 5% fine
- Level: Medium (money wording) · Width: 1440
- Steps: Hire mode, My Tasks, In progress, "Set up a GST invoice template in Excel" (OVERDUE, worker started, Rs 950 held), the three dots, "Close task", then pressed "Keep it".
- Current: the menu line says "Everything you paid comes back, fee included"; the dialog says "Everything you paid, service fee included, goes back to your wallet. This can't be undone." Product rule (AGENTS.md): cancelling after work starts costs the poster a 5% fine (B58 touched the Wallet side of this).
- Expected: the dialog names the fine (or says "if work has not started").
- Proof: dialog text; screenshot taken. Likely cause: close-task sheet/dialog copy in `TaskManageScreen.tsx` (does not branch on a started job).

### W2-4 · seen again: B76 (the review form starts with 5 stars chosen, "Excellent")
- Level: Medium (already in the ledger) · Width: 1440
- Steps: Hire, My Tasks, Completed, "Paint one accent wall in the living room", "Rate the worker".
- Current: five filled stars and "Excellent" before any tap, Submit enabled. The praise tags are no longer pre-ticked (that half is fixed). Not submitted.

### W2-5 · The address never changes, so Reload and Back lose the place
- Level: Low · Width: all
- Steps: open any inner screen (a task, Compare offers, Settings); read `location.href` and `history.length`; reload on a task page.
- Current: URL is always `https://taskdrop.in/`, `history.length` stays 1, and the reload from a task page returned to Home. The browser's Back button would leave the site; an in-app Back arrow is the only way back. (B148 covers `?task=` links; this is the general case.)
- Expected: at least Back moves one screen inside the app; a reload on a task returns to that task.

### W2-6 · seen again: B153 (Compare offers "Complete by" date is in the past)
- Level: Medium (already in the ledger) · Width: 390
- Steps: My Tasks, "Edit a 3-minute travel vlog" (remote, OPEN, 2 offers), Compare 2 offers.
- Current: "COMPLETE BY 8 Nov, 9:53 AM" (8 days ago) while the task page shows no date at all. Looks like the fallback `created_at + time_limit` when there is no `due_at` (PR 351 only fixed tasks that have `due_at`).
- Expected: no date, or the same date as the task page.

### W2-7 · A future birth date says "That date does not exist"
- Level: Low · Width: 390 (new sign-up, +91 98880 77001)
- Steps: sign out, type the new number, "Text me a code", set Day 1, Month December, Year 2026.
- Current: "That date does not exist. Check the day." (also for 31 December 2026). The year list starts at 2026 (this year). The button stays off, which is right.
- Expected: "Birth date can't be in the future" and no current/future years in the list.

### W2-8 · A pasted international number "0091-9888077001" turns into a different, wrong number
- Level: Low · Width: 390
- Steps: sign-in box, paste (insertText) `0091-9888077001`.
- Current: box shows `09198 88077`; the button stays off (starts with 0), so no code goes to a wrong person, but the digits are not the person's. Pasted `+91 98880 77001` and typed `+919888077001` are handled correctly (B72 and B88 hold).
- Expected: strip 0091 like +91.

### W2-9 · A saved post draft only keeps the first sentence
- Level: Low · Width: 390 and 768
- Steps: Home, "What do you need done?", type text, Next through Details, Post, When, Budget (1200), Place, Extras to Review, then the X. My Tasks shows "DRAFTS 1 ... Continue".
- Current: no "save draft?" question on X; the draft is saved silently; "Continue" opens the first screen with the text only, the budget step is back at Rs 0 and the choices are gone. "Delete this draft" deletes at once with no question.
- Expected: say what is saved, resume at the last step with the chosen price, or ask before closing.

### W2-10 · "Get a crew" is suggested because of "2BHK"
- Level: Low · Width: 390
- Steps: post flow, text `Clean my 2BHK flat ...`, go to the Extras step.
- Current: "Get a crew. You said '2BHK'". A flat size is read as a number of helpers.
- Expected: only when the text asks for several people.

### W2-11 · An offer of Rs 0 shows "below budget" and a dead button with no reason
- Level: Low · Width: 390
- Steps: job page as a worker, "Price + proposal", type 0 into the price box.
- Current: "-Rs 4,350 below" and a greyed send button; no minimum is named; the price then jumps to Rs 20 when the proposal is typed.
- Expected: "The lowest price is Rs 20" like the post flow says.

### W2-12 · Leaving Edit profile with unsaved typing asks nothing and keeps nothing
- Level: Low · Width: 390
- Steps: Profile, Edit my profile, type in "About you", press Back.
- Current: back to Profile at once; nothing was saved or kept. Catalogue says: kept or the person is asked.

### W2-13 · seen again: B165 (status line cut to "THE DATE HAS P...")
- Level: Low · Width: 768, 1440 (and 390)
- My Tasks cards for "Drop a birthday cake before 7 pm" show "THE DATE HAS P..." in the two- and three-column layouts.

### W2-14 · seen again: B157 (the "waiting for your approval" alert stays)
- Level: Low · Width: 390
- Notifications, All: "Work is waiting for your approval ... Paint one accent wall" (4d ago) for a task that finished and was paid.

### W2-15 · seen again: B152 (every page logs the blocked vercel.live feedback script)
- Level: Low · console error on every load.

### W2-16 · The sign-out dialog names only phone and Google
- Level: Low · Width: 375
- "You'll need your phone number or Google account to sign back in." Harsha also has a username and password (Settings, Sign-in, "Username and password" ticked).

### W2-17 · Explore: "110 jobs on the map" next to "Jobs 84"
- Level: Low (unverified, may be by design: map shows the whole view, list shows 10 km + remote) · Width: 768 and 1440 (Earn)
- Needs a look at what the pill counts.

### W2-18 · My Tasks counters show 0 while the cards are still loading
- Level: Low · Width: 1440
- After a window resize and a revisit, "0 Active / 0 To review / 0 Completed" with grey skeleton cards for a few seconds. Expected: dashes or skeletons for the numbers too.

### W2-19 · The map picker opens over the Welcome step of a new sign-up by itself
- Level: Low · Width: 390 (new account +91 98880 77001, right after the correct code)
- Current: onboarding "Step 1 of 6 · Welcome" is drawn, but the full-screen "Drag the map to set your spot" picker (pin on Bengaluru 12.97160, 77.59460, "This site is blocked from seeing your location") is already on top of it, before "Let's go" was tapped. Back (arrow) shows the Welcome step. Expected: Welcome first.

### W2-20 · seen again: B156 (Earn Home offers in-person jobs from other cities) for a person with no area
- Level: Medium (already in the ledger) · Width: 390 (new account, Earn mode, no area chosen, skill "Repairs")
- Current: "Needed today" lists "Maths tuition for class 8" in Bangsar, Kuala Lumpur (Rs 5,700) and "Check the queue at the passport office" in Cyber City, Gurugram; "Matches your skills" lists in-person Hyderabad jobs (Botanical Garden Rd, Charminar) although the person set no area. The "Jobs near you" block correctly says "Set your area". Expected: with no area, only remote jobs (or an ask for an area) in all three blocks.

### W2-21 · The worker profile box "What you do" accepts a phone number with no warning
- Level: Low · Width: 390 (new account, Earn mode first visit "Set up your worker profile")
- Steps: type `I fix things. WhatsApp me on 98765 43210 <script>alert(1)</script> emoji`, pick Repairs and English, "Start earning".
- Current: saved without a message (the customer bio refuses the same text). "See as others" shows it masked: `I fix things. ••• on ••• <script>alert(1)</script>` (so the number is hidden on display, but "WhatsApp me" is swallowed with it and the number is stored). The script text is shown as plain text.
- Expected: the same refusal as the customer bio, or the same stored-text clean-up.

### W2-22 · Typing an area takes about 12 seconds and shows only "Searching..."
- Level: Low · Width: 390 (Earn, Explore, "Type my area")
- Steps: type `%_ <b>x</b> Kondapur` key by key.
- Current: "Searching..." for 4 s and still, answers after about 12 s (`places-search` 200). No timeout message, no cancel. Results list full street addresses of plots and shops.
- Expected: a faster answer or a note after a few seconds.

### W2-23 · Username step: the rule shows only after an error, and typed markup is silently rewritten
- Level: Low · Width: 390 (sign-up step 2)
- Current: typing `<b>Ad min</b>` + emoji leaves `badminb` with "Available" (the letters of the tags stay); only a too-short name ("ab") shows "3-20 characters: a-z, 0-9 and _". Expected: the rule under the box from the start.

## Checked and fine (no bug)

- No sideways overflow (`scrollWidth` equal to the window width) on Home, Explore (map and list), My Tasks, a task page, Compare, Messages, a chat, Notifications, Wallet, Profile, Edit profile, Account (3 tabs), Ideas board, Review form, Post flow (all 8 steps up to Review), Earn Home, Find work, a job page, My Work, in Hire and Earn, at 390, 768 and 1440 (the 1440 list for Hire and Earn: Home, Explore, My Tasks/My Work, Wallet, Profile, Messages, Notifications, Settings).
- Bad input: bio and the post box show `<script>`, `<b>`, `${7*7}`, emoji, Hindi, Telugu and Arabic as plain text; a phone number (also spaced out, 9 8 7 6...) and an email are refused in the bio; display name of spaces is refused ("Add a display name"); username "Admin!" becomes "admin" and says "That username is taken"; the post box stops at 1,500 with a counter, spaces only keep Next off; the price box: `-5.5e3abc` becomes 5., 11 digits are cut to 10 and "The most is Rs 1,00,000"; Rs 1,200 shows "Workers see Rs 1,200, with the 3% fee Rs 1,236 is held".
- Under 18 (17 years, 364 days): "TaskDrop is for adults only", no code. Exactly 18 today: accepted, code step shown.
- Broken images: none. Console: only the known vercel.live error; two 429 answers from `phone-auth` were my own repeated "Text me a code" taps inside the 60-second wait ("Wait 22s before asking for another code").
- The Wallet screen shows the held Rs 978.50 and the paid amounts consistently on phone, tablet and desktop; B158 chip, B160 and B155 wording look fixed.

## Private data in network answers

Every `fetch` answer of the page (Supabase REST, the `api` function, auth) was scanned for 10-digit mobile numbers, emails and 4+ decimal coordinates: the only hit was the signed-in person's own sign-in email `p9888000002@phone.taskdrop.app` in `/auth/v1/user`. No other person's phone, email, exact address, token or UPI appeared. About 400 calls, no 4xx/5xx except the two `phone-auth` 429s above.

## Undo list (shared data)

- Created and deleted: one local post draft (text "Clean my 2BHK ...") in Harsha's browser storage, removed with "Delete this draft" (list is `[]`). Nothing on the server was changed for Harsha (bio, name, username, password were typed into but never saved; "Keep it" pressed on the close-task dialog; the review form, report sheet, filters, offer box and Withdraw were opened but nothing was sent).
- Created on purpose for the sign-up cases: a NEW fake account **+91 98880 77001** (username `w2_test_7001`, display name "Tasker 7001", exactly-18 birth date 16 Nov 2008, area "Hyderabad, Telangana 500084" picked from a place search, worker profile text "I fix things. WhatsApp me on 98765 43210 <script>..." with skill Repairs and language English). It is signed out. Ask the owner whether to remove it (no delete was tried: account deletion is forbidden). The two earlier sign-up attempts with the same number (17 years and a future date) were refused and left nothing.
- The existing Chrome sessions (account ec7ca544...) on taskdrop.in and www.taskdrop.in were not touched.

## Status

Walked: Hire and Earn, all main screens (Home, Explore map and list and Filters, My Tasks and its four tabs, task page with offers, Compare, Messages and a chat, Notifications, Wallet, Profile, Edit profile, Account in 3 tabs, Ideas board, review form, close-task dialog, post flow all 8 steps to Review, My Work with its tabs, Earn Home, a job page with both offer boxes and the report sheet) at 390 (Harsha, plus a new account for onboarding), 768 (Hire and Earn sweeps, post flow to the budget step, My Tasks) and 1440 (Hire and Earn sweeps, My Tasks, task pages, review form, Ideas, Settings). Sign-up: typed +91, pasted +91 and 0091, under 18, 18 today, future date, wrong code (3 times; "That code is not right" shows for about 2 seconds and the boxes clear), correct code, six onboarding steps, worker setup, new-account empty states (My Tasks, Wallet, Profile, Earn Home, Explore with no area).

Counts: 24 entries W2-0 to W2-23. 1 note (W2-0), 6 "seen again" (B76, B153, B156, B157, B165, B152) and 17 new: 1 Medium (W2-3) and 16 Low. No High found. No private data in network answers.

NOT walked, and why: the proof-upload step (Harsha has no active job as a worker, so the file pick was not reached); money forms beyond looking (Withdraw at Rs 0 only showed "You can withdraw once you have Rs 100 available"; the golden-path job covers money); weekly goal, promote, Help ticket and copyright forms; sending a question, a message or a report; the report sheet's "Send report" looked enabled with an empty reason and was NOT pressed (please check that an empty report is refused on the server); the custom-distance box in Filters (the price boxes were tried: `-250.50abc` gives 250, a huge maximum is cut at 7 digits); a second signed-in person at the same time; double-tap on a send button and the two-tab test (nothing safe to send twice); 768 px for the new account. Screenshots were taken at each screen but live only in the tool results; none was saved to disk.
