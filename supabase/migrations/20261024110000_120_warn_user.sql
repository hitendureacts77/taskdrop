-- 120 — staff can warn a person (Phase 7, reports queue).
--
-- The reports queue could hide a message, hide a job, suspend or delete, but
-- had nothing in between. A warning is that step: the person gets a plain
-- notification, the warning is kept on their record, and, when it comes from a
-- report, the report is closed as actioned.
--
-- Same rules as the other moderation tools (118): the people area of staff
-- (admin or support), a reason, an audit-log row, nothing deleted. Only adds a
-- table and a function.

create table if not exists public.user_warnings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  reason     text not null check (char_length(btrim(reason)) between 1 and 500),
  warned_by  uuid references auth.users (id) on delete set null,
  report_id  uuid references public.reports (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists user_warnings_user_idx on public.user_warnings (user_id, created_at desc);
comment on table public.user_warnings is
  'Warnings staff have sent a person. Written only by admin_warn_user; read by staff.';

alter table public.user_warnings enable row level security;
drop policy if exists user_warnings_admin_read on public.user_warnings;
create policy user_warnings_admin_read on public.user_warnings
  for select to authenticated using (private.is_admin());
revoke all on public.user_warnings from anon, authenticated;
grant select on public.user_warnings to authenticated;

create or replace function public.admin_warn_user(p_user uuid, p_reason text, p_report uuid default null)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_id     uuid;
  v_report public.reports;
begin
  perform private.require_people_staff();
  if v_reason = '' then raise exception 'Say what the warning is for'; end if;
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'That person does not exist';
  end if;
  if p_user = auth.uid() then raise exception 'You can''t warn yourself'; end if;

  if p_report is not null then
    select * into v_report from public.reports where id = p_report;
    if not found then raise exception 'That report does not exist'; end if;
  end if;

  insert into public.user_warnings (user_id, reason, warned_by, report_id)
  values (p_user, v_reason, auth.uid(), p_report)
  returning id into v_id;

  perform private.notify(p_user, 'admin_warning', 'A warning from TaskDrop',
    'We''ve had a problem with something you did on TaskDrop. ' || v_reason
    || ' Please follow the community rules; repeated problems can lead to your account being suspended.');

  -- Close the report that led to it, if it is still open.
  if p_report is not null then
    update public.reports
       set status = 'actioned', handled_by = auth.uid(), handled_at = now(),
           resolution = left('Warned the person: ' || v_reason, 500)
     where id = p_report and status = 'open';
  end if;

  perform public.admin_log_event('user.warn', p_user::text, left(v_reason, 400));
  return v_id;
end;
$fn$;
revoke all on function public.admin_warn_user(uuid, text, uuid) from public, anon;
grant execute on function public.admin_warn_user(uuid, text, uuid) to authenticated;
