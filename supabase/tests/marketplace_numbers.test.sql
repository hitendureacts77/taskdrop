-- The two marketplace numbers for the admin Reports page (migration 141, plan
-- task 3.3b): time to first offer and fill rate. Known timings go in, known
-- numbers must come out. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/marketplace_numbers.test.sql

begin;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_w1     uuid := gen_random_uuid();
  v_w2     uuid := gen_random_uuid();
  v_a      uuid;
  v_b      uuid;
  v_c      uuid;
  v_t0     timestamptz := now() - interval '1 hour';
  v_row    record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'mn+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_w1), (v_w2)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'MN Poster'), (v_w1, 'MN W1'), (v_w2, 'MN W2')
  on conflict (id) do nothing;

  -- Three tasks in a category of their own and an area of their own:
  --   A: first offer after 600 s, then another at 1800 s, and it was finished
  --   B: first offer after 1200 s
  --   C: no offer at all
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, loc_label, created_at)
  values (v_poster, 'services', 'mn task A', 10000, 60, 'MN test category', 'MN test area', v_t0) returning id into v_a;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, loc_label, created_at)
  values (v_poster, 'services', 'mn task B', 10000, 60, 'MN test category', 'MN test area', v_t0) returning id into v_b;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, loc_label, created_at)
  values (v_poster, 'services', 'mn task C', 10000, 60, 'MN test category', 'MN test area', v_t0) returning id into v_c;
  update public.tasks set status = 'COMPLETED', completed_at = v_t0 + interval '50 minutes' where id = v_a;

  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, created_at)
  values (v_a, v_w1, 10000, 60, v_t0 + interval '1800 seconds'),
         (v_a, v_w2, 10000, 60, v_t0 + interval '600 seconds'),
         (v_b, v_w1, 10000, 60, v_t0 + interval '1200 seconds');

  -- ---- an admin sees the right numbers ---------------------------------------
  perform pg_temp.as_owner();   -- the operator connection counts as an admin (see admin_growth.test.sql)

  select * into v_row from public.admin_marketplace_numbers(current_date - 1, current_date)
   where group_kind = 'category' and group_label = 'MN test category';
  if v_row.tasks_posted <> 3 then raise exception 'FAIL: posted should be 3, got %', v_row.tasks_posted; end if;
  if v_row.tasks_with_offer <> 2 then raise exception 'FAIL: with an offer should be 2 (the task with no offer must not count), got %', v_row.tasks_with_offer; end if;
  if v_row.tasks_filled <> 1 then raise exception 'FAIL: filled should be 1, got %', v_row.tasks_filled; end if;
  -- first offers were 600 s (A, not the later 1800 s one) and 1200 s (B): the median is 900 s.
  -- Task C has no offer and must not pull the median to 0.
  if round(v_row.median_first_offer_seconds) <> 900 then raise exception 'FAIL: median first offer should be 900 s, got %', v_row.median_first_offer_seconds; end if;

  select * into v_row from public.admin_marketplace_numbers(current_date - 1, current_date)
   where group_kind = 'area' and group_label = 'MN test area';
  if v_row.tasks_posted is distinct from 3 then raise exception 'FAIL: the area row is missing or wrong (%)', v_row.tasks_posted; end if;

  select * into v_row from public.admin_marketplace_numbers(current_date - 1, current_date) where group_kind = 'all';
  if v_row.tasks_posted < 3 then raise exception 'FAIL: the overall row lost tasks'; end if;

  -- a group where nothing got an offer has no median (not 0)
  update public.tasks set category = 'MN silent category' where id = v_c;
  select * into v_row from public.admin_marketplace_numbers(current_date - 1, current_date)
   where group_kind = 'category' and group_label = 'MN silent category';
  if v_row.tasks_posted <> 1 or v_row.tasks_with_offer <> 0 or v_row.median_first_offer_seconds is not null then
    raise exception 'FAIL: a group with no offers should have a blank median, got % / %', v_row.tasks_with_offer, v_row.median_first_offer_seconds;
  end if;

  -- a bad range is refused
  begin
    perform 1 from public.admin_marketplace_numbers(current_date, current_date - 3);
    raise exception 'FAIL: an upside-down date range was accepted';
  exception when others then
    if sqlerrm not like '%valid date range%' then raise; end if;
  end;

  -- (An ordinary person is refused by private.is_admin(), but a test session runs as postgres, which
  -- migration 040 lets through every admin check, so that refusal cannot be shown here; see admin_growth.test.sql.)

  raise notice 'marketplace_numbers: all checks passed';
end;
$$;

rollback;
