-- Admin live events (migrations 091, 091b, 091c): the feed fills itself, only
-- admins read it, no phone number, email or location reaches it, and nothing in
-- it can block the change that caused it.
--
-- Everything runs inside one transaction that is rolled back.
--
-- is_admin() is true for any psql/SQL-editor session (the operator rule, 040),
-- so it is narrowed to the real admin role for the length of this transaction,
-- exactly as column_lockdown.test.sql does.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_live_events.test.sql

begin;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = 'public' as
$$ select coalesce(private.has_role(auth.uid(), 'admin'), false) $$;

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

-- ---- fixtures: an admin, a poster, a worker, and a task with a quote ---------
do $$
declare
  v_admin  uuid := gen_random_uuid();
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_task   uuid;
  v_since  bigint := coalesce((select max(id) from public.admin_live_events), 0);
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'live+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_poster), (v_worker)) as u(id);
  -- handle_new_user() has already made each profile (named after the email),
  -- a poster and a worker role and a wallet; give them real names.
  update public.profiles set display_name = case id
    when v_admin then 'Live Admin' when v_poster then 'Live Poster' else 'Live Worker' end
  where id in (v_admin, v_poster, v_worker);
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_label)
  values (v_poster, 'services', 'Live feed fixture job', 50000, 120, '12, 4th Cross, Fixture Nagar')
  returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 45000, 120);

  insert into fx values ('admin', v_admin::text), ('poster', v_poster::text), ('worker', v_worker::text),
                        ('task', v_task::text), ('since', v_since::text);
end;
$$;

-- ---- 1. sign-ups, posts and quotes appear in the feed ------------------------
do $$
declare
  v_task  uuid   := (select v::uuid from fx where k = 'task');
  v_since bigint := (select v::bigint from fx where k = 'since');
  v_quote jsonb;
begin
  if (select count(*) from public.admin_live_events
       where id > v_since and kind = 'signup'
         and record_id in (select v::uuid from fx where k in ('admin', 'poster', 'worker'))) <> 3 then
    raise exception 'FAIL: sign-ups are missing from the feed';
  end if;
  if not exists (select 1 from public.admin_live_events
                  where id > v_since and kind = 'task_posted' and record_id = v_task
                    and summary ->> 'title' = 'Live feed fixture job'
                    and (summary ->> 'amount_minor')::bigint = 50000) then
    raise exception 'FAIL: the posted task is missing or wrong in the feed';
  end if;
  select summary into v_quote from public.admin_live_events
   where id > v_since and kind = 'quote' and record_id = v_task;
  if v_quote is null then raise exception 'FAIL: the quote is missing from the feed'; end if;
  if (v_quote ->> 'first')::boolean is not true then raise exception 'FAIL: the first quote is not marked first'; end if;
  if v_quote ->> 'who' <> 'Live Worker' then raise exception 'FAIL: the quote does not name the worker'; end if;
end;
$$;

-- ---- 2. a status change is recorded with from and to -------------------------
do $$
declare
  v_task  uuid   := (select v::uuid from fx where k = 'task');
  v_since bigint := (select v::bigint from fx where k = 'since');
begin
  update public.tasks set status = 'CANCELLED' where id = v_task;
  if not exists (select 1 from public.admin_live_events
                  where id > v_since and kind = 'task_status' and record_id = v_task
                    and summary ->> 'from' = 'OPEN' and summary ->> 'to' = 'CANCELLED') then
    raise exception 'FAIL: the status change is missing from the feed';
  end if;
  -- An update that leaves the status alone adds nothing.
  update public.tasks set status = 'CANCELLED' where id = v_task;
  if (select count(*) from public.admin_live_events
       where id > v_since and kind = 'task_status' and record_id = v_task) <> 1 then
    raise exception 'FAIL: an unchanged status was recorded';
  end if;
end;
$$;

-- ---- 3. no phone number, email or location reaches the feed -----------------
do $
declare
  v_since bigint := (select v::bigint from fx where k = 'since');
  v_phone uuid := gen_random_uuid();
begin
  -- A phone sign-in: a synthetic email whose first half is the number, which
  -- handle_new_user() copies into the profile name.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_phone, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'p919876543210@phone.taskdrop.app', '', now(), now(), now());
  if not exists (select 1 from public.admin_live_events
                  where id > v_since and kind = 'signup' and record_id = v_phone and summary ->> 'who' is null) then
    raise exception 'FAIL: a phone sign-up did not come through with no name';
  end if;
  if exists (select 1 from public.admin_live_events
              where id > v_since
                and (summary::text like '%9876543210%' or summary::text like '%@%' or summary ? 'phone' or summary ? 'email')) then
    raise exception 'FAIL: a phone number or email leaked into the feed';
  end if;
  -- A job's free-text location label (which can read like an address) stays out.
  if exists (select 1 from public.admin_live_events
              where id > v_since and (summary::text like '%Fixture Nagar%' or summary ? 'area' or summary ? 'loc_label')) then
    raise exception 'FAIL: a job location leaked into the feed';
  end if;
  -- The same rule for names shown beside jobs and quotes.
  update public.profiles set display_name = 'Call 9876543210' where id = v_phone;
  if private.admin_live_name(v_phone) is not null then
    raise exception 'FAIL: a name holding a phone number was shown';
  end if;
  if private.admin_live_clean_name('Asha K') <> 'Asha K' or private.admin_live_clean_name('  Ravi  ') <> 'Ravi' then
    raise exception 'FAIL: an ordinary name was changed';
  end if;
end;
$;

-- ---- 4. only admins read the feed and the counters ---------------------------
do $$
declare
  v_admin  uuid   := (select v::uuid from fx where k = 'admin');
  v_poster uuid   := (select v::uuid from fx where k = 'poster');
  v_since  bigint := (select v::bigint from fx where k = 'since');
  n integer;
  c jsonb;
begin
  perform pg_temp.become(v_poster);
  select count(*) into n from public.admin_live_events where id > v_since;
  if n > 0 then raise exception 'FAIL: a non-admin can read the feed'; end if;
  begin
    perform public.admin_live_counters();
    raise exception 'FAIL: a non-admin read the counters';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    insert into public.admin_live_events (kind, record_type) values ('fake', 'task');
    raise exception 'FAIL: a non-admin wrote to the feed';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.become(v_admin);
  select count(*) into n from public.admin_live_events where id > v_since;
  if n < 5 then raise exception 'FAIL: an admin cannot read the feed (saw %)', n; end if;
  begin
    insert into public.admin_live_events (kind, record_type) values ('fake', 'task');
    raise exception 'FAIL: an admin wrote to the feed directly';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  c := public.admin_live_counters();
  if not (c ? 'online_now' and c ? 'open_tasks' and c ? 'waiting_approval' and c ? 'disputes_open' and c ? 'quotes_last_hour') then
    raise exception 'FAIL: the counters are incomplete: %', c;
  end if;
  if (c ->> 'signups_today')::int < 3 then raise exception 'FAIL: today''s sign-ups are undercounted: %', c; end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 5. a broken feed never blocks the change itself -------------------------
do $$
declare
  v_poster uuid := (select v::uuid from fx where k = 'poster');
  v_task   uuid;
begin
  -- Simulate the feed failing outright.
  alter table public.admin_live_events add constraint live_test_block check (false) not valid;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Posted while the feed is down', 30000, 60)
  returning id into v_task;
  if v_task is null then raise exception 'FAIL: posting failed when the feed failed'; end if;
  alter table public.admin_live_events drop constraint live_test_block;
end;
$$;

rollback;
