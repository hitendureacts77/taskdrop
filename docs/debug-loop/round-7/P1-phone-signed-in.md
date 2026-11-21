# P1 - Signed-in phone bug hunt (round 7)

Device: CPH2585 (serial 56b2717c), screen 1080x2376. App com.taskdrop.app 1.1.0 (preview build, last updated 2026-11-15). Backend: staging (orange "Staging: fake money and fake data" bar shown on launch). Started 2026-11-16 ~2:45 pm phone time.

Screenshots are saved in `docs\debug-loop\round-7\shots\` as P1-n.png.

## What I walked

| Screen | Asha Hire | Asha Earn | Ravi Hire | Ravi Earn |
|---|---|---|---|---|
| Sign-in phone + code (Test mode box) | bug P1-1, P1-2, P1-7 | - | ok | - |
| Google chooser opens | not reached | | | |
| Home | bug P1-3 | bug P1-3 | ok | bug P1-13 |
| Explore / Find work map + list | ok (location sheet P1-12) | bug P1-4, P1-14 | not reached | bug P1-14 |
| Find work filters | - | bug P1-5 | - | not reached |
| Task detail | ok | ok | not reached | not reached |
| Post-a-task flow (8 steps, posted) | bug P1-6, P1-9 | - | - | - |
| My Tasks / My Work + search | bug P1-8, P1-10, P1-15 | ok | not reached | ok |
| Offers (compare, selected) | ok | - | - | - |
| Messages list + chat | ok | not reached | not reached | not reached |
| Notifications | ok | not reached | not reached | not reached |
| Wallet (top-up, withdraw look) | ok (Withdraw silent, P1-16) | not reached | not reached | ok (look only) |
| Profile, Terms/Privacy | ok | not reached | not reached | not reached |
| Settings, theme, edit profile | ok | not reached | not reached | not reached |
| Sign-out then sign-in again | ok | - | ok | - |
| Back button on each screen | bug P1-4 | bug P1-4 | not reached | not reached |
| Deep links | bug P1-11 | - | - | - |
| Offline then recover | ok | - | - | - |
| Rotation | ok (stays portrait) | - | - | - |
| Keyboard over inputs | bug P1-1, P1-6 | - | - | - |
| Force-stop and cold restart | ok | - | - | - |
| Crashes (logcat crash buffer, com.taskdrop) | none found | | none found | |
| Push permission prompt | not reached ("Turn on alerts" card seen, not tapped) | | | |

## Findings (running list)

### P1-1 Sign-in code step: on-screen keyboard hides the Test mode code
- Screen: Sign-in, code step ("Good to see you again")
- Signed in as: not yet (guest), number 9990000001 (Asha)
- Steps: Home (guest) > Sign in > type 9990000001 > Text me a code.
- Expected: the yellow Test mode box shows the code and it is auto-filled (or at least visible above the keyboard).
- Actual: the code boxes open empty with the keyboard up. The Test mode box shows "Test mode: no SMS is sent. Type this code." and the code digits themselves sit under the keyboard; a "Test code shown below" tip also overlaps the box. I had to press Back (hide keyboard) to read the code (385347), then type it. Code was not auto-filled.
- Severity: Low (staging only, but every tester hits it on first sign-in)
- Screenshot: shots\P1-1.png

### P1-2 Phone field mangles fast typing (unconfirmed, may be an adb artefact)
- Screen: Sign-in phone step
- Steps: `adb shell input text 9990000001` (instant typing) into the phone field.
- Expected: 99900 00001.
- Actual: field showed 80999 00000, and the app jumped to the date-of-birth "New account" step for the wrong number. Typing the same digits one key at a time gave 99900 00001 correctly. Real people type fast too, so a formatter that drops/reorders digits when several arrive quickly is worth a look.
- Severity: Low (unconfirmed)
- Screenshot: none saved (replaced by P1-1 flow)

### P1-3 Floating "+" button covers content
- Screen: Hire Home (text in "Only on TaskDrop" card, "~price" in "Busy on TaskDrop" rows) and Earn Home (first job card's Apply button)
- Signed in as: Asha, Hire and Earn
- Steps: open Home at rest / scroll to the Local Checks row.
- Expected: nothing important hidden under the button.
- Actual: the blue/green drop "+" sits over the right end of the sentence "you pay o..." and over the "Apply" button of the first job card on Earn Home (the Apply label is cut to "App'"); it also hid the price total of a Busy row while scrolling.
- Severity: Medium for the Apply case (primary action partly covered), Low otherwise
- Screenshot: shots\P1-3.png (Earn Home)

### P1-4 Back on the Find work tab leaves the app
- Screen: Find work (map, with a job card open and also with no card)
- Signed in as: Asha (Earn)
- Steps: Home > Find work > press Android Back.
- Expected: Back goes to the Home tab first (or closes the open card), then exits on the next press.
- Actual: one Back press exits TaskDrop straight to the previous app (Android Settings in my case). Also with a job card open the first Back (from the task detail) correctly returned to the map card, but the next Back exited the app instead of closing the card.
- Severity: Low
- Screenshot: none

### P1-5 Price filter min greater than max is silently swapped
- Screen: Find work > Filters > Price
- Signed in as: Asha (Earn)
- Steps: pick 300-1,000, then type Max = 100 (Min stays 300).
- Expected: an inline error or the Min field adjusting.
- Actual: header says "Price . 100-300" and "Show 8 jobs" while the boxes still read Min 300 / Max 100. The label and the boxes disagree.
- Severity: Low
- Screenshot: shots\P1-5.png

### Notes (not bugs)
- Staging banner "Staging: fake money and fake data" shown on every screen; Test mode box seen at sign-in. Safe to continue.
- Device location is OFF on the phone; Find work shows the "Turn on location" sheet with "Type my area instead" / "Not now" and works fine after Not now (area Madhapur).
- Job list titles and meta lines truncate with an ellipsis (for example "by @sandeep_10 . La..." hides "Last seen"). Cosmetic.

### P1-6 Budget step: typed price is shown without the rupee sign and the page jumps
- Screen: Post a request, step 5 Budget (Asha, Hire)
- Steps: tap the "Rs 0" price, type 5, 0.
- Expected: "Rs 50" stays in the same big card with the keyboard below.
- Actual: with the keyboard up the card scrolls under the header (the "TASK PRICE" label is cut off at the top), the amount reads plain "50" (no rupee sign, unlike the empty state "Rs 0"), and the Back / Continue buttons sit right above the keyboard. Works, but looks broken.
- Severity: Low
- Screenshot: shots\P1-6.png

### P1-7 Dead "Test code shown below" toast and "Request a code first" after sign-in
- Screen: Sign-in code step then Hire Home
- Steps: after the code step I used the on-screen Test mode code; two grey toasts appeared at the bottom: "Test code shown below" (while on the code step) and, after the correct code was accepted and the app was already signed in on Hire Home, "Request a code first" (toast stayed over the Home content for several seconds).
- Expected: no error toast after a successful sign-in.
- Actual: a stale "Request a code first" toast is shown on top of Home after signing in successfully. Probably a late duplicate verify call (an earlier auto-verify attempt).
- Severity: Low
- Screenshot: none (seen in a screenshot after sign-in; see note in P1-1)

### P1-8 My Tasks shows an empty "0 / 0 / 0" card and two grey skeletons for ~4-6 s
- Screen: My Tasks (Hire), signed in as Asha
- Steps: tap My Tasks right after signing in.
- Expected: skeletons are fine, but the top summary card should not claim 0 Active / 0 To review / 0 Completed and "Open 0 / In progress 0 / Completed 0" while loading.
- Actual: zeros for roughly 5 s, then it jumps to 46 Active / 27 Completed and a "Get told when offers arrive" card pushes content down (layout jump).
- Severity: Low (slow screen > 3 s)
- Screenshot: none

### P1-9 "Post my request" threw a signed-in user back to the sign-in screen
- Screen: Post a request step 8 Review (Hire), signed in as Asha
- Steps: signed in as Asha, walked the 8 steps for "ZZ P1 test 1455", tapped "Post my request" at 2:57.
- Expected: task is posted and the poster lands on the task page.
- Actual: the app showed the full-screen sign-in page ("Get help, near or far") without any message; the task was NOT created. After signing in again (code step, Test mode code visible) the app opened on Home; the draft survived and I posted it from the draft three minutes later (that is the only P1 task, see "Left on staging"). Likely cause: the session was invalidated while I was in the wizard (another test job signing in as Asha at the same time, or a 401 on the post call treated as "signed out"). I could not tell which. Either way a person who loses their session at the final step gets no explanation.
- Severity: High if it can happen without another login on the same account; Medium otherwise.
- Screenshot: shots\P1-7.png

### P1-10 Empty-search message in My Tasks says "Create your first task"
- Screen: My Tasks (Hire), Open tab, search box
- Steps: type "ZZ P1" while no task matched.
- Expected: "No tasks match ZZ P1".
- Actual: "No open tasks - Create your first task to start getting work done" with a Create task button, although the account has 19 open tasks.
- Severity: Low
- Screenshot: none

### P1-11 https://taskdrop.in links do not open the app
- Screen: Android deep links
- Signed in as: Asha
- Steps: `adb shell am start -a android.intent.action.VIEW -d https://taskdrop.in/privacy com.taskdrop.app`
- Expected: the app opens (Terms/Privacy screen) or the link is at least resolvable by the app.
- Actual: "Error: Activity not started, unable to resolve Intent ... pkg=com.taskdrop.app". Without the package the link opens Chrome. `dumpsys package` shows the app registers only the scheme `taskdrop`; there is no https App Link for taskdrop.in. `taskdrop://privacy` and `taskdrop://wallet` are accepted (intent delivered) but the app stays on the screen it was on and does not navigate.
- Severity: Medium (shared task links from the web cannot open the installed app; consistent with the no-App-Links setup, but a product gap for "share task" which exists on task pages)
- Screenshot: none

