-- 092 -- Remote control of the apps: app_controls, app_devices.
--
-- The admin panel can switch features on or off, put an app into maintenance,
-- demand a newer version and show a banner, separately for Web, Android and
-- iOS (UPGRADE_PLAN Phase 3).
--
--   app_controls   one row per platform: web | android | ios | all.
--                  'all' applies everywhere; a platform row can only add
--                  restrictions on top of it (maintenance is on if either is
--                  on, a feature is on only if both are on, the higher
--                  minimum version wins). Requests that do not say which
--                  platform they come from (the old app) get 'all' only.
--   get_app_controls(platform, version)
--                  the merged answer for one caller, as jsonb. Public: the
--                  app-config function and the api function both call it.
--   admin_set_app_control(platform, changes, reason)
--                  the only way to write. Full admins change anything;
--                  finance may change top-ups and withdrawals only. Those two
--                  also need the authenticator code (aal2). Every change is
--                  written to admin_audit_log through admin_log_event.
--   app_devices    which platform, app version and OS each signed-in person's
--                  installs run, and when each was last seen. Written by
--                  record_device() only.
--
-- Only adds: tables, functions, rows. Nothing is dropped or renamed.

-- ------------------------------------------------------------ app_controls --

create table if not exists public.app_controls (
  platform             text primary key check (platform in ('all', 'web', 'android', 'ios')),
  maintenance          boolean not null default false,
  maintenance_message  text check (char_length(maintenance_message) <= 500),
  min_version          text check (min_version ~ '^[0-9]+(\.[0-9]+){0,2}$'),
  update_url           text check (update_url ~ '^https://' and char_length(update_url) <= 500),
  signups_open         boolean not null default true,
  signin_phone         boolean not null default true,
  signin_google        boolean not null default true,
  signin_apple         boolean not null default true,
  signin_password      boolean not null default true,
  posting              boolean not null default true,
  bidding              boolean not null default true,
  topups               boolean not null default true,
  withdrawals          boolean not null default true,
  promotions           boolean not null default true,
  chat_photos          boolean not null default true,
  banner_text          text check (char_length(banner_text) <= 300),
  banner_level         text not null default 'info' check (banner_level in ('info', 'warning', 'critical')),
  banner_link          text check (banner_link ~ '^https://' and char_length(banner_link) <= 500),
  banner_ends_at       timestamptz,
  updated_by           uuid,
  updated_at           timestamptz not null default now()
);
comment on table public.app_controls is
  'Remote switches for the apps, one row per platform (migration 092). Written only by admin_set_app_control(); read through get_app_controls().';

insert into public.app_controls (platform)
values ('all'), ('web'), ('android'), ('ios')
on conflict (platform) do nothing;

alter table public.app_controls enable row level security;
drop policy if exists app_controls_admin_read on public.app_controls;
create policy app_controls_admin_read on public.app_controls
  for select to authenticated using (private.is_admin());
-- No write policies: writes go through admin_set_app_control().
revoke all on public.app_controls from anon;
revoke insert, update, delete on public.app_controls from authenticated;

