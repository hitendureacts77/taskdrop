-- Kept copies of the same-for-everyone lists (migration 149, plan task 3.5b layer C).
--
--   1. The table is closed: row rules on, no policies, no grants; the refresh and the
--      live helpers cannot be called by anon or authenticated; the Inngest door is
--      service role only. platform_stats can never be kept.
--   2. get_app_controls() carries the three public_cache_* fields and follows the row.
--   3. With the switch on and a fresh copy, the three lists give exactly what the live
--      query gives (same rows, same order, same types), cut to p_limit.
--   4. The kept copy is used only when the switch is on AND the copy is under 30
--      minutes old; switch off, a stale copy, a missing row or a value other than true
--      all give the live answer.
--
-- Everything runs inside one transaction that is rolled back, so the test leaves no
-- rows behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/public_snapshots.test.sql

begin;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- null when the statement ran; otherwise the error message.
create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- Set the whole public_cache value (the row may have been changed or removed).
create or replace function pg_temp.set_cache(p_value jsonb) returns void
language sql as $$
  insert into public.settings (key, value) values ('public_cache', p_value)
  on conflict (key) do update set value = excluded.value;
$$;

-- The three lists as jsonb, in the order they came back.
create or replace function pg_temp.trending(p_limit integer) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(to_jsonb(x) - 'ordinality' order by x.ordinality), '[]'::jsonb)
    from public.trending_categories(p_limit) with ordinality x
$$;
create or replace function pg_temp.trending_live(p_limit integer) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(to_jsonb(x) - 'ordinality' order by x.ordinality), '[]'::jsonb)
    from private.trending_categories_live(p_limit) with ordinality x
$$;
create or replace function pg_temp.earners(p_kind text, p_limit integer) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(to_jsonb(x) - 'ordinality' order by x.ordinality), '[]'::jsonb)
    from public.top_earners(p_kind, p_limit) with ordinality x
$$;
create or replace function pg_temp.earners_live(p_kind text, p_limit integer) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(to_jsonb(x) - 'ordinality' order by x.ordinality), '[]'::jsonb)
    from private.top_earners_live(p_kind, p_limit) with ordinality x
$$;

-- ---- 1. the table and the refresh are closed -------------------------------
do $$
declare
  v_role text;
  v_fn   text;
begin
  assert (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'private' and c.relname = 'public_snapshots'),
    'FAIL: row rules are not on for private.public_snapshots';
  assert not exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'public_snapshots'),
    'FAIL: private.public_snapshots has a policy; it must have none';

  foreach v_role in array array['anon', 'authenticated'] loop
    assert not has_table_privilege(v_role, 'private.public_snapshots', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'),
      format('FAIL: %s holds a privilege on private.public_snapshots', v_role);
    foreach v_fn in array array[
      'public.refresh_public_snapshots()', 'private.refresh_public_snapshots()',
      'private.platform_highlights_live()', 'private.trending_categories_live(integer)',
      'private.top_earners_live(text, integer)', 'private.public_cache_on(text)'
    ] loop
      assert not has_function_privilege(v_role, v_fn, 'EXECUTE'),
        format('FAIL: %s can execute %s', v_role, v_fn);
    end loop;
  end loop;

  assert has_function_privilege('service_role', 'public.refresh_public_snapshots()', 'EXECUTE'),
    'FAIL: the service role (Inngest) cannot run public.refresh_public_snapshots()';
  assert not has_table_privilege('service_role', 'private.public_snapshots', 'SELECT, INSERT, UPDATE, DELETE'),
    'FAIL: the service role reads the table directly; it must go through the functions';

  -- Unchanged grants on the three lists: signed-in people yes, anon no (as in 048 / 050).
  assert has_function_privilege('authenticated', 'public.trending_categories(integer)', 'EXECUTE'), 'FAIL: trending lost its grant';
  assert has_function_privilege('authenticated', 'public.top_earners(text, integer)', 'EXECUTE'), 'FAIL: top_earners lost its grant';
  assert has_function_privilege('authenticated', 'public.platform_highlights()', 'EXECUTE'), 'FAIL: highlights lost its grant';
  assert not has_function_privilege('anon', 'public.trending_categories(integer)', 'EXECUTE'), 'FAIL: anon can call trending';
  assert not has_function_privilege('anon', 'public.top_earners(text, integer)', 'EXECUTE'), 'FAIL: anon can call top_earners';
  assert not has_function_privilege('anon', 'public.platform_highlights()', 'EXECUTE'), 'FAIL: anon can call highlights';

  -- platform_stats (admin-only, money totals) can never be kept.
  assert pg_temp.try($q$insert into private.public_snapshots (key, body) values ('platform_stats', '{}')$q$) is not null,
    'FAIL: a platform_stats copy could be saved';
end;
$$;

-- Actually try it as each role, not only through the catalog.
do $$
declare
  v_role text;
  v_err  text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'role', v_role)::text, true);
    perform set_config('role', v_role, true);

    v_err := pg_temp.try('select * from private.public_snapshots');
    assert v_err is not null, format('FAIL: %s could read the kept copies', v_role);
    v_err := pg_temp.try($q$insert into private.public_snapshots (key, body) values ('trending', '[]')$q$);
    assert v_err is not null, format('FAIL: %s could write a kept copy', v_role);
    v_err := pg_temp.try('select public.refresh_public_snapshots()');
    assert v_err is not null, format('FAIL: %s could run the refresh', v_role);
    v_err := pg_temp.try('select private.refresh_public_snapshots()');
    assert v_err is not null, format('FAIL: %s could run the private refresh', v_role);

    perform pg_temp.as_owner();
  end loop;
