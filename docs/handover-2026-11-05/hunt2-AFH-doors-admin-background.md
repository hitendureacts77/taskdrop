## Round 2, parts A, F and H (doors, admin app, background work)

Read on 4 Nov 2026 at `redesigned-2.0` (user app + backend, and admin app). Code read by hand; database facts checked with read-only questions to staging (`wjxvingpfbfvkfqhrguj`, fake data only). Nothing was changed, no test was run against the app, no spam or load. No phone number, email, code or key is printed here.

### Summary for you

- **No Critical, no High.** The big doors held: every `api` action runs as the signed-in person under the database's row rules; every admin page, route and button checks the staff role on the server; admin changes to roles are blocked at table level even if someone skips the screen; the payment and payout messages are signed; a withdrawal cannot be sent twice (it has its own one-time key).
- **12 Medium and 8 Low findings** (holes H35 to H50, bugs B16 to B19). The ones I would fix first: **H35** (a read-only staff role can still send refunds and RazorpayX payouts, with no authenticator code), **H36** (those refunds are not in the audit log), **B16** (money paid but the job not funded is never retried by itself), **H37** (staff login cookie can be read by page scripts and Supabase does not enforce the idle/12-hour limits), **H38** (videos keep the GPS location inside them).
- **Correction to round 1 on photo location (H):** pictures kept in ImageKit are served only through signed links that always include a resize step, and ImageKit's own documentation says it removes all metadata (including GPS) from every transformed image by default. So the **photos in ImageKit are fine**. What is *not* covered: videos, documents, and any picture that goes to Supabase Storage instead (H38).
- **Decisions for you:** H35 to H37 (how strict staff roles and the admin login cookie should be), H42 (what a locked phone screen may show), H47 (whether tasks and ideas get a daily posting cap), H33 (already open: who sees phones and emails).

---

## A. Every door

### A1. The `api` function (one door, 128 named actions)

Counted by name in the source: 71 reads, 53 writes, 4 media (round 1 said 123 = 67 + 52 + 4; the extra ones are the actions added since, `nearbyPulse`, task questions, feedback board, sessions). Every call, before it reaches an action, passes in this order: signed-in check (token read and checked on the server), the account standing check (suspended or deleted people are refused), the "sessions were ended" check, the admin's switches (maintenance, version, feature off), then the per-person limit. Only reads may travel in a batch (up to 20, each counted).

