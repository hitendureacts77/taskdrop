-- 109 -- the media registry (Phase 6, R4): one row for every uploaded file.
--
-- Why a table. Moderation, takedowns, account deletion and clean-up all need to
-- answer "which files exist, whose are they, and are they still wanted?". Until
-- now the answer was scattered: a path in tasks.media_path, another in
-- profiles.avatar_url, another inside task_proofs.files, another inside a chat
-- message. A file in storage that nothing points to was invisible.
--
-- What goes in it.
--   * Pictures are uploaded straight to ImageKit (provider 'imagekit') and are
--     referred to everywhere as 'media:<id>'. That string goes in the same
--     columns the old paths did: tasks.media_path, profiles.avatar_url, a proof
--     file's "path", a chat message ('::media::media:<id>'). Old values are
--     still readable, and the old app keeps working: signMedia accepts both.
--   * Videos and documents stay in Supabase Storage (provider 'supabase') and
--     are still referred to by their storage path; they are recorded here so
--     the registry is complete. They are 'attached' from the start, because the
--     old app never says "this upload is finished".
--
-- Life of a picture:  pending -> attached -> hidden -> deleted
--   pending   the app was given an upload token; the file may or may not exist
--   attached  the server asked ImageKit and the file is there, in the right
--             folder, a picture, not too big
--   hidden    moderation: nobody but the uploader's admin can open it
--   deleted   to be removed from the provider; purged_at says when that happened
-- A pending row nobody finished within 24 hours is deleted by media_expire_pending().
--
-- Only adds: a table and functions. Nothing is dropped or renamed.

-- ------------------------------------------------------------------- table --

create table if not exists public.media (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid not null references auth.users (id) on delete cascade,
  provider         text not null check (provider in ('imagekit', 'supabase')),
  provider_file_id text,                                  -- ImageKit's fileId; null until attached
  path             text not null check (char_length(path) between 1 and 400),
  purpose          text not null check (purpose in ('task', 'avatar', 'proof', 'chat')),
  kind             text not null check (kind in ('image', 'video', 'file')),
  mime             text check (char_length(mime) <= 100),
  bytes            bigint check (bytes >= 0),
  status           text not null default 'pending' check (status in ('pending', 'attached', 'hidden', 'deleted')),
  created_at       timestamptz not null default now(),
  attached_at      timestamptz,
  hidden_at        timestamptz,
  deleted_at       timestamptz,
  purged_at        timestamptz,                           -- the provider no longer has the file
  updated_at       timestamptz not null default now(),
  unique (provider, path)
);
comment on table public.media is
  'Every uploaded file (migration 109). Written only by the media_* functions; a picture is referred to elsewhere as ''media:<id>''.';

create index if not exists media_owner_idx on public.media (owner);
create index if not exists media_pending_idx on public.media (created_at) where status = 'pending';
create index if not exists media_to_purge_idx on public.media (deleted_at)
  where status = 'deleted' and purged_at is null and provider = 'imagekit';

alter table public.media enable row level security;
drop policy if exists media_select on public.media;
create policy media_select on public.media
  for select to authenticated
  using (owner = (select auth.uid()) or private.is_admin());
-- No write policies: every write goes through the functions below.
revoke all on public.media from anon;
revoke insert, update, delete, truncate on public.media from authenticated;

-- A chat photo is the message '::media::media:<id>'. The index is on the first
-- 60 characters only, so a long message can never overflow an index entry.
create index if not exists messages_media_ref_idx
  on public.messages (left(body, 60))
  where body like '::media::media:%';

-- ----------------------------------------------------- who may open a file --

/**
 * Whether `p_uid` may open the file called `p_name`.
 *
 * Replaces the version from 075. Names that are not 'media:<id>' are answered
 * exactly as before, so everything already in storage behaves the same. A
 * 'media:<id>' name is readable by:
 *   * its uploader, while it is pending or attached;
 *   * anyone who may see what it is attached to, once it is attached: a profile
 *     photo (everyone), an open task or one the caller posted, bid on or holds,
 *     a proof of work (worker and poster), a chat photo (the thread);
 *   * an admin, unless it is deleted.
 * A hidden or deleted file is never shown through what it is attached to.
 */
