# Android test plan (emulator)

Owner's machine: ASUS Zephyrus G GA502DU, Windows 11 Home, AMD Ryzen 7 3750H. Android Studio, SDK and the
`Medium_Phone_API_37.0` device are installed. Phone testing over USB is the fallback (see the memory note
`android-phone-testing`). iOS has its own plan: [IOS_TEST_PLAN.md](IOS_TEST_PLAN.md).

## 0. Make the emulator start (owner, once)

1. Turn on virtualisation in the BIOS: restart and tap **F2** while the ASUS logo shows, press **F7** for Advanced
   Mode, then Advanced, CPU Configuration, **SVM Mode: Enabled**, save with **F10**.
2. In Windows, "Turn Windows features on or off": tick **Windows Hypervisor Platform**, restart.
3. Check: `emulator -accel-check` must say the hypervisor is usable (on 2026-10-19 it said "not installed").
4. Start `Medium_Phone_API_37.0` from Device Manager, or `emulator -avd Medium_Phone_API_37.0`.

## 1. What runs where

| Build | How it gets on the emulator | Good for |
|---|---|---|
| Expo Go + dev server (port 8091) | `adb reverse tcp:8091 tcp:8091`, open `exp://localhost:8091` | fast checks of any branch, native tabs (PR 30) |
| EAS preview APK (build 59e92e1a) | `adb install`, download from the EAS build page | Sentry replay/profiling/logs, real app icon, push token |

Expo Go cannot show: Sentry native replay, remote push, voice typing, Google map tiles. Use the APK for those.

## 2. Test passes (in this order)

Mark each line pass / fail / not testable, with a screenshot for every fail.

**A. Start and sign in**
- Cold start shows the splash, no red box; app opens on Home.
- Phone sign-in with a test number: the code is auto-filled (dev_otp_for_all is on). Age gate (18+) shows for a new account.
- Username + password sign-in; sign out and back in; Google button opens the account chooser (owner finishes).

**B. Native tabs and navigation (PR 30)**
- Five bottom tabs switch with no flicker; each tab keeps its place when you leave and return.
- Open a pushed screen (task detail, profile, wallet): swipe-back and the Android back button both return one step.
- Back button on a tab root exits or goes to Home, never to a blank screen.
- Rotate to landscape and back; split-screen; font size "Large" in Android settings: nothing clipped.
- Dark mode and Light mode, then System: both complete, no white flash.

**C. Hire flow**
- Post a task, all 7 steps: category, description, photo from gallery, area, budget, date, review.
- Remote task and local task both post; "area name only" shows until a worker is chosen.
- Pay (Razorpay TEST MODE checkout opens, nothing real is paid); task shows as funded.
- Receive an offer, compare, accept; approve work; leave a review.

**D. Earn flow**
- Switch mode to Earn ("Find work"); open a task, send an offer with a price; see the 10% commission line.
- Mark work done with a proof photo; wallet shows pending, then cleared after 7 days (read the rule, do not wait).
- Withdraw screen: UPI field validates; do not submit a real destination.

**E. Chat, notifications, profile**
- Send text and a photo in task chat; the other account sees it.
- In-app notification arrives live; open it lands on the right screen.
- Edit profile, change avatar (picker and camera), check the picture shows everywhere.
- Presence: "Active now" appears for the second account.

**F. Help, legal, account**
- Help: FAQ opens, **Report a bug** opens the Sentry feedback form and submits.
- Privacy and Terms open; the Sentry line mentions crash reports, error logs, usage counts, masked replay.
- Delete account: the check explains blockers; with a clean test account it deletes and signs out.

**G. Pictures (Phase 6, works with or without ImageKit keys)**
- With no keys: every upload still goes to Supabase Storage and displays (the fallback).
- With keys (later): upload becomes `media:<id>`, shows at card size, a second account can open it, an unrelated
  account cannot.

**H. Robustness**
- Airplane mode on a screen that loads data: plain-language error, retry works, no crash.
- Kill the app mid-post, reopen: no stuck loader.
- Slow network (emulator extended controls, Cellular, "Slow 3G"): spinners, no double submit.
- Turn each switch in the admin panel (maintenance, update required, feature off) and see the app respond.

**I. Sentry check (APK build only)**
After passes A to F, open Sentry (org hitendu, project taskdrop): the sign-in and post-task logs, the
`task.posted` and `payment.link_opened` metrics, one session replay with text masked, and the bug report.
Force one error and confirm it appears with a readable stack.

## 3. Evidence and reporting

For each pass, keep screenshots (`adb exec-out screencap -p`) and `adb logcat -d *:E` output. Failures become
fixes on a short-lived branch into `redesigned-2.0`. Never type the owner's real phone number, OTP, Google
account or payment details.

## 4. Not testable on an emulator

Real camera quality, haptics, biometrics, push from a real server, mobile-data speed, Google Maps tiles on some
images. Check these once on the owner's phone before launch.
