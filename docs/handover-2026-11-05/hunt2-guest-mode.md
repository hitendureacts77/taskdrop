# Hunt round 2: the guest door (design D15, plan task 2.14)

Staging only (`wjxvingpfbfvkfqhrguj`), code at `origin/redesigned-2.0` @ 491426f, 4 Nov 2026.
About 100 calls to the `api` function plus 3 direct database-API calls, all signed out with the public key. Read-only SQL. Nothing was created or changed. No keys, phone numbers or emails were printed.

## Summary for you

- **The door itself holds.** Of the 128 actions, a signed-out caller can run exactly the 24 public reads on the guest list. Every other one (wallet, withdrawals, messages, contact phone, notifications, account deletion, posting, uploads, saved tasks...) answers "Make your account first" and touches nothing. Tricks like `__proto__`, `constructor`, a batch inside a batch, or 21 calls in one batch are refused.
- **No bad token is treated as a guest.** Only the exact public key counts. Broken, unsigned (`alg: none`), forged "service_role" or tampered tokens are refused at the gateway (401). A real person's token is never answered with guest data, and the guest door never answers a person.
- **What guests see is mostly well fenced:** open, unmoderated, not-expired posts only; no address, hired helper or money columns; map points rounded to about 1 km for tasks, people and helpers-near; deleted people hidden; private pictures (chat, proof) never signed; the guest SQL functions cannot be called directly with the public key (permission denied).
- **No Critical or High.** 4 Medium-level items: old full addresses in the public place label (H61), the task card is built by "everything except" rather than a fixed list (H62), the per-address limit is both too easy to dodge and too easy to share by accident (H63), and a shared phone moves one guest's drafts into the next person's account (B31).

## What was tried

| # | Tried | Result |
|---|---|---|
| 1 | All 128 action names signed out, in batches of 20 | Only the 24 guest reads answered; 104 said NEEDS_ACCOUNT |
| 2 | 16 single calls: getWallet, requestWithdrawal, listMessages, taskContactPhone, listNotifications, deleteMyAccount, createTask, listSavedTasks, createUpload, removeMedia, endMySessions, made-up names, `__proto__`, `constructor`, `hasOwnProperty`, `toString` | All NEEDS_ACCOUNT |
| 3 | Batch inside a batch; batch of 21; prototype names inside a batch | Refused / NEEDS_ACCOUNT |
| 4 | No key at all; wrong apikey | 401 (gateway) |
| 5 | Public key only (apikey header); public key as Bearer with or without apikey; lower-case "bearer" | 200, guest (as designed) |
| 6 | `Authorization: Bearer ` empty, `Bearer` alone, garbage token | 401, never guest |
| 7 | Unsigned token claiming role anon; unsigned token claiming service_role; public key with a broken signature | 401 at the gateway |
| 8 | Bad JSON, `null`, `[]` as a guest | 400 BAD_JSON |
| 9 | `health` as a guest | 200, only "database up" (known) |
| 10 | Calls from another website (Origin evil.example) | No CORS permission header, so a browser on another site cannot read it; taskdrop.in and localhost allowed. Answers are `Cache-Control: no-store` |
| 11 | Every guest read with real ids: completed task, expired open task, open task | Completed and expired: nothing; open: post + poster card, address/assignment/worker all empty |
| 12 | Deleted person's profile; their stats | Profile: nothing; stats: zeros |
| 13 | Search text `%`, `_`, `' or 1=1 --`, backslash, 5,000 letters; pillar `x' or '1'='1`; minMinor -5; limit "x"; kind "any" | Matched as plain text (no injection); bad values refused; one quote-text attempt was blocked by Cloudflare (403) before it reached us |
| 14 | limit 1e9, radius 20,000 km, limit 1e6 on near-me reads | Clamped (200 / 12 / 5 max, internal 300-500) |
| 15 | Decimals of every location returned (tasks, posters, review authors, helpers near, tasks near) | Never more than 2 decimals (about 1 km) |
| 16 | Fields returned vs the real tables | People: the 19-field public card only (no phone, email, referral, session, payout, goal fields). Tasks: everything except a remove-list, see H62 |
| 17 | signMedia: an open post's picture, a profile photo, a proof picture, a chat picture, a `../` path, a bad size | Only the first two were signed; proof, chat and `../` returned nothing |
| 18 | `guest_open_posts`, `guest_helpers`, `guest_public_media` called directly with the public key | 401 permission denied |
| 19 | Limit: ~140 calls in one minute | Refused with 429 after 120. Spoofed `x-forwarded-for`, `x-real-ip`, `true-client-ip` did NOT get a fresh budget (all counted under one key in `private.api_rate`); a self-sent `cf-connecting-ip` is blocked by Cloudflare (403) |
| 20 | One batch of 20 "helpers near me" | 200 in 1.6 s on tiny staging data (40 heavy queries for one request) |
| 21 | topEarners in all three kinds | "New talent" shows 3 deleted accounts (B30) |
| 22 | Phone-side storage code (guest choice, drafts, saves) | See B31 |
| 23 | `node scripts/check-endpoints.mjs` on the branch | Passes; it does not know about the guest door (H66) |

