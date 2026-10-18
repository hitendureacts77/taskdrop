-- The media registry (migration 109): begin -> attach -> who can open it -> discard,
-- expire, delete with an account, purge.
--
-- Everything runs inside one transaction that is rolled back.
--
-- is_admin() is true for any psql/SQL-editor session (the operator rule, 040),
-- so it is narrowed to the real admin role for the length of this transaction,
-- exactly as copyright_takedowns.test.sql does.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/media_registry.test.sql

begin;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = 'public' as
$$ select coalesce(private.has_role(auth.uid(), 'admin'), false) $$;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

create temp table fx (k text primary key, v text);
grant all on fx to public;

do $$
declare
  v_admin    uuid := gen_random_uuid();
  v_owner    uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_task     uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'media+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_owner), (v_stranger)) as u(id);
  insert into public.profiles (id, display_name) values
    (v_admin, 'Admin'), (v_owner, 'Owner'), (v_stranger, 'Stranger')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_owner, 'services', 'Media fixture job', 100000, 240)
  returning id into v_task;

  insert into fx values ('admin', v_admin::text), ('owner', v_owner::text), ('stranger', v_stranger::text), ('task', v_task::text);
end;
$$;

-- ---- 1. beginning an upload ------------------------------------------------
do $$
declare
  v_owner    uuid := (select v::uuid from fx where k = 'owner');
  v_stranger uuid := (select v::uuid from fx where k = 'stranger');
  v_id       uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid();
  v_status   text;
begin
  perform pg_temp.become(v_owner);

  -- a picture starts pending
  perform public.media_begin(v_id, 'imagekit', 'task', 'image', 'image/jpeg', '/local/u/' || v_owner || '/' || v_id || '.jpg');
  select status into v_status from public.media where id = v_id;
  assert v_status = 'pending', 'a new picture should be pending, got ' || coalesce(v_status, 'null');

  -- calling again with the same path is harmless and keeps the same row
  perform public.media_begin(v_id, 'imagekit', 'task', 'image', 'image/jpeg', '/local/u/' || v_owner || '/' || v_id || '.jpg');
  assert (select count(*) from public.media where id = v_id) = 1, 'a retried begin must not add a second row';

  -- a path in somebody else's folder is refused
  begin
    perform public.media_begin(v_other, 'imagekit', 'task', 'image', 'image/jpeg', '/local/u/' || v_stranger || '/' || v_other || '.jpg');
    assert false, 'a path in another person''s folder must be refused';
  exception when sqlstate '22023' then null; end;

  -- only pictures go to ImageKit
  begin
    perform public.media_begin(v_other, 'imagekit', 'task', 'video', 'video/mp4', '/local/u/' || v_owner || '/' || v_other || '.mp4');
    assert false, 'a video must not be registered with ImageKit';
  exception when sqlstate '22023' then null; end;

  -- a file kept in Supabase Storage is recorded as attached straight away
  perform public.media_begin(v_other, 'supabase', 'proof', 'file', null, v_owner || '/proof-1.pdf');
  select status into v_status from public.media where id = v_other;
  assert v_status = 'attached', 'a Supabase file should be attached at once, got ' || coalesce(v_status, 'null');
  begin
    perform public.media_begin(gen_random_uuid(), 'supabase', 'proof', 'file', null, v_stranger || '/proof-2.pdf');
    assert false, 'a Supabase path in another person''s folder must be refused';
  exception when sqlstate '22023' then null; end;

  insert into fx values ('pic', v_id::text);
  perform pg_temp.as_owner();
end;
$$;

-- ---- 2. attaching ----------------------------------------------------------
do $$
declare
  v_owner    uuid := (select v::uuid from fx where k = 'owner');
  v_stranger uuid := (select v::uuid from fx where k = 'stranger');
  v_pic      uuid := (select v::uuid from fx where k = 'pic');
  v_ref      text;
begin
  -- someone else cannot attach it
  perform pg_temp.become(v_stranger);
  begin
    perform public.media_attach(v_pic, 'file-xyz', 1000);
    assert false, 'only the owner may attach an upload';
  exception when sqlstate 'P0001' then null; end;

  perform pg_temp.become(v_owner);
  v_ref := public.media_attach(v_pic, 'file-xyz', 123456);
  assert v_ref = 'media:' || v_pic, 'attach should return the reference, got ' || coalesce(v_ref, 'null');
  assert (select status from public.media where id = v_pic) = 'attached', 'the picture should now be attached';
  assert (select provider_file_id from public.media where id = v_pic) = 'file-xyz', 'the ImageKit file id should be kept';
  -- twice with the same file is fine; with a different one is not
  assert public.media_attach(v_pic, 'file-xyz', 123456) = v_ref, 'attaching twice should be harmless';
  begin
    perform public.media_attach(v_pic, 'file-other', 5);
    assert false, 'an attached picture must not be re-attached to a different file';
  exception when sqlstate 'P0001' then null; end;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 3. who can open it ----------------------------------------------------
