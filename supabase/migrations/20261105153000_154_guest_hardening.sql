-- 154: the guest door, hardened (hunt round 2: H61, H62, H63, H67).
--
-- Migration 146 let someone with no account read open posts and public
-- profile cards through the api function. Three things are tightened here;
-- nothing is dropped and no stored row changes.
--
--   H61  The public place label (tasks.loc_label, profiles.loc_label) of posts
--        and profiles made before migration 126 can still hold the whole typed
--        line: a flat or house number and a cross street. A guest now gets the
--        area only, worked out when the row is read (private.guest_area_label).
--        The stored label is left as it is.
--
--   H62  The guest task card was "every column except these", so any column
--        added to tasks later went onto the open internet with nobody deciding.
--        It is now a fixed list of fields, like the person card already was.
--        supabase/tests/guest_hardening.test.sql fails when tasks gains a column
--        that is on neither the guest list nor the reviewed "never" list.
--
--   H63  The guest limiter counted per network address only. api_guest_spend
--        counts a request's cost against the address AND against one budget for
--        all guests together, in one round trip:
--          * over the address's limit: 'limited' (nothing more is counted, so a
--            script on a shared mobile network cannot push the window further);
--          * all guests together over the soft ceiling: 'heavy_off', the api then
--            answers only the light reads and asks the heavy ones to wait;
--          * over the hard ceiling: 'busy', nothing runs (503).
--        The numbers come from the api function (supabase/functions/api/guest.ts).
--
-- Only the service role may call any of these. Nothing here writes outside
-- private.api_rate.

-- ------------------------------------------------------------- area label --

-- The neighbourhood part of a typed place, for people with no account: the last
-- two comma parts that are not a door, a number, a building or a landmark.
-- Stricter than the app's roughPlace (apps/mobile/src/lib/place.ts): any part
-- with a digit in it is left out (flat, plot, PIN, "5th Cross", "Road 12"), so
-- "Flat 302, Sai Residency, 5th Cross, Madhapur, Hyderabad" -> "Madhapur,
-- Hyderabad" and "Ward 104 Kondapur" -> "Kondapur". Nothing left: null.
create or replace function private.guest_area_label(p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_x     text;
  v_n     integer;
begin
  if p_label is null or btrim(p_label) = '' then return null; end if;
  if btrim(p_label) ~* '^remote$' then return 'Remote'; end if;
  foreach v_x in array string_to_array(left(p_label, 500), ',') loop
    -- "Ward 104 Kondapur" -> "Kondapur" before numbers are looked at.
    v_x := btrim(regexp_replace(btrim(v_x), '^ward\s*\d+\s*', '', 'i'));
    continue when v_x = '';
    continue when v_x ~* '^india$';
    -- Any number: house, flat, plot or door numbers, PIN codes, "12/3", "5th Cross", coordinates.
    continue when v_x ~ '[0-9]';
    -- Door-level words, and "#".
    continue when v_x ~ '^#';
    continue when v_x ~* '^(flat|house|h\.?\s?no|door|plot|apt|apartment|block|shop|floor|wing|room|unit)\M';
    -- A building or society name: keep the area after it.
    continue when v_x ~* '\m(residency|apartments?|towers?|enclave|society|heights|villa|villas|nivas|complex|bhavan|building)\M';
    -- Landmarks point at the door as well as a number does.
    continue when v_x ~* '^(near|opp|opposite|behind|beside|next to|in front of)\M';
    v_parts := v_parts || left(v_x, 60);
  end loop;
  v_n := cardinality(v_parts);
  if v_n = 0 then return null; end if;
  return array_to_string(v_parts[greatest(v_n - 1, 1):v_n], ', ');
end;
$$;

revoke all on function private.guest_area_label(text) from public, anon, authenticated;

-- -------------------------------------------------------- public cards --

-- As in 146, field for field, except the place label is the area only (H61).
create or replace function private.guest_person_json(p public.profiles)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p.id is null or p.deleted_at is not null then null else jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'username', p.username,
    'avatar_url', p.avatar_url,
    'skills', p.skills,
    'languages', p.languages,
    'bio', p.bio,
    'worker_bio', p.worker_bio,
    'loc_label', private.guest_area_label(p.loc_label),
    'loc_lat', round(p.loc_lat::numeric, 2)::float8,
    'loc_lng', round(p.loc_lng::numeric, 2)::float8,
    'poster_rating_avg', p.poster_rating_avg,
    'poster_rating_count', p.poster_rating_count,
    'worker_rating_avg', p.worker_rating_avg,
    'worker_rating_count', p.worker_rating_count,
    'last_seen_at', p.last_seen_at,
    'created_at', p.created_at,
    'onboarded_at', p.onboarded_at,
    'worker_onboarded_at', p.worker_onboarded_at
  ) end
