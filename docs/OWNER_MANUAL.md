# TaskDrop owner manual: what to click, phase by phase

This is your part of `docs/UPGRADE_PLAN.md`, written as clicks. Start with **START HERE** below: it lists what is left, in order. Then open the task it points to. Tick a task's box when you finish it. Last updated 2026-10-25.

## How to read this manual

Every step is one of three kinds:

- **Click:** you do it, in a browser on your PC or on your phone.
- **Type to Claude:** copy the sentence in quotes into the Claude chat. Claude does the work and tells you when it's done.
- **Tell Claude:** write what you saw in the chat (a screenshot is fine).

If a screen doesn't look like the step says (a button has another name, or isn't there), stop and send Claude a screenshot. Websites like Sentry and Google change their buttons from time to time.

**No key rotation (owner decision, 2026-10-25):** no key is rotated or regenerated as of now. Key rotation (tasks 3.2 and 6.1) is **future scope** (⏸). Skip it.

**Scope:** this manual covers the website (tested in Chrome), the Android app and the admin. **iOS and Safari testing are future scope** (iOS since 2026-10-20, Safari since 2026-10-24); they are collected at the end under "Future scope: iOS and Safari". Skip anything marked ⏸.

## Addresses you'll use

| What | Address |
|---|---|
| New app (the upgrade) | https://taskdrop.in |
| New admin (the upgrade) | https://taskdrop-admin-git-redesigned-20-hitenduteam.vercel.app (sign in to vercel.com first, or it shows a Vercel login) |
| Old app (testers today) | https://taskdrop-five.vercel.app |
| Old admin | https://taskdrop-admin.vercel.app |
| GitHub, app repo | https://github.com/hitendureacts77/taskdrop |
| GitHub, admin repo | https://github.com/hitendureacts77/taskdrop-admin |
| Supabase test project | https://supabase.com/dashboard/project/wjxvingpfbfvkfqhrguj |
| Vercel | https://vercel.com (team `hitenduteam`, projects `taskdrop` and `taskdrop-admin`) |
| Sentry | https://sentry.io (organization `hitendu`) |
| Inngest | https://app.inngest.com |
| ImageKit | https://imagekit.io/dashboard |
| Razorpay | https://dashboard.razorpay.com |
| Google Play Console | https://play.google.com/console |

## Test accounts

While testing, any phone number signs in. The code is random each time and shown in a yellow "Test mode" box on the code screen; type it in. Use these three fake accounts; they already have fake money:

| Name | Phone | Use it for |
|---|---|---|
| Asha | 9990000001 | the person **hiring** (has ₹5,000) |
| Ravi | 9990000002 | the person **working** (has ₹2,000) |
| Meera | 9990000003 | a third person when you need one |

**Two people at once:** use your **phone** as Asha and **Chrome on your PC** as Ravi. When the steps say "Incognito", press **Ctrl + Shift + N** in Chrome to open a private window, so your own sign-ins don't get in the way.

---

## START HERE: what is left, in order (checked 2026-10-25)

Claude checked everything in Phases 0 to 8 that can be checked without you (evidence: `docs/PHASE0_8_CHECK_2026-10-25.md`). **Phases 0, 1, 4, 5 (except RazorpayX) and 7 are finished.** What is left needs you (a login, a payment, a decision), your phone, or time. Do these in order; each one points to the full clicks lower down.

| # | What | Who | Time | Full clicks |
|---|---|---|---|---|
| 1 | **Fix Google sign-in.** It is down for everyone (the Google login key behind it was deleted). Phone-number and username sign-in still work. | You | 15 min | Task 0.1 |
| 2 | **Phone session.** Unlock the phone, plug it in, say "install the new beta and run the phone checks". Claude installs the build, proves App Check on Android, publishes the update for the chat-photo viewer, runs the Android half of the job test, and merges the App Check PR. | You say go; Claude does it | 30 min | Tasks 2.2, 3.5, 6.3 |
| 3 | **Two values in the admin's Vercel project** (the ImageKit photo values), so the admin shows job photos. | You | 5 min | Task 6.4 |
| 4 | **Admin idle sign-out test.** Needs step 1 first (a working admin login), then 31 minutes of waiting. | Claude, in your Chrome | 35 min, mostly waiting | Task 3.7 |
| 5 | **Your decisions:** the map for the store version, the legal details, whether profiles may show a rounded place and "last seen", and the Razorpay test-link limit. | You, in the chat | 20 min | Tasks 8.1, 8.2 and the list under "Decisions" below |
| 6 | **Google Play Console:** create the app, enter the answers, upload the store build. The store build file **expires on 2026-11-23**; after that say "build the store version again". | You | 1 to 2 hours (Google may take days to check your ID) | Tasks 8.3, 8.4 |
| 7 | **Read the runbook** and the security checklist. | You | 30 min | Tasks 8.5, 3.9 |
| 8 | **Mobile data speed test.** Switch Mobile data on in the phone's settings first. | You say go; Claude times it | 10 min | Task 6.5 |
| 9 | **A week of normal use,** then ask Claude for the slow-screen check. | You | 1 week | Task 2.6 |
| 10 | **The 12 testers** (14 days in Play closed testing). Only when you are ready. | You | 14 days | Task 8.6 |

**Also open, no rush:** the RazorpayX payout buttons (need RazorpayX, task 10.3); deleting the unused `razorpay-setup` function (say "delete razorpay-setup" and Claude does it); the app tour design sign-off (Phase 8, not built yet); Uptime Robot: look once that both monitors are green. Key rotation (3.2, 6.1), Safari and iOS stay future scope.

**Decisions waiting for you (answer in the chat, one line each):**

1. Map for the store version (task 8.1): keep OpenStreetMap while testing, or choose a paid-friendly provider before launch.
2. Legal details (task 8.2): business name, address, grievance officer name and email, courts city. The live Privacy page still shows no Grievance Officer name.
3. Profiles show a rounded place and "last seen" to other people (P2-33): keep, or hide?
4. Razorpay test mode allows 30 payment links and they are used up (P2-36). Claude cannot change Razorpay, so either wait for the limit to clear or accept that top-up is tested later.
5. The Sales tester `hitendu7@gmail.com`: remove it, and seed admin roles for other staff, or leave as is.

**Rules for the steps below:** the admin signs in only with `hitendureacts@gmail.com` (owner rule, 2026-10-25). In Google's account chooser, pick **hitendureacts**. If the chooser opens on `narasimharaju7c@gmail.com`, that account is a normal user, not an admin. In Chrome the right profile is the one at `/u/2`.

---

## Phase 0: Foundations

Phase 0 was done earlier. One new fix came up on 2026-10-25 (it was not part of Phase 0, but nothing else works well until it is done):

### ☐ 0.1 Fix Google sign-in (15 minutes) — found 2026-10-25 (P2-50)

