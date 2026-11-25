-- Undo for 20261125150000_215_chat_window.sql (plan 1.19 row B).
--
-- Stops the chat-purge job and lets the poster and live worker write at any time again (the insert
-- policy as it was since 012). Messages already deleted by chat-purge cannot be brought back (restore
-- from a backup if that is ever needed). The functions stay: nothing calls the purge once it is
-- unscheduled, and the api's chatState / sendMessage check would keep answering from
-- public.task_chat_states, so redeploy the api from before 215 too if sends must open again everywhere.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'chat-purge') then
    perform cron.unschedule('chat-purge');
  end if;
end $$;

-- Off the watched list, so job-watchdog does not call it stopped. The dispatch case stays (harmless).
delete from private.cron_jobs where job = 'chat-purge';

alter policy messages_insert_participant on public.messages
  with check (
    sender_id = (select auth.uid())
    and private.can_use_task_thread(task_id, (select auth.uid()))
  );
