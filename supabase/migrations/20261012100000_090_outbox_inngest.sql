-- 090 -- background jobs move to Inngest; n8n is removed.
--
-- The split (docs/UPGRADE_PLAN.md, Phase 5):
--   * Postgres owns the rules and the money, and writes down what happened.
--   * Inngest owns schedules, retries and calls to the outside world.
--
-- The bridge is an outbox. emit_event() writes a row in the SAME transaction as
-- the thing that happened, so an event can never be lost or invented. The row is
-- then pushed to Inngest straight away (pg_net, after commit). If that push does
-- not land, a sweeper run by Inngest itself re-sends it; the outbox id is the
-- Inngest event id, so a second send is dropped as a duplicate.
--
-- Nothing here can break the action that triggered it: emit_event() swallows its
-- own errors, as the n8n version did.
--
-- Events carry names and amounts, never phone numbers, emails, bank details or
-- UPI ids (unchanged from migration 080):
--   user.signed_up        { user_id, name }
--   user.deleted          { user_id, by_admin }
--   support.opened        { ticket_id, category, subject, from }
--   withdrawal.requested  { payout_id, amount_rupees, name, via }
--   payout.failed         { payout_id, amount_rupees, name, reason }
--   dispute.opened        { task_id, title, poster }
--
-- Where Inngest lives is one Vault secret, `inngest_event_url`, the full event
-- URL including the event key, e.g. https://inn.gs/e/<EVENT_KEY>. Unset, events
-- still pile up safely in the outbox and go out once it is set.

-- ----------------------------------------------------------------- outbox --

create table if not exists private.outbox (
  id         uuid primary key default gen_random_uuid(),   -- also the Inngest event id
  kind       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  request_id bigint,                                       -- pg_net request of the fast path
  sent_at    timestamptz,                                  -- Inngest confirmed receipt
  attempts   integer not null default 0
);
create index if not exists outbox_unsent_idx on private.outbox (created_at) where sent_at is null;
create index if not exists outbox_sent_idx on private.outbox (sent_at) where sent_at is not null;

alter table private.outbox enable row level security;
revoke all on private.outbox from public, anon, authenticated;

comment on table private.outbox is
  'Events waiting for, or already given to, Inngest. Written in the same transaction as the change they describe. Not readable by any app role.';

-- ------------------------------------------------------------------ alerts --

-- Where Inngest functions leave a message for the team ("withdrawal waiting",
-- "payout failed", the daily digest). The admin panel reads it; the app does not.
create table if not exists public.admin_alerts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists admin_alerts_recent_idx on public.admin_alerts (created_at desc);

alter table public.admin_alerts enable row level security;

drop policy if exists admin_alerts_read on public.admin_alerts;
create policy admin_alerts_read on public.admin_alerts
  for select to authenticated using ((select private.is_admin()));

drop policy if exists admin_alerts_mark_read on public.admin_alerts;
create policy admin_alerts_mark_read on public.admin_alerts
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.admin_alerts from public, anon, authenticated;
grant select on public.admin_alerts to authenticated;
grant update (read_at) on public.admin_alerts to authenticated;

-- ------------------------------------------------------------------ sender --

