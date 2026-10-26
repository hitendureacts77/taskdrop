-- ===========================================================================
-- Migration 127: the `environment` setting (staging guard rails, Phase 8)
--
-- Says which kind of project this is: 'staging' (fake data, Razorpay test keys)
-- or 'production' (real money, live keys). It lives in app_controls so the admin
-- panel can show and change it with the other switches, and so get_app_controls()
-- hands it to the app-config function. It is read from the 'all' row only; a
-- platform row always holds the default and cannot be changed.
--
--   * The money Edge Functions read it and refuse a payment key of the wrong
--     kind: `rzp_live_` in staging, `rzp_test_` in production (supabase/functions/
--     _shared/keyMode.ts). A wrong key fails loudly instead of moving money.
--   * The apps read it from app-config to show the "Staging" ribbon.
--   * Changing it needs a full admin and the authenticator code (aal2), like the
--     money switches, and is written to the audit log with the other changes.
--
-- Adds only: one column (default 'staging', so every existing row and every old
-- caller keeps working) and two functions replaced. get_app_controls() is as
-- left by migration 106 plus one key; admin_set_app_control() is as left by 107
-- plus the `environment` key. Nothing is dropped or renamed.
-- ===========================================================================

alter table public.app_controls
  add column if not exists environment text not null default 'staging'
    check (environment in ('staging', 'production'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_controls_environment_all_only') then
    alter table public.app_controls
      add constraint app_controls_environment_all_only check (platform = 'all' or environment = 'staging');
  end if;
end;
$$;

comment on column public.app_controls.environment is
  'staging or production (migration 127). Only the ''all'' row counts. The money functions refuse a Razorpay key of the other kind.';

-- ---- get_app_controls: the answer gains `environment` -----------------------
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
    'banner_link',         case when v_banner.platform is null then null else v_banner.banner_link end
  );
end;
$$;
revoke all on function public.get_app_controls(text, text) from public;
grant execute on function public.get_app_controls(text, text) to anon, authenticated, service_role;

-- ---- admin_set_app_control: `environment` can be changed --------------------
create or replace function public.admin_set_app_control(p_platform text, p_changes jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   uuid := auth.uid();
  v_claims  jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_bools   constant text[] := array['maintenance', 'signups_open', 'signin_phone', 'signin_google', 'signin_apple',
                                     'signin_password', 'posting', 'bidding', 'topups', 'withdrawals',
                                     'promotions', 'chat_photos', 'require_phone_verified'];
  v_texts   constant text[] := array['maintenance_message', 'min_version', 'update_url', 'banner_text',
                                     'banner_level', 'banner_link', 'banner_ends_at'];
  v_money   constant text[] := array['topups', 'withdrawals'];
  -- Switches that need the authenticator code: the money ones, and the environment.
  v_gated   constant text[] := array['topups', 'withdrawals', 'environment'];
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
    elsif v_key = 'environment' then
      if p_platform <> 'all' then raise exception 'environment is set on the all row only'; end if;
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('staging', 'production') then
        raise exception 'environment is staging or production';
      end if;
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
            -- Each number must fit a Postgres int (version_lt casts to int[]).
            if (v_val #>> '{}') !~ '^[0-9]{1,6}(\.[0-9]{1,6}){0,2}$' then
              raise exception 'min_version looks like 1.2.0 (each number up to 6 digits)';
            end if;
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

  -- Who may: money switches need money (full admin or finance); the rest, the
  -- environment included, need a full admin. Money switches and the environment
  -- also need the authenticator code.
  if exists (select 1 from unnest(v_changed) k where k <> all (v_money)) then
    if not private.staff_can(v_actor, 'admin') then
      raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(v_actor)
        using errcode = '42501';
    end if;
  elsif not private.staff_can(v_actor, 'money') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(v_actor)
      using errcode = '42501';
  end if;
  if v_changed && v_gated then
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
    require_phone_verified = v_row.require_phone_verified,
    environment = v_row.environment,
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
$$;
revoke all on function public.admin_set_app_control(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_app_control(text, jsonb, text) to authenticated;
