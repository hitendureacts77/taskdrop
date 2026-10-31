# API calls: ask the server less (short version)

> **Owner: you do not need this file.** Everything in it is also in `docs/ULTIMATE_PLAN.md` (as tasks, and in its "Reference" section). This file is kept for Claude.

Shortened 2026-10-30. The full step-by-step baseline table and trial table are in `docs/archive/2026-10-30-before-simplify/API_CALLS.md`.

Big picture: `docs/ULTIMATE_PLAN.md`. **Status: measured and tried on a local branch; waiting for your decision.** Nothing is merged. `redesigned-2.0` is unchanged.

---

## 1. The goal

Fewer requests = lower cost (server runs, database work, rate limits) and faster screens, with **no change to how any screen looks or behaves**.

## 2. The result of the trial

Measured on the hosted test project with two walks through the app (Asha hiring, Ravi earning), 2026-10-29:

```
                         BEFORE      TRIAL
 Requests to the server    56    ->    37     (-34%)
 Operations inside them   171    ->    73     (-57%)
```

Trial branch: `perf/fewer-api-calls` (5 commits off `redesigned-2.0`, local, not pushed). `npm run check` passed on it.

**Examples of the saving:**

| Screen | Before (requests / ops) | After |
|---|---|---|
| Back to Home after closing the composer | 4 / 7 | 0 / 0 |
| Back to My Tasks | 2 / 6 | 0 / 0 |
| Wallet | 6 / 21 | 4 / 10 |
| Ravi: back to Home | 3 / 14 | 0 / 0 |
| Profile (Asha) | 1 / 7 | 1 / 1 |

## 3. Where the waste was, and the fix

| # | Waste | Fix | Visible change |
|---|---|---|---|
| 1 | Up to 5 identical "unread count" questions at once (one per open screen header) | Ask once, give everyone the answer | None |
| 2 | 16 questions that left on their own beside a batch | Put them in the batch | None |
| 3 | Opening a job took 3 requests in a row | Ask the permission check with the job | None |
| 4 | Worker Home started some lists late and looked up posters three times | Start earlier; one poster lookup | None |
| 5 | Every return to a screen re-read everything, even seconds later | **Freshness rule:** reuse what was read less than 30 s ago unless something changed | **One trade-off, see below** |

**The trade-off (fix 5):** your own actions, and anything that pings you, show at once as today. A change by someone else that does **not** ping you (for example a new task in the feed) can take up to **30 seconds longer** to appear when you come back to a screen. Pull to refresh still asks at once. This fix is most of the saving.

## 4. Not yet explained or checked

- In one of three trial walks, **Explore waited 13+ seconds** on a request and stayed on "Loading...". It did not happen in the other two, but it must be explained (slow server, or the trial?) before anything is merged.
- Not checked yet: Android on the phone, and the desktop web layout (its side menu has its own badge count).

## 5. Later: bigger savings that need server changes

New server operations, added beside the old ones so the old app keeps working. These need a server deploy, which only happens when you ask. Not built.

| # | Change | Saves |
|---|---|---|
| S1 | Lists that arrive with their posters attached | 1 request per list screen load |
| S2 | Notifications arrive with their side | 1 per visit |
| S3 | My Tasks arrives with quote counts | 1 per load |
| S4 | One wallet summary | 2 per Wallet visit |
| S5 | Job detail includes the poster's count | 1 per job opened |
| S6 | Device record and first presence beat together | 1 per cold start |
| S7 | Any call counts as presence | up to 1 per minute |

**Skip these until after launch.** The trial already gets most of the saving without touching the server.

## 6. Decisions for you

| # | Question | My recommendation |
|---|---|---|
| Q1 | Accept the 30-second freshness rule (fix 5)? | **Yes.** Without it fixes 1-4 save much less |
| Q2 | Build the server changes S1-S7 now? | **No.** After launch |
| Q3 | Turn the trial branch into a pull request? | **Yes, after** the Explore wait is explained and Android and desktop web are checked |

To begin: say **"start API calls"** (Claude explains the Explore wait first).

## 7. How to measure again

```bash
npx expo export -p web --output-dir <some folder>
node scripts/count-api-calls.mjs <some folder> --idle 130
```

If a test account's saved sign-in has expired, refresh it: run `node scripts/count-api-calls.mjs <folder> --serve` in one terminal and `npx playwright test --project=setup -g "sign in as Asha"` in another.

---

## Changelog

- **2026-10-30:** Cut from 146 lines to this page.
