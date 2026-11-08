-- 159 -- People map (plan D20, docs/design/map-tab/PLAN.md): opt-in rounded spots, seen only by the people
-- you have finished a task with.
--
-- What this adds (forward-only; nothing existing is changed or dropped):
--   * public.map_sharing  one row per person: did they switch "Show my spot to my people" on, and when they
--                         agreed to which notice. Off by default. A person can read only their own row.
--   * public.map_spots    one row per sharing person: the 0.005-degree grid cell (about 550 m) they are in, and
--                         when it goes stale (15 minutes). NO policy and NO grant for anon or authenticated:
--                         only the functions below, which run with the owner's rights, ever touch it.
--   * public.map_sharing_set(on, notice)     switch sharing on or off; off deletes the spot at once.
--   * public.map_spot_beat(lat, lng)         store the caller's spot; the server snaps to the grid again.
--   * public.map_spot_clear()                delete the caller's spot ("Hide me now").
--   * public.map_my_people(lat, lng, km)     the caller's people who share a live spot, nearest first.
--   * a trigger on profiles.deleted_at: closing an account ends sharing and deletes the spot.
--
-- Who counts as "my people": the poster and the hired worker of a task that is COMPLETED or AUTO_COMPLETED,
-- in either direction, unless one has blocked the other, or the person is deleted or not onboarded.
-- Strangers and signed-out people (and guests, who use no real account) see nothing: there is no grant for them.
-- Exact device coordinates are never stored: the client snaps, and map_spot_beat snaps again.
--
-- Safe to run twice: create ... if not exists, create or replace, drop ... if exists.

-- ---------------------------------------------------------------------------------------- tables --

create table if not exists public.map_sharing (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  share_live     boolean not null default false,
  notice_version text not null,
  consented_at   timestamptz,
  withdrawn_at   timestamptz,
  updated_at     timestamptz not null default now()
);
comment on table public.map_sharing is
  'People map (D20): has this person agreed to show a rounded spot to their people. Off by default; read by its owner only.';

