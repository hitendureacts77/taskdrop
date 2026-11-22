# One-tap login: plan

Status: **plan only, nothing built.** Written 22 Nov 2026 against `redesigned-2.0`.
Owner request: "one-tap login so customers sign in fast."

---

## 1. The recommendation in plain words

Most TaskDrop customers sign in with their **phone number**, so the biggest win is making the phone code feel like one tap. Google is the second door.

1. **Android app: phone first, almost no typing.** When the sign-in page opens, Android shows a small sheet listing the phone's own SIM numbers ("Phone Number Hint"). One tap fills the number. When the code SMS arrives, Android asks "Allow TaskDrop to read this one message?" ("SMS User Consent"). One tap fills the code and signs the person in. Accounts work exactly as they do today. No new company sees any data. It needs one new app build (not an OTA update).
2. **Android app: Google in a bottom sheet.** "Continue with Google" opens Android's own account sheet (Credential Manager) instead of a browser tab. One tap on the account signs the person in. The `wjxvingpfbfvkfqhrguj.supabase.co` line on Google's page goes away in the app.
3. **Website: Google One Tap.** On the sign-in page and in the guest "Make your account" pop-up, Chrome shows Google's small "Continue as Priya" card. One tap and the person is in, with no page reload. The current "Continue with Google" button stays as the fallback. The supabase.co screen also goes away on the website.
4. **Website: code autofill.** One small fix now: the code box tells the browser the wrong field type, so phones do not offer the code from SMS. Later, when real SMS is switched on, Chrome on Android can fill the code itself (WebOTP), if the SMS text ends with one special line.
5. **Truecaller: not now.** It is the closest thing to a true one tap in India, but it adds a new company that receives user data, needs their approval, only works when the Truecaller app is installed, and the lawyer review is still open. Look again after launch if many people give up at the code step.

**Fix one possible security hole first, before any of this (section 6, step S1).** It exists today, not only after this work.

What it costs: nothing in fees. Google sign-in and these Android features are free. SMS costs fall as more people use Google.

---

## 2. What exists today (checked in code and docs, 22 Nov)

| Way in | How it works | State |
|---|---|---|
| Phone code | `supabase/functions/phone-auth`: the server makes and checks a 6-digit code, then creates or finds the account `p<10 digits>@phone.taskdrop.app` (email already confirmed) and returns a magic-link `token_hash`. The app calls `supabase.auth.verifyOtp({ token_hash, type: 'email' })` (`AuthProvider.tsx` `verifyCode`). Two doors: `signin` (refuses unknown numbers) and `signup` (asks the birth date first). | Works. **No real SMS yet:** MSG91 and DLT are not set up, so `dev_otp_for_all` is ON in staging and the code is shown on screen. Admin phone numbers are refused (they use Google or username). |
| Google | `supabase.auth.signInWithOAuth` redirect. Web: the same tab goes to Google and comes back with `?code=`. Native: `WebBrowser.openAuthSessionAsync` browser tab and a deep link back (`AuthProvider.tsx` `signInWithGoogle`). | **Working.** The deleted OAuth client (P2-50) was replaced on 26 Oct by the web client `TaskDrop Supabase` (OWNER_MANUAL 0.1, tested on web, admin and Android). The memory note saying "down" is out of date. Google's page shows "to continue to wjxvingpfbfvkfqhrguj.supabase.co" (plan 2.22 (e)). |
| Link Google to a phone account | `linkIdentity`. | Off: Supabase "manual linking" is switched off (owner). The app shows "Linking Google is not switched on yet." |
| Username + password | `supabase/functions/password-auth`. | Works. |
| Apple | iOS only. | iOS is future scope. |
| Guest mode (D15) | No session; drafts and saves move into the account if the guest signs in from the "Make your account" pop-up (`lib/guestHandoff.ts`, B31). Google's web redirect needs a hand-off mark kept across the page reload. | Live. Decision 25 (an "I am 18 or older" tap before guest mode) is decided but not built. |
| Age 18 gate | Migration 082. A new phone number is asked for the birth date before the code is sent. Google sign-ups are asked on their first launch, and onboarding cannot finish without it. Under 18: an empty account is deleted, one with history is suspended. | Live. |
| Sign-up guard hook (H21) | Migration 138 `hook_before_user_created`: lets every provider through except an unconfirmed email sign-up. | ON in staging. It does **not** check the admin "sign-ups open" switch for Google. |
| Admin sign-in switches | `_shared/signInSwitches.ts`: maintenance, update required, sign-ups paused, phone off, password off. | Google can only be **hidden in the app** (`features.signInGoogle`). The server cannot refuse it. |
| App Check | Monitor mode. Web uses reCAPTCHA Enterprise. Android uses Play Integrity (needs the Play SHA-256) plus a debug token in beta APKs. | Checks only the `api` function. It does not touch sign-in. |
| Code box | `AccessScreen.tsx` line 703: `autoComplete="sms-otp"`, `textContentType="oneTimeCode"`. | Android: correct. **Web:** react-native-web passes `sms-otp` straight into HTML, which browsers ignore. The correct value is `one-time-code`. |
| Web security headers | `vercel.json` CSP has no `accounts.google.com`. | Google's One Tap script would be blocked until the CSP allows it. |
| Android packages | `com.taskdrop.app` (today and production), `com.taskdrop.app.staging` (planned variant). Local builds (`C:\td-tools\b5\lb.mjs`) sign with the same EAS keystore, so the SHA-1 is the same as EAS. | EAS Android builds are out until 1 Dec. |

