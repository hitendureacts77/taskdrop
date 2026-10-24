# Google Play Console: answers and store listing

Drafted 2026-10-24 from the code, for task 8.3 of `docs/OWNER_MANUAL.md`. Every data answer is traced to `docs/LEGAL_AUDIT.md` section 3 (which cites the files). **Not legal advice and not a compliance claim:** the lawyer review (Phase 10) is still open, and Google holds the developer responsible for the answers, so read each one before you tick it.

## App setup

| Field | Answer |
|---|---|
| App name | `taskdrop` |
| Default language | English (India) |
| App or game | App |
| Free or paid | Free |
| Package | `com.taskdrop.app` |
| Category | Business (alternative: Lifestyle) |
| Contact email | `hitendureacts@gmail.com` (add the support email when you have one) |
| Website | https://taskdrop.in |
| Privacy policy URL | https://taskdrop.in/?page=privacy |
| Account deletion URL (Play asks for one) | https://taskdrop.in/?page=support (the in-app route is Account → Delete account; the support page says how to ask from outside the app) |

## App access

"All or some functionality is restricted." Instructions for Google's reviewer:

> Sign in with phone number 9990000001 on the "Sign in" screen. The 6-digit code fills in automatically on this test build. No other credentials are needed. Switch between Hire and Earn with the mode switch on the Home screen.

(This works only while the `dev_otp_for_all` test shortcut is on. Before the app goes to production, give the reviewer a number that works with real SMS or a fixed test number, and turn the shortcut off: Phase 10.)

## Ads

**No, the app does not contain ads.** (The app has paid *promotions* where a person pays TaskDrop to show their own task higher. That is not advertising by third parties and uses no ad SDK.)

## Content rating (IARC questionnaire)

Category: **Utility, productivity, communication or other**. Honest answers:

| Question | Answer |
|---|---|
| Violence, blood, sexual content, profanity, drugs, gambling | No |
| Users can interact or exchange content | **Yes** (chat, photos, reviews) |
| Users can share their location with others | **Yes**, approximate area only before work starts; exact address after a worker is chosen |
| Digital purchases | No (no in-app purchases or subscriptions; payments are for real-world services through Razorpay) |
| Unrestricted web access | No |

Expected result: Teen / "Rated for 12+" or similar because of user-to-user interaction. Take whatever the questionnaire gives.

## Target audience

**18 and over only.** The app asks for a birth date once at sign-up and refuses under-18s on the server. Do not select any age band below 18, and answer "No" to "appeals to children".

## Data safety form

**Data encrypted in transit:** Yes (HTTPS everywhere). **Users can request deletion:** Yes (Account → Delete account, and by contacting support).

| Google's data type | Collected | Shared | Why | Optional? |
|---|---|---|---|---|
| Approximate location | Yes | Yes (shown as an area to other users) | App functionality | Required to post a task or find nearby work |
| Precise location | Yes | Only after work starts, to the chosen worker/poster | App functionality | Required for a local task |
| Name | Yes | Yes (shown to other users) | App functionality, account management | Required |
| Email address | Yes (Google sign-in only) | No | Account management | Optional |
| Phone number | Yes | Shared with the other party only once work starts | Account management, app functionality | Required for phone sign-in |
| User IDs (username) | Yes | Yes | Account management | Optional |
| Other info: date of birth | Yes | No | Account management (18+ check) | Required |
| Financial info: payment info | Yes | Yes, with Razorpay/RazorpayX (processors) | App functionality | Needed to pay or withdraw |
| Financial info: other (legal name and PAN before the first withdrawal) | Yes | Yes, with RazorpayX | Compliance | Needed to withdraw |
| Messages: other in-app messages | Yes | Yes (to the other person in the chat) | App functionality | Required for chat |
| Photos and videos | Yes | Yes (to people who may see the task) | App functionality | Optional |
| Files and docs | Yes (proof of work) | Yes, to the other party | App functionality | Optional |
| App activity: in-app actions | Yes (promotion views and taps) | No | App functionality | Required |
| App info and performance: crash logs, diagnostics | Yes (Sentry) | Yes, with Sentry (processor) | Analytics, app functionality | Required |
| Device or other IDs | Yes (install id, push token) | Yes, with Expo (push delivery) | App functionality | Optional (push) |

Notes for the form:
- Tick **"Data is processed ephemerally"** for none of these.
- Third parties that act on TaskDrop's behalf (Supabase, ImageKit, Razorpay, MSG91, Sentry, Expo, Inngest) are *service providers*; Google does not count transfers to them as "sharing" if they only process the data for you. The rows marked "Yes" above are the ones where another *user* sees the data. If you prefer the cautious reading, tick "shared" for payments (Razorpay) as in the table.
- Not collected: contacts, calendar, SMS, call logs, health, web history, audio recordings (the microphone permission exists for video recording and voice typing; nothing is recorded in the background).
- **Permissions declared** (`app.json`): approximate and precise location (foreground only; background location is blocked), camera, microphone, photos and videos, notifications.

## Store listing text

**Short description (80 characters max):**

> Ask for anything. Someone gets it done for you.

**Full description (4,000 characters max):**

> taskdrop. is where you post a task in plain words and people near you, or online from anywhere, send offers to do it. You pick the person you like, and TaskDrop holds your money until you approve the work.
>
> HIRE
> • Describe what you need in a few lines, add photos, set a budget and a deadline.
> • Local tasks (carry a sofa, fix a tap) and remote tasks (design a logo, write a report) both work.
> • Compare offers, check profiles and reviews, then choose.
> • Your payment is held safely until you approve the finished work.
>
> EARN
> • Switch to Earn with one tap. Find work near you or online, and send an offer with your own price.
> • Chat with the poster, send proof of your work, and get paid after approval.
> • Withdraw your earnings to UPI or your bank account.
>
> BUILT FOR TRUST
> • Only the area of a task shows until a worker is chosen; the exact address unlocks when work starts.
> • Money is held until approval. If something goes wrong, open a dispute and the TaskDrop team looks at it.
> • Report or block anyone, and delete your account any time from Account → Delete account.
> • You must be 18 or older to use TaskDrop.
>
> One account does both hiring and earning. India first: prices in ₹, pay with UPI.
>
> taskdrop. is in testing: some features are still being finished.

(The last line is honest for the closed test; remove it at launch.)

## Graphics

| Asset | Spec | State |
|---|---|---|
| App icon | 512×512 PNG, under 1 MB | `docs/store/icon-512.png` (the drop with a check, white on jade) |
| Feature graphic | 1024×500 PNG or JPEG | `docs/store/feature-graphic.png`: the drop on the jade gradient, no text. Replace it with a designed one (tagline, screenshots) when you have it |
| Phone screenshots | 2 to 8 images, 16:9 or 9:16, 320 to 3840 px | **Yours.** Needs the app running on the phone; Claude can capture them over USB when you say "take the Play screenshots" (Home, a task, offers, wallet, chat, Earn mode) |

## After you have filled these in

Upload the `.aab` (task 8.4) to **Closed testing**, add the 12 testers, and wait 14 days with them opted in (task 8.6) before applying for production.

## Note: the app icons were the Expo template (fixed 2026-10-24)

`icon.png`, the Android adaptive icon, `splash-icon.png` and the favicon were still Expo's template artwork (a blue chevron and a grid). Claude redrew them as the brand mark (water drop with a check, jade `#0E8F72`) from code, so they are plain and flat. **Look at `apps/mobile/assets/icon.png` and say if you want it changed**; a designer's version can replace these files one for one (same names and sizes). Phones show the new icon only after a new native build (the store build below, or the next APK); an over-the-air update cannot change it.
