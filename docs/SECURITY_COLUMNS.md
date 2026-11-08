# Who can read which column

Plan task 2.18 part A (hole H74). Row rules decide which **rows** a signed-in person can read; they say nothing about **columns**. So every column of every table people can read beyond their own rows is decided here, in plain words:

- **Public**: any signed-in person may see it on someone else's row.
- **Parties only**: only the poster and the hired worker of that task (or the people of that thread or crew).
- **Private**: the owner of the row only. It never appears in an answer about another person.

How this is kept true:

- `supabase/functions/api/columns.ts` holds the same lists as named fixed column lists. No `api` read asks for "every column" (`select("*")`); `supabase/functions/api/columns.test.ts` fails on a new one, except on a short allow-list of rows the caller has just written themselves.
- `supabase/tests/column_decisions.test.sql` fails when `profiles`, `tasks` or any table below gains a column that is not on its list. The node test checks that the SQL test and `columns.ts` list the same columns.
- A new column therefore reaches nobody until someone decides it in all three places (this file, `columns.ts`, the SQL test).

What this does **not** change: database grants and row rules. The old app still reads these tables directly until task 3.9, so a person calling the database directly (not through `api`) can still read every column of a row they may see. The `api` is now clean; the direct door (H3, H52) closes in 3.9, and that is when these lists become the only way in.

## profiles (28 columns; every signed-in person can read every row)

| Column | Level | Why |
|---|---|---|
| id | public | Identifies the person on cards, offers and reviews. |
| display_name | public | The name other people see. |
| username | public | The @handle, shown on profiles. |
| avatar_url | public | The picture on cards. |
| bio | public | Written to be read by others. |
| worker_bio | public | Written to be read by others. |
| skills | public | Shown on the helper card. |
| languages | public | Shown on the helper card. |
| intent | public | Post, earn or both; picked at sign-up and used for the tour. Kept public out of caution (not read for other people by the app). |
| loc_label | public | The area name, as the person chose to show it. |
| loc_lat, loc_lng | public | The rounded public area (migration 074), used by the map. The exact spot is in `profile_private`. |
| poster_rating_avg, poster_rating_count | public | Reputation. |
| worker_rating_avg, worker_rating_count | public | Reputation. |
| last_seen_at | public | "Active now" / "Active today" is a product feature. |
| live_until | public | Old "go live" time. Empty in practice, kept for the old app. |
| onboarded_at, worker_onboarded_at | public | Shows whether the person finished set-up; the guest card shows them too. |
| created_at, updated_at | public | "Member since". |
| deleted_at | public | Lets the app show "deleted account" in old threads. |
| referral_code | private | Only the owner's Wallet screen reads it; nobody else needs another person's code. |
| weekly_goal_minor | private | A person's own earnings goal (hole H45). The app reads it through `myStreaks`. |
| sessions_revoked_at | private | When the person last signed out of all devices (H45). Used by the server only. |
| sessions_keep_session | private | Which session survived that sign-out (H45). Used by the server only. |
| payout_upi | private | Old UPI column, empty since migration 073 and replaced by payout destinations (H13). In no answer. |

A person's **own** profile read adds only `referral_code` and `weekly_goal_minor`. The sign-out fields and `payout_upi` are in no `api` answer at all.

## tasks (54 columns; open posts are readable by everyone, the rest by the poster, the hired worker and anyone who made an offer)

