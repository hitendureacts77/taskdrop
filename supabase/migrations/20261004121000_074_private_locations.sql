-- 074 — Exact coordinates are private; the public columns carry a coarse value.
--
-- Audit findings F-02 and F-04 (docs/audit/SECURITY_FINDINGS.md).
--
-- profiles.loc_lat/loc_lng and tasks.loc_lat/loc_lng were readable by anyone
-- (profiles: every signed-in user and the anonymous role; open tasks: the same),
-- which published a person's saved/"live" location and a poster's exact job
-- location before any worker was chosen.
--
-- The app only ever uses other people's coordinates to sort by distance, and
-- only ever uses its own coordinates as a "near me" centre. A value rounded to
-- two decimals (~1.1 km) serves both, so the public columns keep their names and
-- types and no screen changes. The exact value moves to owner-only tables:
--   profile_private  -> the person
--   task_private     -> the poster, the assigned worker, and admins
--
-- A client that writes a new place sends exact coordinates; the trigger stores
-- them privately and rounds what is published. A client that sends back the
-- already-rounded value it read (for example, saving a listing edit) changes
-- nothing, so the exact value is not overwritten by its own rounding.

-- ------------------------------------------------------------------ tables --
create table if not exists public.profile_private (
  user_id    uuid primary key references auth.users (id) on delete cascade
             deferrable initially deferred,
  loc_lat    double precision,
  loc_lng    double precision,
  updated_at timestamptz not null default now()
);
alter table public.profile_private enable row level security;
drop policy if exists profile_private_own_read on public.profile_private;
create policy profile_private_own_read on public.profile_private
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.profile_private from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.profile_private from authenticated;
grant select on public.profile_private to authenticated;

create table if not exists public.task_private (
  task_id    uuid primary key references public.tasks (id) on delete cascade
             deferrable initially deferred,
  loc_lat    double precision,
  loc_lng    double precision,
  updated_at timestamptz not null default now()
);
alter table public.task_private enable row level security;
drop policy if exists task_private_parties_read on public.task_private;
create policy task_private_parties_read on public.task_private
  for select to authenticated
  using (
    private.is_admin()
    or exists (select 1 from public.tasks t
                where t.id = task_private.task_id and t.poster_id = (select auth.uid()))
    or private.user_assigned_task(task_private.task_id, (select auth.uid()))
  );
revoke all on public.task_private from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.task_private from authenticated;
grant select on public.task_private to authenticated;

-- ---------------------------------------------------------------- triggers --
create or replace function private.fuzz_profile_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.loc_lat is null or new.loc_lng is null then
    if tg_op = 'UPDATE'
       and (new.loc_lat is distinct from old.loc_lat or new.loc_lng is distinct from old.loc_lng) then
      delete from public.profile_private where user_id = new.id;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.loc_lat is distinct from old.loc_lat
     or new.loc_lng is distinct from old.loc_lng then
    insert into public.profile_private (user_id, loc_lat, loc_lng)
    values (new.id, new.loc_lat, new.loc_lng)
    on conflict (user_id) do update
      set loc_lat = excluded.loc_lat, loc_lng = excluded.loc_lng, updated_at = now();
    new.loc_lat := round(new.loc_lat::numeric, 2)::double precision;
    new.loc_lng := round(new.loc_lng::numeric, 2)::double precision;
  end if;
  return new;
end;
$$;

create or replace function private.fuzz_task_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.loc_lat is null or new.loc_lng is null then
    if tg_op = 'UPDATE'
       and (new.loc_lat is distinct from old.loc_lat or new.loc_lng is distinct from old.loc_lng) then
      delete from public.task_private where task_id = new.id;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.loc_lat is distinct from old.loc_lat
     or new.loc_lng is distinct from old.loc_lng then
    insert into public.task_private (task_id, loc_lat, loc_lng)
    values (new.id, new.loc_lat, new.loc_lng)
    on conflict (task_id) do update
      set loc_lat = excluded.loc_lat, loc_lng = excluded.loc_lng, updated_at = now();
    new.loc_lat := round(new.loc_lat::numeric, 2)::double precision;
    new.loc_lng := round(new.loc_lng::numeric, 2)::double precision;
  end if;
  return new;
end;
$$;

revoke all on function private.fuzz_profile_location() from public, anon, authenticated;
revoke all on function private.fuzz_task_location()    from public, anon, authenticated;

drop trigger if exists profiles_fuzz_location on public.profiles;
create trigger profiles_fuzz_location
  before insert or update of loc_lat, loc_lng on public.profiles
  for each row execute function private.fuzz_profile_location();

drop trigger if exists tasks_fuzz_location on public.tasks;
create trigger tasks_fuzz_location
  before insert or update of loc_lat, loc_lng on public.tasks
  for each row execute function private.fuzz_task_location();

-- ---------------------------------------------------------------- backfill --
-- Copy the exact value first, then round what is published. User triggers are
-- switched off for the rewrite so it does not bump notifications, ratings
-- guards or "updated" side effects, and so the trigger above cannot mistake
-- the rounded value for a new exact one.
alter table public.profiles disable trigger user;
insert into public.profile_private (user_id, loc_lat, loc_lng)
select id, loc_lat, loc_lng from public.profiles
 where loc_lat is not null and loc_lng is not null
on conflict (user_id) do nothing;
update public.profiles
   set loc_lat = round(loc_lat::numeric, 2)::double precision,
       loc_lng = round(loc_lng::numeric, 2)::double precision
 where loc_lat is not null and loc_lng is not null;
alter table public.profiles enable trigger user;

alter table public.tasks disable trigger user;
insert into public.task_private (task_id, loc_lat, loc_lng)
select id, loc_lat, loc_lng from public.tasks
 where loc_lat is not null and loc_lng is not null
on conflict (task_id) do nothing;
update public.tasks
   set loc_lat = round(loc_lat::numeric, 2)::double precision,
       loc_lng = round(loc_lng::numeric, 2)::double precision
 where loc_lat is not null and loc_lng is not null;
alter table public.tasks enable trigger user;
