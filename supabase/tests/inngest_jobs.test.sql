-- The rest of the background jobs on Inngest (migration 101).
--
-- What is asserted:
--   1. A started job past its due time becomes OVERDUE; one not yet due, one with
--      no due time, and one not started are left alone. Running it again changes
--      nothing more.
--   2. Push: with the Inngest switch off a notification queues no event (the old
--      direct send is still in charge); with it on, a notification for a person
--      with a registered device queues notification.created carrying ids and the
--      kind only, never the title or body, and a person with no device queues
--      nothing. The Edge Function can load the message and forget a dead device.
--   3. A deleted account's leftover files are listed; a live account's are never.
--   4. Housekeeping removes what has outlived its use and keeps what has not.
--   5. Only the service role can call any of it.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/inngest_jobs.test.sql

begin;

create or replace function pg_temp.make_user(p_name text) returns uuid
language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'test+' || v_user || '@taskdrop.test', '', now(), now(), now());
  update public.profiles set display_name = p_name where id = v_user;
  return v_user;
end;
$$;

-- ---- 1. overdue tasks -------------------------------------------------------
do $$
declare
  v_poster uuid := pg_temp.make_user('Overdue Poster');
  v_late   uuid;
  v_soon   uuid;
  v_none   uuid;
  v_locked uuid;
begin
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'late job', 10000, 60) returning id into v_late;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'on-time job', 10000, 60) returning id into v_soon;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'no deadline job', 10000, 60) returning id into v_none;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'not started job', 10000, 60) returning id into v_locked;

  update public.tasks set status = 'TASK_STARTED', due_at = now() - interval '1 hour' where id = v_late;
  update public.tasks set status = 'TASK_STARTED', due_at = now() + interval '1 hour' where id = v_soon;
  update public.tasks set status = 'TASK_STARTED', due_at = null                      where id = v_none;
  update public.tasks set status = 'LOCKED',       due_at = now() - interval '1 hour' where id = v_locked;

  if public.run_overdue_tasks() < 1 then
    raise exception 'FAIL: run_overdue_tasks marked nothing';
  end if;
  if (select status::text from public.tasks where id = v_late) <> 'OVERDUE' then
    raise exception 'FAIL: a started job past its due time is not OVERDUE';
  end if;
  if (select status::text from public.tasks where id = v_soon) <> 'TASK_STARTED' then
    raise exception 'FAIL: a job that is not yet due was marked overdue';
  end if;
  if (select status::text from public.tasks where id = v_none) <> 'TASK_STARTED' then
    raise exception 'FAIL: a job with no due time was marked overdue';
  end if;
  if (select status::text from public.tasks where id = v_locked) <> 'LOCKED' then
    raise exception 'FAIL: a job that was never started was marked overdue';
  end if;

  perform public.run_overdue_tasks();
  if (select status::text from public.tasks where id = v_late) <> 'OVERDUE' then
    raise exception 'FAIL: a second run changed an overdue job';
  end if;
end;
$$;

-- ---- 2. push through Inngest ------------------------------------------------
do $$
declare
  v_user    uuid := pg_temp.make_user('Push Tester');
  v_nodev   uuid := pg_temp.make_user('No Device');
  v_note    uuid;
  v_row     record;
  v_msgs    jsonb;
  v_token   text := 'ExponentPushToken[testtesttesttesttest01]';
  v_before  bigint;
begin
  insert into public.push_tokens (token, user_id, platform) values (v_token, v_user, 'android');

  -- Switch off (no row): the old direct send still runs, so no event is queued.
  delete from public.settings where key = 'push_via_inngest';
  select count(*) into v_before from private.outbox where kind = 'notification.created';
  perform private.notify(v_user, 'announcement', 'Secret title 4411', 'Secret body 4411', null);
  if (select count(*) from private.outbox where kind = 'notification.created') <> v_before then
    raise exception 'FAIL: a notification queued an Inngest event while the switch was off';
  end if;

  -- Switch on.
  insert into public.settings (key, value) values ('push_via_inngest', 'true');
  perform private.notify(v_user, 'announcement', 'Secret title 9921', 'Secret body 9921', null);
  select * into v_row from private.outbox
   where kind = 'notification.created' and data->>'user_id' = v_user::text;
  if v_row.id is null then
    raise exception 'FAIL: a notification did not queue notification.created with the switch on';
  end if;
  if v_row.data->>'kind' <> 'announcement' or (v_row.data->>'notification_id') is null then
    raise exception 'FAIL: notification.created is missing its kind or id: %', v_row.data;
  end if;
  if v_row.data::text like '%9921%' or v_row.data ? 'title' or v_row.data ? 'body' then
    raise exception 'FAIL: notification.created carries the notification text: %', v_row.data;
  end if;

  -- Nobody to push to: nothing to send, nothing queued.
  select count(*) into v_before from private.outbox where kind = 'notification.created';
  perform private.notify(v_nodev, 'announcement', 'Nobody home', 'x', null);
  if (select count(*) from private.outbox where kind = 'notification.created') <> v_before then
    raise exception 'FAIL: a person with no registered device queued a push event';
  end if;

  -- The Edge Function can read the message, and forget a dead device.
  v_note := (v_row.data->>'notification_id')::uuid;
  v_msgs := public.push_job_load(v_note);
  if jsonb_array_length(v_msgs) <> 1
     or v_msgs->0->>'to' <> v_token
     or v_msgs->0->>'title' <> 'Secret title 9921' then
    raise exception 'FAIL: push_job_load did not return the one message for the one device: %', v_msgs;
  end if;
  if public.push_job_load(gen_random_uuid()) <> '[]'::jsonb then
    raise exception 'FAIL: push_job_load invented a message for a notification that does not exist';
  end if;
  if public.push_tokens_of(v_user) <> array[v_token] then
    raise exception 'FAIL: push_tokens_of did not list the device';
  end if;
  if public.push_remove_tokens(array[v_token]) <> 1
     or exists (select 1 from public.push_tokens where token = v_token) then
    raise exception 'FAIL: push_remove_tokens did not forget the device';
  end if;
