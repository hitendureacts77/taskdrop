-- 149 -- Ready copies of the same-for-everyone lists (plan task 3.5b, layer C).
--
-- Trending, Top helpers and today's numbers are the same for every person, yet
-- the database works each one out again for every person who opens Home or
-- Explore. This migration lets a job work them out once and keep the answer in
-- one private table; the three list functions hand out the kept copy instead.
--
--   private.public_snapshots         the kept copies: 'highlights', 'trending' (the
--                                    most, 20) and 'top_earners:<kind>' for the three
--                                    kinds (the most, 30). Row rules on, no policies,
--                                    no grants: only the functions below touch it.
--   private.refresh_public_snapshots()   works all five out again from the live
--                                    queries and saves them. Owner only;
--   public.refresh_public_snapshots()    is its wrapper for Inngest (service key only).
--   private.*_live()                 the three bodies exactly as they were (048, 050).
--   platform_highlights(), trending_categories(), top_earners()
--                                    same inputs, same outputs, same order (rule 2).
--                                    They read the kept copy, cut to p_limit, only
--                                    when the switch is on AND the copy is under 30
--                                    minutes old; otherwise the live query, as today.
--
-- The switch: settings row 'public_cache' = {"app": false, "snapshots": false,
-- "memo": false}, all OFF by default, so nothing changes until an admin turns
-- 'snapshots' on. Only the exact JSON value true counts as on; a missing row or
-- any other value is off. get_app_controls() gains three fields (added only):
-- public_cache_app, public_cache_snapshots, public_cache_memo (layers A and D read
-- them later; this migration only exposes them).
--
-- What goes in: only the columns the public lists already return (counts,
-- category names, and the public profile fields id, display name, username,
-- avatar, rating, jobs done, first skill). platform_stats() is admin-only and
-- holds money totals: it is NEVER kept here; the key check below allows only
-- the five keys above.
--
-- Not done here: the Inngest job that calls the refresh every 10 minutes (a
-- later step of 3.5b). Until it runs, the table is empty and every call takes
-- the live path even with the switch on.
--
-- Adds only: one table, six functions, one settings row; three list functions
-- and get_app_controls() replaced with the same signatures. Undo:
-- supabase/undo/149_public_snapshots.down.sql.

-- ---- 1. the switch ---------------------------------------------------------
insert into public.settings (key, value)
values ('public_cache', '{"app": false, "snapshots": false, "memo": false}'::jsonb)
on conflict (key) do nothing;

-- True only when settings.public_cache has the given part set to JSON true.
create or replace function private.public_cache_on(p_part text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (s.value -> p_part) = 'true'::jsonb
       from public.settings s
      where s.key = 'public_cache'
        and jsonb_typeof(s.value) = 'object'),
    false)
$$;
revoke all on function private.public_cache_on(text) from public, anon, authenticated, service_role;

-- ---- 2. the private table --------------------------------------------------
create table if not exists private.public_snapshots (
  key          text primary key
               constraint public_snapshots_known_key check (key in (
                 'highlights', 'trending',
                 'top_earners:top_rated', 'top_earners:most_active', 'top_earners:new_talent')),
  body         jsonb not null,
  refreshed_at timestamptz not null default now(),
  took_ms      integer not null default 0 check (took_ms >= 0)
);
alter table private.public_snapshots enable row level security;
-- No policies on purpose, and no grants: only the SECURITY DEFINER functions
-- in this migration (owned by the migration's role) read or write it.
revoke all on table private.public_snapshots from public, anon, authenticated, service_role;
comment on table private.public_snapshots is
  'Kept copies of the same-for-everyone lists (migration 149, plan 3.5b layer C). Row rules on, no policies, '
  'no grants. Only public list fields; platform_stats is never kept here.';

-- ---- 3. the live queries, exactly as before --------------------------------
-- platform_highlights as left by 048.
create or replace function private.platform_highlights_live()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'activeNow',      (select count(*) from public.profiles where last_seen_at > now() - interval '15 minutes'),
    'activeToday',    (select count(*) from public.profiles where last_seen_at > now() - interval '24 hours'),
    'openTasks',      (select count(*) from public.tasks where status = 'OPEN'),
    'completedToday', (select count(*) from public.tasks
                        where status in ('COMPLETED', 'AUTO_COMPLETED')
                          and coalesce(completed_at, updated_at) > now() - interval '24 hours'),
    'liveWorkers',    (select count(*) from public.profiles where live_until > now())
  )
$$;

