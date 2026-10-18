-- The outbox that feeds Inngest (migration 090).
--
-- What is asserted:
--   1. emit_event() writes a row in the caller's own transaction, and a help
--      request, through its real trigger, produces a support.opened event that
--      carries no contact details.
--   2. The sweeper's view (outbox_pending) skips young events, lists old unsent
--      ones, and goes quiet once they are marked sent.
--   3. Only the service role can reach the Inngest-facing functions; a signed-in
--      user, or anything carrying an anon/authenticated claim, cannot.
--   4. admin_alerts is readable by admins only.
--   5. The old automation tool's tables, function, triggers and cron jobs are gone
--      (migration 102).
--   6. Events carry no free text: not a help-request subject, a job title or a
--      payout failure note (they can hold anything, and events leave the database).
--   7. Team alerts older than 30 days are pruned with the outbox; newer ones stay.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/outbox.test.sql

begin;

-- is_admin() is true for any psql/SQL-editor session (the operator rule, 040), which
-- would let the "ordinary user cannot read admin alerts" check pass for the wrong
-- reason. Narrow it to the real admin role for this transaction, exactly as
-- column_lockdown.test.sql and copyright_takedowns.test.sql do.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = 'public' as
$$ select coalesce(private.has_role(auth.uid(), 'admin'), false) $$;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_admin() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- ---- 1. events are written with the change, and carry no contact details ----
do $$
declare
  v_user   uuid := gen_random_uuid();
  v_before bigint;
  v_row    record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'test+' || v_user || '@taskdrop.test', '', now(), now(), now());
  -- handle_new_user() has already made the profile (named after the email); name it.
  update public.profiles set display_name = 'Outbox Tester' where id = v_user;

  select count(*) into v_before from private.outbox;
  perform private.emit_event('test.event', jsonb_build_object('hello', 'world'));
  if (select count(*) from private.outbox) <> v_before + 1 then
    raise exception 'FAIL: emit_event did not write an outbox row';
  end if;
  if not exists (select 1 from private.outbox
                  where kind = 'test.event' and data->>'hello' = 'world' and sent_at is null) then
    raise exception 'FAIL: the outbox row is missing its data or is already marked sent';
  end if;

  -- A help request announces itself through the real trigger.
  insert into public.support_tickets (user_id, category, subject)
  values (v_user, 'payment', 'Call me on 9876543210 about my payment');

  select * into v_row from private.outbox
   where kind = 'support.opened' and data->>'from' = 'Outbox Tester';
  if v_row.id is null then
    raise exception 'FAIL: opening a help request did not queue a support.opened event';
  end if;
  if v_row.data::text ~* '(phone|email|@)' then
    raise exception 'FAIL: the support.opened event carries contact details: %', v_row.data;
  end if;
  if v_row.data ? 'subject' or v_row.data::text like '%9876543210%' then
    raise exception 'FAIL: the support.opened event carries what the person typed: %', v_row.data;
  end if;
end;
$$;

-- ---- 2. the sweeper's view --------------------------------------------------
do $$
declare
  v_ids uuid[];
  v_n   integer;
begin
  -- Everything written above is seconds old: not the sweeper's business yet.
  if exists (select 1 from public.outbox_pending(500) where (data->>'hello' = 'world' or data->>'from' = 'Outbox Tester')) then
    raise exception 'FAIL: the sweeper picked up an event that is still on its fast path';
  end if;

  update private.outbox set created_at = now() - interval '5 minutes'
   where (data->>'hello' = 'world' or data->>'from' = 'Outbox Tester');

  select coalesce(array_agg(id), '{}') into v_ids
    from public.outbox_pending(500) where (data->>'hello' = 'world' or data->>'from' = 'Outbox Tester');
  if cardinality(v_ids) <> 2 then
    raise exception 'FAIL: the sweeper should see the 2 old unsent events, saw %', cardinality(v_ids);
  end if;

  v_n := public.outbox_mark_sent(v_ids);
  if v_n <> 2 then
    raise exception 'FAIL: outbox_mark_sent marked % events, expected 2', v_n;
  end if;
  if exists (select 1 from public.outbox_pending(500) where (data->>'hello' = 'world' or data->>'from' = 'Outbox Tester')) then
    raise exception 'FAIL: a sent event is still pending';
  end if;
  -- Marking twice changes nothing.
  if public.outbox_mark_sent(v_ids) <> 0 then
    raise exception 'FAIL: marking an already-sent event counted again';
  end if;

  -- Sent events are pruned after two weeks, not before.
  update private.outbox set sent_at = now() - interval '15 days' where id = v_ids[1];
  update private.outbox set sent_at = now() - interval '2 days'  where id = v_ids[2];
  if public.outbox_prune() < 1 then
    raise exception 'FAIL: outbox_prune did not remove the 15-day-old sent event';
  end if;
  if not exists (select 1 from private.outbox where id = v_ids[2]) then
    raise exception 'FAIL: outbox_prune removed a recently sent event';
  end if;
end;
$$;

-- ---- 3. who may call what ---------------------------------------------------
do $$
declare
  fn      text;
  v_user  uuid := gen_random_uuid();
  v_failed boolean;
begin
  foreach fn in array array[
    'outbox_pending', 'outbox_mark_sent', 'outbox_prune', 'daily_digest', 'record_admin_alert',
    'run_auto_complete_due'
  ] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = fn) then
      raise exception 'FAIL: public.%() does not exist', fn;
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = fn
                  and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
      raise exception 'FAIL: a signed-in or anonymous caller can execute public.%()', fn;
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = fn
                      and has_function_privilege('service_role', p.oid, 'EXECUTE')) then
      raise exception 'FAIL: the service role cannot execute public.%(), so Inngest cannot work', fn;
    end if;
  end loop;

  -- The outbox itself is not a table the app can read or write.
  if has_table_privilege('authenticated', 'private.outbox', 'SELECT')
     or has_table_privilege('anon', 'private.outbox', 'SELECT') then
    raise exception 'FAIL: the outbox is readable by an app role';
  end if;

  -- The belt: even with the grant somehow loosened, an anon/authenticated claim is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform public.daily_digest();
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: daily_digest ran for an authenticated claim';
  end if;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---- 4. the digest is totals only, and alerts are admin-only -----------------
