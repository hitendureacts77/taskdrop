-- 051: phone notifications.
--
-- Every in-app notification (a quote arrived, you were picked, work started,
-- payment released, a message...) is already a row in public.notifications,
-- written by the triggers in 048. This sends the same row to the person's
-- phone through Expo's push service, for installed builds that registered a
-- token. While the app is open it also shows them itself, from the realtime
-- feed, so nothing here is needed for that.

create extension if not exists pg_net with schema extensions;

create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  platform    text not null default 'android',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;

-- A device belongs to whoever is signed in on it. Upserting a token that was
-- someone else's (a shared phone, a new sign-in) moves it to you.
drop policy if exists push_tokens_own_select on public.push_tokens;
create policy push_tokens_own_select on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists push_tokens_own_delete on public.push_tokens;
create policy push_tokens_own_delete on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- Registration goes through this function so a token can change hands without
-- giving anyone update rights over other people's rows.
create or replace function public.register_push_token(p_token text, p_platform text default 'android')
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in first';
  end if;
  if p_token is null or p_token !~ '^ExponentPushToken\[.+\]$' then
    raise exception 'Not an Expo push token';
  end if;
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, v_uid, coalesce(p_platform, 'android'))
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;
revoke all on function public.register_push_token(text, text) from public;
revoke execute on function public.register_push_token(text, text) from anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- Send a new notification to every device of its recipient. Fire-and-forget
-- through pg_net: a failed push must never undo the action that caused it.
create or replace function private.push_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_messages jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'to', pt.token,
           'title', new.title,
           'body', coalesce(new.body, ''),
           'sound', 'default',
           'priority', 'high',
           'channelId', 'default',
           'data', jsonb_build_object('notificationId', new.id, 'kind', new.kind, 'taskId', new.task_id)
         ))
    into v_messages
    from public.push_tokens pt
   where pt.user_id = new.user_id;

  if v_messages is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := v_messages,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json')
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.push_notification() from public;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function private.push_notification();