-- trending_categories as left by 050 (requests only).
create or replace function private.trending_categories_live(p_limit integer default 8)
returns table (category text, open_count bigint, recent_count bigint, avg_budget_minor bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(t.category,
           case t.pillar when 'services' then 'Services'
                         when 'procurement' then 'Products'
                         else 'Local Intel' end) as category,
         count(*) filter (where t.status = 'OPEN') as open_count,
         count(*) as recent_count,
         round(avg(t.benchmark_minor))::bigint as avg_budget_minor
    from public.tasks t
   where t.created_at > now() - interval '30 days'
     and t.status <> 'CANCELLED'
     and t.kind = 'request'
   group by 1
   order by 2 desc, 3 desc
   limit greatest(1, least(coalesce(p_limit, 8), 20))
$$;

-- top_earners as left by 048.
create or replace function private.top_earners_live(p_kind text default 'top_rated', p_limit integer default 10)
returns table (
  id uuid, display_name text, username text, avatar_url text,
  rating numeric, rating_count integer, jobs_done bigint, skill text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with base as (
    select p.id, p.display_name, p.username, p.avatar_url,
           round(p.worker_rating_avg, 1) as rating,
           p.worker_rating_count as rating_count,
           (select count(*) from public.assignments a
              join public.tasks t on t.id = a.task_id
             where a.worker_id = p.id and t.status in ('COMPLETED', 'AUTO_COMPLETED')) as jobs_done,
           (select count(*) from public.bids b
             where b.worker_id = p.id and b.created_at > now() - interval '30 days') as recent_quotes,
           p.skills[1] as skill,
           p.created_at
      from public.profiles p
     where p.onboarded_at is not null
  )
  select id, display_name, username, avatar_url, rating, rating_count, jobs_done, skill
    from base
   where case p_kind
           when 'top_rated'   then rating_count > 0
           when 'most_active' then recent_quotes > 0
           else created_at > now() - interval '60 days'
         end
   order by
     case when p_kind = 'top_rated'   then rating end desc nulls last,
     case when p_kind = 'top_rated'   then rating_count end desc,
     case when p_kind = 'most_active' then recent_quotes end desc,
     created_at desc
   limit greatest(1, least(coalesce(p_limit, 10), 30))
$$;

revoke all on function private.platform_highlights_live() from public, anon, authenticated, service_role;
revoke all on function private.trending_categories_live(integer) from public, anon, authenticated, service_role;
revoke all on function private.top_earners_live(text, integer) from public, anon, authenticated, service_role;

-- ---- 4. the refresh --------------------------------------------------------
create or replace function private.refresh_public_snapshots()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind text;
  v_t0   timestamptz;
  v_body jsonb;
  v_ms   integer;
  v_out  jsonb := '{}'::jsonb;
begin
  -- One refresh at a time; a second caller skips instead of waiting.
  if not pg_try_advisory_xact_lock(hashtext('private.refresh_public_snapshots')) then
    return jsonb_build_object('skipped', true);
  end if;

  -- today's numbers
  v_t0 := clock_timestamp();
  v_body := private.platform_highlights_live();
  v_ms := greatest(0, round(extract(epoch from clock_timestamp() - v_t0) * 1000))::integer;
  insert into private.public_snapshots as s (key, body, refreshed_at, took_ms)
  values ('highlights', v_body, now(), v_ms)
  on conflict (key) do update
    set body = excluded.body, refreshed_at = excluded.refreshed_at, took_ms = excluded.took_ms;
  v_out := v_out || jsonb_build_object('highlights', v_ms);

  -- Trending: the most the function ever returns (20), in its own order.
  v_t0 := clock_timestamp();
  select coalesce(jsonb_agg(jsonb_build_object(
           'category',         l.category,
           'open_count',       l.open_count,
           'recent_count',     l.recent_count,
           'avg_budget_minor', l.avg_budget_minor) order by l.ord), '[]'::jsonb)
    into v_body
    from private.trending_categories_live(20)
         with ordinality as l(category, open_count, recent_count, avg_budget_minor, ord);
  v_ms := greatest(0, round(extract(epoch from clock_timestamp() - v_t0) * 1000))::integer;
  insert into private.public_snapshots as s (key, body, refreshed_at, took_ms)
  values ('trending', v_body, now(), v_ms)
  on conflict (key) do update
    set body = excluded.body, refreshed_at = excluded.refreshed_at, took_ms = excluded.took_ms;
  v_out := v_out || jsonb_build_object('trending', v_ms);

  -- Top helpers: the most the function ever returns (30) for each kind.
  foreach v_kind in array array['top_rated', 'most_active', 'new_talent'] loop
    v_t0 := clock_timestamp();
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',           l.id,
             'display_name', l.display_name,
             'username',     l.username,
             'avatar_url',   l.avatar_url,
             'rating',       l.rating,
             'rating_count', l.rating_count,
             'jobs_done',    l.jobs_done,
             'skill',        l.skill) order by l.ord), '[]'::jsonb)
      into v_body
      from private.top_earners_live(v_kind, 30)
           with ordinality as l(id, display_name, username, avatar_url, rating, rating_count, jobs_done, skill, ord);
    v_ms := greatest(0, round(extract(epoch from clock_timestamp() - v_t0) * 1000))::integer;
    insert into private.public_snapshots as s (key, body, refreshed_at, took_ms)
    values ('top_earners:' || v_kind, v_body, now(), v_ms)
    on conflict (key) do update
      set body = excluded.body, refreshed_at = excluded.refreshed_at, took_ms = excluded.took_ms;
    v_out := v_out || jsonb_build_object('top_earners:' || v_kind, v_ms);
  end loop;

  return jsonb_build_object('skipped', false, 'took_ms', v_out);
