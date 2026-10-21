# Push on Android (FCM)

Android push goes through Firebase Cloud Messaging, using the V1 API. Two pieces, both made once by the owner; nothing secret goes into git.

1. **Firebase project.** console.firebase.google.com → create a project → add an Android app with package `com.taskdrop.app`. Download `google-services.json`.
2. **FCM V1 credentials for Expo.** Firebase → Project settings → Service accounts → Generate new private key (a JSON file). Then `eas credentials` → Android → `com.taskdrop.app` → Google Service Account → FCM V1 → upload that JSON. (Or in the Expo dashboard: project `taskdrop` → Credentials → Android → FCM V1.)
3. **`google-services.json` for builds.** In the Expo dashboard, project `taskdrop` → Environment variables → create `GOOGLE_SERVICES_JSON` as a **file** variable (visibility: Secret), environments Preview and Production, and upload the file. `app.config.js` reads the path from that variable and sets `android.googleServicesFile`. Locally, set `GOOGLE_SERVICES_JSON` to a path on your PC. The file is git-ignored.
4. Make a new `beta` APK (`eas build -p android --profile beta`, from `apps/mobile`) and install it.

Check: sign in on the phone, allow notifications, have a second account send a quote or a chat message; the push arrives with the app closed. Without step 3 the build still succeeds and push is silently off.