---

## 3. The options

| | What the person does | Fits phone-first accounts? | Platforms | New native build? | Outside party / data | Effort | Verdict |
|---|---|---|---|---|---|---|---|
| **a) Google One Tap on the web** (Google Identity Services + `signInWithIdToken`) | One tap on "Continue as …" | Makes a **separate** Google account (as today's Google button does) | Web: Chrome/Edge desktop and Android. Safari and Firefox show it less reliably, so the button stays | No (website + OTA) | Google (already used) | Small to medium | **Do (phase 2)** |
| **b) Android Credential Manager Google sheet** + `signInWithIdToken` | One tap on the account in a bottom sheet | Same as (a) | Android | **Yes** | Google (already used) | Medium (small native module) | **Do (phase 3)** |
| **c1) Phone Number Hint** (Android) | One tap on the SIM number | **Yes, exactly.** Same `phone-auth` flow | Android | **Yes** | None (Google Play services on the phone) | Small | **Do (phase 3)** |
| **c2) SMS User Consent** (Android) | One tap "Allow" when the SMS arrives | **Yes** | Android | **Yes** | None | Small | **Do (phase 3)**, useful once real SMS is live |
| c3) SMS Retriever (Android, no tap at all) | Nothing | Yes | Android | Yes | None | Small, but the SMS must carry an 11-character app hash that differs for staging, production and Play signing, and must sit inside the DLT template | **Skip.** User Consent gives nearly the same result without the hash problem |
| **c4) WebOTP + `one-time-code`** (web) | One tap "Allow" (Chrome Android) or keyboard suggestion (iPhone Safari) | Yes | Web | No | None | Tiny | **Do (phase 1)**. WebOTP stays idle until real SMS |
| **d) Truecaller SDK** (OAuth SDK 3.0) | One tap "Continue" on the Truecaller sheet | Yes: the server would swap Truecaller's code for the verified number and reuse the `p<phone>@` account | Android, and only if Truecaller is installed. Non-Truecaller users fall back to our OTP | Yes | **Truecaller gets a new data flow.** Needs a Privacy Policy and DPDP update and the lawyer's view | Medium + partner approval (per package + SHA-1) + a server code exchange | **Later.** Re-decide after launch with real drop-off numbers |

