-- 119 — broadcasts and segments can target a platform and an app version.
--
-- Phase 7, admin: "Broadcasts target by platform (web / Android / iOS) and app
-- version as well as segments". The audience is worked out in one place,
-- private.crm_segment_ids, which crm_segment_users, crm_save_segment and
-- crm_send_broadcast all call, so adding two keys there covers all three.
--
-- New optional keys in the criteria:
--   platform           'web' | 'android' | 'ios'
--                      the person has a signed-in install on that platform
--   app_version_below  e.g. '1.4.0'
--                      the person has an install (on that platform, when one is
--                      given) whose app version is older than this. Installs
--                      that never reported a version don't match.
--
-- Everything else is unchanged, so saved segments and the old admin keep working.

create or replace function private.crm_segment_ids(p_criteria jsonb)
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  c           jsonb   := coalesce(p_criteria, '{}'::jsonb);
  v_role      text    := coalesce(nullif(c ->> 'role', ''), 'any');
  v_joined    int     := nullif(c ->> 'joined_within_days', '')::int;
  v_inactive  int     := nullif(c ->> 'inactive_days', '')::int;
  v_tag       uuid    := nullif(c ->> 'tag_id', '')::uuid;
  v_min       bigint  := nullif(c ->> 'min_wallet_minor', '')::bigint;
  v_never     boolean := coalesce((c ->> 'never_posted')::boolean, false);
  v_live      boolean := coalesce((c ->> 'available_now')::boolean, false);
  v_susp      boolean := coalesce((c ->> 'include_suspended')::boolean, false);
  v_platform  text    := nullif(c ->> 'platform', '');
  v_below     text    := nullif(btrim(coalesce(c ->> 'app_version_below', '')), '');
begin
  if v_role not in ('any', 'worker', 'poster') then
    raise exception 'role must be any, worker or poster';
  end if;
  if v_platform is not null and v_platform not in ('web', 'android', 'ios') then
    raise exception 'platform must be web, android or ios';
  end if;
  -- version_lt casts each part to int, so refuse anything else before it runs.
  if v_below is not null and v_below !~ '^[0-9]{1,6}(\.[0-9]{1,6}){0,2}$' then
    raise exception 'app_version_below must look like 1.4.0';
  end if;
  return query
    select p.id
      from public.profiles p
     where (v_role = 'any'
            or (v_role = 'worker' and p.worker_onboarded_at is not null)
            or (v_role = 'poster' and p.worker_onboarded_at is null))
       and (v_joined is null or p.created_at >= now() - make_interval(days => v_joined))
       and (v_inactive is null or coalesce(p.last_seen_at, p.created_at) < now() - make_interval(days => v_inactive))
       and (v_tag is null or exists (select 1 from public.crm_user_tags ut where ut.user_id = p.id and ut.tag_id = v_tag))
       and (v_min is null or coalesce((select w.balance_minor + w.clearing_minor from public.wallets w where w.user_id = p.id), 0) >= v_min)
       and (not v_never or not exists (select 1 from public.tasks t where t.poster_id = p.id))
       and (not v_live or p.live_until > now())
       and (v_susp or not exists (select 1 from public.user_suspensions s where s.user_id = p.id and s.lifted_at is null))
       and ((v_platform is null and v_below is null)
            or exists (
              select 1
                from public.app_devices d
               where d.user_id = p.id
                 and (v_platform is null or d.platform = v_platform)
                 and (v_below is null
                      or (d.app_version is not null
                          and d.app_version ~ '^[0-9]{1,6}(\.[0-9]{1,6}){0,2}$'
                          and private.version_lt(d.app_version, v_below)))));
end;
$fn$;
revoke all on function private.crm_segment_ids(jsonb) from public, anon, authenticated;
