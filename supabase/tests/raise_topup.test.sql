-- Migration 194: "Top up" on an open post. Only the poster, only an open request, only upward to a top-up step;
-- the offer moves with it from the price before any top-up; crew slots move together; the ₹1,00,000 cap holds.
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/raise_topup.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_admin() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_task   uuid;
  v_crew   uuid := gen_random_uuid();
  v_pct    smallint;
  v_price  bigint;
  v_failed boolean;
begin
  if has_function_privilege('anon', 'public.raise_task_topup(uuid, integer)', 'execute') then
    raise exception 'FAIL 1: anon can run raise_task_topup';
  end if;
  if has_column_privilege('authenticated', 'public.tasks', 'topup_pct', 'UPDATE') then
    raise exception 'FAIL 2: topup_pct became directly editable';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'topup+' || u.id || '@taskdrop.test', '', now() - interval '400 days', now() - interval '400 days', now()
  from (values (v_poster), (v_other)) as u(id);
  insert into public.profiles (id, display_name) values (v_poster, 'Topup Poster'), (v_other, 'Topup Other')
  on conflict (id) do nothing;

  -- ₹1,000 with no top-up → 10% → ₹1,100.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'raise me', 100000, 240) returning id into v_task;

  perform pg_temp.become(v_poster);
  select r.topup_pct, r.benchmark_minor into v_pct, v_price from public.raise_task_topup(v_task, 10) r;
  if v_pct <> 10 or v_price <> 110000 then
    raise exception 'FAIL 3: 0%%→10%% should give ₹1,100, got top-up % and price %', v_pct, v_price;
  end if;

  -- 10% → 20% is worked out from the ₹1,000 base: ₹1,200, not ₹1,320.
  select r.benchmark_minor into v_price from public.raise_task_topup(v_task, 20) r;
  if v_price <> 120000 then
    raise exception 'FAIL 4: 10%%→20%% should give ₹1,200, got %', v_price;
  end if;

  -- Never downward, never sideways, never off the steps.
  foreach v_pct in array array[20, 15, 7, 30, 0]::smallint[] loop
    v_failed := false;
    begin
      perform public.raise_task_topup(v_task, v_pct);
    exception when others then v_failed := true;
    end;
    if not v_failed then
      raise exception 'FAIL 5: a top-up to % percent was accepted', v_pct;
    end if;
  end loop;

  -- Someone else cannot top up my task.
  perform pg_temp.become(v_other);
  v_failed := false;
  begin
    perform public.raise_task_topup(v_task, 25);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 6: a stranger topped up someone else''s task';
  end if;

  -- Not once it is no longer open.
  perform pg_temp.as_admin();
  update public.tasks set status = 'CANCELLED' where id = v_task;
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    perform public.raise_task_topup(v_task, 25);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 7: a cancelled task was topped up';
  end if;

  -- The ₹1,00,000 cap: ₹95,000 + 10% would be ₹1,04,500.
  perform pg_temp.as_admin();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'too big', 9500000, 240) returning id into v_task;
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    perform public.raise_task_topup(v_task, 10);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 8: a top-up went over ₹1,00,000';
  end if;

  -- A crew of two moves together.
  perform pg_temp.as_admin();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, crew_id, crew_size, crew_slot)
  values (v_poster, 'services', 'crew 1', 50000, 240, v_crew, 2, 1),
         (v_poster, 'services', 'crew 2', 50000, 240, v_crew, 2, 2);
  select id into v_task from public.tasks where crew_id = v_crew and crew_slot = 1;
  perform pg_temp.become(v_poster);
  perform public.raise_task_topup(v_task, 5);
  perform pg_temp.as_admin();
  if exists (select 1 from public.tasks where crew_id = v_crew and (topup_pct <> 5 or benchmark_minor <> 52500)) then
    raise exception 'FAIL 9: crew slots did not move together to 5%% (₹525 each)';
  end if;
end $$;

rollback;
