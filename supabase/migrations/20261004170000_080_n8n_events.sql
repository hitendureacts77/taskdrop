-- 080 -- events for n8n.
--
-- TaskDrop tells n8n when something happens; n8n never reads or changes
-- anything in TaskDrop. Each event is one small web call (pg_net, the same way
-- the push notifications go out) to a webhook URL kept in private.automation_config.
-- With no URL set this does nothing but write the event to a log, so it is safe to
-- ship before n8n is connected.
--
-- Events carry names and amounts, never phone numbers, emails, bank details or
-- UPI ids:
--   user.signed_up        { user_id, name }
--   support.opened        { ticket_id, category, subject, from }
--   withdrawal.requested  { payout_id, amount_rupees, name, via }
--   payout.failed         { payout_id, amount_rupees, name, reason }
--   dispute.opened        { task_id, title, poster }
--   digest.daily          { date, new_people, ... } every day at 9:00 IST
--
-- An automation must never break the action that triggered it: every function
-- below swallows its own errors.

set check_function_bodies = off;

-- ----------------------------------------------------------------- storage --

create table if not exists private.automation_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
comment on table private.automation_config is
  'n8n_webhook_url (where events are posted), n8n_webhook_secret (optional, sent as X-TaskDrop-Secret), n8n_enabled (on/off, default on). Not readable by any app role.';

create table if not exists private.automation_log (
  id         bigint generated always as identity primary key,
  kind       text not null,
  payload    jsonb not null,
  sent       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists automation_log_created_idx on private.automation_log (created_at);

alter table private.automation_config enable row level security;
alter table private.automation_log enable row level security;
revoke all on private.automation_config from public, anon, authenticated;
revoke all on private.automation_log from public, anon, authenticated;

-- ------------------------------------------------------------------- sender --

create or replace function private.emit_event(p_kind text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'private', 'pg_temp'
as $fn$
declare
  v_url    text;
  v_secret text;
  v_on     text;
  v_body   jsonb := jsonb_build_object('event', p_kind, 'at', now(), 'data', coalesce(p_data, '{}'::jsonb));
  v_sent   boolean := false;
begin
  select value into v_url from private.automation_config where key = 'n8n_webhook_url';
  select value into v_secret from private.automation_config where key = 'n8n_webhook_secret';
  select value into v_on from private.automation_config where key = 'n8n_enabled';

  if coalesce(v_url, '') <> '' and coalesce(v_on, 'on') = 'on' then
    perform net.http_post(
      url := v_url,
      body := v_body,
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-TaskDrop-Event', p_kind)
                 || case when coalesce(v_secret, '') <> '' then jsonb_build_object('X-TaskDrop-Secret', v_secret) else '{}'::jsonb end
    );
    v_sent := true;
  end if;

  insert into private.automation_log (kind, payload, sent) values (p_kind, v_body, v_sent);
exception when others then
  null;
end;
$fn$;
revoke all on function private.emit_event(text, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------- triggers --

create or replace function private.evt_signup() returns trigger
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $fn$
begin
  perform private.emit_event('user.signed_up', jsonb_build_object('user_id', new.id, 'name', new.display_name));
  return new;
exception when others then return new;
end;
$fn$;

create or replace function private.evt_support() returns trigger
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $fn$
begin
  perform private.emit_event('support.opened', jsonb_build_object(
    'ticket_id', new.id,
    'category', new.category,
    'subject', left(coalesce(new.subject, ''), 80),
    'from', (select display_name from public.profiles where id = new.user_id)));
  return new;
exception when others then return new;
end;
$fn$;

create or replace function private.evt_payout() returns trigger
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $fn$
begin
  if tg_op = 'INSERT' then
    perform private.emit_event('withdrawal.requested', jsonb_build_object(
      'payout_id', new.id,
      'amount_rupees', round(new.amount_minor / 100.0, 2),
      'name', (select display_name from public.profiles where id = new.user_id),
      'via', new.via));
  elsif new.status::text = 'failed' and old.status::text is distinct from 'failed' then
    perform private.emit_event('payout.failed', jsonb_build_object(
      'payout_id', new.id,
      'amount_rupees', round(new.amount_minor / 100.0, 2),
      'name', (select display_name from public.profiles where id = new.user_id),
      'reason', left(coalesce(new.failure_note, ''), 120)));
  end if;
  return new;
exception when others then return new;
end;
$fn$;

create or replace function private.evt_dispute() returns trigger
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $fn$
begin
  perform private.emit_event('dispute.opened', jsonb_build_object(
    'task_id', new.id,
    'title', left(coalesce(new.title, ''), 80),
    'poster', (select display_name from public.profiles where id = new.poster_id)));
  return new;
exception when others then return new;
end;
$fn$;

revoke all on function private.evt_signup(), private.evt_support(), private.evt_payout(), private.evt_dispute() from public, anon, authenticated;

drop trigger if exists n8n_signup on public.profiles;
create trigger n8n_signup after insert on public.profiles for each row execute function private.evt_signup();

drop trigger if exists n8n_support on public.support_tickets;
create trigger n8n_support after insert on public.support_tickets for each row execute function private.evt_support();

drop trigger if exists n8n_payout_new on public.payouts;
create trigger n8n_payout_new after insert on public.payouts for each row execute function private.evt_payout();

drop trigger if exists n8n_payout_failed on public.payouts;
create trigger n8n_payout_failed after update on public.payouts
  for each row when (new.status::text = 'failed' and old.status::text is distinct from 'failed')
  execute function private.evt_payout();

drop trigger if exists n8n_dispute on public.tasks;
create trigger n8n_dispute after update of status on public.tasks
  for each row when (new.status::text = 'DISPUTED' and old.status::text is distinct from 'DISPUTED')
  execute function private.evt_dispute();

-- ------------------------------------------------------------------- digest --

/** Totals only, no personal details. Sent once a day at 9:00 IST. */
create or replace function private.send_daily_digest()
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_since timestamptz := now() - interval '24 hours';
begin
  perform private.emit_event('digest.daily', jsonb_build_object(
    'date', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
    'people_total', (select count(*) from public.profiles),
    'new_people', (select count(*) from public.profiles where created_at >= v_since),
    'jobs_posted', (select count(*) from public.tasks where created_at >= v_since),
    'jobs_finished', (select count(*) from public.tasks where completed_at >= v_since and status::text in ('COMPLETED', 'AUTO_COMPLETED')),
    'earned_rupees', round(coalesce((select sum(amount_minor) from public.platform_ledger where created_at >= v_since), 0) / 100.0, 2),
    'withdrawals_waiting', (select count(*) from public.payouts where status::text in ('requested', 'processing')),
    'withdrawals_waiting_rupees', round(coalesce((select sum(amount_minor) from public.payouts where status::text in ('requested', 'processing')), 0) / 100.0, 2),
    'open_disputes', (select count(*) from public.tasks where status::text = 'DISPUTED'),
    'open_help_requests', (select count(*) from public.support_tickets where coalesce(status, '') <> 'resolved')));
exception when others then
  null;
end;
$fn$;
revoke all on function private.send_daily_digest() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('n8n-daily-digest', 'n8n-log-prune');
  perform cron.schedule('n8n-daily-digest', '30 3 * * *', 'select private.send_daily_digest()');
  perform cron.schedule('n8n-log-prune', '40 3 * * *', $c$delete from private.automation_log where created_at < now() - interval '30 days'$c$);
end $$;