## Findings

### H61 - Old full addresses still sit in the public place label, now readable with no account (Medium)
- **Evidence:** `guest_task_json` (migration 146, line 60) keeps `loc_label`; `guest_person_json` (line 40) sends the profile's `loc_label`. On staging 5 of 59 open-task labels and 4 profile labels have address-like text, e.g. the shape `aaaa 999, 9aa aaaaa, ...` (a flat or house number and a cross street) and `9999, aaaa 999 ...`. Migration 126 already says old-app posts keep the whole typed line in `loc_label` "until Phase 9" (P2-21). The coordinates are rounded to about 1 km, but the label next to them gives the exact door.
- **Scenario:** Anyone, with no account and no trace, scrapes the feed and the profile cards and gets the home address of people who typed it before the fix.
- **Fix:** In both guest functions send only the area part of the label (for example the last two comma parts) or nothing for rows from before migration 126. Then run the same split on the old rows (tasks and profiles) so signed-in people stop seeing them too.

### H62 - The guest task card is built as "every column except these" (Medium)
- **Evidence:** `guest_task_json` = `to_jsonb(t) - array[...]` (migration 146, lines 60-64). Today it also sends `crew_id`, `milestones`, `topup_pct`, `media_path`, `repeat_every`, `photos_public`, `updated_at` and `poster_id`. None is secret today. But any column added to `tasks` later (a note, a contact, an internal flag) goes onto the open internet with no review.
- **Fix:** Build it with `jsonb_build_object` and a fixed list of fields, like `guest_person_json` already does. Add a SQL test that fails when `tasks` gains a column and nobody has decided whether guests may see it, for example: `select count(*) = 0 from information_schema.columns where table_name='tasks' and column_name not in (<reviewed list>)`.

### H63 - The guest limit counts per network address and nothing else (Medium)
- **Evidence:** `index.ts:115-127` and `guest.ts:267-276`: 120 per minute per hashed address, with no total across all guests. Refused calls still add to the count (158 hits recorded in one window with a limit of 120). The platform supplies the real address: spoofing the forwarding headers did not work (tested).
- **Scenario A (lock-out):** Indian mobile networks put thousands of phones behind one shared address. One busy area, or one script on the same network, uses up the 120 and every other guest there gets "You are going too fast".
- **Scenario B (cost):** Someone with many addresses (an IPv6 range, a cheap proxy pool) has no ceiling. Every guest read runs with the service key, and some are heavy: "helpers near me" reads 300 profiles plus 500 posts, and 20 of them fit in one batch (1.6 s already on tiny data). Nothing caps the total database load from guests.
- **Fix:** Add an overall guest budget per minute (a second `api_rate_spend` call with one fixed key). Count IPv6 by /64. Give heavy reads a higher cost (workersNear, listActiveWorkers, getPosterStats count 5). Keep a 30-60 second in-memory copy of the reads that are the same for every guest (feed, trending, highlights, top helpers). Lower the internal 500/300 pulls.