| Column | Level | Why |
|---|---|---|
| id, poster_id, kind, pillar, category, skills, difficulty, title, description | public | The post itself. |
| benchmark_minor | public | The price the poster asked for. |
| time_limit_minutes, due_at, milestones, assignment_mode | public | Terms of the post. |
| media_kind, media_path, media_seconds | public | Photos or video the poster attached. |
| loc_label, loc_lat, loc_lng | public | The area only; the typed address is in `task_private`, parties only. |
| flag, status | public | Whether a post is open, taken or finished. |
| topup_pct, flash_until, live_answer, want_photos, photos_public | public | Poster options shown on the card. |
| crew_id, crew_size, crew_slot | public | Crew jobs show their slots. |
| repeat_every, repeated_from | public | "Posted again by itself" is shown on the post. |
| preferred_until | public | The "asked a regular first" badge. |
| hunt_until, hunt_window, hunt_needs | public | City Hunt (migration 158): when the Hunt ends and what a find must show, shown on the card (guests too). The finds themselves are in `hunt_finds`: the finder only, and the poster through `hunt_finds_for_task()`, masked until accepted. |
| funded_at | public | When payment was held. The app shows "payment held" on screens; it is a time, not an amount. |
| started_at, work_done_at, auto_complete_at, completed_at, clear_at, cleared_at | public | Progress times, shown on the task's timeline. |
| created_at, updated_at | public | When posted and changed. |
| funded_minor | parties only | What the poster paid in. |
| funded_credits_minor | parties only | How much of it came from credits. |
| funded_via | parties only | How the poster paid (wallet or Razorpay). |
| funding_payment_id | parties only | Links to the payment record. |
| locked_minor | parties only | The agreed price after an offer was accepted. |
| locked_bid_id | parties only | Which offer was accepted. |
| payout_mode | parties only | How the worker is paid. |
| wallet_refunded_at | parties only | A refund to the poster's wallet. |
| preferred_worker_id | parties only | Names the person a poster asked first; nobody else needs it. The app does not read it. |

A task answer about someone else's task has these 9 columns removed. A **party** is the poster, or a worker with an assignment on the task. A bidder whose offer was not accepted is not a party: `listMyBids` keeps the money fields only on the task whose accepted offer is theirs.

## Other tables people can read beyond their own rows

| Table | Who can read | Columns | Level and reason |
|---|---|---|---|
| bids | the bidder, the poster | all 8 (id, task_id, worker_id, price_minor, time_limit_minutes, message, is_locked, created_at) | parties only: a quote is between the bidder and the poster. |
| assignments | the worker, the poster | all 9 (incl. escrow_minor, payout_mode) | parties only: the hold on one worker. |
| task_proofs | the worker, the poster | all 6 (id, task_id, worker_id, summary, files, created_at) | parties only: the work handed in. |
| task_private | the poster, the hired worker | task_id, loc_lat, loc_lng, updated_at, address | parties only: the exact address. |
| task_disputes | the person who opened it, the poster, the hired worker | id, task_id, opened_by, reason, created_at | parties only. |
| messages | the two people of the task | all 5 | parties only: the thread. |
| crew_messages | the crew | all 5 | parties only: the crew chat. |
| reviews | everyone (hidden ones excepted) | all 8 (id, task_id, author_id, subject_id, about_role, rating, comment, created_at) | public: a reputation is meant to be read. |
| settings | every signed-in person | key, value, updated_at | **Open question, see below.** |

**settings.** Every signed-in person can read every setting (30 keys on staging), including `dev_otp_for_all`, `admin_require_mfa`, spending limits and the SMS caps. Nothing private is stored there (no secret key is a setting), but the list shows how the platform is set up. The app reads fee settings through `readFees`. Fixing this means a row rule change, which this task does not do; it is raised in the report for 2.18 to decide (a public list of keys, or reading through the server).

## Tables that are only ever the caller's own rows

These have row rules that give a row to its owner (and staff) only, and every `api` read filters on the caller's id. They are listed with fixed column lists in `columns.ts` (all current columns kept, so nothing the app reads changes) and are **private to the owner**: `wallets`, `payouts`, `payments`, `payout_destinations`, `payout_profiles`, `task_promotions`, `notifications`, `support_tickets`, `support_messages` (the caller's own tickets, plus staff replies), `saved_tasks`, `blocks`, `age_checks`, `push_tokens`, `profile_private`, `referrals` (both people of the pair).

Tables that only staff can read (all `crm_*`, `admin_*`, `user_suspensions`, `dispute_decisions`, `task_moderation` and similar) are out of scope here; part B (`docs/SECURITY_ROLES.md`) covers them.
