# API calls: what the app asks the server for, and the plan to ask less

Status (2026-10-29): **plan, waiting for the owner.** The owner asked for the plan before anything is built.
Measurements are done. A trial of the fixes in section 3 exists on the local branch `perf/fewer-api-calls`
(5 commits off `redesigned-2.0`, not pushed, not merged; `npm run check` passed on it). The trial numbers
below come from that branch. `redesigned-2.0` itself is unchanged.

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
| S1 | Lists that come back with their posters attached (feed, Find work, My Work, Earn Home lists), so the second `attachPosters` round trip goes. | 1 request per load of each of those screens |
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
