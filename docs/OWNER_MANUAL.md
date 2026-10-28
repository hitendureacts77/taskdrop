# TaskDrop owner manual: what to click, phase by phase

This is your part of `docs/UPGRADE_PLAN.md`, written as clicks. There are **two plans** (your request, 2026-10-26): **Plan A, Staging**, the published app and website with fake data and fake money, and **Plan B, Production**, real money and real things, later. Read "The two plans" section (after START HERE) once; it lists every payment production needs. Start with **START HERE** below: it lists what is left, in order. Then open the task it points to. Tick a task's box when you finish it. Last updated 2026-10-26.

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

## YOUR TO-DO LIST: Phases 0 to 9 (what is still pending for you; reordered 2026-10-26)

**The order, and why.** The app comes first. You said you do not want the Android file (the AAB) built until the app and everything about staging are finished, because a file built early is out of date the moment anything changes. So this list has three parts:

1. **Part 1, T1 to T7: finish the app and staging.** Decisions, keys, phone checks, the tour, staff, the runbook, a week of use. Nothing in Part 1 needs a store file.
2. **Part 2, T8 to T11: the Play store.** Only after Part 1 is done. The AAB is built at the start of T10, from the final code, and uploaded the same day.
3. **Part 3, T12: the switch-over.** Last.

**Where things stand.** Phases 0, 1, 4, 5 (except RazorpayX), 7 and the staging guard rails (task A.1) are finished. Everything below is **yours**: a login, an ID, a decision, your phone, or just time. Claude cannot do these for you. Do them in this order; each has its own clicks. When one is done, tell Claude "done T3" (or whatever number) and Claude ticks it in this manual and in `docs/UPGRADE_PLAN.md`.

**The AAB that already exists (a draft, do not upload it).** On 2026-10-26 Claude built an early staging-store build (`cf96b86f`) and saved it at `C:\Users\naras\Downloads\taskdrop-staging-1.0.0.aab`. It is only a working draft and proof that the build works. Do **not** upload it. The one that goes to Google Play is built in T10, after the app is finished. The draft's file expires on 2026-11-25 anyway.

**Google Play account (checked by Claude 2026-10-26):** it already exists. It is a **Personal** account named **NLNarasimhaRaju**, owned by **narasimharaju7c@gmail.com** (account ID 8373724576778921442). In Chrome it is the profile at `/u/0`, not `/u/2`. **No app is created in it yet**, and Google shows two banners that block publishing: **Verify your identity** and **Verify your contact phone number** (that is T8). (The admin rule "sign in only as hitendureacts@gmail.com" is for the admin website. Play Console is a different thing and belongs to narasimharaju7c.)

| # | Task | Phase | Time | Blocks |
|---|---|---|---|---|
| | **Part 1: finish the app and staging** | | | |
| T1 | Answer five decisions in the chat | 8, 2 | 20 min | the legal pages, the exit gate |
| T2 | Two ImageKit values in the admin's Vercel project | 6 | 5 min | admin photos |
| T3 | Approve the app tour design | 8 | 10 min | the tour build |
| T4 | Add your admin staff | A.3 | 10 min | staff access |
| T5 | ☑ Phone checks with your phone plugged in (job on the phone, security checks, mobile data): done by Claude 2026-10-28 | 2, 3, 6 | done | exit gate |
| T6 | ☐ Read the runbook: yours to do | 8 | 20 min | exit gate |
| T7 | ☑ A 30-minute check by Claude, then "the app is finished": **finished 2026-10-28** | 2 | done | T10 |
| | **Part 2: the Play store (only after T7)** | | | |
| T8 | Finish Google's identity and phone checks on the Play account | 8 | 15 min, then Google takes 1 to a few days | T9, T10, T11 |
| T9 | Create the app in Play Console and enter the answers | 8 | 1 hour | T10 |
| T10 | Build the final AAB, then upload it to Internal testing and Closed testing | 8 | 1 hour | T11 |
| T11 | Recruit 12 testers and keep them in Closed testing for 14 days | 8 | 14 days | Phase 9 |
| | **Part 3: the switch-over** | | | |
| T12 | Phase 9: approve and run the switch-over | 9 | 1 hour | last |

Things that are **not** yours to do now: key rotation (3.2, 6.1), Safari and iOS, RazorpayX and live Razorpay (Plan B, task 10.3), the admin authenticator, and OneSignal push campaigns (F.3). They are future scope.

## Part 1: finish the app and staging

### ☑ T1 Five decisions (answer in the chat, one line each) (tasks 8.1, 8.2 and Phase 2) — done 2026-10-28

**Answered 2026-10-28:** 1 keep OpenStreetMap while testing; 2 legal details given (below); 3 keep (profiles keep the rounded place and "last seen"); 4 no Razorpay changes (top-up is tested later); 5 leave the Sales tester as is. **For 2:** Claude set `EXPO_PUBLIC_LEGAL_ENTITY` = Taskdrop, `EXPO_PUBLIC_LEGAL_ADDRESS` = C-602, Casarouge, Jubilee Garden, Road No. 8, Kondapur, Hyderabad, `EXPO_PUBLIC_LEGAL_EMAIL` = hitendureacts@gmail.com (also the grievance email until another is set) and `EXPO_PUBLIC_LEGAL_JURISDICTION` = Hyderabad in the Vercel project `taskdrop` (all environments) and started a rebuild of `redesigned-2.0`. **Moved to future scope (owner, 2026-10-28):** the **Grievance Officer name**, a separate grievance email, the address **PIN code** and `EXPO_PUBLIC_LEGAL_REVIEWED` wait for Phase 10 (task 10.6, the lawyer, and the Legal boxes in the plan). Until then the Privacy page shows no officer name, which is true and is how it reads today. The Android app shows the new details after its next build or update.

1. **Map (8.1).** Reply: "Keep OpenStreetMap while testing." The decision about a paid-friendly provider can wait until before launch.
2. **Legal details (8.2).** Type to Claude, filled in: "Legal details for the Terms and Privacy pages: business or legal name …, address …, email hitendureacts@gmail.com, grievance officer name …, grievance officer email …, courts in (city) …". Until you do, the Privacy page says "Draft, under legal review" and shows no Grievance Officer.
3. **Profiles show a rounded place and "last seen" (P2-33).** Reply "keep" or "hide".
4. **Razorpay test links (P2-36).** The test mode allows 30 payment links and they are used up, and the checkout offered no UPI. Either: (a) click: Razorpay dashboard → switch to **Test mode** (top) → **Payment Links** → cancel the old links, and check **Settings** → **Payment methods** has UPI on; or (b) reply "accept; top-up is tested later". Claude does not touch Razorpay.
5. **Sales tester `hitendu7@gmail.com`.** Reply "remove it" or "leave it". (Tell Claude the staff you want instead in T4.)

### ☑ T2 Two ImageKit values in the admin's Vercel project (task 6.4) — done 2026-10-28 (Claude redeployed the `redesigned-2.0` admin preview and checked in your Chrome: a job with two photos shows both, no "no ImageKit settings" notice; production `taskdrop-admin.vercel.app` not redeployed yet, it picks the values up on its next deploy)

So the admin's Jobs and Copyright pages show photos. No new key is made; you copy what the app already uses.

1. Click: open `.env.all-secrets` in Notepad (in the `C:\complete taskdrop` folder) and find the lines `IMAGEKIT_PRIVATE_KEY=` and `IMAGEKIT_URL_ENDPOINT=`. If they are empty: https://imagekit.io/dashboard → **Developer options** → copy the **URL-endpoint** and the **Private key**. Do not create a new key.
2. Click: Vercel → project **taskdrop-admin** → **Settings** → **Environment Variables** → **Add New**. Add `IMAGEKIT_PRIVATE_KEY` (starts `private_`; tick **Sensitive**) and `IMAGEKIT_URL_ENDPOINT` (looks like `https://ik.imagekit.io/<your id>`). Environments: all. **Save** each.
3. Type to Claude: "The two ImageKit values are in the admin's Vercel project. Redeploy the admin and check the photos."

### ☑ T3 Approve the app tour design (Phase 8) — done 2026-10-28

**Approved 2026-10-28: design v2** (`docs/design/tour/TOUR_DESIGN_V2.html`, clickable reference `docs/design/tour/TOUR_PROTOTYPE.html`, which you tried on your phone: "it feels right"). Your decisions: it starts by itself once, right after onboarding; it is hands-on (five stops, each waits for a tap on the real lit-up control, with a pretend PRACTICE task from post to paid that saves nothing and moves no money); you flip the **real** Hire/Earn switch and the tour puts it back at the end; "tour seen" is remembered per device; it follows your onboarding answer, and "Both" gets a "See the earning side (30 s)" link. Plan v4.70 records it and the Phase 8 box is ticked.

