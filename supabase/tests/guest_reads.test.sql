-- What a guest (someone with no account yet) may read, migration 151: questions
-- on an open task, the Ideas board, the nearby pulse and a helper's shared
-- before-and-after photos, plus which of those pictures may be signed.
--
-- The guest functions are only for the service role (the api function calls
-- them for guests), so the reads below run as the operator.
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/guest_reads.test.sql

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
  v_poster  uuid := gen_random_uuid();
  v_ravi    uuid := gen_random_uuid();
  v_helper  uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_task    uuid;
  v_done    uuid;
  v_qid     uuid;
  v_idea    uuid;
  v_list    jsonb;
  v_got     jsonb;
  v_pulse   jsonb;
  v_err     text;
  v_fn      text;
  v_signed  text[];
begin
  -- ---- only the service role may call them ----------------------------------
  foreach v_fn in array array[
    'public.guest_task_questions(uuid)',
    'public.guest_feedback_board_list(text,text,text,text,integer,integer)',
    'public.guest_feedback_board_get(uuid)',
    'public.guest_nearby_pulse(double precision,double precision,double precision)',
    'public.guest_proof_photos(uuid)',
    'public.guest_public_media(text[])'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'FAIL: % must not be callable with the public key or a sign-in', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'FAIL: the api (service role) must be able to call %', v_fn;
    end if;
  end loop;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'guestreads+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_ravi), (v_helper), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Asha Rao'), (v_ravi, 'Ravi Kumar'), (v_helper, 'Hari Prasad'), (v_other, 'Someone Else')
  on conflict (id) do nothing;
  update public.profiles set display_name = case id
      when v_poster then 'Asha Rao' when v_ravi then 'Ravi Kumar'
      when v_helper then 'Hari Prasad' else 'Someone Else' end
   where id in (v_poster, v_ravi, v_helper, v_other);
  insert into public.wallets (user_id) values (v_poster), (v_ravi), (v_helper), (v_other) on conflict (user_id) do nothing;

  -- ---- questions on an open task ---------------------------------------------
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_poster, 'services', 'Fix a leaking tap', 50000, 60, 17.4483, 78.3915)
  returning id into v_task;

  perform pg_temp.become(v_ravi);
  v_qid := (public.task_question_ask(v_task, 'Is it the kitchen tap?') ->> 'id')::uuid;
  perform public.task_question_ask(v_task, 'Do you have the spare washer?');
  perform pg_temp.become(v_poster);
  perform public.task_question_answer(v_qid, 'Yes, the kitchen one.');

  perform pg_temp.as_operator();
  update public.task_questions set hidden_at = now()
   where task_id = v_task and body = 'Do you have the spare washer?';

  v_list := public.guest_task_questions(v_task);
  if jsonb_array_length(v_list) <> 1 then
    raise exception 'FAIL: a guest should see the one visible question, got %', v_list;
  end if;
  if v_list->0->>'answer' <> 'Yes, the kitchen one.' or v_list->0->>'asker' <> 'Ravi'
     or (v_list->0->>'mine')::boolean then
    raise exception 'FAIL: a guest sees the answer and a first name, never "mine", got %', v_list;
  end if;
  if v_list->0 ? 'askerId' or v_list::text like '%' || v_ravi::text || '%' then
    raise exception 'FAIL: a guest must not see who asked by id, got %', v_list;
  end if;
  if public.guest_task_questions(gen_random_uuid()) <> '[]'::jsonb then
    raise exception 'FAIL: an unknown task should answer an empty list';
  end if;

  update public.tasks set status = 'CANCELLED' where id = v_task;
  if public.guest_task_questions(v_task) <> '[]'::jsonb then
    raise exception 'FAIL: a closed task''s questions must not show to a guest';
  end if;
  update public.tasks set status = 'OPEN', due_at = now() - interval '1 minute' where id = v_task;
  if public.guest_task_questions(v_task) <> '[]'::jsonb then
    raise exception 'FAIL: a past-due task''s questions must not show to a guest';
  end if;

  -- ---- the Ideas board -------------------------------------------------------
  perform pg_temp.become(v_ravi);
  v_idea := (public.feedback_board_post('Guests should see the board', 'So people can look first.', 'feature') ->> 'id')::uuid;
  perform pg_temp.become(v_poster);
  perform public.feedback_board_comment(v_idea, 'Agreed, good idea');

  perform pg_temp.as_operator();
  v_list := public.guest_feedback_board_list('new', null, null, null, 50, 0);
  select x into v_got from jsonb_array_elements(v_list) x where (x->>'id')::uuid = v_idea;
  if v_got is null then raise exception 'FAIL: a guest should see the idea on the board, got %', v_list; end if;
  if (v_got->>'mine')::boolean or (v_got->>'iVoted')::boolean or v_got->>'author' <> 'Ravi' then
    raise exception 'FAIL: for a guest an idea is never mine or voted, and shows a first name, got %', v_got;
  end if;
  if jsonb_array_length(public.guest_feedback_board_list('new', null, null, 'see the board', 50, 0)) < 1 then
    raise exception 'FAIL: a guest''s search should find the idea';
  end if;
  if jsonb_array_length(public.guest_feedback_board_list('top', null, 'bug', null, 50, 0)) <> 0
     and exists (select 1 from jsonb_array_elements(public.guest_feedback_board_list('top', null, 'bug', null, 50, 0)) x
                  where (x->>'id')::uuid = v_idea) then
    raise exception 'FAIL: the category filter should leave out a feature idea';
  end if;
  v_err := pg_temp.fails('select public.guest_feedback_board_list(''loud'')');
  if v_err is distinct from 'Sort by top or new' then raise exception 'FAIL: a bad sort should be refused, got %', v_err; end if;

  v_got := public.guest_feedback_board_get(v_idea);
  if (v_got->'post'->>'mine')::boolean or jsonb_array_length(v_got->'comments') <> 1
     or (v_got->'comments'->0->>'mine')::boolean or v_got->'comments'->0->>'author' <> 'Asha' then
    raise exception 'FAIL: a guest should see the idea and its comment, none of it "mine", got %', v_got;
  end if;

  update public.feedback_posts set hidden_at = now() where id = v_idea;
  if public.guest_feedback_board_get(v_idea) is not null then
    raise exception 'FAIL: a hidden idea must not open for a guest';
  end if;
  if exists (select 1 from jsonb_array_elements(public.guest_feedback_board_list('new', null, null, null, 50, 0)) x
              where (x->>'id')::uuid = v_idea) then
    raise exception 'FAIL: a hidden idea must not be listed for a guest';
  end if;

  -- An idea whose author has gone (author_id set null) is not "mine" for a guest either.
  insert into public.feedback_posts (author_id, title, body, category)
  values (null, 'An idea from an account that was deleted', '', 'other')
  returning id into v_idea;
  select x into v_got from jsonb_array_elements(public.guest_feedback_board_list('new', null, null, 'account that was deleted', 50, 0)) x
   where (x->>'id')::uuid = v_idea;
  if v_got is null or (v_got->>'mine')::boolean or (public.guest_feedback_board_get(v_idea)->'post'->>'mine')::boolean then
    raise exception 'FAIL: an idea with no author must not be "mine" for a guest, got %', v_got;
  end if;

  -- ---- the nearby pulse ------------------------------------------------------
  update public.profiles
     set onboarded_at = now(), skills = array['repairs'], last_seen_at = now(), loc_lat = 17.45, loc_lng = 78.39
   where id = v_helper;
  v_pulse := public.guest_nearby_pulse(17.4483, 78.3915, 5);
  if (v_pulse->>'activeNow')::int < 1 or v_pulse->>'doneToday' is null then
    raise exception 'FAIL: a guest should get both counts, with the nearby helper counted, got %', v_pulse;
  end if;
  if (select count(*) from jsonb_object_keys(v_pulse)) <> 2 then
    raise exception 'FAIL: the pulse must carry the two counts and nothing else, got %', v_pulse;
  end if;
  update public.profiles set loc_lat = 12.97, loc_lng = 77.59 where id = v_helper;
  if (public.guest_nearby_pulse(17.4483, 78.3915, 5)->>'activeNow')::int <> (v_pulse->>'activeNow')::int - 1 then
    raise exception 'FAIL: a helper outside the radius must not be counted';
  end if;
  v_err := pg_temp.fails('select public.guest_nearby_pulse(null, 78, 5)');
  if v_err is distinct from 'Pick your area first' then raise exception 'FAIL: a missing area should be refused, got %', v_err; end if;

  -- ---- before-and-after photos ----------------------------------------------
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_poster, 'services', 'Paint the gate', 80000, 120, 17.4483, 78.3915)
  returning id into v_done;
  update public.tasks
     set status = 'COMPLETED', completed_at = now(), want_photos = true, photos_public = true
   where id = v_done;
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_done, v_helper, 'Painted the gate in two coats',
          jsonb_build_array(
            jsonb_build_object('path', v_helper || '/before.jpg', 'label', 'before'),
            jsonb_build_object('path', v_helper || '/after.jpg', 'label', 'after'),
            jsonb_build_object('path', v_helper || '/invoice.pdf'),
            jsonb_build_object('path', v_other || '/borrowed.jpg', 'label', 'after'),
            jsonb_build_object('path', v_helper || '/../' || v_other || '/sneaky.jpg', 'label', 'after')));

  if (select count(*) from public.guest_proof_photos(v_helper)) <> 1 then
    raise exception 'FAIL: a guest should see the one shared job';
  end if;
  if (select jsonb_array_length(files) from public.guest_proof_photos(v_helper)) <> 2 then
    raise exception 'FAIL: only the helper''s own before and after photos should be listed, got %',
      (select files from public.guest_proof_photos(v_helper));
  end if;

  v_signed := public.guest_public_media(array[
    v_helper || '/before.jpg', v_helper || '/after.jpg', v_helper || '/invoice.pdf',
    v_other || '/borrowed.jpg', v_helper || '/../' || v_other || '/sneaky.jpg', v_helper || '/never-shared.jpg']);
  if v_signed is distinct from array[v_helper || '/after.jpg', v_helper || '/before.jpg']
     and not (v_signed @> array[v_helper || '/after.jpg', v_helper || '/before.jpg'] and cardinality(v_signed) = 2) then
    raise exception 'FAIL: only the two shared photos may be signed for a guest, got %', v_signed;
  end if;

  -- The customer did not agree to share: nothing shows and nothing is signed.
  update public.tasks set photos_public = false where id = v_done;
  if exists (select 1 from public.guest_proof_photos(v_helper)) then
    raise exception 'FAIL: photos the customer did not share must not show to a guest';
  end if;
  if cardinality(public.guest_public_media(array[v_helper || '/after.jpg'])) <> 0 then
    raise exception 'FAIL: photos the customer did not share must not be signed for a guest';
  end if;

  -- A job that is not finished shares nothing either.
  update public.tasks set photos_public = true, status = 'TASK_STARTED' where id = v_done;
  if exists (select 1 from public.guest_proof_photos(v_helper))
     or cardinality(public.guest_public_media(array[v_helper || '/after.jpg'])) <> 0 then
    raise exception 'FAIL: an unfinished job''s photos must not show to a guest';
  end if;

  raise notice 'guest reads ok';
