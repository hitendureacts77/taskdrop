# Key emergency guide: a key may have leaked, what to do

For the owner, in plain words. **Reading and practice only today:** the owner's rule since 25 October is that no key is replaced or regenerated, so nothing here is done unless a key really leaks. When that happens, this guide is how a key is replaced in **under 15 minutes**.

Written 1 November 2026 from the real list of names kept in Vercel, Supabase and Expo (names only, never values). Production does not exist yet; each production key will be a separate key in the production tool and this guide applies to it the same way.

## The five steps, the same for every key

1. **Say it.** Tell Claude: "A key may have leaked: NAME (the name, never the value), seen at WHERE." Stop using the app for payments if it is a money key.
2. **Cancel the old key at the provider first.** Always cancel; never just add a new one beside it. (Where: the "Cancel it here" column below.)
3. **Make a new key** at the same place, and save it in `.env.all-secrets` under the same NAME (one-file rule). Never type it into the chat.
4. **Put the new key where the app reads it** (the "Set it here" column). Claude can do this part when you ask, but the value goes in by you, from the secrets file.
5. **Check the provider's log for use in between** (a login, a charge, a payout you did not make), then tell Claude "done". Claude runs `npm run check:exposed`, `npm run security:history` and the stop-ship tests (`docs/SECURITY_ROUND1.md`) once to prove nothing else is open.

Do **not** try to delete a key from the code history. Copies may already exist, so it does not help.

**Time plan:** step 1 takes 1 minute, step 2 about 3, step 3 about 3, step 4 about 5, step 5 about 3. The only waits are Vercel and Supabase redeploying (1 to 3 minutes each).

## Money keys (act within the hour)

| Key (name) | What it can do if stolen | Cancel it here | Set it here | What stops while it changes |
|---|---|---|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Create payment links, read payments, refund | Razorpay dashboard, Account & Settings, API keys, regenerate (the old pair stops at once) | Supabase Vault secrets of the same names (run by Claude from the SQL editor with your value) | New payments cannot start; money already held is safe; set maintenance mode first |
| `RAZORPAY_WEBHOOK_SECRET` | Forge "payment received" messages | Razorpay dashboard, Webhooks, edit the webhook, set a new secret | Supabase Vault `RAZORPAY_WEBHOOK_SECRET` | Payment confirmations fail until both match (Razorpay retries for 24 hours) |
| `RAZORPAYX_*` keys and webhook secret (payouts; not set on staging) | Send money out | RazorpayX dashboard, API keys | Supabase function secrets / Vault of the same names | Withdrawals wait; set the payout method to manual in the admin |
| `SUPABASE_SERVICE_ROLE_KEY` (the "secret" API key) | **Everything in the database**, skipping every rule | Supabase, Project settings, API keys, roll the secret key (the old one stops) | Vercel `taskdrop-admin` (Sensitive); Supabase supplies it to the functions itself | The admin panel cannot read refunds or phone numbers until redeployed |
| `DATABASE_URL` / the database password | The same as above, directly | Supabase, Project settings, Database, reset the password | Vercel `taskdrop` (Sensitive) and the GitHub Actions secrets of the same name, if any | Deploys that run migrations fail until updated |
| `SUPABASE_ACCESS_TOKEN` | Deploy functions, change the project | Supabase, Account, Access tokens, delete the token | Vercel `taskdrop` (Sensitive), GitHub secret of the same name | Functions and migrations are not deployed until updated |

## Keys that guard the doors

| Key | If stolen | Cancel it here | Set it here | What stops while it changes |
|---|---|---|---|---|
| `API_GATEWAY_SECRET` | Talk to the database as the app does, skipping the front door's checks | It is made in Supabase Vault (migration 083). Make a new random value, change it in the Vault **and** in Vercel in the same minute | Supabase Vault, Vercel `taskdrop`, Vercel `taskdrop-admin` | Every call fails for the minute the two disagree; do it at a quiet hour |
| `ADMIN_SESSION_SECRET` | Forge the admin panel's idle-time cookie (the login itself is still required) | Replace the value; the old one is just gone | Vercel `taskdrop-admin` (Sensitive) | Admins are asked to sign in again. **Found 1 Nov: today's value is shorter than 16 characters. Replace it with 64 random characters the first time the hold on key changes is lifted** (PowerShell line in task 2.1, step 3) |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Send fake events, or run the money jobs | Inngest dashboard, Manage, Event keys and Signing keys, rotate | Vercel `taskdrop`, then the build copies them to Supabase function secrets | Push messages and nightly jobs pause until both sides match |
| `IMAGEKIT_PRIVATE_KEY` | Upload and delete pictures | ImageKit dashboard, Developer options, regenerate the private key | Vercel `taskdrop-admin`, Supabase function secrets | New pictures cannot be uploaded |
| `MSG91_AUTHKEY` (when SMS is set up) | Send SMS at your cost | MSG91 dashboard, authkey, regenerate | Supabase function secrets | No sign-in codes; people can sign in with Google meanwhile |