| Group | Actions | Who may call | Private data it can return | Moves money | Limit |
|---|---|---|---|---|---|
| Marketplace reads | listOpenTasks, searchTasks, searchTasksWithPosters, attachPosters, recommendedTasks, remoteTasks, tasksNear, urgentTasks, workersNear, listActiveWorkers, workerServices, getTask, getProfile, getPosterStats, listReviewsAbout, publicProfileStats, topEarners, trendingCategories, platformStats, platformHighlights, nearbyPulse, usernameAvailable, listFeedbackBoard, getFeedbackPost, adAuctionRanks, platformFees, promotionTiers | Any signed-in person | Only the rounded area of a place. No phone, email, address, PAN or bank. **But `getProfile` and `listActiveWorkers` send every profile column, three of which should not be public (H45)** | No | read, 300 a minute |
| Task-party reads | getTaskDetail, listBidsForTask, countBidsByTask, getMyBid, canQuoteOn, getProof, listMessages, listThreads, listCrewMessages, crewOverview, listTaskQuestions, listMyDisputes, listDisputeReasons, workerProofPhotos | The task's poster, the person who quoted or was hired, staff (decided by row rules, checked on staging) | Typed address only to the poster, the hired person and staff (`task_private` rule). Chat, proofs and quotes only to the two sides | No | read |
| Phone number | taskContactPhone | The other side, only after work has started (decided inside the database function) | The other person's phone | No | read |
| Own data only | listMyTasks, listMyBids, listMyAssignments, listSavedTasks, listSavedTaskIds, listBlockedUsers, getWallet, getEscrowHeld, listWalletActivity, listPayouts, listPayoutDestinations, listPromotions, promotableTasks, feesSince, myStats, myStreaks, myRegulars, accountDeletionCheck, countNeedsAttention, listNotifications, getNotification, countUnread*, notificationSides, listTickets, getTicket, countMyReferrals, ageStatus, isAdmin | The person themselves; each query names `ctx.userId` so a staff account does not get everybody's rows | Own bank account number / UPI (`listPayoutDestinations`), own wallet | No | read |
| Task life | lockBid, payTaskFromWallet, startTask, markWorkDone, confirmRelease, requestRevision, cancelTask, openDispute, submitReview, removeListing | Poster or helper as the database function decides | No | **Yes** (all rules in database functions) | write, 60 a minute |
| Earnings | settleClearedEarnings, requestWithdrawal, cancelWithdrawal, setDefaultPayoutDestination, addPayoutDestination, removePayoutDestination | The person themselves | Stores bank account number as typed (plain text, own rows only) | **Yes** | write |
| Promotions | startPromotion, activatePromotion, cancelPromotion, recordAdImpression, recordAdClick | The advertiser / any viewer | No | **Yes** (budget); clicks free | write. **recordAdClick has no per-person cap (H43)** |
| Content | createTask, updateListing, placeBid, updateBid, submitProof, sendMessage, sendCrewMessage, setRepeat, setWeeklyGoal, askTaskQuestion, answerTaskQuestion, postFeedbackIdea, voteFeedbackIdea, commentFeedbackIdea, sendFeedback, openTicket, replyTicket, resolveTicket, reportContent, blockUser, unblockUser, setSaved, markNotificationsRead | Any signed-in person, row rules decide the rest (contacts refused in text; typed address split off) | No | `createTask` with auto-hire checks wallet | write. **No daily cap on posting tasks or feedback (H47)**; questions (3 per task, 20 a day) and tickets have daily caps in the database |
| Account | updateProfile, updateProfileExtras, touchPresence, recordBirthDate, deleteMyAccount, endMySessions, registerPushToken, recordDevice, applyReferralCode | The person themselves | No | No | write |
| Files | createUpload, attachMedia (upload bucket, 20 a minute), signMedia (read), removeMedia (write) | Any signed-in person for their own folder; signMedia only returns links the row rules allow | Signed picture links, 1 to 2 hours | No | upload / read / write. **No total-size cap per person (H44)** |
| No sign-in | `{op:"health"}` | Anyone with the public key | Only "database up/down" | No | none (cheap) |

Findings from this table: no action without an owner check. No action without a limit, but three limits are too loose for the cost they allow (H43 clicks, H44 file volume, H47 posting).

### A2. Other server functions

| Function | Who may call | Private data | Money | Limit | Notes |
|---|---|---|---|---|---|
| `phone-auth` (send / verify) | Anyone, no sign-in (on purpose) | Tells whether a phone number has an account (H49) | No | per number 5 an hour + 60 s wait, per address 30 an hour, per phone install 8 an hour (optional header), whole day 500 (`sms_daily_cap`) | Costs SMS money; see H40. Codes kept in plain text in `auth_codes` (H48) |
| `password-auth` | Anyone | No (email never returned) | No | per username and address, 15 min and 1 day, refuses when counter is down | Good |
| `razorpay` (create-link, sync, refund-escrow) | Any signed-in person for own task / payment; staff for any refund | No | **Yes** | 30 a minute a person | **Any admin-role staff, even Viewer, can send a refund (H35).** No suspended-account check (H46). Duplicate payment links for one task (B17). Paid-not-funded not retried (B16) |
| `razorpayx-payouts` (send, sync-mine, check-all, give-back, balance) | Owner of the withdrawal; "admin" actions for anyone holding the admin role | No | **Yes** (idempotent: claim + one-time key per withdrawal) | 20 a minute | **Viewer / Support / Sales can call check-all, give-back, balance (H35).** Off while `payout_method` is `manual` (it is) |
| `razorpay-webhook`, `razorpayx-webhook` | Razorpay (signature) | No | Yes | signature check before any row is read | Held up; see B16 for the retry gap |
| `places-search` | Any signed-in person | The text typed is sent to Google / OpenStreetMap | No (Google bill) | 60 per 10 minutes a person, no daily or overall cap | H39 |
| `app-config` | Anyone (public on purpose) | No | No | none | Read-only switches |
| `inngest` | Inngest only (signature) | No | Money sweeps are off (`INNGEST_MONEY_JOBS`) | n/a | Signature check is skipped if `INNGEST_DEV=1` is ever set (H50) |
| Database functions a signed-in person can run | 132 (round 1) | | | | Not re-listed here; part E/C covered the new ones |