**What is wrong:** tapping Google on the web, the Android app or the admin shows Google's "Error 401: deleted_client, The OAuth client was deleted". Supabase's Google sign-in still points at a Google login key (OAuth client) from one of the Google Cloud projects that was shut down on 2026-10-22. Claude confirmed this from outside the browser: asking Supabase for the Google login redirects to Google, and Google refuses it. Only you can fix it: it needs a new key made in your Google account and its secret entered in Supabase. This is a replacement for a deleted key, not a key rotation.

1. Click: open https://console.cloud.google.com/?authuser=2 (the `/u/2` account is `hitendureacts@gmail.com`; if Google shows a chooser, pick **hitendureacts**).
2. Click: at the top, open the project picker and choose the project named **Taskdrop**.
3. Click: left menu (the ☰) → **APIs & Services** → **OAuth consent screen** (newer layout: **Google Auth Platform** → **Audience**). Look at **Publishing status**. If it says **Testing**, click **Publish app** → **Confirm**, so it says **In production**. (In Testing mode only listed test users can sign in and the login stops after 7 days.)
4. Click: **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
5. Click: Application type **Web application**. Name: `TaskDrop Supabase`.
6. Click: under **Authorized redirect URIs** → **Add URI**, and paste exactly: `https://wjxvingpfbfvkfqhrguj.supabase.co/auth/v1/callback`
7. Click: **Create**. A box shows the **Client ID** and **Client secret**. Keep this box open. Do not paste them in the chat.
8. Click: open https://supabase.com/dashboard/project/wjxvingpfbfvkfqhrguj/auth/providers → **Google**.
9. Click: switch **Enable Sign in with Google** on, paste the **Client ID** and **Client secret** from step 7, and click **Save**.
10. Type to Claude: "Google sign-in is fixed. Test it on the web, the Android app and the admin."

If the Google Cloud page looks different, send Claude a screenshot. Don't try to bring back the old shut-down project: a new key is faster.

---

## Phase 1: See problems, ship fast

### ☑ 1.1 Make the Uptime Robot account and two monitors (10 minutes) — done 2026-10-24

