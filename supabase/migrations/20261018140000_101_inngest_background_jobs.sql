-- 101 -- the rest of the background work moves to Inngest (Phase 5).
--
-- Same split as 090: Postgres owns the rules and the data, Inngest owns when
-- things run, retries and calls to the outside world. Everything here is
-- reachable by the service role only (the `inngest` Edge Function); none of it
-- is granted to anon or authenticated.
--
--   push notifications     notification.created -> Expo push, receipts, dead tokens
--   deleted-account files  user.deleted -> storage files removed, with retries
--   overdue tasks          a started job past its due time becomes OVERDUE
--   housekeeping           the prunes that pg_cron ran, plus the ones nobody ran
--
-- Nothing is dropped or renamed (ground rule 2), and nothing changes for the
-- apps until the owner flips the push switch by hand (see supabase/cutover/
-- inngest_background_jobs.sql). Until then pushes keep going out the old way,
-- straight from the database, so a phone never goes quiet while Inngest is
-- being set up.

-- ------------------------------------------------------------ push: the switch --

-- True once the owner has moved push to Inngest. Off when the row is missing.
create or replace function private.push_via_inngest()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select coalesce((select (value #>> '{}') = 'true' from public.settings where key = 'push_via_inngest'), false);
$fn$;
revoke all on function private.push_via_inngest() from public, anon, authenticated;

-- One trigger, two roads. The event carries ids and the kind of notification
-- only: the title and body can hold a job title, so they stay in the database
-- and the Edge Function reads them itself (push_job_load below).
create or replace function private.push_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'private', 'pg_temp'
as $$
declare
  v_messages jsonb;
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

/**
 * What to send for one notification: a message per device the person has
 * registered, in the shape Expo's push API takes. Empty when the notification or
 * every device is gone. Read by the Edge Function, which sends it.
 */
create or replace function public.push_job_load(p_notification uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
begin
  perform private.assert_service_caller();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'to', pt.token,
             'title', n.title,
             'body', coalesce(n.body, ''),
             'sound', 'default',
             'priority', 'high',
             'channelId', 'default',
             'data', jsonb_build_object('notificationId', n.id, 'kind', n.kind, 'taskId', n.task_id)
           ) order by pt.token)
      from public.notifications n
      join public.push_tokens pt on pt.user_id = n.user_id
     where n.id = p_notification
  ), '[]'::jsonb);
end;
$fn$;

/** The person's device tokens, so a receipt can be matched back to a device. */
create or replace function public.push_tokens_of(p_user uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
begin
  perform private.assert_service_caller();
  return coalesce((select array_agg(token order by token) from public.push_tokens where user_id = p_user), '{}');
end;
$fn$;

/** Expo says a device is gone (app uninstalled, token expired): forget it. */
create or replace function public.push_remove_tokens(p_tokens text[])
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_n integer;
begin
  perform private.assert_service_caller();
  delete from public.push_tokens where token = any (coalesce(p_tokens, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- ------------------------------------------------ deleted accounts: their files --

/**
 * The files still in storage that belonged to a deleted account and that no kept
 * record points to: the same rule delete_account() (087) used when it listed
 * them, asked again afterwards. The api function removes them straight away on a
 * best-effort basis; this is what finishes the job when that fell short, and it
 * is empty once nothing is left, so running it twice does no harm.
 */
create or replace function public.deleted_account_files(p_user uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'storage', 'pg_temp'
as $fn$
begin
  perform private.assert_service_caller();
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is not null) then
    return '{}';   -- not a deleted account: never touch anyone's files
  end if;
  return coalesce((
    select array_agg(o.name order by o.name)
      from storage.objects o
     where o.bucket_id = 'task-media'
       and o.name like p_user::text || '/%'
       and not exists (select 1 from public.tasks t
                        where t.poster_id = p_user and t.media_path = o.name and t.status <> 'CANCELLED')
       and not exists (select 1 from public.task_proofs p
                        where p.worker_id = p_user and strpos(p.files::text, o.name) > 0)
  ), '{}');
end;
$fn$;

-- ------------------------------------------------------------------ overdue tasks --

/**
 * A job that was started and is past the time the poster set becomes OVERDUE.
 * Only the label changes: OVERDUE is treated as "in progress" everywhere (the
 * worker can still finish it, the poster can still cancel it with the same 5%
 * fine as TASK_STARTED), and no money moves. Returns how many it marked.
 */
create or replace function public.run_overdue_tasks()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_n integer;
begin
  perform private.assert_service_caller();
  update public.tasks
     set status = 'OVERDUE'
   where status = 'TASK_STARTED'
     and due_at is not null
     and due_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- ------------------------------------------------------------------- housekeeping --

/**
 * Clears out records that have outlived their use. Replaces the two pg_cron
 * prunes (api-rate-prune, password-attempts-prune) and adds the ones that were
 * never scheduled. Returns how many rows went from each table.
 *
 *   api_rate           counters older than an hour
 *   password_attempts  older than 30 days
 *   auth_codes         sign-in codes a day past their expiry
 *   auth_send_log      per-IP send counters a day past their window
 *   places_quota       per-account search counters a day past their window
 *   notifications      older than 90 days
 */
create or replace function public.run_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_rate integer; v_pw integer; v_codes integer; v_sends integer; v_places integer; v_notes integer;
begin
  perform private.assert_service_caller();

  delete from private.api_rate where window_start < now() - interval '1 hour';
  get diagnostics v_rate = row_count;

  delete from public.password_attempts where at < now() - interval '30 days';
  get diagnostics v_pw = row_count;

  delete from public.auth_codes where expires_at < now() - interval '1 day';
  get diagnostics v_codes = row_count;

  delete from public.auth_send_log where window_started_at < now() - interval '1 day';
  get diagnostics v_sends = row_count;

  delete from public.places_quota where window_started_at < now() - interval '1 day';
  get diagnostics v_places = row_count;

  delete from public.notifications where created_at < now() - interval '90 days';
  get diagnostics v_notes = row_count;

  return jsonb_build_object(
    'api_rate', v_rate, 'password_attempts', v_pw, 'auth_codes', v_codes,
    'auth_send_log', v_sends, 'places_quota', v_places, 'notifications', v_notes);
end;
$fn$;

-- ----------------------------------------------------------------------- grants --

-- Supabase hands EXECUTE on new public functions to anon and authenticated.
-- Take it back, then give it to the service role alone.
revoke all on function public.push_job_load(uuid), public.push_tokens_of(uuid), public.push_remove_tokens(text[]),
  public.deleted_account_files(uuid), public.run_overdue_tasks(), public.run_housekeeping()
  from public, anon, authenticated;
grant execute on function public.push_job_load(uuid), public.push_tokens_of(uuid), public.push_remove_tokens(text[]),
  public.deleted_account_files(uuid), public.run_overdue_tasks(), public.run_housekeeping()
  to service_role;