All functions except `phone-auth`, `password-auth`, `app-config`, `inngest` and the two webhooks have "check the sign-in token" on in Supabase (checked from the live function list).

### A3. Admin app doors

| Door | Count | Role check on the server | Notes |
|---|---|---|---|
| Pages | 40 (38 behind sign-in; login and "not allowed" are open) | Every dashboard page calls `requireAdmin` or `requireSeeing`; money and settings pages use `requireSeeing`, so Sales is sent away | Checked file by file |
| Server actions | 61 in 11 files + sign-out | Each calls `requireAdmin()` then `staffGate(area)`; money ones also need the authenticator code | Only `markAlertsRead` and own-alerts toggle have no area gate, on purpose |
| Route handlers | 7 | `checkAdmin()` inside each; exports write the audit row before building a row | Held up |
| Middleware | 1 | Refreshes session, nonce CSP, 30-minute idle, 12-hour cap | See F |

### A4. Inngest jobs (18 always on, 3 more when `INNGEST_MONEY_JOBS=on`)

| Job | Trigger | Runs twice safely? | Sends something outside? |
|---|---|---|---|
| outbox-sweeper (every 5 min) | cron | Yes: the outbox row id is the event id, so Inngest drops a repeat | Events to Inngest only |
| outbox-prune, outbox-watchdog, housekeeping, overdue-tasks, crm-rules, user-sync-repair, sms-pumping-watch, task-reminders | cron | Yes: each rule and its "once per person" guard live in the database | In-app notices only |
| team-alert, daily-digest | event / cron | Mostly: a retried save after a lost answer could write a second alert (B18, harmless) | No |
| nightly-reconcile | cron | Yes, read-only | Razorpay read |
| push-notification | event | Mostly (B18) | Expo push |
| account-files, media-purge | event / cron | Yes | Supabase Storage, ImageKit deletes |
| user-created / updated / deleted | event | Yes: one at a time per person, out-of-order safe | No |
| auto-complete-due, settle-cleared-earnings, settle-finished-campaigns | cron | Said to be safe twice; off today (pg_cron runs them) | No |

Payouts, SMS, and refunds do not run through Inngest yet, so none of them can be doubled by an Inngest retry today.

---

## F. The admin app

