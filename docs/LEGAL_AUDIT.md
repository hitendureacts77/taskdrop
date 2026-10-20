# Legal audit: Terms of Service and Privacy Policy

Written 2026-10-19 from the code on branch `redesigned-2.0`. This is the evidence behind
`apps/mobile/src/legal/documents.ts` (the text the app shows) and the rendered copies in
`docs/legal/` (`npm run legal:export`). **A draft for a qualified lawyer, not legal advice.**

Rule for changing any of it: when the app collects something new or money moves differently, change
`documents.ts` and the matching row below in the same commit.

Stage reminder (AGENTS.md rule 5): the app is in testing, with fake data. The drafts describe the app as it
will run at launch. Rows marked **not live yet** are built but not switched on.

---

## 1. What was wrong in the 6 October draft

| # | Finding | Evidence | Fixed |
|---|---|---|---|
| D1 | **The Terms said wallet credits "cannot be withdrawn". They can.** Since migration 066 top-ups, earnings and refunds are one balance that is spendable and withdrawable. | `supabase/migrations/20260929163637_066_single_wallet_pool.sql:1-12`; `WalletScreen.tsx:70-73` | Terms "Your wallet" |
| D2 | Privacy omitted the **PAN and legal name** asked before a first withdrawal (it appeared only in the deletion paragraph). | `20260929150000_066_razorpayx_hardening.sql:133-138, 335` | Privacy "What we collect" |
| D3 | Privacy omitted **device records** (platform, app and OS version, install ID), **IP addresses** (sign-in throttling), **staff notes/tags** on accounts, and **reports/blocks**. | `092_app_controls.sql:286`; `088_sign_in_throttle_hardening.sql:55-141`; `045_otp_send_throttling.sql:27`; `071_crm.sql:38, 68`; `093_moderation.sql:1-15` | Privacy |
| D4 | Provider list was missing **ImageKit, Vercel, Apple**, and wrongly implied nothing else touched maps. Android uses Google Maps, iPhone Apple Maps, web OpenStreetMap tiles. | `docs/MEDIA.md`; `MapPicker.native.tsx:149`; `MapPicker.tsx:1-3` | Privacy "Who sees it" |
| D5 | Privacy said sign-in is kept in secure storage "on Android". `expo-secure-store` also covers iPhone; the web keeps it in browser storage. | `lib/secureStorage.ts:1-14`; `lib/supabase.ts:16` | Privacy |
| D6 | Privacy said codes are "deleted once used". Code only proves expiry (10 min) and a daily clean-up of expired rows. | `phone-auth/index.ts:52`; `101_inngest_background_jobs.sql:239` | Privacy "How long" |
| D7 | Retention was missing the 30-day password-attempt log, 90-day notifications, 30-day live feed, 1-day IP counter. | see section 3.J | Privacy |
| D8 | Deletion text predated migration 108 (device records, referrals, blocks, rate limits, CRM leads, all chat messages). Admin notes, support tickets and reports are **kept**; the old text did not say so. | `087_account_deletion.sql:1-30`; `108_account_deletion_erases_more.sql:1-20` | Privacy "How long" |
| D9 | Terms said money owed is "still paid" with no mention that a suspension **blocks withdrawals**. | `071_crm.sql:9-10, 347-349` | Terms "Suspending" |
| D10 | Privacy intro said "people nearby" only. Tasks are local **and** remote (AGENTS.md). | `AGENTS.md` product rules | Both intros |
| D11 | No clause for third-party terms, availability changes or app-update requirements; all three exist in code. | `092_app_controls.sql:1-12` (maintenance, min version) | Terms |

## 2. Gaps only you can fill (assumptions are marked; correct them)

