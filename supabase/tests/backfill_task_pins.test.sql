-- Older tasks stop publishing their exact pin (migration 164, debug loop B38).
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/backfill_task_pins.test.sql

begin;

do $$
declare
  v_poster  uuid := gen_random_uuid();
  v_old     uuid;   -- written with triggers off: exact public pin, no private row
  v_kept    uuid;   -- already has a private row: must not be touched
  v_normal  uuid;   -- written through the trigger: already rounded
  v_n       integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_poster, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'pin+' || v_poster || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_poster, 'Pin Poster') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster) on conflict (user_id) do nothing;

  -- The trigger rounds and keeps the exact spot.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, loc_lat, loc_lng)
  values (v_poster, 'services', 'pin normal', 100000, 240, 'Plumbing', 17.43851, 78.44822) returning id into v_normal;

  -- The B38 shape: written with triggers off.
  alter table public.tasks disable trigger user;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, loc_lat, loc_lng)
  values (v_poster, 'services', 'pin old', 100000, 240, 'Plumbing', 17.4123, 78.4567) returning id into v_old;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, loc_lat, loc_lng)
  values (v_poster, 'services', 'pin kept', 100000, 240, 'Plumbing', 17.3987, 78.4721) returning id into v_kept;
  alter table public.tasks enable trigger user;
  insert into public.task_private (task_id, loc_lat, loc_lng) values (v_kept, 1.5, 2.5);

  assert not exists (select 1 from public.task_private where task_id = v_old), 'the old task starts with no private row';

  v_n := private.backfill_task_pins();
  assert v_n >= 1, 'the backfill found the old task';

  -- The old task: exact spot kept privately, public pin rounded.
  assert (select loc_lat from public.task_private where task_id = v_old) = 17.4123, 'exact latitude kept privately';
  assert (select loc_lng from public.task_private where task_id = v_old) = 78.4567, 'exact longitude kept privately';
  assert (select loc_lat from public.tasks where id = v_old) = 17.41, 'public latitude rounded';
  assert (select loc_lng from public.tasks where id = v_old) = 78.46, 'public longitude rounded';

  -- A task that already had a private row is left exactly as it was.
  assert (select loc_lat from public.tasks where id = v_kept) = 17.3987, 'a task with a private row is not touched';
  assert (select loc_lat from public.task_private where task_id = v_kept) = 1.5, 'its private row is not touched';

  -- The trigger-written task is unchanged.
  assert (select loc_lat from public.task_private where task_id = v_normal) = 17.43851, 'normal task private spot unchanged';
  assert (select loc_lat from public.tasks where id = v_normal) = 17.44, 'normal task public pin unchanged';

  -- No public pin is left unrounded among the rows the backfill created.
  assert (
    select count(*) from public.tasks t
      join public.task_private tp on tp.task_id = t.id
     where t.id = v_old
       and (t.loc_lat <> round(t.loc_lat::numeric, 2)::double precision
            or t.loc_lng <> round(t.loc_lng::numeric, 2)::double precision)
  ) = 0, 'no unrounded public pin for rows it created';

  -- A second run changes nothing.
  assert private.backfill_task_pins() = 0, 'a second run finds nothing to do';
  assert (select loc_lat from public.task_private where task_id = v_old) = 17.4123, 'exact spot survives a second run';
end;
$$;

rollback;
