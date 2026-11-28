-- 243: a daily cap for Google place lookups made as a BACKUP (task 1.21 row F3).
--
-- OpenStreetMap's two free services (Nominatim and Photon) answer 403 to every call from the Supabase
-- servers since 27 Nov 2026, so guests could not search an area and no dropped pin got an area name.
-- places-search now asks Google when both refuse. Those calls are not tied to one account (guests, and the
-- area name of a pin), so they get their own daily counter here, and they still count against the
-- shared Google total of migration 153 (places_daily_cap, 3,000 a day).

create table if not exists private.places_backup_daily (
  day   date primary key,
  calls integer not null default 0
);
alter table private.places_backup_daily enable row level security;
revoke all on table private.places_backup_daily from public, anon, authenticated;

-- 'ok' = one Google call may be made; 'backup_cap' / 'total_cap' = do not call Google today.
create or replace function public.take_places_backup()
returns text
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_today  date := private.sms_today();
  v_bcap   integer := greatest(floor(private.cap_setting('places_backup_daily_cap', 600))::integer, 1);
  v_cap    integer := greatest(floor(private.cap_setting('places_daily_cap', 3000))::integer, 1);
  v_b      integer;
  v_total  integer;
begin
  perform private.assert_service_caller();

  insert into private.places_backup_daily as b (day, calls) values (v_today, 1)
  on conflict (day) do update set calls = b.calls + 1
   where b.calls < v_bcap
  returning b.calls into v_b;
  if v_b is null then return 'backup_cap'; end if;

  insert into private.places_daily as d (day, calls) values (v_today, 1)
  on conflict (day) do update set calls = d.calls + 1
   where d.calls < v_cap
  returning d.calls into v_total;
  if v_total is null then
    update private.places_backup_daily set calls = calls - 1 where day = v_today and calls > 0;
    return 'total_cap';
  end if;

  if v_b = 1 then
    delete from private.places_backup_daily where day < v_today - 30;
  end if;
  return 'ok';
end;
$$;

revoke all on function public.take_places_backup() from public, anon, authenticated;
grant execute on function public.take_places_backup() to service_role;