| # | Question | Assumption used in the draft |
|---|---|---|
| G1 | **Legal entity**, registered address, support and privacy email. Planned `support@taskdrop.in` (UPGRADE_PLAN.md:129) is not confirmed. | Left to `EXPO_PUBLIC_LEGAL_*`; app falls back to "Help & support", the export shows `[LEGAL ENTITY NAME]` etc. |
| G2 | **Grievance Officer** name and email (IT Rules 2021 need a named person). | `EXPO_PUBLIC_GRIEVANCE_OFFICER_*`. 24-hour acknowledgement and 15-day resolution were already in the 6 Oct draft and are kept. |
| G3 | **Governing law and court city.** | Laws of India; city from `EXPO_PUBLIC_LEGAL_JURISDICTION`. **No arbitration clause** (assumed). |
| G4 | **Minimum age.** | 18, enforced (memory: owner decision 2026-10-05; `082_age_gate.sql:62`). |
| G5 | **Liability cap.** | Fees paid to TaskDrop in the prior 12 months, carried over from the 6 Oct draft. Lawyer to confirm. |
| G6 | **Indemnity.** Not in the 6 Oct draft. | One short sentence (breach of terms → reasonable losses). **Strike it if you do not want it**; it is a legal position, not a product feature. |
| G7 | **Refund policy.** | Only what the code does: full refund before work starts; after start the worker gets the cancellation fee and the rest is refunded; unspent promotion budget returns to the wallet; disputes decided by the team. No "satisfaction guarantee" is promised. (`079_cancellation_fine_and_clearing.sql:1-15`; `046_refund_unspent_campaign_budget.sql:8-15`) |
| G8 | **Fees.** | Not repeated in the text. They are admin-set; "How fees work" shows live values (defaults 3% hiring fee, 10% commission, 5% post-start cancel fee, 7-day clearing, 3-day review: `packages/rules/src/index.ts`). |
| G9 | **Retention period for tax/payment records.** | "As long as Indian tax and accounting law requires". Put a number in once the lawyer or accountant gives one. |
| G10 | **Data regions** of ImageKit, Sentry, Inngest, Expo, Vercel, MSG91. | Policy says "some may process data outside India". Supabase is Mumbai (AGENTS.md). Confirm each region. |
| G11 | **Server and hosting logs** (IP addresses held by Supabase/Vercel/Cloudflare, their retention). Not visible in the repo. | Policy says hosts "see your IP address when you connect"; no retention promised. |
| G12 | **Marketing.** Staff can send "broadcast" messages to segments (`071_crm.sql:68`). | Policy says "sometimes a message from our team in the app". If you will send promotional push or SMS, consent wording is needed. |
| G13 | **DMCA agent** registration and copyright agent env vars. | Open (memory: legal-compliance-open-items). Policy points to the Copyright page and does not claim a registered agent. |
| G14 | **Tax on platform fees** (GST on the fee/commission, TDS on worker earnings). | Terms say only "you are responsible for tax on what you earn". Needs an accountant. |
| G15 | **Payment licensing.** One balance that is topped up and withdrawn is a wallet under RBI's PPI rules (migration 066 says so in its own header); escrow held for third parties is the payment-aggregator question (`docs/PAYING_WORKERS.md`). | The Terms describe what the code does. **This is the lawyer's first question**; the wording may need to change if the money flow does. |
| G16 | **Consent record.** Joining shows "By continuing you agree" (`AccessScreen.tsx:311`) but **nothing stores which version a person accepted, or when**. Only the birth date is recorded. | Not claimed in the text. Recommend a `terms_accepted_version/at` column before launch. |

## 3. Evidence inventory

### A. What the service is, and who can use it
| Fact | Evidence |
|---|---|
| Marketplace: posters describe tasks, workers send offers, poster picks one, TaskDrop holds the money until approval. Tasks are local **and** remote. India first (₹, UPI). | `AGENTS.md:3-5`; `packages/rules/src/index.ts` |
| Users must be 18+; birth date asked once, private, enforced by the server. | `082_age_gate.sql:26, 34, 62`; `components/AgeGate.tsx:14-35` |
| One account does both hiring and earning. | `AGENTS.md` product rules |
| Workers are independent; no background checks. Badges only mark phone/email confirmed; "ID · coming soon". | `screens/AccountScreen.tsx:186-188` |
| Exact address and contacts unlock when work starts; only the area shows before. | `AGENTS.md`; `074_private_locations.sql:1-15`; `058_task_contact_phone.sql` |

