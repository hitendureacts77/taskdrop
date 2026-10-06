-- 085 -- Copyright notices: log, take down, counter-notice, restore.
--
-- The app's Copyright page tells rights holders to email our designated agent.
-- This is where staff act on what arrives, the way 17 U.S.C. § 512 expects:
--
--   received  -> an admin logs the notice from the agent's inbox
--   removed   -> the material is taken down and the person who posted it is told
--   rejected  -> the notice was incomplete or not a copyright claim
--   countered -> the poster sent a valid counter-notice; staff forward it to the
--                complainant, and the material may come back 10-14 business days
--                later (restore_from is the earliest day) unless they have sued
--   restored  -> the material is back
--
-- Taking down never deletes a file. It detaches it -- tasks.media_path or
-- profiles.avatar_url is cleared and remembered on the notice -- and the
-- storage read policy (075) then lets nobody but the uploader see it. A listing
-- that is still open can be closed instead. Restoring puts back exactly what was
-- detached, if nothing else has replaced it meanwhile.
--
-- Repeat infringers: copyright_strikes() counts upheld notices per person, and
-- the admin page offers suspension at three.
--
-- Admin only throughout: every function checks private.is_admin(), and every
-- change to a notice is written to admin_audit_log (076).

-- ------------------------------------------------------------------- table --
create table if not exists public.copyright_notices (
  id                uuid primary key default gen_random_uuid(),
  received_at       timestamptz not null default now(),
  complainant       text not null check (char_length(btrim(complainant)) between 1 and 200),
  complainant_email text not null check (char_length(btrim(complainant_email)) between 3 and 200),
  work              text not null check (char_length(btrim(work)) between 1 and 2000),
  material          text not null check (char_length(btrim(material)) between 1 and 2000),
  task_id           uuid references public.tasks (id) on delete set null,
  uploader_id       uuid references auth.users (id) on delete set null,
  status            text not null default 'received'
                    check (status in ('received', 'removed', 'rejected', 'countered', 'restored')),
  removed_what      text check (removed_what in ('media', 'listing', 'avatar')),
  removed_value     text,
  removed_at        timestamptz,
  counter_at        timestamptz,
  restore_from      date,
  restored_at       timestamptz,
  note              text check (note is null or char_length(note) <= 1000),
  logged_by         uuid references auth.users (id) on delete set null,
  updated_at        timestamptz not null default now()
);
create index if not exists copyright_notices_status_idx on public.copyright_notices (status, received_at desc);
create index if not exists copyright_notices_uploader_idx on public.copyright_notices (uploader_id) where uploader_id is not null;
create index if not exists copyright_notices_task_idx on public.copyright_notices (task_id) where task_id is not null;

alter table public.copyright_notices enable row level security;
drop policy if exists copyright_notices_admin_read on public.copyright_notices;
create policy copyright_notices_admin_read on public.copyright_notices
  for select to authenticated using (private.is_admin());
revoke all on public.copyright_notices from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.copyright_notices from authenticated;
grant select on public.copyright_notices to authenticated;

drop trigger if exists audit_copyright_notices on public.copyright_notices;
create trigger audit_copyright_notices after insert or update or delete on public.copyright_notices
  for each row execute function private.audit_change();

