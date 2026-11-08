-- 160 -- People map: an opt-in "everyone nearby" audience (owner decision 35b, 8 Nov 2026: strangers CAN see
-- live spots).
--
-- Migration 159 let only the people you have finished a task with see your spot. The owner decided that people
-- who choose to may also be seen by other TaskDrop members nearby. Nothing is widened by itself:
--   * every existing sharer stays on audience 'people' until they themselves pick "Everyone nearby";
--   * picking it needs the new notice (v2), is a second, separate choice, and is undone by switching sharing off
--     (off always puts the audience back to 'people', so switching on again later never re-shares widely);
--   * a stranger sees LESS than a person you worked with: first name only, no photo, no job count, and a coarser
--     spot (a 0.02-degree cell, about 2 km, not the 550 m one), within 25 km, nearest 30 at most. Their id is an
--     alias made for that viewer alone, never the real user id.
--   * the viewer must be a signed-in adult (age check passed); blocks hold both ways; closed accounts never show.
--
-- What this adds (forward-only; nothing existing is dropped or renamed):
--   * map_sharing.audience, map_sharing.audience_at
--   * private.snap_cell(value, step)     the same rounding with a chosen grid size
--   * public.map_audience_set(audience, notice)   choose who may see my spot (needs sharing already on)
--   * public.map_people_around(lat, lng, km)      my people (as before) PLUS opted-in strangers, tagged by `kind`
--   * map_sharing_set now also resets the audience to 'people' when sharing is switched off
--
-- Safe to run twice: add column if not exists, create or replace, drop ... if exists.

-- ---------------------------------------------------------------------------------------- column ----

alter table public.map_sharing add column if not exists audience    text not null default 'people';
alter table public.map_sharing add column if not exists audience_at timestamptz;

alter table public.map_sharing drop constraint if exists map_sharing_audience_check;
alter table public.map_sharing add constraint map_sharing_audience_check check (audience in ('people', 'everyone'));

comment on column public.map_sharing.audience is
  'People map: who may see my live spot. people = only those I finished a task with (default); everyone = also other signed-in adults nearby, coarser. Reset to people when sharing is switched off.';

-- ------------------------------------------------------------------------------------- helpers ----

