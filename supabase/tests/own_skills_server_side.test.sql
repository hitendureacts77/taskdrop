-- Own skills decided on the server only (migration 228).
--
-- 1. No app role can run the check or the add, old or new: the meaning vector and the caller come from the api
--    (service role), and the "same meaning" threshold is one server-side row, private.catalog_settings.
-- 2. Skills written straight into profiles.skills by older app builds are added hidden, never live, and stop
--    being registered past 10 new terms a day for that person; the profile still saves.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/own_skills_server_side.test.sql

begin;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- A unit vector of 384 numbers pointing mostly along `p_axis`, with `p_tilt` along axis 2 (cosine = 1 / |v|).
create or replace function pg_temp.vec(p_axis int, p_tilt real) returns text
language sql as $$
  select '[' || string_agg(case when i = p_axis then (1 / sqrt(1 + p_tilt * p_tilt))::text
                                when i = 2 then (p_tilt / sqrt(1 + p_tilt * p_tilt))::text
                                else '0' end, ',' order by i) || ']'
    from generate_series(1, 384) i;
$$;

do $$
declare
  v_a uuid := gen_random_uuid();
  v_term uuid;
  r jsonb;
  v_err text;
  v_live int;
  v_hidden int;
begin
  -- 1a. Who can run what.
  if has_function_privilege('authenticated', 'public.catalog_check_for(uuid, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.catalog_check_for(uuid, text, text, text)', 'execute') then
    raise exception 'FAIL: an app role can run catalog_check_for';
  end if;
  if has_function_privilege('authenticated', 'public.catalog_add_for(uuid, text, text, text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.catalog_add_for(uuid, text, text, text, boolean)', 'execute') then
    raise exception 'FAIL: an app role can run catalog_add_for';
  end if;
  if not has_function_privilege('service_role', 'public.catalog_add_for(uuid, text, text, text, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.catalog_check_for(uuid, text, text, text)', 'execute') then
    raise exception 'FAIL: the api (service role) cannot run the catalog functions';
  end if;
  if has_function_privilege('authenticated', 'public.catalog_check(text, text, text, real)', 'execute')
     or has_function_privilege('authenticated', 'public.catalog_add(text, text, text, boolean, real)', 'execute') then
    raise exception 'FAIL: the 226 doors that took a vector and threshold from the app are still open';
  end if;
  if has_table_privilege('authenticated', 'private.catalog_settings', 'select')
     or has_table_privilege('authenticated', 'private.catalog_settings', 'update') then
    raise exception 'FAIL: an app role can read or change the threshold';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'skills228+' || v_a || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_a, 'Worker 228')
  on conflict (id) do update set display_name = excluded.display_name;

  -- 1b. Even granted by mistake, a PostgREST caller with an app role claim is refused inside the function.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_err := pg_temp.try(format('select public.catalog_add_for(%L, ''skill'', ''Kite flying 228'')', v_a));
  perform set_config('request.jwt.claims', '', true);
  if v_err is null then raise exception 'FAIL: an authenticated claim got through catalog_add_for'; end if;

  -- 1c. A caller with no profile (or a deleted one) cannot add.
  v_err := pg_temp.try(format('select public.catalog_add_for(%L, ''skill'', ''Kite flying 228'')', gen_random_uuid()));
  if coalesce(v_err, '') not like '%Sign in first%' then raise exception 'FAIL: an unknown user could add: %', v_err; end if;

  -- 1d. The threshold comes from private.catalog_settings. A term along axis 1; text whose vector has cosine
  -- ~0.894 with it (tilt 0.5) is "covered" at 0.88 and "new" at 0.95.
  insert into public.catalog_terms (kind, label, norm_key, source, created_by, embedding)
  values ('skill', 'Zzqv meaning 228', private.catalog_norm('Zzqv meaning 228'), 'user', v_a,
          pg_temp.vec(1, 0)::extensions.vector(384))
  returning id into v_term;
  update private.catalog_settings set min_meaning = 0.88;
  r := public.catalog_check_for(v_a, 'skill', 'Pqxw different words', pg_temp.vec(1, 0.5));
  if r ->> 'result' <> 'covered' or r ->> 'via' <> 'meaning' or (r -> 'term' ->> 'id')::uuid <> v_term then
    raise exception 'FAIL: meaning match at 0.88: %', r;
  end if;
  update private.catalog_settings set min_meaning = 0.95;
  r := public.catalog_check_for(v_a, 'skill', 'Pqxw different words', pg_temp.vec(1, 0.5));
  if r ->> 'result' <> 'new' then raise exception 'FAIL: the settings row did not raise the threshold: %', r; end if;
  if private.catalog_min_meaning() <> 0.95::real then raise exception 'FAIL: catalog_min_meaning does not read the row'; end if;

  -- The add uses the same setting: at 0.95 it is new and gets added, with the api's vector stored.
  r := public.catalog_add_for(v_a, 'skill', 'Pqxw different words', pg_temp.vec(1, 0.5));
  if r ->> 'result' <> 'added' then raise exception 'FAIL: add at 0.95: %', r; end if;
  if (select embedding is null from public.catalog_terms where id = (r -> 'term' ->> 'id')::uuid) then
    raise exception 'FAIL: the api vector was not stored';
  end if;

  -- Out of range is refused by the table.
  if pg_temp.try('update private.catalog_settings set min_meaning = 0.2') is null then
    raise exception 'FAIL: a nonsense threshold was accepted';
  end if;

  -- 2. Older builds: free text goes in hidden, the profile saves, and only 10 a day are registered.
  update public.profiles
     set skills = array['Ytrw old build 01', 'Ytrw old build 02', 'Ytrw old build 03', 'Ytrw old build 04',
                        'Ytrw old build 05', 'Ytrw old build 06', 'Ytrw old build 07', 'Ytrw old build 08',
                        'Ytrw old build 09', 'Ytrw old build 10', 'Ytrw old build 11', 'Ytrw old build 12']
   where id = v_a;
  if cardinality((select skills from public.profiles where id = v_a)) <> 12 then
    raise exception 'FAIL: the profile save was blocked';
  end if;
  select count(*) filter (where status = 'live'), count(*) filter (where status = 'hidden')
    into v_live, v_hidden
    from public.catalog_terms where created_by = v_a and label like 'Ytrw old build %';
  if v_live <> 0 then raise exception 'FAIL: % old-build skills went live', v_live; end if;
  -- v_a already made 2 terms above (the meaning one and the added one), so 8 more fit under 10.
  if v_hidden <> 8 then raise exception 'FAIL: expected 8 hidden old-build skills under the cap, got %', v_hidden; end if;

  raise notice 'own_skills_server_side: all checks passed';
end;
$$;

rollback;
