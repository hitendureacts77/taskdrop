-- A file is shared through a row only when it is the row owner's own (migrations 171-173, debug loop B59, B64).
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/media_owner_paths.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Signed in as p_user for auth.uid() (so the 172 triggers check the write), without row level security in the way.
create or replace function pg_temp.claims(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_victim   uuid := gen_random_uuid();
  v_attacker uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_task     uuid;
  v_done     uuid;
  v_media    uuid;
  v_secret   text;
  v_failed   boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'mop+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_victim), (v_attacker), (v_stranger)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_victim, 'MOP Victim'), (v_attacker, 'MOP Attacker'), (v_stranger, 'MOP Stranger') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_victim), (v_attacker), (v_stranger) on conflict (user_id) do nothing;

  v_secret := v_victim || '/proof-123.jpg';

  -- 171, plain avatar path: a row naming someone else's file (written before 172, or by the service role)
  -- no longer shares it.
  perform pg_temp.as_operator();
  update public.profiles set avatar_url = v_secret where id = v_attacker;
  assert not private.can_read_task_media(v_secret, v_stranger), 'another person''s file named as my avatar is not shared';
  update public.profiles set avatar_url = v_attacker || '/face.jpg' where id = v_attacker;
  assert private.can_read_task_media(v_attacker || '/face.jpg', v_stranger), 'my own avatar is still public';
  assert not private.can_read_task_media(v_attacker || '/../' || v_victim || '/proof-123.jpg', v_stranger),
    'a path that climbs out of the folder is never shared';

  -- 171, registry avatar: a 'media:' reference only shares a picture the profile's owner owns.
  insert into public.media (owner, provider, path, purpose, kind, status, attached_at)
  values (v_victim, 'imagekit', '/mop-test/' || gen_random_uuid() || '.jpg', 'proof', 'image', 'attached', now())
  returning id into v_media;
  update public.profiles set avatar_url = 'media:' || v_media where id = v_attacker;
  -- Test sessions always count as admin (session_user is postgres, see 040), and admins may read any
  -- registry picture, so the refusal is checked in the rule's text instead of by a call.
  assert pg_get_functiondef('private.can_read_task_media(text,uuid)'::regprocedure) like '%p.avatar_url = p_name and p.id = m.owner%',
    'someone else''s picture named as my avatar is not shared (the avatar must belong to the picture''s owner)';
  update public.profiles set avatar_url = 'media:' || v_media where id = v_victim;
  assert private.can_read_task_media('media:' || v_media, v_stranger), 'the owner''s own registry avatar is public';
  update public.profiles set avatar_url = null where id in (v_victim, v_attacker);

  -- 172: the database refuses the write itself, for a signed-in caller.
  perform pg_temp.claims(v_attacker);
  v_failed := false;
  begin
    update public.profiles set avatar_url = v_secret where id = v_attacker;
  exception when raise_exception then v_failed := true;
  end;
  assert v_failed, 'a signed-in person cannot save someone else''s file as their avatar';
  update public.profiles set avatar_url = v_attacker || '/face.jpg' where id = v_attacker;
  update public.profiles set avatar_url = 'https://example.test/face.png' where id = v_attacker;
  update public.profiles set avatar_url = null where id = v_attacker;

  perform pg_temp.as_operator();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_attacker, 'services', 'media owner paths', 100000, 240) returning id into v_task;

  perform pg_temp.claims(v_attacker);
  v_failed := false;
  begin
    insert into public.messages (task_id, sender_id, body) values (v_task, v_attacker, '::media::' || v_secret);
  exception when raise_exception then v_failed := true;
  end;
  assert v_failed, 'a chat photo cannot point into someone else''s folder';
  insert into public.messages (task_id, sender_id, body) values (v_task, v_attacker, '::media::' || v_attacker || '/chat.jpg');

  v_failed := false;
  begin
    insert into public.task_proofs (task_id, worker_id, summary, files)
    values (v_task, v_attacker, 'Finished the work exactly as agreed', jsonb_build_array(jsonb_build_object('path', v_secret)));
  exception when raise_exception then v_failed := true;
  end;
  assert v_failed, 'a proof file cannot point into someone else''s folder';

  -- The service role, seeds and jobs (no auth.uid()) are not checked.
  perform pg_temp.as_operator();
  update public.profiles set avatar_url = v_secret where id = v_stranger;
  update public.profiles set avatar_url = null where id = v_stranger;

  -- B64: shared before/after photos skip hidden tasks, deleted workers and files that are not the worker's.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_victim, 'services', 'shared photos', 100000, 240) returning id into v_done;
  update public.tasks set status = 'COMPLETED', completed_at = now(), want_photos = true, photos_public = true where id = v_done;
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_done, v_attacker, 'Painted the gate in two coats',
          jsonb_build_array(
            jsonb_build_object('path', v_attacker || '/after.jpg', 'label', 'after'),
            jsonb_build_object('path', v_secret, 'label', 'before')));

  assert private.can_read_task_media(v_attacker || '/after.jpg', v_stranger), 'a shared after photo is readable';
  assert not private.can_read_task_media(v_secret, v_stranger), 'a shared proof cannot share someone else''s file';
  perform pg_temp.become(v_stranger);
  assert (select jsonb_array_length(files) from public.worker_proof_photos(v_attacker)) = 1,
    'worker_proof_photos lists only the worker''s own files';
  perform pg_temp.as_operator();

  insert into public.task_moderation (task_id, reason) values (v_done, 'test');
  assert not private.can_read_task_media(v_attacker || '/after.jpg', v_stranger), 'a hidden task shares no photos';
  perform pg_temp.become(v_stranger);
  assert not exists (select 1 from public.worker_proof_photos(v_attacker)), 'worker_proof_photos skips a hidden task';
  perform pg_temp.as_operator();
  delete from public.task_moderation where task_id = v_done;

  update public.profiles set deleted_at = now() where id = v_attacker;
  assert not private.can_read_task_media(v_attacker || '/after.jpg', v_stranger), 'a deleted worker shares no photos';
  perform pg_temp.become(v_stranger);
  assert not exists (select 1 from public.worker_proof_photos(v_attacker)), 'worker_proof_photos skips a deleted worker';
  perform pg_temp.as_operator();

  raise notice 'media_owner_paths: all assertions passed';
end;
$$;

rollback;
