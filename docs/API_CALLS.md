# API calls: what the app asks the server for, and the plan to ask less

Status (2026-11-02): **built and merged.** The owner accepted the 30 s rule (decision 5). The trial's fixes
(section 3) reached `redesigned-2.0` in PR 174 (1 Nov). The open question, Explore's 13 s wait, is explained and
fixed in section 7, together with the first server-side saving (S1 for Find work) and the P2-48 sign-in check.
Sections 2 to 4 are the 29 Oct measurements and stay as they were; section 7 has the 2 Nov numbers.

Goal: fewer requests for cost (Edge Function invocations, database work, the per-person rate limit) and
speed, with **no change to how any screen looks or behaves**.

## 1. How it was measured

- `scripts/count-api-calls.mjs` serves a web export on port 8099 and walks the flows below in a phone-sized
  window (390 x 844, the bottom-tab layout that matches Android) with the seed accounts' stored sessions:
  **Asha** hires (Hire mode), **Ravi** earns (Earn mode). It is read-only apart from presence, the device
  record and "seen" marks.
- A step's count is every request to the backend from the tap until nothing new has gone out for 3 seconds.
  Steps follow each other at that pace, so "back" usually happens 5 to 15 seconds after the screen loaded.
- "Requests" = HTTP requests to Supabase (the `api` function, `app-config`, auth). "Ops" = operations
  carried inside `api` requests (one `batch` request can carry many). Third-party requests are counted
  separately: every cold start also makes about 12 to Google (reCAPTCHA for Firebase App Check) and fonts.
- Against the hosted test project, 2026-10-29. Re-measure:

```bash
npx expo export -p web --output-dir <some folder>
node scripts/count-api-calls.mjs <some folder> --idle 130
```