**Built 2026-10-28** ("start Phase 8"): branch `feat/app-tour`, pull request into `redesigned-2.0`, tested in Chrome (not yet on your phone). After the pull request is merged and the `beta` app is updated, try it on your phone: tap your photo, then **Take the app tour**.

### ☑ T4 Add your admin staff (task A.3 step 4) — done 2026-10-28 with dummy people

**Done 2026-10-28 (owner: "add some dummy people by yourself"):** Claude added three fake staff accounts on the test project, all on `@seed.taskdrop.test` emails: Priya (`finance@`, Finance, alerts on), Kiran (`support@`, Support, alerts on), Neha (`viewer@`, Viewer, alerts off). With the seed Test Admin, `hitendureacts@gmail.com` (Admin) and `hitendu7@gmail.com` (Sales, left as is per T1), that is six staff. The dummy ones cannot sign in to the admin (it only admits real allow-listed emails); they exist so the Staff screen and the role limits can be looked at. Add real people any time with the sentence below.

1. Type to Claude: "Add these people as admin staff:" and list each name, email and role (**Sales**, **Support**, **Finance** or **Viewer**). Only people who help run the staging need this.

### ☑ T5 Phone checks (tasks 2.2, 3.9 and 6.5) — done 2026-10-28. Nothing is left that blocks T7; four optional extras wait for your word (listed at the end of this task). Two-step login (T2.10, T2.12) moved to future scope on 2026-10-28

Run by Claude with your phone plugged in. Nothing is left for you to do here.