create or replace function private.can_read_task_media(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_name like 'media:%' then
      exists (
        select 1 from public.media m
         where 'media:' || m.id::text = p_name
           and (
             (m.owner = p_uid and m.status in ('pending', 'attached'))
             or (m.status <> 'deleted' and private.is_admin())
             or (
               m.status = 'attached'
               and (
                 exists (select 1 from public.profiles p where p.avatar_url = p_name)
                 or exists (
                   select 1 from public.tasks t
                    where t.media_path = p_name
                      and ( t.status = 'OPEN'
                            or t.poster_id = p_uid
                            or private.user_bid_on_task(t.id, p_uid)
                            or private.user_assigned_task(t.id, p_uid) )
                 )
                 or exists (
                   select 1 from public.task_proofs tp
                     join public.tasks t on t.id = tp.task_id
                    where tp.files @> jsonb_build_array(jsonb_build_object('path', p_name))
                      and ( tp.worker_id = p_uid or t.poster_id = p_uid )
                 )
                 or exists (
                   select 1 from public.messages ms
                    where left(ms.body, 60) = left('::media::' || p_name, 60)
                      and ms.body = '::media::' || p_name
                      and private.can_use_task_thread(ms.task_id, p_uid)
                 )
               )
             )
           )
      )
    else
      exists (select 1 from public.profiles p where p.avatar_url = p_name)
      or exists (
        select 1 from public.tasks t
         where t.media_path = p_name
           and ( t.status = 'OPEN'
                 or t.poster_id = p_uid
                 or private.is_admin()
                 or private.user_bid_on_task(t.id, p_uid)
                 or private.user_assigned_task(t.id, p_uid) )
      )
      or exists (
        select 1 from public.task_proofs tp
          join public.tasks t on t.id = tp.task_id
         where tp.files @> jsonb_build_array(jsonb_build_object('path', p_name))
           and ( tp.worker_id = p_uid or t.poster_id = p_uid or private.is_admin() )
      )
  end;
$$;
revoke all on function private.can_read_task_media(text, uuid) from public, anon;
grant execute on function private.can_read_task_media(text, uuid) to authenticated;

-- -------------------------------------------------- functions the app calls --

/**
 * Starts an upload: a pending row for a picture, or a finished one for a file
 * that goes to Supabase Storage. The api function chooses the id and the path;
 * this checks they belong to the caller and records them. Returns the id.
 */
create or replace function public.media_begin(
  p_id       uuid,
  p_provider text,
  p_purpose  text,
  p_kind     text,
  p_mime     text,
  p_path     text
) returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_provider = 'imagekit' then
    if p_kind <> 'image' or p_path !~ ('^/[a-z0-9_-]+/u/' || v_me::text || '/[A-Za-z0-9._-]+$') then
      raise exception 'Invalid upload' using errcode = '22023';
    end if;
  elsif p_provider = 'supabase' then
    if p_path not like v_me::text || '/%' or p_path like '%..%' then
      raise exception 'Invalid upload' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid upload' using errcode = '22023';
  end if;

  -- A person with a hundred unfinished uploads is not taking photos.
  if p_provider = 'imagekit'
     and (select count(*) from public.media where owner = v_me and status = 'pending') >= 100 then
    raise exception 'Too many uploads in progress. Please try again in a little while.' using errcode = 'P0001';
  end if;

  insert into public.media (id, owner, provider, path, purpose, kind, mime, status, attached_at)
  values (
    p_id, v_me, p_provider, p_path, p_purpose, p_kind, nullif(left(p_mime, 100), ''),
    case when p_provider = 'supabase' then 'attached' else 'pending' end,
    case when p_provider = 'supabase' then now() end
  )
  on conflict (provider, path) do update set updated_at = now()   -- a retried call with the same path
  returning id into p_id;
  return p_id;
end;
$$;
revoke all on function public.media_begin(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.media_begin(uuid, text, text, text, text, text) to authenticated;

/**
 * The upload is done and the api function has checked, with ImageKit, that the
 * file exists at the path we chose and is a picture of a sensible size. Marks it
 * attached. Safe to call twice. Returns the file as the app should refer to it.
 */
create or replace function public.media_attach(p_id uuid, p_provider_file_id text, p_bytes bigint)
returns text
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_me uuid := (select auth.uid());
  m    public.media;
begin
  select * into m from public.media where id = p_id and owner = v_me for update;
  if not found then
    raise exception 'That upload was not found' using errcode = 'P0001';
  end if;
  if m.status = 'attached' and m.provider_file_id is not distinct from p_provider_file_id then
    return 'media:' || m.id::text;
  end if;
  if m.status <> 'pending' then
    raise exception 'That upload can no longer be used' using errcode = 'P0001';
  end if;
  update public.media
     set status = 'attached', provider_file_id = p_provider_file_id, bytes = p_bytes,
         attached_at = now(), updated_at = now()
   where id = m.id;
  return 'media:' || m.id::text;
end;
$$;
revoke all on function public.media_attach(uuid, text, bigint) from public, anon;
grant execute on function public.media_attach(uuid, text, bigint) to authenticated;

/**
 * The pictures among `p_refs` that the caller may open, with where each lives.
 * The api function signs a URL for each row; a reference the caller may not open
 * is simply left out, so asking never tells you whether a file exists.
 */
create or replace function public.media_resolve(p_refs text[])
returns table (ref text, provider text, provider_file_id text, path text, kind text)
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select 'media:' || m.id::text, m.provider, m.provider_file_id, m.path, m.kind
    from public.media m
   where 'media:' || m.id::text = any (p_refs[1:200])
     and m.status in ('attached', 'hidden')
     and private.can_read_task_media('media:' || m.id::text, (select auth.uid()));
$$;
revoke all on function public.media_resolve(text[]) from public, anon;
grant execute on function public.media_resolve(text[]) to authenticated;

/**
 * Throws away a picture the caller uploaded but no longer wants (they replaced
 * it, or cancelled the form). Only their own, and only while nothing uses it.
 * Returns true when the row is now deleted.
 */
create or replace function public.media_discard(p_ref text)
returns boolean
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_me uuid := (select auth.uid());
  m    public.media;
begin
  select * into m from public.media
   where 'media:' || id::text = p_ref and owner = v_me and status in ('pending', 'attached')
   for update;
  if not found then
    return false;
  end if;
  if exists (select 1 from public.profiles where avatar_url = p_ref)
     or exists (select 1 from public.tasks where media_path = p_ref)
     or exists (select 1 from public.task_proofs where files @> jsonb_build_array(jsonb_build_object('path', p_ref)))
     or exists (select 1 from public.messages
                 where left(body, 60) = left('::media::' || p_ref, 60) and body = '::media::' || p_ref) then
    return false;
  end if;
  update public.media set status = 'deleted', deleted_at = now(), updated_at = now() where id = m.id;
  return true;
end;
$$;
revoke all on function public.media_discard(text) from public, anon;
grant execute on function public.media_discard(text) to authenticated;

-- ---------------------------------------- functions only the server calls --

/** Pending uploads nobody finished within a day are marked deleted. Returns how many. */
create or replace function public.media_expire_pending()
returns integer
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $$
declare
  v_n integer;
begin
  perform private.assert_service_caller();
  update public.media
     set status = 'deleted', deleted_at = now(), updated_at = now()
   where status = 'pending' and created_at < now() - interval '24 hours';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.media_expire_pending() from public, anon, authenticated;
grant execute on function public.media_expire_pending() to service_role;

/**
 * A deleted account's pictures. The same rule as deleted_account_files() (101):
 * whatever a kept record still points to stays, everything else goes. Marks the
 * rows deleted; the purge removes them from ImageKit. Returns how many.
 */
create or replace function public.media_account_deleted(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $$
declare
  v_n integer;
begin
  perform private.assert_service_caller();
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is not null) then
    return 0;   -- not a deleted account: never touch anyone's files
  end if;
  update public.media m
     set status = 'deleted', deleted_at = now(), updated_at = now()
   where m.owner = p_user
     and m.provider = 'imagekit'
     and m.status <> 'deleted'
     and not exists (select 1 from public.tasks t
                      where t.poster_id = p_user and t.media_path = 'media:' || m.id::text and t.status <> 'CANCELLED')
     and not exists (select 1 from public.task_proofs p
                      where p.worker_id = p_user and strpos(p.files::text, 'media:' || m.id::text) > 0);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.media_account_deleted(uuid) from public, anon, authenticated;
grant execute on function public.media_account_deleted(uuid) to service_role;

/** The next ImageKit files to remove, oldest first. A row stays listed until media_mark_purged() runs. */
create or replace function public.media_purge_batch(p_limit integer default 50)
returns table (id uuid, provider_file_id text, path text)
language plpgsql
stable
security definer
set search_path = 'public', 'private', 'pg_temp'
as $$
begin
  perform private.assert_service_caller();
  return query
    select m.id, m.provider_file_id, m.path
      from public.media m
     where m.provider = 'imagekit' and m.status = 'deleted' and m.purged_at is null
     order by m.deleted_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.media_purge_batch(integer) from public, anon, authenticated;
grant execute on function public.media_purge_batch(integer) to service_role;

/** ImageKit no longer has these files. Returns how many rows were marked. */
create or replace function public.media_mark_purged(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $$
declare
  v_n integer;
begin
  perform private.assert_service_caller();
  update public.media
     set purged_at = now(), updated_at = now()
   where id = any (p_ids) and status = 'deleted' and purged_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.media_mark_purged(uuid[]) from public, anon, authenticated;
grant execute on function public.media_mark_purged(uuid[]) to service_role;
