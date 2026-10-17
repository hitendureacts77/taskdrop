-- 094 -- CRM follow-up tasks, customer owners and the lifecycle pipeline.
--
--   crm_tasks     things staff must do for a person ("call about the stuck
--                 withdrawal"): who owns it, when it is due, who finished it.
--                 Written only by the functions below (people area: admin,
--                 support). Not the same thing as a marketplace task/job.
--   crm_owners    which staff member looks after which customer.
--   admin_user_stages()
--                 one row per person with a lifecycle stage and an at-risk flag.
--   admin_pipeline_counts()
--                 how many people sit in each stage.
--
-- Stages, from the furthest the person has got:
--   repeat      two or more finished jobs (posted or worked)
--   completed   one finished job
--   funded      has a funded job, or has been hired
--   engaged     has posted a job, or sent an offer
--   signed_up   none of the above
-- at_risk: at least 'engaged', and not seen for 30 days.
--
-- Only adds: tables and functions. Nothing is dropped or renamed.

create table if not exists public.crm_tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users (id) on delete cascade,
  task_id      uuid references public.tasks (id) on delete set null,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  detail       text check (char_length(detail) <= 2000),
  due_at       timestamptz,
  owner_id     uuid references auth.users (id) on delete set null,
  status       text not null default 'open' check (status in ('open', 'done')),
  source       text not null default 'manual' check (source in ('manual', 'automation')),
  created_by   uuid references auth.users (id) on delete set null,
  completed_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists crm_tasks_owner_open_idx on public.crm_tasks (owner_id, due_at) where status = 'open';
create index if not exists crm_tasks_user_idx on public.crm_tasks (user_id, created_at desc);

create table if not exists public.crm_owners (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now()
);
create index if not exists crm_owners_owner_idx on public.crm_owners (owner_id);

do $$
declare t text;
begin
  foreach t in array array['crm_tasks', 'crm_owners'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_admin())', t || '_admin_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists require_staff_permission on public.%I', t);
    execute format('create trigger require_staff_permission before insert or update or delete on public.%I
                    for each row execute function private.require_staff_permission(%L)', t, 'people');
  end loop;
end $$;

-- ------------------------------------------------------------- follow-ups --

create or replace function public.crm_add_task(
  p_title text,
  p_user uuid default null,
  p_due timestamptz default null,
  p_owner uuid default null,
  p_detail text default null,
  p_task uuid default null
)
returns public.crm_tasks
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_row public.crm_tasks;
begin
  perform private.require_people_staff();
  if p_title is null or btrim(p_title) = '' then raise exception 'Write what needs doing'; end if;
  if p_user is not null and not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'That person no longer exists';
  end if;
  if p_owner is not null and not private.has_role(p_owner, 'admin') then
    raise exception 'A follow-up can only be given to a member of staff';
  end if;
  insert into public.crm_tasks (user_id, task_id, title, detail, due_at, owner_id, created_by)
  values (p_user, p_task, left(btrim(p_title), 200), left(nullif(btrim(coalesce(p_detail, '')), ''), 2000), p_due, coalesce(p_owner, auth.uid()), auth.uid())
  returning * into v_row;
  perform public.admin_log_event('crm.task_add', coalesce(p_user::text, v_row.id::text), left(btrim(p_title), 200));
  return v_row;
end;
$fn$;
revoke all on function public.crm_add_task(text, uuid, timestamptz, uuid, text, uuid) from public, anon;
grant execute on function public.crm_add_task(text, uuid, timestamptz, uuid, text, uuid) to authenticated;

create or replace function public.crm_complete_task(p_id uuid, p_reopen boolean default false)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_row public.crm_tasks;
begin
  perform private.require_people_staff();
  if p_reopen then
    update public.crm_tasks set status = 'open', completed_by = null, completed_at = null
     where id = p_id and status = 'done' returning * into v_row;
  else
    update public.crm_tasks set status = 'done', completed_by = auth.uid(), completed_at = now()
     where id = p_id and status = 'open' returning * into v_row;
  end if;
  if not found then raise exception 'That follow-up is not in the state you expected'; end if;
  perform public.admin_log_event(case when p_reopen then 'crm.task_reopen' else 'crm.task_done' end, coalesce(v_row.user_id::text, p_id::text), left(v_row.title, 200));
end;
$fn$;
revoke all on function public.crm_complete_task(uuid, boolean) from public, anon;
grant execute on function public.crm_complete_task(uuid, boolean) to authenticated;

create or replace function public.crm_assign_owner(p_users uuid[], p_owner uuid)
returns integer
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_n integer;
begin
  perform private.require_people_staff();
  if coalesce(array_length(p_users, 1), 0) = 0 then raise exception 'Choose at least one person'; end if;
  if array_length(p_users, 1) > 500 then raise exception 'At most 500 people at a time'; end if;
  if p_owner is null then
    delete from public.crm_owners where user_id = any (p_users);
    get diagnostics v_n = row_count;
  else
    if not private.has_role(p_owner, 'admin') then raise exception 'Customers can only be owned by a member of staff'; end if;
    insert into public.crm_owners (user_id, owner_id, assigned_by)
    select p.id, p_owner, auth.uid() from public.profiles p where p.id = any (p_users)
    on conflict (user_id) do update set owner_id = excluded.owner_id, assigned_by = excluded.assigned_by, assigned_at = now();
    get diagnostics v_n = row_count;
  end if;
  perform public.admin_log_event('crm.assign_owner', coalesce(p_owner::text, 'nobody'), format('%s people', v_n));
  return v_n;
end;
$fn$;
revoke all on function public.crm_assign_owner(uuid[], uuid) from public, anon;
grant execute on function public.crm_assign_owner(uuid[], uuid) to authenticated;

-- --------------------------------------------------------------- pipeline --

create or replace function public.admin_user_stages()
returns table (user_id uuid, stage text, at_risk boolean)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  return query
  with finished as (
    select t.poster_id as uid, t.id as tid from public.tasks t where t.status::text in ('COMPLETED', 'AUTO_COMPLETED')
    union
    select a.worker_id, a.task_id from public.assignments a join public.tasks t on t.id = a.task_id
     where t.status::text in ('COMPLETED', 'AUTO_COMPLETED')
  ),
  fin as (select uid, count(*) as n from finished group by uid),
  funded as (
    select t.poster_id as uid from public.tasks t where t.funded_at is not null
    union
    select a.worker_id from public.assignments a
  ),
  engaged as (
    select t.poster_id as uid from public.tasks t
    union
    select b.worker_id from public.bids b
  )
  select p.id,
         case
           when coalesce(f.n, 0) >= 2 then 'repeat'
           when coalesce(f.n, 0) = 1 then 'completed'
           when exists (select 1 from funded x where x.uid = p.id) then 'funded'
           when exists (select 1 from engaged x where x.uid = p.id) then 'engaged'
           else 'signed_up'
         end as stage,
         (coalesce(p.last_seen_at, p.created_at) < now() - interval '30 days'
          and (coalesce(f.n, 0) > 0 or exists (select 1 from engaged x where x.uid = p.id))) as at_risk
    from public.profiles p
    left join fin f on f.uid = p.id
   where p.deleted_at is null;
end;
$fn$;
revoke all on function public.admin_user_stages() from public, anon;
grant execute on function public.admin_user_stages() to authenticated;

create or replace function public.admin_pipeline_counts()
returns table (stage text, people bigint, at_risk bigint)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  return query
    select s.stage, count(*)::bigint, count(*) filter (where s.at_risk)::bigint
      from public.admin_user_stages() s
     group by s.stage;
end;
$fn$;
revoke all on function public.admin_pipeline_counts() from public, anon;
grant execute on function public.admin_pipeline_counts() to authenticated;