create table if not exists public.map_spots (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  cell_lat   double precision not null check (cell_lat between -90 and 90),
  cell_lng   double precision not null check (cell_lng between -180 and 180),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists map_spots_expires_idx on public.map_spots (expires_at);
comment on table public.map_spots is
  'People map (D20): one rounded cell per sharer, 15 min life. Never exact. No policy and no grant: functions only.';

alter table public.map_sharing enable row level security;
alter table public.map_spots   enable row level security;

revoke all on public.map_sharing from public, anon, authenticated;
revoke all on public.map_spots   from public, anon, authenticated;
grant select on public.map_sharing to authenticated;

drop policy if exists map_sharing_own on public.map_sharing;
create policy map_sharing_own on public.map_sharing
  for select to authenticated using (user_id = (select auth.uid()));
-- map_spots: deliberately no policy and no grant.

-- ------------------------------------------------------------------------------------- helpers ----

-- The centre of the 0.005-degree grid cell a coordinate falls in, to three decimals.
create or replace function private.snap_cell(p double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select round((round(p / 0.005) * 0.005)::numeric, 3)::double precision
$$;
revoke all on function private.snap_cell(double precision) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------- the switch ----

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
    -- Adults only (age gate, migration 082): the check must exist and have passed.
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
        updated_at     = now();

  -- Withdrawing is as easy as agreeing: the spot goes at once.
  if not p_on then
    delete from public.map_spots s where s.user_id = v_me;
  end if;

  return jsonb_build_object('share_live', p_on);
end;
$$;

-- --------------------------------------------------------------------------------------- beat ----

-- Store the caller's spot. Quiet on anything wrong (presence is a nicety): not signed in, sharing off, bad numbers.
-- One row per person, overwritten; the server snaps to the grid again so exact coordinates are never kept.
create or replace function public.map_spot_beat(p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_lat double precision;
  v_lng double precision;
begin
  if v_me is null or p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return;
  end if;
  if not exists (select 1 from public.map_sharing ms where ms.user_id = v_me and ms.share_live) then
    return;
  end if;
  if exists (select 1 from public.profiles p where p.id = v_me and p.deleted_at is not null) then
    return;
  end if;

  v_lat := private.snap_cell(p_lat);
  v_lng := private.snap_cell(p_lng);

  insert into public.map_spots as s (user_id, cell_lat, cell_lng, updated_at, expires_at)
  values (v_me, v_lat, v_lng, now(), now() + interval '15 minutes')
  on conflict (user_id) do update
    set cell_lat   = excluded.cell_lat,
        cell_lng   = excluded.cell_lng,
        updated_at = now(),
        expires_at = excluded.expires_at
   -- server-side throttle: a repeat from the same cell inside 50 seconds changes nothing
   where s.updated_at < now() - interval '50 seconds'
      or s.cell_lat <> excluded.cell_lat
      or s.cell_lng <> excluded.cell_lng;
end;
$$;

create or replace function public.map_spot_clear()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.map_spots s where s.user_id = auth.uid()
$$;

-- ----------------------------------------------------------------------------------- the read ----

-- The caller's people with a live, shared spot within p_radius_km of (p_lat, p_lng), nearest first.
-- Only cell centres are returned, never anything finer. Names are fine here: these people have worked together.
create or replace function public.map_my_people(p_lat double precision, p_lng double precision, p_radius_km double precision)
returns table (
  id uuid, display_name text, avatar_url text, last_seen_at timestamptz,
  lat double precision, lng double precision, km double precision, jobs integer, spot_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.display_name, q.avatar_url, q.last_seen_at, q.lat, q.lng, q.km, q.jobs, q.spot_at
    from (
      select p.id, p.display_name, p.avatar_url, p.last_seen_at,
             s.cell_lat as lat, s.cell_lng as lng,
             private.hunt_km(p_lat, p_lng, s.cell_lat, s.cell_lng)::double precision as km,
             pe.jobs, s.updated_at as spot_at
        from (
          select x.other, count(*)::integer as jobs
            from (
              -- tasks I posted, finished with a hired worker
              select a.worker_id as other
                from public.tasks t
                join public.assignments a on a.task_id = t.id
               where t.poster_id = auth.uid() and t.status in ('COMPLETED', 'AUTO_COMPLETED')
              union all
              -- tasks I was hired for, finished
              select t.poster_id as other
                from public.tasks t
                join public.assignments a on a.task_id = t.id
               where a.worker_id = auth.uid() and t.status in ('COMPLETED', 'AUTO_COMPLETED')
            ) x
           where x.other <> auth.uid()
           group by x.other
        ) pe
        join public.profiles p     on p.id = pe.other and p.deleted_at is null and p.onboarded_at is not null
        join public.map_sharing ms on ms.user_id = pe.other and ms.share_live
        join public.map_spots s    on s.user_id = pe.other and s.expires_at > now()
       where auth.uid() is not null
         and p_lat between -90 and 90 and p_lng between -180 and 180
         and p_radius_km is not null and p_radius_km between 0 and 50
         and not exists (
           select 1 from public.blocks b
            where (b.blocker_id = auth.uid() and b.blocked_id = pe.other)
               or (b.blocker_id = pe.other and b.blocked_id = auth.uid())
         )
    ) q
   where q.km <= p_radius_km
   order by q.km, q.id
   limit 50
$$;

-- ------------------------------------------------------------------------- closing an account ----

-- A closed account (soft delete, migration 087) stops sharing at once. A hard delete cascades through auth.users.
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
       set share_live = false, withdrawn_at = now(), updated_at = now()
     where ms.user_id = new.id and ms.share_live;
  end if;
  return new;
end;
$$;
revoke all on function private.map_forget_closed() from public, anon, authenticated;

drop trigger if exists map_forget_closed on public.profiles;
create trigger map_forget_closed
  after update of deleted_at on public.profiles
  for each row execute function private.map_forget_closed();

-- ----------------------------------------------------------------------------------- who calls ----

revoke all on function public.map_sharing_set(boolean, text) from public, anon, authenticated;
revoke all on function public.map_spot_beat(double precision, double precision) from public, anon, authenticated;
revoke all on function public.map_spot_clear() from public, anon, authenticated;
revoke all on function public.map_my_people(double precision, double precision, double precision) from public, anon, authenticated;

grant execute on function public.map_sharing_set(boolean, text) to authenticated;
grant execute on function public.map_spot_beat(double precision, double precision) to authenticated;
grant execute on function public.map_spot_clear() to authenticated;
grant execute on function public.map_my_people(double precision, double precision, double precision) to authenticated;
