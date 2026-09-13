-- ===========================================================================
-- TaskDrop RLS policies (migration 002)
-- Clients READ what concerns them + a few narrow INSERTs (post task, bid,
-- review). Every money/state transition runs in Edge Functions with the
-- service_role key, which bypasses RLS. auth.uid() wrapped in (select ...).
-- NOTE: policies here reference public.is_admin()/has_role(); migration 003
-- re-points them at the private schema. Superseded lines kept for history.
-- ===========================================================================

create policy profiles_select_all on public.profiles
  for select using (true);
create policy profiles_update_own on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy roles_select_own_or_admin on public.user_roles
  for select using ((select auth.uid()) = user_id or public.is_admin());
create policy roles_admin_write on public.user_roles
  for all using (public.is_admin()) with check (public.is_admin());

create policy wallets_select_own_or_admin on public.wallets
  for select using ((select auth.uid()) = user_id or public.is_admin());

create policy settings_select_authenticated on public.settings
  for select to authenticated using (true);
create policy settings_admin_write on public.settings
  for all using (public.is_admin()) with check (public.is_admin());

create policy tasks_select_visible on public.tasks
  for select using (
    status = 'OPEN'
    or poster_id = (select auth.uid())
    or public.is_admin()
    or exists (select 1 from public.bids b where b.task_id = id and b.worker_id = (select auth.uid()))
    or exists (select 1 from public.assignments a where a.task_id = id and a.worker_id = (select auth.uid()))
  );
create policy tasks_insert_own on public.tasks
  for insert with check (
    poster_id = (select auth.uid())
    and public.has_role((select auth.uid()), 'poster')
  );
create policy tasks_update_own_while_open on public.tasks
  for update using (poster_id = (select auth.uid()) and status = 'OPEN')
  with check (poster_id = (select auth.uid()));

create policy bids_select_participants on public.bids
  for select using (
    worker_id = (select auth.uid())
    or public.is_admin()
    or exists (select 1 from public.tasks t where t.id = task_id and t.poster_id = (select auth.uid()))
  );
create policy bids_insert_own on public.bids
  for insert with check (
    worker_id = (select auth.uid())
    and public.has_role((select auth.uid()), 'worker')
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.status = 'OPEN' and t.poster_id <> (select auth.uid())
    )
  );
create policy bids_update_own on public.bids
  for update using (worker_id = (select auth.uid()) and is_locked = false)
  with check (worker_id = (select auth.uid()));
create policy bids_delete_own on public.bids
  for delete using (worker_id = (select auth.uid()) and is_locked = false);

create policy assignments_select_participants on public.assignments
  for select using (
    worker_id = (select auth.uid())
    or public.is_admin()
    or exists (select 1 from public.tasks t where t.id = task_id and t.poster_id = (select auth.uid()))
  );

create policy reviews_select_all on public.reviews
  for select using (true);
create policy reviews_insert_participant on public.reviews
  for insert with check (
    author_id = (select auth.uid())
    and (
      exists (select 1 from public.tasks t where t.id = task_id and t.poster_id = (select auth.uid()))
      or exists (select 1 from public.assignments a where a.task_id = task_id and a.worker_id = (select auth.uid()))
    )
  );
create policy reviews_update_own on public.reviews
  for update using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

create policy cancel_log_admin_select on public.cancellations_log
  for select using (public.is_admin());
