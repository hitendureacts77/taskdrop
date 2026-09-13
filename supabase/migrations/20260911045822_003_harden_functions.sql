-- ===========================================================================
-- Security hardening (migration 003) — clears Supabase advisor WARNs.
-- Pins search_path, removes the new-user trigger from the REST API, and moves
-- the RLS helpers into a private schema (unreachable via PostgREST /rpc while
-- still usable by RLS). Re-points every dependent policy at private.*.
-- ===========================================================================

alter function public.set_updated_at() set search_path = '';

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.has_role(uid uuid, r app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = uid and role = r);
$$;
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select private.has_role(auth.uid(), 'admin');
$$;
grant execute on function private.has_role(uuid, app_role) to anon, authenticated, service_role;
grant execute on function private.is_admin() to anon, authenticated, service_role;

drop policy roles_select_own_or_admin on public.user_roles;
create policy roles_select_own_or_admin on public.user_roles
  for select using ((select auth.uid()) = user_id or private.is_admin());
drop policy roles_admin_write on public.user_roles;
create policy roles_admin_write on public.user_roles
  for all using (private.is_admin()) with check (private.is_admin());

drop policy wallets_select_own_or_admin on public.wallets;
create policy wallets_select_own_or_admin on public.wallets
  for select using ((select auth.uid()) = user_id or private.is_admin());

drop policy settings_admin_write on public.settings;
create policy settings_admin_write on public.settings
  for all using (private.is_admin()) with check (private.is_admin());

drop policy tasks_select_visible on public.tasks;
create policy tasks_select_visible on public.tasks
  for select using (
    status = 'OPEN'
    or poster_id = (select auth.uid())
    or private.is_admin()
    or exists (select 1 from public.bids b where b.task_id = id and b.worker_id = (select auth.uid()))
    or exists (select 1 from public.assignments a where a.task_id = id and a.worker_id = (select auth.uid()))
  );
drop policy tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks
  for insert with check (
    poster_id = (select auth.uid())
    and private.has_role((select auth.uid()), 'poster')
  );

drop policy bids_select_participants on public.bids;
create policy bids_select_participants on public.bids
  for select using (
    worker_id = (select auth.uid())
    or private.is_admin()
    or exists (select 1 from public.tasks t where t.id = task_id and t.poster_id = (select auth.uid()))
  );
drop policy bids_insert_own on public.bids;
create policy bids_insert_own on public.bids
  for insert with check (
    worker_id = (select auth.uid())
    and private.has_role((select auth.uid()), 'worker')
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.status = 'OPEN' and t.poster_id <> (select auth.uid())
    )
  );

drop policy assignments_select_participants on public.assignments;
create policy assignments_select_participants on public.assignments
  for select using (
    worker_id = (select auth.uid())
    or private.is_admin()
    or exists (select 1 from public.tasks t where t.id = task_id and t.poster_id = (select auth.uid()))
  );

drop policy cancel_log_admin_select on public.cancellations_log;
create policy cancel_log_admin_select on public.cancellations_log
  for select using (private.is_admin());

drop function public.is_admin();
drop function public.has_role(uuid, app_role);