-- The centre of the grid cell (of the given size, in degrees) a coordinate falls in, to three decimals.
create or replace function private.snap_cell(p double precision, p_step double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select round((round(p / p_step) * p_step)::numeric, 3)::double precision
$$;
revoke all on function private.snap_cell(double precision, double precision) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------- the switch ----

-- Same as 159, plus: switching off puts the audience back to 'people'.
create or replace function public.map_sharing_set(p_on boolean, p_notice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_notice text := coalesce(nullif(btrim(p_notice), ''), 'v1');
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'Choose on or off' using errcode = '22023';
  end if;
  if v_notice !~ '^v[0-9]{1,6}$' then
    raise exception 'Unknown notice version' using errcode = '22023';
  end if;

  if p_on then
    if not exists (select 1 from public.age_checks a where a.user_id = v_me and a.passed) then
      raise exception 'Only adults can share a spot' using errcode = '42501';
    end if;
    if exists (select 1 from public.profiles p where p.id = v_me and p.deleted_at is not null) then
      raise exception 'This account is closed' using errcode = '42501';
    end if;
  end if;

  insert into public.map_sharing as ms (user_id, share_live, notice_version, consented_at, withdrawn_at, updated_at)
  values (v_me, p_on, v_notice, case when p_on then now() end, case when not p_on then now() end, now())
  on conflict (user_id) do update
    set share_live     = excluded.share_live,
        notice_version = excluded.notice_version,
        consented_at   = case when p_on then now() else ms.consented_at end,
        withdrawn_at   = case when p_on then null else now() end,
        -- Off always drops the wider audience: agreeing again later starts from "my people" again.
        audience       = case when p_on then ms.audience else 'people' end,
        audience_at    = case when p_on then ms.audience_at else null end,
        updated_at     = now();

  if not p_on then
    delete from public.map_spots s where s.user_id = v_me;
  end if;

  return jsonb_build_object('share_live', p_on);
end;
$$;

-- Choose who may see my spot. Sharing must already be on. 'everyone' needs the v2 notice (or newer).
create or replace function public.map_audience_set(p_audience text, p_notice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_notice text := coalesce(nullif(btrim(p_notice), ''), 'v1');
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_audience is null or p_audience not in ('people', 'everyone') then
    raise exception 'Unknown audience' using errcode = '22023';
  end if;
  if v_notice !~ '^v[0-9]{1,6}$' then
    raise exception 'Unknown notice version' using errcode = '22023';
  end if;
  if p_audience = 'everyone' and substr(v_notice, 2)::integer < 2 then
    raise exception 'Please read the new notice first' using errcode = '22023';
  end if;
  if not exists (select 1 from public.map_sharing ms where ms.user_id = v_me and ms.share_live) then
    raise exception 'Switch sharing on first' using errcode = '22023';
  end if;
  if not exists (select 1 from public.age_checks a where a.user_id = v_me and a.passed) then
    raise exception 'Only adults can share a spot' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_me and p.deleted_at is not null) then
    raise exception 'This account is closed' using errcode = '42501';
  end if;

  update public.map_sharing ms
     set audience       = p_audience,
         audience_at    = case when p_audience = 'everyone' then now() else null end,
         notice_version = case when p_audience = 'everyone' then v_notice else ms.notice_version end,
         updated_at     = now()
   where ms.user_id = v_me;

  return jsonb_build_object('audience', p_audience);
end;
$$;

-- ----------------------------------------------------------------------------------- the read ----

-- Who is on the map around a point: my people (kind 'mine', as in 159) and opted-in strangers (kind 'nearby').
-- A stranger comes back with a first name only, no photo, no job count, and the coarse 0.02-degree cell.
create or replace function public.map_people_around(p_lat double precision, p_lng double precision, p_radius_km double precision)
returns table (
  id uuid, display_name text, avatar_url text, last_seen_at timestamptz,
  lat double precision, lng double precision, km double precision, jobs integer, spot_at timestamptz,
  kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  with args as (
    select auth.uid() as me
     where auth.uid() is not null
       and p_lat between -90 and 90 and p_lng between -180 and 180
       and p_radius_km is not null and p_radius_km between 0 and 50
  ),
  mine as (
    select pe.other as id, pe.jobs
      from args,
           lateral (
             select x.other, count(*)::integer as jobs
               from (
                 select a.worker_id as other
                   from public.tasks t
                   join public.assignments a on a.task_id = t.id
                  where t.poster_id = args.me and t.status in ('COMPLETED', 'AUTO_COMPLETED')
                 union all
                 select t.poster_id as other
                   from public.tasks t
                   join public.assignments a on a.task_id = t.id
                  where a.worker_id = args.me and t.status in ('COMPLETED', 'AUTO_COMPLETED')
               ) x
              where x.other <> args.me
              group by x.other
           ) pe
  ),
  mine_rows as (
    select p.id, p.display_name, p.avatar_url, p.last_seen_at,
           s.cell_lat as lat, s.cell_lng as lng,
           private.hunt_km(p_lat, p_lng, s.cell_lat, s.cell_lng)::double precision as km,
           m.jobs, s.updated_at as spot_at, 'mine'::text as kind
      from args
      join mine m                on true
      join public.profiles p     on p.id = m.id and p.deleted_at is null and p.onboarded_at is not null
      join public.map_sharing ms on ms.user_id = m.id and ms.share_live
      join public.map_spots s    on s.user_id = m.id and s.expires_at > now()
     where not exists (
             select 1 from public.blocks b
              where (b.blocker_id = args.me and b.blocked_id = m.id)
                 or (b.blocker_id = m.id and b.blocked_id = args.me))
  ),
  stranger_rows as (
    -- A stranger's id is an alias that only means something to this viewer (a hash of the two ids): the real user
    -- id is never handed out, so it cannot be used to look the person up elsewhere (name, photo, listings), and
    -- two viewers cannot compare notes about the same person.
    select md5(args.me::text || ':' || ms.user_id::text)::uuid as id,
           nullif(split_part(btrim(coalesce(p.display_name, '')), ' ', 1), '') as display_name,
           null::text as avatar_url,
           p.last_seen_at,
           private.snap_cell(s.cell_lat, 0.02::double precision) as lat,
           private.snap_cell(s.cell_lng, 0.02::double precision) as lng,
           private.hunt_km(p_lat, p_lng,
                           private.snap_cell(s.cell_lat, 0.02::double precision),
                           private.snap_cell(s.cell_lng, 0.02::double precision))::double precision as km,
           0 as jobs, s.updated_at as spot_at, 'nearby'::text as kind
      from args
      join public.map_sharing ms on ms.share_live and ms.audience = 'everyone' and ms.user_id <> args.me
      join public.map_spots s    on s.user_id = ms.user_id and s.expires_at > now()
      join public.profiles p     on p.id = ms.user_id and p.deleted_at is null and p.onboarded_at is not null
     where
       -- the viewer must be a signed-in adult with an open account
           exists (select 1 from public.age_checks a where a.user_id = args.me and a.passed)
       and exists (select 1 from public.profiles v where v.id = args.me and v.deleted_at is null)
       -- people already shown as "mine" are not listed twice
       and not exists (select 1 from mine m where m.id = ms.user_id)
       and not exists (
             select 1 from public.blocks b
              where (b.blocker_id = args.me and b.blocked_id = ms.user_id)
                 or (b.blocker_id = ms.user_id and b.blocked_id = args.me))
  ),
  mine_pick as (
    select * from mine_rows where km <= p_radius_km order by km, id limit 50
  ),
  stranger_pick as (
    select * from stranger_rows where km <= least(p_radius_km, 25) order by km, id limit 30
  )
  select u.id, u.display_name, u.avatar_url, u.last_seen_at, u.lat, u.lng, u.km, u.jobs, u.spot_at, u.kind
    from (
      select * from mine_pick
      union all
      select * from stranger_pick
    ) u
   order by (u.kind = 'mine') desc, u.km, u.id
$$;

-- ------------------------------------------------------------------------- closing an account ----

-- As in 159, and the wider audience goes too: an account that comes back starts from "my people" again.
create or replace function private.map_forget_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.map_spots s where s.user_id = new.id;
    update public.map_sharing ms
       set share_live = false, withdrawn_at = now(), audience = 'people', audience_at = null, updated_at = now()
     where ms.user_id = new.id and (ms.share_live or ms.audience <> 'people');
  end if;
  return new;
end;
$$;
revoke all on function private.map_forget_closed() from public, anon, authenticated;

-- ----------------------------------------------------------------------------------- who calls ----

revoke all on function public.map_sharing_set(boolean, text) from public, anon, authenticated;
revoke all on function public.map_audience_set(text, text) from public, anon, authenticated;
revoke all on function public.map_people_around(double precision, double precision, double precision) from public, anon, authenticated;

grant execute on function public.map_sharing_set(boolean, text) to authenticated;
grant execute on function public.map_audience_set(text, text) to authenticated;
grant execute on function public.map_people_around(double precision, double precision, double precision) to authenticated;
