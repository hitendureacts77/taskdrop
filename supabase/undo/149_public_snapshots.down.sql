-- Undo for migration 149 (kept copies of the same-for-everyone lists, plan 3.5b layer C).
-- Emergency use only; the build never runs this. Run as one transaction.
--
-- Usually not needed: setting settings.public_cache.snapshots to false (or deleting the
-- row) already sends every call to the live query at once. This file puts the three list
-- functions and get_app_controls() back exactly as 048 / 050 / 127 left them, then removes
-- what 149 added. Turn off (or remove) the Inngest job that calls
-- public.refresh_public_snapshots() first, or it will fail until it is removed.
-- The app and api read the three get_app_controls fields as optional, so dropping them is safe.

-- 1. the three list functions, as before (language sql, live every time)
create or replace function public.platform_highlights()
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

create or replace function public.trending_categories(p_limit integer default 8)
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

create or replace function public.top_earners(p_kind text default 'top_rated', p_limit integer default 10)
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

revoke all on function public.platform_highlights() from public, anon;
revoke all on function public.trending_categories(integer) from public, anon;
revoke all on function public.top_earners(text, integer) from public, anon;
grant execute on function public.platform_highlights() to authenticated;
grant execute on function public.trending_categories(integer) to authenticated;
grant execute on function public.top_earners(text, integer) to authenticated;

-- 2. get_app_controls as left by 127 (without the three public_cache_* fields)
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
  if v_version is not null and v_version !~ '^[0-9]{1,6}(\.[0-9]{1,6}){0,2}$' then
    v_version := null;
  end if;

  select * into v_all from public.app_controls where platform = 'all';
  if v_platform is not null then
    select * into v_plat from public.app_controls where platform = v_platform;
  end if;

  v_min := case
    when v_all.min_version is null then v_plat.min_version
    when v_plat.min_version is null then v_all.min_version
    when private.version_lt(v_all.min_version, v_plat.min_version) then v_plat.min_version
    else v_all.min_version
  end;

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
    'environment',         coalesce(v_all.environment, 'staging'),
    'banner_text',         case when v_banner.platform is null then null else btrim(v_banner.banner_text) end,
    'banner_level',        case when v_banner.platform is null then null else v_banner.banner_level end,
    'banner_link',         case when v_banner.platform is null then null else v_banner.banner_link end
  );
end;
$$;
revoke all on function public.get_app_controls(text, text) from public;
grant execute on function public.get_app_controls(text, text) to anon, authenticated, service_role;

-- 3. what 149 added
drop function if exists public.refresh_public_snapshots();
drop function if exists private.refresh_public_snapshots();
drop function if exists private.top_earners_live(text, integer);
drop function if exists private.trending_categories_live(integer);
drop function if exists private.platform_highlights_live();
drop function if exists private.public_cache_on(text);
drop table if exists private.public_snapshots;
delete from public.settings where key = 'public_cache';