If a seed session has expired (Asha's had), refresh it with the e2e setup while the build is served:
`node scripts/count-api-calls.mjs <folder> --serve` in one terminal and
`npx playwright test --project=setup -g "sign in as Asha"` in another.

## 2. Baseline (redesigned-2.0, 2026-10-29)

Most reads already travel in batches (PR 67), so the waste is no longer "one request per read". It is in
three places: screens re-reading everything every time they come back into view, badge counts re-read on
every screen change by every open header, and a handful of reads that still leave on their own.

| Flow (step) | Requests | Ops | What went out |
|---|---:|---:|---|
| Asha: cold start, signed in, Home | 7 | 11 | app-config, recordDevice, touchPresence, listActiveWorkers, trendingCategories, one batch of 6, attachPosters |
| Asha: open the post composer | 1 | 2 | countUnreadFor + platformFees |
| Asha: close the composer, back on Home | 4 | 7 | the whole Home again |
| Asha: Explore | 1 | 4 | countUnreadFor x2, listMyTasks, countNeedsAttention |
| Asha: My Tasks | 2 | 6 | countUnreadFor x3, listMyTasks, countNeedsAttention; then countBidsByTask |
| Asha: open own task | 1 | 6 | countUnreadFor x3, platformFees, getTaskDetail, listBidsForTask |
| Asha: back to My Tasks | 2 | 6 | My Tasks again |
| Asha: Messages | 1 | 4 | countUnreadFor x3, listThreads |
| Asha: open a chat | 1 | 5 | countUnreadFor x3, listMessages, getTaskDetail |
| Asha: back to Messages | 1 | 4 | Messages again |
| Asha: Notifications (via My Tasks) | 4 | 11 | My Tasks again (2), listNotifications, then notificationSides alone |
| Asha: Wallet (via My Tasks) | 6 | 21 | My Tasks again (2), settleClearedEarnings, two read batches, feesSince alone |
| Asha: Profile | 1 | 7 | countUnreadFor **x5**, listReviewsAbout, countNeedsAttention |
| Asha: back to Home | 4 | 11 | the whole Home again |
| Asha: 130 s idle on Home | 5 | 5 | touchPresence every minute, listActiveWorkers every minute |
| Ravi: cold start, signed in, Home | 7 | 18 | auth refresh, app-config, recordDevice, touchPresence, 3 batches (profile, then lists, then posters) |
| Ravi: Find work | 2 | 6 | batch, then attachPosters |
| Ravi: open a job | 3 | 5 | getTaskDetail, then canQuoteOn alone, then getPosterStats alone |
| Ravi: back to Find work | 2 | 5 | Find work again |
| Ravi: My Work | 2 | 11 | batch of 10, then attachPosters |
| Ravi: Profile | 1 | 7 | countUnreadFor x4, listReviewsAbout, countNeedsAttention |
| Ravi: back to Home | 3 | 14 | the whole Earn Home again |
| **Total, both walks (idle not included)** | **56** | **171** | |

Realtime: one socket and one private channel per person; it is not polled. `app-config` is read once at
start, then every 5 minutes and on coming back to the foreground, with the browser's 60 s cache. Neither is
waste.

## 3. Where the waste is, and the fix for each

Client-only fixes work against the server that is deployed now. Each one is a commit on the trial branch.

| # | Waste found | Fix (trial commit) | Visible change |
|---|---|---|---|
| 1 | Every kept-alive tab has its own header, and every header recounts unread alerts on every screen change: up to 5 identical `countUnreadFor` in one batch (each is a notifications scan plus a tasks lookup). | The batcher sends one copy of identical reads asked for in the same moment; every caller gets the answer (`7772e48`). | None: the calls were already simultaneous. |
| 2 | 16 server reads were missing from the app's batch list, so they left alone beside a batch: "Workers around now" and trending on a poster's Home, `feesSince` on Wallet, `notificationSides`. | Add them to `BATCHABLE_OPS`; the server already accepts any read in a batch, and a test keeps the list inside the server's reads (`f2ad8fc`). | None. They also get the read retry on a deploy blip. |
| 3 | Opening a job as a worker took three round trips in a row: task, then `canQuoteOn`, then poster stats. | Ask `canQuoteOn` beside the task (`dcf5734`). | None: same checks, same redirect for your own request. |
| 4 | The Earn Home asked for remote and urgent work only after the profile came back, then looked up posters three times. | Start remote/urgent with the profile; one `attachPosters` for the three lists (`ea23c58`). | None: each list keeps its order. |
| 5 | Every return to a tab re-reads the whole tab (Home is 3 to 4 requests and up to 14 ops), even a few seconds after it loaded. Badge counts (`countUnreadFor`, `countNeedsAttention`) are re-read on every screen change. "Workers around now" re-reads on every return to Home and keeps polling while the app or browser tab is in the background. | **Freshness rule** (`e997257`, marked TRIAL): what was read under 30 s ago is reused when nothing has changed since. "Changed" = this person made any write, a live ping arrived, someone signed in or out, or the app came back to the foreground. After any of those, or 30 s, the app asks again exactly as before. "Workers around now" keeps its once-a-minute read while on screen and skips reads while nobody is looking. Same rule on web and Android/iOS. | **The one trade-off; owner decision Q1.** Your own actions and anything that pings you show at once, as today. A change by someone else that does not ping you (for example a new task in the feed) can take up to 30 s longer to appear on a return. Pull to refresh still asks at once. |

## 4. Trial result (branch `perf/fewer-api-calls`, same walk)

| Flow (step) | Before req / ops | Trial req / ops |
|---|---:|---:|
| Asha: cold start, Home | 7 / 11 | **5** / 11 |
| Asha: open the post composer | 1 / 2 | 1 / **1** |
| Asha: close the composer, back on Home | 4 / 7 | **0 / 0** |
| Asha: Explore | 1 / 4 | 1 / **1** |
| Asha: My Tasks | 2 / 6 | 2 / **2** |
| Asha: open own task | 1 / 6 | 1 / **3** |
| Asha: back to My Tasks | 2 / 6 | **0 / 0** |
| Asha: Messages | 1 / 4 | 1 / **1** |
| Asha: open a chat | 1 / 5 | 1 / **3** |
| Asha: back to Messages | 1 / 4 | 1 / **1** |
| Asha: Notifications | 4 / 11 | **3 / 3** |
| Asha: Wallet | 6 / 21 | **4 / 10** |
| Asha: Profile | 1 / 7 | 1 / **1** |
| Asha: back to Home | 4 / 11 | **2 / 4** |
| Ravi: cold start, Home | 7 / 18 | 7 / **17** |
| Ravi: Find work | 2 / 6 | 2 / **3** |
| Ravi: open a job | 3 / 5 | **2 / 3** |
| Ravi: back to Find work | 2 / 5 | **0 / 0** |
| Ravi: My Work | 2 / 11 | 2 / **7** |
| Ravi: Profile | 1 / 7 | 1 / **2** |
| Ravi: back to Home | 3 / 14 | **0 / 0** |
| **Total** | **56 / 171** | **37 / 73** (-34% requests, -57% ops) |

Notes on the trial:

- Returns that come back after more than 30 s, or after a change, cost what they cost before. Asha's
  "back to Home" still made 2 requests because her Home had last loaded well over 30 s earlier; Ravi's
  walk is shorter, so his Home was still fresh.
- Idle on Home is unchanged in rate: one presence beat and one "Workers around now" read per minute
  (the trial's 130 s window happened to hold three of each instead of two, because the read that used to
  fire on returning to Home now waits for the minute to be up). In the background the trial makes neither.
- No refusals came back inside any batch, so the deployed server accepts every newly batched read.
- **Open before anything is merged:** in one of three trial walks, Explore waited on a batch
  (`listSavedTaskIds, searchTasks`) that got no answer for over 13 s and the list stayed on "Loading...".
  It did not happen in the other two walks, and nothing in the trial changes how a reply is delivered, but it
  has to be explained (slow server, or the trial) before the branch is used.
- Not checked yet: Android on the phone, and the desktop web layout (its side menu has its own badge count).

## 5. Further savings that need a server change

These need new `api` operations, added beside the old ones (old ones keep their inputs and answers, the old
app keeps working), and an `api` deploy, which only happens when the owner asks. The app would fall back to
the old calls if the server answers "Unknown request". Not built.

| # | Change | Saves |
|---|---|---|
| S1 | Lists that come back with their posters attached (feed, Find work, My Work, Earn Home lists), so the second `attachPosters` round trip goes. **Find work done 2026-11-02** (`searchTasksWithPosters`); the other lists not yet. | 1 request per load of each of those screens |
| S2 | Notifications that come back with their side (poster/worker) | 1 request per Notifications visit |
| S3 | My Tasks that come back with quote counts | 1 request per My Tasks load |
| S4 | One wallet summary read after the sweep (wallet, escrow, payouts, activity, fees) | 2 requests per Wallet visit |
| S5 | Task detail that includes the poster's posted-requests count (the poster's profile is already in it) | 1 request per job opened |
| S6 | One start-up write for the device record and the first presence beat | 1 request per cold start |
| S7 | Count any signed-in `api` call as presence, so the minute beat is skipped when the app already talked to the server in that minute | up to 1 request a minute while in use |

