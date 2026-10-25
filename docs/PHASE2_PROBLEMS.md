# Phase 2: problems found by trying to break TaskDrop

Date: 2026-10-24 and 2026-10-25. Written by Claude, as the owner asked ("go to each and every functionality of my application and break it"). Fake accounts and fake money on the cloud test project only.

IDs continue the audit list in `docs/UPGRADE_PLAN.md` (P2-1 to P2-20). Severity: **High** = a rule of the product does not hold; **Medium** = wrong or confusing behaviour a tester will hit; **Low** = rough edge; **Info** = nothing to fix now, written down so it is not forgotten.

Status words: **Fixed (in the working copy)** means the change is written and tested here but not pushed or deployed (rule 7: nothing goes out until you ask). **Needs you** means it waits on a decision or a click.

## How it was attacked

| Method | What it did | Where |
|---|---|---|
| Hostile calls to the app's door (`api`) | 12 groups, about 250 probes: strangers calling other people's jobs, double spends by firing the same call 5 or 6 times at once, bad amounts, bad dates and places, odd text, other people's data, promotions, support tickets, rate limit | `e2e/breakit.spec.ts` tests 1 to 11 |
| Direct database access with a normal login | read every table and write to the sensitive ones through the public REST address, the way a script would, and call the staff-only SQL functions | test 7 |
| The other functions | forged payment webhooks, the job runner without Inngest's signature, payment and payout functions as an ordinary person, phone and password sign-in with bad input and 14 wrong passwords | test 12 |
| A monkey | taps and types at random through the real web app for 4 minutes at a time as Asha and as Meera, writing down every error, failed request and blank screen | `e2e/monkey.spec.ts` |
| A person's walk | the full job (post, offer, accept and pay, start, chat with a photo, proof, done, approve) on web at phone size (poster) and desktop size (worker) | by script, notes below |
| Admin | all 33 list pages and the 3 detail pages signed in as the owner's admin account: every page opens with data and no error | Chrome |

Run again any time: `BREAKIT=1 npx playwright test e2e/breakit.spec.ts` (PowerShell: `$env:BREAKIT=1; npx playwright test e2e/breakit.spec.ts`) (needs `npm run web:export` first). It prints every probe that got through and writes `e2e/.out/breakit.json`.

## What held (good news)

- **Money cannot be doubled or lost.** Six simultaneous `lockBid` calls locked once and charged once. Five simultaneous `confirmRelease` paid the worker once. Five simultaneous `cancelTask` refunded once. Six simultaneous full-balance withdrawals: at most one went through, balance never below zero. A withdrawal cancelled twice refunded once.
- **Strangers cannot touch other people's jobs or money**: 13 operations tried as an outsider, 4 as the wrong side, all refused. Other people's offers, chat, proof, phone numbers, wallet, payouts and notifications are not readable. (Checked row by row, not just by status code.)
- **The database is closed to direct writes.** Wallet, ledger, payments, roles, other people's profiles and tasks, bids, assignments, payouts, reviews, notifications, messages, settings and app controls: every direct write attempt was refused. No staff-only SQL function runs for a normal login.
- **Webhooks and the job runner** refuse unsigned or wrongly signed calls.
- **Payment function**: negative, tiny, huge and text amounts, a stranger paying someone else's task, an invented refund: all refused.
- **Sign-in**: bad phone numbers, broken JSON, a code nobody asked for: refused. Fourteen wrong passwords: throttled.
- **Rate limit**: 90 writes in a burst were cut off at the budget.
- **Maps work on the phone**: the Google map and pin screen drew its tiles on the owner's phone (2026-10-24), so TASKDROP-4 (Android Maps key) looks fixed.

## Findings

### Needs a decision from you

**P2-21 (High, fix written, one question left) A job's exact address is public to every signed-in person.** When a poster types the flat, building and landmark, the whole line (`Flat 402, Test Towers, Road 5, Near the park, Madhapur…`) is stored in `tasks.loc_label`, and any signed-in account can read it (proved: Meera, a stranger, read Asha's open job's full address). The app only *hides* it on screen with a rule (`roughPlace`), and the coordinates are protected by migration 074; the typed address is not. Product rule: "only the area name shows until a worker is chosen; the exact address unlocks when work starts."
**Fixed in the working copy (2026-10-25), in a way the old app is not hurt by:** migration 126 adds `task_private.address` and a function only the poster can call; the upgraded `api` function now publishes only the area as the label (the same rule the screens used, copied to `_shared/place.ts` with a sync test) and stores the typed line there; `getTaskDetail` hands the line to the poster and the hired worker only; the manage screen shows it to the poster and the active-job screen shows it to the person hired in a small "WHERE" card (new, please look at it). Profile places get the same treatment (area only). Proved: SQL test `private_task_address.test.sql` (rolled back on the test project) and 61 api tests. **Left, on purpose:** posts made by the *old* app (it writes the label itself) stay public until Phase 9, and the addresses already stored on existing test tasks stay as they are until you say a backfill is fine. Not applied, not deployed.

