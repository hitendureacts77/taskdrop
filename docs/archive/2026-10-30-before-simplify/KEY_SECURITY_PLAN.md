# Key security plan

Written 2026-10-29. Extends `docs/UPGRADE_PLAN.md` Part B, section 7.1. Part of workstream U3 in `docs/ULTIMATE_PLAN.md`. Status: **plan only, nothing here is built or changed yet** (AGENTS.md: no phase starts until the owner says so).

## 1. What "safe" can honestly mean

Nobody can promise a key that "no hacker can hack". What we can build is a setup where:

1. **A leak is unlikely** (keys live in few places, behind strong sign-ins).
2. **A leak is caught within minutes** (scanners and alerts, not "a customer noticed").
3. **A leaked key does little damage** (each key is restricted, separate and capped).
4. **Recovery takes minutes** (a written break-glass runbook, ready before it is needed).

Each layer below covers one of these. If one fails, the next one limits the harm.

## 2. What the audit found (2026-10-29, names only, no values read)

| # | Finding | Risk | Fix in |
|---|---|---|---|
| A1 | The user repo is **public** and GitHub **secret scanning and push protection are both disabled**. Both are free on public repos | A key pushed by mistake is not blocked or flagged | L1 |
| A2 | An old Razorpay **test** key was compiled into the functions and is still **in git history** (commits `c926854`, `83530ff`, `28af8a1`). It was removed from the current code, not from history | Test account only; no real money. Stays readable by anyone | L5 (owner decision) |
| A3 | No secret scanner in CI, no pre-commit hook (no gitleaks, no husky) | A mistake reaches the public repo before anyone sees it | L1 |
| A4 | `keyMode.test.ts` holds `rzp_live_` and `rzp_test_` strings | Checked as test fixtures for the key-mode guard; confirm they are made-up values, not real ones | L1 |
| A5 | The ImageKit private key was **pasted into chat** (plan, Phase 6) | Chat content is a leak path; the key stays unrotated by owner decision | L3, L5 |
| A6 | `.env.all-secrets` is the master file for 73 secrets, and the Android keystore backup zip keeps its **passwords beside the keystore, in OneDrive** | One cloud-account breach exposes everything | L2 |
| A7 | The admin `middleware.ts` falls back to the service-role key when `ADMIN_SESSION_SECRET` is missing (plan 7.1); `ADMIN_SESSION_SECRET` is 7 chars (accepted for test stage) | The service-role key bypasses all database rules | L3 (fallback now; secret length at Phase 10) |
| A8 | Good already: no `.env` file tracked except `.env.example`; no service-role key in app code; no secret-named `NEXT_PUBLIC_*` in admin; no key-shaped strings in the admin repo; Maps keys split and restricted; App Check live; refresh-token reuse detection on | n/a | keep |

## 3. The layers

### L1. Stop leaks before they happen (free, mostly automatic)

- [x] Turn on GitHub **secret scanning** and **push protection** for both repos (Settings, Code security). Push protection blocks the push itself. Free on public repos. **Done 2026-10-29** with your yes, through `gh api`; read back as `enabled` for both on `hitendureacts77/taskdrop` and `hitendureacts77/taskdrop-admin`. Not yet tested with a fake key (see section 5).
- [ ] Add **gitleaks** to CI (`ci.yml` job) so every pull request is scanned, history included on a weekly schedule. Add a `.gitleaks.toml` that allows only the fake fixtures in A4.
- [ ] Add a **pre-commit** gitleaks hook so a key is caught on the PC before it is even committed.
- [ ] CI hardening: workflow `permissions:` set to read-only by default; third-party Actions pinned to a commit SHA; never use `pull_request_target`; Dependabot stays on. This stops a bad dependency or fork PR from stealing anything.
- [ ] **Scrub logs and Sentry**: a `beforeSend` filter and a log helper that mask values matching key patterns, `Authorization`, `apikey`, phone numbers and emails. The plan already says no phone/email in Sentry; this makes it enforced by code, not habit.
- [ ] A test (`npm run check`) that fails if the app bundle contains a name or value from the secret list. Section 7.1 states the rule; this makes it a failing test.
- [ ] A4 check: confirm the `rzp_*` strings in `keyMode.test.ts` are fake.