## 6. Decisions for the owner

- **Q1.** Accept the 30 s freshness rule (fix 5)? It is most of the saving. Without it, fixes 1 to 4 alone
  save the poster Home's two lone reads, one request per job opened, and the duplicate badge counts.
- **Q2.** Build the server-side operations S1 to S7 (needs an `api` deploy)?
- **Q3.** When approved: turn the trial branch into a PR into `redesigned-2.0`, after the Explore wait is
  explained and Android and desktop web are checked by eye.

## 7. The 13-second Explore wait, and the numbers on 2 Nov

**What happened (found in the server logs of the trial walk, 29 Oct 16:43 UTC).** Nothing was lost and the
reuse rule played no part. Find work waits for two requests one after the other: the search
(`listSavedTaskIds, searchTasks`), then `attachPosters` for the posters on the cards. Both landed on newly
started function instances while the Earn Home batch was still running on the server (its `signMedia` took
3.8 s). The search took 7.3 s and `attachPosters` 5.8 s, 13.1 s in all. In each of them about 1 s went on the
sign-in check (`auth.getUser`, normally 10 to 50 ms, then 0.7 to 1.2 s at the auth service) and 1.2 to 2 s
went on queries that normally take 0.2 to 0.3 s. Slow calls like these are common on the free test project:
in the 24 hours before 2 Nov, 38 of 8,677 `api` calls took over 5 s (the slowest 8.4 s), almost all of them
the first call on a new instance.

**What was changed (PR into `redesigned-2.0`, 2 Nov):**

1. Find work asks once: the new read `searchTasksWithPosters` answers the posts with their posters (S1 for
   Find work). The old `searchTasks` and `attachPosters` are unchanged. An older server answers "Unknown
   request", and the app then asks the old two.
2. The `api` function checks the sign-in token itself (`getClaims`, against the project's public keys,
   cached per instance) instead of asking the auth service on every call (P2-48). Suspended and deleted
   people are still refused on every call: their standing is read beside the rate limiter and kept for 5 s.
   The auth service is still asked while the admin's "phone must be confirmed" switch is on.
3. A read that has no answer after 15 s is given up and asked again (twice at most), so a reply that never
   comes cannot hold a screen on "Loading..." for good. Writes are never timed out.

**Numbers (2 Nov, today's `redesigned-2.0` plus this change, web build at 390 x 844, same script).** The
walk is not the 29 Oct walk: posting now opens its own screen (the poster options), the Earn Home has the
map and more lists, and both cold starts refreshed the sign-in. The script's selectors were updated for the
post screen and the job cards.

| Flow (step) | Requests / ops |
|---|---:|
| Asha: cold start and Home (the Home reads spilled into the next step) | 9 / 13 |
| Asha: close the post screen, back on Home | 2 / 7 |
| Asha: Explore | 1 / 1 |
| Asha: My Tasks | 2 / 2 |
| Asha: open own task | 1 / 3 |
| Asha: back to My Tasks | **0 / 0** |
| Asha: Messages, open a chat, back | 3 / 5 |
| Asha: Notifications | 3 / 3 |
| Asha: Wallet | 4 / 10 |
| Asha: Profile | 1 / 1 |
| Asha: back to Home | 2 / 4 |
| Ravi: cold start, Home | 8 / 17 |
| Ravi: Find work | 3 / 4 before the `api` deploy, **1 / 2 after it** |
| Ravi: open a job | 2 / 3 |
| Ravi: back to Find work | **0 / 0** |
| Ravi: My Work | 2 / 7 |
| Ravi: Profile | 1 / 2 |
| Ravi: back to Home | **0 / 0** |
| **Total** | **44 / 82** before the deploy, **42 / 80** after |

Waits: Find work's list was on screen 1.8 s after the tap on the old server (three requests); no request in
the walk waited longer than 2 s except one `countBidsByTask` on My Tasks (5.8 s, a new instance, the quote
counts only; the list was already showing).

Not checked: the Android phone and the desktop website by eye; P2-48's throttled-4G timing.