| Question | Answer | Evidence |
|---|---|---|
| Does every route / action check the staff **role** on the server (not just signed-in)? | **Yes for the panel's own code.** 61 server actions, 7 routes, 38 pages. **No for refunds and RazorpayX actions, which go through two Supabase functions that only look for "has admin role" (H35)** | `src/lib/staff.ts`, `lib/actions.ts` (all money actions), `razorpayx-payouts/index.ts:67-73,116-128`, `razorpay/index.ts:349`, `mfa.ts` comment |
| Can a role raise its own or another's role? | **No.** The screen blocks it, the database function blocks changing your own role and removing the last full admin, and a table-level rule (`require_staff_permission`) refuses any change to `admin_staff` or `user_roles` unless the caller's role is full Admin **and** the session has entered an authenticator code. Checked in the live database (not only the code) | functions `admin_set_staff`, trigger `require_staff_permission`, `require_admin_mfa` |
| Is every change written to the audit log? | **Nearly.** Role, setting, suspension, payout, wallet-change, dispute, copyright and hide/unhide changes are written by database triggers or the function itself (cannot be skipped from the panel). **Not logged: refunds sent through Razorpay, and RazorpayX give-backs / checks (H36).** Opening a person's page (phone + email visible) is not logged (part of H33) | audit triggers list on staging; `record_escrow_refund` has no audit call |
| CSRF (another website making an admin act)? | **Held up.** Every change is a Next.js server action (POST, Next checks the Origin against the host by default; no `allowedOrigins` widening in `next.config.mjs`), the session cookie is `SameSite=Lax`, and the only GET routes with an effect just write one audit row and return a file the other website cannot read (`Cross-Origin-Resource-Policy: same-origin`). Login callback uses the one-time code Supabase sends | `next.config.mjs`, the 7 route files |
| 30-minute idle and 12-hour caps hold on the server? | **Yes at the admin website** (middleware checks on every request, including actions and exports; idle time is in a signed HttpOnly cookie tied to the session; background refreshes do not count; missing cookie = idle). **No at Supabase:** the underlying login is not limited (H37). The secret that signs the idle cookie is required at build time; if it were missing the idle check would switch off with only a log line, but the build refuses without it | `middleware.ts:55-190`, `scripts/check-required-env.mjs` |
| Cookie flags | Idle cookie `td_admin_active`: HttpOnly, Secure in production, SameSite=Lax. **Login cookies `sb-...`: HttpOnly NO, Secure not set, SameSite=Lax, lasts 400 days (library defaults, no override)** (H37). The comment in `api/auth/password/route.ts` ("httpOnly session cookies") is wrong | `node_modules/@supabase/ssr/dist/main/utils/constants.js:4-10`; no `cookieOptions` anywhere in `src` |
| Search and exports: full phone / email / address only to roles that need them? | **No.** Any role sees full phone + email on a person's page and in the People export (H33, known); the leads export carries each lead's contact to every role; Sales is correctly blocked from money columns. The admin never shows the typed address | `lib/data/users.ts:203-204`, `UserView.tsx:210-216`, `api/crm/leads/export/route.ts` |
| Does the admin fall back to the service-role key (H4 stays closed)? | **Yes, closed.** The session client is built only from the person's cookies, no fallback to the service key. The service client is used in 11 places, all read-only except one (storage cleanup after deleting an account), each behind `requireAdmin`. The idle cookie secret is its own key | `lib/supabase/server.ts`, `service.ts`, grep of all uses |
| Sentry in the admin | No replay, no user identity, text scrubbed of keys / phones / emails | `instrumentation-client.ts`, `sentry.*.config.ts` |

---

## H. Background work and outside services

| Question | Answer |
|---|---|
| Can a retried job send two pushes / SMS / payouts? | **Payouts and SMS: no**, neither runs in Inngest, and a payout has a one-time key at RazorpayX. **Push: only in a rare case (B18).** Events are de-duplicated by the outbox id, the fast path and the five-minute sweeper cannot double up. |
| Do push messages show private detail on a locked screen? | **Yes (H42).** Title and body are the same text shown in the app. Seen on staging: other person's name + task title, rupee amounts ("₹98 is back in your wallet", "withdrawal of 100 rupees"), support reply text, the first 100 characters of a chat message (after work starts chats may hold a phone number or address), "wrong password" alert. |
| Photos: only real images and videos of fair size kept? | **Yes.** Pictures: ImageKit file must be inside the person's own folder, private, of type image and at most 15 MB, else deleted. Everything else: the storage bucket allows only listed types (images, mp4/mov/webm, PDF, text/CSV, Office) and 50 MB, enforced by Supabase. Gaps: type is judged from the label the uploader sends, not the file's content (low); no per-person total (H44); uploads outside the checked path to ImageKit (H41). |
| Location (EXIF / GPS) removed before others can open? | **Pictures in ImageKit: yes.** Every link the app or the admin makes is signed *including* a resize step (`tr:w-..,q-80,f-auto`), the signature covers it, and ImageKit's documentation says it strips all metadata from images by default unless `md-true` is added. The original file (with GPS) stays private in the ImageKit account. The phone picker also re-compresses at quality 0.8 and does not ask for EXIF. **Not covered: videos, documents, and pictures sent to Supabase Storage** (used when ImageKit keys are missing, and for older builds) are served as uploaded (H38). To prove it with a real photo, test that adding `?tr=md-true` to a signed link is refused (not tested, no real photo/ link used here). |
| SMS and place search: cost caps? | SMS: per number, per address, per install, one daily total (500 on staging), plus a bot watch every 15 min. Missing: per-number daily cap, protection of the daily total from being used up by one bot (H40). Places: 60 per 10 min per person and nothing else (H39). |
| Do Sentry and logs avoid phone numbers, codes and addresses? | **Yes.** Server logs carry ids, op names, counts, error text only; the last-net scrubber hides phones, emails, keys; the phone app turns replay text masking on and strips user identity; the admin sends no identity or replay. One small leak: the function's plain console lines are not scrubbed (they hold ids only today), and the admin's export audit text stores the search box text (B19). |

