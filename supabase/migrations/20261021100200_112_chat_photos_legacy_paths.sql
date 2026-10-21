-- 112 — the other person in a chat can open the photo they were sent (Phase 2, known bug).
--
-- Migration 075 scoped reads of the task-media bucket to the uploader's own
-- folder, avatars, task media and proofs. A chat photo sent as a plain storage
-- path ('::media::<uid>/<file>', the form used before the media registry) was
-- none of those, so only the sender could open it. Migration 109 added the chat
-- rule for registry photos ('media:<id>') but not for these older paths. This
-- adds it: whoever may use the task's thread may open a photo sent in it.
--
-- The rest of the function is migration 109's, unchanged. The index keeps the
-- lookup cheap (the first 60 characters, so a long message cannot overflow an
-- index entry).

create index if not exists messages_legacy_media_idx
  on public.messages (left(body, 60))
  where body like '::media::%' and body not like '::media::media:%';

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
      or exists (
        select 1 from public.messages ms
         where left(ms.body, 60) = left('::media::' || p_name, 60)
           and ms.body = '::media::' || p_name
           and private.can_use_task_thread(ms.task_id, p_uid)
      )
  end;
$$;
revoke all on function private.can_read_task_media(text, uuid) from public, anon;
grant execute on function private.can_read_task_media(text, uuid) to authenticated;