### B. Accounts and authentication
| Fact | Evidence |
|---|---|
| Sign-in: phone code by text (MSG91), Google, Apple, username + password. | `functions/phone-auth/index.ts:11, 174`; `AGENTS.md` stack; `app.json:19` (`usesAppleSignIn`) |
| Apple sign-in and iOS app: built, **not live yet** (needs Apple Developer enrolment and TestFlight). | `docs/UPGRADE_PLAN.md:137, 326, 355` |
| Code: 6 digits, valid 10 min, 5 tries, 60 s between sends, 5 sends/phone/hour, 30/IP/hour. | `phone-auth/index.ts:52-58` |
| Passwords are hashed; repeated failures lock the username (8 per 15 min, 20 per 24 h) and the IP. | `088_sign_in_throttle_hardening.sql:76-90`; `password-auth/index.ts:88` |
| Session: SecureStore on phones, browser storage on web. | `lib/secureStorage.ts:1-14`; `lib/supabase.ts:16`; `providers/AuthProvider.tsx:206, 287` |
| **Launch blocker (not a legal text issue):** `dev_otp_for_all` is ON in the test project, so any number signs in. The function arms it only with no MSG91 keys, but it must be off before real users. | `phone-auth/index.ts:66-90`; memory `dev-otp-for-all-on` |

### C. Personal data collected, where it lives
| Data | Where | Evidence |
|---|---|---|
| Phone, email (Google/Apple), password hash | Supabase Auth | `phone-auth/index.ts`; `087_account_deletion.sql` (auth.users scrub) |
| Birth date | `age_checks` | `082_age_gate.sql:30-36` |
| Name, username, photo, bio, skills, languages, intent | `profiles` | `001_core_schema.sql`; `048_marketplace_features.sql` (username, intent, bio); `087_account_deletion.sql` (the scrub) |
| Approximate location (~1.1 km) public; exact private | `profiles.loc_*`, `profile_private`, `task_private` | `074_private_locations.sql:1-50` |
| Tasks, offers, chat, proof, reviews, disputes | `tasks`, `bids`, `messages`, `task_proofs`, `reviews`, `task_disputes` | migrations 001, 011, 012 |
| Photos | ImageKit (private, signed 1-2 h links), `media` table | `docs/MEDIA.md` (**not live yet**: needs ImageKit secrets and migration 106 applied; until then Supabase Storage) |
| Videos, documents (video ≤60 s, files ≤50 MB) | Supabase Storage | `docs/MEDIA.md`; `AGENTS.md` |
| Payments, refunds, payouts, wallet | `payments`, `payouts`, `wallets`, `platform_ledger`; Razorpay holds the card/UPI data | `007_payments.sql`, `065_razorpayx_payouts.sql`; `functions/razorpay/index.ts:38, 159` |
| UPI id / bank account, IFSC, holder name | `payout_destinations` | `026_payout_destinations.sql` |
| **Legal name + PAN** before first withdrawal; the app shows the last four | `payout_profiles` | `066_razorpayx_hardening.sql:133-138, 159-202, 335` |
| Presence ("Active now") | `profiles.last_seen_at/live_until` | `048_marketplace_features.sql:23` |
| Saved tasks, referrals (who referred whom, no reward), promoted-post views/taps | `saved_tasks`, `referrals`, `ad_events` | `048:464-473`; `045_ads_auction_delivery_and_events.sql` |
| Reports, blocks | `reports`, `blocks` | `093_moderation.sql:1-45`; block enforced on bids `097_closeout.sql:249` |
| Support tickets, feedback | `support_tickets`, `support_messages`, `feedback` | `048:302` |
| Device: platform, app + OS version, install ID, last seen | `app_devices` | `092_app_controls.sql:286` ; `lib/appInfo.ts:46` |
| Push token | `push_tokens` | `051_push_notifications.sql` |
| IP address (throttling only) | `auth_send_log`, `password_attempts` | `045:27`; `048:615`; `088:55-141` |
| Staff: private notes, tags, follow-ups, leads, broadcasts | `crm_notes`, `crm_user_tags`, `crm_leads`, `crm_broadcasts` | `071_crm.sql:38, 68`; `097_closeout.sql` (leads) |
| Staff audit log; admin live feed | `admin_audit_log`, `admin_live_events` | `076_audit_throttle_live_notifications.sql`; `091*` |
| User-sync mirror (id, state, field names changed, never values) | `user_sync` | `103_user_sync.sql:8-25` |
| Permissions requested | location (foreground only; background **blocked**), camera, microphone, photos/video, notifications | `app.json:38-47` |