### P1-12 Location sheet comes back on every cold start and every Explore visit after a restart
- Screen: Explore (Hire) after force-stop
- Steps: tap "Not now" on the location sheet, force-stop, reopen, go to Explore.
- Actual: the full-height "Turn on location for the best Explore experience" sheet shows again, covers half the map, and prints "Location is switched off on this device" before anything was tapped. Fine once, but it nags every launch for a user who said Not now.
- Severity: Low

### Checks that passed (signed in as Asha)
- Offline (wifi + data off): Wallet shows dashes, "Could not refresh your wallet", and "Couldn't load your transactions. Check your connection and pull down to try again." My Tasks keeps its cached list. After re-enabling wifi+data and 8 s the Wallet recovered by itself (Rs 18 / Rs 8,034 held, transactions list back). Network left ON (cellular validated, wifi on).
- Force-stop and cold start: still signed in as Asha, opens on Hire Home, theme and mode kept. (Draft post also survived a sign-out/in, see P1-9.)
- Rotation: forcing landscape (user_rotation=1 with auto-rotate off) did nothing; app stays portrait. Auto-rotate restored to ON afterwards.
- Chat: keyboard does not cover the message box; send button turns green when text is typed. I did not send.
- Back button: task detail > offers > Back x3 returns task offers > task detail > My Tasks correctly. Account & settings Back returns to Profile.
- Theme: System/Light/Dark switch applies immediately in Profile; restored to System.
- Edit profile: clearing the Display name and pressing Back shows the hint "Add a display name" and leaves the old name on Save (not saved).
- Wallet withdraw (Asha, Rs 18 available, min Rs 100): Withdraw button looks disabled and tapping it does nothing and shows no message. Low: say why ("Minimum Rs 100").
- Notifications: Unread (16) list, task-cancelled items, "Ravi offered Rs 100" opens the right task; "Mark all read" not pressed (left unread on purpose).

