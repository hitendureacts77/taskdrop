-- ===========================================================================
-- Fix RLS infinite recursion (migration 004)
-- tasks <-> bids <-> assignments policies referenced each other, looping the
-- RLS evaluator. Replace the cross-table EXISTS checks with SECURITY DEFINER
-- helpers (owned by postgres, so they bypass RLS and break the cycle).
-- ===========================================================================

create or replace function private.is_task_poster(t_id uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tasks where id = t_id and poster_id = uid);
$$;
create or replace function private.user_bid_on_task(t_id uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bids where task_id = t_id and worker_id = uid);
$$;
create or replace function private.user_assigned_task(t_id uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.assignments where task_id = t_id and worker_id = uid);
$$;
create or replace function private.task_open_for_bid(t_id uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks
    where id = t_id and status = 'OPEN' and poster_id <> uid
  );
$$;

grant execute on function private.is_task_poster(uuid, uuid)   to anon, authenticated, service_role;
grant execute on function private.user_bid_on_task(uuid, uuid) to anon, authenticated, service_role;
grant execute on function private.user_assigned_task(uuid, uuid) to anon, authenticated, service_role;
grant execute on function private.task_open_for_bid(uuid, uuid) to anon, authenticated, service_role;

-- ---- tasks: no longer reach into bids/assignments directly -----------------
drop policy tasks_select_visible on public.tasks;
create policy tasks_select_visible on public.tasks
  for select using (
    status = 'OPEN'
    or poster_id = (select auth.uid())
    or private.is_admin()
    or private.user_bid_on_task(id, (select auth.uid()))
    or private.user_assigned_task(id, (select auth.uid()))
  );

-- ---- bids: use helper for the poster check ---------------------------------
drop policy bids_select_participants on public.bids;
create policy bids_select_participants on public.bids
  for select using (
    worker_id = (select auth.uid())
    or private.is_admin()
    or private.is_task_poster(task_id, (select auth.uid()))
  );
drop policy bids_insert_own on public.bids;
create policy bids_insert_own on public.bids
  for insert with check (
    worker_id = (select auth.uid())
    and private.has_role((select auth.uid()), 'worker')
    and private.task_open_for_bid(task_id, (select auth.uid()))
  );

-- ---- assignments: use helper for the poster check --------------------------
drop policy assignments_select_participants on public.assignments;
create policy assignments_select_participants on public.assignments
  for select using (
    worker_id = (select auth.uid())
    or private.is_admin()
    or private.is_task_poster(task_id, (select auth.uid()))
  );

-- ---- reviews: use helpers instead of inline EXISTS on tasks/assignments ----
drop policy reviews_insert_participant on public.reviews;
create policy reviews_insert_participant on public.reviews
  for insert with check (
    author_id = (select auth.uid())
    and (
      private.is_task_poster(task_id, (select auth.uid()))
      or private.user_assigned_task(task_id, (select auth.uid()))
    )
  );
