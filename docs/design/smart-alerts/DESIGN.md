# Design: smart alerts, tell the right workers about a new task (plan task 4.5)

Status: DESIGN ONLY, for the owner to approve. Nothing is built. Mockup: `docs/design/smart-alerts/mockup.html` (lock screen, bell list, worker's off switch, admin kill switch, measurement).

Everything below is an **IDEA** until approved; the parts it reuses are live and named.

## What it does

When a task is posted, the server picks a few workers who are a good fit and sends each one a push plus a bell-list row. It starts without AI. It is measured by **time to first offer**.

## Who gets an alert

A worker is a candidate for a task when ALL of these are true:

1. **Has done that kind of task**: at least one earlier task in the same `tasks.category`, either completed for them (assignments) or an offer they sent (bids). A match on `profiles.skills` counts as a weaker signal when they have no history yet (new workers still get a chance).
2. **Place fits**:
   - nearby task (it has `loc_lat/loc_lng`): the worker's saved place (`profiles.loc_lat/loc_lng`) is within the radius (default 10 km, the same default as the Find work map filter, `DEFAULT_FILTERS.km`);
   - online task (no location): category only, no distance test.
3. **Active recently**: `profiles.last_seen_at` within 7 days (the app already writes it once a minute).
4. **Switch is on** and not paused (worker setting), and the admin kill switch is on.
5. **Not**: the poster, a deleted or age-gate-blocked account, a worker who already sent an offer, a worker already alerted about this task.

Ranking, then limit: score = completed same category (3) + offers sent same category (1) + skill match (1) + closer is better (up to 1) + Active now (1). Send to the top **10** per task. Alerts stop for a task once it is no longer OPEN or already has 5 offers (IDEA default; owner may change).

## Limits

- **Daily cap**: 3 alerts per worker per India-time day (worker can choose 1, 3 or 5; admin sets the ceiling).
- Never more than one alert per worker per task.
- **Quiet hours** 10 pm to 8 am India time: the alert waits and is sent at 8 am only if the task is still open (IDEA).
- Alerts about the worker's own tasks, offers and payments are separate and are never affected by this switch.

## Wording (same style as task 1.7: short title, task in the body, one next step)

| Case | Title | Body |
|---|---|---|
| Nearby task | New task near you | To do "Fix a leaking kitchen tap", 2 km away. Open it to send your offer. |
| Online task | New online task for you | To do "Design a logo for a bakery". Open it to send your offer. |

Rules: title under about 30 characters; the task title shortened to 60 as `private.on_task_changed` does; no price in the title; only the area name and distance, never the address (privacy rule); no name of the poster (same as 1.7 offers when no first name). `lockScreenSafe()` in the existing push job already trims what shows on a locked phone; reuse it. Price in the body: TO CONFIRM that the task card shows a budget today; if it does not, leave it out.

## Screens

- **Worker's off switch**: new small screen "Task alerts" under Account > Notifications: on/off switch, how many a day (1 / 3 / 5), pause for (1 day / 7 days), quiet hours line. Earn blue accents (worker palette), jade only for the switch's on state (a shared control). There is no per-worker notification preference screen today (`NotificationsScreen.tsx` only lists notifications), so this is new.
- **Admin kill switch**: a new card in the admin app, beside the app controls: on/off for everyone (requires a reason, written to the admin log, like `admin_set_app_control` in migration 092), daily ceiling, max workers per task, radius, active-within days, hold-back percentage, and the numbers panel.

## What is reused (checked in code)

| Existing | Used for |
|---|---|
| `public.notifications` + `private.notify()` (migration 048) | the bell row; new `kind = 'task_alert'` |
| `private.push_notification()` trigger (051, 101) and the Inngest `push-notification` function, `push_job_load`, `lockScreenSafe`, `expoSend`, dead-token cleanup | the push itself, retries, receipts: no new push code |
| `public.push_tokens` (051), `app_devices.push_registered_at` (092) | who has a device |
| `private.emit_event()` outbox (090) and `inngest/index.ts` function pattern, `reportFailure` | the "task posted" event and the new job |
| `profiles.skills / loc_lat / loc_lng / last_seen_at`, `tasks.category / loc_lat / loc_lng`, `bids`, `assignments` | all the matching data: no new tracking |
| `app_controls` + admin log pattern (092), `public.settings` + `private.setting_num` | kill switch and tunable numbers |
| `Notifications` bell + tap to task (`NotificationsScreen.tsx`) | opening an alert |

## What is new

1. Migration (additive only, forward-only):
   - `profiles.task_alerts jsonb` (or 3 small columns): `enabled`, `per_day`, `paused_until`. New columns on `profiles` need the column grant list from migration 073 updated, or the app cannot save them (rule: the server decides, so also check in the function).
   - `public.task_alert_log (id, task_id, user_id, sent_at, notification_id, was_holdback bool default false)` with unique `(task_id, user_id)`; index `(user_id, sent_at)` for the daily cap; RLS on, no client access (private).
   - settings rows: `smart_alerts_enabled`, `smart_alerts_daily_cap`, `smart_alerts_max_per_task`, `smart_alerts_radius_km`, `smart_alerts_active_days`, `smart_alerts_holdback_pct`.
   - `private.pick_alert_recipients(p_task uuid)`: one SQL function that applies the rules above and returns up to N user ids; a trigger on `tasks` insert (status OPEN) calls `private.emit_event('task.posted', ...)`.
   - SQL test in `supabase/tests`: cap, switch off, radius, remote-by-category, poster excluded, holdback, deleted user.
2. One Inngest function `task-alerts` on event `taskdrop/task.posted`: call the picker, write the log, call `private.notify` for each (push follows by the existing path). Event-driven, not a cron, so it costs about 1 to 2 executions per posted task. Note the Inngest Hobby limit was hit on 16 Nov (50k executions): alerts must not run on a schedule.
3. App: the "Task alerts" screen, one bell kind (icon and tap target), `task_alert` mapped to open the task.
4. Admin: one card (separate repo `taskdrop-admin`, separate PR).

Staging only until the owner approves the production database step; fake workers (the 120 seeded fake people) make a good first test.

## How it is measured

Time to first offer = `min(bids.created_at) - tasks.created_at` per task. Already in the database, so no new tracking. Panel shows, last 14 days, for alerted vs hold-back tasks: median minutes to first offer, share of tasks with an offer within 1 hour, alert open rate (`notifications.read_at`), share of alerted workers who sent an offer within 2 hours, opt-out rate (switch turned off), and alerts per worker per day (is the cap right?). **Fair test (IDEA):** a random 10% of new tasks send no alerts (`was_holdback`), so the comparison is honest. Without a hold-back we only see before and after, which launch-week growth would distort. The owner can set it to 0.

## Safety and abuse

- Server-only picking; the client never sends recipients.
- Cannot be used to spam: cap, per-task limit, kill switch, pause.
- No personal data leaves: the push carries only the title and body above; the admin panel shows counts, not names.
- Gets worse with bad categories: if a poster picks the wrong category, the wrong workers are alerted; the cap limits the harm.

## Open questions for the owner

1. Hold-back group: keep 10% of tasks without alerts for a fair measurement (recommended), or alert every task?
2. Defaults: 3 alerts a day, radius 10 km, active within 7 days, top 10 workers per task, quiet hours 10 pm to 8 am. OK, or change?
3. Should the alert show the budget, if the task card shows one today?
4. Worker default: alerts ON for everyone (recommended, with the off switch visible in the first alert's settings link), or OFF until the worker opts in?
5. New workers with no history: alert them by skills only, or wait until their first completed task?