---

## New findings

### Holes (from H35)

| # | Finding | Level | Evidence | Failure scenario | Suggested fix |
|---|---|---|---|---|---|
| H35 | Refunds and RazorpayX actions skip the staff role and the authenticator code. The two functions only check "has the admin role", and the database sees them as the service role, so the table rules do not apply | Medium | `razorpayx-payouts/index.ts:67-73,116-128` (`check-all`, `give-back`, `balance` need only `user_roles admin`); `razorpay/index.ts:349` calls `escrow_refund_due`, whose only role rule is "not Sales" (`private.assert_not_money_blind`, checked on staging); `mfa.ts` header says the panel "is the only check" for these | A Viewer or Support account (or one stolen) sends the app's token straight to the functions: sends the refund on any cancelled funded task, triggers sends / give-backs of withdrawals. The amount and recipient are right (the database works them out), so no theft, but "Viewer changes nothing" and "money needs a code" are both false for these paths | In both functions, call the database's existing `assert_money_staff()` as the caller (this checks role money + authenticator level) before acting; add a test that a Viewer is refused |
| H36 | Refund sends and RazorpayX give-backs leave no row in the admin audit log (only a Sentry log line) | Medium | No audit trigger on `payments`; `record_escrow_refund`, `claim_escrow_refund` have no audit call (staging); `razorpayx-payouts/index.ts:124` logs to Sentry only | Money goes back to a poster and nobody can say which staff member pressed it | Have both functions call `admin_log_event` (as the caller) after success; or add an audit trigger on `payments.refunded_minor` |
| H37 | The admin login cookies can be read by page scripts, and nothing limits the Supabase login itself | Medium | `middleware.ts:176-180` and `lib/supabase/server.ts` pass the library's cookie options unchanged: `httpOnly:false`, no `secure`, 400 days (`@supabase/ssr` `constants.js:4-10`). The 30-minute / 12-hour rules run only in `middleware.ts`; the comment at `:66-67` says Supabase's own timeout is project-wide so it is not used. The password route comment claims "httpOnly session cookies" (`api/auth/password/route.ts:12-14`) | A script that gets onto an admin page (a hijacked package, or an XSS if one is ever found; the strict script policy makes this hard) reads the refresh token. The thief calls Supabase directly (the public key is public) for as long as the token lives, and the admin site's idle / 12-hour sign-out never runs because no request goes through it | Make the login cookies HttpOnly + Secure in the middleware and server client; move the two places that use the browser client (live panel, authenticator panel) to read what they need through a server route. And keep a database-side "last active" so `private.is_admin()` refuses a session idle for 30 minutes or older than 12 hours. Your decision on the amount of work |
| H38 | Videos, documents, and any picture sent to Supabase Storage keep their location data and other file details | Medium | `api/media.ts:116-129` (every non-ImageKit file goes to the bucket unchanged); bucket allows mp4/mov/webm, PDF, Office (staging `storage.buckets`); `can_read_task_media` lets any signed-in person open a job's video while the job is OPEN | A poster films the job on a phone that stores GPS in videos. While the job is open every signed-in person can download a clip with the exact spot where it was filmed. Same for a picture if ImageKit keys are absent (production, before 5.x) | Pictures: refuse the Supabase fallback in production (ImageKit only). Videos: strip metadata on a server job (`ffmpeg -map_metadata -1`) before the file is shown, or move video to a host that re-encodes. Tell people on the upload screen until then |
| H39 | Place search has no daily or overall limit | Medium | `places-search/index.ts:30-31,71-81`: 60 per 10 minutes per person, nothing else; Google Places is billed per call | One account (accounts are cheap while codes are auto-filled; later just a phone) sends 8,640 searches a day; ten accounts, 86,000 | Add a daily cap per person (for example 150) and a daily total; past the total fall back to OpenStreetMap only; make sure a billing cap / quota is set in Google Cloud |
| H40 | SMS: a victim's phone can be texted 120 times a day; one bot can use up the whole day's allowance | Medium | `phone-auth/index.ts:58-61,340-351` (5 per number per hour, window restarts each hour); `hit_sms_daily_cap` (500 on staging, one shared counter); lookups that end in "no account" also use the allowance (`:268-324`) | A person is harassed with codes at 5 an hour all day; or a bot with about 17 addresses burns the 500 in an hour, and nobody new can sign in by SMS until midnight (Google still works) | Per-number daily cap (for example 10); keep a reserve of the daily total for numbers that already have an account; count only real sends; add a bot check at sign-up |
| H41 | An uploaded ImageKit file is not tied to the checked path | Medium | `_shared/imagekit.ts:86-89`: the upload token is signed over token + expiry only; the app picks folder, file name and privacy. `api/media.ts:152-168` checks only the registered path; `jobs.ts:310-316` cleans only registered paths | A signed-in person uploads files with their own names to any folder, public, or just large ones (20 uploads a minute): they take storage and bandwidth, or sit on your ImageKit address with whatever content, and are never found or removed | Weekly job listing ImageKit files that have no `media` row and deleting them; check the account's upload settings (allowed types, size, private-by-default) in ImageKit; make a staging test with a real token |
| H42 | Lock-screen pushes show private detail | Medium (your decision) | Push title and body are the notification text: `push_job_load` in migration 101; chat body is the first 100 characters (migration 128 around `messages_notify_other`); amounts and names seen in staging `notifications` | A phone on a table shows "Ravi: send me the address is 12 Rose Lane..." or "₹98 is back in your wallet" to whoever walks by | For kinds message, payout, wallet, support, security send a plain line ("You have a new message") and keep the detail inside the app |
| H43 | Ad clicks are free, unlimited and unchecked, and they raise a promotion's rank | Medium | `record_ad_click` inserts a row on every call, no dedupe, does not exclude the advertiser; `private.ad_ectr` ranks by clicks / (impressions + 50) (staging); write limit 60 a minute | An advertiser clicks their own promoted job 60 times a minute and wins the top slot (and a lower second price); the table `ad_events` grows by 86,000 rows a day per account. Fake accounts can also drain a rival's daily budget with impressions | One click per viewer per promotion per day; refuse the advertiser's own clicks; cap impressions per promotion per viewer; clean old events |
| H44 | No limit on the total files a person can store | Medium | `api/media.ts:116-129` and `ops.ts:28`: 20 uploads a minute, each up to 50 MB, nothing per day or per person; `media_begin` caps only 100 pending ImageKit pictures | One account fills Supabase Storage (1 GB on the free plan) in a minute of uploads | Per-person daily and total cap in `media_begin` (also for Supabase files); alert on storage use |
| H45 | Three profile fields are readable by every signed-in person | Low | `profiles_select_all` (rows) and the column grants list `sessions_revoked_at`, `sessions_keep_session`, `weekly_goal_minor`; `reads.ts:346-351` returns the whole row | Anyone can look up when another person last signed out of all devices (a password change) and their weekly earnings goal | Revoke those columns from the app role; read them through the person's own function |

