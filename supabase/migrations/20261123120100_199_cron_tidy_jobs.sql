-- 199 -- plan task 3.5c, PR 2: five tidy jobs move from Inngest to pg_cron.
--
--   housekeeping       run_housekeeping()     every hour at :17          (was Inngest, every 3 h)
--   outbox-prune       outbox_prune()         04:15 IST, catch-up 05:15  (was Inngest, 04:15 IST)
--   user-sync-repair   user_sync_repair()     03:10 IST, catch-up 04:10  (was Inngest, 03:10 IST)
--   crm-rules          run_crm_rules()        every 3 h on the UTC hour  (same as Inngest)
--   overdue-tasks      run_overdue_tasks()    every 10 min at :01        (was Inngest, every 30 min)
--
-- Each runs through private.run_cron_job (migration 198): one at a time, every run in
-- private.job_runs, a failure goes to the team and Sentry. The Inngest copies are removed in the
-- same PR. All five are safe to run twice (deletes, a label, and "not exists" / "on conflict do
-- nothing" guards), so a short overlap while the inngest function redeploys changes nothing.
-- Adds only. Undo: supabase/undo/199_cron_tidy_jobs.down.sql.

insert into private.cron_jobs (job, max_gap, money, timeout, once_per_ist_day) values
  ('housekeeping',     interval '2 hours',    false, interval '5 minutes', false),
  ('outbox-prune',     interval '26 hours',   false, interval '5 minutes', true),
  ('user-sync-repair', interval '26 hours',   false, interval '5 minutes', true),
  ('crm-rules',        interval '4 hours',    false, interval '5 minutes', false),
  ('overdue-tasks',    interval '30 minutes', false, interval '2 minutes', false)
on conflict (job) do update
  set max_gap = excluded.max_gap, money = excluded.money, timeout = excluded.timeout,
      once_per_ist_day = excluded.once_per_ist_day;

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
declare
  r record;
begin
  for r in
    select * from (values
      ('housekeeping',             '17 * * * *',     '5min', 'housekeeping'),
      ('outbox-prune',             '45 22 * * *',    '5min', 'outbox-prune'),
      ('outbox-prune-catchup',     '45 23 * * *',    '5min', 'outbox-prune'),
      ('user-sync-repair',         '40 21 * * *',    '5min', 'user-sync-repair'),
      ('user-sync-repair-catchup', '40 22 * * *',    '5min', 'user-sync-repair'),
      ('crm-rules',                '0 */3 * * *',    '5min', 'crm-rules'),
      ('overdue-tasks',            '1-59/10 * * * *', '2min', 'overdue-tasks')
    ) as t(jobname, schedule, timeout, job)
  loop
    if exists (select 1 from cron.job where jobname = r.jobname) then
      perform cron.unschedule(r.jobname);
    end if;
    perform cron.schedule(r.jobname, r.schedule,
      format('set statement_timeout = %L; select private.run_cron_job(%L)', r.timeout, r.job));
  end loop;
end $$;
