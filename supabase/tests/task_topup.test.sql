-- The task top-up (migration 129): a poster may set it when posting, never
-- afterwards, it defaults to 0, and only 0 to 25 percent is accepted.
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/task_topup.test.sql

begin;

do $$
declare
  v_default text;
  v_poster  uuid;
  v_err     text;
begin
  -- Defaults to 0, so every older row and the old app read "no top-up".
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tasks' and column_name = 'topup_pct';
  if v_default is distinct from '0' then
    raise exception 'topup_pct should default to 0, got %', v_default;
  end if;

  -- Set when posting, never edited after.
  if not has_column_privilege('authenticated', 'public.tasks', 'topup_pct', 'INSERT') then
    raise exception 'a poster must be able to set topup_pct when posting';
  end if;
  if has_column_privilege('authenticated', 'public.tasks', 'topup_pct', 'UPDATE') then
    raise exception 'topup_pct must not be editable after posting';
  end if;

  -- Only 0 to 25 percent.
  select id into v_poster from auth.users limit 1;
  if v_poster is null then
    raise notice 'no user to post as; range check skipped';
    return;
  end if;
  begin
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, topup_pct)
    values (v_poster, 'services', 'Top-up range test', 5000, 60, 30);
    v_err := null;
  exception when check_violation then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'a 30%% top-up should be refused';
  end if;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, topup_pct)
  values (v_poster, 'services', 'Top-up range test', 5500, 60, 10);

  raise notice 'task_topup: ok';
end;
$$;

rollback;
