-- 260: launch areas (admin v2 WP8a, plan 4.6 "launch areas and cities").
--
-- Where people can post jobs. An area is a circle: a name, a centre and a radius in km.
-- Two settings go with it:
--   launch_areas_on       false by default. While it is off, or while no area is active, the
--                         whole country is open, exactly as before this migration.
--   launch_areas_message  what people outside every area are told ("coming soon").
-- get_app_controls() hands both, and the active areas, to the app (migration 261 adds the key);
-- the api refuses createTask outside every area while it is on (supabase/functions/_shared/controls.ts).
--
-- Writes only through the three admin functions below: full admin (staff_can 'admin'), each one
-- writes an audit row. Reads: admins through RLS; the app gets the public part (name, centre,
-- radius) from get_app_controls, never the table.
--
-- Adds only: one table, two settings rows, three functions. Forward-only.

create table if not exists public.launch_areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  radius_km  numeric(6, 1) not null check (radius_km between 1 and 300),
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.launch_areas enable row level security;
revoke all on table public.launch_areas from public, anon, authenticated;
grant select on table public.launch_areas to authenticated;

drop policy if exists launch_areas_admin_read on public.launch_areas;
create policy launch_areas_admin_read on public.launch_areas
  for select to authenticated using (private.is_admin());

comment on table public.launch_areas is
  'Where people can post jobs (migration 260). Circles: name, centre, radius. Only used while settings.launch_areas_on is true. Written by admin_save_launch_area / admin_delete_launch_area only.';

insert into public.settings (key, value) values
  ('launch_areas_on', 'false'::jsonb),
  ('launch_areas_message', to_jsonb('TaskDrop is coming to your area soon. You can look around, but posting jobs opens here later.'::text))
on conflict (key) do nothing;

-- ---- add or change one area -------------------------------------------------
create or replace function public.admin_save_launch_area(
  p_id uuid, p_name text, p_lat double precision, p_lng double precision, p_radius_km numeric, p_active boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_row   public.launch_areas;
  v_old   public.launch_areas;
begin
  if not private.is_admin() or not private.staff_can(v_actor, 'admin') then
    raise exception 'Only a full admin can change launch areas' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 60 then raise exception 'Give the area a name (up to 60 letters)'; end if;
  if p_lat is null or p_lat not between -90 and 90 or p_lng is null or p_lng not between -180 and 180 then
    raise exception 'The centre must be a real place (latitude and longitude)';
  end if;
  if p_radius_km is null or p_radius_km not between 1 and 300 then raise exception 'The radius is 1 to 300 km'; end if;

  if p_id is null then
    insert into public.launch_areas (name, lat, lng, radius_km, active, created_by, updated_by)
    values (v_name, p_lat, p_lng, round(p_radius_km, 1), coalesce(p_active, true), v_actor, v_actor)
    returning * into v_row;
  else
    select * into v_old from public.launch_areas where id = p_id for update;
    if not found then raise exception 'That area is gone. Refresh the page.'; end if;
    update public.launch_areas set
      name = v_name, lat = p_lat, lng = p_lng, radius_km = round(p_radius_km, 1),
      active = coalesce(p_active, active), updated_by = v_actor, updated_at = now()
    where id = p_id
    returning * into v_row;
  end if;

  perform public.admin_log_event(
    'launch_area_saved', 'launch_areas:' || v_row.id,
    left(format('%s%s: %s (%s km, %s)',
      coalesce('reason: ' || left(nullif(btrim(p_reason), ''), 100) || '; ', ''),
      case when v_old.id is null then 'added' else 'changed' end,
      v_row.name, v_row.radius_km, case when v_row.active then 'on' else 'off' end), 500));
  return to_jsonb(v_row);
end;
$$;

-- ---- remove one area --------------------------------------------------------
create or replace function public.admin_delete_launch_area(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.launch_areas;
begin
  if not private.is_admin() or not private.staff_can(auth.uid(), 'admin') then
    raise exception 'Only a full admin can change launch areas' using errcode = '42501';
  end if;
  delete from public.launch_areas where id = p_id returning * into v_old;
  if v_old.id is null then raise exception 'That area is gone. Refresh the page.'; end if;
  perform public.admin_log_event(
    'launch_area_removed', 'launch_areas:' || v_old.id,
    left(format('%sremoved: %s (%s km)', coalesce('reason: ' || left(nullif(btrim(p_reason), ''), 100) || '; ', ''), v_old.name, v_old.radius_km), 500));
end;
$$;

-- ---- the on/off switch and the message ----------------------------------------
create or replace function public.admin_set_launch_areas(p_on boolean, p_message text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msg     text := nullif(btrim(coalesce(p_message, '')), '');
  v_old_on  jsonb;
  v_old_msg jsonb;
begin
  if not private.is_admin() or not private.staff_can(auth.uid(), 'admin') then
    raise exception 'Only a full admin can change launch areas' using errcode = '42501';
  end if;
  if p_on is null then raise exception 'Say on or off'; end if;
  if v_msg is not null and char_length(v_msg) > 300 then raise exception 'Keep the message under 300 letters'; end if;
  if p_on and not exists (select 1 from public.launch_areas where active) then
    raise exception 'Add at least one area before turning launch areas on';
  end if;

  select value into v_old_on from public.settings where key = 'launch_areas_on';
  select value into v_old_msg from public.settings where key = 'launch_areas_message';

  insert into public.settings (key, value) values ('launch_areas_on', to_jsonb(p_on))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if v_msg is not null then
    insert into public.settings (key, value) values ('launch_areas_message', to_jsonb(v_msg))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;

  perform public.admin_log_event(
    'launch_areas_changed', 'settings:launch_areas',
    left(format('%slaunch areas: %s -> %s%s',
      coalesce('reason: ' || left(nullif(btrim(p_reason), ''), 100) || '; ', ''),
      case when v_old_on = 'true'::jsonb then 'on' else 'off' end,
      case when p_on then 'on' else 'off' end,
      case when v_msg is not null and v_old_msg is distinct from to_jsonb(v_msg) then '; message changed' else '' end), 500));
  return jsonb_build_object('on', p_on, 'message', coalesce(v_msg, v_old_msg #>> '{}'));
end;
$$;

revoke all on function public.admin_save_launch_area(uuid, text, double precision, double precision, numeric, boolean, text) from public, anon;
revoke all on function public.admin_delete_launch_area(uuid, text) from public, anon;
revoke all on function public.admin_set_launch_areas(boolean, text, text) from public, anon;
grant execute on function public.admin_save_launch_area(uuid, text, double precision, double precision, numeric, boolean, text) to authenticated;
grant execute on function public.admin_delete_launch_area(uuid, text) to authenticated;
grant execute on function public.admin_set_launch_areas(boolean, text, text) to authenticated;
