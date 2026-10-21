-- Hiding a message or a photo, and fixing a category (migration 118).
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/content_moderation.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
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
  v_admin  uuid := gen_random_uuid();
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_task   uuid;
  v_bid    uuid;
  v_msg    uuid;
  v_media  uuid;
  v_seen   int;
  v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'mod+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_admin, 'Mod Admin'), (v_poster, 'Mod Poster'), (v_worker, 'Mod Worker') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_admin), (v_poster), (v_worker) on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category)
  values (v_poster, 'services', 'moderation', 100000, 240, 'Plumbing') returning id into v_task;
  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;
  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);
  insert into public.messages (task_id, sender_id, body) values (v_task, v_poster, 'something rude') returning id into v_msg;

  perform pg_temp.as_operator();
  insert into public.media (owner, provider, path, purpose, kind, status, attached_at)
  values (v_poster, 'supabase', 'mod-test/' || v_poster || '/a.jpg', 'chat', 'image', 'attached', now())
  returning id into v_media;

  -- people who are not staff cannot
  perform pg_temp.become(v_worker);
  v_failed := false;
  begin perform public.admin_hide_message(v_msg, 'rude'); exception when others then v_failed := true; end;
  assert v_failed, 'only staff can hide a message';

  -- staff hide it: it disappears for both people, not for admins
  perform pg_temp.become(v_admin);
  v_failed := false;
  begin perform public.admin_hide_message(v_msg, ' '); exception when others then v_failed := true; end;
  assert v_failed, 'a reason is required';
  perform public.admin_hide_message(v_msg, 'abusive');

  perform pg_temp.become(v_poster);
  select count(*) into v_seen from public.messages where id = v_msg;
  assert v_seen = 0, 'the sender no longer sees a hidden message';
  perform pg_temp.become(v_worker);
  select count(*) into v_seen from public.messages where id = v_msg;
  assert v_seen = 0, 'the other person no longer sees it';
  -- nothing is deleted: the row is still there for the admin panel (which reads with the service key)
  perform pg_temp.as_operator();
  select count(*) into v_seen from public.messages where id = v_msg;
  assert v_seen = 1, 'the message is hidden, not deleted';
  perform pg_temp.become(v_admin);

  perform public.admin_unhide_message(v_msg);
  perform pg_temp.become(v_worker);
  select count(*) into v_seen from public.messages where id = v_msg;
  assert v_seen = 1, 'unhiding brings it back';

  -- photo
  perform pg_temp.become(v_admin);
  perform public.admin_hide_media(v_media, 'inappropriate');
  perform pg_temp.as_operator();
  assert (select status from public.media where id = v_media) = 'hidden', 'the photo is hidden';
  perform pg_temp.become(v_admin);
  perform public.admin_unhide_media(v_media);
  perform pg_temp.as_operator();
  assert (select status from public.media where id = v_media) = 'attached', 'unhiding restores it';

  -- category
  perform pg_temp.become(v_admin);
  perform public.admin_set_task_category(v_task, 'Electrical');
  perform pg_temp.as_operator();
  assert (select category from public.tasks where id = v_task) = 'Electrical', 'the category changed';

  -- everything is in the audit log
  assert (select count(*) from public.admin_audit_log
           where action in ('message.hide', 'message.unhide', 'media.hide', 'media.unhide', 'task.category')) >= 5,
    'every action is audit-logged';

  raise notice 'content_moderation: all assertions passed';
end;
$$;

rollback;