**Truecaller details.**
For: very common in India; the number comes verified with no SMS cost; it fits the phone-first account model perfectly.
Against: one more processor of personal data while the lawyer review is open; the React Native wrappers are thin (Truecaller's own sample, or community packages) and untested on RN 0.88 / new architecture; Truecaller must approve the app, and every package and signing key needs registering; some users distrust it; a brand dependency on the most sensitive screen; no web.

---

## 4. How each fits the account model

1. **Two kinds of account stay separate.** A phone account is `p<phone>@phone.taskdrop.app`. A Google account is the person's Gmail. One Tap does not change this. The risk grows, though: One Tap makes it so easy to tap Google that someone who already has a **phone** account can end up with a **second, empty** account (their tasks, reviews and payouts are in the other one). Manual linking stays OFF (owner).
   - Plan: after a Google sign-in that **just created** an account (`created_at` within a minute, which the code already checks with `existedBefore`), show one sheet: "New here, or do you already use TaskDrop with your phone number?" with **I'm new, continue** and **Use my phone number instead**. The second choice signs out. The empty account is left for the existing cleanup, or deleted with the self-delete path if it has nothing in it (decision D2 below).
2. **Sign-in vs sign-up.** `signInWithIdToken` always creates an account when none exists. That is today's Google behaviour too. The `intent` value only changes the message.
3. **Sign-ups paused.** The admin switch does not stop Google today. Add it to the before-user-created hook (step 4.2): refuse provider `google` when `signups_open` is false. This needs a migration, so ask first.
4. **Age 18.** No change. A Google account is asked for its birth date on first launch, as today. A phone sign-up is asked before the code, as today. Phone Hint only fills the number.
5. **Guest to account.** Better than today on the web: no page reload, so the hand-off mark (`saveGuestHandoffMark`) is not needed for One Tap. The session appears while the pop-up's sign-in page is still showing, so `guestHandoffLive()` holds. Keep the mark for the redirect fallback. Show One Tap to guests only from the sign-in page and the "Make your account" pop-up, never as an automatic prompt on every page (decision D1).
6. **Admins.** Admin phone numbers already cannot use SMS. Google One Tap would let an admin into the **user** app with Google, same as the button does today. No change.
7. **Shared phones (common in India).** On sign-out, call `google.accounts.id.disableAutoSelect()` on the web and `clearCredentialState()` on Android. Otherwise the next person on that phone could be signed back in as the previous one. Start with `auto_select: false` (one tap, never zero taps).

---

## 5. Security: what must be right

| Risk | Rule |
|---|---|
| **Replay of a stolen ID token** | A fresh random nonce for every attempt (32 bytes, `expo-crypto`). Give Google `sha256(raw)` as hex. Give Supabase the raw value: `signInWithIdToken({ provider: 'google', token, nonce: raw })`. This applies to both the web (GIS `nonce`) and Android (`GetGoogleIdOption.setNonce` / `GetSignInWithGoogleOption.setNonce`). Keep Supabase "Skip nonce checks" **OFF**. |
| **Token issued for another app (audience)** | Supabase checks `aud` against the Google provider's "Client IDs" list. That list holds only TaskDrop's own clients, with the web client first. Never verify Google tokens ourselves in an Edge Function, and never accept an ID token from a URL parameter. |
| **Account takeover through email auto-linking. Check now (S1).** | Supabase automatically adds a new Google identity to an existing user with the **same verified email**. Phone accounts use `p<phone>@phone.taskdrop.app`. Whoever controls the domain **`taskdrop.app`** could create a Google Workspace user `p9876543210@phone.taskdrop.app` and sign in with Google **into that person's phone account**. `taskdrop.app` is registered (Cloudflare name servers, looked up 22 Nov), but no TaskDrop doc says the owner holds it. **This hole exists today with the current Google button.** Fix: (1) the owner confirms they own `taskdrop.app` and that it has no Google Workspace; and (2) belt and braces: a server check that refuses a Google identity whose email ends in `@phone.taskdrop.app`. The before-user-created hook does not run on auto-link, so this needs a Custom Access Token hook that refuses a session for such a user, or a check in `phone-auth`/`api` [opus]. |
| Forged One Tap callback on the web | GIS hands the credential to our JS callback only. Do not use the `login_uri` POST mode (no server endpoint, no CSRF surface). |
| CSP widening | Add only `https://accounts.google.com/gsi/client` (script), `https://accounts.google.com/gsi/` (frame, connect, style). Nothing broader. |
| SMS User Consent | The person sees the full message and must tap Allow. Extract only a 6-digit code next to the word "TaskDrop". Never log the SMS text (rule 9). |
| Phone Hint | The number is a suggestion. The server still verifies it by code. Normalise `+91XXXXXXXXXX` to 10 digits. The server already refuses non-Indian numbers. |
| Logs | Never log the ID token, nonce, phone number or email. Use `lib/scrub.ts` as the last net only. |
| Rate limits | `signInWithIdToken` counts under Supabase's token limit (300 per 5 min per address, task 2.8b). This is enough. |

---

## 6. Build steps

Each step is tagged for who builds it (root CLAUDE.md model split). Each phase is one short branch and PR into `redesigned-2.0`. Run `npm run check`, then the `security-review` skill on the diff, before merging.

### Phase S: the security check first

- **S1 [opus]** Confirm with the owner who owns `taskdrop.app`. If unknown or not ours, design the guard: refuse sessions for a Google identity on `@phone.taskdrop.app`, as a Custom Access Token hook or an equivalent check. Write a SQL test (`npm run test:db`) that a user whose `identities` include google with such an email gets no token. Migration: **ask the owner before applying.** Add it as a hole (H-number) in `docs/ULTIMATE_PLAN.md`.

### Phase 1: quick wins (website + OTA, no native build)

- **1.1 [sonnet]** `AccessScreen.tsx` code box: `autoComplete={Platform.OS === 'web' ? 'one-time-code' : 'sms-otp'}`. Check that pasting a full 6-digit code into the hidden input fills all boxes. Done when: a unit or e2e check shows the rendered `<input autocomplete="one-time-code">`.
- **1.2 [sonnet]** WebOTP helper `lib/webOtp.web.ts` (+ a no-op `.ts`): when the code stage opens on the web and `'OTPCredential' in window`, call `navigator.credentials.get({ otp: { transport: ['sms'] }, signal })`. Abort it on leaving the stage or after 5 minutes. Fill the code and let the existing auto-verify run. Unit test with a mocked `navigator.credentials`. It stays idle until real SMS carries the `@taskdrop.in #123456` last line (owner step O7).
- **1.3 [sonnet]** Update `docs/SMS_OTP.md` with the template text to register at DLT (see O7).

### Phase 2: Google One Tap on the website

- **2.1 [opus]** `lib/googleIdToken.ts`: nonce helper (raw + SHA-256 hex via `expo-crypto`) and `signInWithGoogleIdToken(token, rawNonce, intent)` in `AuthProvider`. This step does session handling, the guest hand-off, the new-account notice (section 4.1), banned/closed account errors through `lib/errors.ts`, and `count('auth.signed_in', { method: 'google_onetap' })`. Unit tests for the nonce helper.
- **2.2 [sonnet]** `components/GoogleOneTap.web.tsx` (+ a `.tsx` that renders nothing): load `https://accounts.google.com/gsi/client` once, then `google.accounts.id.initialize({ client_id: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, nonce: hashed, callback, use_fedcm_for_prompt: true, auto_select: false, cancel_on_tap_outside: true, context: 'signin', itp_support: true })` and `prompt()`. Mount it only on the sign-in page and in the guest "Make your account" pop-up, and only when `features.signInGoogle` is on and there is no session. The existing button stays as the fallback (redirect flow), or is swapped for GIS `renderButton` (decision D3). The client ID is public, but goes in Vercel env per environment, not in code.
- **2.3 [sonnet]** `vercel.json` CSP: add the four `accounts.google.com/gsi` entries in both header blocks. Leave Permissions-Policy as is (FedCM is allowed for the top-level page by default).
- **2.4 [sonnet]** On sign-out (web) call `google.accounts.id.disableAutoSelect()` when the GIS library is loaded.
- **2.5 [sonnet]** Playwright e2e: stub `accounts.google.com/gsi/client` with a fake that calls the callback with a test JWT. Stub the Supabase `/token?grant_type=id_token` response. Assert the session, the guest hand-off and the new-account sheet. Assert the fallback button still works when the script is blocked.
- **2.6 [opus]** Review the PR diff (security-review skill) and do a manual check on staging (section 8).

### Phase 3: Android native one tap (one new APK)

- **3.1 [opus]** Local Expo module `apps/mobile/modules/taskdrop-auth` (`npx create-expo-module --local`; read the Expo 58 docs first). Kotlin, three functions:
  - `googleIdToken({ webClientId, nonce, filterAuthorized })`: Credential Manager `GetGoogleIdOption` (authorized accounts first, then all accounts), with a fallback to `GetSignInWithGoogleOption` for the button. Returns `idToken`, or a typed cancel or error.
  - `phoneNumberHint()`: `Identity.getSignInClient(activity).getPhoneNumberHintIntent(GetPhoneNumberHintIntentRequest)` → returns the E.164 number or cancel.
  - `startSmsConsent()` / an event `onSmsCode`: `SmsRetriever.getClient(ctx).startSmsUserConsent(null)` plus a receiver registered with `SmsRetriever.SEND_PERMISSION` and `RECEIVER_EXPORTED` (Android 14). Launches the consent intent and returns the message body to JS (JS extracts the code). Stops after 5 minutes.
  - Dependencies: `androidx.credentials:credentials`, `credentials-play-services-auth`, `com.google.android.libraries.identity.googleid:googleid`, `play-services-auth`, `play-services-auth-api-phone`. Pin exact versions.
  - Why a local module instead of `@react-native-google-signin`: the free version still uses Google's deprecated legacy Android sign-in SDK, and Credential Manager / One Tap is only in its paid "Universal" version. A ~200-line local module covers Google, Phone Hint and SMS consent in one place with no licence.
- **3.2 [sonnet]** JS wrappers `lib/nativeAuth.android.ts` (+ a `.ts` stub for web and iOS). Wire into `AccessScreen.tsx`:
  - When the number stage opens and the field is empty, call `phoneNumberHint()` once per visit. If the person picks a number, fill it. If they close the sheet, leave it.
  - When the code stage opens, start SMS consent. When a code comes back, fill it and the existing auto-verify runs.
  - Google button: try `googleIdToken` → `signInWithGoogleIdToken`. On `NoCredentialException` (no Google account on the phone) or a module error, fall back to today's browser-tab flow.
  - Sign-out calls `clearCredentialState()`.
  - Unit tests: E.164 → 10-digit normalisation, code extraction from SMS text (only a 6-digit code next to "TaskDrop"), and the fallback order.
- **3.3 [sonnet]** Build the APK locally (`C:\td-tools\b5\lb.mjs`, same keystore as EAS) and install it on the owner's CPH2585 by adb. **Ask the owner before publishing the APK or an OTA** (AGENTS.md rule 7). The site `/get` APK is updated only with the owner's yes. Note: an OTA cannot reach the native module. Phones without the new APK keep the browser flow, so the JS must check that the module exists.
- **3.4 [opus]** Review the native module and the diff (security-review), and do the phone run (section 8).

### Phase 4: server and admin follow-ups

- **4.1 [sonnet]** Admin panel: show "Google (one tap)" as its own sign-in method in the existing analytics (`auth.signed_in` method). No new switch is needed (Google is hidden by `signInGoogle`).
- **4.2 [opus]** Migration (**ask first**): extend `hook_before_user_created` so that provider `google` is refused with "New sign-ups are paused for now." when `get_app_controls` says sign-ups are closed. Add a SQL test.
- **4.3 [sonnet]** Update `docs/ULTIMATE_PLAN.md`: a task line for one-tap login (phases above), the S1 hole, decisions D1-D5. Mark 2.22 (e): the supabase.co screen is gone for One Tap and the Android sheet, and stays only on the redirect fallback. Then run `node scripts/build-plan-html.mjs`.

### Phase 5 (later, only if decided): Truecaller

- **5.1 [opus]** Only after decision D4 = yes, the lawyer's OK and the Privacy Policy update: a `phone-auth` action `truecaller` that swaps the authorization code + PKCE verifier at Truecaller for the verified number, then runs the same find-or-create and `token_hash` path. The same caps, age gate and sign-up switch apply.

---

## 7. Owner-only steps (console clicks; Claude never does these)

Staging is Google Cloud project **Taskdrop** (`/u/2`). Production is project `taskdrop-production`. Do staging first; production at 5.3.

- **O1 Web client origins.** APIs & Services → Credentials → web client `TaskDrop Supabase` → **Authorized JavaScript origins** → add `https://taskdrop.in`, `https://www.taskdrop.in`, `http://localhost`, `http://localhost:8081`, `http://127.0.0.1:8099`. Leave the redirect URIs as they are. Production: the same on `TaskDrop Supabase production` with `https://taskdrop-production.vercel.app` (and `https://taskdrop.in` at launch, decision 28).
- **O2 Android OAuth clients.** Credentials → Create client → **Android** → package `com.taskdrop.app` + the **SHA-1** of the app signing key. Claude reads the SHA-1 (a public value) from the keystore with `keytool` and gives it to you. Repeat for `com.taskdrop.app.staging` once that variant's key exists. At Play release, add another Android client (or fingerprint) with the **Play Console app-signing SHA-1** (Setup → App signing). That is the same page as the App Check SHA-256 step.
- **O3 Supabase Google provider.** Authentication → Sign In / Providers → Google → **Client IDs**: the web client ID **first**, then the Android client IDs, comma-separated. Leave **Skip nonce checks** OFF. The client secret is unchanged.
- **O4 Consent screen branding** (plan 2.22 (d), after 2.22 (b)): app name "TaskDrop", logo, support email `admin@taskdrop.in`, home page, privacy and terms links on `taskdrop.in`, authorized domain `taskdrop.in`. One Tap shows this name. Optional: Google brand verification.
- **O5 Vercel env.** `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` per environment (staging = Taskdrop web client, production = production web client). Claude can set it if you say so. It is a public ID, not a secret.
- **O6 `taskdrop.app`.** Tell Claude whether you own it and whether it has Google Workspace (S1).
- **O7 DLT template** (when you register SMS, `docs/SMS_OTP.md`): the template's **last line** must be `@taskdrop.in #{#var#}` so Chrome on Android can fill the code (WebOTP). The code also stays in the first line for SMS User Consent and for people reading it.
- **O8 Truecaller** (only if D4 = yes): a Truecaller developer account, register `com.taskdrop.app` + SHA-1, and take the partner key.

## Decisions for the owner

- **D1** Where One Tap appears on the web: **only** the sign-in page and the "Make your account" pop-up (recommended), or also as an automatic prompt for guests on Home.
- **D2** A new Google account made by someone who has a phone account: show the "New here, or use your phone number?" sheet (recommended), or say nothing.
- **D3** Web Google button: keep today's TaskDrop-styled button with the redirect (recommended at first), or Google's own rendered button.
- **D4** Truecaller: later, after launch numbers (recommended), or now.
- **D5** Access screen order: phone first (recommended for India, with Phone Hint), or Google first (plan 2.8 "Google shown first", still waiting for your layout OK).

---

## 8. Test plan

**Automatic (CI, `npm run check` + Playwright)**
- Unit: nonce raw/hash pair (the SHA-256 hex of a known input); phone normalisation (`+919876543210` → `9876543210`, foreign numbers refused); SMS code extraction (picks `123456` from the TaskDrop template, ignores other numbers); fallback order on Android (no module → browser flow).
- Unit: web code box renders `autocomplete="one-time-code"`; WebOTP fills the code and aborts when the stage is left.
- e2e (stubbed GIS + stubbed token endpoint): One Tap signs in with no reload; guest drafts move in from the pop-up; a brand-new account shows the D2 sheet; with the GIS script blocked, the old button still signs in.
- SQL (`npm run test:db`): S1 guard refuses a `@phone.taskdrop.app` Google identity; 4.2 hook refuses a Google sign-up while sign-ups are paused and allows it when open.

**Manual on staging (`taskdrop.in`, Claude in Chrome + the owner's phone)**
- Web, Chrome desktop: One Tap card appears on the sign-in page; one tap → signed in; existing user; new user → birth-date question on first launch, under-18 date refused; dismissing the card twice → Google's cool-down, and the button still works; sign out → no automatic sign-in again; Safari or Firefox → the button works.
- Web, Android Chrome: One Tap card; code box offers the SMS code (once real SMS exists).
- Android APK (CPH2585, via adb): Phone Hint sheet shows the SIM number → tap → number filled; "None of the above" → typing works; SMS consent with a test SMS sent from another phone not in contacts, using the template text → Allow → code filled → signed in; Deny → typing works; Google sheet → returning user, new user, cancel, a phone with no Google account → falls back to the browser tab; airplane mode → plain error; sign out → the sheet does not pick the account by itself.
- Security by hand: replay a captured ID token with a different nonce → refused; a token from another Google client ID → refused; a suspended account → the "account suspended" message, no session; logs (Supabase, Sentry) contain no token, phone or email.
- Old APK still on the phone after the website change → Google button still works through the browser (no native module).

---

## 9. Blockers and order

1. **S1 first.** It is a possible takeover path today.
2. Phase 1 can ship any time (web + OTA).
3. Phase 2 needs O1, O3 and O5. It is web only.
4. Phase 3 needs O2 + O3 and a native build. EAS Android is out until 1 Dec, so use the local build. Testers need the new APK (owner's yes).
5. SMS User Consent and WebOTP only show their value once MSG91 + DLT are live. Until then `dev_otp_for_all` fills the code on screen. **Turn it off before launch.**
6. Production repeats O1-O5 on `taskdrop-production` at 5.3.
