-- ===========================================================================
-- Migration 105: two more Inngest jobs
--
--   run_outbox_watchdog()  every 10 minutes. If events have sat unsent in the
--                          outbox for more than 15 minutes, the bridge to Inngest
--                          is broken (wrong key, Inngest down, function not
--                          deployed). Leaves one team alert, then stays quiet for
--                          six hours so a long outage is one message, not hundreds.
--
--   run_task_reminders()   every 15 minutes. Two plain reminders, each sent once
--                          per task and person:
--                            - to the poster: finished work is waiting for their
--                              approval and will be approved for them within 24 hours
--                            - to the worker: a started job is due within the hour
--                          They are ordinary in-app notifications, so they also
--                          reach the phone when push is on. No money moves.
--
-- Both are callable by the service role only (like every Inngest-facing function).
-- Adds only; nothing is dropped or renamed.
-- ===========================================================================

-- ---- outbox watchdog --------------------------------------------------------
create or replace function public.run_outbox_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_stuck   integer;
  v_minutes integer;
  v_alerted boolean := false;
begin
  perform private.assert_service_caller();

  select count(*), coalesce(floor(extract(epoch from now() - min(created_at)) / 60), 0)::integer
    into v_stuck, v_minutes
    from private.outbox
   where sent_at is null
     and created_at < now() - interval '15 minutes';

  if v_stuck > 0
     and not exists (select 1 from public.admin_alerts
                      where kind = 'outbox_stuck' and created_at > now() - interval '6 hours') then
    perform public.record_admin_alert(
      'outbox_stuck',
      'Background jobs are not receiving events',
      v_stuck || ' event(s) have waited unsent, the oldest for ' || v_minutes
        || ' minutes. Check the Inngest keys and that the inngest function is deployed and synced.',
      jsonb_build_object('stuck', v_stuck, 'oldest_minutes', v_minutes));
    v_alerted := true;
  end if;

  return jsonb_build_object('stuck', v_stuck, 'oldest_minutes', v_minutes, 'alerted', v_alerted);
end;
$$;

-- ---- task reminders ---------------------------------------------------------
create or replace function public.run_task_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  r        record;
  v_review integer := 0;
  v_due    integer := 0;
begin
  perform private.assert_service_caller();

  -- One run at a time; a second caller simply does nothing.
  if not pg_try_advisory_xact_lock(hashtextextended('run_task_reminders', 0)) then
    return jsonb_build_object('review_reminders', 0, 'due_reminders', 0, 'skipped', true);
  end if;

  -- Poster: finished work, approved for them within 24 hours if they do nothing.
  for r in
    select t.id, t.poster_id
      from public.tasks t
     where t.status = 'WORK_DONE'
       and t.funded_at is not null
       and t.auto_complete_at is not null
       and t.auto_complete_at > now()
       and t.auto_complete_at <= now() + interval '24 hours'
       and not exists (select 1 from public.notifications n
                        where n.task_id = t.id and n.user_id = t.poster_id and n.kind = 'review_reminder')
     order by t.auto_complete_at
     limit 500
  loop
    perform private.notify(
      r.poster_id, 'review_reminder',
      'Work is waiting for your approval',
      'Approve it or report a problem. If you do nothing, it is approved for you within 24 hours.',
      r.id);
    v_review := v_review + 1;
  end loop;

  -- Worker: a started job that falls due within the hour.
  for r in
    select t.id, a.worker_id
      from public.tasks t
      join public.assignments a on a.task_id = t.id and a.status = 'started'
     where t.status = 'TASK_STARTED'
       and t.due_at is not null
       and t.due_at > now()
       and t.due_at <= now() + interval '1 hour'
       and not exists (select 1 from public.notifications n
                        where n.task_id = t.id and n.user_id = a.worker_id and n.kind = 'due_reminder')
     order by t.due_at
     limit 500
  loop
    perform private.notify(
      r.worker_id, 'due_reminder',
      'Your job is due within the hour',
      'Send your finished work before the deadline.',
      r.id);
    v_due := v_due + 1;
  end loop;

  return jsonb_build_object('review_reminders', v_review, 'due_reminders', v_due);
end;
$$;

-- ---- who may call them ------------------------------------------------------
revoke all on function public.run_outbox_watchdog(), public.run_task_reminders()
  from public, anon, authenticated;
grant execute on function public.run_outbox_watchdog(), public.run_task_reminders() to service_role;
