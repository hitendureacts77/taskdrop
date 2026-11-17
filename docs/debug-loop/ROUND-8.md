# Round 8: every bug, written down (16 to 17 Nov 2026)

The owner's order: "check each and every functionality, every corner, except payments (Razorpay is not integrated). Find every bug and write it in the debugging plan." Nothing is fixed in this round. All bugs are listed first and fixed together at the end, then one update goes to the phone. Rules for the helpers: `round-8/BRIEF.md`. Method: 7 code audits (Opus 5.5 and Sonnet 5.5) and 4 live signed-in walks (website Hire, website Earn, Android phone, admin). The real total is what was found, not a fixed 1,000.

**Status when this file was written: 369 findings recorded, 0 Critical, 7 High, 91 Medium, 224 Low, 47 Info (info items are not bugs). Live walks L1, L2 and L3 were still running, so the numbers will grow. Before duplicates are removed: some findings repeat across helpers, and some repeat bugs already in the ledger (each report lists them under "Known, seen again").**

## Counts by job

| Job | What | Findings | Critical | High | Medium | Low | Info | Status |
|---|---|---|---|---|---|---|---|---|
| [S1](round-8/S1.md) | Code audit: access, sign-up, profile, 18+ | 32 | 0 | 2 | 7 | 18 | 5 | done |
| [S2](round-8/S2.md) | Code audit: database rules and data | 19 | 0 | 1 | 6 | 9 | 3 | done |
| [S3](round-8/S3.md) | Code audit: shared app layers | 46 | 0 | 0 | 6 | 28 | 12 | done |
| [S4](round-8/S4.md) | Code audit: posting, offers, task life | 40 | 0 | 0 | 15 | 22 | 3 | done |
| [S5](round-8/S5.md) | Code audit: find work, map, Home | 46 | 0 | 1 | 19 | 25 | 1 | done |
| [S6](round-8/S6.md) | Code audit: messages, notifications, profile, settings | 62 | 0 | 0 | 13 | 42 | 7 | done |
| [S7](round-8/S7.md) | Code audit: admin | 34 | 0 | 1 | 8 | 22 | 3 | done |
| [L1](round-8/L1.md) | Live: website, Hire (Asha) | 22 | 0 | 1 | 4 | 12 | 5 | still writing |
| [L2](round-8/L2.md) | Live: website, Earn (Ravi) | 13 | 0 | 1 | 4 | 7 | 1 | still writing |
| [L3](round-8/L3.md) | Live: Android phone | 27 | 0 | 0 | 6 | 19 | 2 | in progress |
| [L4](round-8/L4.md) | Live: admin | 28 | 0 | 0 | 3 | 20 | 5 | done |
| **All** | | **369** | 0 | 7 | 91 | 224 | 47 | |

Ids are per helper (S1-1, L3-12, ...), not B numbers. Each finding has Level, Area, Class, Where, Steps, Current, Expected, Proof and Cause in its own file. When the round is merged into the ledger, the ones that are real and new get B numbers from B180.

## Every High, in one place

- **S1-1** The 18+ rule is only checked when finishing setup; posting, offers, chat and hiring never check it
- **S1-2** The admin "sign-ups paused" switch is skipped by leaving out `mode` in phone sign-in
- **S2-1** Posting and sending offers do not require a passed 18+ check
- **S5-26** The full map shows only the newest 200 open jobs in the country, so nearby older jobs can be missing, and its count can disagree with the list
- **S7-12** Pressing Enter in the message title sends the message to the whole audience with no confirm step
- **L1-21** At times the `api` function answers in 16-22 seconds and the app then shows a half-loaded signed-in Home (avatar "?", "Set your location") with no error and no retry
- **L2-11** Profile > Edit: "Save profile" wiped Ravi's skills and location once (not reproduced)

