-- ===========================================================================
-- Migration 107: an admin-entered minimum app version has to fit the comparison
--
-- CodeRabbit (PR 28): migration 106 limited the version a caller sends to six
-- digits per part, but admin_set_app_control still accepted any number of digits
-- for min_version. An overlong stored minimum would make private.version_lt
-- overflow its int cast. The same limit now applies when the minimum is saved.
--
-- Only the min_version pattern and its message change; the function is
-- otherwise as left by migration 097.
-- ===========================================================================

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
    require_phone_verified = v_row.require_phone_verified,
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
