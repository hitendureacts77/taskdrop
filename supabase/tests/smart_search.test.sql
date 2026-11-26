-- Smart search, migration 223 (plan 1.19 row D): search_posts ranks open posts by the searcher's words, the words
-- they stand for, spelling slips and meaning (fingerprints), and only open posts ever come back. Fingerprints are
-- service-role only: no member can read them or write their own post's to game the ranking.
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/smart_search.test.sql

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

-- A 384-number fingerprint pointing along one axis, so "close in meaning" is exact in the test.
create or replace function pg_temp.axis(p_i integer) returns text
language sql as $$
  select '[' || string_agg(case when g = p_i then '1' else '0' end, ',' order by g) || ']' from generate_series(1, 384) g
$$;

do $$
declare
  v_poster  uuid := gen_random_uuid();
  v_worker  uuid := gen_random_uuid();
  v_sink    uuid;
  v_tap     uuid;
  v_geyser  uuid;
  v_closed  uuid;
  v_mine    uuid;
  v_far     uuid;
  v_ids     uuid[];
  v_err     text;
  v_n       integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'smartsearch+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name) values (v_poster, 'Asha Rao'), (v_worker, 'Ravi Kumar') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker) on conflict (user_id) do nothing;

  insert into public.tasks (poster_id, pillar, title, description, category, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_poster, 'services', 'Kitchen sink is leaking, need a plumber today', 'Water under the sink since morning', 'Repairs & Maintenance', 60000, 60, 12.9716, 77.6412)
  returning id into v_sink;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_poster, 'services', 'Fix a leaking bathroom tap', 35000, 60, 12.9720, 77.6400) returning id into v_tap;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_poster, 'services', 'Fix the geyser that trips the switch', 50000, 60, 12.9730, 77.6420) returning id into v_geyser;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_poster, 'services', 'Old tap job, already done', 35000, 60, 12.9716, 77.6412) returning id into v_closed;
  update public.tasks set status = 'CANCELLED' where id = v_closed;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_worker, 'services', 'My own tap post', 35000, 60, 12.9716, 77.6412) returning id into v_mine;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng)
  values (v_poster, 'services', 'Leaking tap in Delhi', 35000, 60, 28.6139, 77.2090) returning id into v_far;

  -- ---- words: "fix my tap" with "tap" as the own word and plumbing words as what it stands for ----------------
  perform pg_temp.become(v_worker);
  select array_agg(s.id order by s.score desc) into v_ids
    from public.search_posts('request', array['tap'], array['plumber', 'leak', 'pipe', 'sink', 'faucet'], 'fix my tap', null, v_worker) s;
  if not (v_sink = any(v_ids)) then raise exception 'the leaking sink (no shared word with "fix my tap") was not found: %', v_ids; end if;
  if not (v_tap = any(v_ids)) then raise exception 'the leaking tap post was not found'; end if;
  if v_geyser = any(v_ids) then raise exception 'the geyser post came up for a tap search'; end if;
  if v_closed = any(v_ids) then raise exception 'a cancelled post came back'; end if;
  if v_mine = any(v_ids) then raise exception 'the searcher''s own post came back'; end if;
  if array_position(v_ids, v_tap) > array_position(v_ids, v_sink) then
    raise exception 'the post holding the searcher''s own word should rank above the one that only means the same, got %', v_ids;
  end if;

  -- ---- area box: Bengaluru only, Delhi stays out -------------------------------------------------------------
  select array_agg(s.id) into v_ids
    from public.search_posts('request', array['tap'], array['leak'], null, null, v_worker, null, null, null, 12.8, 13.1, 77.5, 77.8) s;
  if v_far = any(v_ids) then raise exception 'a post outside the box came back'; end if;
  if not (v_tap = any(v_ids)) then raise exception 'a post inside the box was dropped'; end if;
  -- A box with no longitude bound (it would wrap) still filters by latitude.
  select count(*) into v_n
    from public.search_posts('request', array['tap'], array['leak'], null, null, v_worker, null, null, null, 12.8, 13.1, null, null) s
   where s.id = v_far;
  if v_n <> 0 then raise exception 'latitude-only box let Delhi in'; end if;

  -- ---- spelling: "kichen sink" still finds the kitchen sink post by its title ------------------------------
  select count(*) into v_n from public.search_posts('request', array['zzkichen'], null, 'kichen sink', null, v_worker) s where s.id = v_sink;
  if v_n = 0 then raise exception 'a close spelling found nothing'; end if;

  -- ---- odd input is harmless -----------------------------------------------------------------------------------
  select count(*) into v_n from public.search_posts('request', array['tap & | ! :* (', ''''], array['<->'], '%_', null, v_worker) s;
  select count(*) into v_n from public.search_posts('request', null, null, null, null, v_worker) s;
  if v_n <> 0 then raise exception 'an empty search should find nothing, found %', v_n; end if;

  -- ---- fingerprints: members cannot read or write them, nor list what needs one ------------------------------
  v_err := pg_temp.fails(format('insert into public.task_embeddings (task_id, embedding, source_hash) values (%L, %L, %L)', v_mine, pg_temp.axis(1), 'x'));
  if v_err is null then raise exception 'a member wrote a search fingerprint'; end if;
  v_err := pg_temp.fails('select * from public.task_embeddings limit 1');
  if v_err is null then raise exception 'a member read search fingerprints'; end if;
  v_err := pg_temp.fails('select * from public.posts_needing_embedding(5)');
  if v_err is null then raise exception 'a member listed posts needing fingerprints'; end if;

  -- ---- meaning: the service role writes fingerprints; a post close in meaning comes up with no shared word ------
  perform pg_temp.as_operator();
  select count(*) into v_n from public.posts_needing_embedding(50) p where p.id in (v_sink, v_tap, v_geyser);
  if v_n <> 3 then raise exception 'posts without a fingerprint should be listed, got %', v_n; end if;
  insert into public.task_embeddings (task_id, embedding, source_hash)
  values (v_sink, pg_temp.axis(1)::extensions.vector, public.task_search_hash('Kitchen sink is leaking, need a plumber today', 'Repairs & Maintenance', 'Water under the sink since morning')),
         (v_geyser, pg_temp.axis(2)::extensions.vector, public.task_search_hash('Fix the geyser that trips the switch', null, null));
  select count(*) into v_n from public.posts_needing_embedding(50) p where p.id in (v_sink, v_geyser);
  if v_n <> 0 then raise exception 'posts with a current fingerprint are still listed'; end if;

  perform pg_temp.become(v_worker);
  select array_agg(s.id) into v_ids
    from public.search_posts('request', array['zzunrelated'], null, null, pg_temp.axis(1), v_worker) s;
  if v_ids is null or not (v_sink = any(v_ids)) then raise exception 'the post close in meaning was not found: %', v_ids; end if;
  if v_geyser = any(v_ids) then raise exception 'a post far in meaning came up'; end if;

  -- Once the post's words change, its old fingerprint no longer counts and it is listed again.
  perform pg_temp.as_operator();
  update public.tasks set title = 'Bathroom pipe burst' where id = v_sink;
  perform pg_temp.become(v_worker);
  select count(*) into v_n from public.search_posts('request', array['zzunrelated'], null, null, pg_temp.axis(1), v_worker) s where s.id = v_sink;
  if v_n <> 0 then raise exception 'an out-of-date fingerprint still matched'; end if;
  perform pg_temp.as_operator();
  select count(*) into v_n from public.posts_needing_embedding(50) p where p.id = v_sink;
  if v_n <> 1 then raise exception 'a post whose words changed is not listed for a new fingerprint'; end if;

  -- The tunable threshold exists.
  if not exists (select 1 from public.settings where key = 'search_semantic_min') then
    raise exception 'settings.search_semantic_min is missing';
  end if;

  raise notice 'smart_search: all checks passed';
end;
$$;

rollback;