**Triage note (Claude, before the owner reads):** S2-2 (any signed-in person can read every profile's payout UPI id, referral code and sign-out flags straight from the database) and S2-3 (the parties-only money and hiring fields of every open task are readable by anyone signed in) are rated Medium by their helper, but they are privacy leaks of another person's data; they should be treated as High when the list is triaged. L1-21 and L2-11 are live observations that were not reproduced twice; they need a second try before they get a B number.

## Every finding, by job

### S1 · Code audit: access, sign-up, profile, 18+ (32)

| Id | Level | Where | Title |
|---|---|---|---|
| S1-1 | High | all | The 18+ rule is only checked when finishing setup; posting, offers, chat and hiring never check it |
| S1-2 | High | all | The admin "sign-ups paused" switch is skipped by leaving out `mode` in phone sign-in |
| S1-3 | Medium | all | Phone numbers pass the contact filter with other separators, invisible characters or other digit sets |
| S1-4 | Medium | all | UPI ids pass every contact filter |
| S1-5 | Medium | all | Public questions, answers and the Ideas board use a weaker contact check than the api |
| S1-6 | Medium | all | Posts and chat before work starts allow "insta", and no filter catches bare web addresses |
| S1-7 | Medium | all | Several public text fields have no contact check at all |
| S1-10 | Medium | all | Door numbers like "A-402", "H-12" or "12 MG Road" stay in the public area label |
| S1-11 | Medium | all | A profile picture may be any outside web address |
| S1-8 | Low | all | A username can carry a phone number split by an underscore |
| S1-9 | Low | all | A chat message that starts with `::media::` skips the contact check |
| S1-12 | Low | all | A task's video length is never checked on the server |
| S1-13 | Low | all | Milestones are stored as whatever JSON the caller sends |
| S1-14 | Low | all | A crew budget split drops the remainder |
| S1-15 | Low | all | Clearing days default is hard-coded, and the server rules copy lacks TIMING and MEDIA |
| S1-16 | Low | all | Wallet history and "fees paid" use today's commission for old jobs |
| S1-17 | Low | all | Refusals name the code's field, e.g. "Invalid displayName" |
| S1-18 | Low | all | A failed SMS shows the provider's raw error to the person |
| S1-19 | Low | website | Guest list sizes and the guest task radius are not held to the guest limits |
| S1-20 | Low | all | "Requests posted" counts different things for guests and signed-in people |
| S1-21 | Low | all | Several "my" lists have no limit and are cut silently by the database's row cap |
| S1-22 | Low | all | The unread badge for one side stops at 200 |
| S1-23 | Low | all | Message threads come from the newest 300 messages across all tasks |
| S1-24 | Low | all | Signed-in "what is here" lookups send the exact GPS point to OpenStreetMap |
| S1-25 | Low | website | app-download's failure answers carry no CORS header and are not reported |
| S1-26 | Low | all | `health` runs a service-key database call for anyone, before sign-in and the limiter |
| S1-27 | Low | all | Search treats `_` as a wildcard |
| S1-28 | Info | all | Contacts are refused in proof summaries and crew chat even after work starts |
| S1-29 | Info | all | Admin switches leave gaps |
| S1-30 | Info | all | The limiter, the standing check and the session cutoff let calls through when they cannot be read |
| S1-31 | Info | all | `listActiveWorkers` is not called by the app |
| S1-32 | Info | all | 33 api operations have no test |

### S2 · Code audit: database rules and data (19)

| Id | Level | Where | Title |
|---|---|---|---|
| S2-1 | High | all | Posting and sending offers do not require a passed 18+ check |
| S2-2 | Medium | all | Any signed-in person can read every profile's "private" fields straight from the database |
| S2-3 | Medium | all | "Parties only" money and hiring fields of every open task are readable by anyone signed in |
| S2-4 | Medium | all | A worker can replace or delete proof-of-work files after handing them in, even during a dispute |
| S2-5 | Medium | all | A poster can send work back for changes forever; "changes requested" has no timer, so the 3-day auto-approve never comes |
| S2-6 | Medium | all | The 5% cancel fine is paid straight into the worker's spendable balance: no 7-day clearing, no commission, no ledger row |
| S2-10 | Medium | all | A poster can change an open task's title, description, price and place after offers came in; bidders are not told |
| S2-7 | Low | all | Reviews have no length limit and no contact filter, and are public |
| S2-8 | Low | all | A task's photo stays downloadable after staff hide the task |
| S2-9 | Low | staging | Razorpay test key id and secret sit in plain text in the migration history table |
| S2-11 | Low | all | Bidders on an open task are not told when the poster cancels it |
| S2-12 | Low | all | No database check on task title or description length or emptiness |
| S2-13 | Low | all | A person can mark themselves "Active now" forever by writing `live_until` / `last_seen_at` directly |
| S2-15 | Low | all | 53 row rules call `private.is_admin()` per row instead of once per query |
| S2-16 | Low | all | Foreign keys without an index (beyond B104) and no index for unread notifications |
| S2-17 | Low | website | Eight open test tasks still show to everyone on staging |
| S2-14 | Info | all | Offer delete rule says "you may delete your own offer", the trigger says "never" |
| S2-18 | Info |  | An old review sits on a cancelled task |
| S2-19 | Info | staging | Migration history: 082 twice, folded rows without files (info) |

### S3 · Code audit: shared app layers (46)

| Id | Level | Where | Title |
|---|---|---|---|
| S3-1 | Medium | all | White text on the light jade accent is 4.05:1 (under 4.5) |
| S3-6 | Medium | all | Reduce Motion is ignored by the shared sheet, dialog, tabs and screen push |
| S3-24 | Medium | all | A task can open on the Active screen without being started: "started" is remembered by title, and two demo titles are pre-seeded |
| S3-27 | Medium | all | Toasts are never announced to screen readers |
| S3-30 | Medium | all | A budget range like "5000-10000" is refused as a phone number (app and server) |
| S3-37 | Medium | Android | Tapping a push notification when the app is closed opens Home, not the notification |
| S3-2 | Low | all | Dark-theme Earn count fill `purpleFill` is 4.40:1 under white text |
| S3-3 | Low | website | Web focus ring stays jade in Earn mode after a theme change or first load |
| S3-4 | Low | website | Web tab bar and side menu say "Explore" in Earn mode; the phone app says "Find work" |
| S3-5 | Low | all | The Hire/Earn mode is kept per device, not per account |
| S3-7 | Low | all | Sentry scrubbing stops at depth 8: deeper strings are sent unscrubbed |
| S3-9 | Low | all | Our global error handler replaces Sentry's on phones, and doubles reports on web |
| S3-10 | Low | Android | A malformed `/screen/%..` path crashes the phone navigator |
| S3-11 | Low | Android | Phone navigation keeps every pushed screen's params for the whole session |
| S3-13 | Low | all | Raw developer error text can reach the person through `e.message` |
| S3-14 | Low | all | Start-up frames are hard-coded near-black, even in the light theme |
| S3-15 | Low | all | ConfirmDialog: busy button has no name, backdrop has no label, focus not trapped |
| S3-16 | Low | all | Shared kit parts missing roles and announcements |
| S3-17 | Low | all | Raw hex colours in shared components instead of tokens |
| S3-18 | Low | all | Count badges use 9 to 10 px text |
| S3-19 | Low | all | "x ago" dates older than a year lose the year |
| S3-20 | Low | Android | Google linking on a phone can say "linked" when it was not |
| S3-25 | Low | all | Shared app state is not cleared at sign-out |
| S3-26 | Low | all | `roll()` starts its timer inside a state updater |
| S3-28 | Low | all | The toast's fade-out never plays |
| S3-29 | Low | all | The crash page promises "Nothing you entered ... was lost" and is always dark |
| S3-31 | Low | all | "I can pay 150000" is refused as an address |
| S3-33 | Low | website | Web sends two presence writes each time the tab comes back |
| S3-36 | Low | website | Web navigation never de-duplicates: a double tap opens the same screen twice, and phone-width tab taps pile up |
| S3-38 | Low | all | A video with unknown length is accepted and saved as exactly 60 s |
| S3-40 | Low | Android | On Android the Google map stays light in dark mode |
| S3-41 | Low | Android | The native map picker has no screen-reader labels and ignores Reduce Motion |
| S3-42 | Low | all | "Today" late in the evening gives a due time tomorrow |
| S3-43 | Low | all | Auto-written titles are cut mid-phrase |
| S3-8 | Info | all | Sentry scrub keeps address and location fields |
| S3-12 | Info | Android | Shared task links never open the task in the Android app |
| S3-21 | Info | all | Every token refresh re-runs the guest clean-up and re-renders the whole app |
| S3-22 | Info | website | Console noise in production from Google sign-in errors |
| S3-23 | Info | website | Each screen change sends an attention-count request |
| S3-32 | Info | all | `npm run check` lints nothing |
| S3-34 | Info | all | A write that never answers leaves its button spinning for good |
| S3-35 | Info | all | Four separate rupee formatters |
| S3-39 | Info | website | Web drops leak object URLs |
| S3-44 | Info | all | Remembered answers are never removed, only made stale |
| S3-45 | Info | Android | "Share this task" may be missing on Android test builds |
| S3-46 | Info | all | An offer can be sent twice by a fast double tap |

### S4 · Code audit: posting, offers, task life (40)

| Id | Level | Where | Title |
|---|---|---|---|
| S4-2 | Medium | all | Search chip ✕ on Home leaves the pillar filter switched on, with no chip to clear it |
| S4-3 | Medium | all | Poster Home rail loses the paid ordering and does not mark promoted listings, but impressions are still billed |
| S4-10 | Medium | all | Double-tap on "Post" can create two tasks (safety-card check awaits before the `posting` guard) |
| S4-12 | Medium | all | On the Review step "Post my request" ignores a bad title, a missing price or a contact in the text when the step path was used to jump forward |
| S4-14 | Medium | Android | TaskManageScreen never reloads when it comes back into view, and "Choose offer" on Compare stacks a second copy of it |
| S4-15 | Medium | all | Compare "Choose offer" takes the money at once with no confirmation, and shows neither the 3% fee nor the fine |
| S4-16 | Medium | all | Compare shows "No offers yet" when the offers could not be loaded |
| S4-17 | Medium | all | Review comments can carry phone numbers and e-mails, and they show unmasked on public profiles |
| S4-20 | Medium | all | The photo or video box forgets an attachment it still holds |
| S4-21 | Medium | all | The 60-second video rule is only checked on the phone or browser; an unreadable length counts as 60 and the server never checks it |
| S4-22 | Medium | all | A crew can be set so each helper gets under the ₹20 minimum, and the person finds out only after the last step |
| S4-23 | Medium | all | Promote: the "Show it to" switch is not connected to anything, and the reach numbers are fixed figures |
| S4-27 | Medium | all | My complaints says "No complaints" when it could not load, and "Add details" forgets which task |
| S4-28 | Medium | all | "Post" on a big-day line does not carry the planned date, so the task starts with "Today" |
| S4-39 | Medium | Android | Answering a worker's question on TaskManage can be hidden by the keyboard |
| S4-1 | Low | all | CreateScreen is dead code and shows invented numbers |
| S4-4 | Low | all | "LOCAL HELP" tag and "waiting for offers" label fail contrast in light mode, and the tag name does not match the chip |
| S4-5 | Low | all | Earn royal blue (and a third blue) used on Hire screens |
| S4-6 | Low | all | Raw colours inside screens and components that should use tokens |
| S4-7 | Low | website | Composer card on Hire Home nests a button inside a button |
| S4-8 | Low | all | Many "known" copy points say or imply local-only |
| S4-9 | Low | all | Post flow Budget box floors at ₹10 although the lowest price is ₹20 |
| S4-11 | Low | all | The shared `createTaskSchema` is not used and disagrees with the form and the server |
| S4-18 | Low | all | A reviewed task keeps asking for a review, and a second submit silently replaces the first |
| S4-19 | Low | all | Review screen: stars are unlabelled, who is reviewed follows the Hire/Earn switch, and a made-up task is shown when opened without one |
| S4-24 | Low | all | Promote: changing the budget or days after a payment was started leaves the old campaign pending, and the success message names the new figures |
| S4-25 | Low | all | Copy points to features that do not exist ("reopen a closed one", "date edit") |
| S4-26 | Low | all | Regulars never leaves "loading" when the call fails |
| S4-29 | Low | all | Big day: plan limit text contradicts, plans live only on the phone, and a failed read leaves the shimmer forever |
| S4-30 | Low | all | Escrow screen hard-codes the "3%" fee label and computes the first figure with the default fee |
| S4-31 | Low | Android | Crew screen keeps polling while hidden and does not follow new messages |
| S4-32 | Low | all | Search boxes and switches without labels on Hire screens |
| S4-33 | Low | all | The same thing has several names on the Hire side (offer/quote, See offers/Choose from offers, providers/workers/helpers) |
| S4-34 | Low | all | A kept custom date can be in the past when the post is finally sent, and the refusal is a raw message |
| S4-36 | Low | all | Review step says "Nothing is paid now. When you pick someone ..." even for Auto-hire, and the Hunt reward looks like an input |
| S4-37 | Low | all | "Create similar" copies the posted price with its top-up and the pre-filled budget stays |
| S4-38 | Low | all | Small touch targets and raw widths on controls added in the Hire flow (details for the known tap-target item) |
| S4-13 | Info | all | PostDetailsScreen and ConfirmScreen are unreachable and carry weaker rules than the live flow |
| S4-35 | Info | all | Task Options panel offers "Repeat when done" on finished tasks, though Repeat was removed from the writer |
| S4-40 | Info | all | Hire Home content: other people's titles, fixed marketing prices |

### S5 · Code audit: find work, map, Home (46)

| Id | Level | Where | Title |
|---|---|---|---|
| S5-26 | High | all | The full map shows only the newest 200 open jobs in the country, so nearby older jobs can be missing, and its count can disagree with the list |
| S5-1 | Medium | all | "Remote & online" on Earn Home can shimmer forever after one failed read |
| S5-2 | Medium | all | Distance on a card can belong to the wrong job (km taken by index after `attachPosters`) |
| S5-3 | Medium | all | "Matches your skills" lists jobs that match nothing |
| S5-4 | Medium | all | A failed save leaves the bookmark filled; the error text is the raw server message |
| S5-5 | Medium | all | The Find work hero strip ignores the place the list and map use |
| S5-6 | Medium | all | With no place chosen, "Nearby" shows every pinned job in the country |
| S5-10 | Medium | all | Worker search results are cut at 20 with no "more", and the category chips only filter those 20 |
| S5-11 | Medium | all | "Accept" on a Home search-results card sends a full-price offer in one tap, skipping the offer form's rules |
| S5-12 | Medium | all | "Why you" (at least 10 characters) is a client-only rule; the server accepts an offer with no message |
| S5-27 | Medium | all | Map: a failed read shows "No jobs near X yet"; filters sheet and "Widen" shortcut count the wrong set on the list |
| S5-29 | Medium | all | Tapping "Start" is irreversible with no confirm, and a failed start leaves the job marked as started on the phone |
| S5-31 | Medium | all | Inline offer on the task page: any failure turns the offer box into "CLOSED FOR OFFERS" |
| S5-32 | Medium | all | Inline "Price only" offer skips the safety card and the "Why you" rule; editing an offer then jumps to My tasks |
| S5-34 | Medium | all | "Work for you" ignores the worker's area, mixes in all jobs under a "match your skills" title, and can show a load error as "nothing here" |
| S5-35 | Medium | all | Saved tasks: a failed load reads "Nothing saved yet"; a failed un-save is not undone |
| S5-36 | Medium | all | Search screen: the budget "fields" are fixed text, the radius stops at 25 km, switches have no labels, "Use my location" is a 16 px target, and results land on a different list than Find work |
| S5-37 | Medium | all | My offers (Orders): errors look like "Nothing here yet"; a pending offer cannot be opened; Cancel has no confirm and no fine notice |
| S5-38 | Medium | all | Active job: a failed refresh after "Mark work done" or "Approve" is reported as a failed action |
| S5-41 | Medium | all | Offer a service: ₹50 floor and no top limit on the client, no floor on the server; "Take down" has no confirm; a failed load spins forever |
| S5-7 | Low | all | Find work cards show no distance, though the list can be sorted by "Nearest" |
| S5-8 | Low | all | Find work search: nothing happens until the keyboard's search key; clearing the text keeps the old results; no clear (x) in the box |
| S5-9 | Low | all | The same search handed twice from Home is not applied the second time |
| S5-13 | Low | all | Offer form "Hours": bad numbers are dropped silently, tiny ones hit a database error |
| S5-14 | Low | website | Offer form: the delivery-date pill is a button inside a button, and its label hides the chosen date from screen readers |
| S5-15 | Low | all | Urgent and "Unique" jobs lose their area on the Home search card |
| S5-16 | Low | all | Pull-to-refresh failures are swallowed |
| S5-17 | Low | all | Earn Home distance choices do not match Find work's, and neither shows how many jobs there are |
| S5-18 | Low | all | The same job can show up in two or three Earn Home sections |
| S5-19 | Low | Android | Earn Home asks for the device location with no explanation |
| S5-20 | Low | all | Hero strip: tapping the distance jumps from a custom distance to 2 km |
| S5-21 | Low | all | A custom top price hides jobs priced exactly at it |
| S5-22 | Low | all | Server search: `_` is a wildcard, and the pinned and remote jobs are matched with different words |
| S5-23 | Low | all | Segmented List/Map switch is 34 px tall and has the wrong accessibility roles |
| S5-24 | Low | all | Raw hex colours in Earn components |
| S5-28 | Low | all | Typing in a price box and then tapping a preset leaves the box showing the typed number |
| S5-30 | Low | all | A made-up "Assemble a wardrobe" job is pre-started in app state |
| S5-33 | Low | all | Task page shows the poster's saved home area, not the job's area; "Requests posted" counts services and cancelled tasks |
| S5-39 | Low | Android | Active job: proof upload edge cases (copy, steps, video, tap sizes) |
| S5-40 | Low | all | Map job card says "Send quote" but opens the task page; two names for the same thing |
| S5-42 | Low | all | `DetailSheetScreen` is registered but nothing opens it, and it is full of sample data |
| S5-43 | Low | all | Analytics (Profile > My earnings and jobs): the admin-only block is built for every user, and its 90-day chart does not fit |
| S5-44 | Low | all | Streaks: a saved goal can be reported as failed, no refresh, and the streak bar has no spoken value |
| S5-45 | Low | all | Ideas board: a stale list stays under a new filter, "Show more" can skip or end empty |
| S5-46 | Low | all | Open task page can show sample data as if it were real |
| S5-25 | Info | all | Dead effect and doubled doc comment |

### S6 · Code audit: messages, notifications, profile, settings (62)

| Id | Level | Where | Title |
|---|---|---|---|
| S6-1 | Medium | all | Keyboard Send / Enter has no busy guard on the number, birth and password boxes |
| S6-4 | Medium | all | Date of birth typed for one number is reused for a different number after "Change" |
| S6-5 | Medium | all | A valid code followed by a failure after sign-in is reported as a wrong code, the code is cleared and the person is stuck on the code step |
| S6-11 | Medium | all | Profile skills and languages: no contact check, and the "8 skills" and "6 languages" limits are client-only |
| S6-16 | Medium | all | Account → Sign-in methods shows a tick for "Username and password" when no password was ever set |
| S6-17 | Medium | all | Setting a password does not ask for the current password or a fresh sign-in |
| S6-24 | Medium | all | Public profile never shows "Verified" for other people, though Account promises "Verified accounts get more replies" |
| S6-25 | Medium | all | Public profile: a failed load looks like "This profile is not available" |
| S6-33 | Medium | all | Pricing: "How fees work" hides when fees fail to load and shows nothing |
| S6-36 | Medium | Android | Errors raised inside the username sign-in sheet may be hidden behind it on Android |
| S6-39 | Medium | all | Chat and post contact filter lets contact details through |
| S6-41 | Medium | all | Live chat can miss messages when the phone's clock is ahead of the server's |
| S6-47 | Medium | all | Reading a chat never clears its alerts; the bell and the Messages dot stay lit |
| S6-2 | Low | all | A 10-digit number that does not start with 6-9 gives no explanation, and the keyboard "Send" says the wrong thing |
| S6-3 | Low | all | Sign-in code step: "No code? Ask again in 0:60" |
| S6-6 | Low | all | Typing "+91" one key at a time can still turn a good number into a wrong one |
| S6-7 | Low | all | Raw colour values inside screens (AGENTS: tokens only) |
| S6-8 | Low | Android | Small tap targets (under 40 px) on sign-in and account links |
| S6-9 | Low | Android | Missing accessibility roles and labels on sign-in and profile controls |
| S6-10 | Low | all | Onboarding "About you" lets a phone number or email be typed in the name and bio, and only refuses after a partial save |
| S6-12 | Low | all | Onboarding progress label jumps from "Step 3 of 7" to "Step 6 of 7" for someone who only posts |
| S6-13 | Low | all | Onboarding username: "✓ Available" shows for the previous handle while the next one is checked, and a contact-like handle shows the wrong message |
| S6-14 | Low | all | Profile photo upload failure leaves the new picture showing (ProfileEdit) or removes a saved one from view (Onboarding) |
| S6-15 | Low | all | First letter of a name is cut in the middle of an emoji |
| S6-18 | Low | all | Account: Save accepts a taken username, and clearing the username is allowed with no warning |
| S6-19 | Low | Android | Account: Mode and Theme buttons are about 36 px tall |
| S6-22 | Low | all | ProfileEdit: the worker bio can be emptied after setup, and a custom skill can be added twice with different capital letters |
| S6-23 | Low | all | ProfileEdit "Your status" says "Before this visit you were last active ..." but the value is the current heartbeat |
| S6-26 | Low | Android | Profile screen keeps the old avatar after sign-out while mounted |
| S6-27 | Low | all | Profile: motion ignores reduced-motion |
| S6-29 | Low | all | Public profile: "Joined Invalid Date" if `created_at` is bad, review shows author "Someone" for deleted accounts |
| S6-30 | Low | all | Support: the first answer says "after 5 wrong tries you need a new code" and "work for 10 minutes", and the page promises "Google or Apple" sign-in |
| S6-31 | Low | website | Support (signed out): the "Sign in" button goes to `welcome`, and the answers' "How fees work" link is hidden to guests though it is public |
| S6-32 | Low | all | Help: send and conversation lists |
| S6-34 | Low | all | Pricing wording: "Earnings reach your wallet in N days" and "5% ... Paid to the worker" |
| S6-37 | Low | all | Username sign-in shows the browser's raw network error |
| S6-40 | Low | all | The same filter blocks harmless chat and post text as an "address" or a "phone number" |
| S6-42 | Low | all | Chat notice says "Your offer was accepted" to the person who posted the task |
| S6-43 | Low | all | Chat task strip keeps saying "held safely" after the task is finished or cancelled |
| S6-44 | Low | all | Chat opened from a message notification is titled "Task" |
| S6-45 | Low | all | Chat bubbles show no time or date |
| S6-46 | Low | website | Chat: Enter sends mid-composition, and the view jumps to the bottom while reading older messages |
| S6-48 | Low | all | Messages list has no unread marker, and shows no person |
| S6-49 | Low | all | Messages: the search box says it searches messages but only checks the task title and the last line; a failed refresh is silent |
| S6-50 | Low | all | Notifications: a second tap on the same alert opens the screen twice; "All" stops at 200 |
| S6-52 | Low | all | Guest pill is 38 px high, and the guest note's link is small |
| S6-53 | Low | all | Intro and the guest pop-up describe sign-up differently |
| S6-54 | Low | all | Splash: a tap runs the move-on twice, and the 2.6 s wait cannot be skipped by a signed-in person |
| S6-55 | Low | all | Confirm screen: sample-task wording, no visible Back, and it offers release on a finished task |
| S6-56 | Low | all | Wallet: hard-coded minimum, "frozen" wording, no retry when the balance does not load |
| S6-57 | Low | all | Wallet and Withdraw: tap targets and a "Withdraw Rs 0" button |
| S6-58 | Low | all | Copyright form: phone is "optional" though the notice list requires it; the date is UTC |
| S6-59 | Low | all | Welcome step: a wrong referral code blocks "Let's go" with no way to skip it |
| S6-60 | Low | all | AgeGate shows a blank screen while it asks the server |
| S6-62 | Low | all | Help copy promises a notification that has no setting; Account Save has no guard without an account |
| S6-20 | Info | all | Account → Sign-in tab holds Delete account, and there is no language or notification setting anywhere in Account |
| S6-21 | Info | all | Delete account is one confirm tap |
| S6-28 | Info | all | Profile "Active now" is always shown for the signed-in person |
| S6-35 | Info | all | Legal pages: "Draft — under legal review" banner and staging notice are English-only and shown on every legal view; DMCA / Copyright |
| S6-38 | Info | all | Phone sign-in tells anyone whether a number has an account, without sending an SMS |
| S6-51 | Info | all | There is no notification setting anywhere (kinds, quiet hours, push on or off) |
| S6-61 | Info | all | Age check: a turned-away person can answer again with a different date |

### S7 · Code audit: admin (34)

| Id | Level | Where | Title |
|---|---|---|---|
| S7-12 | High | admin | Pressing Enter in the message title sends the message to the whole audience with no confirm step |
| S7-1 | Medium | admin | Several staff changes leave no audit-log row at all |
| S7-3 | Medium | admin | Opening a person page writes a new "opened with phone and email visible" audit row on every refresh |
| S7-4 | Medium | admin | "Money in wallet" filter ignores the search box and does not leave out deleted accounts |
| S7-14 | Medium | admin | A non-admin who tries the admin @username sign-in is signed out of the TaskDrop app on every device |
| S7-15 | Medium | admin | Person page lists stop at 10 or 25 rows without saying so |
| S7-16 | Medium | admin | Full bank account number, IFSC and UPI id are shown to Viewer, Support and Finance roles that cannot pay |
| S7-26 | Medium | admin | Sales (money-blind) can still ask "how many people hold at least Rs X" through Messages |
| S7-27 | Medium | admin | Counter-notice message gives the restore date one day early |
| S7-2 | Low | admin | Tag add and remove are logged in a second call whose failure is ignored |
| S7-5 | Low | admin | A backslash in the search box is not escaped, so "abc\" matches nothing |
| S7-6 | Low | admin | A tiny percent setting (for example 0.004) is accepted but saves as 0 |
| S7-7 | Low | admin | Raw database error text is shown to staff ("The database said: ...") |
| S7-8 | Low | admin | Payout and refund success messages repeat the amount and name the browser sent |
| S7-9 | Low | admin | Job category is free text, not chosen from the app's categories |
| S7-11 | Low | admin | Sidebar: no item is highlighted on "Today's entries" and several items share one icon |
| S7-13 | Low | admin | The People "Download spreadsheet" and the money filter are not role-checked for Sales |
| S7-17 | Low | admin | The money settings read swallows errors and falls back to 20% commission |
| S7-18 | Low | admin | Deleting a note is one click with no confirm and no undo |
| S7-19 | Low | admin | Ledger rows on a job page open the whole ledger for that kind, not that entry |
| S7-20 | Low | admin | Star ratings have no text alternative |
| S7-21 | Low | admin | Login page shows raw provider text for a Google start error |
| S7-22 | Low | admin | Unknown addresses outside the dashboard use the bare Next.js 404, and the "couldn't load" page shows internal text |
| S7-23 | Low | admin | "Nothing {period}" wording when the earlier figure is zero |
| S7-25 | Low | admin | Paging edge cases beyond known A1-4: audit log, People "Segments", payouts history |
| S7-28 | Low | admin | The same bank or UPI reference can be recorded as "paid" on several withdrawals |
| S7-29 | Low | admin | Team role changes appear in the audit log as "Changed admin_staff" and have no filter tab |
| S7-30 | Low | admin | Buttons the server will refuse are still live for roles that cannot use them (B133, wider than listed) |
| S7-31 | Low | admin | More lists stop at a fixed number without saying so |
| S7-33 | Low | admin | Authenticator set-up is not refused for an account that already has one (needs a live check) |
| S7-34 | Low | admin | Small data and wording gaps (one finding, several lines) |
| S7-10 | Info | admin | Delete account, suspend, sign-out-everywhere and "end all staff sessions" need no authenticator code |
| S7-24 | Info | admin | The People page tag/filter links keep the search but "Newer / Older" is the only paging |
| S7-32 | Info | admin | Reading a private chat message or a private job photo through the service key leaves no audit row |

### L1 · Live: website, Hire (Asha) (22)

| Id | Level | Where | Title |
|---|---|---|---|
| L1-21 | High | website | At times the `api` function answers in 16-22 seconds and the app then shows a half-loaded signed-in Home (avatar "?", "Set your location") with no error and no retry |
| L1-6 | Medium | website | "Post my request" first threw "Failed to fetch" with no message; the second press said Asha is at the 5-jobs-a-day cap, only after all 8 steps |
| L1-11 | Medium | all | "Find it for me" (Hunt) explainer says the service fee is "0.03%" instead of 3% |
| L1-14 | Medium | website | Just opening a Home idea tile and closing it saves a junk draft, and ten of those push a real draft out (draft cap 10) |
| L1-16 | Medium | website | Wallet: "Yours to use Rs 0" next to "You have Rs 23 available" |
| L1-1 | Low | website | The composer's Next button is dead for 1 to 4 characters and says nothing |
| L1-2 | Low | website | Typing a number with no account logs a red "404" in the console and a failed network call |
| L1-7 | Low | website | Post flow: category chips and the price box have no accessible state or name |
| L1-8 | Low | website | Deadline calendar: the previous-month arrow goes into past months |
| L1-9 | Low | website | Price box: "250.50" becomes "₹250." and "100000" shows without lakh commas |
| L1-13 | Low | website | A task with 0 offers wears a "CHOOSE FROM OFFERS" chip |
| L1-15 | Low | website | "Plan a big day" screen: the browser tab says only "TaskDrop", the footer says "saved on this phone", tick boxes are 22 px |
| L1-17 | Low | website | Several screens keep the generic browser tab title "TaskDrop" |
| L1-18 | Low | website | Ideas & feedback: "Post idea" looks switched off, does nothing and says nothing when the form is empty |
| L1-19 | Low | website | Spending numbers on two screens do not match |
| L1-20 | Low | website | Promote: the money button looks ready before a post is picked, and it promises "1,800 - 3,400 workers per day across your city" |
| L1-22 | Low | website | Unknown paths and `?task=bad` open Home with no message (seen again), but a well-formed missing task id does say so |
| L1-3 | Info | website | (unconfirmed) The sign-in number box ended with a different number than the one typed |
| L1-4 | Info | website | Leftover test tasks sit in Asha's "Your published tasks" on Home, two of them overdue |
| L1-5 | Info | website | Composer type checks that PASSED (no bug): phone number, number in words, spaced digits, wa.me link, "at ... dot com" email, emoji, 1500-character cap |
| L1-10 | Info | website | Budget step results (no bug): 0, 19, 20, 100000, 100001, -5, huge numbers |
| L1-12 | Info | website | A posted task cannot be edited at all (no Edit in Task options) |

### L2 · Live: website, Earn (Ravi) (13)

| Id | Level | Where | Title |
|---|---|---|---|
| L2-11 | High | website | Profile > Edit: "Save profile" wiped Ravi's skills and location once (not reproduced) |
| L2-1 | Medium | website | Find work search for `' OR 1=1 --` fails with "Couldn't load this" (DB_ERROR) |
| L2-4 | Medium | website | Offer "hours" has no upper limit on the server: 99999 hours (11 years) was saved |
| L2-5 | Medium | website | Two different "My offers" screens: after sending an offer you land on the old one, where a pending offer cannot be opened or edited |
| L2-7 | Medium | website | Earn "Promote this service" lists the person's own requests, not services |
| L2-2 | Low | website | Earn Home "Matches your skills" lists a job outside the shown skills |
| L2-6 | Low | website | Page titles do not match the screens: "Orders" for My offers, "My work" for the same area |
| L2-8 | Low | website | "Earned so far" is lower than the money "ready to withdraw" |
| L2-9 | Low | website | Streak card still says "Badge at 10" after 29 on-time jobs |
| L2-10 | Low | website | Task page shows distance as "50 m" on an open job |
| L2-12 | Low | website | Cold load of Home (Earn) first shows "Set your area / Add skills" for a person who has both |
| L2-13 | Low | website | Confirmed place "Madhapur, Hyderabad, Telangana, India" is saved and shown as "Hyderabad, Telangana" |
| L2-3 | Info | website | The same job appears in two sections of Earn Home |

### L3 · Live: Android phone (27)

| Id | Level | Where | Title |
|---|---|---|---|
| L3-1 | Medium | Android | Find work area label reads "Building Number 9" while Home says "Madhapur" |
| L3-3 | Medium | Android | Earn Home: the floating "+" button covers the Apply button of the first job card |
| L3-6 | Medium | Android | Post wizard step 3 and Review: the post gets requirements the poster never wrote |
| L3-12 | Medium | Android | Explore (Hire, Helpers) shows "No helpers within 2 km yet" after a failed offline load and does not recover when the network returns |
| L3-18 | Medium | Android | Task page (Earn): tapping the offer price opens the keyboard but the price stays under it, so typing is blind |
| L3-27 | Medium | Android | Large system font (150 percent): header, tab bar and map header break |
| L3-4 | Low | Android | Find work list view: only one job row fits and the "best offer" card repeats it |
| L3-7 | Low | Android | Post wizard: the header says "New task" on step 1 and "Post a request" on steps 2 to 8 |
| L3-8 | Low | Android | Post step 1: Next stays greyed with no reason for 1 to 2 letters; ideas list is almost hidden by the keyboard |
| L3-9 | Low | Android | Post step 4 "This week" means 7 days from now, and the time sheet resizes when the time-of-day chip changes |
| L3-10 | Low | Android | Post step 5 Budget: a typed "." is kept but later digits are silently dropped |
| L3-11 | Low | Android | Post step 6 Place: a writing task defaults to "At a place" |
| L3-13 | Low | Android | No offline indicator anywhere; Home keeps showing "2 helpers active now" |
| L3-14 | Low | Android | Chat: the "could not reach" toast sits on top of the message box and send button |
| L3-15 | Low | Android | Notifications: the auto-approve warning is cut off; the "All" tab is 48 px wide |
| L3-16 | Low | Android | Words for the same thing differ: quote, offer, "Tasker 1153", "Needs providers", "seed worker" |
| L3-17 | Low | Android | Messages list shows only task titles, no person, no time of the last message |
| L3-19 | Low | Android | Offer price: clearing the box leaves a blank price (no Rs 0) and the keypad offers "-" "," "." and space |
| L3-20 | Low | Android | Task page: "Distance: Not shared" shows for a moment, then flips to "Remote / online"; "Requests posted" value changes width |
| L3-21 | Low | Android | My Work (Earn) shows "Success 100%" with 0 jobs completed, and the profile says "New helper . no reviews yet" |
| L3-22 | Low | Android | My Work tab strip: the fourth tab "Saved" runs off the right edge and its count cannot be seen |
| L3-23 | Low | Android | No app version or update id anywhere in the app |
| L3-25 | Low | Android | Several tap targets under 40 dp |
| L3-26 | Low | Android | Profile menu icons do not match the labels |
| L3-28 | Low | Android | Find work opened with a 2 km radius and "10 jobs" after I had used Hire Explore (Helpers 2 km); earlier it showed "57 jobs within 10 km" |
| L3-5 | Info | Android | Tapping a job row in the Find work list goes back to the map instead of the job |
| L3-24 | Info | Android | "Show my spot on the map" is OFF ("you are hidden (ghost)") while the profile header says "Active now" |

### L4 · Live: admin (28)

| Id | Level | Where | Title |
|---|---|---|---|
| L4-3 | Medium | admin | A dispute decision (final, moves frozen money) can be saved with no reason, and the page shows only the poster's side |
| L4-11 | Medium | admin | Business reports gives different counts for the same thing on one page |
| L4-12 | Medium | admin | "New people" still counts deleted accounts (91 vs 73), the daily digest says 203 in all |
| L4-1 | Low | admin | Person, job and help-request pages are not named in the tab title |
| L4-2 | Low | admin | Suspend and dispute decision panels do not take focus, are not dialogs, and Escape does not close them |
| L4-4 | Low | admin | A bad help-request id says "That job or person doesn't exist" |
| L4-5 | Low | admin | An unknown address outside the panel shows a bare black Next.js 404 |
| L4-6 | Low | admin | The sign-in page still shows to a signed-in admin |
| L4-7 | Low | admin | Money in a person's activity list has no decimals while every other place has two |
| L4-8 | Low | admin | Person page shows 10 of 27 reviews and a capped activity list with no "show all" and no count |
| L4-9 | Low | admin | Straight and curly apostrophes are mixed in the same labels |
| L4-13 | Low | admin | Alert rows cannot be opened and show raw codes |
| L4-14 | Low | admin | Segment preview is ordered by internal id, so "Older" is not older |
| L4-15 | Low | admin | Payouts says "On the way 0" at the top and "On the way ₹4,900.00" lower on the same page |
| L4-16 | Low | admin | Opening a person page that does not exist writes an audit row |
| L4-17 | Low | admin | Reasons are optional on switches, suspend and hide, required on other final actions |
| L4-18 | Low | admin | Settings "Advanced" prints raw keys and amounts in paise |
| L4-19 | Low | admin | Sub-pages do not say where you are: same breadcrumb on seven settings pages, none on four others |
| L4-20 | Low | admin | The reports queue names a flagged job by a number |
| L4-21 | Low | admin | Tap targets under 36 px are still common |
| L4-22 | Low | admin | The earnings tile compares a half day with a whole day |
| L4-23 | Low | admin | Segments show a wallet that adds clearing money, the People list shows ready money |
| L4-24 | Low | admin | System health: the Audit log check takes 1.6 s (others 70 to 290 ms) |
| L4-10 | Info | admin | Seed jobs have impossible timelines (info) |
| L4-25 | Info | admin | The admin loads Vercel's feedback widget and runs as a "preview" build (info) |
| L4-26 | Info | admin | Copy that claims things that are not true yet (info) |
| L4-27 | Info | admin | I was signed out between visits and the sign-in page gave no reason (info) |
| L4-28 | Info | admin | 390 and 1440 could not be driven live (info) |

## Still to do for this round

1. L1, L2 and L3 finish; this file is rebuilt from the reports (the count above is written by a script).
2. Remove duplicates between helpers and against `LEDGER.md`; give each real new bug a B number (from B180).
3. Confirm the code-only findings live (marked in each report) before fixing them.
4. The owner says "fix"; Claude fixes by theme (Sonnet 5.5 for regular work, Opus 5.5 for complex), runs `npm run check`, merges, then publishes ONE phone update (needs the owner's yes) and rechecks on the phone.
