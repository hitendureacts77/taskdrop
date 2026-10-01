-- 058_task_contact_phone
--
-- The chat header has a call button, and "contacts unmask when the task
-- starts" has always been the promise, but nothing could actually hand over a
-- number: phone numbers live only inside the auth email a phone sign-up is
-- given (p<10 digits>@phone.taskdrop.app), which no client can read.
--
-- This returns the *other* side's number for one task, and only when:
--   * the caller is that task's poster or its hired worker, and
--   * the work has started (the same moment names and contacts unmask).
-- Anyone else, or any earlier status, gets an error rather than a number.
-- Accounts made with Google have no phone, so they return null.

create or replace function public.task_contact_phone(p_task_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  v_task  public.tasks;
  v_other uuid;
  v_email text;
begin
  if v_me is null then
    raise exception 'Sign in first';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;

  if v_task.status not in ('TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED',
                           'COMPLETED', 'AUTO_COMPLETED', 'DISPUTED') then
    raise exception 'Contact details unlock when the work starts';
  end if;

  if v_task.poster_id = v_me then
    select a.worker_id into v_other
      from public.assignments a
     where a.task_id = p_task_id
       and a.status in ('assigned', 'started', 'released')
     order by a.created_at desc
     limit 1;
  elsif exists (
    select 1 from public.assignments a
     where a.task_id = p_task_id
       and a.worker_id = v_me
       and a.status in ('assigned', 'started', 'released')
  ) then
    v_other := v_task.poster_id;
  else
    raise exception 'This is not your task';
  end if;

  if v_other is null then
    return null;
  end if;

  select u.email into v_email from auth.users u where u.id = v_other;
  if v_email ~ '^p[0-9]{10}@phone\.taskdrop\.app$' then
    return '+91' || substring(v_email from '^p([0-9]{10})@');
  end if;
  return null;
end;
$$;

revoke all on function public.task_contact_phone(uuid) from public, anon;
grant execute on function public.task_contact_phone(uuid) to authenticated;

-- Chat photos are sent as a message whose body is '::media::<storage path>'.
-- The new-message notification quoted the body verbatim, so a photo would have
-- arrived as a storage path. Same trigger as 048, reading "📷 Photo" instead.
create or replace function private.on_message_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task  public.tasks;
  v_other uuid;
  v_text  text;
begin
  select * into v_task from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;
  v_other := case when new.sender_id = v_task.poster_id
                  then private.task_worker(v_task.id)
                  else v_task.poster_id end;
  if v_other is null then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
     where n.user_id = v_other and n.task_id = v_task.id and n.kind = 'message'
       and n.read_at is null and n.created_at > now() - interval '10 minutes'
  ) then
    return new;
  end if;
  v_text := case when new.body like '::media::%' then '📷 Photo' else left(new.body, 120) end;
  perform private.notify(v_other, 'message', 'New message on "' || left(v_task.title, 60) || '"',
    v_text, v_task.id);
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.on_message_inserted() from public;