-- 1.2.3 < 1.10.0: compare numbers, not text. Missing parts count as 0.
create or replace function private.version_lt(a text, b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (string_to_array(a || '.0.0', '.')::int[])[1:3] < (string_to_array(b || '.0.0', '.')::int[])[1:3];
$$;
revoke all on function private.version_lt(text, text) from public, anon, authenticated;

-- The merged controls for one caller. Never raises: a bad platform or version
-- is treated as "not given".
create or replace function public.get_app_controls(p_platform text default null, p_version text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
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
  if v_version is not null and v_version !~ '^[0-9]+(\.[0-9]+){0,2}$' then
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
    'banner_text',         case when v_banner.platform is null then null else btrim(v_banner.banner_text) end,
    'banner_level',        case when v_banner.platform is null then null else v_banner.banner_level end,
    'banner_link',         case when v_banner.platform is null then null else v_banner.banner_link end
  );
end;
$$;
revoke all on function public.get_app_controls(text, text) from public;
grant execute on function public.get_app_controls(text, text) to anon, authenticated, service_role;

-- Change switches for one platform. p_changes holds only the keys to change,
-- e.g. {"bidding": false, "banner_text": "Back at 6pm"}.
create or replace function public.admin_set_app_control(p_platform text, p_changes jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_actor   uuid := auth.uid();
  v_claims  jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_bools   constant text[] := array['maintenance', 'signups_open', 'signin_phone', 'signin_google', 'signin_apple',
                                     'signin_password', 'posting', 'bidding', 'topups', 'withdrawals',
                                     'promotions', 'chat_photos'];
  v_texts   constant text[] := array['maintenance_message', 'min_version', 'update_url', 'banner_text',
                                     'banner_level', 'banner_link', 'banner_ends_at'];
  v_money   constant text[] := array['topups', 'withdrawals'];
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[] := '{}';
  v_detail  text := '';
  v_mfa     boolean;
  v_key     text;
  v_val     jsonb;
  v_row     public.app_controls;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_platform is null or p_platform not in ('all', 'web', 'android', 'ios') then
    raise exception 'Unknown platform %', p_platform;
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Changes must be an object of switch names and values';
  end if;

  select to_jsonb(c) into v_old from public.app_controls c where c.platform = p_platform;
  if v_old is null then raise exception 'No controls row for %', p_platform; end if;

  -- Validate every key and value; collect what actually changes.
  for v_key, v_val in select * from jsonb_each(p_changes) loop
    if v_key = any (v_bools) then
      if jsonb_typeof(v_val) <> 'boolean' then raise exception '% must be true or false', v_key; end if;
    elsif v_key = any (v_texts) then
      if jsonb_typeof(v_val) not in ('string', 'null') then raise exception '% must be text or null', v_key; end if;
      if jsonb_typeof(v_val) = 'string' then
        -- text is stored trimmed; blank clears it
        v_val := case when btrim(v_val #>> '{}') = '' then 'null'::jsonb else to_jsonb(btrim(v_val #>> '{}')) end;
        p_changes := jsonb_set(p_changes, array[v_key], v_val);
      end if;
      if jsonb_typeof(v_val) = 'string' then
        case v_key
          when 'min_version' then
            if (v_val #>> '{}') !~ '^[0-9]+(\.[0-9]+){0,2}$' then raise exception 'min_version looks like 1.2.0'; end if;
          when 'banner_level' then
            if (v_val #>> '{}') not in ('info', 'warning', 'critical') then
              raise exception 'banner_level is info, warning or critical';
            end if;
          when 'update_url', 'banner_link' then
            if (v_val #>> '{}') !~ '^https://' then raise exception '% must start with https://', v_key; end if;
          when 'banner_ends_at' then
            perform (v_val #>> '{}')::timestamptz; -- raises on a bad date
          else null;
        end case;
      elsif v_key = 'banner_level' then
        raise exception 'banner_level is info, warning or critical';
      end if;
    else
      raise exception 'Unknown control %', v_key;
    end if;

    if v_old -> v_key is distinct from v_val
       and not (v_key = 'banner_ends_at' and jsonb_typeof(v_val) = 'string'
                and (v_old ->> v_key) is not null
                and (v_old ->> v_key)::timestamptz = (v_val #>> '{}')::timestamptz) then
      v_changed := v_changed || v_key;
      v_detail := v_detail || format('; %s: %s -> %s', v_key, coalesce(left(v_old ->> v_key, 40), 'null'),
                                     coalesce(left(v_val #>> '{}', 40), 'null'));
    end if;
  end loop;

  select to_jsonb(c) into v_new from public.app_controls c where c.platform = p_platform;
  if cardinality(v_changed) = 0 then
    return v_new; -- nothing to do, nothing to log
  end if;

  -- Who may: money switches need money (full admin or finance); the rest need
  -- a full admin. Money switches also need the authenticator code.
  if exists (select 1 from unnest(v_changed) k where k <> all (v_money)) then
    if not private.staff_can(v_actor, 'admin') then
      raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(v_actor)
        using errcode = '42501';
    end if;
  elsif not private.staff_can(v_actor, 'money') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(v_actor)
      using errcode = '42501';
  end if;
  if v_changed && v_money then
    select s.value = 'true'::jsonb into v_mfa from public.settings s where s.key = 'admin_require_mfa';
    if coalesce(v_mfa, true) and coalesce(v_claims ->> 'aal', '') <> 'aal2' then
      raise exception 'Verify your authenticator code first (Security page in the admin panel)'
        using errcode = '42501';
    end if;
  end if;

  v_new := v_old || (select coalesce(jsonb_object_agg(k, p_changes -> k), '{}'::jsonb) from unnest(v_changed) k);
  select * into v_row from jsonb_populate_record(null::public.app_controls, v_new);

  update public.app_controls c set
    maintenance = v_row.maintenance, maintenance_message = v_row.maintenance_message,
    min_version = v_row.min_version, update_url = v_row.update_url,
    signups_open = v_row.signups_open, signin_phone = v_row.signin_phone, signin_google = v_row.signin_google,
    signin_apple = v_row.signin_apple, signin_password = v_row.signin_password,
    posting = v_row.posting, bidding = v_row.bidding, topups = v_row.topups, withdrawals = v_row.withdrawals,
    promotions = v_row.promotions, chat_photos = v_row.chat_photos,
    banner_text = v_row.banner_text, banner_level = v_row.banner_level, banner_link = v_row.banner_link,
    banner_ends_at = v_row.banner_ends_at,
    updated_by = v_actor, updated_at = now()
  where c.platform = p_platform
  returning * into v_row;

  perform public.admin_log_event(
    'app_control_changed',
    'app_controls:' || p_platform,
    left(coalesce('reason: ' || left(nullif(btrim(p_reason), ''), 100), 'no reason given') || v_detail, 500));

  return to_jsonb(v_row);
end;
$fn$;
revoke all on function public.admin_set_app_control(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_app_control(text, jsonb, text) to authenticated;

-- -------------------------------------------------------------- app_devices --

create table if not exists public.app_devices (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  install_id         text not null check (install_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  platform           text not null check (platform in ('web', 'android', 'ios', 'windows', 'macos')),
  app_version        text check (char_length(app_version) <= 32),
  os_version         text check (char_length(os_version) <= 64),
  push_registered_at timestamptz,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  unique (user_id, install_id)
);
create index if not exists app_devices_platform_version_idx on public.app_devices (platform, app_version);
create index if not exists app_devices_last_seen_idx on public.app_devices (last_seen_at desc);
comment on table public.app_devices is
  'One row per install a signed-in person has used: platform, app version, OS, last seen (migration 092). Written only by record_device().';

alter table public.app_devices enable row level security;
drop policy if exists app_devices_own_read on public.app_devices;
create policy app_devices_own_read on public.app_devices
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists app_devices_admin_read on public.app_devices;
create policy app_devices_admin_read on public.app_devices
  for select to authenticated using (private.is_admin());
revoke all on public.app_devices from anon;
revoke insert, update, delete on public.app_devices from authenticated;

create or replace function public.record_device(
  p_install_id  text,
  p_platform    text,
  p_app_version text default null,
  p_os_version  text default null,
  p_push        boolean default false
)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if p_install_id is null or p_install_id !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'Bad install id'; end if;
  if p_platform is null or p_platform not in ('web', 'android', 'ios', 'windows', 'macos') then
    raise exception 'Bad platform';
  end if;

  insert into public.app_devices (user_id, install_id, platform, app_version, os_version, push_registered_at)
  values (v_uid, p_install_id, p_platform, left(nullif(btrim(p_app_version), ''), 32),
          left(nullif(btrim(p_os_version), ''), 64), case when p_push then now() end)
  on conflict (user_id, install_id) do update
    set platform           = excluded.platform,
        app_version        = coalesce(excluded.app_version, public.app_devices.app_version),
        os_version         = coalesce(excluded.os_version, public.app_devices.os_version),
        push_registered_at = coalesce(excluded.push_registered_at, public.app_devices.push_registered_at),
        last_seen_at       = now();
end;
$$;
revoke all on function public.record_device(text, text, text, text, boolean) from public, anon;
grant execute on function public.record_device(text, text, text, text, boolean) to authenticated;