$$;

-- A fixed list of fields (H62): exactly the 33 columns 146 sent on 5 Nov 2026,
-- with the place rounded to two decimals and the label cut to the area (H61).
-- A new column on tasks shows to guests only once someone adds it here, and the
-- guest_hardening test makes them decide.
create or replace function private.guest_task_json(t public.tasks)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'poster_id', t.poster_id,
    'kind', t.kind,
    'pillar', t.pillar,
    'category', t.category,
    'skills', t.skills,
    'difficulty', t.difficulty,
    'title', t.title,
    'description', t.description,
    'benchmark_minor', t.benchmark_minor,
    'time_limit_minutes', t.time_limit_minutes,
    'flag', t.flag,
    'status', t.status,
    'assignment_mode', t.assignment_mode,
    'due_at', t.due_at,
    'media_kind', t.media_kind,
    'media_path', t.media_path,
    'media_seconds', t.media_seconds,
    'loc_lat', round(t.loc_lat::numeric, 2)::float8,
    'loc_lng', round(t.loc_lng::numeric, 2)::float8,
    'loc_label', private.guest_area_label(t.loc_label),
    'milestones', t.milestones,
    'topup_pct', t.topup_pct,
    'flash_until', t.flash_until,
    'live_answer', t.live_answer,
    'crew_id', t.crew_id,
    'crew_size', t.crew_size,
    'crew_slot', t.crew_slot,
    'repeat_every', t.repeat_every,
    'want_photos', t.want_photos,
    'photos_public', t.photos_public,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
$$;

revoke all on function private.guest_person_json(public.profiles) from public, anon, authenticated;
revoke all on function private.guest_task_json(public.tasks) from public, anon, authenticated;

-- ------------------------------------------------------------ the limiter --

-- One guest request: count p_cost against the caller's address key (p_key, a
-- hashed address shaped like a uuid) and against all guests together, in the
-- same one-minute windows as api_rate_spend. Answers
--   'ok'         go ahead;
--   'heavy_off'  go ahead with light reads only (all guests over p_soft);
--   'limited'    this address is over p_limit (nothing added to any counter);
--   'busy'       all guests over p_hard (nothing more added to the shared one).
create or replace function public.api_guest_spend(
  p_key   uuid,
  p_cost  integer,
  p_limit integer,
  p_soft  integer,
  p_hard  integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The shared counter's key: no hashed address can be all zeros.
  c_all   constant uuid := '00000000-0000-0000-0000-000000000000';
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / 60) * 60);
  v_cost  integer := least(greatest(coalesce(p_cost, 1), 1), 100);
  v_hits  integer;
begin
  if p_key is null or p_key = c_all then return 'limited'; end if;

  -- The address first: a refused request never touches the shared row.
  insert into private.api_rate as r (user_id, bucket, window_start, hits)
  values (p_key, 'guest', v_start, v_cost)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + v_cost
    where r.hits + v_cost <= p_limit
  returning r.hits into v_hits;
  if v_hits is null or v_hits > p_limit then return 'limited'; end if;

  insert into private.api_rate as r (user_id, bucket, window_start, hits)
  values (c_all, 'guest_all', v_start, v_cost)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + v_cost
    where r.hits + v_cost <= p_hard
  returning r.hits into v_hits;
  if v_hits is null or v_hits > p_hard then return 'busy'; end if;
  if v_hits > p_soft then return 'heavy_off'; end if;
  return 'ok';
end;
$$;

revoke all on function public.api_guest_spend(uuid, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.api_guest_spend(uuid, integer, integer, integer, integer) to service_role;