end;
$$;

-- ---- 2. the switch and get_app_controls ------------------------------------
do $$
declare
  v_cfg jsonb;
begin
  v_cfg := public.get_app_controls('web', '1.1.0');
  assert jsonb_typeof(v_cfg -> 'public_cache_app') = 'boolean', 'FAIL: public_cache_app missing';
  assert jsonb_typeof(v_cfg -> 'public_cache_snapshots') = 'boolean', 'FAIL: public_cache_snapshots missing';
  assert jsonb_typeof(v_cfg -> 'public_cache_memo') = 'boolean', 'FAIL: public_cache_memo missing';
  -- The old fields are still there.
  assert v_cfg ? 'environment' and v_cfg ? 'posting' and v_cfg ? 'banner_link', 'FAIL: an old get_app_controls field went missing';

  perform pg_temp.set_cache('{"app": true, "snapshots": false, "memo": true}');
  v_cfg := public.get_app_controls(null, null);
  assert (v_cfg ->> 'public_cache_app')::boolean, 'FAIL: app part not shown as on';
  assert not (v_cfg ->> 'public_cache_snapshots')::boolean, 'FAIL: snapshots part not shown as off';
  assert (v_cfg ->> 'public_cache_memo')::boolean, 'FAIL: memo part not shown as on';

  -- Anything other than JSON true is off; a missing row is off.
  perform pg_temp.set_cache('{"app": "true", "snapshots": 1, "memo": "yes"}');
  v_cfg := public.get_app_controls(null, null);
  assert not (v_cfg ->> 'public_cache_app')::boolean
     and not (v_cfg ->> 'public_cache_snapshots')::boolean
     and not (v_cfg ->> 'public_cache_memo')::boolean, 'FAIL: a non-boolean value counted as on';
  perform pg_temp.set_cache('true');
  assert not private.public_cache_on('snapshots'), 'FAIL: a non-object value counted as on';
  delete from public.settings where key = 'public_cache';
  v_cfg := public.get_app_controls(null, null);
  assert not (v_cfg ->> 'public_cache_snapshots')::boolean, 'FAIL: a missing row counted as on';
end;
$$;

