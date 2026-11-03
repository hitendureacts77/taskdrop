-- Questions on a task and the "near you" counts (migration 140): who may ask,
-- answer and read, the contact check, the limits, the alerts, account deletion,
-- and that nearby_pulse counts only helpers inside the radius.
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/task_questions.test.sql

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

-- Runs a statement as the current person and returns the error text, or null when it worked.
create or replace function pg_temp.fails(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_ravi   uuid := gen_random_uuid();
  v_sana   uuid := gen_random_uuid();
  v_far    uuid := gen_random_uuid();
  v_task   uuid;
  v_q      jsonb;
  v_qid    uuid;
  v_list   jsonb;
  v_pulse  jsonb;
  v_err    text;
  i        integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'questions+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_ravi), (v_sana), (v_far)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Asha Rao'), (v_ravi, 'Ravi Kumar'), (v_sana, 'Sana'), (v_far, 'Far Away')
  on conflict (id) do nothing;
  update public.profiles set display_name = case id
      when v_poster then 'Asha Rao' when v_ravi then 'Ravi Kumar' when v_sana then 'Sana' else 'Far Away' end
   where id in (v_poster, v_ravi, v_sana, v_far);
  insert into public.wallets (user_id) values (v_poster), (v_ravi), (v_sana), (v_far) on conflict (user_id) do nothing;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_poster, 'services', 'Scooty will not start', 90000, 60, 17.4483, 78.3915)
  returning id into v_task;

  -- ---- nobody writes the table directly ------------------------------------
  if has_table_privilege('authenticated', 'public.task_questions', 'INSERT')
     or has_table_privilege('authenticated', 'public.task_questions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.task_questions', 'DELETE')
     or has_table_privilege('anon', 'public.task_questions', 'SELECT') then
    raise exception 'FAIL: task_questions must only change through the functions';
  end if;
  if has_function_privilege('anon', 'public.task_questions_list(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.task_question_ask(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.task_question_answer(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.nearby_pulse(double precision,double precision,double precision)', 'EXECUTE') then
    raise exception 'FAIL: signed-out visitors must not read, ask, answer or count';
  end if;

  -- ---- a call with no person behind it is refused --------------------------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'authenticated', true);
  v_err := pg_temp.fails(format('select public.task_questions_list(%L)', v_task));
  if v_err is distinct from 'Sign in first' then raise exception 'FAIL: no caller should be refused, got %', v_err; end if;

  -- ---- asking -------------------------------------------------------------
  perform pg_temp.become(v_ravi);
  v_q := public.task_question_ask(v_task, '  Which   scooty is it, and which model? ');
  v_qid := (v_q->>'id')::uuid;
  if v_q->>'body' <> 'Which scooty is it, and which model?' or v_q->>'asker' <> 'Ravi' or not (v_q->>'mine')::boolean then
    raise exception 'FAIL: a question should be tidied and shown with a first name, got %', v_q;
  end if;

  foreach v_err in array array[
    format('select public.task_question_ask(%L, %L)', v_task, 'Call me on 98765 43210'),
    format('select public.task_question_ask(%L, %L)', v_task, 'Mail me at ravi@example.com'),
    format('select public.task_question_ask(%L, %L)', v_task, 'See photos at www.example.com'),
    format('select public.task_question_ask(%L, %L)', v_task, 'see my work on ravifix.in')
  ] loop
    if pg_temp.fails(v_err) is null or pg_temp.fails(v_err) not like 'Leave phone numbers%' then
      raise exception 'FAIL: contacts and links must be refused: %', v_err;
    end if;
  end loop;
  if pg_temp.fails(format('select public.task_question_ask(%L, %L)', v_task, 'ok')) is null then
    raise exception 'FAIL: a two-letter question should be refused';
  end if;

  perform public.task_question_ask(v_task, 'Is the battery new?');
  perform public.task_question_ask(v_task, 'Can I come this evening?');
  v_err := pg_temp.fails(format('select public.task_question_ask(%L, %L)', v_task, 'One more thing?'));
  if v_err not like 'That is three questions%' then raise exception 'FAIL: a fourth question should be refused, got %', v_err; end if;

  perform pg_temp.become(v_poster);
  v_err := pg_temp.fails(format('select public.task_question_ask(%L, %L)', v_task, 'Asking myself?'));
  if v_err not like 'This is your own task%' then raise exception 'FAIL: the poster cannot ask on their own task, got %', v_err; end if;

  -- The poster was told about each question.
  perform pg_temp.as_operator();
  if (select count(*) from public.notifications where user_id = v_poster and kind = 'question' and task_id = v_task) <> 3 then
    raise exception 'FAIL: the poster should get one alert per question';
  end if;

  -- ---- answering ------------------------------------------------------------
  perform pg_temp.become(v_sana);
  v_err := pg_temp.fails(format('select public.task_question_answer(%L, %L)', v_qid, 'Activa'));
  if v_err not like 'Only the person who posted%' then raise exception 'FAIL: only the poster may answer, got %', v_err; end if;

  perform pg_temp.become(v_poster);
  v_err := pg_temp.fails(format('select public.task_question_answer(%L, %L)', v_qid, 'Call 9876543210'));
  if v_err not like 'Leave phone numbers%' then raise exception 'FAIL: an answer with a number must be refused, got %', v_err; end if;
  perform public.task_question_answer(v_qid, 'Activa 5G, 2019.');

  perform pg_temp.as_operator();
  if not exists (select 1 from public.notifications where user_id = v_ravi and kind = 'question' and task_id = v_task) then
    raise exception 'FAIL: the asker should be told their question was answered';
  end if;

  -- ---- reading ------------------------------------------------------------
  perform pg_temp.become(v_sana);
  v_list := public.task_questions_list(v_task);
  if jsonb_array_length(v_list) <> 3 or v_list->0->>'answer' <> 'Activa 5G, 2019.' or (v_list->0->>'mine')::boolean then
    raise exception 'FAIL: everyone looking at an open task should see the questions and answers, got %', v_list;
  end if;

  -- Once the task stops taking offers, only the poster (and whoever does the work) still sees them.
  perform pg_temp.as_operator();
  update public.tasks set status = 'CANCELLED' where id = v_task;
  perform pg_temp.become(v_sana);
  if jsonb_array_length(public.task_questions_list(v_task)) <> 0 then
    raise exception 'FAIL: a closed task''s questions should not show to bystanders';
  end if;
  perform pg_temp.become(v_poster);
  if jsonb_array_length(public.task_questions_list(v_task)) <> 3 then
    raise exception 'FAIL: the poster should still see the questions';
  end if;
  perform pg_temp.become(v_sana);
  v_err := pg_temp.fails(format('select public.task_question_ask(%L, %L)', v_task, 'Still open?'));
  if v_err not like 'This task is no longer taking offers%' then raise exception 'FAIL: no questions on a closed task, got %', v_err; end if;

  -- ---- account deletion takes the questions with it -------------------------
  perform pg_temp.as_operator();
  update public.profiles set deleted_at = now() where id = v_ravi;
  if exists (select 1 from public.task_questions where asker_id = v_ravi) then
    raise exception 'FAIL: a deleted account''s questions should go';
  end if;

  -- ---- nearby_pulse --------------------------------------------------------
  update public.profiles
     set onboarded_at = now(), skills = array['repairs'], last_seen_at = now(),
         loc_lat = 17.45, loc_lng = 78.39
   where id = v_sana;
  update public.profiles
     set onboarded_at = now(), skills = array['repairs'], last_seen_at = now(),
         loc_lat = 12.97, loc_lng = 77.59
   where id = v_far;
  perform pg_temp.become(v_poster);
  v_pulse := public.nearby_pulse(17.4483, 78.3915, 5);
  if (v_pulse->>'activeNow')::int < 1 then raise exception 'FAIL: a helper active nearby should be counted, got %', v_pulse; end if;
  if (v_pulse->>'doneToday') is null then raise exception 'FAIL: doneToday should be a number, got %', v_pulse; end if;
  -- Far Away is in Bengaluru and was not counted; moving them next door adds exactly one.
  perform pg_temp.as_operator();
  update public.profiles set loc_lat = 17.449, loc_lng = 78.392 where id = v_far;
  perform pg_temp.become(v_poster);
  if (public.nearby_pulse(17.4483, 78.3915, 5)->>'activeNow')::int <> (v_pulse->>'activeNow')::int + 1 then
    raise exception 'FAIL: a helper outside the radius must not be counted, and one inside must be';
  end if;
  v_err := pg_temp.fails('select public.nearby_pulse(null, 78, 5)');
  if v_err is distinct from 'Pick your area first' then raise exception 'FAIL: a missing area should be refused, got %', v_err; end if;

  raise notice 'task questions ok';