do $$
declare
  v_owner    uuid := (select v::uuid from fx where k = 'owner');
  v_stranger uuid := (select v::uuid from fx where k = 'stranger');
  v_admin    uuid := (select v::uuid from fx where k = 'admin');
  v_pic      uuid := (select v::uuid from fx where k = 'pic');
  v_task     uuid := (select v::uuid from fx where k = 'task');
  v_ref      text := 'media:' || (select v from fx where k = 'pic');
begin
  -- attached but not used anywhere: only the owner (and an admin) can open it
  perform pg_temp.become(v_owner);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 1, 'the owner can open their own picture';
  perform pg_temp.become(v_stranger);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 0, 'a stranger cannot open an unused picture';
  perform pg_temp.become(v_admin);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 1, 'an admin can open it';

  -- used by an open task: everyone can see it
  perform pg_temp.as_owner();
  update public.tasks set media_path = v_ref, media_kind = 'image', status = 'OPEN' where id = v_task;
  perform pg_temp.become(v_stranger);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 1, 'a picture on an open task is visible to others';
  assert private.can_read_task_media(v_ref, v_stranger), 'can_read_task_media agrees';

  -- the task closes: strangers lose it, the owner keeps it
  perform pg_temp.as_owner();
  update public.tasks set status = 'CANCELLED' where id = v_task;
  perform pg_temp.become(v_stranger);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 0, 'a picture on a closed task is not visible to strangers';
  perform pg_temp.become(v_owner);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 1, 'the owner still sees it';

  -- used as a profile photo: everyone can see it
  perform pg_temp.as_owner();
  update public.tasks set media_path = null, media_kind = null where id = v_task;
  update public.profiles set avatar_url = v_ref where id = v_owner;
  perform pg_temp.become(v_stranger);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 1, 'a profile photo is visible to everyone';

  -- hidden by moderation: nobody but an admin, not even through the profile
  perform pg_temp.as_owner();
  update public.media set status = 'hidden', hidden_at = now() where id = v_pic;
  perform pg_temp.become(v_stranger);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 0, 'a hidden picture is not visible to others';
  perform pg_temp.become(v_owner);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 0, 'a hidden picture is not visible to its owner either';
  perform pg_temp.become(v_admin);
  assert (select count(*) from public.media_resolve(array[v_ref])) = 1, 'an admin can still open a hidden picture';

  -- names that are not references behave as they always did
  perform pg_temp.as_owner();
  update public.media set status = 'attached', hidden_at = null where id = v_pic;
  update public.profiles set avatar_url = null where id = v_owner;
  assert not private.can_read_task_media('someone/else.jpg', v_stranger), 'an unknown storage path is not readable';
  perform pg_temp.as_owner();
end;
$$;

-- ---- 4. nobody can write the table directly --------------------------------
do $$
declare
  v_stranger uuid := (select v::uuid from fx where k = 'stranger');
begin
  perform pg_temp.become(v_stranger);
  begin
    insert into public.media (owner, provider, path, purpose, kind) values (v_stranger, 'imagekit', '/x', 'task', 'image');
    assert false, 'direct inserts must be refused';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.media) = 0, 'a stranger sees no one else''s rows';
  perform pg_temp.as_owner();
end;
$$;

-- ---- 5. discarding ---------------------------------------------------------
do $$
declare
  v_owner  uuid := (select v::uuid from fx where k = 'owner');
  v_task   uuid := (select v::uuid from fx where k = 'task');
  v_pic    uuid := (select v::uuid from fx where k = 'pic');
  v_ref    text := 'media:' || (select v from fx where k = 'pic');
  v_second uuid := gen_random_uuid();
begin
  perform pg_temp.become(v_owner);
  -- in use: not discarded
  perform pg_temp.as_owner();
  update public.tasks set media_path = v_ref where id = v_task;
  perform pg_temp.become(v_owner);
  assert not public.media_discard(v_ref), 'a picture in use must not be discarded';
  assert (select status from public.media where id = v_pic) = 'attached', 'and it stays attached';

  -- not in use: discarded
  perform pg_temp.as_owner();
  update public.tasks set media_path = null where id = v_task;
  perform pg_temp.become(v_owner);
  assert public.media_discard(v_ref), 'an unused picture can be discarded';
  assert (select status from public.media where id = v_pic) = 'deleted', 'and it is marked deleted';
  assert (select deleted_at from public.media where id = v_pic) is not null, 'with a time';
  assert not public.media_discard(v_ref), 'discarding twice does nothing';
  perform pg_temp.as_owner();