### L2. Protect the places keys live

- [ ] **Passkey or authenticator 2-step sign-in on every account that can read or create a key**: GitHub, Vercel, Supabase, Google Cloud/Firebase, Razorpay, Expo, Sentry, Inngest, ImageKit, MSG91, and the domain registrar (Spaceship; a hijacked domain gives an attacker your email and sign-in links). Use a passkey where offered, not SMS. This is the single biggest protection, because most real breaches are stolen account logins, not cracked keys. *Note: admin-panel authenticator is future scope (2026-10-24); this item is about the provider accounts, not the admin app.*
- [ ] Recovery email and phone for those accounts: ones you control, with their own 2-step sign-in.
- [ ] **Move the master secrets out of a plain file.** Keep `.env.all-secrets` encrypted at rest (BitLocker on the PC, Windows 11 Home supports "device encryption" in Settings) and use a password manager (Bitwarden or 1Password) as the owner's copy of the secrets. Take the keystore backup zip **out of OneDrive**, and store its passwords in the password manager, never beside it.
- [ ] Vercel: mark every secret **Sensitive** (unreadable after saving). Supabase: keep payment secrets in Vault (already). EAS: secrets visibility "secret", not "sensitive".
- [ ] Personal tokens (`SUPABASE_ACCESS_TOKEN`, GitHub, Vercel, Expo): fine-grained, minimum scope, with an **expiry date** (90 days), one per purpose.
- [ ] Windows PC: current updates, Defender on, no key files in Downloads or the Desktop, the browser profile you use for admin consoles has no extensions you don't trust.

### L3. Make a stolen key useless (blast-radius limits)

- [ ] **Separate keys per environment and per use.** Test and live never share a key; each service (server places, Android maps, ImageKit signing, MSG91) has its own. Already true for Maps; extend to the rest at Phase 10.
- [ ] **Restrict at the provider** wherever the provider allows: Google keys by API, package name and SHA-1 (done); Supabase `SUPABASE_ACCESS_TOKEN` by expiry. Razorpay key pairs cannot be scoped, so they stay server-only, inside Vault, with webhook signatures checked (done).
- [ ] **Caps and quotas**: Google Maps daily quota and a budget alert; MSG91 daily send limit and low-balance alert (an attacker with the key, or an open OTP endpoint, runs up SMS cost); ImageKit bandwidth limit; Supabase spend cap on (Pro) at Phase 10. A capped key is a small loss, not a large one.
- [ ] **Remove the admin's service-role fallback** (A7): if `ADMIN_SESSION_SECRET` is missing the middleware must refuse, not widen access. Add a startup check that fails the deploy if any required secret is missing or shorter than its minimum.
- [ ] **Supabase API keys**: check whether the project can use the newer publishable and secret keys instead of the legacy JWT `anon`/`service_role` pair. The legacy pair cannot be rotated on its own; the new ones can, one at a time. *Verify in the current Supabase docs before deciding.*
- [ ] Keep the server-decides rule (AGENTS rule 1): even a stolen anon key plus a user token can only do what RLS allows. Phase 9's lockdown test ("a direct database call with the public key + a user token is refused") is part of this layer.
- [ ] Rate limits on `phone-auth`, `password-auth`, OTP send and `places-search` (some exist; list them and fill gaps), so an exposed endpoint cannot be used to burn money.
- [ ] Turn off the **test-only shortcuts** before launch (`dev_otp_for_all`, `ALLOW_ANY_OTP`, `TEST_PHONES`), which today let any number sign in. Already a Phase 10 item; it is a key-safety item too.

### L4. Notice quickly

