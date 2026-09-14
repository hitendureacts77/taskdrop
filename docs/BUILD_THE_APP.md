# Getting the Android app

Everything so far has been verified in the browser, because that is where an
agent can drive the app. The browser is a real build of the same code, but it
is not the thing you install. This is how you get the APK.

## Why you cannot build it on this machine right now

An Android build needs a JDK and the Android SDK. Neither is installed here —
`java` is absent and there is no SDK folder. Installing them is several GB and
an hour, and it is not the shortest path.

Expo builds it in the cloud instead. You need an Expo account (free) and
nothing else on your machine.

## First time only

```bash
npx eas-cli login
```

Then push the three public keys the bundle needs. They are inlined at build
time, and EAS cannot read your local `.env` — it uploads what git tracks, and
`.env` is deliberately untracked because the Razorpay secret lives there too.

```bash
bash scripts/push-build-env.sh
```

## Build it

```bash
npm run build:apk --workspace @taskdrop/mobile
```

That produces an installable **APK** for testing on your own phone. EAS prints
a link when it finishes; open it on the phone and install. Android will warn
about installing outside the Play Store — expected for a test build.

For the Play Store, `npm run build:store` produces an **AAB** instead, which is
what Google requires for a listing.

## What is already configured

- **Package name** `com.taskdrop.app`, version 1.0.0, versionCode 1.
- **Permissions**, verified in the generated manifest:
  - `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` — the map and "near you".
  - `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` — attaching a photo.
  - `RECORD_AUDIO` is explicitly **removed**, and `CAMERA` is never requested:
    the app only picks from the library and never records anything. A permission
    you do not use is one more reason for someone to decline the install.
- Cleartext HTTP is off. Everything the app talks to is HTTPS.

## Before you put it in front of real people

**Restrict the Maps key.** `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is compiled into
the bundle, and anyone can unzip an APK. The only thing protecting it is the
restriction you set in Google Cloud Console: limit it to the Places API and to
the `com.taskdrop.app` Android package. Until you do, it is spendable by anyone
who downloads the app.

**Rotate the Razorpay test keys.** They were pasted into a chat during
development. They are test keys, so the exposure is limited, but do not carry
them into the live account.

**Register the webhook.** Razorpay → Webhooks → the URL below, subscribed to
`payment_link.paid`. Without it, a payment only settles while the payer has the
app open.

```
https://wjxvingpfbfvkfqhrguj.supabase.co/functions/v1/razorpay-webhook
```

**Turn on UPI.** It is currently disabled on the Razorpay account — the API
reports `upi: false`, which is why it does not appear on the payment page. Cards,
netbanking and wallets are enabled. This is an account setting, not a code
change: Razorpay Dashboard → Settings → Payment Methods → enable UPI. In India
that is the method most people will reach for first.

**Schedule the clearing sweep.** Completed work sits in clearing for seven days
and then has to be moved into the withdrawable balance. There is a button for it
in the owner console, but it should not depend on someone remembering. Enable
`pg_cron` in Supabase (Database → Extensions) and it can run nightly.
