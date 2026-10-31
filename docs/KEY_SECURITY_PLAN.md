# Key security plan (short version)

> **Owner: you do not need this file.** Everything in it is also in `docs/ULTIMATE_PLAN.md` (as tasks, and in its "Reference" section). This file is kept for Claude.

Shortened 2026-10-30. The full audit and layer-by-layer detail are in `docs/archive/2026-10-30-before-simplify/KEY_SECURITY_PLAN.md`.

Big picture: `docs/ULTIMATE_PLAN.md`. **Status: plan only. Nothing here is built unless marked done.**

---

## 1. The honest goal

Nobody can promise a key "no hacker can ever steal". We aim for:

1. A leak is **unlikely**
2. A leak is **caught in minutes**
3. A leaked key **does little damage**
4. Recovery is **fast and written down**

```
   L1 stop leaks   ->   L2 guard the places   ->   L3 limit the damage   ->   L4 notice fast   ->   L5 recover
   (scanners)           (logins, vault)             (caps, restrictions)       (alerts)              (runbook)
```

If one layer fails, the next one limits the harm.

## 2. What the check found (2026-10-29)

| Finding | Risk | Answer |
|---|---|---|
| Repo is public and GitHub secret scanning was off | A pushed key goes unnoticed | **Fixed 2026-10-29:** scanning and push protection are on for both repos |
| An old Razorpay **test** key sits in git history | Test account only, no real money | Accepted (you said no rotation) |
| The ImageKit private key was pasted into chat | Anyone with that chat could upload to your account | Cap bandwidth (L3) |
| No scanner in automatic checks; no check before commit | A mistake reaches the public repo | L1 |
| Master secrets file + Android keystore passwords sit together in OneDrive | One cloud-account hack exposes everything | L2 |
| Admin falls back to the master database key if its session secret is missing | Bypasses all database rules | L3 |
| Good already: no `.env` committed, no master key in the app, map keys restricted, App Check live | | keep |

## 3. What to do, by layer

### L1. Stop leaks before they happen (Claude, one pull request)
- [x] GitHub secret scanning + push protection on both repos
- [ ] **gitleaks** in automatic checks (every PR, plus a weekly full-history scan) and as a check before each commit
- [ ] Safer automatic-check settings: read-only by default, outside add-ons pinned to a fixed version
- [ ] Hide secrets from logs and Sentry (mask anything that looks like a key, phone number or email)
- [ ] A test that fails if the app file contains any secret name or value

### L2. Protect where keys live (you)
- [ ] **Passkey or authenticator on every provider login** (GitHub, Vercel, Supabase, Google Cloud, Razorpay, Cashfree, Expo, Sentry, Inngest, ImageKit, MSG91, Spaceship). This is the biggest single protection
- [ ] A password manager (Bitwarden, free) for the master copy of secrets
- [ ] Move the Android keystore backup out of OneDrive; keep its passwords in the manager
- [ ] Windows device encryption (BitLocker) on
- [ ] Vercel secrets marked **Sensitive**; access tokens with an expiry (90 days) and minimum permissions

### L3. Make a stolen key nearly useless
- [ ] **Remove the admin fallback to the master key** (Claude): if the session secret is missing, refuse. Also fail the deploy if any required secret is missing or too short
- [ ] **Spending caps (you):** Google Maps daily quota and budget alert; MSG91 daily send cap and low-balance alert; ImageKit bandwidth limit
- [ ] Separate keys for test and live, and per service (set up at launch)
- [ ] Rate limits on sign-in and code sending (see SMS safety in the main plan)
- [ ] Test-only sign-in shortcuts **off** at launch (`dev_otp_for_all`, `ALLOW_ANY_OTP`, `TEST_PHONES`)

### L4. Notice fast
- [ ] GitHub secret-scanning email alerts on, to an address you read daily
- [ ] Billing alerts: Google Cloud, MSG91, Razorpay, Supabase, Vercel
- [ ] Sentry alerts for spikes in 401/403 errors, App Check failures and wrong payment signatures
- [ ] One **decoy key** (a Canarytoken) in a file nothing uses; if anyone touches it, you get an alert
- [ ] Once a month (10 minutes): look at each provider's sign-in and key log

### L5. Recover fast
- [ ] `docs/KEY_RUNBOOK.md` (Claude): for each secret, where it is set, where it is revoked, what breaks while changing. Target: any key replaced in under 15 minutes
- [ ] Order for a real leak: **revoke, replace, then check the provider's log** for use in between
- [ ] Do not rewrite git history without your OK (it does not help once copies exist)

## 4. The order

| Step | What | Who | Time |
|---|---|---|---|
| 1 | Secret scanning on both repos | done | done |
| 2 | Passkeys on all provider accounts | **You** | 1-2 h |
| 3 | gitleaks, safer check settings | Claude (one PR) | small |
| 4 | Remove admin fallback; secret-missing check; log scrubbing; app-file test | Claude | small-medium |
| 5 | Password manager, keystore out of OneDrive, BitLocker | **You** | 1 h |
| 6 | Spending caps and billing alerts | **You** (Claude lists the clicks) | 1 h |
| 7 | Sentry alerts, decoy key | Claude + you | small |
| 8 | `KEY_RUNBOOK.md` | Claude | small |
| 9 | At launch: new live keys, separate per service, shortcuts off | Both | at launch |

Steps 1-4 close the biggest gaps and cost nothing. Say **"start key protection"** for steps 3 and 4.

## 5. How we will know it works

- A fake key in a test branch is **blocked** when pushed and **fails** the automatic check
- Searching the website and Android file for every secret name finds nothing
- A request with only the public key reads nothing private
- The admin deploy **fails** if its session secret is removed
- Touching the decoy key raises an alert within an hour
- A practice run of the runbook on one low-risk key takes under 15 minutes

## 6. Decisions

1. **Rotation.** Your rule: never rotate keys. That stays. One question: allow a replacement **only** when a key is confirmed leaked? (Recommended: yes, as the only exception.) Under "never", the old Razorpay test key and the ImageKit key stay exposed, protected only by the caps in L3.
2. **Repos stay public?** Scanning is free while public. If they go private, scanning costs extra and gitleaks becomes the main guard. (Recommended: stay public.)
3. **Secret scanning on:** done 2026-10-29.
4. **Password manager:** Bitwarden (free) unless you prefer another.

---

## Changelog

- **2026-10-30:** Cut from 110 lines to this page. Full audit table (A1-A8) is in the archive.
