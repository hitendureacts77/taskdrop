-- 093 -- Moderation: reports, blocks, and hiding a task.
--
-- Anyone signed in can report a person, task, message or review, and block
-- another person. Staff with the people area (admin, support) work the report
-- queue, and can hide a task: a hidden task disappears for everyone except its
-- poster and admins, through a RESTRICTIVE row-level-security policy on tasks,
-- so every read that goes through the caller's own session honours it, with no
-- change to any existing function.
--
-- Not in this migration, on purpose: cancel-with-refund and pausing a
-- promotion (they move money and need their own review), and applying blocks
-- to chat and offer lists (the table and functions are here; the app lists do
-- not read it yet).
--
-- Only adds: tables, a policy, functions. Nothing is dropped or renamed.

-- ----------------------------------------------------------------- tables --

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('user', 'task', 'message', 'review')),
  target_id   uuid not null,
  reason      text not null check (char_length(btrim(reason)) between 1 and 500),
  status      text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  handled_by  uuid references auth.users (id) on delete set null,
  handled_at  timestamptz,
  resolution  text check (char_length(resolution) <= 500),
  created_at  timestamptz not null default now()
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_target_idx on public.reports (target_type, target_id);
-- One open report per person per thing: no flooding.
create unique index if not exists reports_one_open_idx
  on public.reports (reporter_id, target_type, target_id) where status = 'open';

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

create table if not exists public.task_moderation (
  task_id   uuid primary key references public.tasks (id) on delete cascade,
  hidden_by uuid references auth.users (id) on delete set null,
  reason    text not null check (char_length(btrim(reason)) between 1 and 500),
  hidden_at timestamptz not null default now()
);

alter table public.reports enable row level security;
alter table public.blocks enable row level security;
alter table public.task_moderation enable row level security;

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()) or private.is_admin());
drop policy if exists blocks_read_own on public.blocks;
create policy blocks_read_own on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
drop policy if exists task_moderation_admin_read on public.task_moderation;
create policy task_moderation_admin_read on public.task_moderation
  for select to authenticated using (private.is_admin());

-- No write policies and no write grants: every write goes through a function below.
revoke all on public.reports, public.blocks, public.task_moderation from anon, authenticated;
grant select on public.reports, public.blocks, public.task_moderation to authenticated;

-- --------------------------------------------------------- hiding a task --

create or replace function private.task_is_hidden(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.task_moderation m where m.task_id = p_task);
$$;
revoke all on function private.task_is_hidden(uuid) from public;
grant execute on function private.task_is_hidden(uuid) to anon, authenticated;

-- Restrictive: ANDed with the existing visibility policy, never widening it.
drop policy if exists tasks_hide_moderated on public.tasks;
create policy tasks_hide_moderated on public.tasks
  as restrictive for select
  using (
    not private.task_is_hidden(id)
    or poster_id = (select auth.uid())
    or private.is_admin()
  );

-- --------------------------------------------------------------- reporting --

create or replace function public.report_content(p_type text, p_target uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me   uuid := auth.uid();
  v_id   uuid;
  v_owner uuid;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_type not in ('user', 'task', 'message', 'review') then raise exception 'Unknown kind of report'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say what is wrong'; end if;

  if p_type = 'user' then
    if not exists (select 1 from public.profiles where id = p_target) then raise exception 'That person no longer exists'; end if;
    v_owner := p_target;
  elsif p_type = 'task' then
    select poster_id into v_owner from public.tasks where id = p_target;
    if not found then raise exception 'That job no longer exists'; end if;
  elsif p_type = 'review' then
    select author_id into v_owner from public.reviews where id = p_target;
    if not found then raise exception 'That review no longer exists'; end if;
  end if;
  if v_owner is not null and v_owner = v_me then raise exception 'You cannot report yourself'; end if;

  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_me, p_type, p_target, left(btrim(p_reason), 500))
  on conflict (reporter_id, target_type, target_id) where status = 'open' do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.reports
     where reporter_id = v_me and target_type = p_type and target_id = p_target and status = 'open';
  else
    perform private.notify_staff('people', 'New report',
      format('Someone reported a %s. Open the admin panel.', p_type), v_me);
  end if;
  return v_id;
end;
$fn$;
revoke all on function public.report_content(text, uuid, text) from public, anon;
grant execute on function public.report_content(text, uuid, text) to authenticated;

create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_user = auth.uid() then raise exception 'You cannot block yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'That person no longer exists'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), p_user) on conflict do nothing;
end;
$fn$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user;
end;
$fn$;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ------------------------------------------------------------ staff actions --

create or replace function private.require_people_staff()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not private.staff_can(auth.uid(), 'people') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(auth.uid())
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_people_staff() from public, anon, authenticated;

create or replace function public.admin_resolve_report(p_report uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_row public.reports;
begin
  perform private.require_people_staff();
  if p_status not in ('actioned', 'dismissed') then raise exception 'Choose actioned or dismissed'; end if;
  update public.reports
     set status = p_status, handled_by = auth.uid(), handled_at = now(), resolution = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
   where id = p_report and status = 'open'
   returning * into v_row;
  if not found then raise exception 'That report is already handled'; end if;
  perform public.admin_log_event('report.' || p_status, v_row.target_id::text, format('%s report %s', v_row.target_type, p_report));
end;
$fn$;
revoke all on function public.admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;

create or replace function public.admin_hide_task(p_task uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  perform private.require_people_staff();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say why you are hiding it'; end if;
  if not exists (select 1 from public.tasks where id = p_task) then raise exception 'That job does not exist'; end if;
  insert into public.task_moderation (task_id, hidden_by, reason)
  values (p_task, auth.uid(), left(btrim(p_reason), 500))
  on conflict (task_id) do update set hidden_by = excluded.hidden_by, reason = excluded.reason, hidden_at = now();
  perform public.admin_log_event('task.hide', p_task::text, left(btrim(p_reason), 400));
end;
$fn$;
revoke all on function public.admin_hide_task(uuid, text) from public, anon;
grant execute on function public.admin_hide_task(uuid, text) to authenticated;

create or replace function public.admin_unhide_task(p_task uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  perform private.require_people_staff();
  delete from public.task_moderation where task_id = p_task;
  if not found then raise exception 'That job is not hidden'; end if;
  perform public.admin_log_event('task.unhide', p_task::text, null);
end;
$fn$;
revoke all on function public.admin_unhide_task(uuid) from public, anon;
grant execute on function public.admin_unhide_task(uuid) to authenticated;