### D. Third parties that receive data
| Service | Receives | Evidence |
|---|---|---|
| Supabase | everything above; Mumbai region | `AGENTS.md` |
| ImageKit | photos | `docs/MEDIA.md` |
| Vercel | hosts web app and admin | `AGENTS.md` |
| Razorpay / RazorpayX | payment, refund, payout details | `functions/razorpay/index.ts:38`; `_shared/razorpayx.ts:37` |
| MSG91 | phone number + code text | `phone-auth/index.ts:174` |
| Google | sign-in; Places search (called **directly from the device** with the `EXPO_PUBLIC` key, not via the `places-search` function, which no screen calls); Android map; Chrome speech for web voice typing | `lib/location.ts:293`; `MapPicker.native.tsx:149`; `lib/speech.ts:1-15` |
| Apple | Sign in with Apple; iPhone map | `app.json:19`; `MapPicker.native.tsx:149` (provider undefined on iOS) |
| OpenStreetMap | search words, pin position, tile requests (IP) | `lib/location.ts:239, 329`; `MapPicker.tiles.tsx` |
| Expo | push messages | `functions/inngest/jobs.ts:159, 196` |
| Sentry | crash reports, logs, counters, 5% session replay (all text/images/icons masked; web has no replay), `sendDefaultPii:false` | `lib/monitoring.ts:21, 40-61` |
| Inngest | names and amounts, never phone/email/bank/UPI | `functions/inngest/jobs.ts:47, 274`; `103_user_sync.sql:8-14` |
| Not found (so not claimed): advertising networks, analytics SDKs, cookies other than session storage, email-sending service. | grep of `apps/mobile/src`, `package.json` |

### E. Money
| Rule | Evidence |
|---|---|
| Poster pays the offer + hiring fee into escrow (Razorpay or wallet); held until approval. | `packages/rules/src/index.ts`; `063_wallet_funded_tasks.sql` |
| Review window then auto-release; clearing period before earnings reach the wallet. | `packages/rules/src/index.ts:TIMING`; `079:17-24` |
| Cancel after start: worker is paid the fine, rest refunded. | `079_cancellation_fine_and_clearing.sql:5-15, 89-103` |
| One wallet; withdrawals to UPI/bank via RazorpayX; minimum ₹100; name + PAN first. | `066_single_wallet_pool.sql`; `WalletScreen.tsx:56`; `066_razorpayx_hardening.sql:335` |
| Disputes decided by the team. | `DisputesScreen.tsx:13-14`; `068_admin_dispute_and_money_position.sql` |
| Promotion: paid up front, unspent budget refunded to wallet. | `046_refund_unspent_campaign_budget.sql:8-15`; `PromoteScreen.tsx` |
| Top-ups, withdrawals, promotions can each be switched off by staff. | `092_app_controls.sql` (columns `topups`, `withdrawals`, `promotions`) |
| No subscriptions, in-app purchases or auto-renewals found. | grep |

### F. User content and moderation
| Fact | Evidence |
|---|---|
| Users upload photos, videos, files, chat and reviews; TaskDrop stores, resizes and shows them. "Users keep ownership, TaskDrop gets a licence to run the service" is a **legal position carried from the 6 Oct draft**, not something code enforces. | `CopyrightScreen.tsx:12-18`; `docs/MEDIA.md` |
| Report a person/post; "report and block" sheet; blocks managed in Account. | `ReportSheet.tsx:50`; `PublicProfileScreen.tsx:121`; `TaskDetailScreen.tsx:560`; `AccountScreen.tsx:358` |
| Staff can hide a task and suspend accounts. | `093_moderation.sql:73-88`; `071_crm.sql:318` |
| Copyright notice/counter-notice, strikes for repeat infringers. | `085_copyright_takedowns.sql:20, 64`; `CopyrightScreen.tsx:198-208` |

