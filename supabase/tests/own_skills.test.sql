-- Own skills and categories (task 1.19 row E, migration 226).
--
-- One ranked list per kind; a worker can add a missing skill, everyone can then pick it, the ranking follows use,
-- "already covered" steers people to an existing term, rude words and contacts are refused, 10 adds a day, and
-- only staff can rename, merge, hide or add phrases.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/own_skills.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
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

create or replace function pg_temp.try(p_sql text) returns text
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
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  r jsonb;
  v_new uuid;
  v_dup uuid;
  v_tutor uuid;
  v_errands_rank int;
  v_new_rank int;
  v_err text;
  i int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'skills+' || u || '@taskdrop.test', '', now(), now(), now()
    from unnest(array[v_a, v_b, v_staff]) u;
  insert into public.profiles (id, display_name)
  values (v_a, 'Worker A'), (v_b, 'Worker B'), (v_staff, 'Staff')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_staff, 'admin') on conflict do nothing;

  -- Keys: capitals, "&", "and" and plurals are one key.
  if private.catalog_norm('Repairs & Maintenance') <> private.catalog_norm('repair and maintenance') then
    raise exception 'FAIL: norm keys differ for the same name';
  end if;

  -- Signed out: no door.
  if has_function_privilege('anon', 'public.catalog_list(text)', 'execute') then
    raise exception 'FAIL: signed-out role can read the list';
  end if;
  if has_function_privilege('authenticated', 'public.catalog_set_embedding(uuid, text)', 'execute') then
    raise exception 'FAIL: a signed-in user can set meaning vectors';
  end if;
  if pg_temp.try('select 1 from public.catalog_terms') is null then
    perform pg_temp.become(v_a);
    if pg_temp.try('select 1 from public.catalog_terms') is null then
      raise exception 'FAIL: the table is readable directly';
    end if;
    perform pg_temp.as_owner();
  end if;

  perform pg_temp.become(v_a);

  -- The list has the built-ins.
  r := public.catalog_list('skill');
  if not exists (select 1 from jsonb_array_elements(r) e where e ->> 'label' = 'Tutoring') then
    raise exception 'FAIL: built-in Tutoring missing from the list';
  end if;

  -- Same name in other capitals: exact.
  r := public.catalog_check('skill', 'tutoring');
  if r ->> 'result' <> 'exact' or r -> 'term' ->> 'label' <> 'Tutoring' then raise exception 'FAIL: exact match: %', r; end if;

  -- A phrase: covered, and no way round it.
  r := public.catalog_check('skill', 'Teaching maths');
  if r ->> 'result' <> 'covered' or r ->> 'via' <> 'phrase' or r -> 'term' ->> 'label' <> 'Tutoring' then
    raise exception 'FAIL: teaching maths not covered by Tutoring: %', r;
  end if;
  r := public.catalog_add('skill', 'Teaching maths', null, true);
  if r ->> 'result' <> 'covered' then raise exception 'FAIL: force got round a phrase: %', r; end if;

  -- Refusals.
  if public.catalog_check('skill', 'Call 9876543210') ->> 'reason' <> 'contact' then raise exception 'FAIL: phone not refused'; end if;
  if public.catalog_check('skill', 'me@x.com work') ->> 'reason' <> 'contact' then raise exception 'FAIL: email not refused'; end if;
  if public.catalog_check('skill', 'chutiya work') ->> 'reason' <> 'rude' then raise exception 'FAIL: rude word not refused'; end if;
  if public.catalog_check('skill', 'x') ->> 'reason' <> 'length' then raise exception 'FAIL: too short not refused'; end if;
  if public.catalog_check('skill', 'Ethical hacking') ->> 'result' = 'refused' then raise exception 'FAIL: a real skill was refused'; end if;

  -- A spelling slip is caught, a longer different skill is not.
  r := public.catalog_check('skill', 'Tutorng');
  if r ->> 'via' <> 'spelling' then raise exception 'FAIL: spelling slip not caught: %', r; end if;
  r := public.catalog_check('skill', 'Aquarium cleaning');
  if r ->> 'result' <> 'new' then raise exception 'FAIL: aquarium cleaning should be new: %', r; end if;

  -- Worker A adds it.
  r := public.catalog_add('skill', 'aquarium cleaning');
  if r ->> 'result' <> 'added' or r -> 'term' ->> 'label' <> 'Aquarium cleaning' then raise exception 'FAIL: add: %', r; end if;
  v_new := (r -> 'term' ->> 'id')::uuid;
  perform pg_temp.as_owner();
  update public.profiles set skills = array['Repairs', 'Aquarium cleaning'] where id = v_a;

  -- Worker B sees it and picks it; the same name typed again is the same skill.
  perform pg_temp.become(v_b);
  r := public.catalog_check('skill', 'Aquarium Cleanings');
  if r ->> 'result' <> 'exact' or (r -> 'term' ->> 'id')::uuid <> v_new then raise exception 'FAIL: B did not find it: %', r; end if;
  perform pg_temp.as_owner();
  update public.profiles set skills = array['Aquarium cleaning'] where id = v_b;
  perform pg_temp.become(v_b);
  r := public.catalog_list('skill');
  if (select (e ->> 'uses')::int from jsonb_array_elements(r) e where e ->> 'id' = v_new::text) <> 2 then
    raise exception 'FAIL: two workers should count: %', (select e from jsonb_array_elements(r) e where e ->> 'id' = v_new::text);
  end if;

  -- Ranking follows use: give it more workers than Errands and it moves above Errands.
  perform pg_temp.as_owner();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'skills+' || u || '@taskdrop.test', '', now(), now(), now()
    from (select gen_random_uuid() u from generate_series(1, 60)) g;
  insert into public.profiles (id, display_name, skills)
  select u.id, 'Fan', array['Aquarium cleaning']
    from auth.users u where u.email like 'skills+%@taskdrop.test' and u.id not in (v_a, v_b, v_staff)
  on conflict (id) do update set skills = excluded.skills;
  perform pg_temp.become(v_a);
  r := public.catalog_list('skill');
  select o into v_errands_rank from jsonb_array_elements(r) with ordinality as x (e, o) where e ->> 'label' = 'Errands';
  select o into v_new_rank from jsonb_array_elements(r) with ordinality as x (e, o) where e ->> 'id' = v_new::text;
  if v_new_rank > v_errands_rank then
    raise exception 'FAIL: a more used skill did not climb (new %, errands %)', v_new_rank, v_errands_rank;
  end if;

  -- An older app build saving free text registers it.
  perform pg_temp.as_owner();
  update public.profiles set skills = array['Saree draping'] where id = v_b;
  if not exists (select 1 from public.catalog_terms where kind = 'skill' and norm_key = private.catalog_norm('Saree draping') and source = 'user') then
    raise exception 'FAIL: free text from an old build was not registered';
  end if;

  -- 10 adds a day.
  perform pg_temp.become(v_a);
  for i in 1..9 loop
    r := public.catalog_add('skill', 'Zqx skill ' || chr(96 + i) || chr(96 + i) || chr(100 + i), null, true);
  end loop;
  v_err := pg_temp.try('select public.catalog_add(''skill'', ''Twelfth odd skill'')');
  if coalesce(v_err, '') not like '%catalog_daily_limit%' then raise exception 'FAIL: daily cap not enforced: %', v_err; end if;

  -- Only staff can tidy up.
  v_err := pg_temp.try(format('select public.admin_catalog_set_hidden(%L, true)', v_new));
  if v_err is null then raise exception 'FAIL: a worker could hide a skill'; end if;

  perform pg_temp.become(v_staff);
  r := public.admin_catalog_list('skill');
  if not exists (select 1 from jsonb_array_elements(r) e where e ->> 'id' = v_new::text and e ->> 'created_by_name' = 'Worker A') then
    raise exception 'FAIL: admin list misses the new skill or who added it';
  end if;

  -- Merge a duplicate into Tutoring: profiles move over and the old name now points at Tutoring.
  perform pg_temp.become(v_b);
  r := public.catalog_add('skill', 'Maths classes zz', null, true);
  v_dup := (r -> 'term' ->> 'id')::uuid;
  perform pg_temp.as_owner();
  v_dup := coalesce(v_dup, (select id from public.catalog_terms where norm_key = private.catalog_norm('Maths classes zz')));
  update public.profiles set skills = array['Maths classes zz', 'Tutoring'] where id = v_a;
  select id into v_tutor from public.catalog_terms where kind = 'skill' and norm_key = 'tutoring';
  perform pg_temp.become(v_staff);
  perform public.admin_catalog_merge(v_dup, v_tutor);
  perform pg_temp.as_owner();
  if (select skills from public.profiles where id = v_a) <> array['Tutoring'] then
    raise exception 'FAIL: merge did not rewrite and de-duplicate skills: %', (select skills from public.profiles where id = v_a);
  end if;
  perform pg_temp.become(v_b);
  r := public.catalog_check('skill', 'maths classes zz');
  if r ->> 'result' <> 'covered' or (r -> 'term' ->> 'id')::uuid <> v_tutor then raise exception 'FAIL: merged name does not point at Tutoring: %', r; end if;

  -- Hide, rename, phrase.
  perform pg_temp.become(v_staff);
  perform public.admin_catalog_add_phrase(v_new, 'fish tank cleaning');
  perform pg_temp.become(v_b);
  if public.catalog_check('skill', 'Fish tank cleaning') ->> 'via' <> 'phrase' then raise exception 'FAIL: admin phrase not used'; end if;
  perform pg_temp.become(v_staff);
  perform public.admin_catalog_rename(v_new, 'Aquarium care');
  perform pg_temp.as_owner();
  if not exists (select 1 from public.profiles where 'Aquarium care' = any(skills) and display_name = 'Fan') then
    raise exception 'FAIL: rename did not reach profiles';
  end if;
  perform pg_temp.become(v_staff);
  perform public.admin_catalog_set_hidden(v_new, true);
  perform pg_temp.become(v_b);
  if exists (select 1 from jsonb_array_elements(public.catalog_list('skill')) e where e ->> 'id' = v_new::text) then
    raise exception 'FAIL: a hidden skill is still listed';
  end if;
  if public.catalog_check('skill', 'Aquarium care') ->> 'reason' <> 'hidden' then raise exception 'FAIL: hidden name can be picked'; end if;

  -- Categories: a new one is shared and counted by tasks.
  r := public.catalog_check('category', 'Fan not working');
  if r -> 'term' ->> 'label' <> 'Repairs & Maintenance' then raise exception 'FAIL: category phrase: %', r; end if;
  r := public.catalog_add('category', 'Pet care');
  if r ->> 'result' not in ('added', 'exact') then raise exception 'FAIL: category add: %', r; end if;

  perform pg_temp.as_owner();
  raise notice 'own_skills: all checks passed';
end;
$$;

rollback;
