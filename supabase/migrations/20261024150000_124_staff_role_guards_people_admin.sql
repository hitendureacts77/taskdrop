-- 124 — the database enforces staff roles on the people and admin writes too (Phase 2, P2-13).
--
-- Migration 100 did this for the three money writes. The same audit, run on the test project as
-- real Viewer, Support, Sales and Finance logins (rolled back), found that these functions only
-- asked "is this an admin?", so any staff login could call them straight through the API even
-- though the panel hides the buttons:
--
--   people area (admin, Support and Sales; not Viewer, not Finance):
--     admin_copyright_takedown, _restore, _counter, _reject, admin_log_copyright_notice,
--     crm_add_note, crm_update_note, crm_delete_note, crm_assign_tag, crm_remove_tag,
--     crm_delete_tag, crm_save_segment, crm_delete_segment, crm_send_broadcast,
--     crm_suspend_user, crm_unsuspend_user
--   admin area (full admin only):
--     admin_delete_account, admin_set_admin
--
-- Each function keeps its signature and body. The guard is one line added right after the first
-- `begin`: private.require_people_staff() (093) or the new private.require_admin_staff().
-- Doing it by rewriting the live definition here, and asserting that each function ended up
-- with its guard, means no body is retyped.
--
-- Left alone on purpose:
--   * reply_support_ticket and resolve_support_ticket also serve the person who owns the ticket;
--     staff replies are already stopped for Viewer and Finance by the table triggers (089).
--   * admin_set_staff lets any staff member switch their own alerts; the admin_staff trigger
--     decides who may change a role.
--   * admin_log_event: any staff login, Viewer included, records that it exported something.
--   * Reads (crm_segment_users, dashboards): a Viewer sees everything.
--
-- A bare service-role or operator call (no signed-in person) is refused by these guards, as it
-- is by 100; the admin panel uses the staff member's own session and nothing else calls them.

create or replace function private.require_admin_staff()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not private.staff_can(auth.uid(), 'admin') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(auth.uid())
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_admin_staff() from public, anon, authenticated;

do $patch$
declare
  r record;
  v_def text;
  v_new text;
  v_guard text;
  v_n int;
begin
  for r in
    select p.oid, p.proname, p.pronargs,
           case when p.proname in ('admin_delete_account', 'admin_set_admin')
                then 'perform private.require_admin_staff();'
                else 'perform private.require_people_staff();' end as guard
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.proname in (
       'admin_copyright_takedown', 'admin_copyright_restore', 'admin_copyright_counter', 'admin_copyright_reject',
       'admin_log_copyright_notice',
       'crm_add_note', 'crm_update_note', 'crm_delete_note', 'crm_assign_tag', 'crm_remove_tag', 'crm_delete_tag',
       'crm_save_segment', 'crm_delete_segment', 'crm_send_broadcast', 'crm_suspend_user', 'crm_unsuspend_user',
       'admin_delete_account', 'admin_set_admin')
  loop
    v_def := pg_get_functiondef(r.oid);
    -- Already guarded (re-running this migration): leave it.
    continue when v_def like '%require_people_staff%' or v_def like '%require_admin_staff%';
    select count(*) into v_n from regexp_matches(v_def, '\mbegin\M', 'gi');
    if v_n <> 1 then
      raise exception 'Expected exactly one begin in %, found %', r.proname, v_n;
    end if;
    v_new := regexp_replace(v_def, '\mbegin\M', 'begin' || chr(10) || '  ' || r.guard, 'i');
    execute v_new;
  end loop;

  -- Prove every one of them now carries a guard.
  for r in
    select p.proname, p.prosrc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.proname in (
       'admin_copyright_takedown', 'admin_copyright_restore', 'admin_copyright_counter', 'admin_copyright_reject',
       'admin_log_copyright_notice',
       'crm_add_note', 'crm_update_note', 'crm_delete_note', 'crm_assign_tag', 'crm_remove_tag', 'crm_delete_tag',
       'crm_save_segment', 'crm_delete_segment', 'crm_send_broadcast', 'crm_suspend_user', 'crm_unsuspend_user',
       'admin_delete_account', 'admin_set_admin')
  loop
    if r.prosrc not like '%require_people_staff()%' and r.prosrc not like '%require_admin_staff()%' then
      raise exception '% did not get its guard', r.proname;
    end if;
  end loop;
end
$patch$;