- [ ] GitHub secret-scanning **email alerts** on, to an address you check daily.
- [ ] **Billing and usage alerts**: Google Cloud budget alert, MSG91 balance alert, Razorpay dashboard email on failed signatures and unusual refunds, Supabase usage email, Vercel usage email.
- [ ] **Sentry alert rules**: spikes in 401/403, App Check `invalid`, webhook-signature failures, and OTP sends per hour.
- [ ] **Canary key**: one fake key (a Google API key with every API disabled, or a Canarytoken) placed in a decoy `.env.honey` that nothing uses. Any use of it means someone read the file.
- [ ] The existing weekly check (hash each secret locally, compare with Supabase's SHA-256 digests) is kept as a "has anything changed that I didn't change" test.
- [ ] Review each provider's sign-in and API-key audit log once a month (a 10-minute calendar reminder).

### L5. Recover fast: the break-glass runbook

Your decision of 2026-10-25 is **no key rotation as of now**, and this plan respects it: nothing here rotates a key. The honest limit is that rotation is the only real cure for a key that has actually leaked. So the runbook is written now and used **only if a key is confirmed leaked** (or at Phase 10, when brand-new live keys are issued, which is not a rotation).

- [ ] Write `docs/KEY_RUNBOOK.md`: one row per secret with *where it is set* (Vercel / Supabase / Vault / EAS), *where it is revoked* (provider page), *what breaks while it is changing*, and *who does it*. Target: any key replaced in under 15 minutes.
- [ ] Always revoke the old key, never just add a new one.
- [ ] Standing order for a leak: revoke, replace, then check provider logs for use between leak and revoke.
- [ ] **Decision needed (section 6):** the old Razorpay test key in public git history (A2) and the ImageKit key pasted in chat (A5). Without rotation they stay usable by anyone who reads them. For Razorpay the harm is limited to a test account. For ImageKit the harm is uploads and bandwidth on your account; the cheap fix is a spend/bandwidth cap (L3) and, when you allow it, a replacement key.
- [ ] Do not "clean" git history (force-push rewrites) without your explicit OK, since AGENTS rule 3 and rule 7 protect `main` and force-pushing; deleting from history also doesn't help once copies exist.

## 4. Order of work

| Step | What | Who | Cost | Effort |
|---|---|---|---|---|
| 1 | Turn on secret scanning + push protection (both repos) | You, or Claude with your yes | Free | 5 min |
| 2 | 2-step sign-in with passkeys on all provider accounts and the domain registrar | **You** (Claude never enters or sets credentials) | Free | 1 to 2 hours |
| 3 | gitleaks in CI + pre-commit; CI permissions and SHA-pinned Actions; confirm A4 | Claude (one PR) | Free | small |
| 4 | Remove admin service-role fallback; startup secret check; log/Sentry scrubbing; bundle-secret test | Claude (one PR each) | Free | small to medium |
| 5 | Password manager for the master copy; BitLocker; keystore backup out of OneDrive | **You** | Free tier | 1 hour |
| 6 | Caps, quotas and billing alerts at Google, MSG91, ImageKit, Razorpay | **You** (Claude lists exact clicks) | Free | 1 hour |
| 7 | Sentry alert rules, canary key | Claude + you | Free | small |
| 8 | `docs/KEY_RUNBOOK.md` | Claude | Free | small |
| 9 | Phase 10: new live keys, separate per service and environment, test shortcuts off, secret-length minimums | Both | Pro plans | at launch |

Steps 1 to 4 close the biggest gaps found in the audit and need no new spending.

## 5. How we will know it works (add to `docs/testing_checks.md`, T2)

- A deliberately fake key in a test branch is **blocked by push protection** and **fails CI**.
- Searching the built web bundle and the APK for every secret name and value prefix finds nothing.
- A request with a stolen anon key and no user token reads nothing private.
- The admin deploy **fails** when `ADMIN_SESSION_SECRET` is removed.
- The canary key, if touched, raises an alert within the hour.
- A dry run of the runbook for one low-risk key finishes in under 15 minutes.

## 6. Decisions I need from you

1. **Rotation exception:** keep "no rotation, ever", or allow rotation **only when a key is confirmed leaked** (and for A2 and A5)? Under "never", the old Razorpay test key and the ImageKit key stay exposed, and the protection for them is only the caps in L3.
2. **Both repos stay public?** Secret scanning is free while public. If they ever go private, GitHub Advanced Security costs extra and gitleaks in CI becomes the main guard.
3. **May I turn on secret scanning and push protection** (a GitHub setting change on your account)?
4. Which password manager do you want to use for the master copy?
