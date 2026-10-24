-- Segments and broadcasts by platform and app version (migration 119).
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/broadcast_platform.test.sql

begin;

do $$
declare
  v_web     uuid := gen_random_uuid();
  v_old     uuid := gen_random_uuid();
  v_new     uuid := gen_random_uuid();
  v_nodev   uuid := gen_random_uuid();
  v_n       int;
  v_failed  boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'seg+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_web), (v_old), (v_new), (v_nodev)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_web, 'Seg Web'), (v_old, 'Seg Old'), (v_new, 'Seg New'), (v_nodev, 'Seg None')
  on conflict (id) do nothing;

  insert into public.app_devices (user_id, install_id, platform, app_version)
  values (v_web, 'seg-install-web-1', 'web', '1.9.0'),
         (v_old, 'seg-install-and-1', 'android', '1.2.0'),
         (v_new, 'seg-install-and-2', 'android', '1.5.0');

  -- platform alone
  select count(*) into v_n from private.crm_segment_ids('{"platform":"android"}')
   where crm_segment_ids in (v_web, v_old, v_new, v_nodev);
  if v_n <> 2 then raise exception 'android should match 2 of the test people, got %', v_n; end if;

  select count(*) into v_n from private.crm_segment_ids('{"platform":"web"}')
   where crm_segment_ids in (v_web, v_old, v_new, v_nodev);
  if v_n <> 1 then raise exception 'web should match 1 of the test people, got %', v_n; end if;

  -- version alone and with a platform
  select count(*) into v_n from private.crm_segment_ids('{"app_version_below":"1.4.0"}')
   where crm_segment_ids in (v_web, v_old, v_new, v_nodev);
  if v_n <> 1 then raise exception 'below 1.4.0 should match only the old android install, got %', v_n; end if;

  select count(*) into v_n from private.crm_segment_ids('{"platform":"android","app_version_below":"1.9.0"}')
   where crm_segment_ids in (v_web, v_old, v_new, v_nodev);
  if v_n <> 2 then raise exception 'android below 1.9.0 should match both android people, got %', v_n; end if;

  -- a person with no install matches neither filter, but still matches an empty one
  select count(*) into v_n from private.crm_segment_ids('{"platform":"ios"}') where crm_segment_ids = v_nodev;
  if v_n <> 0 then raise exception 'a person with no install must not match a platform'; end if;
  select count(*) into v_n from private.crm_segment_ids('{}') where crm_segment_ids = v_nodev;
  if v_n <> 1 then raise exception 'an empty filter must still match everyone'; end if;

  -- bad input is refused, not cast
  v_failed := false;
  begin perform count(*) from private.crm_segment_ids('{"platform":"symbian"}'); exception when others then v_failed := true; end;
  if not v_failed then raise exception 'an unknown platform must be refused'; end if;

  v_failed := false;
  begin perform count(*) from private.crm_segment_ids('{"app_version_below":"1.x"}'); exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a malformed version must be refused'; end if;

  raise notice 'broadcast_platform: ok';
end;
$$;

rollback;