### G. AI
**None.** Posting uses a keyword writer that runs on the device, "by the owner's choice"; the AI assistant was removed.
`lib/taskBrief.ts:3-9`; `screens/AiPostScreen.tsx:59-63`; `067_remove_ai_assistant.sql`. Web voice typing is the
browser's speech service. So the Terms deliberately have **no AI-output section**. (The "AI writer" violet in the
colour palette is a name only.)

### H. Limits enforced in code
Per person per minute: 300 reads, 60 writes, 20 uploads (`functions/api/ops.ts:28`; `084_api_rate_limit.sql`);
60 place searches per 10 min (`places-search/index.ts`, unused by the app today); upload limits 15 MB per picture, 100
unfinished uploads (`docs/MEDIA.md`). The Terms do not quote numbers; they only say TaskDrop limits repeated attempts.

### I. Suspension, termination, deletion
- Suspension bans sign-in, ends sessions, blocks withdrawals; jobs and money stay put (`071_crm.sql:9-10, 318, 347-349`).
- Self-service deletion (Account & settings → Delete account), blocked while money or tasks are in motion; staff can delete too (needs authenticator code). What goes and what stays: `087_account_deletion.sql:1-30`, `108_account_deletion_erases_more.sql:1-20`.
- Kept after deletion: paid tasks (+proof, reviews), payments/payouts/wallet history, PAN+legal name if ever paid out, disputes, support tickets, reports, admin notes.
- 108 is the latest migration in the repo; **confirm it is applied** to the project before the Privacy text goes live.

### J. Retention actually coded
| Item | Period | Evidence |
|---|---|---|
| Sign-in codes | expire 10 min; expired rows deleted after 1 day | `phone-auth:52`; `101:239` |
| IP send counter | 1 day | `101:242` |
| Password attempts (username + IP) | 30 days | `101:236`; `088:141` |
| Place-search counter | 1 day | `101:245` |
| Notifications | 90 days | `101:248`; `104:139` |
| Internal alert log (`admin_alerts`) | 30 days | `090_outbox_inngest.sql:322` |
| Outbox events | 14 days after sending | `090:320` |
| Staff live feed | 30 days | `091d:63`; `104:141-148` |
| API rate rows | 1 hour | `101:233` |
Note: several prunes (101) switch from pg_cron to Inngest at the cutover (`AGENTS.md`); the periods do not change.

### K. User controls: implemented vs not
| Control | Status |
|---|---|
| Delete account | **Implemented** (app + admin) |
| Edit profile, username, password | Implemented (`AccountScreen.tsx`, `ProfileEditScreen`) |
| Turn off location / notifications | Phone settings only (no in-app switch) |
| Block / unblock | Implemented |
| Correct data | Profile fields in-app; the rest by contact |
| **Export / "summary of my data"** | **Not implemented.** Policy says to contact us. |
| Withdraw consent | By contact or by deleting the account |
| Cookie banner | None; none needed (no ad/analytics cookies found) |

## 4. Reviewer notes for the lawyer

1. First question: G15 (RBI PPI / payment-aggregator posture of the one-balance wallet and escrow). The Terms may need to change if the money flow does.
2. Confirm the DPDP Act wording (rights, grievance timings, Data Protection Board) against the rules in force at launch; consent and "legitimate use" bases are not argued in the text.
3. Confirm the indemnity (G6), liability cap (G5), and that no arbitration clause is wanted (G3).
4. Check Terms acceptance (G16) and whether a version/timestamp must be stored.
5. Apple and ImageKit are described as live; both are built but not switched on (section 3.B, 3.C). Re-read before launch.
6. The Privacy Policy lists data about people who are not users (staff **leads**: name and contact). Decide whether that needs its own notice.
7. Nothing here claims DMCA compliance, a registered copyright agent, or lawyer approval. The app shows a "Draft — under legal review" note until `EXPO_PUBLIC_LEGAL_REVIEWED=yes`.

**This is a draft prepared from the codebase. It must be reviewed by a qualified attorney before publication.**
