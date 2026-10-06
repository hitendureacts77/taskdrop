-- 083: the pieces the app needs to talk only to the api Edge Function.
--
-- Safe to apply before the new app ships: nothing here takes anything away.
-- It adds
--
--   1. API_GATEWAY_SECRET in Vault -- the value the api function sends in the
--      x-taskdrop-gateway header;
--   2. private.require_gateway() -- the check that, once switched on by
--      supabase/lockdown/gateway_only.sql, refuses any data request that did
--      not come through our own server. It is NOT switched on here;
--   3. live "pings" for chat and notifications on a private per-user channel.
--      The app used to subscribe to table changes directly, which named the
--      tables and their columns in its bundle. A ping carries only "something
--      changed on task X" (or notification Y); the app then asks the api
--      function for the row, under the same row level security as before.

-- --------------------------------------------------------------- 1. secret --

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'API_GATEWAY_SECRET') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'API_GATEWAY_SECRET',
      'Sent by our own server in x-taskdrop-gateway; required by private.require_gateway(). Never ship it in the app.'
    );
  end if;
end;
$$;

-- ---------------------------------------------------- 2. the gateway check --

create or replace function private.require_gateway()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_claims  jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_sent    text  := v_headers ->> 'x-taskdrop-gateway';
  v_secret  text;
begin
  -- Our own server-side code with the service key (webhooks, payouts, the
  -- admin panel's read-only helper) is trusted as before.
  if coalesce(v_claims ->> 'role', '') = 'service_role' then
    return;
  end if;

  if v_sent is not null then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'API_GATEWAY_SECRET'
     limit 1;
    if v_secret is not null and v_sent = v_secret then
      return;
    end if;
  end if;

  -- Deliberately says nothing about why, or about what exists behind it.
  raise exception 'Not allowed' using errcode = '42501';
end;
$$;

revoke all on function private.require_gateway() from public;
grant execute on function private.require_gateway() to anon, authenticated, service_role;

comment on function private.require_gateway() is
  'PostgREST pre-request check. Switched on by supabase/lockdown/gateway_only.sql, not by any migration.';

-- ------------------------------------------------------------- 3. pings --

-- Only you may listen on your own channel, user:<your id>. (realtime.messages
-- has row level security on already; it belongs to Supabase, so it is not
-- altered here, only given a policy.)
drop policy if exists "own user channel" on realtime.messages;
create policy "own user channel" on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'user:' || (select auth.uid())::text);

create or replace function private.ping_new_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('kind', 'notification', 'id', new.id),
    'ping',
    'user:' || new.user_id::text,
    true
  );
  return null;
exception when others then
  -- A ping is a nicety; it must never stop the notification being written.
  return null;
end;
$$;

drop trigger if exists ping_new_notification on public.notifications;
create trigger ping_new_notification
  after insert on public.notifications
  for each row execute function private.ping_new_notification();

create or replace function private.ping_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  -- Everyone in the thread: the poster and any worker holding the task. The
  -- same people private.can_use_task_thread lets read it.
  for v_user in
    select t.poster_id from public.tasks t where t.id = new.task_id
    union
    select a.worker_id from public.assignments a
     where a.task_id = new.task_id and a.status in ('assigned', 'started', 'released')
  loop
    perform realtime.send(
      jsonb_build_object('kind', 'message', 'taskId', new.task_id),
      'ping',
      'user:' || v_user::text,
      true
    );
  end loop;
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists ping_new_message on public.messages;
create trigger ping_new_message
  after insert on public.messages
  for each row execute function private.ping_new_message();

revoke all on function private.ping_new_notification() from public, anon, authenticated;
revoke all on function private.ping_new_message() from public, anon, authenticated;
