# TaskDrop owner manual: what to click, phase by phase

This is your part of `docs/UPGRADE_PLAN.md`, written as clicks. Do the tasks in order, top to bottom. Tick a task's box when you finish it.

## How to read this manual

Every step is one of three kinds:

- **Click:** you do it, in a browser on your PC or on your phone.
- **Type to Claude:** copy the sentence in quotes into the Claude chat. Claude does the work and tells you when it's done.
- **Tell Claude:** write what you saw in the chat (a screenshot is fine).

If a screen doesn't look like the step says (a button has another name, or isn't there), stop and send Claude a screenshot. Websites like Sentry and Google change their buttons from time to time.

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

While testing, any phone number signs in and the code fills itself in. Use these three fake accounts; they already have fake money:

| Name | Phone | Use it for |
|---|---|---|
| Asha | 9990000001 | the person **hiring** (has ₹5,000) |
| Ravi | 9990000002 | the person **working** (has ₹2,000) |
| Meera | 9990000003 | a third person when you need one |

**Two people at once:** use your **phone** as Asha and **Chrome on your PC** as Ravi. When the steps say "Incognito", press **Ctrl + Shift + N** in Chrome to open a private window, so your own sign-ins don't get in the way.

---

## Phase 0: Foundations

Done. Nothing to do.

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

### ◐ 1.6 Phase 1 test session with your phone — Claude ran steps 2 to 4 on 2026-10-24; only the admin test error is left

