-- Moderation, CRM follow-ups, staff performance and analytics (migrations
-- 093 to 096): who may do what, that a hidden task disappears for others, and
-- that the read-only reports run.
--
-- Everything runs inside one transaction that is rolled back, so the test
-- leaves no rows behind.
--
-- Note: private.is_admin() is true for the operator connection (session_user
-- postgres), which is what psql and the Supabase SQL runner use, so this test
-- cannot show that an ordinary person is refused by is_admin() itself. Where it
-- checks a non-admin it accepts either refusal (is_admin, or the staff-role
-- check that follows it, which does name a person with no role).
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_growth.test.sql

begin;

create or replace function pg_temp.become(p_user uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
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

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

do $$
declare
  v_full    uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_poster  uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_task    uuid;
  v_report  uuid;
  v_crm     public.crm_tasks;
  v_err     text;
  v_n       int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'growth+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_finance), (v_support), (v_poster), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'G Full'), (v_finance, 'G Finance'), (v_support, 'G Support'), (v_poster, 'G Poster'), (v_other, 'G Other')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_finance, v_support]) u on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role) values (v_finance, 'finance'), (v_support, 'support');

  -- A job to hide. Inserted as the owner; the other columns take their defaults.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'growth test job', 10000, 60) returning id into v_task;

  -- ---- reporting: anyone signed in; not yourself; one open report each -------
  perform pg_temp.become(v_other);
  v_report := public.report_content('task', v_task, 'looks like a scam');
  if public.report_content('task', v_task, 'again') is distinct from v_report then
    raise exception 'FAIL: a second report on the same job made a second row';
  end if;
  perform pg_temp.become(v_poster);
  v_err := pg_temp.try(format('select public.report_content(''user'', %L, ''me'')', v_poster));
  if coalesce(v_err, '') not like '%yourself%' then raise exception 'FAIL: reported yourself (%)', v_err; end if;

  -- ---- an ordinary person cannot read or work the queue ----------------------
  perform pg_temp.become(v_other);
  v_err := pg_temp.try(format('select public.admin_resolve_report(%L, ''dismissed'')', v_report));
  if coalesce(v_err, '') not like '%Admins only%' and coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: a non-admin handled a report (%)', v_err; end if;

  -- ---- finance may not moderate; support may --------------------------------
  perform pg_temp.become(v_finance);
  v_err := pg_temp.try(format('select public.admin_hide_task(%L, ''spam'')', v_task));
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: finance hid a job (%)', v_err; end if;

  perform pg_temp.become(v_support);
  perform public.admin_hide_task(v_task, 'spam');

  -- ---- a hidden job disappears for others, not for its poster or admins -------
  -- The operator connection passes is_admin(), so another person's view cannot be
  -- tested here; check the pieces the restrictive policy is made of instead.
  if not private.task_is_hidden(v_task) then raise exception 'FAIL: a hidden job was not reported as hidden'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks_hide_moderated' and permissive = 'RESTRICTIVE' and cmd = 'SELECT') then
    raise exception 'FAIL: the restrictive hide policy is missing from tasks';
  end if;
  perform pg_temp.become(v_poster);
  select count(*) into v_n from public.tasks where id = v_task;
  if v_n <> 1 then raise exception 'FAIL: the poster lost sight of their own hidden job'; end if;
  perform pg_temp.become(v_support);
  select count(*) into v_n from public.tasks where id = v_task;
  if v_n <> 1 then raise exception 'FAIL: an admin could not see a hidden job'; end if;

  perform public.admin_resolve_report(v_report, 'actioned', 'hidden');
  v_err := pg_temp.try(format('select public.admin_resolve_report(%L, ''dismissed'')', v_report));
  if coalesce(v_err, '') not like '%already handled%' then raise exception 'FAIL: a report was handled twice (%)', v_err; end if;

  perform public.admin_unhide_task(v_task);
  if private.task_is_hidden(v_task) then raise exception 'FAIL: an unhidden job stayed hidden'; end if;

  -- ---- follow-ups: support yes, finance no, finishing is recorded -------------
  perform pg_temp.become(v_finance);
  v_err := pg_temp.try(format('select public.crm_add_task(''call them'', %L)', v_poster));
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: finance added a follow-up (%)', v_err; end if;

  perform pg_temp.become(v_support);
  v_crm := public.crm_add_task('call them', v_poster, now() + interval '1 day');
  if v_crm.owner_id <> v_support then raise exception 'FAIL: a follow-up did not default to its creator'; end if;
  perform public.crm_complete_task(v_crm.id);
  if not exists (select 1 from public.crm_tasks where id = v_crm.id and status = 'done' and completed_by = v_support) then
    raise exception 'FAIL: finishing a follow-up was not recorded';
  end if;
  v_err := pg_temp.try(format('select public.crm_complete_task(%L)', v_crm.id));
  if coalesce(v_err, '') not like '%not in the state%' then raise exception 'FAIL: a follow-up was finished twice (%)', v_err; end if;
  v_err := pg_temp.try(format('select public.crm_assign_owner(array[%L]::uuid[], %L)', v_poster, v_other));
  if coalesce(v_err, '') not like '%member of staff%' then raise exception 'FAIL: a customer was given to a non-staff owner (%)', v_err; end if;
  if public.crm_assign_owner(array[v_poster], v_support) <> 1 then raise exception 'FAIL: assigning an owner'; end if;

  -- ---- the read-only reports run for an admin and are refused to others -------
  perform pg_temp.become(v_full);
  if not exists (select 1 from public.admin_staff_performance(now() - interval '7 days', now() + interval '1 day') p where p.user_id = v_support and p.tasks_done = 1 and p.customers_owned = 1) then
    raise exception 'FAIL: staff performance did not count the finished follow-up and owned customer';
  end if;
  perform 1 from public.admin_business_daily(current_date - 7, current_date);
  perform 1 from public.admin_funnel(current_date - 30, current_date);
  perform 1 from public.admin_retention(8);
  perform 1 from public.admin_promotion_roi(current_date - 30, current_date);
  perform 1 from public.admin_reconcile(current_date - 30, current_date);
  if not exists (select 1 from public.admin_pipeline_counts() c where c.stage = 'engaged') then
    raise exception 'FAIL: the pipeline missed the person who posted a job';
  end if;

  perform pg_temp.as_owner();
  raise notice 'admin_growth: all checks passed';
end;
$$;

rollback;