-- ---- 3. same rows, same order, same types ----------------------------------
do $$
declare
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_res    jsonb;
  v_kind   text;
  v_lim    integer;
  v_body   jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'snap+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Snap Poster'), (v_worker, 'Snap Worker')
  on conflict (id) do nothing;
  update public.profiles
     set onboarded_at = now(), worker_rating_avg = 4.75, worker_rating_count = 4, last_seen_at = now()
   where id = v_worker;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category)
  values (v_poster, 'services', 'snap task 1', 12345, 60, 'Snap test category'),
         (v_poster, 'services', 'snap task 2', 54321, 60, 'Snap test category');

  v_res := public.refresh_public_snapshots();
  assert not (v_res ->> 'skipped')::boolean, 'FAIL: the refresh skipped';
  assert (select count(*) from private.public_snapshots) = 5, 'FAIL: the refresh did not save five copies';
  assert (select bool_and(refreshed_at = now() and took_ms >= 0) from private.public_snapshots),
    'FAIL: refreshed_at / took_ms not set';
  -- A second run updates the rows, it does not add any.
  perform private.refresh_public_snapshots();
  assert (select count(*) from private.public_snapshots) = 5, 'FAIL: a second refresh added rows';

  -- Only the listed public fields went in.
  assert (select array_agg(k order by k) from jsonb_object_keys(
            (select body from private.public_snapshots where key = 'highlights')) k)
         = array['activeNow', 'activeToday', 'completedToday', 'liveWorkers', 'openTasks'],
    'FAIL: the highlights copy holds unexpected fields';
  assert not exists (
    select 1 from private.public_snapshots s, jsonb_array_elements(s.body) e, jsonb_object_keys(e) k
     where s.key = 'trending' and k not in ('category', 'open_count', 'recent_count', 'avg_budget_minor')),
    'FAIL: the trending copy holds unexpected fields';
  assert not exists (
    select 1 from private.public_snapshots s, jsonb_array_elements(s.body) e, jsonb_object_keys(e) k
     where s.key like 'top_earners:%'
       and k not in ('id', 'display_name', 'username', 'avatar_url', 'rating', 'rating_count', 'jobs_done', 'skill')),
    'FAIL: a top_earners copy holds unexpected fields';
  assert (select jsonb_array_length(body) from private.public_snapshots where key = 'trending') <= 20, 'FAIL: trending copy over 20';
  assert (select max(jsonb_array_length(body)) from private.public_snapshots where key like 'top_earners:%') <= 30, 'FAIL: top_earners copy over 30';

  perform pg_temp.set_cache('{"app": false, "snapshots": true, "memo": false}');

  assert public.platform_highlights() = private.platform_highlights_live(), 'FAIL: highlights copy differs from live';
  foreach v_lim in array array[null, 0, 1, 3, 8, 20, 50] loop
    assert pg_temp.trending(v_lim) = pg_temp.trending_live(v_lim),
      format('FAIL: trending(%s) copy differs from live', coalesce(v_lim::text, 'null'));
  end loop;
  foreach v_kind in array array['top_rated', 'most_active', 'new_talent'] loop
    foreach v_lim in array array[null, 0, 1, 10, 30, 99] loop
      assert pg_temp.earners(v_kind, v_lim) = pg_temp.earners_live(v_kind, v_lim),
        format('FAIL: top_earners(%s, %s) copy differs from live', v_kind, coalesce(v_lim::text, 'null'));
    end loop;
  end loop;
  -- Our rated helper is in the copy with the same rating as live (numeric scale kept).
  -- (Skipped when more than 30 rated helpers already exist and ours may not make the cut.)
  assert pg_temp.earners('top_rated', 30) @> jsonb_build_array(jsonb_build_object('id', v_worker, 'rating', 4.8))
      or (select count(*) from public.profiles where onboarded_at is not null and worker_rating_count > 0) > 30,
    'FAIL: rated helper missing from the copy, or its rating changed';
  -- The function result types are unchanged.
  assert pg_get_function_result('public.trending_categories(integer)'::regprocedure)
         = 'TABLE(category text, open_count bigint, recent_count bigint, avg_budget_minor bigint)',
    'FAIL: trending_categories result type changed';
  assert pg_get_function_result('public.top_earners(text, integer)'::regprocedure)
         = 'TABLE(id uuid, display_name text, username text, avatar_url text, rating numeric, rating_count integer, jobs_done bigint, skill text)',
    'FAIL: top_earners result type changed';
  assert pg_get_function_result('public.platform_highlights()'::regprocedure) = 'jsonb',
    'FAIL: platform_highlights result type changed';
end;
$$;

-- ---- 4. the copy is used only when allowed ---------------------------------
do $$
declare
  v_marker uuid := gen_random_uuid();
  v_live_h jsonb := private.platform_highlights_live();
  v_rows   jsonb;
