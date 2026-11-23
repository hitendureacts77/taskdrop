-- Undo for 20261123120300_201_cron_outbox_watchdog.sql (plan 3.5c, PR 4).
-- First revert the PR (puts the Inngest outbox-watchdog back) and let the inngest function redeploy and
-- sync, then run this. Two watchdogs for a few minutes is harmless (six-hour quiet time).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'outbox-watchdog') then
    perform cron.unschedule('outbox-watchdog');
  end if;
end $$;

delete from private.cron_jobs where job = 'outbox-watchdog';

-- "Stuck" back to 15 minutes (migration 105's body).
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

-- The nightly money check heartbeat stays in private.run_job_watchdog (harmless, reports only). To remove
-- it, re-run the run_job_watchdog definition from migration 198.
