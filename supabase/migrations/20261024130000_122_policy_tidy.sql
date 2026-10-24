-- 122 — one read rule per table, and indexes for staff-side foreign keys (Phase 2, P2-6 and P2-7).
--
-- The Supabase performance advisor warns that eleven pairs of permissive policies do the
-- same job twice on every read: "my own rows" and "staff see everything" (app_devices,
-- payouts, task_promotions, wallet_adjustments), or a catch-all staff write policy that also
-- covers SELECT next to the real read rule (settings, user_roles).
--
-- Nobody gains or loses access. Each pair becomes one policy with `or`; each catch-all
-- becomes three (insert, update, delete) so SELECT is left to the read rule alone. The
-- restrictive policies from 099 (Sales are money-blind) are untouched and still AND in.
--
-- Then one index per foreign key the advisor listed, all on staff-side columns.

-- app_devices -----------------------------------------------------------------------------
drop policy if exists app_devices_admin_read on public.app_devices;
drop policy if exists app_devices_own_read on public.app_devices;
create policy app_devices_read on public.app_devices
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- payouts (the own-rows rule was written for public; anon has no grant and no uid, so it matched nothing) ----
drop policy if exists payouts_admin_reads on public.payouts;
drop policy if exists payouts_select_own on public.payouts;
create policy payouts_read on public.payouts
  for select to public
  using (user_id = (select auth.uid()) or private.is_admin());

-- task_promotions ----------------------------------------------------------------------------
drop policy if exists "promotions: own reads" on public.task_promotions;
drop policy if exists promotions_admin_reads on public.task_promotions;
create policy promotions_read on public.task_promotions
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- wallet_adjustments ---------------------------------------------------------------------------
drop policy if exists "adjustments: own" on public.wallet_adjustments;
drop policy if exists "adjustments: admin reads" on public.wallet_adjustments;
create policy adjustments_read on public.wallet_adjustments
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- settings: everyone signed in reads (settings_select_authenticated stays); staff write ----------
drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_insert on public.settings for insert to public with check (private.is_admin());
create policy settings_admin_update on public.settings for update to public
  using (private.is_admin()) with check (private.is_admin());
create policy settings_admin_delete on public.settings for delete to public using (private.is_admin());

-- user_roles: own row or staff reads (roles_select_own_or_admin stays); staff write ---------------
drop policy if exists roles_admin_write on public.user_roles;
create policy roles_admin_insert on public.user_roles for insert to public with check (private.is_admin());
create policy roles_admin_update on public.user_roles for update to public
  using (private.is_admin()) with check (private.is_admin());
create policy roles_admin_delete on public.user_roles for delete to public using (private.is_admin());

-- Foreign keys without an index (staff-side columns). ----------------------------------------------
create index if not exists copyright_notices_logged_by_idx on public.copyright_notices (logged_by);
create index if not exists crm_leads_created_by_idx        on public.crm_leads (created_by);
create index if not exists crm_leads_user_id_idx           on public.crm_leads (user_id);
create index if not exists crm_owners_assigned_by_idx      on public.crm_owners (assigned_by);
create index if not exists crm_rules_created_by_idx        on public.crm_rules (created_by);
create index if not exists crm_rules_updated_by_idx        on public.crm_rules (updated_by);
create index if not exists crm_tasks_completed_by_idx      on public.crm_tasks (completed_by);
create index if not exists crm_tasks_created_by_idx        on public.crm_tasks (created_by);
create index if not exists crm_tasks_task_id_idx           on public.crm_tasks (task_id);
create index if not exists message_moderation_hidden_by_idx on public.message_moderation (hidden_by);
create index if not exists reports_handled_by_idx          on public.reports (handled_by);
create index if not exists review_moderation_hidden_by_idx on public.review_moderation (hidden_by);
create index if not exists task_moderation_hidden_by_idx   on public.task_moderation (hidden_by);
create index if not exists user_warnings_report_id_idx     on public.user_warnings (report_id);
create index if not exists user_warnings_warned_by_idx     on public.user_warnings (warned_by);
