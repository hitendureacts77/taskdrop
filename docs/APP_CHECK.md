# Firebase App Check (monitor mode)

Phase 3 of `docs/UPGRADE_PLAN.md`. App Check lets the server tell a request from the real TaskDrop app from one made by a script. **It runs in monitor mode:** the `api` function reads the `X-Firebase-AppCheck` header, writes one log line per result, and refuses nothing. The old app sends no token, so enforcement waits for Phase 9, and even then a failed check is a risk signal, never the only gate.

## What is built

| Part | State |
|---|---|
| Server: `supabase/functions/_shared/appCheck.ts`, called from `api/index.ts` | Built and tested (`appCheck.test.ts`). Does nothing until `FIREBASE_PROJECT_NUMBER` is set. |
| Web: `apps/mobile/src/lib/appCheck.web.ts` (reCAPTCHA Enterprise) | Built. Firebase, reCAPTCHA and the Vercel values were set up on 2026-10-25; it sends a token from the next web build. |
| Android: `apps/mobile/src/lib/appCheck.ts` (Play Integrity, `@react-native-firebase/app-check`) | Built, not yet in an APK. The app is registered in App Check with the EAS keystore's SHA-256. A new native build is needed (`eas build -p android --profile beta`, with the `GOOGLE_SERVICES_JSON` file variable already set). Release builds only: dev builds and Expo Go send no header. For a Play Store build, also add the Play Console app-signing SHA-256 under the Android app's Play Integrity settings. If the `api` log shows no token or `invalid` for Android, add the Firebase App Check API to the allowed APIs of the API key in `google-services.json` (see `docs/FCM.md`). |
| iOS (App Attest) | Future scope with the rest of iOS. |

## Your clicks (about 30 minutes)

1. **Firebase project.** Open https://console.firebase.google.com → **Add project** → pick the existing Google Cloud project `Taskdrop` (the one that already holds the FCM key) → continue. Analytics can stay off.
2. **Register the web app.** Project overview → **Add app** → **Web** (`</>`) → nickname `taskdrop web` → **Register**. Copy the values shown: `apiKey`, `appId`, `projectId`, `messagingSenderId`. Also note the **project number** (Project settings → General).
3. **reCAPTCHA Enterprise.** Project settings → **App Check** → the web app → **reCAPTCHA Enterprise** → create a site key for `taskdrop.in` (and `localhost` for testing) → copy the **site key** → **Save**. If Google asks to enable the reCAPTCHA Enterprise API, accept.
4. **Android app (for later).** **Add app** → **Android** → package `com.taskdrop.app` → register → download `google-services.json` (keep it; do not commit it). Then App Check → the Android app → **Play Integrity** → **Save**. Tell Claude when this is done and it will build the Android part.
5. **Give Claude the values.** Type to Claude: "App Check values: project number …, web apiKey …, appId …, projectId …, senderId …, reCAPTCHA site key …". The web config and the site key are public by design (they are in every web page). Claude puts them in Vercel's `taskdrop` project as `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_APP_ID`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_SENDER_ID`, `EXPO_PUBLIC_RECAPTCHA_SITE_KEY` and `FIREBASE_PROJECT_NUMBER` (the last one reaches the Edge Functions through the build's secret sync).
6. Do **not** turn on enforcement in the Firebase console. App Check enforcement there applies to Firebase products, not to our `api` function, and the monitor is ours.

## Checking it

After the next web build, open https://taskdrop.in, use the app for a minute, then in Supabase → Logs → Edge Functions → `api` look for lines `app check` with `result: valid` and `platform: web`. `missing` means the web build has no keys yet; `invalid` is always logged and worth a look.
