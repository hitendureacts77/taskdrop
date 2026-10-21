# Push on Android (FCM)

Android push goes through Firebase Cloud Messaging, using the V1 API. Two pieces, both made once by the owner; nothing secret goes into git.

1. **Firebase project.** console.firebase.google.com → create a project → add an Android app with package `com.taskdrop.app`. Download `google-services.json`.
2. **FCM V1 credentials for Expo.** Firebase → Project settings → Service accounts → Generate new private key (a JSON file). Then `eas credentials` → Android → `com.taskdrop.app` → Google Service Account → FCM V1 → upload that JSON. (Or in the Expo dashboard: project `taskdrop` → Credentials → Android → FCM V1.)
3. **`google-services.json` for builds.** In the Expo dashboard, project `taskdrop` → Environment variables → create `GOOGLE_SERVICES_JSON` as a **file** variable (visibility: Secret), environments Preview and Production, and upload the file. `app.config.js` reads the path from that variable and sets `android.googleServicesFile`. Locally, set `GOOGLE_SERVICES_JSON` to a path on your PC. The file is git-ignored.
4. Make a new `beta` APK (`eas build -p android --profile beta`, from `apps/mobile`) and install it.

Check: sign in on the phone, allow notifications, have a second account send a quote or a chat message; the push arrives with the app closed. Without step 3 the build still succeeds and push is silently off.

## State on 2026-10-21

- Firebase project `taskdrop7` exists with the Android app `com.taskdrop.app` (checked: the `google-services.json` and the service-account key name the same project and package).
- EAS has `GOOGLE_SERVICES_JSON` as a secret **file** variable in `preview` and `production`, so a `beta` build picks it up (checked with `eas env:list`).
- Not verifiable from here: whether the FCM V1 service-account key is uploaded to Expo (step 2). Open Expo, project `taskdrop`, Credentials, Android, and check that a Google Service Account key for FCM V1 is listed. Without it the `beta` build installs but push stays silent.
- The `beta` APK is not built yet. Build it once step 2 is confirmed.
