-- Migrations 190 + 191: task text and video checks, and my_thread_latest. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/task_limits.test.sql

begin;

do $$
begin
  -- 190: each check exists (it is added only when the live rows were clean, which the test db is).
  if not exists (select 1 from pg_constraint where conname = 'tasks_title_length' and conrelid = 'public.tasks'::regclass) then
    raise exception 'FAIL 1: tasks_title_length is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_description_length' and conrelid = 'public.tasks'::regclass) then
    raise exception 'FAIL 2: tasks_description_length is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_media_seconds_range' and conrelid = 'public.tasks'::regclass) then
    raise exception 'FAIL 3: tasks_media_seconds_range is missing';
  end if;

  -- 191: only signed-in callers may run my_thread_latest.
  if has_function_privilege('anon', 'public.my_thread_latest(int)', 'execute') then
    raise exception 'FAIL 4: anon can run my_thread_latest';
  end if;
  if not has_function_privilege('authenticated', 'public.my_thread_latest(int)', 'execute') then
    raise exception 'FAIL 5: authenticated cannot run my_thread_latest';
  end if;

  -- 191: it returns nothing for a caller with no conversations.
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from public.my_thread_latest(10)) then
    raise exception 'FAIL 6: a stranger sees someone else''s messages';
  end if;
end $$;

rollback;