### H64 - Suspended people stay fully public to guests (Low)
- **Evidence:** `guest_open_posts`, `guest_helpers`, `guest_profile` filter `deleted_at` and moderation but never `user_suspensions` (migration 146). Staging has no active suspension, so this was checked in the code only.
- **Scenario:** A suspended scammer's open posts and helper card keep showing to everyone who has not signed up.
- **Fix:** Add `not exists (select 1 from user_suspensions where user_id = p.id and lifted_at is null)` to the three functions. Check that the signed-in feed does the same.

### H65 - Exact "last seen" times on every public card (Low)
- **Evidence:** `guest_person_json` sends `last_seen_at`, `onboarded_at` and `worker_onboarded_at` to the second.
- **Scenario:** Anyone, without an account, polls a named person's card and learns when they are on their phone.
- **Fix:** Send "active now / today / this week" instead of the time, for guests at least.

### H66 - The endpoint check does not know about the no-login door (Low)
- **Evidence:** `scripts/check-endpoints.mjs:22` lists `api` as `login`, and it passes only because `getClaims` and `api_rate_spend` appear somewhere in the folder. `api.test.ts` (lines 1572-1640) does check that guest ops are reads and match the app's list, which covers most of the risk.
- **Fix:** Add a kind `login+guest` that also requires every name in `GUEST_OPS` to be absent from `WRITE_OPS`. Or point the check at the api.test guest tests by name.

### H67 - The guest limiter lets everything through when it fails (Low)
- **Evidence:** `index.ts:116-127`: if `api_rate_spend` errors, the guest call runs anyway, with the service key. This is the same rule as for signed-in people, but here nobody is known.
- **Fix:** For guests, refuse (503) when the limiter cannot be reached.

### H68 - Guests browse without the 18+ check (Low, your decision)
- **Evidence:** The age gate is at account creation. A guest sees every open post and profile with no age question (the design has a G4 Under-18 screen only for sign-up).
- **Decision for you:** Is that acceptable for the Terms (18+ only)? If not, add a one-tap "I am 18 or older" before guest mode.

## Bugs

### B30 - "New talent" shows deleted accounts (Low)
`top_earners` filters `onboarded_at` but not `deleted_at`. 3 of the 30 "new talent" cards are "Deleted user", to guests and signed-in people alike. Fix: `and p.deleted_at is null`.

### B31 - On a shared phone, a guest's drafts and saves move into the next person's account (Medium)
`AuthProvider.tsx:303-308` moves the guest drafts into whichever account appears next, on any sign-in. `HomeScreen.tsx:383` does the same for saved tasks. Drafts are free text, often "come to flat 302, call 98...".
- **Scenario:** A family tablet or a shop's phone: person A drafts a request as a guest, person B signs in later, and A's text is in B's "Drafts".
- **Related:** a signed-in person's own drafts (`taskdrop.postDrafts.v1.<id>`) stay in plain phone or browser storage after sign-out.
- **Fix:** Move guest drafts and saves only when the account was made or signed into from the guest pop-up (`FROM_GUEST`), and only within, say, 24 hours. Otherwise ask "Keep these drafts?" or drop them. Clear the guest keys and the person's drafts on sign-out.

### B32 - The home counter "open tasks" counts posts nobody can see (Low)
`platform_highlights.openTasks` = 59, but only 38 open posts are live (the rest are expired or moderated). Fix: use the same filter as `guest_open_posts`.

## Not findings (checked and fine)
- **Pictures:** `guest_public_media` signs only an open post's own picture or a profile photo owned by that person. Proof, chat, `../` and borrowed paths returned nothing.
- **Reverse mix-ups:** a person whose sessions were ended, or who is suspended or deleted, is refused (401). They are never quietly served as a guest, although they can of course open the app signed out and see the same public things as anyone.
- **Injection:** every filter is passed to SQL as a value; search uses plain `strpos`; kind, role and size come from fixed lists; limits are clamped.
- **Grants:** the guest SQL functions run only for the service role.
- **Admin switches** (`refusalFor`) also apply to guest reads.
