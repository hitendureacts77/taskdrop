-- Who can open a photo sent in a task's chat (migration 112).
--
-- A chat photo sent as a plain storage path ('::media::<uid>/<file>') must be
-- readable by the sender and by the other person in the thread, and by nobody
-- else. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/chat_photos.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$;

do $
declare
  v_poster   uuid := gen_random_uuid();
  v_worker   uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_task     uuid;
  v_bid      uuid;
  v_path     text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'chatphoto+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_stranger)) as u(id);

  insert into public.profiles (id, display_name)
  values (v_poster, 'Photo Poster'), (v_worker, 'Photo Worker'), (v_stranger, 'Photo Stranger')
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_stranger)
  on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Chat photo test', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;

  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);

  v_path := v_poster || '/chat-photo.jpg';
  insert into public.messages (task_id, sender_id, body) values (v_task, v_poster, '::media::' || v_path);

  -- The helper is not open to app roles (it runs inside the storage policy), so ask it as the operator.
  perform pg_temp.as_operator();

  assert private.can_read_task_media(v_path, v_poster), 'the sender can open their own chat photo';
  assert private.can_read_task_media(v_path, v_worker), 'the other person in the thread can open the photo they were sent';
  assert not private.can_read_task_media(v_path, v_stranger), 'a stranger cannot open a chat photo';
  assert not private.can_read_task_media(v_poster || '/never-sent.jpg', v_worker),
    'a file that was never sent in the thread is not opened by being in the same chat';

  raise notice 'chat_photos: all assertions passed';
end;
$$;

rollback;
