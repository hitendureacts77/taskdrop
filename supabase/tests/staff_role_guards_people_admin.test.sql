-- The database enforces staff roles on people and admin writes (migration 124).
--
-- One transaction, rolled back. Each login is faked with request.jwt.claims and role =
-- authenticated, the way PostgREST does it (see staff_role_db_guards.test.sql).
-- A call is "refused" when it stops at the role guard; otherwise it got past the guard
-- (and then failed on a made-up id, which is fine).
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/staff_role_guards_people_admin.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- true when the call stopped at a role guard
create or replace function pg_temp.refused(p_sql text) returns boolean
language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return false;
exception when others then
  v_msg := sqlerrm;
  return v_msg like '%staff role%' or v_msg like 'Admins only%';
end;
$$;

do $$
declare
  v_full    uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_sales   uuid := gen_random_uuid();
  v_viewer  uuid := gen_random_uuid();
  -- safe to run for real with a made-up id: they fail after the guard on "no such ...", or change nothing
  v_people  text[] := array[
    $c$select public.admin_copyright_takedown(gen_random_uuid(), 'task', 'x')$c$,
    $c$select public.admin_copyright_restore(gen_random_uuid())$c$,
    $c$select public.admin_copyright_counter(gen_random_uuid(), 'x')$c$,
    $c$select public.admin_copyright_reject(gen_random_uuid(), 'x')$c$,
    $c$select public.admin_log_copyright_notice('a', 'a@b.c', 'w', 'm', null, null)$c$,
    $c$select public.crm_add_note(gen_random_uuid(), 'x', null)$c$,
    $c$select public.crm_update_note(gen_random_uuid(), true, null)$c$,
    $c$select public.crm_delete_note(gen_random_uuid())$c$,
    $c$select public.crm_assign_tag(gen_random_uuid(), 't', '#ffffff')$c$,
    $c$select public.crm_remove_tag(gen_random_uuid(), gen_random_uuid())$c$,
    $c$select public.crm_delete_tag(gen_random_uuid())$c$,
    $c$select public.crm_save_segment('s', '{}'::jsonb)$c$,
    $c$select public.crm_delete_segment(gen_random_uuid())$c$,
    $c$select public.crm_suspend_user(gen_random_uuid(), 'x')$c$,
    $c$select public.crm_unsuspend_user(gen_random_uuid(), 'x')$c$
  ];
  v_admin   text[] := array[
    $c$select public.admin_delete_account(gen_random_uuid(), 'x')$c$,
    $c$select public.admin_set_admin(gen_random_uuid(), false)$c$
  ];
  -- never run for real by a role that passes the guard (it could message everyone): refusal only
  v_broadcast constant text := $c$select public.crm_send_broadcast('t', 'b', '{}'::jsonb, null, null)$c$;
  v_sql text;
  v_name text;
  v_user uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'peopleguard+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_finance), (v_support), (v_sales), (v_viewer)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'P Full'), (v_finance, 'P Finance'), (v_support, 'P Support'), (v_sales, 'P Sales'), (v_viewer, 'P Viewer')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_finance, v_support, v_sales, v_viewer]) u on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role)
  values (v_finance, 'finance'), (v_support, 'support'), (v_sales, 'sales'), (v_viewer, 'viewer');

  -- Viewer and Finance: nothing in the people area, nothing in the admin area.
  foreach v_user in array array[v_viewer, v_finance] loop
    perform pg_temp.become(v_user);
    foreach v_sql in array v_people || v_admin || v_broadcast loop
      if not pg_temp.refused(v_sql) then
        perform pg_temp.as_owner();
        raise exception 'FAIL: % (a % login) was not refused',
          substring(v_sql from 'public\.([a-z_]+)'), private.staff_role(v_user);
      end if;
    end loop;
    perform pg_temp.as_owner();
  end loop;

  -- Support and Sales: the people area is theirs, the admin area is not.
  foreach v_user in array array[v_support, v_sales] loop
    perform pg_temp.become(v_user);
    foreach v_sql in array v_people loop
      if pg_temp.refused(v_sql) then
        perform pg_temp.as_owner();
        raise exception 'FAIL: % was refused to a % login but is in their area', substring(v_sql from 'public\.([a-z_]+)'), private.staff_role(v_user);
      end if;
    end loop;
    foreach v_sql in array v_admin loop
      if not pg_temp.refused(v_sql) then
        perform pg_temp.as_owner();
        raise exception 'FAIL: % was not refused to a % login', substring(v_sql from 'public\.([a-z_]+)'), private.staff_role(v_user);
      end if;
    end loop;
    perform pg_temp.as_owner();
  end loop;

  -- A full admin gets past every guard.
  perform pg_temp.become(v_full);
  foreach v_sql in array v_people || v_admin loop
    if pg_temp.refused(v_sql) then
      perform pg_temp.as_owner();
      raise exception 'FAIL: % was refused to a full admin', substring(v_sql from 'public\.([a-z_]+)');
    end if;
  end loop;
  perform pg_temp.as_owner();

  -- Every guarded function says so in its source, and the helper is private.
  for v_name in select unnest(array[
      'admin_copyright_takedown', 'admin_copyright_restore', 'admin_copyright_counter', 'admin_copyright_reject',
      'admin_log_copyright_notice', 'crm_add_note', 'crm_update_note', 'crm_delete_note', 'crm_assign_tag',
      'crm_remove_tag', 'crm_delete_tag', 'crm_save_segment', 'crm_delete_segment', 'crm_send_broadcast',
      'crm_suspend_user', 'crm_unsuspend_user', 'admin_delete_account', 'admin_set_admin'])
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
                    where p.proname = v_name
                      and (p.prosrc like '%require_people_staff()%' or p.prosrc like '%require_admin_staff()%')) then
      raise exception 'FAIL: % has no role guard', v_name;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.require_admin_staff()', 'execute') then
    raise exception 'FAIL: require_admin_staff must not be callable by signed-in people';
  end if;

  -- The two functions shared with ticket owners were left alone.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
              where p.proname in ('reply_support_ticket', 'resolve_support_ticket') and p.prosrc like '%require_%staff()%') then
    raise exception 'FAIL: ticket owners must still be able to reply to and resolve their own help request';
  end if;

  raise notice 'staff_role_guards_people_admin: all assertions passed';
end;
$$;

rollback;