**State 2026-10-24 (later):** Claude ran this with your phone plugged in. The test update reached the phone (Sentry shows its update id), test errors from web, Android and all 8 functions reached Sentry with readable stacks, a test push arrived (two test notifications may still sit in your phone's shade: swipe them away), and Uptime Robot shows both monitors Up. Not done: a test error from the admin. Details in the plan, v4.47.

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

### ☐ 2.1 Write your list of problems (15 minutes)

1. Click: open Notepad on the PC (or Notes on the phone).
2. Write one line per problem: the screen, what you did, what went wrong or felt slow. Example: `Wallet: tapped Withdraw, it spun for 10 seconds`.
3. Type to Claude: "Here is my Phase 2 list. Make a GitHub issue for each and fix them:" and paste your list underneath.

### ☐ 2.2 Run one full job on the phone and the PC (45 minutes)

Follow the words on the screen when a button name differs slightly. Write down anything that goes wrong.

**Sign in both people**

1. Click (phone): open TaskDrop. If someone is signed in: **Account** tab → **Sign out**.
2. Click (phone): sign in with phone `9990000001` (Asha). The code fills itself in.
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

### ☐ 2.4 Check every admin page (20 minutes)

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

Claude checked: every migration up to 121 is applied on the test project and all 11 Edge Functions are deployed (a push to `redesigned-2.0` does this by itself, see `docs/DEPLOY.md`). Task 3.2 can go ahead.

### ☐ 3.2 Change the Razorpay test keys (10 minutes)

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

### ☑ 3.3 Decide: public or private repos — decided 2026-10-24: keep both public

You chose to keep both repos public (free) for now. Nothing to do on GitHub. Going private is future scope: do option 2 below only when you decide to. Because the repos stay public, task 3.2 (new Razorpay test keys) is still needed.

1. Keep them public (free): done.
2. Future scope. To make them private (CodeRabbit then costs about $24 a month):
   1. Click: open https://github.com/hitendureacts77/taskdrop → **Settings** (top right of the repo).
   2. Click: scroll to the bottom, **Danger Zone** → **Change visibility** → **Make private** → confirm.
   3. Do the same for https://github.com/hitendureacts77/taskdrop-admin
   4. Type to Claude: "Both repos are private now."

### ☐ 3.4 Supabase sign-in token settings (5 minutes)

1. Click: open the Supabase project → left menu **Authentication**.
2. Click: under Configuration, **Sessions**.
3. Click: turn on **Detect and revoke potentially compromised refresh tokens**. Leave the reuse interval at its default (10 seconds). Click **Save**.
4. Click: find **Access token expiry** (in Authentication settings, or under **Project Settings** → **JWT Keys**) and set it to `3600` seconds. Click **Save**.
5. Type to Claude: "Token settings: reuse detection on, reuse interval 10 seconds, access tokens expire after 3600 seconds."

### ◐ 3.5 App Check (code done 2026-10-24; your Firebase clicks left)

1. Done: the server check (monitor mode) and the web client are built and deployed, and both stay off until you finish step 2. Android (Play Integrity) waits for a registered Firebase app and a new APK.
2. Click: follow `docs/APP_CHECK.md` (about 30 minutes, in the Firebase console), then type to Claude the values it lists. Claude puts them in Vercel.

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

### ☐ 3.7 Check the admin signs you out when idle (35 minutes, mostly waiting)

1. Click: sign in to the new admin (task 2.4, steps 1 to 3).
2. Leave it alone for 31 minutes.
3. Click: any item in the left menu. You should land on the sign-in page with "You were signed out after 30 minutes without activity".
4. Tell Claude: "The admin idle sign-out works" (or what happened instead).

### ☐ 3.8 Check the old app and old admin still work (10 minutes)

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

### ☐ 4.1 Decide on phone login

1. Simplest choice: keep today's phone login (it works and has every protection). Type to Claude: "Keep phone-auth. Drop the Supabase phone auth boxes."
2. If you'd rather switch: Type to Claude "Start phone auth." (It needs MSG91 SMS set up and real SMS.)

### ☐ 4.2 Turn on account linking in Supabase (2 minutes)

1. Click: open the Supabase project → **Authentication** → **Sign In / Providers**.
2. Click: turn on **Allow manual linking**.
3. Click: **Save**.
4. Type to Claude: "Manual linking is on. Build account linking."

### ☐ 4.3 Test linking (built 2026-10-24: **Account → Sign-in methods → Link Google**; needs task 4.2 first; 5 minutes)

1. Click (phone): sign in as Asha (`9990000001`).
2. Click: **Account** → the sign-in methods card → link **Google** → pick a Google account.
3. Click: back in the app, check Google now shows as linked.
4. Click: sign out, then sign in with **Google**. You should be Asha again, not a new empty account.
5. Tell Claude what happened.

### ☐ 4.4 Make six new accounts (30 minutes)

Do this on the **website** (Chrome Incognito, https://taskdrop.in) and then the same on the **phone app**. Sign out after each one.

1. **Google:** tap **Continue with Google** → choose a Google account you haven't used in TaskDrop (for example `narasimharaju7c`) → enter a birth date that makes you over 18 → finish the welcome screens → you're in → **Account** → **Sign out**.
2. **Phone:** tap the phone option → enter a new fake number (website: `9990000011`, phone: `9990000012`) → the code fills in → birth date over 18 → finish → sign out.
3. **Username and password:** choose the username + password option → create a username and password → birth date over 18 → finish → sign out. If there's no way to create one, tell Claude.
4. **Age check, once:** start a phone sign-up with `9990000013` and a birth date that makes you 16. It should refuse you.
5. **Old account, once:** sign in with `9990000002`. You should see Ravi's wallet.
6. Type to Claude a list like: "Web: Google ok, phone ok, username failed (message …). Phone: …. Under-18 refused. Ravi signs in."

---

## Phase 5: Background jobs (Inngest)

### ☑ 5.1 Decide about the money jobs — deferred 2026-10-24

The money jobs (payouts, refund retries, webhooks, and the three money sweeps) stay on their old route until the lawyer answers on the money flow. Nothing to do.

### ◐ 5.2 Switch the jobs over, one at a time (non-money jobs already switched; checked 2026-10-24)

Claude checked the test project: push notifications already go through Inngest (`push_via_inngest` is on), the two prune jobs have moved, and the outbox has nothing waiting (43 events, 0 pending). Only the money sweeps are left on the old route, on purpose (task 5.1). Steps 2 below (look at the Inngest dashboard) are still yours.

1. Type to Claude: "Start the Inngest cutover, one job at a time."
2. After Claude switches each job:
   1. Click: open https://app.inngest.com and sign in.
   2. Click: open **Runs**.
   3. Look: the newest runs should say **Completed** (green), not **Failed** (red).
   4. Tell Claude what you see.

### ☐ 5.3 Test push notifications on the phone (20 minutes)

1. Type to Claude: "Give me the list of push notification types to test."
2. For each type on the list:
   1. Click (phone): sign in as Asha, then close TaskDrop completely.
   2. Click (PC, Ravi): do the action Claude lists (for example, send Asha an offer, or a chat message).
   3. Look (phone): the notification should arrive within a minute.
   4. Click (phone): tap the notification. It should open the right screen.
3. Tell Claude which ones arrived and which opened the right screen.

### ☐ 5.4 Notifications on the website

1. Click (PC, Ravi): while Asha does something on the phone (accept Ravi's offer, send a message), watch the bell on https://taskdrop.in.
2. Tell Claude whether the new items appeared without refreshing.

### ☐ 5.5 Check the admin payout buttons (5 minutes)

1. Click: open the new admin → **Payouts**.
2. Click: **Check with RazorpayX**. It should answer without an error.
3. Look: the RazorpayX **Balance** should show (in test mode it may be ₹0).
4. Tell Claude what each showed.

---

## Phase 6: Photos (ImageKit)

### ☐ 6.1 Change the ImageKit private key (10 minutes)

1. Click: open https://imagekit.io/dashboard and sign in.
2. Click: in the left menu, **Developer options**.
3. Click: find the **private key** and make a new one (and remove the old one, if it offers).
4. Click: copy the new private key.
5. Click: open https://vercel.com → project **taskdrop** → **Settings** → **Environment Variables**.
6. Click: find `IMAGEKIT_PRIVATE_KEY` → **⋯** → **Edit** → paste the new key → **Save**.
7. Click: in `.env.all-secrets` (Notepad), replace `IMAGEKIT_PRIVATE_KEY` and save.
8. Type to Claude: "I changed the ImageKit private key in Vercel. Redeploy so it reaches Supabase."

### ☐ 6.2 Upload photos four ways (15 minutes)

1. Click (PC, Asha in Chrome Incognito): **Post** → add a photo with **choose file** → post.
2. Click (PC): post again, this time **drag** a photo from your desktop onto the photo box → post.
3. Click (phone, Asha): **Post** → **Camera** → take a photo → post.
4. Click (phone): post again with a photo from the **Gallery**.
5. Type to Claude: "I uploaded 4 photos: file picker, drag and drop, camera and gallery. Check they reached ImageKit."

### ☐ 6.3 Chat photo (5 minutes)

1. Click (PC, Ravi): open a job that has started with Asha → chat → send a photo.
2. Click (phone, Asha): open the chat → tap the photo. It should open full size.
3. Tell Claude whether it opened.

### ☐ 6.4 Decide: photos in the admin

1. If you don't need them now: Type to Claude "No photos in the admin for now."
2. If you want them:
   1. Click: Vercel → project **taskdrop-admin** → **Settings** → **Environment Variables** → **Add New**.
   2. Click: Key `IMAGEKIT_PRIVATE_KEY`, value: the new key, environments: all → **Save**.
   3. Type to Claude: "Build photo views in the admin. The ImageKit key is in the admin's Vercel project."

### ☐ 6.5 Speed on mobile data (5 minutes)

1. Click (phone): turn off Wi-Fi so you're on mobile data.
2. Click: close TaskDrop and open it. Count the seconds until the Home pictures show.
3. Tell Claude: "On mobile data the Home feed took N seconds."

---

## Phase 7: Moderation

### ☑ 7.1 Bring in the newest admin tools — done

The Phase 7 admin work is merged into `redesigned-2.0` of the admin repo (PRs 20 and later), and migrations 116 to 121 are applied. Nothing to do.

### ☐ 7.2 Add the dashboard links (5 minutes)

1. Click: Vercel → project **taskdrop-admin** → **Settings** → **Environment Variables** → **Add New**.
2. Click: Key `INNGEST_DASHBOARD_URL`, value `https://app.inngest.com`, environments: all → **Save**.
3. Click: **Add New** again. Key `IMAGEKIT_DASHBOARD_URL`, value `https://imagekit.io/dashboard`, environments: all → **Save**.
4. Type to Claude: "The two dashboard links are set. Redeploy the admin."

### ☐ 7.3 Report a message and hide it (10 minutes)

1. Click (PC, Ravi): on a job that has started with Asha, send the chat message `test message to report`.
2. Click (phone, Asha): open that chat → **press and hold** the message → **Report** → pick a reason → send.
3. Click (new admin): **Reports** → open the new report → **Hide** the message.
4. Click (phone): leave the chat and open it again. The message should be gone.
5. Click (PC): refresh the chat. It should be gone there too.
6. Tell Claude what you saw.

### ☐ 7.4 Block someone (10 minutes)

1. Click (phone, Asha): open Ravi's profile → **Report** → tick **block them too** → send.
2. Click (PC, Ravi): try to send Asha a chat message, and try to make an offer on one of Asha's open tasks. Both should be refused, and Asha's open tasks should be hidden from Ravi.
3. Click (phone, Asha): **Account** → **Blocked people** → **Unblock** Ravi.
4. Tell Claude what happened.

### ☐ 7.5 Warn someone (5 minutes)

1. Click (phone, Asha): open Ravi's profile → **Report** → send (don't block this time).
2. Click (new admin): **Reports** → open it → **Warn them**.
3. Tell Claude whether Ravi got the warning.

### ☐ 7.6 Check the audit log (2 minutes)

1. Click (new admin): open the audit log (under **Security**).
2. Look: the hide and warn you just did should be listed.
3. Tell Claude: "The audit log shows the hide and the warn" (or what's missing).

---

## Phase 8: Store readiness

### ☐ 8.1 Decide on the map

1. Simplest: Type to Claude "Keep OpenStreetMap while testing. Suggest a free map provider for the store version." Claude's note (check each provider's current free limits before choosing): Android already uses Google Maps (restricted key, no tile problem); the weak spot is the web map and the address fallback, which use OpenStreetMap's public servers (not allowed at scale). Options: a tile provider whose free tier allows commercial use, or Google Maps on the web too. The decision can wait until before launch.

### ☐ 8.2 Give the legal details

1. Type to Claude, filled in: "Legal details for the Terms and Privacy pages: business or legal name …, address …, email hitendureacts@gmail.com, grievance officer name …, grievance officer email …, courts in (city) …"

### ◐ 8.3 Set up the app in Google Play Console (1 to 2 hours, and Google may take days to check your ID)

**Claude's part is done (2026-10-24):** every answer and the store texts are in `docs/PLAY_STORE.md`; the 512×512 icon and a plain 1024×500 feature graphic are in `docs/store/`. Still yours: steps 1 to 3 below, entering the answers (step 5), and phone screenshots (type "take the Play screenshots" with your phone plugged in). Skip steps 4 and 6; they are already done.

1. Click: open https://play.google.com/console and sign in with the Google account that should own the app.
2. If you have no developer account yet: choose **Personal**, pay the **$25**, and verify your identity with the ID document Google asks for.
3. Click: **Create app** → App name `taskdrop` → default language **English (India)** → **App** → **Free** → tick the declarations → **Create app**.
4. Type to Claude: "Give me the Play Console answers: data safety, content rating, ads, app access, target audience." Claude drafts every answer from the code.
5. Click: on the app's **Dashboard**, under **Set up your app**, open each item and enter Claude's answers:
   1. **Privacy policy:** `https://taskdrop.in/?page=privacy`
   2. **App access:** "some functionality is restricted", with the test phone `9990000001` and the note "the code fills in automatically".
   3. **Ads**, **Content rating**, **Target audience** (18 and over), **Data safety**: as Claude drafted.
6. Type to Claude: "Make the store listing: short and full description, a 512×512 icon, a 1024×500 feature graphic and phone screenshots."
7. Click: **Grow users** → **Store presence** → **Main store listing** → paste the texts and upload the pictures Claude made → **Save**.

### ◐ 8.4 Upload the store build (built 2026-10-24)

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

### ☐ 10.3 Razorpay live (days to weeks; Razorpay checks your business)

1. Click: https://dashboard.razorpay.com → **Activate account** → fill in business type, PAN, GST (if you have one), bank details (a current account), website `https://taskdrop.in` → upload the documents it asks for → **Submit**.
2. Click: https://x.razorpay.com → activate RazorpayX with the same business and a current account.
3. Wait for both approvals by email.
4. Type to Claude: "Razorpay and RazorpayX are approved for live mode." Then put the live keys in Vault yourself, the same way as task 3.2.

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
