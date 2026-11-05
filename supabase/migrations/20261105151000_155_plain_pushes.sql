-- H42 (owner decision 26): lock-screen pushes for chat, payouts, wallet, support and
-- security show a plain line, never a name, an amount, a task title or typed text.
--
-- The Inngest push function already swaps the title and body of these kinds before it
-- sends (supabase/functions/inngest/jobs.ts, PLAIN_PUSH). This migration closes the
-- other road: while the settings row push_via_inngest is false, the database trigger
-- posts to Expo itself, and used to send the notification text as it is. The same
-- lines are used here, from one small helper. The notification row (what the in-app
-- list shows) and the push data (notificationId, kind, taskId: the deep link) are
-- not changed.

/** The plain title and body for a kind whose text must stay off the lock screen; null for every other kind. */
create or replace function private.push_plain_line(p_kind text)
returns text[]
language sql
immutable
set search_path to 'pg_temp'
as $fn$
  select case p_kind
    when 'message'       then array['You have a new message', 'Open taskdrop to read it.']
    when 'question'      then array['You have a new question or answer', 'Open taskdrop to read it.']
    when 'payout_paid'   then array['Your payout update is ready', 'Open taskdrop to see it.']
    when 'payout_failed' then array['Your payout update is ready', 'Open taskdrop to see it.']
    when 'wallet'        then array['Your wallet has an update', 'Open taskdrop to see it.']
    when 'wallet_refund' then array['Your wallet has an update', 'Open taskdrop to see it.']
    when 'cancel_fine'   then array['Your wallet has an update', 'Open taskdrop to see it.']
    when 'support'       then array['You have an update from support', 'Open taskdrop to read it.']
    when 'security'      then array['A security alert on your account', 'Open taskdrop to check your account.']
    when 'admin_warning' then array['You have a notice from taskdrop', 'Open taskdrop to read it.']
    else null
  end;
$fn$;
revoke all on function private.push_plain_line(text) from public, anon, authenticated;

-- Same trigger as migration 101; only the title and body of the direct road changed.
create or replace function private.push_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'private', 'pg_temp'
as $$
declare
  v_messages jsonb;
  v_plain text[];
begin
  if private.push_via_inngest() then
    if exists (select 1 from public.push_tokens pt where pt.user_id = new.user_id) then
      perform private.emit_event('notification.created', jsonb_build_object(
        'notification_id', new.id,
        'user_id', new.user_id,
        'kind', new.kind));
    end if;
    return new;
  end if;

  v_plain := private.push_plain_line(new.kind);

  select jsonb_agg(jsonb_build_object(
           'to', pt.token,
           'title', coalesce(v_plain[1], new.title),
           'body', coalesce(v_plain[2], coalesce(new.body, '')),
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