1. Click: open https://uptimerobot.com
2. Click: **Register for FREE**.
3. Click: fill in your name, `hitendureacts@gmail.com` and a new password, then click the sign-up button.
4. Click: open the email from UptimeRobot in Gmail and click its confirmation link.
5. Click: in the UptimeRobot dashboard, click **New monitor**.
6. Click: Monitor type: **HTTP(s)**.
7. Click: URL: `https://taskdrop.in`. Friendly name: `TaskDrop web`.
8. Click: Monitoring interval: **5 minutes** (the free plan's setting).
9. Click: under notifications, tick your email.
10. Click: **Create monitor**.
11. Do steps 5 to 10 again with URL `https://taskdrop-admin.vercel.app` and name `TaskDrop admin`.
12. Wait 5 minutes. Both monitors should say **Up** in green.
13. Type to Claude: "Uptime Robot is set up with the web and admin monitors. Mark the api health monitor as deferred, since it needs a paid plan."

### ☑ 1.2 Add a Sentry alert for money errors (5 minutes) — done 2026-10-24

Sentry's menu changed: there is no **Alerts** item any more. Alerts are under **Monitors**. Claude did these clicks in your Chrome. To check or redo them:

1. Click: open https://hitendu.sentry.io/monitors/alerts/ and sign in.
2. Click: **Create Alert** (top right).
3. Click: under **Source**, keep **Alert on all issues in selected projects** and make sure Projects shows **taskdrop**.
4. Click: under **WHEN**, keep only **A new issue is created**. Delete the other three rows (resolved, escalates, regresses) with their bin icons.
5. Click: under **IF**, open the box that says **Any event**, type `level`, choose **Event level**, and set it to **equals** → **fatal**.
6. Click: under **THEN**, choose **Notify on preferred channel**, change **Suggested Assignees** to **Member**, and pick `hitendureacts@gmail.com`.
7. Click: the pencil next to the title at the top, and name the alert `Money fatal`.
8. Click: **Create Alert**. You should land on the alert's page with the green message "Alert created".

### ☑ 1.3 Add a Sentry alert for error spikes (5 minutes) — done 2026-10-24

In Sentry's new layout an error-count alert is a **Metric monitor**, and "Critical" is called **High priority**.

1. Click: open https://hitendu.sentry.io/monitors/ → **Create Monitor** → choose **Metric** → **Next**.
2. Click: Project: **taskdrop**. Environment: **All Environments**.
3. Click: under **Choose Your Metric**, keep **Number of Errors**. Under **Customize Metric** keep Dataset **Errors**, Interval **1 hour**, Visualize **count**. Remove the default **is unresolved** filter (the **×** on it), so every error counts.
4. Click: under **Issue Detection**, keep **Threshold**. For **High priority** choose **Above** and type `20`.
5. Click: the pencil next to the title at the top, and name the monitor `Error spike`.
6. Click: under **Alert**, **Create New Alert**. In the panel, keep only **A new issue is created** under WHEN (delete the other three rows). Under THEN choose **Notify on preferred channel**, change it to **Member** → `hitendureacts@gmail.com`. Set Alert Name to `Error spike` and click **Create Alert**.
7. Click: **Create Monitor** (bottom right). The page shows "Monitor created", with Threshold **High above 20**.
8. Type to Claude: "Both Sentry alerts are set: Money fatal and Error spike." (Claude already knows: it did them on 2026-10-24.)

### ☑ 1.4 Web source maps — done 2026-10-24 (Claude read the build log of `aa78ab9`: files bundled with debug ids, then the 6 `.map` files removed)

Claude read the last web build's log (Vercel deployment of `d49d681`): **the upload did not happen.** The log says `SENTRY_AUTH_TOKEN is not set; nothing uploaded`, because the token in Vercel is named `SENTRY_AUTH_TOKEN_TASKDROP_USERAPP` and the script only looked for `SENTRY_AUTH_TOKEN`. Web errors in Sentry (for example TASKDROP-6) still show minified stacks (`?(index)`).

Claude changed the script to accept that name. The change is committed on a local branch `fix/web-sourcemap-token`, **not pushed**. To finish:

1. Done: the fix is merged into `redesigned-2.0` (PR 69) and has been built twice since.
2. Left: Claude can't read Vercel build logs until you approve its Vercel connection. Click the link Claude gives you when you type: "Check the web build uploaded source maps." (Or open the latest `taskdrop` deployment on vercel.com and search the log for `Uploaded files to Sentry`.)

(Nothing to click in Vercel: the variable name there stays as it is.)

### ☑ 1.5 Phone source maps — done 2026-10-24

Nothing for you to do. Claude checked the EAS log of the `beta` APK (build `af47d88d`): the Sentry plugin uploaded its source maps (release `com.taskdrop.app@1.0.0+1`), because `SENTRY_AUTH_TOKEN` is set in the EAS `preview` environment. Updates sent over the air are a separate case: EAS doesn't upload their maps, so Claude uploads them by hand each time (it did for the update in task 1.6).

### ☑ 1.6 Phase 1 test session with your phone — done 2026-10-24 (Claude, phone plugged in)

**State 2026-10-24 (later):** Claude ran this with your phone plugged in. The test update reached the phone (Sentry shows its update id), test errors from web, Android and all 8 functions reached Sentry with readable stacks, a test push arrived (two test notifications may still sit in your phone's shade: swipe them away), and Uptime Robot shows both monitors Up. The admin test error was run later the same day: server and browser errors reached Sentry project `taskdrop-admin` with readable stacks. Details in the plan, v4.47 and v4.48.

1. Click: plug your phone into the PC with the USB cable. If the phone asks "Allow USB debugging?", tap **Allow**.
2. Type to Claude: "Run the Phase 1 verify. My phone is plugged in."
3. When Claude says it sent test errors: Tell Claude "OK". Claude checks they reached Sentry.
4. The update (already published, see above). To see it on your phone:
   1. Click: on the phone, open TaskDrop.
   2. Click: open the recent-apps view (square button, or swipe up and hold) and swipe TaskDrop away to close it.
   3. Click: open TaskDrop again. Close it and open it a second time (updates load on the second start).
   4. Look: in **Earn** mode, open someone else's task, tap the button to send an offer, then change the price to a different amount than the poster's. The button should now say **Send a counteroffer** (the old app said "Send an offer"). Tell Claude what you see.

---

## Phase 2: Make it work

### ☑ 2.1 Write your list of problems — done 2026-10-25 by Claude (you asked Claude to break the app and write the list): `docs/PHASE2_PROBLEMS.md`

**Result:** about 250 hostile calls, direct database attacks, forged webhooks, a random-tapping monkey and a full walk through every admin page. Money could not be doubled or lost; strangers could not touch other people's jobs. 24 problems found (one High: a job's exact address is public), 10 already fixed in the working copy and waiting for you to say "push". Your decisions are listed in the chat. The steps below are what to do if you also want to add your own items.

1. Click: open Notepad on the PC (or Notes on the phone).
2. Write one line per problem: the screen, what you did, what went wrong or felt slow. Example: `Wallet: tapped Withdraw, it spun for 10 seconds`.
3. Type to Claude: "Here is my Phase 2 list. Make a GitHub issue for each and fix them:" and paste your list underneath.

### ◐ 2.2 Run one full job on the phone and the PC — web half done 2026-10-25 by Claude; the Android phone half waits for the phone

**Done on the web (phone-sized window as the poster, desktop window as the worker):** post with a photo and a place, offer, accept and pay from the wallet, slide to start, chat with a photo, proof photo, mark done, approve (steps 5 to 15), plus a withdrawal request and cancel. All worked. Not finished: the Razorpay top-up (step 18; Razorpay test mode has a 30-link limit that was used up, and the checkout offered no UPI: see P2-36), review stars, dispute, cancel-with-fine and promote by screen (the money paths are covered by the automatic tests). **Android phone:** the phone was unplugged during the run; plug it in and say "run the job on the phone".

Follow the words on the screen when a button name differs slightly. Write down anything that goes wrong.

**Sign in both people**

1. Click (phone): open TaskDrop. If someone is signed in: **Account** tab → **Sign out**.
2. Click (phone): sign in with phone `9990000001` (Asha). Type the code shown in the "Test mode" box.
3. Click (PC): open Chrome Incognito (Ctrl + Shift + N) and go to https://taskdrop.in
4. Click (PC): sign in with phone `9990000002` (Ravi).

**Post a task (Asha, phone)**

5. Click: tap **Post** (the + button).
6. Click: write `Test: help me carry a sofa`. Add a photo. Pick a place on the map. Set a deadline.
7. Click: tap **Post**.

**Send an offer (Ravi, PC)**

8. Click: switch to **Earn** mode (the mode switch), then open **Find work**.
9. Click: open the sofa task. Tap the button to send an offer, enter `500`, and send it.

**Accept and pay (Asha, phone)**

10. Click: open **My Tasks** → the sofa task → Ravi's offer → accept it.
11. Click: pay from the wallet.

**Do the work (Ravi, PC)**

12. Click: open **My Work** → the sofa task → **Start**.
13. Click: open the chat. Send `hello`, then send a photo.
14. Click: add proof of the work (a photo), then mark it **done**.

**Approve (Asha, phone)**

15. Click: open the task → approve the work → give a 5-star review.

**Money (Ravi, PC)**

16. Click: open **Wallet** → **Withdraw**. The earnings may show as "clearing" for 7 days; that's normal.

**The other things to try once each** (any order)

17. Click (Asha): post a second task, then cancel it before anyone starts.
18. Click (Asha): **top up** the wallet with Razorpay. When Razorpay asks, choose UPI and enter `success@razorpay` (a test UPI ID; no real money moves).
19. Click (Ravi): on a new job, after it starts, open a **dispute**.
20. Click (Asha): open **Account** → edit your name and photo.
21. Click (Asha): open a task → **Promote** → pick the cheapest option.
22. Click (both): open the notifications bell and check the new items are there.

**Report**

23. Type to Claude: "I ran the full job on the phone and the PC. Here's what went wrong:" and list what broke (or "nothing").

### ⏸ 2.3 Safari (future scope, deferred 2026-10-24)

Skip this. Safari testing, like everything iOS, waits until you say "start iOS". Nothing to do now. The steps are kept in "Future scope: iOS and Safari" at the end of this manual. (The number 2.3 stays so the other task numbers don't change.)

### ☑ 2.4 Check every admin page — done 2026-10-25 by Claude in your Chrome (all 12 pages opened, data shown, no red errors)

The steps are kept for a re-run. The admin accepts only `hitendureacts@gmail.com`, and Google sign-in must work first (task 0.1).

1. Click: open https://vercel.com and sign in.
2. Click: open https://taskdrop-admin-git-redesigned-20-hitenduteam.vercel.app
3. Click: **Sign in with Google** → `hitendureacts@gmail.com`. (No authenticator code is asked; that is future scope, decided 2026-10-24.)
4. Click each of these in the left menu, one at a time: **Users, Tasks, Payouts, Refunds, Disputes, Support, CRM, Copyright, Money, Reports, Settings, Security**.
5. For each page, write: does it open, does it show data, is there a red error?
6. Type to Claude: "Admin page check:" and paste your notes.

### ◐ 2.5 Run the automatic tests (Claude ran them on this PC 2026-10-24; the GitHub run waits for `main`)

**Result:** Claude built the web app and ran the whole Playwright suite on this PC against the test project: **20 of 20 passed** (sign-in as Asha and Ravi, the wallet-funded money path, withdrawal, cancel with a fine, dispute, the phone-number refusal, the uptime check, and the sign-in, legal and wallet screens at desktop and phone size).

**Why the GitHub run isn't possible yet:** GitHub offers **Run workflow** only for workflow files on the default branch, and `main` doesn't have `e2e.yml` (it exists only on `redesigned-2.0`, and agents never change `main`). Starting it from the command line gives `HTTP 404: workflow e2e.yml not found on the default branch`. So **End-to-end (test project)** is not in the left list at https://github.com/hitendureacts77/taskdrop/actions yet.

1. Nothing to click now. When you promote `redesigned-2.0` to `main` (Phase 9): open https://github.com/hitendureacts77/taskdrop/actions → **End-to-end (test project)** → **Run workflow** → Branch **redesigned-2.0** → the green button. Wait 5 to 10 minutes, then tell Claude whether it passed.
2. To repeat the check sooner: Type to Claude "Run the e2e tests again here." (about 2 minutes).

### ☐ 2.6 Slow screens (one week later)

1. Use the app normally for a week.
2. Type to Claude: "Check slow queries and slow operations in Sentry and fix the top ones."

---

## Phase 3: Server decides everything

### ☑ 3.1 Deploy the latest changes — done 2026-10-24

Claude checked: every migration up to 121 is applied on the test project and all 11 Edge Functions are deployed (a push to `redesigned-2.0` does this by itself, see `docs/DEPLOY.md`). (Task 3.2 is future scope: no keys are rotated now.)

### ⏸ 3.2 Change the Razorpay test keys — future scope (owner decision 2026-10-24, confirmed 2026-10-25: no key rotation)

Not needed now. The old test key pair is out of the code but stays readable in the public repo's history; it only opens the Razorpay test account, so no real money is at risk. Do the clicks below only when you decide to.

1. Click: open https://dashboard.razorpay.com and sign in.
2. Click: at the top, switch to **Test Mode**.
3. Click: in the left menu, **Account & Settings** → **API Keys**.
4. Click: **Regenerate Test Key** → confirm.
5. Click: **Download Key Details**. Keep this file safe: the secret is shown only once.
6. Click: open https://supabase.com/dashboard/project/wjxvingpfbfvkfqhrguj
7. Click: in the left menu, **Integrations** → **Vault** (older layout: **Database** → **Vault**).
8. Click: find `RAZORPAY_KEY_ID` → the **⋯** menu → **Edit** → paste the new Key Id → **Save**.
9. Click: find `RAZORPAY_KEY_SECRET` → **⋯** → **Edit** → paste the new Key Secret → **Save**.
10. Click: open `.env.all-secrets` in Notepad, replace the two Razorpay values, and save.
11. Type to Claude: "I changed the Razorpay test keys in Vault. Check a test payment still works."

### ⏸ 3.3 Decide: public or private repos — future scope (owner decision 2026-10-24)

Both repos stay public (free) for now. Nothing to do on GitHub. Going private waits for a later decision; CodeRabbit would then cost about $24 a month.

1. Keep them public (free): this is the current setting; nothing to do.
2. To make them private (CodeRabbit then costs about $24 a month):
   1. Click: open https://github.com/hitendureacts77/taskdrop → **Settings** (top right of the repo).
   2. Click: scroll to the bottom, **Danger Zone** → **Change visibility** → **Make private** → confirm.
   3. Do the same for https://github.com/hitendureacts77/taskdrop-admin
   4. Type to Claude: "Both repos are private now."

### ☑ 3.4 Supabase sign-in token settings — done and verified 2026-10-25 (Claude, in your Chrome)

Checked on the live Supabase page (Authentication → Sessions, https://supabase.com/dashboard/project/wjxvingpfbfvkfqhrguj/auth/sessions): access token expiry 3600 seconds, reuse detection (**Detect and revoke potentially compromised refresh tokens**) on, reuse interval 10 seconds. Nothing is left for you to do.

Notes for later: all three settings sit on that one page under **Access Tokens** and **Refresh Tokens** (scroll down). The session limits at the top (single session, time-box, inactivity timeout) are Pro-plan only and stay off. The Legacy JWT secret on the JWT Keys page is a master key: never copy or paste it anywhere. Owner decision 2026-10-25: no key rotation needed.

### ◐ 3.5 App Check (built and set up 2026-10-25; live proof still open)

**Done (2026-10-25):**
- The server check (monitor mode) is on in the `api` function.
- Firebase: the web app and the Android app are registered in App Check (web: reCAPTCHA Enterprise key for taskdrop.in and localhost; Android: Play Integrity with the EAS keystore SHA-256 `02:B6:21:92:…:C2:AB:3F`). The API key behind `google-services.json` now also allows the Firebase App Check API.
- Vercel holds the six App Check values; the web client and the Android client are merged into `redesigned-2.0`, and taskdrop.in serves a build that contains the web config (a bug that left it out was fixed in PR 83).
- Android beta APKs use a Firebase **debug token** because Play Integrity refuses an APK installed by hand ("App attestation failed"). The token (`EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN`) is an EAS `preview` variable and is in `.env.all-secrets`; PR 84 (the code that uses it) is open and not merged.

**Left (this is step 2 of START HERE; the new beta build `505485f8` is finished and waits for you to unlock the phone and say go):**
1. Claude: finish the Android test. The token the Firebase console generated (`beta apk 3`) is now set in EAS and a new beta APK is building; Claude installs it on the phone and reads the `api` log for `platform: android` `result: valid`.
2. You: open https://taskdrop.in signed in and use it for a minute, then tell Claude. The log must show `platform: web` `result: valid` (no one has done this since the fix).
3. You: in Firebase → App Check → `taskdrop Android` → ⋮ → **Manage debug tokens**, delete the two older tokens named `beta apk` when convenient (they are unused).
4. Before a Play Store build: add the Play Console app-signing SHA-256 to the Android app's Play Integrity settings, and test once from a Play-installed copy (that is the only real Play Integrity test).
5. Claude (after the tests): merge PR 84, tick this step, and then Phase 9 may switch enforcement on.

### ☑ 3.6 Test the control screens with your phone — done 2026-10-24 (Claude, phone plugged in)

Claude switched Android maintenance on for the test project, reopened TaskDrop on your phone and saw "We'll be right back" with the message; it then set the minimum version to 9.0.0 and saw "Time to update"; the web setting stayed off. Everything is switched back and the app opens normally. Notes: the app's answer is cached for about a minute, so a screen can take up to a minute to appear or clear; the "Time to update" screen has no button because no update link is set yet (set one in the admin when there is a store page). The steps below are what to do if you want to repeat it yourself.

1. Click: plug in your phone.
2. Type to Claude: "Test the control screens. My phone is plugged in."
3. When Claude switches on maintenance for Android:
   1. Click (phone): close TaskDrop completely and open it again. You should see the maintenance screen.
   2. Click (PC): open https://taskdrop.in. It should work normally.
   3. Tell Claude what you saw on each.
4. When Claude sets a higher minimum version:
   1. Click (phone): close and reopen TaskDrop. You should see **Update the app**.
   2. Tell Claude.
5. Claude switches everything back.

### ⚠ 3.7 Check the admin signs you out when idle — Claude tried twice 2026-10-25: once it signed out by itself after about 30 minutes, once a click after 32 minutes still worked (P2-43). A third timed run waits for the Google fix (task 0.1), because it needs a fresh admin login.

1. Click: sign in to the new admin (task 2.4, steps 1 to 3).
2. Leave it alone for 31 minutes.
3. Click: any item in the left menu. You should land on the sign-in page with "You were signed out after 30 minutes without activity".
4. Tell Claude: "The admin idle sign-out works" (or what happened instead).

### ☑ 3.8 Check the old app and old admin still work — done 2026-10-25 by Claude

The old app signed in as Asha and Ravi, posted a task, got an offer, no errors; the old admin signed in with your account and showed the Dashboard and the new task among 140 jobs.

1. Click: open Chrome Incognito → https://taskdrop-five.vercel.app → sign in with `9990000001`.
2. Click: look at the feed, open any task.
3. Click: post a small task, then open **My Tasks** and check it's there.
4. Click: open **Microsoft Edge** (a second browser, so it's a second person) → https://taskdrop-five.vercel.app → sign in with `9990000002`.
5. Click: find Asha's new task → send a quote → open the chat → send a message.
6. Click: open https://taskdrop-admin.vercel.app → sign in → open the **Dashboard**, then **Tasks**.
7. Type to Claude: "The old app and old admin both work" (or what broke).

### ☐ 3.9 The security checklist

1. Type to Claude: "Run testing_checks T2 and T11.2 to T11.5 with me." Claude tells you what to tap.

---

## Phase 4: Accounts and sign-in

### ☑ 4.1 Decide on phone login — decided 2026-10-24: keep today's phone login

You asked Claude to complete Phases 4 and 5, so Claude took the simplest choice: **keep `phone-auth`** (it works and has every protection: throttles, birth date first, admin numbers refused, test numbers). The Supabase phone-auth boxes in the plan are marked dropped. To switch later, type "Start phone auth." (it needs MSG91 SMS and real SMS).

### ☑ 4.2 Turn on account linking in Supabase — done 2026-10-24 (you switched it on; Claude rechecked)

Claude's check on 2026-10-24: after the first try did not save, Supabase now answers the app's "Link Google" request with Google's sign-in address (`e2e/accounts.spec.ts`, the "manual linking" test, passes). Nothing more to do here.

### ☑ 4.3 Test linking — done 2026-10-25 (you ran it with a real Google login: "Linking ok")

Built: **Account → Sign-in methods → Link Google** (needed task 4.2 first). Steps kept for a re-run:

1. Click (phone): sign in as Asha (`9990000001`).
2. Click: **Account** → the sign-in methods card → link **Google** → pick a Google account.
3. Click: back in the app, check Google now shows as linked.
4. Click: sign out, then sign in with **Google**. You should be Asha again, not a new empty account.
5. Tell Claude what happened.

### ☑ 4.4 Make new accounts — done 2026-10-25 (website by Claude 2026-10-24; Google and the phone app by you: "Web Google ok. Phone: Google ok, number ok, username sign-in ok, under-18 refused")

**Done by Claude, in a browser test on the website against the test project (`e2e/accounts.spec.ts`, all passing):** a brand-new phone number is asked its birth date before any code; the test code is shown and typed in; the setup screens finish; a username and password are set (Settings → Sign-in) and used to sign back in; a 16-year-old birth date is turned away with no code and no account; Ravi (`9990000002`) signs in as before. The test deletes the account it made, so nothing is left behind.

**One correction to the old wording:** there is no "create a username and password" on the sign-in screen. You pick a username in the setup screens and set the password later in **Settings → Sign-in → Password sign-in**; the **Username** button on the sign-in screen is only for signing back in.

What you did (Google needs your real Google login, and Claude does not type your phone numbers or pick your Google accounts on your phone). All five steps are reported ok on 2026-10-25; kept for a re-run:

1. **Google, on the website** (Chrome Incognito, https://taskdrop.in): tap **Google** → choose a Google account you haven't used in TaskDrop (for example `narasimharaju7c`) → enter a birth date that makes you over 18 → finish the welcome screens → you're in → **Settings** → **Sign-in** → **Sign out on this device**.
2. **Google, on the phone app:** the same, with another unused Google account.
3. **Phone number, on the phone app:** sign out, then enter a new fake number (`9990000012`) → type the code from the "Test mode" box → birth date over 18 → finish the welcome screens → pick a username → **Account** → **Sign-in** → set a password → sign out → tap **Username** and sign back in with it.
4. **Age check, on the phone app, once:** start a phone sign-up with `9990000013` and a birth date that makes you 16. It should refuse you.
5. Type to Claude a list like: "Web Google ok. Phone: Google ok, number ok, username sign-in ok, under-18 refused."

---

## Phase 5: Background jobs (Inngest)

### ☑ 5.1 Decide about the money jobs — deferred 2026-10-24

The money jobs (payouts, refund retries, webhooks, and the three money sweeps) stay on their old route until the lawyer answers on the money flow. Nothing to do.

### ☑ 5.2 Switch the jobs over, one at a time — done 2026-10-24 (money sweeps stay on the old route, task 5.1)

Claude checked the test project and looked at your Inngest dashboard (in your Chrome, already signed in): push notifications go through Inngest (`push_via_inngest` is on), the prune jobs, overdue tasks, housekeeping, media purge, reminders and user-sync jobs have moved, the outbox has nothing waiting (47 events, 0 pending), and **0 runs failed in the last day** (about 2,050 runs; the newest say Completed).

**One thing to know:** the Inngest free plan (Hobby) allows 50,000 runs a month and the dashboard said 28,456 used on 24 October. The outbox safety-net job ran every minute and was the biggest user, so Claude changed it to every 5 minutes (it only matters when the instant path fails; the watchdog alerts after 15). If the limit were ever reached, Inngest stops starting new runs, and push would stop. It is on the Phase 10 list: upgrade Inngest with the other paid plans (task 10.2).

### ☑ 5.3 Test push notifications on the phone — done 2026-10-24 (Claude, phone plugged in)

Claude sent **all 20 notification types** to your test account on the phone (Tasker 3313, the one with an Android push token) and checked the phone: all 20 arrived through Inngest, each with its own title, grouped under "TaskDrop". Tapping one opens the **Notifications** screen (the app opens that screen for every push). Claude deleted the 20 test rows afterwards.

Two things for you: swipe the leftover "Push test 5.3: …" notifications out of your phone's notification shade (Clear all). And remember: if you close TaskDrop with **Force stop**, Android stops delivering pushes until you open the app once; swiping it out of the recent-apps list is fine.

### ☑ 5.4 Notifications on the website — done 2026-10-24 (automatic test)

Claude added `e2e/notifications.spec.ts`: Asha has the website open, Ravi quotes on her new task, and her bell goes up by itself with no refresh. It passes (run three times).

### ◐ 5.5 Check the admin payout buttons — page checked 2026-10-24; the buttons need RazorpayX set up

Claude opened the new admin in your Chrome (already signed in as `hitendureacts@gmail.com`) and the **Payouts** page: it opens with no error and shows the 7 waiting withdrawals (₹4,900), the settled list, the per-day chart, and "How withdrawals are paid: **Manual** in use". **RazorpayX shows "Not set up" and "In RazorpayX: Not connected"**: that is the true state, because RazorpayX has no account number or keys on the test project yet (it is activated in task 10.3). So **Check with RazorpayX**, **give back** and the live **Balance** cannot be pressed yet: they only appear once RazorpayX is on. Their code is unchanged and covered by the unit tests. Nothing to click now; when you do task 10.3, Claude repeats this check.

---

## Phase 6: Photos (ImageKit)

**Where Phase 6 stands (2026-10-25):**

| Task | State |
|---|---|
| 6.1 Change the ImageKit key | ⏸ future scope: no key rotation |
| 6.2 Upload photos four ways | ☑ done (web and phone) |
| 6.3 Chat photo | ◐ works on web and phone; the full-size view is merged (app PR 85) but needs the phone update (START HERE step 2) |
| 6.4 Photos in the admin | ◐ merged (admin PR 25); needs your two Vercel values (START HERE step 3) |
| 6.5 Speed on mobile data | ⚠ not run: mobile data is off on your phone |

**What Claude needs from you to finish (nothing else is open):**

1. **Vercel, 2 values (6.4).** In project `taskdrop-admin` add `IMAGEKIT_PRIVATE_KEY` and `IMAGEKIT_URL_ENDPOINT`, copied from project `taskdrop` (clicks in 6.4). No key is changed. Do not paste them into the chat.
2. **"Push" (6.3 and 6.4): done.** Both branches were merged into `redesigned-2.0` (app PR 85, admin PR 25) on 2026-10-25.
3. **"Send the phone update" (6.3).** The merge is done, so say "publish the update" (it is part of START HERE step 2). Claude publishes an over-the-air update on the `beta` channel (a deploy), you open TaskDrop twice, and Claude checks on the phone that tapping a chat photo opens it full size.
4. **Mobile data and the cable (6.5).** Switch **Mobile data** on in the phone's settings, plug the phone in, and say "run the mobile data test". It uses a little of your data pack.
5. **A look at the admin (6.4).** After the admin deploys, either open a job that has a photo (for example "Test camera photo phase 6") on the admin's **Jobs** page, or say "check the admin photos" and Claude looks in your Chrome.

### ⏸ 6.1 Change the ImageKit private key — future scope (owner decision 2026-10-25: no key rotation)

Not needed now. The current ImageKit private key stays as it is. Do the clicks below only when you decide to. Phase 6 tasks 6.2 to 6.5 do not depend on it.

1. Click: open https://imagekit.io/dashboard and sign in.
2. Click: in the left menu, **Developer options**.
3. Click: find the **private key** and make a new one (and remove the old one, if it offers).
4. Click: copy the new private key.
5. Click: open https://vercel.com → project **taskdrop** → **Settings** → **Environment Variables**.
6. Click: find `IMAGEKIT_PRIVATE_KEY` → **⋯** → **Edit** → paste the new key → **Save**.
7. Click: in `.env.all-secrets` (Notepad), replace `IMAGEKIT_PRIVATE_KEY` and save.
8. Type to Claude: "I changed the ImageKit private key in Vercel. Redeploy so it reaches Supabase."

### ☑ 6.2 Upload photos four ways — done 2026-10-25 by Claude (web, then your phone plugged in)

A post photo (picker), a dropped file, a chat photo and a proof photo all went to ImageKit and are recorded in `media` as attached.

**Phone (installed `beta` APK, signed in as Asha):** a photo taken with **Take photo** (1.6 MB JPEG) and a picture chosen from **Choose from gallery** (a test picture Claude copied to the phone, so none of your own photos were used) both uploaded to ImageKit under `/beta/u/<Asha>/` and are marked attached; each task shows its photo. On the first camera try the post draft came back empty at step 1; that was another Claude session relaunching the app on the same phone at that minute, not an app fault (checked, so it is not logged as a problem). The second try kept the draft. The camera pictured your laptop. Test tasks left on Asha: "Test camera photo phase 6" and "Test carry a small sofa upstairs phase 6 photo test" (₹300 each, open, no offers).

1. Click (PC, Asha in Chrome Incognito): **Post** → add a photo with **choose file** → post.
2. Click (PC): post again, this time **drag** a photo from your desktop onto the photo box → post.
3. Click (phone, Asha): **Post** → **Camera** → take a photo → post.
4. Click (phone): post again with a photo from the **Gallery**.
5. Type to Claude: "I uploaded 4 photos: file picker, drag and drop, camera and gallery. Check they reached ImageKit."

### ◐ 6.3 Chat photo — web and phone done 2026-10-25 by Claude; one thing fails: a chat photo does not open full size

Ravi sent a photo; the signed link opened for both Ravi and Asha (the image downloaded) and was refused for a stranger.

**Phone (Asha, beta APK):** the photo Ravi sent earlier shows in the chat on the phone, and a picture Asha sent from the phone (**+** → **Choose from gallery**) showed at once and is in `media` as a chat photo, attached. **Tapping a photo did nothing:** the code had no full-size view for chat photos (P2-49 in `docs/PHASE2_PROBLEMS.md`). Claude added one on branch `fix/chat-photo-fullsize` (app repo, commit 5aab2eb, not pushed): tap a photo, it opens full screen; tap anywhere, the cross or Back to close. It works in the web build at phone size. It is not on your phone yet, so step 2 will still do nothing there until the change is pushed, merged and sent as an update (items 2 and 3 in the list at the top of Phase 6).

1. Click (PC, Ravi): open a job that has started with Asha → chat → send a photo.
2. Click (phone, Asha): open the chat → tap the photo. It should open full size.
3. Tell Claude whether it opened.

### ◐ 6.4 Photos in the admin — built and merged into `redesigned-2.0` of the admin repo (admin PR 25, 2026-10-25); waits for your two Vercel values (START HERE step 3)

**What Claude built:** the admin's **Jobs** page now has a "Photos and files" card with the job's own photo and every proof file the worker sent (each opens full size in a new tab), and the **Copyright** page shows the job photo beside each complaint so staff can compare. The links are signed on the server with the same method the app uses (a test checks it against the app's own signer, byte for byte) and expire within two hours; the keys never reach the browser. Older uploads in Supabase Storage show too. The admin's security policy now allows images from ImageKit and the Supabase project. If the two values are missing, the card says "ImageKit is not set up for the admin yet" instead of breaking. The admin's 94 automatic tests, typecheck and lint pass. **Not yet seen on screen:** it needs the two values and a deploy first.

No new key is made: copy the values the `taskdrop` project already has. (An earlier version of this manual asked for a third value, `IMAGEKIT_ENV`. It is not needed.)

1. Click: Vercel → project **taskdrop** → **Settings** → **Environment Variables**, and open `IMAGEKIT_PRIVATE_KEY` and `IMAGEKIT_URL_ENDPOINT` (use the eye icon to show them; do not paste them into the chat).
2. Click: Vercel → project **taskdrop-admin** → **Settings** → **Environment Variables** → **Add New**. Add these two, environments: all → **Save** each:
   1. `IMAGEKIT_PRIVATE_KEY`: the same value as in `taskdrop`.
   2. `IMAGEKIT_URL_ENDPOINT`: the same value as in `taskdrop` (it looks like `https://ik.imagekit.io/<your id>`).
3. Type to Claude: "The two ImageKit values are in the admin's Vercel project. Push both Phase 6 branches."

### ⚠ 6.5 Speed on mobile data (5 minutes) — not run 2026-10-25: mobile data is switched off on your phone

Claude turned Wi-Fi off to try it and found the phone has no internet without Wi-Fi (Settings show mobile data **off**; only calling is connected). Claude turned Wi-Fi back on at once and did not switch mobile data on, because it uses your data pack. To run it: switch **Mobile data** on in the phone's settings, then say "run the mobile data test" with the phone plugged in; Claude times it.

1. Click (phone): turn off Wi-Fi so you're on mobile data.
2. Click: close TaskDrop and open it. Count the seconds until the Home pictures show.
3. Tell Claude: "On mobile data the Home feed took N seconds."

---

## Phase 7: Moderation

### ☑ 7.1 Bring in the newest admin tools — done

The Phase 7 admin work is merged into `redesigned-2.0` of the admin repo (PRs 20 and later), and migrations 116 to 121 are applied. Nothing to do.

### ☑ 7.2 Add the dashboard links — done 2026-10-25 by Claude (both values are in the admin's Vercel project and a new admin build was started)

The clicks are kept in case you need to redo them:


1. Click: Vercel → project **taskdrop-admin** → **Settings** → **Environment Variables** → **Add New**.
2. Click: Key `INNGEST_DASHBOARD_URL`, value `https://app.inngest.com`, environments: all → **Save**.
3. Click: **Add New** again. Key `IMAGEKIT_DASHBOARD_URL`, value `https://imagekit.io/dashboard`, environments: all → **Save**.
4. Type to Claude: "The two dashboard links are set. Redeploy the admin."

### ☑ 7.3 Report a message and hide it — done 2026-10-25 by Claude (web, API and your Chrome); the phone is left

Asha reported Ravi's "hello" in a job chat; the admin's Reports page showed the message with "Hide this message"; after hiding it neither person gets it back, and the admin offers "Show it in the chat again".

1. Click (PC, Ravi): on a job that has started with Asha, send the chat message `test message to report`.
2. Click (phone, Asha): open that chat → **press and hold** the message → **Report** → pick a reason → send.
3. Click (new admin): **Reports** → open the new report → **Hide** the message.
4. Click (phone): leave the chat and open it again. The message should be gone.
5. Click (PC): refresh the chat. It should be gone there too.
6. Tell Claude what you saw.

### ☑ 7.4 Block someone — done 2026-10-25 by Claude (web and API); the phone is left

Ravi reported a job with "also block" in the browser: the blocked list shows the poster; a blocked person's offer and chat message are refused (the blocker can still write to them).

1. Click (phone, Asha): open Ravi's profile → **Report** → tick **block them too** → send.
2. Click (PC, Ravi): try to send Asha a chat message, and try to make an offer on one of Asha's open tasks. Both should be refused, and Asha's open tasks should be hidden from Ravi.
3. Click (phone, Asha): **Account** → **Blocked people** → **Unblock** Ravi.
4. Tell Claude what happened.

### ☑ 7.5 Warn someone — done 2026-10-25 by Claude in your Chrome

"Warn them" on a report about a person closed the report as acted on and wrote the audit row. The message went to a seed account.

1. Click (phone, Asha): open Ravi's profile → **Report** → send (don't block this time).
2. Click (new admin): **Reports** → open it → **Warn them**.
3. Tell Claude whether Ravi got the warning.

### ☑ 7.6 Check the audit log — done 2026-10-25 by Claude in your Chrome

Warn, close report, hide message and hide job each have a row; the page now says what each was in plain words ("Warned a person", "Closed a report as acted on") and has a "Staff actions" filter.

1. Click (new admin): open the audit log (under **Security**).
2. Look: the hide and warn you just did should be listed.
3. Tell Claude: "The audit log shows the hide and the warn" (or what's missing).

---

## Phase 8: Store readiness

### ☐ 8.1 Decide on the map

1. Simplest: Type to Claude "Keep OpenStreetMap while testing. Suggest a free map provider for the store version." Claude's note (check each provider's current free limits before choosing): Android already uses Google Maps (restricted key, no tile problem); the weak spot is the web map and the address fallback, which use OpenStreetMap's public servers (not allowed at scale). Options: a tile provider whose free tier allows commercial use, or Google Maps on the web too. The decision can wait until before launch.

### ☐ 8.2 Give the legal details — the Terms, Privacy and Support pages are live (checked 2026-10-25, all open); the Privacy page marks itself "Draft, under legal review" and shows no Grievance Officer name until you give these

1. Type to Claude, filled in: "Legal details for the Terms and Privacy pages: business or legal name …, address …, email hitendureacts@gmail.com, grievance officer name …, grievance officer email …, courts in (city) …"

### ◐ 8.3 Set up the app in Google Play Console (1 to 2 hours, and Google may take days to check your ID)

**Claude's part is done (2026-10-24):** every answer and the store texts are in `docs/PLAY_STORE.md`; the 512×512 icon and a plain 1024×500 feature graphic are in `docs/store/`. Still yours: steps 1 to 3 below, entering the answers (step 5), and phone screenshots (type "take the Play screenshots" with your phone plugged in). Skip steps 4 and 6; they are already done.

1. Click: open https://play.google.com/console and sign in with the Google account that should own the app.
2. If you have no developer account yet: choose **Personal**, pay the **$25**, and verify your identity with the ID document Google asks for.
3. Click: **Create app** → App name `taskdrop` → default language **English (India)** → **App** → **Free** → tick the declarations → **Create app**.
4. Type to Claude: "Give me the Play Console answers: data safety, content rating, ads, app access, target audience." Claude drafts every answer from the code.
5. Click: on the app's **Dashboard**, under **Set up your app**, open each item and enter Claude's answers:
   1. **Privacy policy:** `https://taskdrop.in/?page=privacy`
   2. **App access:** "some functionality is restricted", with the test phone `9990000001` and the note "the 6-digit code is shown on screen in a Test mode box; type it in".
   3. **Ads**, **Content rating**, **Target audience** (18 and over), **Data safety**: as Claude drafted.
6. Type to Claude: "Make the store listing: short and full description, a 512×512 icon, a 1024×500 feature graphic and phone screenshots."
7. Click: **Grow users** → **Store presence** → **Main store listing** → paste the texts and upload the pictures Claude made → **Save**.

### ◐ 8.4 Upload the store build (built 2026-10-24; **the download link expires on 2026-11-23**: after that, type "Build the store version (AAB)" and Claude makes a new one)

The store build (AAB, version 1.0.0, versionCode 1, with the new drop icon) is ready: https://expo.dev/artifacts/eas/LG2lidySSxe5fii7qXA6MJY6eU2rxWl7Ue0H7ywxHVs.aab (build page: https://expo.dev/accounts/hitendureacts/projects/taskdrop/builds/cc681cd3-d5c4-4413-aba1-5ce7fc4f9905). Go straight to step 2.

1. Type to Claude: "Build the store version (AAB)."
2. Click: Claude gives you a download link. Download the `.aab` file.
3. Click: Play Console → **Test and release** → **Testing** → **Closed testing** → **Create track** (or open the existing one) → **Create new release**.
4. Click: upload the `.aab` → **Next** → **Save** → **Send for review** (or **Start rollout**).

### ☐ 8.5 Read the runbook (20 minutes)

1. Click: open `docs/RUNBOOK.md` in this repo.
2. Read it once.
3. Tell Claude anything that's wrong or different from how you'd really handle it.

### ☐ 8.6 The 12 testers (blocked until you're ready)

1. Click: open `docs/TESTER_RECRUITMENT.md` and send its message to at least 12 friends.
2. Click: Play Console → **Closed testing** → **Testers** → add their Gmail addresses → **Save**.
3. Click: copy the **opt-in link** and send it to them. Each one must tap it and install the app.
4. Wait **14 days** with at least 12 testers opted in.
5. Tell Claude when the 14 days are done.

---

## Phase 9: Move everyone to the new app

Start only when Phases 0 to 8 are done.

### ☐ 9.1 Approve

1. Type to Claude: "Phases 0 to 8 are done. I approve the switch-over."

### ☐ 9.2 Move your testers

1. Click: message your testers: "Please install the new TaskDrop app from this link:" and paste the link Claude gives you.

### ☐ 9.3 The switch-over

1. Type to Claude: "Do the switch-over, one step at a time."
2. Claude asks before each step (redirects, the database lockdown, removing old code). Read each one and reply **yes** or ask a question.

### ☐ 9.4 Final check

1. Click: open https://taskdrop-five.vercel.app. It should take you to https://taskdrop.in.
2. Click: open https://taskdrop-admin.vercel.app. It should be the new admin.
3. Tell Claude what you saw.

---

## Phase 10: Customer launch (only when you decide)

### ☐ 10.1 Decide

1. Type to Claude: "I want to launch."

### ☐ 10.2 Paid plans (10 minutes)

1. Click: https://supabase.com/dashboard → your organization (top left) → **Billing** → **Change plan** → **Pro** ($25 a month) → add your card → confirm.
2. Click: https://vercel.com → team **hitenduteam** → **Settings** → **Billing** → upgrade to **Pro** ($20 a month).
3. Click: https://app.inngest.com → **Settings** → **Billing** → upgrade from Hobby (50,000 runs a month; about 28,500 were used by 24 October with only the test group). Check the current price on that page first. Needed before the money jobs move to Inngest and before real users, because when the limit is hit Inngest stops starting runs and push stops.

### ☐ 10.3 Razorpay live (days to weeks; Razorpay checks your business)

1. Click: https://dashboard.razorpay.com → **Activate account** → fill in business type, PAN, GST (if you have one), bank details (a current account), website `https://taskdrop.in` → upload the documents it asks for → **Submit**.
2. Click: https://x.razorpay.com → activate RazorpayX with the same business and a current account.
3. Wait for both approvals by email.
4. Type to Claude: "Razorpay and RazorpayX are approved for live mode." Then put the live keys in Vault yourself (the clicks are steps 6 to 10 of task 3.2; the live keys are brand new, so this is not a rotation).

### ☐ 10.4 SMS registration (DLT)

1. Click: open `docs/SMS_OTP.md`. Follow its DLT steps: register your business on a DLT portal, register the sender name and the OTP message template.
2. Tell Claude the template ID and sender name.

### ☐ 10.5 DMCA agent (15 minutes, $6)

1. Click: open https://dmca.copyright.gov → **Register** → make an account.
2. Click: designate an agent: name, address, email, phone → pay **$6**.
3. Type to Claude: "DMCA agent registered:" followed by the name, email, address and phone.

### ☐ 10.6 The lawyer

1. Click: send a lawyer `docs/LAWYER_BRIEF.md` and the links `https://taskdrop.in/?page=terms` and `https://taskdrop.in/?page=privacy`.
2. When they answer: Type to Claude "Here is the lawyer's answer:" and paste it.

### ☐ 10.7 Production

1. Type to Claude: "Set up production." (This includes turning off the "any phone number signs in" test shortcut.)

### ☐ 10.8 One real job with real money (20 minutes)

1. Click: with live keys on, post a ₹10 job as yourself and pay with your own UPI.
2. Click: complete it from a second account, approve it, and withdraw to your bank.
3. Tell Claude whether the money arrived.

### ☐ 10.9 Release on Google Play

1. Click: Play Console → **Test and release** → **Production** → **Create new release** → choose the build Claude names → **Next** → **Save** → **Send for review**.
2. Wait for Google's approval email. TaskDrop is then live.

---

## Future scope: iOS and Safari

Nothing here is needed now. Do it only after you tell Claude "start iOS". It needs an iPhone or a Mac, and for the App Store work an Apple Developer account ($99 a year). The matching plan items are marked `[-]` in `docs/UPGRADE_PLAN.md` (Part B, section 12).

### ⏸ F.1 Safari (was task 2.3)

1. Click (iPhone or Mac): open https://taskdrop.in in Safari.
2. Repeat steps 1 to 16 of task 2.2 and tell Claude what broke.

### ⏸ F.2 Start iOS

1. Type to Claude: "Start iOS."
2. Claude lists the Apple steps (Developer enrollment, App Store Connect, TestFlight testers, Sign in with Apple) as clicks, and this section grows then.
