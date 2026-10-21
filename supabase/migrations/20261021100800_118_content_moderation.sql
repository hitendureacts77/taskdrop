-- 118 — staff can hide a message or a photo and change a job's category (Phase 7).
--
-- Migration 093 let staff hide a whole job. This adds the smaller tools:
--   * admin_hide_message / admin_unhide_message: a hidden message disappears
--     for both people in the thread (a restrictive row-level-security policy,
--     like tasks_hide_moderated). The row is kept, so the admin panel, which
--     reads messages with the service key, can still show it.
--   * admin_hide_media / admin_unhide_media: a photo or file in the media
--     registry (migration 109) is set to 'hidden', which 109's signing rules
--     already treat as "never shown through what it is attached to".
--   * admin_set_task_category: fix a wrong category on a job.
-- Each needs the people area of staff (admin or support), a reason where
-- something is hidden, and writes to the audit log. Nothing is deleted.
--
-- Only adds: a table, a policy, a helper and functions.

-- ------------------------------------------------------------ messages ----

create table if not exists public.message_moderation (
  message_id uuid primary key references public.messages (id) on delete cascade,
  hidden_by  uuid references auth.users (id) on delete set null,
  reason     text not null check (char_length(btrim(reason)) between 1 and 500),
  hidden_at  timestamptz not null default now()
);
alter table public.message_moderation enable row level security;
drop policy if exists message_moderation_admin_read on public.message_moderation;
create policy message_moderation_admin_read on public.message_moderation
  for select to authenticated using (private.is_admin());
revoke all on public.message_moderation from anon, authenticated;
grant select on public.message_moderation to authenticated;

create or replace function private.message_is_hidden(p_message uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.message_moderation m where m.message_id = p_message);
$$;
revoke all on function private.message_is_hidden(uuid) from public;
grant execute on function private.message_is_hidden(uuid) to anon, authenticated;

-- Restrictive: ANDed with the thread-participant policy, never widening it.
drop policy if exists messages_hide_moderated on public.messages;
create policy messages_hide_moderated on public.messages
  as restrictive for select
  using (not private.message_is_hidden(id) or private.is_admin());

create or replace function public.admin_hide_message(p_message uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  perform private.require_people_staff();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say why you are hiding it'; end if;
  if not exists (select 1 from public.messages where id = p_message) then raise exception 'That message does not exist'; end if;
  insert into public.message_moderation (message_id, hidden_by, reason)
  values (p_message, auth.uid(), left(btrim(p_reason), 500))
  on conflict (message_id) do update set hidden_by = excluded.hidden_by, reason = excluded.reason, hidden_at = now();
  perform public.admin_log_event('message.hide', p_message::text, left(btrim(p_reason), 400));
end;
$fn$;
revoke all on function public.admin_hide_message(uuid, text) from public, anon;
grant execute on function public.admin_hide_message(uuid, text) to authenticated;

create or replace function public.admin_unhide_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  perform private.require_people_staff();
  delete from public.message_moderation where message_id = p_message;
  if not found then raise exception 'That message is not hidden'; end if;
  perform public.admin_log_event('message.unhide', p_message::text, null);
end;
$fn$;
revoke all on function public.admin_unhide_message(uuid) from public, anon;
grant execute on function public.admin_unhide_message(uuid) to authenticated;

-- ---------------------------------------------------------------- media ----

create or replace function public.admin_hide_media(p_media uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  perform private.require_people_staff();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say why you are hiding it'; end if;
  update public.media set status = 'hidden', hidden_at = now(), updated_at = now()
   where id = p_media and status in ('attached', 'pending');
  if not found then raise exception 'That file is not there, or is already hidden or deleted'; end if;
  perform public.admin_log_event('media.hide', p_media::text, left(btrim(p_reason), 400));
end;
$fn$;
revoke all on function public.admin_hide_media(uuid, text) from public, anon;
grant execute on function public.admin_hide_media(uuid, text) to authenticated;

create or replace function public.admin_unhide_media(p_media uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  perform private.require_people_staff();
  update public.media set status = 'attached', hidden_at = null, updated_at = now()
   where id = p_media and status = 'hidden';
  if not found then raise exception 'That file is not hidden'; end if;
  perform public.admin_log_event('media.unhide', p_media::text, null);
end;
$fn$;
revoke all on function public.admin_unhide_media(uuid) from public, anon;
grant execute on function public.admin_unhide_media(uuid) to authenticated;

-- ------------------------------------------------------------- category ----

create or replace function public.admin_set_task_category(p_task uuid, p_category text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_old text;
  v_new text := nullif(left(btrim(coalesce(p_category, '')), 100), '');
begin
  perform private.require_people_staff();
  select category into v_old from public.tasks where id = p_task for update;
  if not found then raise exception 'That job does not exist'; end if;
  if v_old is not distinct from v_new then return; end if;
  update public.tasks set category = v_new, updated_at = now() where id = p_task;
  perform public.admin_log_event('task.category', p_task::text, format('%s -> %s', coalesce(v_old, 'none'), coalesce(v_new, 'none')));
end;
$fn$;
revoke all on function public.admin_set_task_category(uuid, text) from public, anon;
grant execute on function public.admin_set_task_category(uuid, text) to authenticated;
