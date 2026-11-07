-- 135: three fixes to migration 134 found in its security review (2026-11-02).
--
-- 1. A crew belongs to one poster. crew_id is visible on open tasks, and the
--    poster may set it when posting, so another person could post a task
--    with the same crew_id, count as "the poster" of that crew, and read its
--    chat and the names of the people hired. A crew_id already used by a
--    different poster is now refused.
-- 2. Only the before and after photos are shared. A poster who allows the
--    helper to show the photos agreed to those two, not to every file in the
--    proof (documents, other photos). The read rule and worker_proof_photos
--    now only open files labelled 'before' or 'after'.
-- 3. Repeat can be switched off while the job is under way. Row level
--    security only lets a poster edit an open task, so the switch on the task
--    page failed once someone was hired; set_task_repeat() does it instead,
--    for the poster, on any task that is not cancelled.

create or replace function private.shape_poster_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.crew_id is not null and exists (
    select 1 from public.tasks t where t.crew_id = new.crew_id and t.poster_id <> new.poster_id
  ) then
    raise exception 'That crew belongs to someone else' using errcode = 'P0001';
  end if;

  if new.flash_until is not null then
    if new.assignment_mode is distinct from 'auto' then
      raise exception 'Flash Drop hires the first helper who accepts, so it needs Auto-hire'
        using errcode = 'P0001';
    end if;
    new.flash_until := now() + interval '30 minutes';
    new.flag := 'urgent';
  end if;

  if new.live_answer then
    if new.crew_id is not null then
      raise exception 'A Live answer is for one person' using errcode = 'P0001';
    end if;
    new.pillar := 'local_intel';
  end if;

  if new.crew_id is not null and new.repeat_every is not null then
    raise exception 'A crew job cannot repeat yet. Post it again when you need it' using errcode = 'P0001';
  end if;

  if new.preferred_worker_id is not null then
    if new.preferred_worker_id = new.poster_id then
      new.preferred_worker_id := null;
    elsif not exists (
      select 1 from public.assignments a
        join public.tasks t on t.id = a.task_id
       where t.poster_id = new.poster_id and a.worker_id = new.preferred_worker_id
    ) then
      raise exception 'You can offer a task first only to someone you hired before' using errcode = 'P0001';
    end if;
  end if;
  new.preferred_until := case when new.preferred_worker_id is null then null else now() + interval '10 minutes' end;

  if not new.want_photos then
    new.photos_public := false;
  end if;
  return new;
end;
$$;
revoke all on function private.shape_poster_options() from public, anon, authenticated;

-- Membership through the poster also requires every row of the crew to be theirs.
create or replace function private.is_crew_member(p_crew uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_crew is not null and p_uid is not null and (
    (
      exists (select 1 from public.tasks t where t.crew_id = p_crew and t.poster_id = p_uid)
      and not exists (select 1 from public.tasks t where t.crew_id = p_crew and t.poster_id <> p_uid)
    )
    or exists (
      select 1 from public.tasks t
        join public.assignments a on a.task_id = t.id
       where t.crew_id = p_crew and a.worker_id = p_uid
         and a.status in ('assigned', 'started', 'released')
    )
  );
$$;
revoke all on function private.is_crew_member(uuid, uuid) from public, anon;
grant execute on function private.is_crew_member(uuid, uuid) to authenticated;

-- Same as 134, with the shared-proof branch narrowed to the labelled photos.
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
                   select 1 from public.task_proofs tp
                     join public.tasks t on t.id = tp.task_id
                    where t.photos_public and t.status in ('COMPLETED', 'AUTO_COMPLETED')
                      and ( tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'before'))
                            or tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'after')) )
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
        select 1 from public.task_proofs tp
          join public.tasks t on t.id = tp.task_id
         where t.photos_public and t.status in ('COMPLETED', 'AUTO_COMPLETED')
           and ( tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'before'))
                 or tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'after')) )
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

-- Only the labelled before and after files leave this function.
create or replace function public.worker_proof_photos(p_worker uuid)
returns table (task_id uuid, title text, category text, completed_at timestamptz, files jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select x.task_id, x.title, x.category, x.completed_at,
         coalesce((select jsonb_agg(f) from jsonb_array_elements(x.files) f
                    where f ->> 'label' in ('before', 'after')), '[]'::jsonb)
    from (
      select distinct on (t.id) t.id as task_id, t.title, t.category, t.completed_at, tp.files
        from public.tasks t
        join public.task_proofs tp on tp.task_id = t.id and tp.worker_id = p_worker
       where t.photos_public
         and t.status in ('COMPLETED', 'AUTO_COMPLETED')
         and (select auth.uid()) is not null
       order by t.id, tp.created_at desc
    ) x
   order by x.completed_at desc nulls last
   limit 12;
$$;
revoke all on function public.worker_proof_photos(uuid) from public, anon;
grant execute on function public.worker_proof_photos(uuid) to authenticated;

-- Repeat on or off for the poster's own task, whatever stage it is at (not
-- cancelled, not a crew job).
create or replace function public.set_task_repeat(p_task_id uuid, p_every text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  if p_every is not null and p_every not in ('week', 'month') then
    raise exception 'Repeat every week or every month' using errcode = 'P0001';
  end if;
  update public.tasks
     set repeat_every = p_every
   where id = p_task_id and poster_id = v_me and crew_id is null and status <> 'CANCELLED';
  if not found then
    raise exception 'This task can no longer be changed' using errcode = 'P0001';
  end if;
  return p_every;
end;
$$;
revoke all on function public.set_task_repeat(uuid, text) from public, anon;
grant execute on function public.set_task_repeat(uuid, text) to authenticated;
