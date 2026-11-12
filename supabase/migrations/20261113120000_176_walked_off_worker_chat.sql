-- 176: a worker who walked off stops hearing about the task, and a newly hired worker does not
-- read the chat of the worker before them (debug round 1, W2 and W4).
--
-- W2 (Medium) private.task_worker (048) returns the newest assignment of any status, so a worker
--     who walked off (cancel_task sets their assignment to 'refunded' and the task back to OPEN)
--     kept getting the poster's chat lines (the first 100 characters of each message) and the
--     task's paid / cancelled / changes / approved notices. Those now go only to a worker whose
--     assignment is live (assigned, started or released), preferring the one the task is locked
--     to: private.task_live_worker. Two cases keep the newest assignment on purpose:
--       * "<worker> left your task" (to the poster, task back to OPEN) names the worker who just left;
--       * "Task cancelled" and "A problem was reported" also reach the worker of a task that had
--         one when it closed: cancel_task and the admin refund mark the assignment 'refunded'
--         before they move the task, so the live lookup alone would miss the hired worker. A task
--         that was already OPEN (nobody hired any more) tells no worker.
--     private.task_worker itself is unchanged (private.repeat_finished_task, 134, still uses it
--     for the worker of a finished job).
-- W4 (Medium, privacy) messages_select_participant used private.can_use_task_thread, which is per
--     task: after a walk-off and a re-hire the new worker read the whole thread with the worker
--     before them (addresses, phone numbers). A worker now reads only the messages written at or
--     after the start of their current assignment (assignments.created_at, which lock_bid and
--     auto-hire refresh on a re-hire since 167). The poster still reads everything; a worker who
--     walked off already lost access (their assignment is 'refunded'). Writing is unchanged
--     (messages_insert_participant still uses can_use_task_thread). The api's listMessages reads
--     with the caller's own token, so this policy covers it too.
--
-- Only adds: two new functions, two trigger functions redefined from their latest versions
-- (on_message_inserted from 128, on_task_changed from 158) with only the worker lookup changed,
-- and the select policy's condition altered in place.

-- ---- 1. the live worker of a task ------------------------------------------------------
create or replace function private.task_live_worker(p_task uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.worker_id
    from public.assignments a
    left join public.tasks t on t.id = a.task_id
   where a.task_id = p_task
     and a.status in ('assigned', 'started', 'released')
   order by (a.bid_id is not distinct from t.locked_bid_id) desc, a.created_at desc
   limit 1
$$;
revoke all on function private.task_live_worker(uuid) from public, anon, authenticated;

-- ---- 2. chat notifications: from 128, the other side is the live worker -----------------
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
  -- W2: never a worker who walked off.
  v_other := case when new.sender_id = v_task.poster_id
                  then private.task_live_worker(v_task.id)
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
  v_text := case when new.body like '::media::%' then '📷 Photo' else left(new.body, 100) end;
  perform private.notify(v_other, 'message',
    private.who(new.sender_id, 'Someone') || ' sent you a message',
    private.label(v_task.title) || ': ' || v_text, v_task.id);
  return new;
exception when others then
  return new;
end;
$$;

-- ---- 3. task notifications: from 158, worker notices go to the live worker --------------
create or replace function private.on_task_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_worker uuid;
  v_live   uuid;
  v_closer uuid;
  v_task   text;
  v_cust   text;
begin
  if coalesce(current_setting('taskdrop.hunt_accept', true), '') <> '' then return new; end if;
  -- Set here, not in DECLARE: an error there would not be caught by the handler
  -- below, and wording must never block a task from changing state.
  v_task := private.label(new.title);
  v_cust := private.who(new.poster_id, 'The customer');

  if new.status = 'LOCKED' and old.status is distinct from 'LOCKED' then
    select b.worker_id into v_worker from public.bids b where b.id = new.locked_bid_id;
    perform private.notify(v_worker, 'picked', v_cust || ' picked you',
      'For ' || v_task || '. You can start once they have paid.', new.id);
  end if;

  if new.funded_at is not null and old.funded_at is null then
    perform private.notify(private.task_live_worker(new.id), 'funded', v_cust || ' has paid. You can start',
      v_task || ': your payment is held safely until the work is approved.', new.id);
  end if;

  if new.status is distinct from old.status then
    -- W2: notices to the worker go only to a live one. The poster's lines name the live worker,
    -- or the one who just left.
    v_live := private.task_live_worker(new.id);
    v_worker := coalesce(v_live, private.task_worker(new.id));
    -- A task closing tells the worker it had at that moment (their assignment may already be
    -- 'refunded'), and no one if it was already back to OPEN.
    v_closer := coalesce(v_live, case when old.status <> 'OPEN' then private.task_worker(new.id) end);
    case new.status
      when 'TASK_STARTED' then
        perform private.notify(new.poster_id, 'started',
          private.who(v_worker, 'Your worker') || ' started your task',
          v_task || ' is now in progress.', new.id);
      when 'WORK_DONE' then
        perform private.notify(new.poster_id, 'submitted',
          private.who(v_worker, 'Your worker') || ' sent in the work',
          'For ' || v_task || '. Approve it to pay them, or ask for changes.', new.id);
      when 'REVISION_REQUESTED' then
        perform private.notify(v_live, 'revision', v_cust || ' asked for changes',
          'On ' || v_task || '. Open it to see what to fix, then send it again.', new.id);
      when 'COMPLETED', 'AUTO_COMPLETED' then
        if new.status = 'AUTO_COMPLETED' then
          perform private.notify(v_live, 'released', 'Your work was approved',
            v_task || ': approved automatically. Your earnings will show in your wallet soon.', new.id);
        else
          perform private.notify(v_live, 'released', v_cust || ' approved your work',
            v_task || ': your earnings will show in your wallet soon.', new.id);
        end if;
      when 'CANCELLED' then
        -- Whoever did not cancel it is the one who needs telling; both hear it,
        -- which is harmless for the person who pressed the button.
        perform private.notify(v_closer, 'cancelled', 'Task cancelled',
          v_task || ' was cancelled. You can offer on other tasks.', new.id);
        perform private.notify(new.poster_id, 'cancelled', 'Task cancelled',
          v_task || ' was cancelled.', new.id);
      when 'DISPUTED' then
        perform private.notify(v_closer, 'dispute', 'A problem was reported',
          'On ' || v_task || '. Our team is looking into it and will update you here.', new.id);
        perform private.notify(new.poster_id, 'dispute', 'A problem was reported',
          'On ' || v_task || '. Our team is looking into it and will update you here.', new.id);
      when 'OPEN' then
        if old.status in ('LOCKED', 'TASK_STARTED', 'OVERDUE') then
          perform private.notify(new.poster_id, 'reopened',
            private.who(private.task_worker(new.id), 'Your worker') || ' left your task',
            v_task || ' is open again, so new offers can come in.', new.id);
        end if;
      else
        null;
    end case;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

-- ---- 4. who may read a message ---------------------------------------------------------
-- The poster: every message of their task. A worker: only while their assignment is live, and only
-- the messages from the start of that assignment on. Same grants as can_use_task_thread (the
-- policy runs it as the reader).
create or replace function private.can_read_task_message(p_task_id uuid, p_created_at timestamptz, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task_id and t.poster_id = p_user
  ) or exists (
    select 1 from public.assignments a
     where a.task_id = p_task_id
       and a.worker_id = p_user
       and a.status in ('assigned', 'started', 'released')
       and a.created_at <= p_created_at
  );
$$;

alter policy messages_select_participant on public.messages
  using (private.can_read_task_message(task_id, created_at, (select auth.uid())));