### P1-13 Earn Home asks "Set your location" although Hire Home already shows Madhapur
- Screen: Home, signed in as Ravi (Earn vs Hire)
- Actual: Hire shows "Madhapur"; Earn shows "Set your location - To show jobs near you", skeleton for "Matches your skills" and "Jobs near you - Set your area". Location is kept per mode (or not shared), so a user who already set an area is asked again.
- Severity: Low

### P1-14 Map labels overlap on Find work
- Screen: Find work map (Ravi Earn, also Asha Earn)
- Actual: area labels "Botanical Gard... +4 . 5 jobs", "Narsingi +10", "Your area" and the price bubble (Rs 4,750) overlap and are partly unreadable; the zoom +/- buttons sit over a price bubble at the right edge.
- Severity: Low
- Screenshot: shots\P1-14.png

### P1-15 My Tasks list does not refresh after closing a task
- Screen: My Tasks (Asha Hire)
- Steps: tap the three-dot menu on my test task > Close task > "Yes, close task".
- Expected: the task leaves Open and counts update.
- Actual: dialog closes, nothing changes (Open 20, task still listed, 47 Active). After a pull-down refresh it is gone (Open 19, 46 Active). No toast confirms the close.
- Severity: Low-Medium
- Screenshot: none

### P1-16 Withdraw with Rs 18 does nothing and says nothing
- Screen: Wallet (Asha)
- Actual: Withdraw is greyed but tappable; tap gives no message. The hint "Min. withdraw Rs 100 . UPI" is the only clue.
- Severity: Low

