-- 261: the walkthrough video link, launch areas in get_app_controls, and idle sign-out 30 (admin v2 WP8a).
--
-- 1. settings.walkthrough_video_url: the YouTube link the "How TaskDrop works" page plays (row X
--    of plan 1.21 had no link yet). Empty by default, so nothing changes until an admin sets one.
--    Changed only through admin_set_walkthrough_url (full admin, YouTube https links only, audit row).
-- 2. get_app_controls() gains two keys, added only (same signature, everything else as left by 149):
--      walkthrough_url  the link above, or null
--      launch_areas     { on, message, areas: [{ name, lat, lng, radius_km }] } from migration 260.
--                       "on" is true only while settings.launch_areas_on is true AND an area is active,
--                       so an empty list can never close the whole country.
-- 3. settings.admin_session_idle_minutes 90 -> 30 (owner decision: staff are signed out after 30 idle
--    minutes; the panel's own ADMIN_IDLE_MINUTES default is also 30). Only when it is still 90.
--
-- Adds only. Forward-only.

insert into public.settings (key, value) values ('walkthrough_video_url', to_jsonb(''::text))
on conflict (key) do nothing;

update public.settings set value = to_jsonb(30), updated_at = now()
where key = 'admin_session_idle_minutes' and value = to_jsonb(90);

create or replace function public.admin_set_walkthrough_url(p_url text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_old text;
begin
  if not private.is_admin() or not private.staff_can(auth.uid(), 'admin') then
    raise exception 'Only a full admin can change the walkthrough video' using errcode = '42501';
  end if;
  -- The same rule as the app's videoUrl(): only a real YouTube address; blank clears it.
  if v_url <> '' and (char_length(v_url) > 300
      or v_url !~ '^https://(www\.)?(youtube\.com/(watch\?v=|shorts/)|youtu\.be/)[A-Za-z0-9_-]{6,}') then
    raise exception 'Use a YouTube link that starts with https://youtube.com/watch?v=, https://youtube.com/shorts/ or https://youtu.be/';
  end if;
  select value #>> '{}' into v_old from public.settings where key = 'walkthrough_video_url';
  insert into public.settings (key, value) values ('walkthrough_video_url', to_jsonb(v_url))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if coalesce(v_old, '') is distinct from v_url then
    perform public.admin_log_event(
      'walkthrough_link_changed', 'settings:walkthrough_video_url',
      left(format('%s%s -> %s', coalesce('reason: ' || left(nullif(btrim(p_reason), ''), 100) || '; ', ''),
        coalesce(nullif(v_old, ''), 'none'), coalesce(nullif(v_url, ''), 'none')), 500));
  end if;
  return jsonb_build_object('url', nullif(v_url, ''));
end;
$$;
revoke all on function public.admin_set_walkthrough_url(text, text) from public, anon;
grant execute on function public.admin_set_walkthrough_url(text, text) to authenticated;

-- The public part of the launch areas, for get_app_controls. Not callable on its own.
create or replace function private.launch_areas_public()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'on', coalesce((select s.value = 'true'::jsonb from public.settings s where s.key = 'launch_areas_on'), false)
          and exists (select 1 from public.launch_areas a where a.active),
    'message', (select nullif(btrim(s.value #>> '{}'), '') from public.settings s where s.key = 'launch_areas_message'),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'lat', a.lat, 'lng', a.lng, 'radius_km', a.radius_km) order by a.name)
                         from public.launch_areas a where a.active), '[]'::jsonb)
  )
$$;
revoke all on function private.launch_areas_public() from public, anon, authenticated, service_role;

-- ---- get_app_controls as left by 149, plus walkthrough_url and launch_areas at the end ----
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
    'public_cache_memo',      private.public_cache_on('memo'),
    -- Migration 261: the walkthrough video link and the launch areas (migration 260).
    'walkthrough_url',        (select nullif(btrim(s.value #>> '{}'), '') from public.settings s where s.key = 'walkthrough_video_url'),
    'launch_areas',           private.launch_areas_public()
  );
end;
$$;
revoke all on function public.get_app_controls(text, text) from public;
grant execute on function public.get_app_controls(text, text) to anon, authenticated, service_role;
