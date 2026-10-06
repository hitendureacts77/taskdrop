-- 081 — Per-user quota for the places-search function.
--
-- Audit finding F-23 (docs/audit/SECURITY_FINDINGS.md). Place search used to
-- call Google from the app with EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, which put the
-- key in every web bundle and APK. The places-search edge function now holds
-- the key server-side; this caps how many searches one signed-in account can
-- make, so the key cannot be used as a free Google proxy.
--
-- Service role only (the edge function).

create table if not exists public.places_quota (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null default now(),
  calls             integer not null default 0
);
alter table public.places_quota enable row level security;   -- no policies: service role only
revoke all on public.places_quota from public, anon, authenticated;

-- Counts one call and says whether it is within the limit, in one statement.
create or replace function public.take_places_quota(p_user uuid, p_limit integer, p_window_minutes integer)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.places_quota as q (user_id, window_started_at, calls)
  values (p_user, now(), 1)
  on conflict (user_id) do update
     set calls = case when q.window_started_at < now() - make_interval(mins => p_window_minutes)
                      then 1 else q.calls + 1 end,
         window_started_at = case when q.window_started_at < now() - make_interval(mins => p_window_minutes)
                                  then now() else q.window_started_at end
  returning calls <= p_limit;
$$;
revoke all on function public.take_places_quota(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.take_places_quota(uuid, integer, integer) to service_role;