## Left on staging
- Task "ZZ P1 test 1455" (Rs 50, remote) posted by Asha, then closed from My Tasks (Close task). A first attempt at 1459 (second post try) was abandoned before posting, nothing created.
- Notifications left unread. Asha profile display name unchanged. Theme restored to System.
- Phone ended signed in as Ravi (9990000002), network re-enabled (wifi + data on), auto-rotate on.

---
# Round 2: Meera only (9990000003), after the coordinator's message about W3 sharing Asha/Ravi

## P1-9 retest (thrown to sign-in at "Post my request")
Result: did NOT reproduce. Signed in as Meera, posted a task through all 8 steps ("Post my request", then the one-time "Staying safe on a job" sheet, then "Got it, post my request"); the task page opened. No sign-out at any point in about 35 minutes of use (tab changes, a Razorpay open, notification prompt, a task close). logcat was cleared before the Meera sign-in and shows no crash. The release build writes no JS or auth lines to logcat, so there are no log lines to attach.
Conclusion: P1-9 was most likely the session being replaced by W3's web sign-ins as Asha/Ravi. Downgrade P1-9 to Low / unconfirmed. Possible small improvement: if a session is replaced, say "You were signed out because you signed in somewhere else" instead of a silent jump to the sign-in page (this is my guess at the cause; I did not verify it).

