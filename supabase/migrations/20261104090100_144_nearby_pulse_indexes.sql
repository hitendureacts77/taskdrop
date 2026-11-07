-- 144: indexes for nearby_pulse, the "near you" line on the poster's Home (140).
--
-- nearby_pulse counts tasks done today and helpers seen in the last three
-- minutes. Neither filter had an index (only tasks(status), 001), so every Home
-- open scanned every completed task ever and every profile (eng review
-- 2026-11-03, F2 / plan R2). Both indexes are partial and match the function's
-- own conditions, so they stay small: completed tasks only, live accounts only.
-- Only adds indexes.

create index if not exists tasks_completed_at_done_idx
  on public.tasks (completed_at)
  where status in ('COMPLETED', 'AUTO_COMPLETED');

create index if not exists profiles_last_seen_at_live_idx
  on public.profiles (last_seen_at)
  where deleted_at is null;
