-- 193: people who sent an offer hear when the task changes under them (debug round 8, S2-10, S2-11).
--
-- S2-10 A poster may still edit an open task after offers came in (the edit rule is unchanged: the
--       product rules do not lock it). But nobody who had offered was told, so a worker could be
--       hired at a price they gave for a different job. Now, when an OPEN task's title,
--       description, price, place name, deadline or time limit changes, everyone with an offer on
--       it gets a "task_changed" notice asking them to check it and change their offer if they need
--       to. At most one such notice per person per task every 10 minutes, so a poster fixing a
--       typo three times does not send three.
-- S2-11 A poster cancelling an OPEN task told only themselves; the workers who had offered kept an
--       offer on a dead task with no word. Now each of them gets the same "Task cancelled" notice
--       a hired worker gets.
--
-- private.on_task_changed is redefined from 176 with only these two additions. Wording never
-- blocks a task from changing state (the exception handler stays).

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
  v_bidder uuid;
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

  -- S2-10: an open task edited after offers came in. Everyone who offered hears it, once per 10 minutes.
  if new.status = 'OPEN' and old.status = 'OPEN'
     and (new.title, new.description, new.benchmark_minor, new.loc_label, new.due_at, new.time_limit_minutes)
         is distinct from
         (old.title, old.description, old.benchmark_minor, old.loc_label, old.due_at, old.time_limit_minutes) then
    for v_bidder in
      select distinct b.worker_id from public.bids b
       where b.task_id = new.id and b.worker_id <> new.poster_id
    loop
      if not exists (
        select 1 from public.notifications n
         where n.user_id = v_bidder and n.task_id = new.id and n.kind = 'task_changed'
           and n.created_at > now() - interval '10 minutes'
      ) then
        perform private.notify(v_bidder, 'task_changed', 'A task you offered on changed',
          v_cust || ' changed ' || v_task || '. Check the details, and change your offer if you need to.', new.id);
      end if;
    end loop;
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
        -- S2-11: an open task taken down tells everyone who had offered on it.
        if old.status = 'OPEN' then
          for v_bidder in
            select distinct b.worker_id from public.bids b
             where b.task_id = new.id and b.worker_id <> new.poster_id
               and b.worker_id is distinct from v_closer
          loop
            perform private.notify(v_bidder, 'cancelled', 'Task cancelled',
              v_task || ' was cancelled. You can offer on other tasks.', new.id);
          end loop;
        end if;
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
