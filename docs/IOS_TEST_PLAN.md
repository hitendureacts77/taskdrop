# iOS test plan and results

Written 2026-10-17. Scope: make TaskDrop (`apps/mobile`) work on iOS without changing any feature or look.

## What was checked from this PC (no iPhone access)

| Check | Result |
| --- | --- |
| `npm run typecheck` in `apps/mobile` | Pass |
| `npx expo export -p ios` (Hermes bundle, 1469 modules, fonts) | Pass |
| `expo config` reads the new iOS block | Pass |
| Android-only APIs without a guard | None found. `BackHandler` is native-only in `NavProvider`; push, maps and Android channels are `Platform`-guarded |
| Shadows | Every `elevation` sits beside `shadowColor/Opacity/Radius/Offset`, so iOS draws them |
| Phone and OTP inputs | `textContentType` + `autoComplete` set (`oneTimeCode` / `sms-otp`) |
| Maps | iOS uses Apple Maps (`provider` is only Google on Android), so no iOS Maps key is needed |
| Push in Expo Go on iOS | Handled: local notifications while the app is open; remote push needs a real build |

## Changed

`apps/mobile/app.json`, `ios` block: added `bundleIdentifier` `com.taskdrop.app` (matches Android), `buildNumber` `1`, and `ITSAppUsesNonExemptEncryption: false` (the app only uses HTTPS; confirm this is true for you before submitting). Camera, photo, microphone and location usage text already comes from the `expo-image-picker` and `expo-location` plugins. `eas.json` needs no change: its profiles apply to both platforms.

## Open items for the owner

1. **Sign in with Apple is built but not switched on.** Code is in place behind the existing `signInApple` flag (`AuthProvider.signInWithApple`, `components/AppleSignInButton.ios.tsx`, `AccessScreen`; iOS only, Apple's own button). To make it work you must: (a) join the Apple Developer Program, (b) in the Supabase dashboard > Authentication > Providers > Apple, enable it and add the app's bundle id `com.taskdrop.app` under Client IDs, (c) make an EAS build (`usesAppleSignIn` is set). It cannot sign in inside Expo Go: Apple's token is issued for Expo Go's own id, so Supabase rejects it. Accounts made this way go through the same age check as the others (verify on the build).
2. **Remote push on iOS** needs an EAS build plus APNs credentials from an Apple Developer account (US$99/year). Expo Go on iOS gets local notifications only.
3. **Razorpay on iOS** was not run here. Check it on the iPhone (list below).
4. **No runtime test on iOS was possible from this PC.** Everything below is for you on the iPhone.

## iPhone checklist (Expo Go, scan `taskdrop-ios-expogo-qr.png`)

Phone and PC on the same Wi-Fi, Metro running. Tick each when it works.

1. App opens past the splash; text uses Plus Jakarta Sans.
2. Notch and home indicator: bottom tab bar is not covered.
3. Sign in with a phone number; the code auto-fills.
4. Google sign-in opens the account chooser and returns to the app. (Apple button shows under the code button; tapping it only works in an EAS build.)
5. Hire home: sections in the same order as the Android app.
6. Switch to Earn: labels change to "My Work" and "Find work".
7. Post a task, all 7 steps, with the keyboard open on every text field (nothing hidden).
8. Take a photo with the camera (permission prompt shows your text).
9. Pick a photo from the library.
10. Location permission prompt, then the map picker shows (Apple Maps) and the pin moves.
11. Find work: search, filters, swipe cards.
12. Send a quote on a task; accept it as the poster.
13. Chat: send a message; keyboard does not cover the input.
14. Escrow: Razorpay opens and says TEST MODE (do not pay).
15. Wallet and withdraw screens open without errors.
16. Notifications bell shows new items live; a banner appears while the app is open.
17. Dark, light and System theme all look right.
18. Profile edit, account deletion screen, legal pages open.
19. Pull-to-refresh and scroll feel normal on long lists.
20. iPad (if you have one): no clipped or stretched screens.

Expected not to work in Expo Go on iOS: remote push when the app is closed, Sign in with Apple (needs the EAS build and Supabase setup above), voice typing.

## Build for a real iPhone (needs your approval, uses your Expo quota and Apple account)

```bash
cd apps/mobile
npx eas-cli build --platform ios --profile preview
```

The first run asks you to sign in to your Apple Developer account and register your iPhone. After that, `--profile production` builds the App Store version.