## What round 2 walked (Meera)
| Screen | Result |
|---|---|
| Google chooser (tap Google on sign-in, close with X) | ok: the chooser opens (it lists the phone's own accounts; I chose none), closing returns to sign-in. See P1-22 |
| Phone sign-in as Meera | ok (Test mode box + code shown; same keyboard note as P1-1) |
| Earn Home, task detail, offer screen (Price only / Price + proposal, up to but not including Send) | ok; keyboard does not cover the proposal field. Offer NOT sent |
| Messages list and one chat | ok (threads list; chat shows "Contacts unlocked"; nothing sent) |
| Notifications (empty, then the cancel notice) | ok |
| Profile, Help & support, Account & settings (You / Sign-in / App tabs), theme row, Terms/Privacy | ok (see P1-23, P1-24) |
| Wallet (Earn): balance Rs 500, Add money sheet, open Razorpay | bug P1-17 |
| Post a task as Meera, all 8 steps, posted | ok |
| Task manage screen (Overview, Worker offers, three-dot menu, Close task) | bug P1-18, P1-19 |
| Push permission prompt (Turn on alerts card) | system dialog opens; see P1-25 |
| Rotation | ok: app stays portrait by design (requestedOrientation=SCREEN_ORIENTATION_PORTRAIT); `user_rotation=1` with auto-rotate off changed nothing. Restored: accelerometer_rotation=1, user_rotation=0 |
| Map / location (Explore as Meera Hire, Find work as Ravi Earn) | bug P1-14 (earlier), P1-20, P1-12 (earlier) |
| Crashes | none (`logcat -b crash` has nothing for com.taskdrop) |

## More findings

### P1-17 "Add money" fails: "Could not start the payment"
- Screen: Wallet > Add money (Rs 500), Meera in Earn mode
- Steps: Wallet > Add money > tap Rs 500 > "Add Rs 500".
- Expected: the Razorpay test checkout window opens (I would stop there, not pay).
- Actual: the button says "Opening..." for about 8 s, then the red line "Could not start the payment" appears and the button becomes "Pay Rs 500". No Razorpay window ever opened, so top-up cannot be tested on this phone build. No logcat lines either. Either the order-create call failed on staging or the Razorpay native module does not work in this preview build. The error gives the user no next step.
- Severity: High (top-up is the entry to every paid task). A developer should check the `razorpay` function and the build's key.
- Screenshot: shots\P1-17.png

### P1-18 Manage screen: status chips are cut off at the top
- Screen: Task manage screen (My Tasks > Open), Meera, Hire
- Actual: the "OPEN" and "CHOOSE FROM OFFERS" chips under the title are clipped at their top edge by the header (flat tops, text near the cut), on both the Overview and Worker offers tabs.
- Severity: Low
- Screenshot: shots\P1-18.png

### P1-19 Manage screen does not update after "Close task"
- Screen: Task manage screen after Close task (Meera). Same pattern as P1-15 on the list.
- Steps: three-dot menu > Close task > Yes, close task.
- Expected: status becomes Cancelled, buttons change, or the app returns to the list with a toast.
- Actual: the dialog closes and the screen is unchanged (OPEN chip, "No offers yet", "Waiting for offers"). Only a push banner "Task cancelled" appears about a second later. Back to My Tasks still lists the task until I pull down to refresh. Also, the three-dot sheet says "Everything you paid comes back, fee included" while the confirm dialog says "This can't be undone"; the first is about money, the second about the task, but together they read as contradictory.
- Severity: Medium (people will tap Close twice)
- Screenshot: none saved (see P1-18 for the screen)

### P1-20 "Your area" pill overlaps the cluster label and avatars on the map
- Screen: Explore map (Hire, Helpers), Meera
- Actual: the white "Your area" chip sits on top of the bottom of the "+50" avatar stack and the top of the "Madhapur +19 . 53" label, so both are partly unreadable. Same on the small map in the Explore list view (chip over "Madhapur +3 . 12"). The +/-/compass column sits over the right edge, and in the list view the "Pins sit in their area" banner covers the bottom of the map including the Google logo. No map tuning done, observation only.
- Severity: Low-Medium
- Screenshot: shots\P1-20.png

### P1-21 X in the post wizard silently saves a draft; the draft's X deletes without asking
- Screen: Post flow ("Create similar") and My Tasks drafts
- Actual: tapping X in the wizard saves a draft ("Saved to Drafts in My Tasks" toast) without asking keep or discard. On My Tasks the draft's X removes it at once with no confirmation or undo. The X reads as "discard" but the first X does the opposite, and the second deletes with no undo.
- Severity: Low

### P1-22 Google button spins for about 6 s after cancelling the chooser
- Screen: Sign-in
- Actual: after closing the Google chooser with X, the Google button keeps a spinner for about 6 s before it is usable again.
- Severity: Low

### P1-23 Meera's display name is a template-injection test string (info, not an app bug)
- Screen: Profile and Account & settings (You tab), Meera
- Actual: the display name is `${7*7}{{7*7}}<%= 7*7 %>`. It renders as plain text everywhere I saw it (no evaluation; the profile header truncates it with an ellipsis). It is leftover test data from a security job. Listed so nobody files it as a bug; the avatar letter is "$".

### P1-24 Settings > Sign-in: password boxes have no show/hide
- Screen: Account & settings > Sign-in
- Actual: NEW PASSWORD and CONFIRM PASSWORD have no eye icon to reveal the text; "At least 8 characters." sits under the second box only.
- Severity: Low

### P1-25 Notification permission reads "granted" after I tapped "Don't allow" (unconfirmed)
- Screen: My Tasks > "Get told when offers arrive" > Turn on alerts
- Steps: tap Turn on alerts; the Android dialog "Allow TaskDrop to send you notifications?" appears; I tapped "Don't allow".
- Actual: the card disappears (expected either way). Afterwards `dumpsys package` lists `POST_NOTIFICATIONS: granted=true, flags=[USER_SET...]` and the "Task cancelled" push banner did appear. I cannot tell whether my tap landed on Allow or the phone keeps the permission granted from an earlier session. Re-test on a clean install.
- Severity: Low (unconfirmed)
- Screenshot: shots\P1-21.png (the dialog)

### P1-26 Sign-in, number step: the keyboard covers the mobile-number box (found 16 Nov, evening)
- Screen: signed-out sign-in, first step, Android phone (CPH2585), keyboard on
- Steps: sign out, tap the number box, type 9990000003.
- Actual: the box sits under the tall picture and the keyboard covers it, so the digits are typed blind. After closing the keyboard the digits were exact (9990000003) and the check mark showed.
- Expected: the box scrolls above the keyboard when it gets focus.
- Severity: Medium
- Status: **Fixed in PR 395 (merged), not published to the phone yet** (the number box is wrapped in `RevealWhen`). Recheck on the phone after the update.

### P1-27 Sign-in, code step: the Test-mode code stays under the keyboard; `RevealWhen` never scrolled on Android (found 16 Nov, evening)
- Screen: signed-out sign-in, code step, Android phone, keyboard on (the six code boxes were visible; the yellow Test-mode code box was cut off under the keyboard)
- Actual: the page scrolls by hand (the code was reachable after a swipe), but the automatic scroll never ran, two screenshots 2 s apart.
- Suspected cause (not yet proven on the phone): `RevealWhen`'s wrapper View has no style, so Android can leave it out of the native view tree and `measureInWindow` never calls back. Every screen that uses `RevealWhen` may have had the same fault.
- Severity: Medium (High for testers, who need the Test-mode code)
- Status: **Fixed in PR 396 (merged), not published to the phone yet** (`collapsable={false}` on the wrapper). If it is still hidden after the update, the cause was something else and this stays open.

### Process note (not an app bug)
While I was on the manage screen, a Microsoft Teams message banner from another app slid down over the top of TaskDrop and my tap opened that Teams chat. I did not read or record it, pressed Back at once and relaunched TaskDrop. Do Not Disturb during phone tests would prevent this.

## Left on staging (final)
- Asha: "ZZ P1 test 1455" (Rs 50, remote), posted and closed (cancelled) in round 1.
- Meera: "ZZ P1 test Meera remote task to write a short note" (Rs 50, remote), posted and closed (cancelled); the draft copy made by X was discarded. Meera has one unread "Task cancelled" notification, left unread on purpose.
- No profile, theme or setting changed for Meera. No offer, chat message or payment was sent; the failed Add Rs 500 (P1-17) opened no Razorpay window and moved no money.
- Phone: signed in as Meera (9990000003), Hire mode, network ON (wifi + data), auto-rotate ON (accelerometer_rotation=1, user_rotation=0).
