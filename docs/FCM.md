# Push on Android (FCM)

Android push goes through Firebase Cloud Messaging, using the V1 API. Two pieces, both made once by the owner; nothing secret goes into git.

1. **Firebase project.** console.firebase.google.com → create a project → add an Android app with package `com.taskdrop.app`. Download `google-services.json`.
2. **FCM V1 credentials for Expo.** Firebase → Project settings → Service accounts → Generate new private key (a JSON file). Then `eas credentials` → Android → `com.taskdrop.app` → Google Service Account → FCM V1 → upload that JSON. (Or in the Expo dashboard: project `taskdrop` → Credentials → Android → FCM V1.)
3. **`google-services.json` for builds.** In the Expo dashboard, project `taskdrop` → Environment variables → create `GOOGLE_SERVICES_JSON` as a **file** variable (visibility: Secret), environments Preview and Production, and upload the file. `app.config.js` reads the path from that variable and sets `android.googleServicesFile`. Locally, set `GOOGLE_SERVICES_JSON` to a path on your PC. The file is git-ignored.
4. Make a new `beta` APK (`eas build -p android --profile beta`, from `apps/mobile`) and install it.

Check: sign in on the phone, allow notifications, have a second account send a quote or a chat message; the push arrives with the app closed. Without step 3 the build still succeeds and push is silently off.

## State on 2026-10-22

Push now runs on the **Taskdrop** Google Cloud project (`project-a19d1da9-6903-4168-905`, organisation `hitendureacts-org`), the same project that holds the Maps keys. The old Firebase projects `taskdrop7` and `taskdroppp` were shut down the same day (Google keeps a project for 30 days before deleting it).

- Firebase is added to the Taskdrop project (Spark plan, free) with the Android app `com.taskdrop.app`.
- EAS `GOOGLE_SERVICES_JSON` (secret **file** variable, `preview` and `production`) now holds this project's `google-services.json`. The master secrets file (`.env.all-secrets`) has the same content.
- Billing is now active on the project, so Firebase shows the Blaze (pay as you go) plan; FCM itself stays free. A ₹100 monthly budget alert is set on the billing account.
- The organisation policy *Disable service account key creation* (`iam.disableServiceAccountKeyCreation`, and its managed twin) was switched off for the Taskdrop project by the owner on 2026-10-22; both show "Not enforced". Key creation then worked after a few minutes.
- A new service-account key for `firebase-adminsdk-fbsvc@project-a19d1da9-6903-4168-905` was generated 2026-10-22 and saved in `.env.all-secrets` (`FIREBASE_SERVICE_ACCOUNT_JSON`).
- **Expo FCM V1 key replaced 2026-10-22 (owner uploaded it; checked on the Expo Credentials page):** project `project-a19d1da9-6903-4168-905`, private key ID `e6300e38…`, uploaded 2:18 PM. The old `taskdrop7` key is gone.
- Downloads cleaned 2026-10-22: the downloaded key file and the stale `google-services*.json` / `taskdrop7-*.json` files were deleted (after checking `.env.all-secrets` holds the same key and `google-services.json`, project `project-a19d1da9-6903-4168-905`).
- A `beta` APK was built on 2026-10-22, build `af47d88d-21fb-4427-a6ce-a299cc073f75`, FINISHED, commit `525ee7c` on `redesigned-2.0`: https://expo.dev/artifacts/eas/aBiNKC9br8NPJ0JheS7VjXdovDje1ELTMyU4PfM35FI.apk (it carries the new `google-services.json`; the Expo FCM key is used by Expo's push service, not baked into the APK, so the order did not matter). 
- **Push tested on a real phone 2026-10-22 (CPH2585, installed over USB): works.** Gotcha found on the way: the API key inside `google-services.json` is the same key as `EXPO_GOOGLE_MAPS_API_KEY` (`taskdrop-android-maps`). Restricting it to Maps SDK for Android only made Firebase Installations answer `403 API_KEY_SERVICE_BLOCKED`, so no token registered. Fix (owner approved): the key is now limited to Maps SDK for Android, Firebase Installations API and FCM Registration API, plus package `com.taskdrop.app` and its SHA-1. Take care when restricting it again. After the change (no rebuild needed) the app registered an Android token; a test notification row inserted for the test account arrived with the app closed. The auto-created "Browser key" (25 APIs, no app restriction) was not used by the app and was deleted on 2026-10-22 at the owner's request (restorable in Google Cloud for 30 days). Only two keys remain: `taskdrop-android-maps` and `taskdrop-server-places`. Known cosmetic issue: the notification's small icon is a generic placeholder, not the taskdrop mark.
