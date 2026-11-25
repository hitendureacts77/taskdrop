# API endpoints: one address per operation

Status (2026-11-17): **built** on branch `feat/api-endpoints`. The server and the web app deploy together on
merge (the Vercel build deploys the Edge Functions). Android picks it up with the next OTA (owner's call).

## 1. The problem

Every request the app made went to one address, `POST /functions/v1/api`, with the operation's name hidden in
the body (`{ "op": "placeBid", "args": {...} }`). For 142 operations that means:

- In the browser's network tab, Supabase's function logs and Sentry, every call looks the same: `api`. You cannot
  see which screen or operation is slow, failing or busy without opening each body.
- No address says what it does, so nothing outside the function (a firewall rule, a monitor, a log filter, a
  tester reading traffic) can tell a wallet withdrawal from a feed read.

## 2. What was built

Each operation now has its own endpoint, grouped by what it is about:

```
POST /functions/v1/api/<group>/<op>    { "args": { ... } }
POST /functions/v1/api/tasks/listOpenTasks
POST /functions/v1/api/bids/placeBid
POST /functions/v1/api/wallet/requestWithdrawal
POST /functions/v1/api/batch           { "args": { "calls": [...] } }   reads only, as before
POST /functions/v1/api/health          uptime check, no sign-in
```

Answers are unchanged: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": {...} }`. A path that is no
endpoint (`/api/wallet/listOpenTasks`, `/api/tasks/noSuchOp`) answers **404 UNKNOWN_OP** before anything is read.

| Endpoint group | Reads | Writes |
|---|---|---|
| `/api/tasks/…` | `listOpenTasks`, `listMyTasks`, `searchTasks`, `searchTasksWithPosters`, `attachPosters`, `getTask`, `getTaskDetail`, `getPosterStats`, `recommendedTasks`, `remoteTasks`, `tasksNear`, `urgentTasks`, `nearbyPulse`, `countNeedsAttention`, `taskContactPhone`, `listSavedTaskIds`, `listSavedTasks` | `createTask`, `updateListing`, `removeListing`, `cancelTask`, `setRepeat`, `raiseTopUp`, `setSaved` |
| `/api/questions/…` | `listTaskQuestions` | `askTaskQuestion`, `answerTaskQuestion` |
| `/api/bids/…` | `listMyBids`, `listBidsForTask`, `countBidsByTask`, `myBidTaskIds`, `getMyBid`, `canQuoteOn` | `placeBid`, `updateBid`, `lockBid` |
| `/api/jobs/…` | `listMyAssignments`, `getProof` | `startTask`, `markWorkDone`, `submitProof`, `requestRevision`, `confirmRelease` |
| `/api/disputes/…` | `listMyDisputes`, `listDisputeReasons` | `openDispute` |
| `/api/profile/…` | `getProfile`, `isAdmin`, `usernameAvailable`, `ageStatus`, `myStats`, `myStreaks`, `myRegulars` | `updateProfile`, `updateProfileExtras`, `recordBirthDate`, `setWeeklyGoal` |
| `/api/reviews/…` | `listReviewsAbout`, `publicProfileStats`, `workerProofPhotos` | `submitReview` |
| `/api/workers/…` | `listActiveWorkers`, `workersNear`, `workerServices`, `topEarners` | – |
| `/api/map/…` | `mapPeople`, `mapSharing` | `setMapSharing`, `setMapAudience`, `clearMapSpot` |
| `/api/crew/…` | `crewOverview`, `listCrewMessages` | `sendCrewMessage` |
| `/api/hunt/…` | `huntFinds`, `huntCounts` | `huntLook`, `huntSendFind`, `huntAcceptFind`, `huntDeclineFind`, `huntAskPart` |
| `/api/wallet/…` | `getWallet`, `getEscrowHeld`, `listWalletActivity`, `feesSince`, `listPayouts`, `listPayoutDestinations` | `settleClearedEarnings`, `payTaskFromWallet`, `requestWithdrawal`, `cancelWithdrawal`, `addPayoutDestination`, `removePayoutDestination`, `setDefaultPayoutDestination` |
| `/api/promotions/…` | `promotableTasks`, `promotionTiers`, `listPromotions`, `adAuctionRanks`, `promotionQuote`, `promotedLive`, `promotionResults` | `startPromotion`, `activatePromotion`, `cancelPromotion`, `recordAdImpression`, `recordAdClick`, `recordPromoView`, `setPromoAlerts` |
| `/api/platform/…` | `platformFees`, `platformStats`, `platformHighlights`, `trendingCategories` | – |
| `/api/messages/…` | `listThreads`, `listMessages` | `sendMessage` |
| `/api/notifications/…` | `listNotifications`, `getNotification`, `countUnreadNotifications`, `countUnreadFor`, `notificationSides` | `markNotificationsRead`, `registerPushToken`, `forgetPushToken` |
| `/api/account/…` | `accountDeletionCheck` | `touchPresence`, `recordDevice`, `deleteMyAccount`, `endMySessions` |
| `/api/safety/…` | `listBlockedUsers` | `blockUser`, `unblockUser`, `reportContent` |
| `/api/feedback/…` | `listFeedbackBoard`, `getFeedbackPost` | `sendFeedback`, `postFeedbackIdea`, `voteFeedbackIdea`, `commentFeedbackIdea` |
| `/api/support/…` | `listTickets`, `getTicket` | `openTicket`, `replyTicket`, `resolveTicket` |
| `/api/referrals/…` | `countMyReferrals` | `applyReferralCode` |
| `/api/media/…` | `signMedia` | `createUpload`, `attachMedia`, `removeMedia` |

The table lives in one file, [`supabase/functions/api/routes.ts`](../supabase/functions/api/routes.ts). The
server routes by it and the app builds its addresses from it (`apps/mobile/src/lib/gateway.ts` imports it), so
the two cannot drift. `routes.test.ts` fails if an operation has no endpoint, sits in two groups, or an endpoint
names an operation that does not exist: adding a new op means adding it to `API_GROUPS`.

## 3. Why one function with many endpoints, not many functions

Splitting into 22 separately deployed Edge Functions was considered and rejected:

- **Cold starts.** Measured 24 Oct: a warm `api` call is ~450 ms, a cold one ~2.2 s. Every separate function has
  its own cold start, so a screen that touches four groups would risk four cold starts instead of one. Supabase's
  own guidance for large apps is one function with routes.
- **One front door.** Sign-in check, suspended/deleted check, session cut-off, rate limits, admin switches
  (maintenance, minimum version, feature off), App Check logging and repeat keys run in front of every endpoint
  from one place (`index.ts`). Copying them into 22 functions would let them drift; one missed copy is a hole.
- **Same cost.** Supabase bills per invocation either way.

Nothing in the security model changes: every endpoint still runs with the caller's own token under row level
security, and writes still cannot travel in a batch.

## 4. Old apps keep working

- The old address (`POST /functions/v1/api` with `{ op, args }`) still works, for installed APKs that have not
  had the OTA yet (rule 2: existing api operations keep their inputs and responses).
- The new app also sends the op in the body. If it ever reaches a server from before this change, that server
  reads the body and answers as before, so the deploy order does not matter. A body that names a different op
  than its endpoint is refused (`BAD_JSON`).
- Scripts and e2e tests that post to `/functions/v1/api` keep working unchanged.

## 5. Batching (kept: owner decided 18 Nov 2026)

Reads asked for in the same 10 ms still travel together to `/api/batch` (PR 67, measured Home 20 -> 5
requests). Writes, and any read that goes out alone, use their own endpoint. The owner chose to keep this on 18 Nov 2026. Should that change, putting every read on its own
endpoint is one line (`Batcher` in `apps/mobile/src/lib/gateway.ts`); the cost is roughly 3-4x the requests
on screen load against the per-minute read budget and the Edge Function invocation count.

## 6. Later, if wanted

- Drop the body `op` once every installed app is on this build (saves a few bytes; nothing depends on it).
- Per-endpoint rate limits or log alerts (for example a tighter budget on `/api/wallet/*`).
- Retire the old single address after Phase 9, when the old app is gone.