### More holes (H46 to H50; H47 is Medium, the rest Low)

| # | Finding | Level | Evidence | Scenario | Fix |
|---|---|---|---|---|---|
| H46 | Money and place functions do not check that the person is suspended or deleted | Low | `api` does (`core.ts:262-270`); `razorpay`, `razorpayx-payouts`, `places-search` use only the token (grep: no standing check) | A suspended person's token (up to an hour) still makes payment links | One shared standing check for all functions |
| H47 | No daily cap on posting tasks, services or feedback | Medium (before launch) | `tasks_insert_own` policy and the task triggers have no rate rule (staging); `feedback_insert_own` the same; only 60 writes a minute | A new account posts a thousand fake jobs an hour into the public feed; crew posts make ten rows each | Daily cap per account in the database (for example 20 tasks, 20 feedback), tighter for new accounts |
| H48 | Sign-in codes are kept in plain text in `auth_codes` | Low | `phone-auth/index.ts:357-369` | Anyone reading that table (backup, a database slip) can use a live code for 10 minutes | Store a hash |
| H49 | Anyone can learn whether a phone number has a TaskDrop account | Low | `phone-auth/index.ts:318-326` ("account exists" 409 / "no account" 404), only counted against the address budget | Someone checks if a named person uses the app | Same answer for both, sign them in or up by the code |
| H50 | The Inngest signature check is off if `INNGEST_DEV=1` is ever set | Low | `inngest/index.ts:62-71` | A mistaken setting on production lets anyone run the jobs | Add a startup refusal when `INNGEST_DEV` is set and the project is not staging |

