-- Nothing that moves money, changes a task, or reads the business's numbers
-- should be reachable without signing in.
--
-- Every one of these already refuses a null auth.uid(), so this is not a hole
-- being closed so much as a door that was never meant to be on the building:
-- a signed-out caller could reach /rest/v1/rpc/request_withdrawal and get as
-- far as the function body. Revoking EXECUTE means anon is turned away by
-- PostgREST before any of our code runs.
revoke execute on function public.request_withdrawal(bigint, text) from anon;
revoke execute on function public.cancel_task(uuid, text) from anon;
revoke execute on function public.open_dispute(uuid, text) from anon;
revoke execute on function public.request_revision(uuid, text) from anon;
revoke execute on function public.submit_review(uuid, smallint, text) from anon;
revoke execute on function public.platform_stats(integer) from anon;

-- The signed-in half stays granted deliberately: these are the app's own
-- write paths, and each re-checks auth.uid() and ownership internally.
grant execute on function public.request_withdrawal(bigint, text) to authenticated;
grant execute on function public.cancel_task(uuid, text) to authenticated;
grant execute on function public.open_dispute(uuid, text) to authenticated;
grant execute on function public.request_revision(uuid, text) to authenticated;
grant execute on function public.submit_review(uuid, smallint, text) to authenticated;
grant execute on function public.platform_stats(integer) to authenticated;

-- The feed is the app's hottest query: open tasks, newest first, every time
-- anyone opens the home screen. tasks_status_idx covers the filter but not the
-- sort, so Postgres fetches every OPEN row and sorts it. This serves both
-- halves from one index. (At nine rows the planner still prefers a seq scan --
-- correctly. This is for the table this app is meant to have.)
create index if not exists tasks_open_recent_idx
  on public.tasks (status, created_at desc);

-- Search filters by pillar within that same set.
create index if not exists tasks_pillar_recent_idx
  on public.tasks (pillar, status, created_at desc);
