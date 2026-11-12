-- 171: a file is shared through a row only when it belongs to that row's owner (B59, B64 read part).
--
-- private.can_read_task_media opened a stored file to anyone who could see a row naming it: any profile's
-- avatar_url, a task's media_path, a proof's files, a chat photo. The row's owner could name ANY path,
-- including a file in someone else's folder (profiles.avatar_url is writable by its owner; messages and
-- task_proofs take inserts), so one signed-in person could make another person's private file readable
-- by everyone. Each branch now also requires the file to be the row owner's own:
--   * a plain storage path must sit in the owner's folder ('<owner id>/...', no '..'), the same rule the
--     upload policy and the api's createTask use;
--   * a 'media:<id>' reference must be a media row owned by the row's owner.
-- The owner is profiles.id for an avatar, tasks.poster_id for task media, task_proofs.worker_id for proof
-- files and messages.sender_id for a chat photo.
--
-- B64: the shared before/after branch also skips hidden (moderated) tasks and deleted workers, like
-- guest_proof_photos does.
--
-- Existing rows: checked on staging on 2026-11-12 before writing this. Plain paths outside the owner's
-- folder: avatars 0 of 2, task media 0 of 15, proof files 0 of 0, chat photos 0 of 0. 'media:' references
-- owned by someone other than the row owner: avatars 0, task media 0, chat photos 0. No legitimate file
-- loses access, so nothing is grandfathered.
--
-- The uploader's own reads and the admin reads are unchanged. Same signature and grants as 135.

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
                 exists (select 1 from public.profiles p where p.avatar_url = p_name and p.id = m.owner)
                 or exists (
                   select 1 from public.tasks t
                    where t.media_path = p_name
                      and t.poster_id = m.owner
                      and ( t.status = 'OPEN'
                            or t.poster_id = p_uid
                            or private.user_bid_on_task(t.id, p_uid)
                            or private.user_assigned_task(t.id, p_uid) )
                 )
                 or exists (
                   select 1 from public.task_proofs tp
                     join public.tasks t on t.id = tp.task_id
                    where tp.files @> jsonb_build_array(jsonb_build_object('path', p_name))
                      and tp.worker_id = m.owner
                      and ( tp.worker_id = p_uid or t.poster_id = p_uid )
                 )
                 or exists (
                   select 1 from public.task_proofs tp
                     join public.tasks t on t.id = tp.task_id
                     join public.profiles w on w.id = tp.worker_id and w.deleted_at is null
                    where t.photos_public and t.status in ('COMPLETED', 'AUTO_COMPLETED')
                      and tp.worker_id = m.owner
                      and not private.task_is_hidden(t.id)
                      and ( tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'before'))
                            or tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'after')) )
                 )
                 or exists (
                   select 1 from public.messages ms
                    where left(ms.body, 60) = left('::media::' || p_name, 60)
                      and ms.body = '::media::' || p_name
                      and ms.sender_id = m.owner
                      and private.can_use_task_thread(ms.task_id, p_uid)
                 )
               )
             )
           )
      )
    else
      -- A plain path is only ever shared from its owner's own folder.
      position('..' in p_name) = 0
      and (
        exists (select 1 from public.profiles p
                 where p.avatar_url = p_name and p_name like p.id::text || '/%')
        or exists (
          select 1 from public.tasks t
           where t.media_path = p_name
             and p_name like t.poster_id::text || '/%'
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
             and p_name like tp.worker_id::text || '/%'
             and ( tp.worker_id = p_uid or t.poster_id = p_uid or private.is_admin() )
        )
        or exists (
          select 1 from public.task_proofs tp
            join public.tasks t on t.id = tp.task_id
            join public.profiles w on w.id = tp.worker_id and w.deleted_at is null
           where t.photos_public and t.status in ('COMPLETED', 'AUTO_COMPLETED')
             and p_name like tp.worker_id::text || '/%'
             and not private.task_is_hidden(t.id)
             and ( tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'before'))
                   or tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'after')) )
        )
        or exists (
          select 1 from public.messages ms
           where left(ms.body, 60) = left('::media::' || p_name, 60)
             and ms.body = '::media::' || p_name
             and p_name like ms.sender_id::text || '/%'
             and private.can_use_task_thread(ms.task_id, p_uid)
        )
      )
  end;
$$;
revoke all on function private.can_read_task_media(text, uuid) from public, anon;
grant execute on function private.can_read_task_media(text, uuid) to authenticated;