end;
$$;

-- ---- 3. a deleted account's files -------------------------------------------
do $$
declare
  v_gone uuid := pg_temp.make_user('Gone Soon');
  v_live uuid := pg_temp.make_user('Still Here');
begin
  insert into storage.objects (bucket_id, name) values ('task-media', v_gone::text || '/photo.jpg');
  insert into storage.objects (bucket_id, name) values ('task-media', v_live::text || '/photo.jpg');

  if public.deleted_account_files(v_gone) <> '{}' then
    raise exception 'FAIL: files were listed for an account that is not deleted';
  end if;
  if public.deleted_account_files(v_live) <> '{}' then
    raise exception 'FAIL: files were listed for a live account';
  end if;

  update public.profiles set deleted_at = now() where id = v_gone;
  if public.deleted_account_files(v_gone) <> array[v_gone::text || '/photo.jpg'] then
    raise exception 'FAIL: the deleted account''s file was not listed: %', public.deleted_account_files(v_gone);
  end if;
  if public.deleted_account_files(v_live) <> '{}' then
    raise exception 'FAIL: a live account''s files were listed after another account was deleted';
  end if;
end;
$$;

-- ---- 4. housekeeping --------------------------------------------------------
do $$
declare
  v_user uuid := pg_temp.make_user('Tidy Tester');
  v_out  jsonb;
begin
  insert into public.auth_codes (phone, code, expires_at) values
    ('+910000000001', 'x', now() - interval '2 days'),
    ('+910000000002', 'x', now() + interval '5 minutes');
  insert into public.auth_send_log (ip, sends, window_started_at) values
    ('203.0.113.1', 3, now() - interval '2 days'),
    ('203.0.113.2', 3, now());
  insert into public.notifications (user_id, kind, title, created_at) values
    (v_user, 'announcement', 'old news', now() - interval '100 days'),
    (v_user, 'announcement', 'fresh news', now() - interval '2 days');

  v_out := public.run_housekeeping();

  if exists (select 1 from public.auth_codes where phone = '+910000000001') then
    raise exception 'FAIL: an expired sign-in code was kept';
  end if;
  if not exists (select 1 from public.auth_codes where phone = '+910000000002') then
    raise exception 'FAIL: a live sign-in code was removed';
  end if;
  if exists (select 1 from public.auth_send_log where ip = '203.0.113.1')
     or not exists (select 1 from public.auth_send_log where ip = '203.0.113.2') then
    raise exception 'FAIL: the send log was not trimmed to the current window';
  end if;
  if exists (select 1 from public.notifications where user_id = v_user and title = 'old news')
     or not exists (select 1 from public.notifications where user_id = v_user and title = 'fresh news') then
    raise exception 'FAIL: notifications older than 90 days were kept, or a fresh one removed';
  end if;
  if (v_out->>'auth_codes')::int < 1 or (v_out->>'notifications')::int < 1 then
    raise exception 'FAIL: housekeeping did not report what it removed: %', v_out;
  end if;
end;
$$;

-- ---- 5. who may call what ---------------------------------------------------
do $$
declare
  fn       text;
  v_user   uuid := gen_random_uuid();
  v_failed boolean;
begin
  foreach fn in array array[
    'push_job_load', 'push_tokens_of', 'push_remove_tokens', 'deleted_account_files',
    'run_overdue_tasks', 'run_housekeeping'
  ] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = fn) then
      raise exception 'FAIL: public.%() does not exist', fn;
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = fn
                  and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
      raise exception 'FAIL: a signed-in or anonymous caller can execute public.%()', fn;
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = fn
                      and has_function_privilege('service_role', p.oid, 'EXECUTE')) then
      raise exception 'FAIL: the service role cannot execute public.%(), so Inngest cannot work', fn;
    end if;
  end loop;

  -- The belt: even with the grant somehow loosened, an authenticated claim is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform public.run_housekeeping();
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: run_housekeeping ran for an authenticated claim';
  end if;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

rollback;