-- Same name and signature as the n8n sender, so every caller (migrations 082,
-- 087 and the triggers below) keeps working untouched.
create or replace function private.emit_event(p_kind text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'private', 'pg_temp'
as $fn$
declare
  v_id  uuid;
  v_url text;
  v_req bigint;
begin
  -- 1. The durable part. If this fails there is nothing to retry from, so the
  --    event is dropped rather than the caller's transaction broken.
  begin
    insert into private.outbox (kind, data)
    values (p_kind, coalesce(p_data, '{}'::jsonb))
    returning id into v_id;
  exception when others then
    return;
  end;

  -- 2. The fast path. Best effort: pg_net posts after the surrounding
  --    transaction commits, so a rolled-back change never reaches Inngest.
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'inngest_event_url'
     limit 1;

    if coalesce(v_url, '') <> '' then
      v_req := net.http_post(
        url     := v_url,
        body    := jsonb_build_object(
                     'id',   v_id,
                     'name', 'taskdrop/' || p_kind,
                     'data', coalesce(p_data, '{}'::jsonb),
                     'ts',   (extract(epoch from clock_timestamp()) * 1000)::bigint),
        headers := jsonb_build_object('Content-Type', 'application/json')
      );
      update private.outbox set request_id = v_req, attempts = attempts + 1 where id = v_id;
    end if;
  exception when others then
    null;   -- the sweeper will send it
  end;
end;
$fn$;
revoke all on function private.emit_event(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- triggers --

-- The trigger functions (evt_support, evt_payout, evt_dispute) are unchanged
-- from migration 080; only the n8n_* trigger names go, replaced by evt_*.
-- evt_signup is not attached: record_birth_date announces a sign-up once the
-- age check has passed (migration 082).

drop trigger if exists n8n_signup on public.profiles;

drop trigger if exists n8n_support on public.support_tickets;
drop trigger if exists evt_support on public.support_tickets;
create trigger evt_support after insert on public.support_tickets
  for each row execute function private.evt_support();

drop trigger if exists n8n_payout_new on public.payouts;
drop trigger if exists evt_payout_new on public.payouts;
create trigger evt_payout_new after insert on public.payouts
  for each row execute function private.evt_payout();

drop trigger if exists n8n_payout_failed on public.payouts;
drop trigger if exists evt_payout_failed on public.payouts;
create trigger evt_payout_failed after update on public.payouts
  for each row when (new.status::text = 'failed' and old.status::text is distinct from 'failed')
  execute function private.evt_payout();

drop trigger if exists n8n_dispute on public.tasks;
drop trigger if exists evt_dispute on public.tasks;
create trigger evt_dispute after update of status on public.tasks
  for each row when (new.status::text = 'DISPUTED' and old.status::text is distinct from 'DISPUTED')
  execute function private.evt_dispute();

-- ---------------------------------------------------- n8n goes away entirely --

do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('n8n-daily-digest', 'n8n-log-prune');
exception when others then
  null;
end $$;

-- The only things that read these were the n8n sender and its digest.
drop function if exists private.send_daily_digest();
drop table if exists private.automation_log;
drop table if exists private.automation_config;

-- ------------------------------------------------------- service-role door --

-- Inngest functions run in an Edge Function with the service-role key. These
-- are the only ways in; none is granted to anon or authenticated.

create or replace function private.assert_service_caller()
returns void
language plpgsql
security definer
set search_path to 'pg_temp'
as $fn$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  -- Anything arriving through PostgREST carries a role claim. Only the service
  -- role may pass; a direct database session (psql, tests) carries none.
  if v_role in ('anon', 'authenticated') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
end;
$fn$;
revoke all on function private.assert_service_caller() from public, anon, authenticated;

/** Events Inngest has not confirmed, oldest first. Marks the ones pg_net delivered. */
create or replace function public.outbox_pending(p_limit integer default 100)
returns table (id uuid, kind text, data jsonb, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
begin
  perform private.assert_service_caller();

  -- Fast-path posts that came back 2xx need no re-send.
  begin
    update private.outbox o
       set sent_at = now()
     where o.sent_at is null
       and o.request_id is not null
       and exists (select 1 from net._http_response r
                    where r.id = o.request_id and r.status_code between 200 and 299);
  exception when others then
    null;
  end;

  -- Leave a young event alone: its fast-path response may still be on the way.
  return query
    select o.id, o.kind, o.data, o.created_at
      from private.outbox o
     where o.sent_at is null
       and o.created_at < now() - interval '45 seconds'
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$fn$;

create or replace function public.outbox_mark_sent(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_n integer;
begin
  perform private.assert_service_caller();
  update private.outbox
     set sent_at = now(), attempts = attempts + 1
   where id = any (p_ids) and sent_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

/** Sent events are kept two weeks for debugging, then dropped. */
create or replace function public.outbox_prune()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_n integer;
begin
  perform private.assert_service_caller();
  delete from private.outbox where sent_at is not null and sent_at < now() - interval '14 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

/** Totals only, no personal details. The daily digest (Inngest, 9:00 IST). */
create or replace function public.daily_digest()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_since timestamptz := now() - interval '24 hours';
begin
  perform private.assert_service_caller();
  return jsonb_build_object(
    'date', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
    'people_total', (select count(*) from public.profiles),
    'new_people', (select count(*) from public.profiles where created_at >= v_since),
    'jobs_posted', (select count(*) from public.tasks where created_at >= v_since),
    'jobs_finished', (select count(*) from public.tasks where completed_at >= v_since and status::text in ('COMPLETED', 'AUTO_COMPLETED')),
    'earned_rupees', round(coalesce((select sum(amount_minor) from public.platform_ledger where created_at >= v_since), 0) / 100.0, 2),
    'withdrawals_waiting', (select count(*) from public.payouts where status::text in ('requested', 'processing')),
    'withdrawals_waiting_rupees', round(coalesce((select sum(amount_minor) from public.payouts where status::text in ('requested', 'processing')), 0) / 100.0, 2),
    'open_disputes', (select count(*) from public.tasks where status::text = 'DISPUTED'),
    'open_help_requests', (select count(*) from public.support_tickets where coalesce(status, '') <> 'resolved'));
end;
$fn$;

/** A message for the team, written by an Inngest function. */
create or replace function public.record_admin_alert(p_kind text, p_title text, p_body text default null, p_data jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_id uuid;
begin
  perform private.assert_service_caller();
  insert into public.admin_alerts (kind, title, body, data)
  values (left(p_kind, 60), left(p_title, 200), left(p_body, 2000), coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$fn$;

-- Supabase hands EXECUTE on new public functions to anon and authenticated.
-- Take it back, then give it to the service role alone.
revoke all on function public.outbox_pending(integer), public.outbox_mark_sent(uuid[]),
  public.outbox_prune(), public.daily_digest(), public.record_admin_alert(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.outbox_pending(integer), public.outbox_mark_sent(uuid[]),
  public.outbox_prune(), public.daily_digest(), public.record_admin_alert(text, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------- money sweeps, for Inngest --

-- The three money sweeps still run from pg_cron today. Inngest can run them
-- instead once it is verified live (supabase/cutover/inngest_money_jobs.sql
-- switches pg_cron off); until then they are simply reachable by the service
-- role. All three are safe to run twice: each takes row locks and only touches
-- work that is due.
create or replace function public.run_auto_complete_due()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
begin
  perform private.assert_service_caller();
  return private.auto_complete_due();
end;
$fn$;
revoke all on function public.run_auto_complete_due() from public, anon, authenticated;
grant execute on function public.run_auto_complete_due() to service_role;

grant execute on function public.settle_cleared_earnings(), public.settle_finished_campaigns() to service_role;