### Bugs (from B16)

| # | Finding | Level | Evidence | Scenario | Fix |
|---|---|---|---|---|---|
| B16 | A payment that is paid but whose job could not be funded is never retried | Medium | `razorpay-webhook/index.ts:120` returns "already settled" once the payment row says paid, and `razorpay/index.ts:264-271` (`sync`) does the same, so neither calls `fund_task_from_payment` again. The comment at `webhook:144-146` ("the app will fund on its next poll") is not true. Only the nightly check (`paid_not_credited`) notices, next morning | One short database hiccup at the wrong second: the money is taken, the poster sees "paid", the helper cannot start, the poster waits until a person acts | When a paid escrow payment arrives (webhook or sync) and the task is not funded, call `fund_task_from_payment` again (it is safe twice) |
| B17 | Two payment links can be paid for the same job | Low | `razorpay/index.ts:155-170`: create-link only checks "already funded", not "a link is already open" | Double tap on a slow network makes two links; paying both charges twice, the second is only flagged next night | Return the open link if one exists for the task |
| B18 | Rare double push / double alert | Low | `inngest/index.ts:232-246`: if the function times out after Expo accepted the message, the step is retried; the alert save is the same | Someone gets two identical pushes after a slow moment | Accept (cannot be fixed without an Expo key), or store a "sent" mark per notification id |
| B19 | The people-export audit text stores the search box text | Low | `api/crm/export/route.ts:51-54` writes `req.url` query into `p_detail` | A staff member who searched a phone number leaves it in the audit log | Store only the filter names |

### Level count

Critical 0, High 0, Medium 12 (H35 to H44, H47, B16), Low 8 (H45, H46, H48 to H50, B17 to B19).

### Held up well (checked, nothing found)

- The `api` order of checks, standing and ended-session checks, batch cost, repeat keys.
- Every admin action and page role check; role change blocked at table level with authenticator code; last-admin guard.
- CSRF, security headers, nonce script policy, admin Sentry.
- Webhook signatures and payout one-time key.
- Phone sign-in: code from a secure random source, constant-time compare, guess counter in one statement, admin accounts refused.
- ImageKit: link signature includes the resize; media registry; rejected files are deleted.
- Mobile Sentry: text masked in replay, no identity, scrubbed.