end;
$$;

-- Migration 143: nearby_pulse's two counts can use their partial indexes. Scans
-- of the whole table are switched off for this check only: with a handful of
-- test rows the planner would rightly read the table, which says nothing about
-- a table with a year of history.
do $$
declare
  v_plan text;
  r      record;
begin
  perform pg_temp.as_operator();
  perform set_config('enable_seqscan', 'off', true);
  perform set_config('enable_bitmapscan', 'off', true);

  v_plan := '';
  for r in execute $q$
    explain select count(*) from public.tasks t
     where t.status in ('COMPLETED', 'AUTO_COMPLETED')
       and t.completed_at >= now() - interval '1 day'
  $q$ loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  if v_plan not like '%tasks_completed_at_done_idx%' then
    raise exception 'FAIL: doneToday should use tasks_completed_at_done_idx, plan: %', v_plan;
  end if;

  v_plan := '';
  for r in execute $q$
    explain select count(*) from public.profiles p
     where p.last_seen_at > now() - interval '3 minutes'
       and p.deleted_at is null
  $q$ loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  if v_plan not like '%profiles_last_seen_at_live_idx%' then
    raise exception 'FAIL: activeNow should use profiles_last_seen_at_live_idx, plan: %', v_plan;
  end if;

  perform set_config('enable_seqscan', 'on', true);
  perform set_config('enable_bitmapscan', 'on', true);
  raise notice 'nearby_pulse indexes ok';
end;
$$;

rollback;
