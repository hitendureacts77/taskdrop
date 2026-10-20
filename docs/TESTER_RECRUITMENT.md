# Recruiting testers

Plan box: Phase 0, "Recruit at least 12 testers". Google Play requires **personal developer accounts created after 13 November 2023** to run a closed test with **at least 12 testers opted in continuously for 14 days** before applying for production access (plan, Phase 8). If your Play account is an organisation account the rule may not apply to you; check in Play Console when you set it up, because Google has changed this before.

You are the one who contacts people. This page gives you the message, the sign-up sheet and the steps, so it takes an afternoon.

## Before you invite anyone

- [ ] **Web is open.** `taskdrop.in` currently sends visitors who are not signed in to Vercel to Vercel's login page. Fix it first (plan, Phase 0: Vercel, project `taskdrop`, Settings, Deployment Protection). Turning Vercel Authentication off makes every preview URL of the project open to anyone who has the link; the web bundle is public anyway and data is protected by sign-in and database rules. Check in a private window afterwards.
- [ ] **A build to install.** Testers on Android need an APK or a Play closed-test link. The `beta` profile builds the APK (`apps/mobile/eas.json`, channel `beta`). The newest one has to be built from `redesigned-2.0`; the last EAS build is older.
- [ ] **Push notifications:** no FCM key is stored in EAS yet (Expo, project `taskdrop`, Credentials, Android, "FCM V1 service account key"). Testers will not get push until it is added (plan Phase 1).
- [ ] Tell people it is **fake money and fake data**: no real payment details, ever.

## Who

Aim for **15 people** so 12 still count if three drop out. A mix is best:

- 5 who post tasks (friends, family, neighbours)
- 5 who want to earn (students, freelancers, people with a free weekend)
- 3 to 5 who will try to break it
- At least 12 on **Android with a Google account** (that is what Play counts). The rest can use the web.

## The message (WhatsApp or SMS)

> Hi! I'm building **taskdrop.**, an app where you ask for anything and someone gets it done for you. Tasks can be nearby (fix a tap) or online (write a logo brief). It's in testing and I'd love your help for **two weeks**. It takes about 10 minutes a day, and all money in it is fake.
>
> What I need: install it, make an account, post one task, send an offer on someone else's, and tell me what's confusing or broken. Use a phone number that no other tester uses (two people on one number share one account); a code fills in by itself.
>
> Reply with the **Gmail address you use on your Android phone** (and your phone model) and I'll send the install link.

## Sign-up sheet (a Google Sheet is fine)

| Name | Gmail used on the phone | Phone model + Android version | City | Role (post / earn / break) | Invited | Installed | Joined day |
|---|---|---|---|---|---|---|---|

Keep it private: it holds people's email addresses. Do not paste it into the repo.

## Play Console steps (closed test)

1. Play Console, your app, **Testing, Closed testing**, create a track.
2. **Testers:** create an email list and add the Gmail addresses (or a Google Group).
3. Upload the Android App Bundle (a `production`-style `eas build -p android` AAB; plan Phase 8) and roll it out to the track.
4. Send each tester the **opt-in link** from the track page. They must open it signed in with the listed Gmail, accept, and install from Play.
5. The **14 days start when 12 testers are opted in** (not when you upload the build) and count only while at least 12 stay opted in. Do not remove testers during the window.
6. Until the Play build exists, share the beta APK and the web link instead; the 14-day clock starts only on Play.

## What to ask testers to do

From the plan's core-flow checklist (Part B, section 5.2), in order:

1. Sign up with a phone number, finish onboarding.
2. Post a task (one local, one online).
3. Send an offer on someone else's task; pick an offer on yours.
4. Chat, start the work, mark it done, approve it.
5. Look at the wallet and try a withdrawal (fake).
6. Report anything odd with a screenshot, the phone model and what they tapped.

## Collecting feedback

One shared WhatsApp group plus a simple form (what they did, what they expected, what happened, screenshot). Triage twice a week: serious (money, sign-in, data loss) goes into the plan's current phase the same day.

## When they are done

Thank them. Keep the sign-up sheet only for the closed test. Ask each person whether you may keep their email for the next round, keep only those who say yes, and delete the sheet within 30 days of the test ending otherwise. Share the sheet with nobody else.