end;
$$;

rollback;

-- B34, migration 162: the guest distance reads take a box, applied before the
-- cap, so newer posts and more recently seen helpers far away cannot crowd out
-- the ones nearby. The 146 functions still answer calls of the old shape.

begin;

do $$
declare
  v_near    uuid := gen_random_uuid();
  v_far1    uuid := gen_random_uuid();
  v_far2    uuid := gen_random_uuid();
  v_task    uuid;
  v_far_a   uuid;
  v_far_b   uuid;
  v_fn      text;
  v_ids     uuid[];
begin
  foreach v_fn in array array[
    'public.guest_open_posts_near(text,integer,text,text,bigint,bigint,text,boolean,uuid,uuid[],double precision,double precision,double precision,double precision)',
    'public.guest_helpers_near(integer,double precision,double precision,double precision,double precision)'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'FAIL: % must not be callable with the public key or a sign-in', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'FAIL: the api (service role) must be able to call %', v_fn;
    end if;
  end loop;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'guestnear+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_near), (v_far1), (v_far2)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_near, 'Near Helper'), (v_far1, 'Far One'), (v_far2, 'Far Two')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_near), (v_far1), (v_far2) on conflict (user_id) do nothing;

  -- One older post in Kondapur, two newer ones in Mumbai.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_near, 'services', 'Near post for the box test', 50000, 60, 17.4601, 78.3601)
  returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_far1, 'services', 'Far post one for the box test', 50000, 60, 19.07, 72.87)
  returning id into v_far_a;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_far2, 'services', 'Far post two for the box test', 50000, 60, 19.07, 72.87)
  returning id into v_far_b;
  update public.tasks set created_at = now() - interval '30 days' where id = v_task;

  -- Without a box the newest come first: a cap of 2 leaves the near post out.
  select array_agg((x->>'id')::uuid) into v_ids
    from public.guest_open_posts(p_kind => null, p_limit => 2, p_ids => array[v_task, v_far_a, v_far_b]) x;
  if v_task = any(v_ids) then
    raise exception 'FAIL: the old read should still be newest first and capped, got %', v_ids;
  end if;

  -- With a box around Kondapur the near post comes back even with a cap of 1.
  select array_agg((x->>'id')::uuid) into v_ids
    from public.guest_open_posts_near(p_kind => null, p_limit => 1, p_ids => array[v_task, v_far_a, v_far_b],
                                      p_min_lat => 17.39, p_max_lat => 17.49, p_min_lng => 78.30, p_max_lng => 78.40) x;
  if v_ids is distinct from array[v_task] then
    raise exception 'FAIL: the boxed read should answer the near post, got %', v_ids;
  end if;

  -- Null longitude bounds (a box that would wrap) still narrow by latitude.
  select array_agg((x->>'id')::uuid) into v_ids
    from public.guest_open_posts_near(p_kind => null, p_limit => 10, p_ids => array[v_task, v_far_a, v_far_b],
                                      p_min_lat => 17.39, p_max_lat => 17.49) x;
  if v_ids is distinct from array[v_task] then
    raise exception 'FAIL: latitude bounds alone should leave the far posts out, got %', v_ids;
  end if;

  -- A guest still never sees a hidden-money column or an exact spot through the new read.
  if exists (select 1 from public.guest_open_posts_near(p_ids => array[v_task], p_kind => null,
                                                        p_min_lat => 17.39, p_max_lat => 17.49) x
              where x ? 'locked_bid_id' or (x->>'loc_lat')::float8 <> 17.46) then
    raise exception 'FAIL: the boxed read must keep 146''s columns and two-decimal places';
  end if;

  -- Helpers: the near one was seen long ago, the far ones just now.
  update public.profiles set onboarded_at = now(), skills = array['repairs'], loc_lat = 17.4601, loc_lng = 78.3601,
                             last_seen_at = now() - interval '30 days'
   where id = v_near;
  update public.profiles set onboarded_at = now(), skills = array['repairs'], loc_lat = 19.07, loc_lng = 72.87,
                             last_seen_at = now()
   where id in (v_far1, v_far2);
  select array_agg((x->>'id')::uuid) into v_ids
    from public.guest_helpers_near(p_limit => 300, p_min_lat => 17.455, p_max_lat => 17.465,
                                   p_min_lng => 78.355, p_max_lng => 78.365) x;
  if not (v_near = any(coalesce(v_ids, '{}'))) or v_far1 = any(coalesce(v_ids, '{}')) or v_far2 = any(coalesce(v_ids, '{}')) then
    raise exception 'FAIL: the boxed helpers read should answer the near helper only, got %', v_ids;
  end if;
  if not exists (select 1 from public.guest_helpers(p_limit => 300) x where (x->>'id')::uuid = v_far1) then
    raise exception 'FAIL: the old helpers read should still answer calls of the old shape';
  end if;

  raise notice 'guest reads near ok';
end;
$$;

rollback;