**P2-34 (Medium) The smallest price. Decided by the owner 2026-10-25: ₹20, for a task and for an offer.** `₹0` offers and requests were accepted. Now `PRICE_LIMITS.MIN_MINOR = 2000` in `packages/rules` (copied to the server's `_shared/rules.ts`, with a test that the two match); the `api` function refuses less with "The smallest amount is ₹20."; the post screen's slider, chips and Continue button, the offer sheet and the quote stepper start at ₹20. A service listing may still start at 0 while it is being set up.

**P2-35 (Low) Approve and release asked nothing. Decided by the owner 2026-10-25: add a confirm step.** The button now opens "Release the payment?" (the amount, "it cannot be taken back", buttons "Yes, release payment" and "Not yet"); only the yes releases the money (`ActiveScreen.tsx`).

### Fixed in the working copy (not pushed, not deployed)

| ID | Sev | Problem | Fix |
|---|---|---|---|
| P2-22 | Medium | A review could be written as soon as work started, before anything was delivered (a poster could rate a worker the moment they started) | migration 125 (`submit_review` needs COMPLETED or AUTO_COMPLETED) and `supabase/tests/review_after_completion.test.sql`. Ran the test in a rolled-back transaction on the test project: all assertions pass. The migration is not applied |
| P2-23 | Medium | **Web address search never reached the server**: the browser blocked the `places-search` call (its answer to the browser's pre-check did not allow the `x-region` header the app sends), so every web search fell back to OpenStreetMap and gave worse answers (typing "Madhapur" offered villages in other districts first) | added `x-region` to that function's allowed headers; `supabase/functions/_shared/cors.test.ts` now fails if any of the four app-called functions drops it. Needs the functions deployed. Also: the server's point-to-name lookup returned nothing for Hyderabad, and the failure was silent; it is now logged |
| P2-24 | Medium | Nonsense accepted: offer or request price of 0, a deadline in 1999 or year 9999, a place at latitude 999, usernames `admin`, `support`, `taskdrop`, `official` | `api/writes.ts` refuses each; unit test added (60 api tests pass). Service listings may still start at 0 |
| P2-25 | Medium | The "no phone numbers in posts" rule was skipped by Hindi/Arabic digits (९८७६…), keycap emoji (9️⃣8️⃣…) and eight spelled-out digits ("nine eight seven…") | `normalizeDigits` added to the app's rule and the server copy; sync and new cases in `contacts.test.ts`. Ordinary counting ("one or two people, three hours") is not caught. Writing a number with typos or other tricks can still get through; that cannot be fully closed |
| P2-26 | Low | A request body of `null` made the `api` function answer 500 | answers a clean 400 |
| P2-27 | Medium | After sending an offer the worker landed on "My offers" with the empty first tab ("Services": "Nothing here yet. Offers you send show up here"), while the offer sat under Pending. It looks like the send failed | the screen opens on the first tab that has something until the person picks one |
| P2-28 | Medium | "Distance" on a job showed the distance to the *poster's saved home*, not the job (2,368 km for a job round the corner, because the seed poster lives in Thailand) | uses the job's own place; "Remote / online" when it has none |
| P2-29 | Low | On a computer, Enter in chat did nothing (only the arrow button sent) | Enter sends, Shift+Enter is a new line (web only) |
| P2-43 | Medium | **Admin idle sign-out: one pass, one miss.** Test 1 (signed in 05:59 UTC, left 32 minutes on the dashboard, then clicked a menu item): not signed out, the page opened. Test 2 (31 minutes untouched): the page sent itself to the sign-in screen by the time I looked (the live panel's once-a-minute read got a 401). So the timeout works at least some of the time; why test 1 did not fire is not known (the middleware reads right; the free Vercel log window is 1 hour and shows no error). Second problem, fixed in the admin working copy: that redirect dropped the words "You were signed out after 30 minutes without activity", so the person saw a plain sign-in page (`LiveProvider.tsx` now passes the middleware's message). Open: a third timed test, ideally with the page in front the whole time |
| P2-45 | Low | `phone-auth` quietly cleaned `9876543210; drop table users` into a phone number and sent it a code | anything but digits, spaces and `+ ( ) . -` is refused |
| P2-46 | Low | The Android build asked for three permissions the app never uses (`SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`, `USE_FINGERPRINT`); found reading the beta APK's manifest (T11.2) | blocked in `app.json`; takes effect in the next native build |
| P2-47 | Low | The admin audit log called every staff action "event / Changed event" | plain words ("Warned a person", "Closed a report as acted on", "Hid a message"...) and a "Staff actions" filter |
| P2-44 | Low | A withdrawal request took 0.8 to 1.6 s (target under 1 s, measured from this PC): the answer waited for the second function that hands the payout to RazorpayX | the hand-off now runs after the answer is sent |
| P2-30 | Low | Money shown without paise: ₹82.40 read "₹82", so a wallet line and the price did not add up | whole rupees stay whole, paise show when there are any |

### Left as they are (written down)

| ID | Sev | What |
|---|---|---|
| P2-31 | Info | **Launch blocker, already known:** `dev_otp_for_all` is on, so asking for a code returns it in the reply and any phone number can sign in as that person. I saw it again: a request for `9876543210; drop table users` was cleaned to `9876543210` and answered with a code. It must be off before real customers (it is also readable by any signed-in person through the `settings` table, together with `admin_require_mfa`; only the first matters) |
| P2-32 | Low | `profiles.payout_upi` (an old column) is readable by every signed-in person. No profile has a value in it today, and the new payout screens do not use it. Removing the column from public reads would break `select *` for the old app, so it waits for Phase 9 |
| P2-33 | Info | Every signed-in person can list all profiles with their saved place (rounded to about 1 km) and "last seen". The rounding is by design (migration 074); "last seen" feeds the "Active now" dots. Product choice, not a bug |
| P2-36 | Medium (test only) | **Razorpay test mode allows only 30 payment links, and I used them**: every tap on Add money makes a new link even for the same amount, and the function answers a clean 502 when Razorpay refuses. I could open the Razorpay page (test mode, ₹500, "NADIMPALLI LAKSHMI NARASIMHARAJU" as the merchant name) but not finish a top-up. Two things for you in the Razorpay dashboard: delete or expire the old test links, and **check that UPI is switched on for the account**, because the checkout offered Cards, Netbanking and Wallet and no UPI at all (UPI is the main method in India) |
| P2-37 | Low | The slide-to-start handle is the only way to start a job: no tap, no keyboard, nothing a screen reader can use. Add a "Start" button as well |
| P2-38 | Low | On a job's progress list, "Offer accepted" shows the time the *offer was sent*, not accepted (10:59 pm, with "Payment held" at 11:01 pm) |
| P2-39 | Low | The offers screen says "Names and phone numbers are shared once the work starts", but the worker's name is already shown |
| P2-40 | Low | A proof text of fewer than 10 characters fails with "Please check what you entered" from the database; the button is greyed on the phone and the web, but a direct call gets the vague message |
| P2-41 | Info | The monkey and a person both see the same wait: a job opened from "My Work" shows two grey boxes for about a second |
| P2-42 | Info | `profiles` readable, `settings` readable and `get_app_controls` callable signed out are already accepted in `docs/audit/SECURITY_FINDINGS.md` (P2-9) |

### Test-data tidy-up (needs your OK before I touch it)

- Asha's wallet fell from ₹5,000 to about ₹1,500–2,700 (a lot is "frozen" in finished test jobs); Ravi has 120+ unread notifications; the feed carries about 30 `[e2e]` and `[e2e-break]` tasks (two of them, `[e2e] contact rule`, carry a phone number from before Phase 3). `npm run seed:reset` puts the three accounts back; it needs your OK.
- My probe renamed Meera's username to `meera_e2e` (it was `seed_…`). The reset undoes it too.

## Live check after the merge (2026-10-25)

Pull request 77 was merged into `redesigned-2.0` and deployed (migrations 125 and 126 applied, functions and web live). The attack suite was run again against the deployed project: **269 probes held, 18 flagged**, and every one of the 18 is explained and not a defect: a second review edits the same review; removing someone else's payout destination answers "done" and changes nothing (the destination was still there); hostile titles are stored as text and drawn escaped; `payout_upi` is the legacy column (empty for everyone); messages, offers and assignments were flagged by a rough test and checked row by row (nothing outside the person's own jobs); the RazorpayX webhook and payouts answer "not set up" and touch nothing until RazorpayX exists; one phone number cleaned out of SQL text (fixed afterwards as P2-45). The probes that the first run flagged as real findings (review before approval, price 0, past deadline, latitude 999, reserved usernames, spelled-out and other-script phone numbers) now get through nowhere. The exact address check passed live: a stranger reads only the area; the poster and the hired worker read the full line; a stranger reading `task_private` directly gets nothing.

## Not done in this pass, and why

- **Android phone**: the phone was in use and then unplugged during the run. Needs the phone plugged in and left alone; see the questions at the end of the chat.
- **Admin at phone width**: the Chrome window would not resize through the tool. Open the admin on your phone and tell me anything that overflows, or I use a headless browser once you give me a way to sign in.
- **Admin idle sign-out (manual 3.7)**: tested twice on the preview admin, see P2-43.
