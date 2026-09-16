-- 036 — refunds_outstanding is an operator queue, not app data.
--
-- A Postgres view runs as its owner unless told otherwise, so RLS on the
-- tables underneath does not narrow it. refunds_outstanding joins tasks to
-- payments across every poster: as created in 033, any signed-in user could
-- have read the whole platform's unpaid refunds — who is owed, and how much.
-- Caught by the database linter, not by me.

revoke all on public.refunds_outstanding from anon, authenticated;

-- And make it obey the caller's row security anyway, so a future grant cannot
-- reopen the same hole by accident.
alter view public.refunds_outstanding set (security_invoker = true);

-- sponsored_tasks has the same default. Its contents are the ids of listings
-- already shown publicly in the feed, so nothing leaks — but there is no
-- reason for it to run as the owner either.
alter view public.sponsored_tasks set (security_invoker = true);