end;
$$;
revoke all on function private.refresh_public_snapshots() from public, anon, authenticated, service_role;

-- The door for the Inngest job. Service key only.
create or replace function public.refresh_public_snapshots()
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select private.refresh_public_snapshots()
$$;
revoke all on function public.refresh_public_snapshots() from public, anon, authenticated;
grant execute on function public.refresh_public_snapshots() to service_role;

-- ---- 5. the three list functions: kept copy when allowed, else live --------
create or replace function public.platform_highlights()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_body jsonb;
begin
  if private.public_cache_on('snapshots') then
    select s.body into v_body
      from private.public_snapshots s
     where s.key = 'highlights'
       and s.refreshed_at > now() - interval '30 minutes'
       and jsonb_typeof(s.body) = 'object';
    if v_body is not null then
      return v_body;
    end if;
  end if;
  return private.platform_highlights_live();
end;
$$;

create or replace function public.trending_categories(p_limit integer default 8)
returns table (category text, open_count bigint, recent_count bigint, avg_budget_minor bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_body jsonb;
  v_n    integer := greatest(1, least(coalesce(p_limit, 8), 20));
begin
  if private.public_cache_on('snapshots') then
    select s.body into v_body
      from private.public_snapshots s
     where s.key = 'trending'
       and s.refreshed_at > now() - interval '30 minutes'
       and jsonb_typeof(s.body) = 'array';
    if v_body is not null then
      return query
        select (e.v ->> 'category'),
               (e.v ->> 'open_count')::bigint,
               (e.v ->> 'recent_count')::bigint,
               (e.v ->> 'avg_budget_minor')::bigint
          from jsonb_array_elements(v_body) with ordinality as e(v, ord)
         order by e.ord
         limit v_n;
      return;
    end if;
  end if;
  return query
    select l.category, l.open_count, l.recent_count, l.avg_budget_minor
      from private.trending_categories_live(p_limit) l;
end;
$$;

create or replace function public.top_earners(p_kind text default 'top_rated', p_limit integer default 10)
returns table (
  id uuid, display_name text, username text, avatar_url text,
  rating numeric, rating_count integer, jobs_done bigint, skill text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_body jsonb;
  v_n    integer := greatest(1, least(coalesce(p_limit, 10), 30));
begin
  -- Only the three known kinds are kept; anything else (or null) asks live.
  if p_kind in ('top_rated', 'most_active', 'new_talent') and private.public_cache_on('snapshots') then
    select s.body into v_body
      from private.public_snapshots s
     where s.key = 'top_earners:' || p_kind
       and s.refreshed_at > now() - interval '30 minutes'
       and jsonb_typeof(s.body) = 'array';
    if v_body is not null then
      return query
        select (e.v ->> 'id')::uuid,
               (e.v ->> 'display_name'),
               (e.v ->> 'username'),
               (e.v ->> 'avatar_url'),
               (e.v ->> 'rating')::numeric,
               (e.v ->> 'rating_count')::integer,
               (e.v ->> 'jobs_done')::bigint,
               (e.v ->> 'skill')
          from jsonb_array_elements(v_body) with ordinality as e(v, ord)
         order by e.ord
         limit v_n;
      return;
    end if;
  end if;
  return query
    select l.id, l.display_name, l.username, l.avatar_url, l.rating, l.rating_count, l.jobs_done, l.skill
      from private.top_earners_live(p_kind, p_limit) l;
end;
$$;

-- Same grants as 048 / 050.
revoke all on function public.platform_highlights() from public, anon;
revoke all on function public.trending_categories(integer) from public, anon;
revoke all on function public.top_earners(text, integer) from public, anon;
grant execute on function public.platform_highlights() to authenticated;
grant execute on function public.trending_categories(integer) to authenticated;
grant execute on function public.top_earners(text, integer) to authenticated;

-- ---- 6. get_app_controls: three new fields (as left by 127, plus these) ----
create or replace function public.get_app_controls(p_platform text default null, p_version text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_platform text := lower(nullif(btrim(p_platform), ''));
  v_version  text := nullif(btrim(p_version), '');
  v_all      public.app_controls;
  v_plat     public.app_controls;
  v_min      text;
  v_banner   public.app_controls;
begin
  if v_platform is null or v_platform not in ('web', 'android', 'ios') then
    v_platform := null;
  end if;
  -- Each part must fit a Postgres int (version_lt casts to int[]).
  if v_version is not null and v_version !~ '^[0-9]{1,6}(\.[0-9]{1,6}){0,2}$' then
    v_version := null;
  end if;

  select * into v_all from public.app_controls where platform = 'all';
  if v_platform is not null then
    select * into v_plat from public.app_controls where platform = v_platform;
  end if;

  -- The higher of the two minimum versions.
  v_min := case
    when v_all.min_version is null then v_plat.min_version
    when v_plat.min_version is null then v_all.min_version
    when private.version_lt(v_all.min_version, v_plat.min_version) then v_plat.min_version
    else v_all.min_version
  end;

  -- A banner counts while it has text and has not ended; the platform's own wins.
  v_banner := case
    when coalesce(btrim(v_plat.banner_text), '') <> ''
         and (v_plat.banner_ends_at is null or v_plat.banner_ends_at > now()) then v_plat
    when coalesce(btrim(v_all.banner_text), '') <> ''
         and (v_all.banner_ends_at is null or v_all.banner_ends_at > now()) then v_all
    else null
  end;

  return jsonb_build_object(
    'platform',            v_platform,
    'maintenance',         coalesce(v_all.maintenance, false) or coalesce(v_plat.maintenance, false),
    'maintenance_message', case when coalesce(v_plat.maintenance, false)
                                then coalesce(v_plat.maintenance_message, v_all.maintenance_message)
                                else coalesce(v_all.maintenance_message, v_plat.maintenance_message) end,
    'min_version',         v_min,
    'update_required',     v_version is not null and v_min is not null and private.version_lt(v_version, v_min),
    'update_url',          coalesce(v_plat.update_url, v_all.update_url),
    'signups_open',        coalesce(v_all.signups_open, true)    and coalesce(v_plat.signups_open, true),
    'signin_phone',        coalesce(v_all.signin_phone, true)    and coalesce(v_plat.signin_phone, true),
    'signin_google',       coalesce(v_all.signin_google, true)   and coalesce(v_plat.signin_google, true),
    'signin_apple',        coalesce(v_all.signin_apple, true)    and coalesce(v_plat.signin_apple, true),
    'signin_password',     coalesce(v_all.signin_password, true) and coalesce(v_plat.signin_password, true),
    'posting',             coalesce(v_all.posting, true)         and coalesce(v_plat.posting, true),
    'bidding',             coalesce(v_all.bidding, true)         and coalesce(v_plat.bidding, true),
    'topups',              coalesce(v_all.topups, true)          and coalesce(v_plat.topups, true),
    'withdrawals',         coalesce(v_all.withdrawals, true)     and coalesce(v_plat.withdrawals, true),
    'promotions',          coalesce(v_all.promotions, true)      and coalesce(v_plat.promotions, true),
    'chat_photos',         coalesce(v_all.chat_photos, true)     and coalesce(v_plat.chat_photos, true),
    'require_phone_verified', coalesce(v_all.require_phone_verified, false) or coalesce(v_plat.require_phone_verified, false),
    -- Only the 'all' row decides; a missing row reads as staging, the safe side.
    'environment',         coalesce(v_all.environment, 'staging'),
    'banner_text',         case when v_banner.platform is null then null else btrim(v_banner.banner_text) end,
    'banner_level',        case when v_banner.platform is null then null else v_banner.banner_level end,
    'banner_link',         case when v_banner.platform is null then null else v_banner.banner_link end,
    -- Migration 149: the public-cache switches (settings.public_cache). Off unless set to true.
    'public_cache_app',       private.public_cache_on('app'),
    'public_cache_snapshots', private.public_cache_on('snapshots'),
    'public_cache_memo',      private.public_cache_on('memo')
  );
end;
$$;
revoke all on function public.get_app_controls(text, text) from public;
grant execute on function public.get_app_controls(text, text) to anon, authenticated, service_role;
