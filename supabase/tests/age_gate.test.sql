-- Age gate (migration 082). The minimum is 18.
--
-- An adult passes; a seventeen-year-old does not; someone under the minimum with an empty account is deleted;
-- someone under the minimum with history is suspended, not deleted; the answer
-- cannot be changed; a client cannot finish onboarding without passing, nor
-- write the age_checks table directly.
--
-- Everything runs inside one transaction that is rolled back, so the test
-- leaves no rows behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/age_gate.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create temp table fx (k text primary key, v text);
grant all on fx to public;

do $$
declare
  v_adult uuid := gen_random_uuid();
  v_child uuid := gen_random_uuid();
  v_kid_poster uuid := gen_random_uuid();
  v_teen uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'age+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_adult), (v_child), (v_kid_poster), (v_teen)) as u(id);

  insert into public.profiles (id, display_name) values
    (v_adult, 'Adult'), (v_child, 'Child'), (v_kid_poster, 'Kid poster'), (v_teen, 'Teen')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_adult), (v_child), (v_kid_poster), (v_teen) on conflict (user_id) do nothing;

  -- History that other people could depend on.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_kid_poster, 'services', 'Age gate fixture', 100000, 240);

  insert into fx values ('adult', v_adult::text), ('child', v_child::text), ('kid_poster', v_kid_poster::text), ('teen', v_teen::text);
end;
$$;

-- ---- 1. onboarding is refused before the age check -------------------------
do $$
declare v_adult uuid := (select v::uuid from fx where k = 'adult');
begin
  perform pg_temp.become(v_adult);
  begin
    update public.profiles set onboarded_at = now() where id = v_adult;
    raise exception 'FAIL: onboarding completed without an age check';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 2. clients cannot write age_checks ------------------------------------
do $$
declare v_adult uuid := (select v::uuid from fx where k = 'adult');
begin
  perform pg_temp.become(v_adult);
  begin
    insert into public.age_checks (user_id, birth_date, passed, min_age) values (v_adult, '1990-01-01', true, 13);
    raise exception 'FAIL: a client wrote its own age check';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 3. an adult passes, and can then finish onboarding --------------------
do $$
declare
  v_adult uuid := (select v::uuid from fx where k = 'adult');
  v_out text;
  v_n int;
begin
  perform pg_temp.become(v_adult);
  v_out := public.record_birth_date('1990-05-17');
  if v_out <> 'ok' then raise exception 'FAIL: an adult got %', v_out; end if;
  update public.profiles set onboarded_at = now() where id = v_adult;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAIL: the adult could not finish onboarding after passing'; end if;
  if not exists (select 1 from public.age_checks where user_id = v_adult and passed) then
    raise exception 'FAIL: the adult cannot read their own age check';
  end if;
  -- A second, under-age answer changes nothing.
  v_out := public.record_birth_date((current_date - interval '5 years')::date);
  if v_out <> 'ok' then raise exception 'FAIL: a second answer overrode the first (%)', v_out; end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 4. an empty under-age account is deleted ------------------------------
do $$
declare
  v_child uuid := (select v::uuid from fx where k = 'child');
  v_out text;
begin
  perform pg_temp.become(v_child);
  v_out := public.record_birth_date((current_date - interval '10 years')::date);
  perform pg_temp.as_owner();
  if v_out <> 'blocked' then raise exception 'FAIL: a ten-year-old got %', v_out; end if;
  if exists (select 1 from auth.users where id = v_child) then
    raise exception 'FAIL: the under-age account still exists';
  end if;
  if exists (select 1 from public.profiles where id = v_child) then
    raise exception 'FAIL: the under-age profile was not removed with the account';
  end if;
end;
$$;

-- ---- 5. an under-age account with history is suspended, not deleted --------
do $$
declare
  v_kid uuid := (select v::uuid from fx where k = 'kid_poster');
  v_out text;
begin
  perform pg_temp.become(v_kid);
  v_out := public.record_birth_date((current_date - interval '12 years')::date);
  perform pg_temp.as_owner();
  if v_out <> 'blocked' then raise exception 'FAIL: a twelve-year-old got %', v_out; end if;
  if not exists (select 1 from auth.users where id = v_kid and banned_until > now() + interval '1 year') then
    raise exception 'FAIL: the under-age account with history was not banned';
  end if;
  if not exists (select 1 from public.user_suspensions where user_id = v_kid and lifted_at is null) then
    raise exception 'FAIL: no suspension was recorded for the admin to review';
  end if;
  if not exists (select 1 from public.tasks where poster_id = v_kid) then
    raise exception 'FAIL: the task was deleted with the account';
  end if;
end;
$$;

-- ---- 6. nonsense dates are refused -----------------------------------------
do $$
declare v_adult uuid := (select v::uuid from fx where k = 'adult');
begin
  perform pg_temp.become(v_adult);
  begin
    perform public.record_birth_date((current_date + 1)::date);
    raise exception 'FAIL: a birth date in the future was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 7. seventeen is under the minimum ---------------------------------------
do $$
declare
  v_teen uuid := (select v::uuid from fx where k = 'teen');
  v_out text;
begin
  perform pg_temp.become(v_teen);
  v_out := public.record_birth_date((current_date - interval '17 years' - interval '11 months')::date);
  perform pg_temp.as_owner();
  if v_out <> 'blocked' then raise exception 'FAIL: a seventeen-year-old got %', v_out; end if;
  if exists (select 1 from auth.users where id = v_teen) then
    raise exception 'FAIL: the seventeen-year-old''s empty account still exists';
  end if;
end;
$$;

-- ---- 8. n8n hears of a sign-up only once the age check has passed -----------
do $$
declare
  v_adult uuid := (select v::uuid from fx where k = 'adult');
  v_child uuid := (select v::uuid from fx where k = 'child');
  v_teen  uuid := (select v::uuid from fx where k = 'teen');
begin
  if not exists (select 1 from private.automation_log
                  where kind = 'user.signed_up' and payload->'data'->>'user_id' = v_adult::text) then
    raise exception 'FAIL: the adult''s sign-up was not announced after passing';
  end if;
  if exists (select 1 from private.automation_log
              where kind = 'user.signed_up' and payload->'data'->>'user_id' in (v_child::text, v_teen::text)) then
    raise exception 'FAIL: an under-age sign-up was announced to n8n';
  end if;
end;
$$;

rollback;
