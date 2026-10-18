-- Migration 106 (CodeRabbit's review of PR 28).
--
-- What is asserted:
--   1. The "hidden job" rule lets the assigned worker through.
--   2. An app version with a part too large for an int does not make
--      get_app_controls raise (it used to, which switched every control off).
--   3. user_sync_apply refuses a null event.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/coderabbit_round2.test.sql

begin;

do $$
begin
  if not exists (select 1 from pg_policy
                  where polrelid = 'public.tasks'::regclass and polname = 'tasks_hide_moderated'
                    and pg_get_expr(polqual, polrelid) like '%has_assignment%') then
    raise exception 'FAIL: tasks_hide_moderated does not let the assigned worker see a hidden job';
  end if;
end;
$$;

do $$
declare
  v_cfg jsonb;
begin
  update public.app_controls set min_version = '1.0.0' where platform = 'all';
  v_cfg := public.get_app_controls('web', '99999999999');
  if v_cfg is null or not (v_cfg ? 'maintenance') then
    raise exception 'FAIL: an overlong version broke get_app_controls: %', v_cfg;
  end if;
  if (v_cfg ->> 'update_required')::boolean is distinct from false then
    raise exception 'FAIL: an unreadable version should count as unknown, not as outdated: %', v_cfg;
  end if;
  v_cfg := public.get_app_controls('web', '0.9.0');
  if (v_cfg ->> 'update_required')::boolean is distinct from true then
    raise exception 'FAIL: an old version no longer needs an update: %', v_cfg;
  end if;
end;
$$;

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.user_sync_apply(gen_random_uuid(), null);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: user_sync_apply accepted a null event';
  end if;
end;
$$;

-- 4. (migration 107) an admin cannot save a minimum version with a part over 6 digits.
-- Run as a real full admin on the authenticated role, not as the SQL operator.
do $$
declare
  v_admin  uuid := gen_random_uuid();
  v_failed boolean := false;
  v_msg    text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'minver+' || v_admin || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_admin, 'Min Version Admin') on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_set_app_control('web', '{"min_version": "99999999999"}'::jsonb, 'test');
  exception when others then
    v_failed := true;
    v_msg := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  if not v_failed or v_msg not like 'min_version looks like%' then
    raise exception 'FAIL: an overlong min_version was accepted, or refused for another reason (%)', v_msg;
  end if;
end;
$$;

rollback;
