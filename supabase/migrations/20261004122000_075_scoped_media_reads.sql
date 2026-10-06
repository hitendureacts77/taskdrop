-- 075 — task-media: read only what the caller is allowed to see.
--
-- Audit finding F-03 (docs/audit/SECURITY_FINDINGS.md).
--
-- The read policy was `bucket_id = 'task-media'` for every signed-in user, so
-- any account could list and sign a URL for every other user's job photos,
-- proofs and documents. Uploads were already scoped to the uploader's folder.
--
-- A caller may now read an object when it is:
--   * in their own folder ({uid}/...), or
--   * a profile photo (avatars are shown to everyone), or
--   * the media of a task they can see: an open task, or one they posted, bid
--     on or are assigned to (admins see all), or
--   * a proof-of-work file on a task where they are the worker or the poster.
-- The helper is SECURITY DEFINER because the caller cannot read those tables
-- row by row from inside a storage policy.

create or replace function private.can_read_task_media(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
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
    );
$$;
revoke all on function private.can_read_task_media(text, uuid) from public, anon;
grant execute on function private.can_read_task_media(text, uuid) to authenticated;

create index if not exists tasks_media_path_idx
  on public.tasks (media_path) where media_path is not null;
create index if not exists profiles_avatar_url_idx
  on public.profiles (avatar_url) where avatar_url is not null;

drop policy if exists "task media: signed-in reads" on storage.objects;
drop policy if exists "task media: scoped reads"    on storage.objects;
create policy "task media: scoped reads" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-media'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.can_read_task_media(name, (select auth.uid()))
    )
  );