end;
$$;

-- ---- 6. who may call the server-only functions -----------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array['media_expire_pending()', 'media_account_deleted(uuid)', 'media_purge_batch(integer)', 'media_mark_purged(uuid[])'] loop
    assert not has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE'), fn || ' must not be callable by signed-in users';
    assert not has_function_privilege('anon', 'public.' || fn, 'EXECUTE'), fn || ' must not be callable by anon';
    assert has_function_privilege('service_role', 'public.' || fn, 'EXECUTE'), fn || ' must be callable by the server';
  end loop;
  foreach fn in array array['media_begin(uuid,text,text,text,text,text)', 'media_attach(uuid,text,bigint)', 'media_resolve(text[])', 'media_discard(text)'] loop
    assert has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE'), fn || ' must be callable by signed-in users';
    assert not has_function_privilege('anon', 'public.' || fn, 'EXECUTE'), fn || ' must not be callable by anon';
  end loop;
end;
$$;

-- ---- 7. clean-up -----------------------------------------------------------
do $$
declare
  v_owner  uuid := (select v::uuid from fx where k = 'owner');
  v_task   uuid := (select v::uuid from fx where k = 'task');
  v_stale  uuid := gen_random_uuid();
  v_fresh  uuid := gen_random_uuid();
  v_kept   uuid := gen_random_uuid();
  v_gone   uuid := gen_random_uuid();
  v_n      integer;
begin
  perform pg_temp.become(v_owner);
  perform public.media_begin(v_stale, 'imagekit', 'task', 'image', 'image/jpeg', '/local/u/' || v_owner || '/' || v_stale || '.jpg');
  perform public.media_begin(v_fresh, 'imagekit', 'task', 'image', 'image/jpeg', '/local/u/' || v_owner || '/' || v_fresh || '.jpg');
  perform public.media_begin(v_kept,  'imagekit', 'task', 'image', 'image/jpeg', '/local/u/' || v_owner || '/' || v_kept  || '.jpg');
  perform public.media_begin(v_gone,  'imagekit', 'task', 'image', 'image/jpeg', '/local/u/' || v_owner || '/' || v_gone  || '.jpg');
  perform public.media_attach(v_kept, 'file-kept', 10);
  perform public.media_attach(v_gone, 'file-gone', 10);
  perform pg_temp.as_owner();

  -- unfinished uploads older than a day expire; younger ones do not; attached ones never
  update public.media set created_at = now() - interval '25 hours' where id in (v_stale, v_kept);
  v_n := public.media_expire_pending();
  assert v_n = 1, 'exactly one stale pending upload should expire, got ' || v_n;
  assert (select status from public.media where id = v_stale) = 'deleted', 'the stale upload is deleted';
  assert (select status from public.media where id = v_fresh) = 'pending', 'a recent upload is left alone';
  assert (select status from public.media where id = v_kept) = 'attached', 'an attached picture is never expired';

  -- an account that is not deleted keeps everything
  assert public.media_account_deleted(v_owner) = 0, 'a live account''s pictures are never touched';

  -- a deleted account loses its pictures, except those a kept record still uses
  update public.profiles set deleted_at = now() where id = v_owner;
  update public.tasks set media_path = 'media:' || v_kept, status = 'OPEN' where id = v_task;
  v_n := public.media_account_deleted(v_owner);
  assert (select status from public.media where id = v_kept) = 'attached', 'a picture on a kept task stays';
  assert (select status from public.media where id = v_gone) = 'deleted', 'an unused picture goes with the account';
  assert (select status from public.media where id = v_fresh) = 'deleted', 'an unfinished upload goes too';

  -- the purge lists deleted ImageKit pictures once, until they are marked purged
  assert exists (select 1 from public.media_purge_batch(50) where id = v_gone and provider_file_id = 'file-gone'), 'the purge lists the deleted picture';
  assert not exists (select 1 from public.media_purge_batch(50) where id = v_kept), 'it never lists a picture still wanted';
  assert public.media_mark_purged(array[v_gone, v_stale]) = 2, 'both pictures are marked purged';
  assert not exists (select 1 from public.media_purge_batch(50) where id in (v_gone, v_stale)), 'a purged picture is not listed again';
  assert public.media_mark_purged(array[v_gone]) = 0, 'marking twice does nothing';
end;
$$;

rollback;