-- ---------------------------------------------------------------- strikes --
/** Upheld notices per person: removed, or countered but not (yet) restored. */
create or replace function public.copyright_strikes(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_admin() then
    (select count(*)::integer from public.copyright_notices
      where uploader_id = p_user and status in ('removed', 'countered'))
  end;
$$;

-- --------------------------------------------------------------------- log --
create or replace function public.admin_log_copyright_notice(
  p_complainant text, p_email text, p_work text, p_material text, p_task uuid default null, p_uploader uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uploader uuid := p_uploader;
  v_id uuid;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_task is not null then
    select poster_id into v_uploader from public.tasks where id = p_task;
    if not found then raise exception 'No job has that id'; end if;
  end if;
  insert into public.copyright_notices (complainant, complainant_email, work, material, task_id, uploader_id, logged_by)
  values (btrim(p_complainant), btrim(p_email), btrim(p_work), btrim(p_material), p_task, v_uploader, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- --------------------------------------------------------------- takedown --
create or replace function public.admin_copyright_takedown(p_notice uuid, p_what text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.copyright_notices;
  v_value text;
  v_what_said text;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  select * into n from public.copyright_notices where id = p_notice for update;
  if not found then raise exception 'That notice no longer exists'; end if;
  if n.status <> 'received' then raise exception 'That notice has already been dealt with'; end if;

  if p_what = 'media' then
    if n.task_id is null then raise exception 'Link the notice to a job first'; end if;
    select media_path into v_value from public.tasks where id = n.task_id for update;
    if v_value is null then raise exception 'That job has no photo or video to remove'; end if;
    update public.tasks set media_path = null, updated_at = now() where id = n.task_id;
    v_what_said := 'the photo or video on your job';
  elsif p_what = 'listing' then
    if n.task_id is null then raise exception 'Link the notice to a job first'; end if;
    -- Never a job with money held against it: closing one here would skip the
    -- refund that cancel_task makes.
    update public.tasks set status = 'CANCELLED', updated_at = now()
     where id = n.task_id and status = 'OPEN' and funded_at is null;
    if not found then
      raise exception 'Only an open post with no money paid in can be closed here. Remove its photo or video instead.';
    end if;
    v_value := 'OPEN';
    v_what_said := 'your post';
  elsif p_what = 'avatar' then
    if n.uploader_id is null then raise exception 'Say whose profile photo it is first'; end if;
    select avatar_url into v_value from public.profiles where id = n.uploader_id for update;
    if v_value is null then raise exception 'That person has no profile photo'; end if;
    update public.profiles set avatar_url = null, updated_at = now() where id = n.uploader_id;
    v_what_said := 'your profile photo';
  else
    raise exception 'Choose what to remove';
  end if;

  update public.copyright_notices
     set status = 'removed', removed_what = p_what, removed_value = v_value, removed_at = now(),
         note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   where id = n.id;

  -- § 512(g)(2)(A): promptly tell the person whose material came down.
  perform private.notify(
    n.uploader_id, 'announcement', 'We removed something after a copyright notice',
    'We received a copyright notice and removed ' || v_what_said || '. If you believe this was a mistake, '
      || 'you can send a counter-notice: see Help & support, then Copyright & takedowns.',
    case when p_what = 'avatar' then null else n.task_id end, null);
end;
$$;

-- ----------------------------------------------------------------- reject --
create or replace function public.admin_copyright_reject(p_notice uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'Say why, so the next admin knows'; end if;
  update public.copyright_notices
     set status = 'rejected', note = left(btrim(p_note), 1000), updated_at = now()
   where id = p_notice and status = 'received';
  if not found then raise exception 'That notice has already been dealt with'; end if;
end;
$$;

-- ---------------------------------------------------------- counter-notice --
create or replace function public.admin_copyright_counter(p_notice uuid, p_note text default null)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare v_from date := (now() at time zone 'Asia/Kolkata')::date + 14;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  -- 10 business days is at least 14 calendar days; restore no earlier.
  update public.copyright_notices
     set status = 'countered', counter_at = now(), restore_from = v_from,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note), updated_at = now()
   where id = p_notice and status = 'removed';
  if not found then raise exception 'Only removed material can be countered'; end if;
  return v_from;
end;
$$;

-- ---------------------------------------------------------------- restore --
create or replace function public.admin_copyright_restore(p_notice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare n public.copyright_notices;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  select * into n from public.copyright_notices where id = p_notice for update;
  if not found then raise exception 'That notice no longer exists'; end if;
  if n.status <> 'countered' then raise exception 'Only countered material can be restored'; end if;
  if (now() at time zone 'Asia/Kolkata')::date < n.restore_from then
    raise exception 'Too early: the complainant has until % to say they have gone to court', to_char(n.restore_from - 1, 'DD Mon YYYY');
  end if;

  if n.removed_what = 'media' then
    update public.tasks set media_path = n.removed_value, updated_at = now()
     where id = n.task_id and media_path is null;
  elsif n.removed_what = 'listing' then
    update public.tasks set status = 'OPEN', updated_at = now()
     where id = n.task_id and status = 'CANCELLED';
  elsif n.removed_what = 'avatar' then
    update public.profiles set avatar_url = n.removed_value, updated_at = now()
     where id = n.uploader_id and avatar_url is null;
  end if;
  if not found then raise exception 'It has been replaced or changed since, so there is nothing to put back'; end if;

  update public.copyright_notices set status = 'restored', restored_at = now(), updated_at = now() where id = n.id;
  perform private.notify(
    n.uploader_id, 'announcement', 'Your material is back',
    'After your counter-notice, we have restored what was removed.',
    case when n.removed_what = 'avatar' then null else n.task_id end, null);
end;
$$;

-- ----------------------------------------------------------------- grants --
do $$
declare f text;
begin
  foreach f in array array[
    'public.copyright_strikes(uuid)',
    'public.admin_log_copyright_notice(text, text, text, text, uuid, uuid)',
    'public.admin_copyright_takedown(uuid, text, text)',
    'public.admin_copyright_reject(uuid, text)',
    'public.admin_copyright_counter(uuid, text)',
    'public.admin_copyright_restore(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