## Keys that only allow reading or sending error reports

| Key | If stolen | Cancel it here | Set it here |
|---|---|---|---|
| `SENTRY_AUTH_TOKEN`, `SENTRY_AUTH_TOKEN_ADMIN`, `SENTRY_AUTH_TOKEN_TASKDROP_USERAPP`, expo `SENTRY_AUTH_TOKEN` | Read or upload Sentry data | Sentry, Settings, Developer settings, Auth tokens, delete | Vercel (`taskdrop`, `taskdrop-admin`), Expo environment variables |
| `EXPO_GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_API_KEY` | Run up map and address-search charges (the daily cap on address search is 1,000, and a budget alert is set) | Google Cloud, APIs & Services, Credentials, delete the key | Vercel `taskdrop`, Expo, Supabase function secrets |
| `GOOGLE_SERVICES_JSON` (Firebase, Android) | Send push messages as the app | Firebase console, Project settings, Service accounts, delete the key | Expo environment variable of that name (Secret) |
| `EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN` (staging builds only) | Skip App Check on staging | Firebase console, App Check, Apps, debug tokens, delete | Expo build variable. It must never exist in production (plan task 5.9) |

## Not keys, so nothing to replace

`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the public "publishable" key), `EXPO_PUBLIC_FIREBASE_*`, `EXPO_PUBLIC_RECAPTCHA_SITE_KEY`, `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, the legal details and the `ADMIN_EMAIL` setting are public by design. Row rules protect the data, not the secrecy of these. `scripts/secret-guard.test.mjs` fails if a secret name ever appears in a public name.

## The Android keystore (the one key you cannot replace on your own)

`KEYSTORE_PASSWORD`, `KEY_PASSWORD`, `KEY_ALIAS` and the keystore file itself (`C:\TaskDrop-safe`, a USB stick, the encrypted backup) sign the app. **If the keystore file or its passwords leak, someone could publish a fake update as you** only if they also hold your Play account, so first secure the Google Play account (2-step sign-in, task 2.1b, when it is switched on). Replacing a lost or leaked signing key goes through Google Play's "request upload key reset" form; it takes days, not minutes. Never delete the keystore.

## Logins are keys too

A stolen Google, GitHub, Vercel, Supabase, Expo or Razorpay **login** does more damage than most keys. If one may be stolen: change that password first, sign out everywhere (each site has "sign out of all sessions"), then go through the table above for every key that account can read. This is why 2-step sign-in (task 2.1b, future scope) is the single biggest protection still open (hole H14).

## Practice (reading only, no key is touched)

1. Pick `ADMIN_SESSION_SECRET`. Say aloud where it is set (Vercel, project `taskdrop-admin`), where it is cancelled (nowhere: replacing it is enough), and what stops (admins sign in again).
2. Pick `RAZORPAY_KEY_SECRET`. Say where the new one would be saved first (`.env.all-secrets`), and what you would do in step 5 if the Razorpay log showed a refund you did not make (tell Claude, switch on maintenance mode).
3. Tell Claude anything in this guide that does not match how the tools look to you.

## Alarms that tell you early

- **Canary file** (task 2.10): `C:\complete taskdrop\.env.production-old` holds a fake key; if anyone uses it, Canarytokens emails you.
- **Sentry**: "security: bad_signature", "security: refused_login", "security: app_check_failed" and "security: sms_code_sent" issues (`supabase/functions/_shared/monitoring.ts`). A spike emails you (rules listed in `docs/SECURITY_ALERTS.md`).
- **GitHub**: leaked-key emails (task 2.2) and gitleaks on every change (task 2.5).
- **Money check**: a mismatch is an in-app alert and a fatal Sentry issue.