begin
  -- Plant copies nobody could get from the live query, so each answer shows its path.
  perform private.refresh_public_snapshots();
  update private.public_snapshots
     set body = '{"activeNow": -1, "activeToday": -1, "openTasks": -1, "completedToday": -1, "liveWorkers": -1}'
   where key = 'highlights';
  update private.public_snapshots
     set body = '[{"category": "__snap_a__", "open_count": 3, "recent_count": 9, "avg_budget_minor": 100},
                  {"category": "__snap_b__", "open_count": 2, "recent_count": 8, "avg_budget_minor": null},
                  {"category": "__snap_c__", "open_count": 1, "recent_count": 7, "avg_budget_minor": 300}]'
   where key = 'trending';
  update private.public_snapshots
     set body = jsonb_build_array(jsonb_build_object(
                  'id', v_marker, 'display_name', '__snap__', 'username', null, 'avatar_url', null,
                  'rating', 4.5, 'rating_count', 2, 'jobs_done', 7, 'skill', null))
   where key = 'top_earners:top_rated';

  -- On and fresh: the copy, cut to p_limit, in its own order.
  perform pg_temp.set_cache('{"snapshots": true}');
  assert (public.platform_highlights() ->> 'activeNow')::int = -1, 'FAIL: fresh copy not used for highlights';
  v_rows := pg_temp.trending(2);
  assert jsonb_array_length(v_rows) = 2, 'FAIL: the copy was not cut to p_limit';
  assert v_rows -> 0 ->> 'category' = '__snap_a__' and v_rows -> 1 ->> 'category' = '__snap_b__',
    'FAIL: the copy came back in another order';
  assert v_rows -> 1 -> 'avg_budget_minor' = 'null'::jsonb, 'FAIL: a null average did not stay null';
  assert (select count(*) from public.top_earners('top_rated', 10) t where t.id = v_marker) = 1,
    'FAIL: fresh copy not used for top_earners';
  -- An unknown kind or a null kind never reads a copy.
  assert (select count(*) from public.top_earners('bogus', 30) t where t.id = v_marker) = 0, 'FAIL: unknown kind read a copy';
  assert (select count(*) from public.top_earners(null, 30) t where t.id = v_marker) = 0, 'FAIL: null kind read a copy';

  -- Switch off: live.
  perform pg_temp.set_cache('{"app": true, "snapshots": false, "memo": true}');
  assert public.platform_highlights() = v_live_h, 'FAIL: switch off still used the highlights copy';
  assert not pg_temp.trending(20) @> '[{"category": "__snap_a__"}]', 'FAIL: switch off still used the trending copy';
  assert pg_temp.trending(20) = pg_temp.trending_live(20), 'FAIL: switch off did not give the live trending';
  assert (select count(*) from public.top_earners('top_rated', 30) t where t.id = v_marker) = 0,
    'FAIL: switch off still used the top_earners copy';

  -- A value other than true: live.
  perform pg_temp.set_cache('{"snapshots": "true"}');
  assert public.platform_highlights() = v_live_h, 'FAIL: the string "true" turned the copies on';

  -- Missing row: live.
  delete from public.settings where key = 'public_cache';
  assert public.platform_highlights() = v_live_h, 'FAIL: a missing switch row used the copy';

  -- On but stale (31 minutes): live. Just under 30 minutes: still the copy.
  perform pg_temp.set_cache('{"snapshots": true}');
  update private.public_snapshots set refreshed_at = now() - interval '29 minutes';
  assert (public.platform_highlights() ->> 'activeNow')::int = -1, 'FAIL: a 29-minute-old copy was not used';
  update private.public_snapshots set refreshed_at = now() - interval '31 minutes';
  assert public.platform_highlights() = v_live_h, 'FAIL: a stale highlights copy was used';
  assert pg_temp.trending(20) = pg_temp.trending_live(20), 'FAIL: a stale trending copy was used';
  assert (select count(*) from public.top_earners('top_rated', 30) t where t.id = v_marker) = 0,
    'FAIL: a stale top_earners copy was used';

  -- No copy at all (the job never ran): live.
  delete from private.public_snapshots;
  assert public.platform_highlights() = v_live_h, 'FAIL: no copy did not give live highlights';
  assert pg_temp.trending(8) = pg_temp.trending_live(8), 'FAIL: no copy did not give live trending';
  assert pg_temp.earners('new_talent', 10) = pg_temp.earners_live('new_talent', 10), 'FAIL: no copy did not give live top_earners';
end;
$$;

rollback;