1. **Job on the phone (2.2).** Run by Claude on 2026-10-28; see task 2.2 below for what worked and the seven problems found. Still open: the top-up (step 18) and promote (step 21). Say "Run the top-up and promote on the phone" when Razorpay test links are available again.
   **Second phone run, 2026-10-28 (a smaller job, ₹20, because Asha's wallet is nearly empty):** post, offer, choose and pay ₹20.60 (₹20 + 3%), start, chat both ways, proof, approve, 5-star review all worked on the phone and the web; Ravi's wallet showed +₹18 (₹20 less the 10% commission). Extra problems found: (a) after choosing an offer, **Back** returns to the offers screen, which still says "Open · 1 offer" with a live "Choose offer" button; (b) in the chat the message box sits **behind the keyboard** while typing (you type without seeing it); (c) a post titled with the word "phone" gets phone-repair wording and the Repairs category from the post writer; (d) after the review the app lands on a different "My requests" screen (no tab bar) instead of My Tasks. Test rows left: "Test: help me carry a sofa phone run" (completed, ₹20.60).
2. **Security checks (3.9).** Run by Claude 2026-10-28 on the installed beta build (1.0.0, installed 2026-10-25, phone plugged in): **T11.2 pass** (manifest and packaged files; details in `docs/testing_checks.md`), **T11.3 partly** (the session lives in the secure store per the code, and the app is not debuggable so its files cannot be read without a rooted phone), **T11.4 pass** (the app's log during the whole job above holds no phone number, email, UPI id, token or key), **T11.5 static only** (no cleartext, no user-certificate trust, no keys in URLs; the live mitmproxy run is **not** done because it needs a tool installed and your phone's proxy changed: say "Run the mitmproxy check" if you want it). Also checked for T2.5 and T2.4: the one Google key in the app is refused by Google from outside the Android app (every API tried answered "blocked"/"not authorized"). **T2.5 looked at by Claude, read only, 2026-10-28 (Google Cloud › Credentials, project Taskdrop, nothing changed):** three keys. `taskdrop-android-maps` is limited to Android apps and 4 APIs; `taskdrop-server-places` is limited to Places API (New); the Firebase **Browser key** is limited to 25 APIs but has **no application restriction** ("can currently be used with any application"). Firebase web keys are meant to be public, but Google recommends limiting this one to your website addresses. Not done, because it is a change to your Google account: say "Restrict the Firebase browser key to taskdrop.in" to have Claude set it. **Future scope (owner, 2026-10-28):** T2.10 and T2.12, switching on two-step login on every account you own (Google, Supabase, Vercel, GitHub, Expo, Sentry, Razorpay), are no longer a step in this manual; do them before real customers arrive.
3. **Mobile data speed (6.5).** Run by Claude 2026-10-28 on mobile data (Wi-Fi off): after closing the app, Home showed its layout in about 2 s, your name and place in about 4 s, and the full Home (including "Your published tasks") in about 6 s. Nothing left for you here.

**Optional extras, each only on your word (none blocks "finished"):** (a) "Restrict the Firebase browser key to taskdrop.in" (a change in your Google account); (b) "Run the mitmproxy check" (installs a tool and changes the phone's proxy for a few minutes); (c) "Run the top-up and promote on the phone" (needs Razorpay test links, see T1 item 4); (d) fix the four problems from the second phone run (Back after choosing an offer, chat box behind the keyboard, the "phone" wording in the post writer, landing on the wrong screen after a review).

### ☐ T6 Read the runbook (task 8.5) — waiting for you; only you can do this one (Claude cannot read it for you). It does not block "finished" in T7, but do it before T12

1. Click: open `docs/RUNBOOK.md` in the repo folder and read it once (about 20 minutes).
2. Tell Claude anything that is wrong or different from how you would really handle it.

### ☑ T7 A 30-minute check by Claude, then "the app is finished" (task 2.6, then A.4 for the app) — **FINISHED, 2026-10-28** (user app on web and Android; see "Final verdict" below)

1. Owner decision 2026-10-28: no week of use. Claude does about 30 minutes of testing on the web, the phone and the admin and then says "finished" or lists what is left.
2. Type to Claude: "Check slow queries and slow operations in Sentry and fix the top ones."
   **First look, 2026-10-28 (read only, no code changed; Sentry, all projects, last 14 days, about 10% of requests sampled so counts are rounded):** no performance issue is open. There are **no database spans**, so Supabase calls show up as HTTP calls. All the data comes from the **admin site**: the user app and phone sent no performance data in that period, so their speed cannot be judged from Sentry yet. Top items, slowest first (typical = 75th percentile): (1) the admin's own `/api/live` call, 3.8 s typical, 5.3 s worst, about 360 samples; (2) admin page loads: `/payouts` 6.4 s (one sample), `/login` 4.4 s, `/promotions` 3.5 s, `/users` 2.1 s; (3) `razorpayx-payouts` function 2.1 s (one call; payouts are paid by hand now); (4) Supabase reads: `admin_money_position` 0.79 s, `payouts` last-1000-rows reads 0.60 to 0.65 s, `user_roles` list 0.63 s, `crm_user_tags` (up to 20,000 rows) 0.51 s, `admin_staff` 0.41 s. The sign-in checks (`user_roles`, `admin_staff`, `settings`) repeat on every admin page. Likely fixes, **not started**: find why `/api/live` takes 3.8 s; cut the repeated sign-in checks per page; add a limit or summary to the 1000-row and 20,000-row reads. Say "Fix the Sentry slow items" to start, and "Turn on performance data for the app" if you want the app measured too.
   **Claude's check, 2026-10-28 (verdict: not finished yet).** What passed: the whole fake job (post, offer, choose and pay, start, chat, proof, approve, review, money split) ran twice today on the phone and the web with the right amounts; the live website loads and shows Home; no performance issue is open. What is left: (1) **Sentry is not quiet**: 11 issues were open in the last 24 hours, but all come from our own testing today (test users `5eed…0001`/`0002`, one IP, your phone on mobile data, Chrome on this PC). Three are app errors from that testing (`status 0` while Wi-Fi was off, one `503` from the api function at 11:10 UTC, one "Something went wrong"). Eight are **CSP reports** on taskdrop.in: the site's content-security policy, which is only reporting and not blocking, does not list Google reCAPTCHA / App Check (`www.google.com`, `www.gstatic.com`, `content-firebaseappcheck.googleapis.com`), `vercel.live` or `blob:` connections; it must be fixed before the policy is switched to blocking, or sign-in checks would break. (2) **Test data on Home is not clean**: titles such as "ddd", "aaa", "lokking for a mechanic…", "[e2e-phone] report check job", "Test camera photo phase 6" and a place in Thailand ("Ban Phaya Wat") would show in the Play screenshots. Cleaning means deleting or hiding staging rows, so it needs your OK. (3) The tour (PR 112) is not merged, so the beta app does not have it. (4) The admin site was not re-checked in this pass. **Re-run, 2026-10-28 (verdict: still not finished).** Done since: 27 junk open tasks set to cancelled on staging (none funded; ids start 2aa1e2ab, ad564a4e, a9d06d1f, 0a3e921d, fcde3821, fdb0c33a, cfca3749, eefa9032, 5538cc0a, c47660d7, d4c3ac2c, 37caaa1e, e39ba985, 3dad4b8c, b2e3b1be, eb544785, 76fb1042, 82b6d3c0, c61af7fe, 1afd4914, c04d2ea3, bf79d4f8, bb2386c6, a3cc7690, c44f2639, 1975faa3, 3863033d; set them back to OPEN to undo), and the policy fix is PR 113 into `redesigned-2.0` (open, checks running, not merged or deployed). Home no longer shows the junk or the Thailand place. New problem found: Home for a Madhapur user now says "No jobs within 10 km yet", and "Matches your skills" shows only Bengaluru jobs, so the Play screenshots need a handful of realistic open jobs near Madhapur (new fake data; say "Add realistic Madhapur jobs"). The admin sign-in page loads; I did not sign in to it, so the admin screens were not re-checked. **Fixed the same day:** 6 realistic fake open jobs were added (ids start 2ab380d3, c8b83b3e, a936dcc0, 52848291, 30333a67, 0fcc58c2: bathroom tap ₹500, wardrobe ₹800, post-office parcel ₹250, AC service ₹700, resume proofread ₹300, product descriptions ₹600; due in 1 to 5 days, from `seed_asha` and `seed_meera`). Home on the web now shows them under "Matches your skills", "Jobs near Madhapur" (under 1 km) and "Remote & online". The one urgent Bengaluru job that showed under "Needed today" ("Rewire two bedroom sockets", id a7b73913, ₹1,400, 1 offer, unfunded) was also set to cancelled; "Needed today" no longer shows on Home. **Merged 2026-10-28 on the owner's word ("merge everything"):** PR 112 (the app tour) and PR 113 (the policy fix) are both in `redesigned-2.0`, with all their checks passing; their branches are deleted. The tour is on the website once Vercel has deployed; the beta APK got it when Claude published update group `338017ec-bee4-4920-b9e7-3d7ee94fec0d` to the `beta` channel on 2026-10-28 (redesigned-2.0 at 9ab3269, Sentry source maps uploaded). **On your phone:** open TaskDrop twice (the first launch downloads, the second runs it), then tap your photo and **Take the app tour**. Claude has not yet seen it run on the phone: the phone was busy with the Play Store when the update went out.
   **Final verdict, 2026-10-28: the app is finished.** Checked after the merges, on the live site: the new site policy is serving on taskdrop.in (deployed on the third try; the first three Vercel builds failed at the "deploy Edge Functions" step with a jsr.io timeout and then "Bundle generation timed out", which is the Supabase function deploy being flaky, not our code, and the live site stayed on the previous good build meanwhile). A fresh page load now produces no Google reCAPTCHA or App Check policy reports, and Sentry shows those issues last seen before the deploy. The only fresh reports are `vercel.live`, the Vercel toolbar that only you see; it was left out of the policy on purpose. Home on the web shows the new Madhapur jobs and no junk. The fake job ran twice end to end. **Not covered, so you know:** (1) the admin screens were not re-checked, because the admin sign-in is your Google account (a 2-minute look from you: sign in, open Jobs, Staff and Wallet); (2) the beta Android app got the tour on 2026-10-28 but Claude has not seen it run on the phone yet (open the app twice, then tap your photo › Take the app tour); (3) a new row "Hshshhdh" (₹750, remote) appeared on Home at about 12:00 UTC from someone's testing, not from Claude; say "Cancel the Hshshhdh task" if you want it gone before screenshots; (4) T6 is yours. Sentry's two slow-query lists in step 2 are not fixed (you said no code changes yet). **Gap in the build:** the Vercel build deploys every Edge Function before it publishes the web app, so one flaky Supabase deploy blocks the whole site. Say "Make the Vercel build retry the function deploy" if you want that hardened.
3. Type: "Check that the app and staging are finished." Claude checks that Sentry is quiet, no serious issue is open, the whole fake job works on web, Android and admin, and that the test data on screen is clean (so the Play screenshots look right). Claude replies "finished" or lists what is left. **Only after that reply do you start T10.**

## Part 2: the Play store (only after T7 says "finished")

### ☐ T8 Finish Google's checks on the Play account (Phase 8, task 8.3 steps 1 to 2)

This does not involve the app file, and Google's check takes days. If you want to save time you may start it while Part 1 is going on. It is listed here because nothing in Play can start until it is done.

Google will not let any app be published until both banners on the account home page are done.

1. Click: open https://play.google.com/console/u/0/developers and, if Chrome asks which Google account, pick **narasimharaju7c@gmail.com**. Click the developer account **NLNarasimhaRaju**.
2. Click: on the **Home** page, in "Finish setting up your developer account", next to **Verify your identity** click **Get started**.
3. Click: choose the type of ID Google lists, then upload a clear photo or scan of it. The name on it must match the name on the Play account. Do not edit or crop the document in a way that changes it; Google warns that this makes the check fail.
4. Click: back on Home, next to **Verify your contact phone number** click **View details** and follow the steps (Google sends a code to your phone). If it also asks you to check an Android device, install the **Google Play Console** app from the Play Store on your phone, sign in as narasimharaju7c@gmail.com and approve.
5. Wait. Google says the ID check can take several days. The two banners disappear when it is done.
6. Tell Claude: "Play account is verified." (A screenshot of the Home page without the two banners is fine.) Claude last looked on 2026-10-26: both banners were still there.

### ☐ T9 Create the app and enter the answers (Phase 8, tasks 8.3 and 8.2)

Do this after T8 shows verified and T7 says "finished". Everything is already written for you in `docs/PLAY_STORE.md`; the icon and the feature graphic are in `docs/store/` (`icon-512.png`, `feature-graphic.png`).

1. Click: Play Console → **Create app**. App name: `taskdrop`. Default language: **English (India)**. **App**. **Free**. Tick the declarations. **Create app**.
2. Type to Claude: "Give me the Play Console answers: data safety, content rating, ads, app access, target audience." Claude sends every answer, copied from the code.
3. Click: on the app's **Dashboard**, open each item under **Set up your app** and enter Claude's answer:
   1. **Privacy policy:** `https://taskdrop.in/?page=privacy`
   2. **App access:** "All or some functionality is restricted". Test phone `9990000001`, note: "the 6-digit code is shown on screen in a Test mode box; type it in".
   3. **Ads:** no ads. **Content rating:** answer the questionnaire as Claude says. **Target audience:** 18 and over. **Data safety:** as Claude drafted.
4. Type to Claude: "Take the final Play screenshots." (Plug your phone in and unlock it first.) Claude takes them from the finished staging app and crops them to Play's size. A set of five drafts from 2026-10-26 is in `C:\Users\naras\Downloads\taskdrop-play-screenshots\`; they are from before the app was finished and two of them show leftover test rows ("Bsnsnms", "TEST:", "[e2e-phone]"), so do not use them for the real listing.
5. Click: **Grow users** → **Store presence** → **Main store listing**. Paste the short and full descriptions from `docs/PLAY_STORE.md`, upload the icon, the feature graphic and the screenshots → **Save**.
6. Optional: if you would rather not type these in, say "Fill the Play Console for me" and watch your Chrome. Claude types the answers into the forms. **You** click every declaration and every Save or Send for review.

### ☐ T10 Build the final AAB, then upload it (Phase 8, task 8.4)

Start this only when T7 has said "finished" and T8 shows verified.

**Why it is built now and not earlier.** A store file is a snapshot of the code on the day it is built. Building it last means it contains everything from Part 1. Claude uses the `staging-store` profile (merged as taskdrop PR 99): the fake-money test project, the `beta` update channel (so small fixes later reach testers without a new upload), and the staging ribbon. Never put it in the **Production** track.

1. Type to Claude: "The app is finished. Build the store version (AAB)." Claude builds it from the final code (about 15 to 20 minutes), downloads it and tells you the file path. (Claude checks the build page for you; you do not need to open anything.)
2. Click: Play Console → your app → **Test and release** → **Testing** → **Internal testing** → **Create new release**. Upload the `.aab` Claude gave you. If Google asks about **Play App Signing**, accept it. **Next** → **Save** → **Start rollout**.
3. Click: **Testers** tab of Internal testing → **Create email list** → add the Gmail addresses of people who should try it first (up to 100) → **Save**. Copy the **opt-in link** and send it to them. They can install in minutes. There is no Google review for Internal testing.
4. Click: **Testing** → **Closed testing** → **Create track** (any name, for example `staging testers`) → **Create new release** → upload the **same** `.aab` → **Save** → **Send for review**. Closed testing may take Google a day or more to approve.
5. Click: in Play Console → **Setup** → **App signing**, copy the **SHA-256 certificate fingerprint** and send it to Claude. Claude adds it to the Android app's Play Integrity settings (task 3.5, step 4), so App Check works for Play-installed copies.
6. Tell Claude: "The AAB is in Internal and Closed testing."

### ☐ T11 Twelve testers for 14 days (task 8.6)

Google requires this before it allows a production release. The 14 days count from the day 12 testers have opted in, and they must stay opted in the whole time. This cannot be sped up.

1. Click: open `docs/TESTER_RECRUITMENT.md` and send its message to at least **12** friends, more if you can (some will drop out). Ask for Gmail addresses.
2. Click: Play Console → **Testing** → **Closed testing** → your track → **Testers** → create an email list with their addresses → **Save**.
3. Click: copy the **opt-in link** and send it to them with the "How staging works" text from task A.3, step 5. Each person must tap the link, accept, and install the app from Google Play.
4. Click: write the date the 12th person opted in. Count 14 days from it. Ask testers to open the app and do the core-flow checklist (`docs/ANDROID_TEST_PLAN.md`) at least a few times in those 14 days.
5. Tell Claude: "The 14 days are done." Claude then checks the exit gate (task A.4): Sentry quiet for 7 days, no serious open issue, the whole fake job working on web, Android and admin.

## Part 3: the switch-over

### ☐ T12 Phase 9: the switch-over (tasks 9.1 to 9.4)

**Start only when T1 to T11 are done and the 14 days are over.** Production is a separate plan (Plan B). Phase 9 only moves your testers to the new app; it does not start real money.

1. Type to Claude: "Check the staging exit gate." Claude replies with what is left, if anything.
2. Type to Claude: "Phases 0 to 8 are done. I approve the switch-over." (task 9.1)
3. Click: message your testers: "Please install the new TaskDrop app from this link:" and paste the link Claude gives you. (task 9.2)
4. Type to Claude: "Do the switch-over, one step at a time." Claude asks before each step (the redirects, the database lockdown, removing the old code, making `main` from the upgraded branch). Read each one and reply **yes** or ask a question. (task 9.3)
5. Click: open https://taskdrop-five.vercel.app (it should take you to https://taskdrop.in) and https://taskdrop-admin.vercel.app (the new admin). Tell Claude what you saw. (task 9.4)

### Claude's own open items (you only need to say "go")

- Idle fix: done (admin PR 27, merged). Still to do: the two-tab test once (task 3.7, P2-43), which needs you at the keyboard.
- Old remote branches: removed 2026-10-26 (all were fully merged). Still to do: "recheck the Terms and Privacy staging notice in the app" and "check the other screens on my phone".
- Staging notice and other screens on the phone: rechecked 2026-10-26 (update `be84c00a`). Terms and Privacy show the Staging box and the ribbon sits directly under the status bar with no gap; Help & support, Account & settings and My complaints also have no gap. Still unchecked on the phone: the other pushed screens (task page, chat, offers, withdrawals) and the signed-in admin pages.
- "Run the e2e tests again here" (task 2.5; the GitHub run waits for `main`, Phase 9).

---

## START HERE: what is left, in order (checked 2026-10-25, rechecked 2026-10-26)

**Update 2026-10-26 (afternoon), what Claude finished without you:** the **admin idle sign-out test** (task 3.7, run 5 passed); the **web App Check proof** (task 3.5: 18 `valid` web calls, none failed, so App Check is proven on both web and Android); the **web source-map check** (task 1.4, rechecked in the Vercel build log); **Uptime Robot** (both monitors Up, 100% over the last 24 hours, 0 incidents); task **6.3** is marked done (the chat-photo update reached the phone on 2026-10-25). **Correction to step 4 (task 6.4):** the ImageKit values are not in the Vercel project `taskdrop`. Copy them from `.env.all-secrets` (both lines have values) or the ImageKit dashboard; the clicks are fixed.

**Update 2026-10-26:** Google sign-in is **fixed** (task 0.1): new Google key in Supabase, tested by Claude on the website and the admin (both signed in as `hitendureacts@gmail.com`). Also tested on the Android app. Left from it: the third admin idle sign-out test (task 3.7), which Claude started at 11:34 on 2026-10-26. The App Check PR 84 is now **merged**.

Claude checked everything in Phases 0 to 8 that can be checked without you (evidence: `docs/PHASE0_8_CHECK_2026-10-25.md`). **Phases 0, 1, 4, 5 (except RazorpayX) and 7 are finished.** What is left needs you (a login, a payment, a decision), your phone, or time. Do these in order; each one points to the full clicks lower down.

| # | What | Who | Time | Full clicks |
|---|---|---|---|---|
| 1 | ~~Fix Google sign-in~~ **Done 2026-10-26**, tested on web, admin and Android. | Done | - | Task 0.1 |
| 2 | **Phone session: done 2026-10-25 by Claude** (build `505485f8` installed; App Check proven on Android: the server logged `valid` for 74 calls from the phone; the update for the chat-photo viewer is on the phone and the full-size photo opens; App Check PR 84 merged). The web App Check proof was done by Claude on 2026-10-26. Still open from this step: a fresh Android job run (task 2.2; plug in the phone and say "run the job on the phone"). | Claude | done | Tasks 2.2, 3.5, 6.3 |
| 3 | **Staging guard rails** (so the published app and website are clearly fake-money): the "Staging: fake money and fake data" ribbon, the check that refuses a live payment key, `noindex`, the tester card, the staging wording in Terms and Privacy. Type "Build the staging guard rails." Claude builds, shows you the design first, and you approve. | Claude builds, you approve | 15 min of your time | Plan A, task A.1 |
| 4 | **Two values in the admin's Vercel project** (the ImageKit photo values, copied from `.env.all-secrets`), so the admin shows job photos. | You | 5 min | Task 6.4 |
| 5 | ~~Admin idle sign-out test.~~ **Run 5 passed 2026-10-26** on the upgrade admin (signed out after 30 idle minutes, with the message). A fix for two open admin tabs keeping each other alive is ready on a local branch; say "push the idle fix". | Claude | done | Task 3.7 |
| 6 | **Your decisions:** the map for the store version, the legal details, whether profiles may show a rounded place and "last seen", and the Razorpay test-link limit. | You, in the chat | 20 min | Tasks 8.1, 8.2 and the list under "Decisions" below |
| 7 | **Google Play Console, Way 1 (testing, fake data).** The Play account exists (narasimharaju7c@gmail.com, Personal) but needs Google's identity and phone checks first; see T8 to T11 in the to-do list above. These come after the app is finished (T1 to T7): create the app, enter the answers, then build the final AAB and upload it to Internal and Closed testing only (see "Google Play Console: the two ways"). The AAB is built last, at T10, with the `staging-store` profile; the draft build of 2026-10-26 and the 2026-10-24 build are not uploaded. | You | 1 to 2 hours (Google may take days to check your ID) | Tasks 8.3, 8.4 |
| 8 | **Read the runbook** and finish the security checklist (Claude's own T2 checks passed on 2026-10-26; the phone and "You" items are left). | You | 30 min | Tasks 8.5, 3.9 |
| 9 | **Mobile data speed test.** Switch Mobile data on in the phone's settings first. | You say go; Claude times it | 10 min | Task 6.5 |
| 10 | **A week of normal use,** then ask Claude for the slow-screen check. | You | 1 week | Task 2.6 |
| 11 | **The 12 testers** (14 days in Play closed testing). Only when you are ready. | You | 14 days | Task 8.6 |
| 12 | **Staging exit gate**, then the switch-over (Phase 9). When every test above is done and the 12 testers have used the closed test for 14 days, type "Check the staging exit gate." **Production is a separate, later plan (Plan B below): it starts only when you say "I want to launch."** | You say go; Claude checks | 10 min | Plan A task A.4, Phase 9 |

**Also open, no rush:** the RazorpayX payout buttons (need RazorpayX, task 10.3); the app tour design sign-off (Phase 8, not built yet). (Uptime Robot: checked by Claude 2026-10-26, both green.) Key rotation (3.2, 6.1), Safari and iOS stay future scope.

**Decisions waiting for you (answer in the chat, one line each):**

1. Map for the store version (task 8.1): keep OpenStreetMap while testing, or choose a paid-friendly provider before launch.
2. Legal details (task 8.2): business name, address, grievance officer name and email, courts city. The live Privacy page still shows no Grievance Officer name.
3. Profiles show a rounded place and "last seen" to other people (P2-33): keep, or hide?
4. Razorpay test mode allows 30 payment links and they are used up (P2-36). Claude cannot change Razorpay, so either wait for the limit to clear or accept that top-up is tested later.
5. The Sales tester `hitendu7@gmail.com`: remove it, and seed admin roles for other staff, or leave as is.

**Rules for the steps below:** the admin signs in only with `hitendureacts@gmail.com` (owner rule, 2026-10-25). In Google's account chooser, pick **hitendureacts**. If the chooser opens on `narasimharaju7c@gmail.com`, that account is a normal user, not an admin. In Chrome the right profile is the one at `/u/2`.

---

## The two plans: Staging (fake money) now, Production (real money) later

Written 2026-10-26 from your request. The full detail is in `docs/UPGRADE_PLAN.md`, Part B, section 14. In short:

| | **Plan A: Staging** | **Plan B: Production** |
|---|---|---|
| Money | **Fake.** Razorpay test keys, no RazorpayX, workers are "paid" by an admin marking it done by hand. Nothing touches a bank | **Real.** Razorpay and RazorpayX live keys, real UPI and bank |
| Data | Fake. Three seed accounts and what testers make | Real customers, a brand-new empty database |
| Where | The Supabase project you have now, `taskdrop.in`, the Android app, the admin | A **new** Supabase project, new Vercel values, new Inngest, ImageKit and Sentry settings |
| Who | You and about 10 invited testers | The public |
| Cost | **Nothing monthly.** At most the Google Play account, $25 once | Real monthly costs, see "Where you pay" below |
| Phases | 0 to 9 | 10 |

**Four promises that keep staging fake:** live payment keys are never put into the staging project; every screen shows an "Staging: fake money and fake data" ribbon; testers never type real addresses, ID numbers or bank details; nothing from staging is copied into production.

### Plan A: Staging, in order

| # | Step | Who | Cost | Where |
|---|---|---|---|---|
| A.0 | Phases 0 to 7 work, Google sign-in works on web, admin and Android | Claude | 0 | **Done** (open items are in START HERE) |
| A.1 | **Build the staging guard rails** and approve their wording | Claude builds, you approve | 0 | Task A.1 below |
| A.2 | **Finish the open tests:** admin photo values, idle test, your decisions, runbook, mobile-data test | You and Claude | 0 | START HERE items 4, 5, 6, 8 and 9 |
| A.3 | **Publish the website, the Android app and the admin to testers** | You | **$25 once** (Play), nothing else | Task A.3 below, tasks 8.3 and 8.4 |
| A.4 | **Staging rounds, then the exit gate** (12 testers for 14 days, Sentry quiet 7 days, the whole fake job works on web, Android and admin) | You, testers, Claude | 0 | Task A.4 below, tasks 8.6, 2.6 |
| A.5 | **Phase 9:** everyone moves to the upgraded app | You approve, Claude does | 0 | Phase 9 |

### ☐ A.1 Build the staging guard rails (you approve; 15 minutes of your time)

1. Type to Claude: "Build the staging guard rails." Claude builds these and shows you each one before it goes live: the `environment` setting and the check that refuses a live payment key; the "Staging: fake money and fake data" ribbon on the website, the Android app and the admin; the `noindex` setting so search engines skip the website; a "How staging works" card shown once after sign-in; the "Staging" notice in Terms and Privacy.
   Claude's three helper sessions are building it (started 2026-10-26): the backend (the `environment` setting and the live-key check), the user app (ribbon, card, `noindex`, Terms and Privacy notice) and the admin ribbon. Each ends in a pull request that is **not merged** until you approve.
   **Status 2026-10-26 (later): approved, merged and deployed.** Checked live by Claude: the website ribbon and `noindex`, the admin ribbon, and the backend setting. The Android update is published and Claude checked it on your phone (2026-10-26, 16:38): the ribbon shows. It first left an empty strip under it on the sign-in screen; that is fixed (PR 96, update published, rechecked at 16:48). After you signed in Claude walked the five tabs and two pushed screens on your phone (read-only): the ribbon shows everywhere and the tester card appeared. The five tabs are clean; the pushed screens with their own header (profile, messages) had an empty strip under the ribbon; that is fixed too (PR 97, update published, rechecked at 17:00). Sign in yourself (any number, the code shows in the yellow box) and tell Claude what you see. **Your part now:** unlock the phone, open TaskDrop, close it fully and open it again (the first open downloads the update, the second runs it), and look for the ribbon at the top; then sign in once and look for the "How staging works" card. Tell Claude what you see, or say "check my phone" with the screen unlocked and plugged in. Original pull requests: backend [taskdrop#94](https://github.com/hitendureacts77/taskdrop/pull/94), user app [taskdrop#95](https://github.com/hitendureacts77/taskdrop/pull/95) (screenshots in `docs/staging-guard-rails/` on that branch), admin [taskdrop-admin#28](https://github.com/hitendureacts77/taskdrop-admin/pull/28). Not yet checked on a real Android phone (the ribbon may leave a small gap under the status bar on screens with their own header); Claude checks that with your phone plugged in after you approve.
2. Click: look at the pictures and the wording Claude sends (the ribbon, the card, the Terms notice). Nothing is live yet. Reply **approved**, or tell Claude what to change (for example "make the ribbon smaller" or "change the card text to ...").
3. Type to Claude: "Approved. Merge the staging guard rails and deploy them." Claude merges the three pull requests, applies the new database step (one setting, nothing is removed), deploys the functions, the website and the admin, and tells you when it is done.
4. Click: open https://taskdrop.in on your PC and the app on your phone. You should see the ribbon "Staging: fake money and fake data", and after signing in once, the "How staging works" card. Open the admin and look for the same ribbon.
5. Tell Claude what you saw (a screenshot is fine). That finishes A.1.

### ☐ A.3 Publish staging to testers (1 to 2 hours; $25 once if you have no Play account)

1. **Website:** nothing to click. `taskdrop.in` is the staging. Tell Claude: "Check the staging website." Claude opens Terms, Privacy and Support and the ribbon.
2. **Android, fastest:** Type to Claude: "Give me the staging APK link." Send that link to your testers. They install the app from it. No Google review, no cost.
3. **Android, Google Play:** do tasks 8.3 and 8.4 (create the Play app, upload the store build). Upload it to **Internal testing** (up to 100 testers, no Google review, minutes) and also to **Closed testing**; the 14 days of closed testing start counting from the day 12 testers opt in.
4. **Admin:** Type to Claude: "Add these people as admin staff:" and give names, emails and roles (Sales, Support, Finance, Viewer). Only people who run the staging need this.
5. **Tell your testers** (copy this): "This is a staging. All money and all data are fake. Use the test accounts or your own Google login. Do not type a real address, ID number or bank account. Report problems to hitendureacts@gmail.com."

### ☐ A.4 Run staging and pass the exit gate

1. Click: ask each tester to do the core-flow checklist (post, offer, pay, work, approve, review, withdraw). `docs/TESTER_RECRUITMENT.md` and `docs/ANDROID_TEST_PLAN.md` are the kits.
2. Tell Claude the problems; Claude adds them to `docs/PHASE2_PROBLEMS.md` and fixes them.
3. After two rounds with no serious open problem, 14 days of the closed test and 7 quiet days in Sentry, type to Claude: "Check the staging exit gate." Claude replies with what is still open.

### Plan B: Production, in order (starts only when you say "I want to launch")

Start the first four **early and in parallel**; they cost little and take days to weeks. Do not wait for staging to finish to start the lawyer and the bank.

| # | Step | Who | **Pay?** | Task |
|---|---|---|---|---|
| B.1 | **The business basics:** legal entity, PAN, GST if you have one, a **current bank account** | You | Bank fees | 10.0 |
| B.2 | **The lawyer:** send `docs/LAWYER_BRIEF.md`; get the money-flow answer (does the wallet need RBI authorisation; may TaskDrop hold escrow or must Razorpay Route do it), the Terms and Privacy review, DPDP | You | **Lawyer's fee** (ask for a quote) | 10.6 |
| B.3 | **Razorpay and RazorpayX activation (KYC)** | You | **Per-payment and per-payout fees** | 10.3 |
| B.4 | **SMS:** DLT registration, sender name, OTP template, MSG91 credits | You | **DLT fee (one time, about ₹5,000) + the 5,000 SMS pack, ₹1,250 + GST** | 10.4 |
| B.5 | **Play production access** (after the 14-day closed test): listing, data-safety form | You | (Play account already paid) | 8.3, 10.9 |
| B.6 | **DMCA agent**, grievance officer, legal details in the app | You | **$6 per 3 years** | 10.5, 8.2 |
| B.7 | **Turn on the paid plans:** Supabase Pro, Vercel Pro, Inngest paid | You | **$25 + $20 a month + Inngest (check price)** | 10.2 |
| B.8 | **Build production** (new empty Supabase project, secrets, functions, Inngest production, ImageKit `/prod`, Sentry `production`, new Google redirect address) | Claude, with you for logins | Covered by B.7 | 10.7 |
| B.9 | **Switch on the real-money parts, one at a time:** live keys (you put them into Vault yourself), RazorpayX **funded**, the money jobs, payouts, refunds | Claude builds and switches | **RazorpayX balance** (see below) | 10.3 steps 3 and 4, 10.7 |
| B.10 | **Switch off every test shortcut:** the "any number signs in" code, `ALLOW_ANY_OTP`, `TEST_PHONES`, the staging ribbon; switch the admin authenticator back on | Claude | 0 | 10.7 |
| B.11 | **Domains:** production on `taskdrop.in` and `admin.taskdrop.in`; the staging moves to `beta.taskdrop.in` | You and Claude | Domain renewal ~$6 a year | 10.7 |
| B.12 | **One real ₹10 job** with your own UPI, finished from a second account, withdrawn to your bank | You | Real ₹10 plus fees | 10.8 |
| B.13 | **Launch gate, then release on Google Play** | You | 0 | 10.9 |

### Google Play Console: the two ways

Same Play app (`com.taskdrop.app`), two ways to publish into it. Detail: `docs/UPGRADE_PLAN.md` section 14.7; store answers: `docs/PLAY_STORE.md`.

| | **Way 1: Testing (fake data, fake money)** | **Way 2: Production (real data, real money)** |
|---|---|---|
| Track | **Internal testing**, then **Closed testing** | **Production** |
| Who sees it | Only the Gmail addresses you add. Not findable in the Play Store | Everyone |
| Build file | The **staging AAB** (test project, Razorpay test keys, ribbon on) | A **new production AAB** that Claude builds in Phase 10 (task 10.7) |
| Starts | Now (tasks 8.3, 8.4, 8.6) | Only when you say "I want to launch" (task 10.9) |

**Way 1, in order** (fake data; $25 once for the Play account):

1. Do task 8.3 (create the app, enter the answers, listing).
2. Do task 8.4: upload the staging AAB to **Internal testing** first. Add your testers' Gmail addresses; they install from the private link within minutes.
3. Upload the same AAB to **Closed testing** and do task 8.6 (12 testers, 14 days). Do this early; the 14 days are what unlock Way 2.
4. Leave **Production** alone. Nothing public exists until you create a Production release.

**Way 2, in order** (only after "I want to launch", the lawyer's answer, and the staging exit gate):

1. Claude builds the production AAB (Phase 10, task 10.7): new project, live keys, every test shortcut off, higher version number.
2. Apply for production access in Play Console (it asks about the closed test) and update the content that changed: the **App access** instructions (the test number only works while the shortcut is on), the data-safety form, and the store text (remove "taskdrop. is in testing").
3. Task 10.9: **Production** → **Create new release** → upload the production AAB → **Send for review**.

**Never:** put the staging AAB in the Production track, create a Production release before you say "I want to launch", or treat the 14-day closed test as a way to publish.

### Where you pay for production (and why)

| Payment | Why you need it | Amount (check the page when you pay) | When |
|---|---|---|---|
| **Lawyer** | The money-flow answer decides how payouts and refunds are built; also Terms, Privacy, DPDP | A fee; ask for a quote | **First** (B.2) |
| **Current bank account** | Razorpay and RazorpayX require one | The bank's fees | First (B.1) |
| **Razorpay** (payments in) | Every real card or UPI payment by a poster, held in escrow | A fee per payment | After KYC approval (B.3) |
| **RazorpayX** (payouts out) | Paying workers and refunds to their UPI or bank | A fee per payout, **and its balance must hold the money to pay out**. How the balance is funded depends on the lawyer's answer, so plan this working capital yourself | B.9 |
| **MSG91 + DLT** | Real sign-in codes to real phones; without DLT registration the SMS is blocked | One-time DLT fee (about ₹5,000), then ₹0.25 per SMS on the 5,000 pack (₹0.16 to ₹0.20 in bigger packs); `docs/SMS_OTP.md` has the cheapest plan | B.4 |
| **Supabase Pro** | The production project, with backups (free projects pause when idle) | $25 a month | Before real users |
| **Vercel Pro** | The free plan is for non-commercial use | $20 a month per member | Before real users |
| **Inngest paid plan** | The free plan allows 50,000 runs a month and stops when it is used up (about 28,500 were used by 24 October with only the testers) | Check its Billing page | Before real users |
| **Google Play account** | Publishing the Android app | $25 once (already paid if you did A.3) | During staging |
| **DMCA agent** | Legal protection for uploaded photos | $6 per 3 years | B.6 |
| **Google Maps / Places** | Maps and place search at real volume | Pay per use after the free credit; billing is already active with a ₹100 monthly alert, raise it when traffic starts | Before the store release |
| **Domain `taskdrop.in`** | Already bought | About $6 a year; auto-renew on | Yearly |
| Sentry, ImageKit, EAS, Uptime Robot | Free tiers cover staging | Pay only if a limit warns | As needed |
| Apple Developer ($99 a year) | iOS only | **Future scope**, not in this launch | Later |

**Staging costs: $0 a month.** The only payment is the Google Play account, $25 once, and only if you publish through Play (the direct APK link is free).

---

## Phase 0: Foundations

Phase 0 was done earlier. One new fix came up on 2026-10-25 (it was not part of Phase 0, but nothing else works well until it is done):

### ☑ 0.1 Fix Google sign-in — done 2026-10-26 (P2-50), tested on web, admin and the Android app

**Done 2026-10-26.** The Google Cloud project **Taskdrop** has the consent screen **In production** and a new Web client `TaskDrop Supabase`; its Client ID and secret are in `.env.all-secrets` and in Supabase (Authentication → Providers → Google). Claude tested Google sign-in on the website (taskdrop.in), the admin and the installed Android app (signed out the seed account, Google, `hitendureacts`): all three signed in. Nothing is left here. The steps below are kept for a re-run.

**What was wrong:** tapping Google on the web, the Android app or the admin shows Google's "Error 401: deleted_client, The OAuth client was deleted". Supabase's Google sign-in still points at a Google login key (OAuth client) from one of the Google Cloud projects that was shut down on 2026-10-22. Claude confirmed this from outside the browser: asking Supabase for the Google login redirects to Google, and Google refuses it. Only you can fix it: it needs a new key made in your Google account and its secret entered in Supabase. This is a replacement for a deleted key, not a key rotation.

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
2. ~~Left: check a build log.~~ Rechecked 2026-10-26 through the Vercel connection: the build of `a5181e7` (deployment `dpl_EYH7BHo5…`) bundled the same 6 scripts and 6 maps with debug ids, Sentry already had them ("Nothing to upload, all files are on the server"), and the build then removed the 6 `.map` files. Nothing left.

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

### ◐ 2.2 Run one full job on the phone and the PC — web half done 2026-10-25; Android phone half run 2026-10-28 by Claude, two steps still open (18 top-up, 21 promote)

**Done on the web (phone-sized window as the poster, desktop window as the worker):** post with a photo and a place, offer, accept and pay from the wallet, slide to start, chat with a photo, proof photo, mark done, approve (steps 5 to 15), plus a withdrawal request and cancel. All worked. Not finished: the Razorpay top-up (step 18; Razorpay test mode has a 30-link limit that was used up, and the checkout offered no UPI: see P2-36), review stars, dispute, cancel-with-fine and promote by screen (the money paths are covered by the automatic tests). **Android phone, run 2026-10-28 by Claude (build `505485f8`, Asha on the phone, Ravi in the built-in browser on the PC):** the core job worked end to end: sign-in, post, offer (₹500), choose and pay ₹515 from the wallet, start, chat with a photo, proof with a photo, mark done, approve and release, 5-star review; Ravi's wallet showed +₹450. Also worked: cancel a task (17), dispute with the payment held at ₹51.50 (19), edit "About" on the profile and keep it after a restart (20), notifications on both sides (22). **Not done, so this task is not ticked:** step 18, the top-up, failed with "Could not start the payment" (the same Razorpay limit, P2-36); step 21, promote, was refused with "This task already has a campaign running" and a new campaign was not started (needs an open post with no campaign and enough wallet money, so it waits on the top-up); the post photo (step 6) and the profile photo (step 20) were skipped because the phone's picker shows your personal gallery. **Problems found:** (1) the phone does not refresh by itself: Worker offers said "No offers yet" and the task still said "Worker to start" until pulled down; (2) Asha's saved place is "Ban Phaya Wat" (Thailand), so Ravi sees a distance of about 2368 km; (3) "Approve and release payment" spun about 25 seconds; (4) the review screen shows ₹515 right after approval but ₹500 when reopened from Done, and Done still says "Tap to review the worker" after the review saved; (5) the web lists (My Work, Wallet) were stale until a page reload, and Wallet briefly shows "Available ₹0"; (6) the task shows category "Other" on the phone but "Services" on the web card; (7) Asha's wallet is down to ₹21.50 with ₹6,746.50 locked in 15 tasks (mostly leftover "[e2e] dispute" rows), so the next test needs a top-up or a clean-up. Test rows left behind: "Test: help me carry a sofa" (completed), "Test: dispute job" and "Test: second task to cancel" (cancelled), "Test: dispute job 2" (in dispute, ₹51.50 held).

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

### ☑ 3.5 App Check — proven on Android (2026-10-25) and the web (2026-10-26)

**Web proof done 2026-10-26 by Claude:** signed in to https://taskdrop.in in your Chrome (Google, `hitendureacts`) and opened Wallet, My Work and Notifications. The `api` log shows `app check { result: "valid", platform: "web" }` on all 18 lines after that, with no `invalid` and no `missing`. Left for you, no rush: item 3 below (delete two unused debug tokens) and item 4 (before a Play Store build).

**Done (2026-10-25):**
- The server check (monitor mode) is on in the `api` function.
- Firebase: the web app and the Android app are registered in App Check (web: reCAPTCHA Enterprise key for taskdrop.in and localhost; Android: Play Integrity with the EAS keystore SHA-256 `02:B6:21:92:…:C2:AB:3F`). The API key behind `google-services.json` now also allows the Firebase App Check API.
- Vercel holds the six App Check values; the web client and the Android client are merged into `redesigned-2.0`, and taskdrop.in serves a build that contains the web config (a bug that left it out was fixed in PR 83).
- Android beta APKs use a Firebase **debug token** because Play Integrity refuses an APK installed by hand ("App attestation failed"). The token (`EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN`) is an EAS `preview` variable and is in `.env.all-secrets`; PR 84 (the code that uses it) was merged into `redesigned-2.0` on 2026-10-25.

**Left:**
1. ~~Claude: finish the Android test.~~ Done 2026-10-25 (build `505485f8`, 74 `valid` calls).
2. ~~Open https://taskdrop.in signed in.~~ Done 2026-10-26 by Claude (18 `valid` web calls).
3. You: in Firebase → App Check → `taskdrop Android` → ⋮ → **Manage debug tokens**, delete the two older tokens named `beta apk` when convenient (they are unused).
4. Before a Play Store build: add the Play Console app-signing SHA-256 to the Android app's Play Integrity settings, and test once from a Play-installed copy (that is the only real Play Integrity test).
5. ~~Claude: tick this step.~~ Ticked 2026-10-26 (plan Phase 3, both App Check boxes). Phase 9 may switch enforcement on.

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

### ☑ 3.7 Check the admin signs you out when idle — **run 5 passed 2026-10-26** on the upgrade admin

**Run 5 (Claude, your Chrome, upgrade address with admin PR 26):** the admin was opened at 13:36:55 and not touched. At 14:08 the tab was on the sign-in page with "You were signed out after 30 minutes without activity. Sign in again." The admin's log shows no clock restart after 13:36:55, so nothing kept the session alive. **One more thing found:** when the idle time is up, each admin tab reloads itself, and the server counted that reload as activity. With **two** admin tabs open a few minutes apart, each tab's reload would restart the clock before the other ran out, so you would never be signed out. That may explain the earlier misses. Claude fixed it on the local admin branch `fix/admin-idle-guard-background-check` (the idle tab now asks the server in the background instead of reloading). It is **not pushed yet**: say "push the idle fix" and Claude opens the PR. After that, the old address `taskdrop-admin.vercel.app` still has the old code until you promote `redesigned-2.0` to `main`.

Earlier history: Claude tried twice 2026-10-25: once it signed out by itself after about 30 minutes, once a click after 32 minutes still worked (P2-43). Run 3 on 2026-10-26 was **void**: the Vercel log shows someone opened payout rows in the admin tab at 11:48 to 11:49 (not Claude), which restarted the 30-minute clock. **Run 4 (12:11 to 12:50 on 2026-10-26) did not sign out:** a click 39 minutes after the last one still loaded, with a 30-minute limit. Claude did not touch the tab; it could not prove nobody else did. The likely cause is in the admin code: some of Next's background page prefetches are counted as "you are active" (P2-43). Claude fixed it on 2026-10-26 (admin PR 26: every kind of Next prefetch is now ignored, and the admin logs what restarts the idle clock). **The fix is only in the upgrade admin** (`taskdrop-admin-git-redesigned-20-hitenduteam.vercel.app`); the address `taskdrop-admin.vercel.app` is the old **main** admin, which stays as it is until you promote `redesigned-2.0` to `main` by hand. Runs 3 and 4 were on that old address. Run 5 is on the upgrade address. Until it passes, sign out yourself when you leave the admin.

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

### ◐ 3.9 The security checklist — Claude's own T2 checks passed 2026-10-26

**Done by Claude, no phone needed** (evidence in `docs/testing_checks.md`): T2.2 no secret under a public name; T2.3 the live website's code holds no secret (only the public Firebase web key, no Maps key, no source maps served); T2.6 the git history of both repos (one known item: the old Razorpay **test** keys, which you accepted on 2026-10-25); T2.11 the secrets file is ignored by git and EAS and is not on the website. Also checked: the App Check debug token is only in beta builds, never in the store build.

**Left, with you:** T2.4 and T11.2 (the APK scan needs tools that are not on this PC; Claude can install them when you say so), T11.3 to T11.5 (phone plugged in), and the "You" item T2.5 (key restriction screenshots). T2.10 and T2.12 (two-step login on every account) moved to future scope on 2026-10-28.

1. Type to Claude: "Run testing_checks T11.2 to T11.5 with me. My phone is plugged in." Claude tells you what to tap.

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
| 6.3 Chat photo | ☑ done: the full-size view (app PR 85) reached the phone in update f0b7d18b on 2026-10-25 and opens |
| 6.4 Photos in the admin | ◐ merged (admin PR 25); needs your two Vercel values (START HERE step 4) |
| 6.5 Speed on mobile data | ⚠ not run: mobile data is off on your phone |

**What Claude needs from you to finish (nothing else is open):**

1. **Vercel, 2 values (6.4).** In project `taskdrop-admin` add `IMAGEKIT_PRIVATE_KEY` and `IMAGEKIT_URL_ENDPOINT`, copied from your `.env.all-secrets` file or the ImageKit dashboard (clicks in 6.4; corrected 2026-10-26: the Vercel project `taskdrop` does **not** hold them). No key is changed. Do not paste them into the chat.
2. **"Push" (6.3 and 6.4): done.** Both branches were merged into `redesigned-2.0` (app PR 85, admin PR 25) on 2026-10-25.
3. ~~"Send the phone update" (6.3).~~ Done 2026-10-25 (update f0b7d18b); a chat photo opens full size on the phone.
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

### ☑ 6.3 Chat photo — done 2026-10-25 by Claude (web and phone; the full-size view reached the phone in update f0b7d18b and opens)

Ravi sent a photo; the signed link opened for both Ravi and Asha (the image downloaded) and was refused for a stranger.

**Phone (Asha, beta APK):** the photo Ravi sent earlier shows in the chat on the phone, and a picture Asha sent from the phone (**+** → **Choose from gallery**) showed at once and is in `media` as a chat photo, attached. **Tapping a photo did nothing:** the code had no full-size view for chat photos (P2-49 in `docs/PHASE2_PROBLEMS.md`). Claude added one on branch `fix/chat-photo-fullsize` (app repo, commit 5aab2eb, not pushed): tap a photo, it opens full screen; tap anywhere, the cross or Back to close. It works in the web build at phone size. It is not on your phone yet, so step 2 will still do nothing there until the change is pushed, merged and sent as an update (items 2 and 3 in the list at the top of Phase 6).

1. Click (PC, Ravi): open a job that has started with Asha → chat → send a photo.
2. Click (phone, Asha): open the chat → tap the photo. It should open full size.
3. Tell Claude whether it opened.

### ◐ 6.4 Photos in the admin — built and merged into `redesigned-2.0` of the admin repo (admin PR 25, 2026-10-25); waits for your two Vercel values (START HERE step 4)

**What Claude built:** the admin's **Jobs** page now has a "Photos and files" card with the job's own photo and every proof file the worker sent (each opens full size in a new tab), and the **Copyright** page shows the job photo beside each complaint so staff can compare. The links are signed on the server with the same method the app uses (a test checks it against the app's own signer, byte for byte) and expire within two hours; the keys never reach the browser. Older uploads in Supabase Storage show too. The admin's security policy now allows images from ImageKit and the Supabase project. If the two values are missing, the card says "ImageKit is not set up for the admin yet" instead of breaking. The admin's 94 automatic tests, typecheck and lint pass. **Not yet seen on screen:** it needs the two values and a deploy first.

No new key is made: copy the values the app already uses. (An earlier version of this manual asked for a third value, `IMAGEKIT_ENV`. It is not needed.)

**Corrected 2026-10-26:** earlier versions said to copy them from the Vercel project `taskdrop`. Claude checked the variable names there (not the values): that project has **no** ImageKit values, and its build log says "not set in Vercel, left as they are in Supabase". Supabase does not show a secret's value once saved, so take them from one of these two places:

1. Click: open `.env.all-secrets` in Notepad and find the lines `IMAGEKIT_PRIVATE_KEY=` and `IMAGEKIT_URL_ENDPOINT=`. (If they are empty there: https://imagekit.io/dashboard → **Developer options**: the **URL-endpoint** and the **Private key** (the eye or copy icon). Copy them; do not make a new key.)
2. Click: Vercel → project **taskdrop-admin** → **Settings** → **Environment Variables** → **Add New**. Add these two, environments: all, tick **Sensitive** for the private key → **Save** each:
   1. `IMAGEKIT_PRIVATE_KEY`: the private key (starts `private_`).
   2. `IMAGEKIT_URL_ENDPOINT`: it looks like `https://ik.imagekit.io/<your id>`.
3. Type to Claude: "The two ImageKit values are in the admin's Vercel project. Redeploy the admin and check the photos." (Both Phase 6 branches are already merged; a new admin build is needed so it reads the values.)

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

### ☑ 8.1 Decide on the map — done 2026-10-28: keep OpenStreetMap while testing; a provider is chosen before launch

1. Simplest: Type to Claude "Keep OpenStreetMap while testing. Suggest a free map provider for the store version." Claude's note (check each provider's current free limits before choosing): Android already uses Google Maps (restricted key, no tile problem); the weak spot is the web map and the address fallback, which use OpenStreetMap's public servers (not allowed at scale). Options: a tile provider whose free tier allows commercial use, or Google Maps on the web too. The decision can wait until before launch.

### ☑ 8.2 Give the legal details — done 2026-10-28 for staging: business name, address, email and courts city are set in Vercel (see T1). Grievance Officer name, PIN code and the lawyer review moved to future scope (Phase 10, task 10.6)

1. Type to Claude, filled in: "Legal details for the Terms and Privacy pages: business or legal name …, address …, email hitendureacts@gmail.com, grievance officer name …, grievance officer email …, courts in (city) …"

### ◐ 8.3 Set up the app in Google Play Console (1 to 2 hours, and Google may take days to check your ID)

**Status 2026-10-26:** your Play account already exists (Personal, narasimharaju7c@gmail.com, Chrome profile `/u/0`). Google still wants **Verify your identity** and **Verify your contact phone number**, and no app is created yet. Full clicks: tasks T8 and T9 in the to-do list at the top (after the app is finished, T1 to T7). **Claude's part is done (2026-10-24):** every answer and the store texts are in `docs/PLAY_STORE.md`; the 512×512 icon and a plain 1024×500 feature graphic are in `docs/store/`. Still yours: steps 1 to 3 below, entering the answers (step 5), and final phone screenshots (type "take the final Play screenshots" with your phone plugged in, after the app is finished). Skip steps 4 and 6; they are already done.

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

### ◐ 8.4 Build the final store file and upload it (built last, at task T10, after the app is finished)

**Order (owner, 2026-10-26):** the AAB is built only after the app and everything about staging are finished (to-do list T1 to T7), so the file holds the final code. Retired: the 2026-10-24 build (no staging ribbon, no update channel). A draft of the new `staging-store` profile (taskdrop PR 99) was built once on 2026-10-26 to prove it works; it is not uploaded. The full clicks are task **T10** in the to-do list at the top. Steps 3 to 5 below still apply.

1. Type to Claude: "Build the store version (AAB)."
2. Click: Claude gives you a download link. Download the `.aab` file.
3. Click: Play Console → **Test and release** → **Testing** → **Closed testing** → **Create track** (or open the existing one) → **Create new release**.
4. Click: upload the `.aab` → **Next** → **Save** → **Send for review** (or **Start rollout**).
5. **For the staging (Plan A, task A.3):** do steps 3 and 4 twice, once under **Internal testing** (up to 100 testers, no Google review, ready in minutes, the fastest way to give testers the app) and once under **Closed testing** (its 14 days are required before Google allows production, so start them early). Both stay fake-money: the app uses Razorpay test mode.

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

This is **Plan B: Production** (see "The two plans" above for the order and "Where you pay for production" for every payment). Real money, real customers, a **new** Supabase project. Nothing from staging is copied over. The tasks below keep their numbers; follow the Plan B table for the order, and start the slow ones (10.0, 10.6, 10.3, 10.4) early and in parallel.

### ☐ 10.0 The business basics (first; days)

1. Decide the legal entity that will own TaskDrop (sole proprietor, partnership, or company) and tell Claude, so the legal pages can name it (task 8.2).
2. Get the documents Razorpay, RazorpayX and the SMS registration will ask for: PAN, GST number if you have one, address proof.
3. Open a **current bank account** in that name. Razorpay and RazorpayX need it, and a bank charges its own fees.
4. Tell Claude: "The business basics are ready." This is the first thing in Plan B: every later step waits on it.

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

1. Click: open `docs/SMS_OTP.md`. Read **"The cheapest plan"** first: stay on MSG91, buy only the **5,000 SMS pack (₹1,250 + 18% GST)**, and pay the one-time DLT fee (about ₹5,000). Firebase phone sign-in costs about ₹6 per code, so it is not the cheap way.
2. Follow its DLT steps: register your business on a DLT portal, register the sender name and the OTP message template.
3. Tell Claude the template ID and sender name.
4. Later, when you send more than about 30,000 SMS a month, ask MSG91 sales for their ₹0.13 rate.

### ☐ 10.5 DMCA agent (15 minutes, $6)

1. Click: open https://dmca.copyright.gov → **Register** → make an account.
2. Click: designate an agent: name, address, email, phone → pay **$6**.
3. Type to Claude: "DMCA agent registered:" followed by the name, email, address and phone.

### ☐ 10.6 The lawyer

1. Click: send a lawyer `docs/LAWYER_BRIEF.md` and the links `https://taskdrop.in/?page=terms` and `https://taskdrop.in/?page=privacy`.
2. When they answer: Type to Claude "Here is the lawyer's answer:" and paste it.

### ☐ 10.7 Production

1. Type to Claude: "Set up production." Claude builds a **new, empty** Supabase project (Pro plan, task 10.2), a production Inngest environment, ImageKit `/prod` and Sentry `production`, and asks you for the logins it cannot do alone. This also turns off every test shortcut (the "any phone number signs in" code, `ALLOW_ANY_OTP`, `TEST_PHONES`), removes the staging ribbon, sets the `environment` setting to `production` (so a `rzp_test_` key is refused), turns the admin authenticator back on, and moves the staging website to `beta.taskdrop.in`. Staging accounts and data are not copied.
2. Click: Google Cloud Console → project **Taskdrop** → **Auth Platform** → **Clients** → `TaskDrop Supabase` → add the new Supabase project's address ending in `/auth/v1/callback` under **Authorized redirect URIs** → **Save**. (Claude gives you the exact address.)

### ☐ 10.8 One real job with real money (20 minutes)

1. Click: with live keys on, post a ₹10 job as yourself and pay with your own UPI.
2. Click: complete it from a second account, approve it, and withdraw to your bank.
3. Tell Claude whether the money arrived.

### ☐ 10.9 Release on Google Play

This is Way 2 of "Google Play Console: the two ways" (Plan B). Use only the production AAB that Claude builds in task 10.7, never the staging AAB.

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

## Future scope: OneSignal (push campaigns)

Nothing here is needed now. Do it only after you tell Claude "start OneSignal". The plan item is `docs/UPGRADE_PLAN.md`, Part B, section 13.1.

What it is for: sending **campaign** pushes (for example "no task posted in 7 days") from a dashboard, with segments, scheduling, automated journeys and open/click numbers. It is **not** needed to reach Android and iOS together, because the push we already send does that. The event notifications ("a helper accepted your task") stay on the current push system.

### ⏸ F.3 Start OneSignal

1. Type to Claude: "Start OneSignal."
2. Claude lists the clicks: create the OneSignal account and app, link it to the Taskdrop Firebase project, then a new Android build with the OneSignal SDK. This section grows then.
3. Before launch, the Terms, Privacy and Play data-safety form must name OneSignal, and the lawyer should see it (task 10.6).
