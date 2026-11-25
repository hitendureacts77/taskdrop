-- 215 -- chat only while a task is locked, two days after it is done, then the messages are deleted
-- (plan task 1.19 row B).
--
-- Owner, 25 Nov: "Two people can chat only if there is a locked task between them and the task is
-- ongoing. After the task is completed they can chat for the next two days, but not after that. I don't
-- want the chat data after the task is done and settled: after two days run a scheduler and delete
-- those messages."
--
-- WHO MAY SEND (private.task_chat_state, enforced by the insert policy and by the api's sendMessage)
--   * Only the poster, or a worker whose assignment is live (assigned, started or released).
--   * Task LOCKED, TASK_STARTED, OVERDUE, WORK_DONE, REVISION_REQUESTED or DISPUTED: open.
--   * Task COMPLETED or AUTO_COMPLETED: open for 48 hours after completed_at, then closed
--     ('window_ended'). A dispute decided for the worker completes the task at the decision, so the
--     48 hours start then.
--   * Task OPEN (nobody hired yet, or the worker walked off): closed ('not_locked'). Before this the
--     poster could write into an open task's thread.
--   * Task CANCELLED (also a dispute decided for the poster): closed at once ('cancelled').
--   Reading is unchanged (messages_select_participant, 176): both people keep reading until deletion.
--
-- WHAT IS DELETED, AND WHEN (pg_cron job `chat-purge`, every hour at :37, through private.run_cron_job)
--   A. A finished task (COMPLETED, AUTO_COMPLETED or CANCELLED): every message of the task, 48 hours
--      after the latest of
--        - when it finished (completed_at; for a cancelled task its last cancellation or dispute
--          decision, else updated_at),
--        - when its Plan B money settled (task_holds.settled_at),
--        - when a dispute on it was decided (dispute_decisions.created_at),
--        - when the last report on it was handled (reports.handled_at, see "paused" below).
--   B. A task back to OPEN (the worker walked off, or a pre-lock note from before this migration):
--      every message, 48 hours after the latest message / walk-off / cancellation / handled report.
--   C. A task hired again after a walk-off: the messages written before the current hire started
--      (the earlier pair's thread, which the new worker never sees, 176), 48 hours after the re-hire.
--   With each deleted message go
--     - its picture: the media registry row ('::media::media:<id>', purpose 'chat') is marked
--       'deleted', and the existing Inngest media-purge (hourly) removes the file from ImageKit;
--     - the 'message' notifications of that task (they hold the first 100 characters of a message);
--     - message_moderation rows (on delete cascade, 118).
--   PAUSED (nothing of that task is deleted) while
--     - the task is DISPUTED,
--     - an open report (reports.status = 'open') names the task, one of its messages, or one of its
--       people reported by another of its people,
--     - Plan B money of a finished or reopened task is still moving (a hold awaiting payment, held,
--       release/refund/split asked, or failed).
--   When the pause ends (dispute decided, report handled, money settled) deletion runs 48 hours later.
--
-- WHAT IS KEPT
--   The task, its proofs, reviews, money rows, the dispute row and decision, the reports (their text
--   and the message id they named) and the admin audit log (message.hide with its reason). Chat
--   photos sent before the media registry (a plain storage path, '::media::<uid>/<file>') cannot be
--   removed from SQL (Supabase only deletes storage files through its Storage API): the message goes,
--   so nobody can open the file any more (private.can_read_task_media needs a message pointing to it),
--   and the run counts them as `legacy_files_left` for a later storage clean-up.
--
-- The run is safe to repeat and to overlap (one at a time through the wrapper), deletes at most 500
-- tasks' worth per run, and writes its counts to private.job_runs.result.
--
-- Adds only: functions, a policy condition altered in place, one cron job. Undo:
-- supabase/undo/215_chat_window.down.sql.

-- ---- 1. the grace period ------------------------------------------------------------------------
create or replace function private.chat_grace()
returns interval
language sql
immutable
as $$ select interval '48 hours' $$;
revoke all on function private.chat_grace() from public, anon;
grant execute on function private.chat_grace() to authenticated, service_role;

-- ---- 2. when a finished task's chat ended -------------------------------------------------------
/** The moment a COMPLETED, AUTO_COMPLETED or CANCELLED task finished; null for any other status. */
create or replace function private.task_chat_ended_at(p_task uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
           when t.status in ('COMPLETED', 'AUTO_COMPLETED') then coalesce(t.completed_at, t.updated_at)
           when t.status = 'CANCELLED' then coalesce(
             greatest(t.completed_at,
                      (select max(c.created_at) from public.cancellations_log c where c.task_id = t.id),
                      (select max(d.created_at) from public.dispute_decisions d where d.task_id = t.id)),
             t.updated_at)
         end
    from public.tasks t
   where t.id = p_task
$$;
revoke all on function private.task_chat_ended_at(uuid) from public, anon, authenticated;
grant execute on function private.task_chat_ended_at(uuid) to service_role;

-- ---- 3. the chat state of one task for one person -----------------------------------------------
/**
 * state      'open' (task live), 'closing' (completed, inside the 48 hours) or 'closed'
 * can_send   whether p_user may write now
 * reason     null, 'not_participant', 'not_locked', 'cancelled' or 'window_ended'
 * closes_at  'closing': when it closes; 'closed': when it closed (finished tasks only)
 * delete_after  the earliest time the messages may be deleted (finished tasks only; a dispute,
 *               an open report or money still moving can push it later)
 * An unknown task and someone else's task look the same: 'not_participant'.
 */
create or replace function private.task_chat_state(p_task uuid, p_user uuid)
returns table (task_id uuid, state text, can_send boolean, reason text, closes_at timestamptz, delete_after timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status text;
  v_poster uuid;
  v_end    timestamptz;
begin
  select t.status::text, t.poster_id into v_status, v_poster from public.tasks t where t.id = p_task;
  if v_status is null or p_user is null
     or not (v_poster = p_user
             or exists (select 1 from public.assignments a
                         where a.task_id = p_task and a.worker_id = p_user
                           and a.status in ('assigned', 'started', 'released'))) then
    return query select p_task, 'closed'::text, false, 'not_participant'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_status in ('LOCKED', 'TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED', 'DISPUTED') then
    return query select p_task, 'open'::text, true, null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_status = 'OPEN' then
    return query select p_task, 'closed'::text, false, 'not_locked'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_end := private.task_chat_ended_at(p_task);
  if v_status = 'CANCELLED' then
    return query select p_task, 'closed'::text, false, 'cancelled'::text, v_end, v_end + private.chat_grace();
    return;
  end if;

  -- COMPLETED or AUTO_COMPLETED
  if now() < v_end + private.chat_grace() then
    return query select p_task, 'closing'::text, true, null::text, v_end + private.chat_grace(), v_end + private.chat_grace();
  else
    return query select p_task, 'closed'::text, false, 'window_ended'::text, v_end + private.chat_grace(), v_end + private.chat_grace();
  end if;
end;
$$;
revoke all on function private.task_chat_state(uuid, uuid) from public, anon, authenticated;
grant execute on function private.task_chat_state(uuid, uuid) to service_role;

/** The insert policy's test: may p_user write into p_task's thread now. */
create or replace function private.can_send_task_message(p_task uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select s.can_send from private.task_chat_state(p_task, p_user) s), false)
$$;
revoke all on function private.can_send_task_message(uuid, uuid) from public, anon;
grant execute on function private.can_send_task_message(uuid, uuid) to authenticated, service_role;

-- ---- 4. writing: only inside the window --------------------------------------------------------
-- can_use_task_thread itself is unchanged: chat photos (can_read_task_media) still use it for reading.
alter policy messages_insert_participant on public.messages
  with check (
    sender_id = (select auth.uid())
    and private.can_send_task_message(task_id, (select auth.uid()))
  );

-- ---- 5. what the app asks: the chat state of the caller's tasks ---------------------------------
/** One row per asked task (at most 500), for the signed-in caller. See private.task_chat_state. */
create or replace function public.task_chat_states(p_task_ids uuid[])
returns table (task_id uuid, state text, can_send boolean, reason text, closes_at timestamptz, delete_after timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return query
    select s.task_id, s.state, s.can_send, s.reason, s.closes_at, s.delete_after
      from (select distinct x.id from unnest(coalesce(p_task_ids, '{}')) as x(id) where x.id is not null limit 500) ids
      cross join lateral private.task_chat_state(ids.id, v_uid) s;
end;
$$;
revoke all on function public.task_chat_states(uuid[]) from public, anon;
grant execute on function public.task_chat_states(uuid[]) to authenticated, service_role;

-- ---- 6. deletion ---------------------------------------------------------------------------------
/**
 * Delete this task's messages written before the returned time ('infinity' = all of them), or
 * nothing when null. Rules A, B and C and the pauses in the header.
 */
create or replace function private.task_chat_purge_before(p_task uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status  text;
  v_poster  uuid;
  v_people  uuid[];
  v_handled timestamptz;
  v_due     timestamptz;
  v_live    timestamptz;
begin
  select t.status::text, t.poster_id into v_status, v_poster from public.tasks t where t.id = p_task;
  if v_status is null or v_status = 'DISPUTED' then
    return null;
  end if;

  -- The task's people: the poster and every worker it ever had.
  select array_agg(distinct p) into v_people
    from (select v_poster as p
          union all
          select a.worker_id from public.assignments a where a.task_id = p_task) x;

  -- An open report on the task, one of its messages, or between its people pauses everything.
  if exists (
    select 1 from public.reports r
     where r.status = 'open'
       and ((r.target_type = 'task' and r.target_id = p_task)
         or (r.target_type = 'message' and r.target_id in (select m.id from public.messages m where m.task_id = p_task))
         or (r.target_type = 'user' and r.target_id = any (v_people) and r.reporter_id = any (v_people)))) then
    return null;
  end if;
  select max(r.handled_at) into v_handled
    from public.reports r
   where r.status <> 'open'
     and ((r.target_type = 'task' and r.target_id = p_task)
       or (r.target_type = 'message' and r.target_id in (select m.id from public.messages m where m.task_id = p_task))
       or (r.target_type = 'user' and r.target_id = any (v_people) and r.reporter_id = any (v_people)));

  -- A. finished
  if v_status in ('COMPLETED', 'AUTO_COMPLETED', 'CANCELLED') then
    if exists (select 1 from public.task_holds h
                where h.task_id = p_task
                  and h.status in ('awaiting_payment', 'held', 'release_asked', 'refund_asked', 'split_asked', 'failed')) then
      return null;
    end if;
    v_due := greatest(private.task_chat_ended_at(p_task),
                      (select max(h.settled_at) from public.task_holds h where h.task_id = p_task),
                      (select max(d.created_at) from public.dispute_decisions d where d.task_id = p_task),
                      v_handled) + private.chat_grace();
    return case when v_due <= now() then 'infinity'::timestamptz end;
  end if;

  -- B. back to OPEN
  if v_status = 'OPEN' then
    if exists (select 1 from public.task_holds h
                where h.task_id = p_task
                  and h.status in ('held', 'release_asked', 'refund_asked', 'split_asked', 'failed')) then
      return null;
    end if;
    v_due := greatest((select max(m.created_at) from public.messages m where m.task_id = p_task),
                      (select max(a.updated_at) from public.assignments a where a.task_id = p_task and a.status = 'refunded'),
                      (select max(c.created_at) from public.cancellations_log c where c.task_id = p_task),
                      v_handled) + private.chat_grace();
    return case when v_due <= now() then 'infinity'::timestamptz end;
  end if;

  -- C. live again after a walk-off: only what was written before the current hire began.
  if exists (select 1 from public.task_holds h
              where h.task_id = p_task and h.status in ('refund_asked', 'split_asked', 'failed')) then
    return null;
  end if;
  select min(a.created_at) into v_live
    from public.assignments a
   where a.task_id = p_task and a.status in ('assigned', 'started', 'released');
  if v_live is null then
    return null;
  end if;
  v_due := greatest(v_live, v_handled) + private.chat_grace();
  return case when v_due <= now() then v_live end;
end;
$$;
revoke all on function private.task_chat_purge_before(uuid) from public, anon, authenticated, service_role;

/**
 * pg_cron job `chat-purge` (through private.run_cron_job). Looks at every task that still has
 * messages, deletes what private.task_chat_purge_before allows, at most p_max_tasks tasks per run.
 * Returns the counts written to private.job_runs.result.
 */
create or replace function private.purge_ended_chats(p_max_tasks integer default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_task     uuid;
  v_before   timestamptz;
  v_n        integer;
  v_checked  integer := 0;
  v_tasks    integer := 0;
  v_msgs     integer := 0;
  v_pics     integer := 0;
  v_notes    integer := 0;
  v_legacy   integer := 0;
  v_kept     integer := 0;
begin
  for v_task in select m.task_id from public.messages m group by m.task_id order by min(m.created_at) loop
    exit when v_tasks >= greatest(coalesce(p_max_tasks, 500), 1);
    v_checked := v_checked + 1;
    v_before := private.task_chat_purge_before(v_task);
    if v_before is null then
      v_kept := v_kept + 1;
      continue;
    end if;

    -- Pictures in the registry: marked deleted; Inngest's media-purge removes them from ImageKit.
    -- Never one that a message staying behind (or another task) still shows.
    update public.media md
       set status = 'deleted', deleted_at = now(), updated_at = now()
     where md.status <> 'deleted'
       and md.purpose = 'chat'
       and md.id in (select substring(m.body from 16)::uuid
                       from public.messages m
                      where m.task_id = v_task and m.created_at < v_before
                        and m.body ~ '^::media::media:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
       and not exists (select 1 from public.messages o
                        where left(o.body, 60) = left('::media::media:' || md.id::text, 60)
                          and o.body = '::media::media:' || md.id::text
                          and not (o.task_id = v_task and o.created_at < v_before));
    get diagnostics v_n = row_count;
    v_pics := v_pics + v_n;

    select count(*) into v_n
      from public.messages m
     where m.task_id = v_task and m.created_at < v_before
       and m.body like '::media::%' and m.body not like '::media::media:%';
    v_legacy := v_legacy + v_n;

    delete from public.messages m where m.task_id = v_task and m.created_at < v_before;
    get diagnostics v_n = row_count;
    v_msgs := v_msgs + v_n;
    if v_n > 0 then
      v_tasks := v_tasks + 1;
    end if;

    -- The chat notices hold the first 100 characters of a message.
    delete from public.notifications n
     where n.task_id = v_task and n.kind = 'message' and n.created_at < v_before;
    get diagnostics v_n = row_count;
    v_notes := v_notes + v_n;
  end loop;

  return jsonb_build_object('checked', v_checked, 'purged_tasks', v_tasks, 'messages', v_msgs,
                            'pictures', v_pics, 'notifications', v_notes,
                            'legacy_files_left', v_legacy, 'kept', v_kept);
end;
$$;
revoke all on function private.purge_ended_chats(integer) from public, anon, authenticated, service_role;

-- ---- 7. the cron job ---------------------------------------------------------------------------------
insert into private.cron_jobs (job, max_gap, money, timeout, once_per_ist_day) values
  ('chat-purge', interval '3 hours', false, interval '5 minutes', false)
on conflict (job) do update
  set max_gap = excluded.max_gap, money = excluded.money, timeout = excluded.timeout,
      once_per_ist_day = excluded.once_per_ist_day;

-- private.cron_dispatch is replaced whole by every migration that adds a job. Refuse to run if the
-- live copy has a case this one does not (a job added by a migration merged after this one was
-- written): copy the live function into this migration first, then add 'chat-purge'.
do $$
declare
  v_known   text[] := array['job-watchdog', 'housekeeping', 'outbox-prune', 'user-sync-repair', 'crm-rules',
                            'overdue-tasks', 'task-reminders', 'sms-pumping-watch', 'daily-digest',
                            'public-snapshots', 'outbox-watchdog', 'auto-complete-due', 'settle-cleared-often',
                            'settle-finished-campaigns', 'selftest-ok', 'selftest-fail', 'chat-purge'];
  v_missing text[];
begin
  select coalesce(array_agg(x.m[1]), '{}') into v_missing
    from regexp_matches(pg_get_functiondef('private.cron_dispatch(text)'::regprocedure),
                        $re$when '([a-z0-9-]+)' then$re$, 'g') as x(m)
   where not (x.m[1] = any (v_known));
  if cardinality(v_missing) > 0 then
    raise exception 'migration 215 would drop cron_dispatch cases %: copy the live private.cron_dispatch into it first', v_missing;
  end if;
end $$;

create or replace function private.cron_dispatch(p_job text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
begin
  case p_job
    when 'job-watchdog' then
      return private.run_job_watchdog();
    when 'housekeeping' then
      return public.run_housekeeping();
    when 'outbox-prune' then
      return to_jsonb(public.outbox_prune());
    when 'user-sync-repair' then
      return public.user_sync_repair();
    when 'crm-rules' then
      return to_jsonb(public.run_crm_rules());
    when 'overdue-tasks' then
      return to_jsonb(public.run_overdue_tasks());
    when 'task-reminders' then
      return public.run_task_reminders();
    when 'sms-pumping-watch' then
      return public.run_sms_pumping_watch();
    when 'daily-digest' then
      return private.run_daily_digest();
    when 'public-snapshots' then
      return private.run_public_snapshots();
    when 'outbox-watchdog' then
      return public.run_outbox_watchdog();
    -- money sweeps (migration 202)
    when 'auto-complete-due' then
      return jsonb_build_object('completed', private.auto_complete_due());
    when 'settle-cleared-often' then
      return jsonb_build_object('settled', public.settle_cleared_earnings());
    when 'settle-finished-campaigns' then
      return jsonb_build_object('settled', public.settle_finished_campaigns());
    -- chat window (migration 215)
    when 'chat-purge' then
      return private.purge_ended_chats(500);
    when 'selftest-ok' then
      return jsonb_build_object('ok', true);
    when 'selftest-fail' then
      raise exception 'self-test failure on purpose: %', repeat('x', 400) using errcode = 'P0001';
    else
      raise exception 'cron job % has no case in private.cron_dispatch', p_job using errcode = '22023';
  end case;
end;
$fn$;
revoke all on function private.cron_dispatch(text) from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'chat-purge') then
    perform cron.unschedule('chat-purge');
  end if;
  perform cron.schedule('chat-purge', '37 * * * *',
    $c$set statement_timeout = '5min'; select private.run_cron_job('chat-purge')$c$);
end $$;