do $$
declare
  v_digest jsonb;
  v_user   uuid := gen_random_uuid();
  v_seen   bigint;
begin
  v_digest := public.daily_digest();
  if not (v_digest ?& array['date', 'people_total', 'new_people', 'jobs_posted', 'jobs_finished',
                            'earned_rupees', 'withdrawals_waiting', 'open_disputes', 'open_help_requests']) then
    raise exception 'FAIL: the daily digest is missing a total: %', v_digest;
  end if;
  if v_digest::text ~* '(phone|email|@)' then
    raise exception 'FAIL: the daily digest carries contact details';
  end if;

  perform public.record_admin_alert('test', 'A test alert', 'body', '{}'::jsonb);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'test+' || v_user || '@taskdrop.test', '', now(), now(), now());

  perform pg_temp.become(v_user);
  select count(*) into v_seen from public.admin_alerts;
  perform pg_temp.as_admin();
  if v_seen <> 0 then
    raise exception 'FAIL: an ordinary user can read admin alerts (saw %)', v_seen;
  end if;
end;
$$;

-- ---- 5. the old automation tool is gone --------------------------------------
do $$
begin
  if to_regclass('private.automation_config') is not null or to_regclass('private.automation_log') is not null then
    raise exception 'FAIL: an old automation table is still there';
  end if;
  if to_regprocedure('private.send_daily_digest()') is not null then
    raise exception 'FAIL: private.send_daily_digest() is still there';
  end if;
  if exists (select 1 from pg_trigger where tgname like 'n8n\_%' escape '\' and not tgisinternal) then
    raise exception 'FAIL: an old automation trigger is still attached';
  end if;
  if exists (select 1 from cron.job where jobname like 'n8n-%') then
    raise exception 'FAIL: an old automation cron job is still scheduled';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'evt_support' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'evt_payout_new' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'evt_payout_failed' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'evt_dispute' and not tgisinternal) then
    raise exception 'FAIL: an event trigger is missing';
  end if;
end;
$$;

-- ---- 6. no free text leaves the database ------------------------------------
do $$
declare
  v_user  uuid := gen_random_uuid();
  v_task  uuid;
  v_pay   uuid;
  v_row   record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'free+' || v_user || '@taskdrop.test', '', now(), now(), now());
  update public.profiles set display_name = 'Free Text Tester' where id = v_user;

  -- A dispute: the job title must stay home.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_user, 'services', 'Fix the flat at 12 Cross Road, call 9876543210', 50000, 120)
  returning id into v_task;
  update public.tasks set status = 'DISPUTED' where id = v_task;
  select * into v_row from private.outbox where kind = 'dispute.opened' and data->>'task_id' = v_task::text;
  if v_row.id is null then raise exception 'FAIL: a dispute did not queue a dispute.opened event'; end if;
  if v_row.data ? 'title' or v_row.data::text like '%Cross Road%' or v_row.data::text like '%9876543210%' then
    raise exception 'FAIL: the dispute.opened event carries the job title: %', v_row.data;
  end if;
  if v_row.data->>'poster' <> 'Free Text Tester' then
    raise exception 'FAIL: the dispute.opened event lost the poster name: %', v_row.data;
  end if;

  -- A failed payout: the provider's failure note must stay home.
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_user, 50000, 'requested', 'upi:asha@okbank')
  returning id into v_pay;
  update public.payouts set status = 'failed', failure_note = 'UPI id asha@okbank not found' where id = v_pay;
  select * into v_row from private.outbox where kind = 'payout.failed' and data->>'payout_id' = v_pay::text;
  if v_row.id is null then raise exception 'FAIL: a failed payout did not queue a payout.failed event'; end if;
  if v_row.data ? 'reason' or v_row.data::text like '%okbank%' or v_row.data::text like '%not found%' then
    raise exception 'FAIL: the payout.failed event carries the failure note: %', v_row.data;
  end if;
  if (v_row.data->>'amount_rupees')::numeric <> 500 then
    raise exception 'FAIL: the payout.failed event lost the amount: %', v_row.data;
  end if;
  -- And the request itself never carried the destination.
  if exists (select 1 from private.outbox where kind = 'withdrawal.requested'
              and data->>'payout_id' = v_pay::text and data::text like '%okbank%') then
    raise exception 'FAIL: the withdrawal.requested event carries the payout destination';
  end if;
end;
$$;

-- ---- 7. team alerts are pruned after 30 days --------------------------------
do $$
declare
  v_old    uuid;
  v_recent uuid;
begin
  v_old    := public.record_admin_alert('test', 'An old alert', 'body', '{}'::jsonb);
  v_recent := public.record_admin_alert('test', 'A recent alert', 'body', '{}'::jsonb);
  update public.admin_alerts set created_at = now() - interval '31 days' where id = v_old;
  update public.admin_alerts set created_at = now() - interval '29 days' where id = v_recent;

  perform public.outbox_prune();

  if exists (select 1 from public.admin_alerts where id = v_old) then
    raise exception 'FAIL: outbox_prune left a 31-day-old team alert';
  end if;
  if not exists (select 1 from public.admin_alerts where id = v_recent) then
    raise exception 'FAIL: outbox_prune removed a 29-day-old team alert';
  end if;
end;
$$;

rollback;
