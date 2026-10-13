-- 091 — Live events for the admin Ops Console.
--
-- The admin panel showed numbers as old as the page load. This gives it one
-- live stream of what is happening in the app:
--
--   public.admin_live_events   one row per thing that happened (a sign-up, a
--                              task posted, a quote, a status change, a
--                              withdrawal, a help request, ...). The 30-day
--                              prune is a Phase 5 Inngest job (AGENTS.md
--                              rule 8: no new pg_cron jobs).
--   private.admin_live(...)    writes a row and broadcasts it on the private
--                              Realtime channel 'admin:live', the same way 083
--                              pings 'user:<id>' channels.
--   "staff live channel"       only people holding the admin role may listen
--                              on 'admin:live'.
--   public.admin_live_counters()
--                              the live strip's numbers, read from the tables
--                              themselves, so a missed broadcast can never
--                              leave a wrong count (the panel re-reads it every
--                              minute and on focus).
--
-- Every trigger here runs AFTER the change and swallows its own errors: the
-- feed is a nicety and must never block a user posting, quoting, paying or
-- withdrawing. Events carry names, titles and amounts, never phone numbers,
-- emails, bank details or locations. (091b stops a phone number or email that
-- the app copies into a brand-new profile's name from appearing as a name.)
--
-- Money amounts in events are for the feed's sentence only. Money screens
-- re-read amounts from the server when an event arrives.
--
-- When Phase 5's outbox (090) lands, these triggers can feed it instead; the
-- table, channel and counters stay the same.
--
-- Only adds: a table, functions, triggers and two policies.
-- Nothing is dropped or renamed, so the old app and the old admin are untouched.

-- ------------------------------------------------------------------ table --

create table if not exists public.admin_live_events (
  id          bigint generated always as identity primary key,
  kind        text        not null,
  record_type text        not null,
  record_id   uuid,
  actor_id    uuid,
  summary     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
comment on table public.admin_live_events is
  'What just happened in the app, for the admin live feed (migration 091). Written only by triggers; admins read; pruned after 30 days (Phase 5).';

create index if not exists admin_live_events_created_idx on public.admin_live_events (created_at desc);
create index if not exists admin_live_events_kind_idx on public.admin_live_events (kind, created_at desc);

alter table public.admin_live_events enable row level security;

drop policy if exists admin_live_events_admin_read on public.admin_live_events;
create policy admin_live_events_admin_read on public.admin_live_events
  for select to authenticated
  using (private.is_admin());

-- Nobody writes it directly: only the security-definer function below.
revoke all on public.admin_live_events from anon, authenticated;
grant select on public.admin_live_events to authenticated;

-- ---------------------------------------------------------------- channel --

-- Staff may listen on 'admin:live'. Policies on realtime.messages are
-- permissive, so this sits beside "own user channel" (083) without changing it.
drop policy if exists "staff live channel" on realtime.messages;
create policy "staff live channel" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'admin:live'
    and coalesce(private.has_role((select auth.uid()), 'admin'), false)
  );

-- ------------------------------------------------------------------ write --

create or replace function private.admin_live(
  p_kind        text,
  p_record_type text,
  p_record_id   uuid,
  p_actor       uuid,
  p_summary     jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.admin_live_events;
begin
  insert into public.admin_live_events (kind, record_type, record_id, actor_id, summary)
  values (p_kind, p_record_type, p_record_id, p_actor, coalesce(p_summary, '{}'::jsonb))
  returning * into v_row;

  perform realtime.send(
    jsonb_build_object(
      'id', v_row.id,
      'kind', v_row.kind,
      'record_type', v_row.record_type,
      'record_id', v_row.record_id,
      'actor_id', v_row.actor_id,
      'summary', v_row.summary,
      'created_at', v_row.created_at
    ),
    'event',
    'admin:live',
    true
  );
exception when others then
  null;
end;
$$;
revoke all on function private.admin_live(text, text, uuid, uuid, jsonb) from public, anon, authenticated;

-- A display name for the feed. Empty for deleted accounts.
create or replace function private.admin_live_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.deleted_at is null then nullif(p.display_name, '') end
  from public.profiles p
  where p.id = p_user;
$$;
revoke all on function private.admin_live_name(uuid) from public, anon, authenticated;

-- --------------------------------------------------------------- triggers --

create or replace function private.live_profile_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_live('signup', 'profile', new.id, new.id,
    jsonb_build_object('who', nullif(new.display_name, '')));
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.live_task_posted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_live('task_posted', 'task', new.id, new.poster_id,
    jsonb_build_object(
      'title', left(coalesce(new.title, ''), 120),
      'who', private.admin_live_name(new.poster_id),
      'amount_minor', new.benchmark_minor,
      'kind', new.kind,
      'category', new.category,
      'area', left(coalesce(new.loc_label, ''), 60)
    ));
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.live_task_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform private.admin_live('task_status', 'task', new.id, null,
      jsonb_build_object(
        'title', left(coalesce(new.title, ''), 120),
        'from', old.status::text,
        'to', new.status::text,
        'amount_minor', coalesce(new.locked_minor, new.benchmark_minor),
        'poster', private.admin_live_name(new.poster_id)
      ));
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.live_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_first boolean;
begin
  select left(coalesce(t.title, ''), 120) into v_title from public.tasks t where t.id = new.task_id;
  select not exists (select 1 from public.bids b where b.task_id = new.task_id and b.id <> new.id) into v_first;
  perform private.admin_live('quote', 'task', new.task_id, new.worker_id,
    jsonb_build_object(
      'title', v_title,
      'who', private.admin_live_name(new.worker_id),
      'amount_minor', new.price_minor,
      'first', v_first
    ));
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.live_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.admin_live('withdrawal_requested', 'payout', new.id, new.user_id,
      jsonb_build_object('who', private.admin_live_name(new.user_id), 'amount_minor', new.amount_minor));
  elsif new.status is distinct from old.status then
    perform private.admin_live('payout_status', 'payout', new.id, null,
      jsonb_build_object(
        'who', private.admin_live_name(new.user_id),
        'amount_minor', new.amount_minor,
        'from', old.status::text,
        'to', new.status::text
      ));
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.live_help_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_live('help_request', 'ticket', new.id, new.user_id,
    jsonb_build_object(
      'who', private.admin_live_name(new.user_id),
      'subject', left(coalesce(new.subject, ''), 120),
      'category', new.category
    ));
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.live_proof()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  select left(coalesce(t.title, ''), 120) into v_title from public.tasks t where t.id = new.task_id;
  perform private.admin_live('proof', 'task', new.task_id, new.worker_id,
    jsonb_build_object('title', v_title, 'who', private.admin_live_name(new.worker_id)));
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.live_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_live('review', 'task', new.task_id, new.author_id,
    jsonb_build_object(
      'who', private.admin_live_name(new.author_id),
      'about', private.admin_live_name(new.subject_id),
      'rating', new.rating
    ));
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.live_copyright()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_live('copyright_notice', 'copyright', new.id, null,
    jsonb_build_object('work', left(coalesce(new.work, ''), 120)));
  return null;
exception when others then
  return null;
end;
$$;

create or replace function private.live_wallet_adjustment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_live('wallet_adjustment', 'profile', new.user_id, null,
    jsonb_build_object(
      'who', private.admin_live_name(new.user_id),
      'amount_minor', new.delta_minor,
      'reason', left(coalesce(new.reason, ''), 120)
    ));
  return null;
exception when others then
  return null;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'live_profile_created', 'live_task_posted', 'live_task_status', 'live_quote', 'live_payout',
    'live_help_request', 'live_proof', 'live_review', 'live_copyright', 'live_wallet_adjustment'
  ] loop
    execute format('revoke all on function private.%I() from public, anon, authenticated', f);
  end loop;
end;
$$;

drop trigger if exists admin_live_signup on public.profiles;
create trigger admin_live_signup after insert on public.profiles
  for each row execute function private.live_profile_created();

drop trigger if exists admin_live_task_posted on public.tasks;
create trigger admin_live_task_posted after insert on public.tasks
  for each row execute function private.live_task_posted();

drop trigger if exists admin_live_task_status on public.tasks;
create trigger admin_live_task_status after update of status on public.tasks
  for each row execute function private.live_task_status();

drop trigger if exists admin_live_quote on public.bids;
create trigger admin_live_quote after insert on public.bids
  for each row execute function private.live_quote();

drop trigger if exists admin_live_payout on public.payouts;
create trigger admin_live_payout after insert or update of status on public.payouts
  for each row execute function private.live_payout();

drop trigger if exists admin_live_help on public.support_tickets;
create trigger admin_live_help after insert on public.support_tickets
  for each row execute function private.live_help_request();

drop trigger if exists admin_live_proof on public.task_proofs;
create trigger admin_live_proof after insert on public.task_proofs
  for each row execute function private.live_proof();

drop trigger if exists admin_live_review on public.reviews;
create trigger admin_live_review after insert on public.reviews
  for each row execute function private.live_review();

drop trigger if exists admin_live_copyright on public.copyright_notices;
create trigger admin_live_copyright after insert on public.copyright_notices
  for each row execute function private.live_copyright();

drop trigger if exists admin_live_wallet on public.wallet_adjustments;
create trigger admin_live_wallet after insert on public.wallet_adjustments
  for each row execute function private.live_wallet_adjustment();

-- --------------------------------------------------------------- counters --

-- The live strip. Counts only; money totals keep coming from the panel's
-- existing money reads (admin_money_position and friends), so there is one
-- source of truth for every rupee.
--
-- "Online" matches the app (apps/mobile/src/lib/presence.ts): seen in the last
-- three minutes, because the app writes last_seen_at once a minute.
create or replace function public.admin_live_counters()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_out   jsonb;
begin
  if not private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'at', now(),
    'online_now', (select count(*) from public.profiles p
                    where p.last_seen_at > now() - interval '3 minutes' and p.deleted_at is null),
    'online_workers', (select count(*) from public.profiles p
                        where p.last_seen_at > now() - interval '3 minutes' and p.deleted_at is null
                          and p.worker_onboarded_at is not null),
    -- The same groups as the admin panel's Jobs filters (src/lib/data.ts).
    'open_tasks', (select count(*) from public.tasks t where t.status = 'OPEN'),
    'in_progress', (select count(*) from public.tasks t
                     where t.status in ('LOCKED', 'TASK_STARTED', 'OVERDUE', 'REVISION_REQUESTED')),
    'waiting_approval', (select count(*) from public.tasks t where t.status = 'WORK_DONE'),
    'overdue', (select count(*) from public.tasks t
                 where t.status = 'OVERDUE'
                    or (t.status in ('LOCKED', 'TASK_STARTED', 'REVISION_REQUESTED') and t.due_at < now())),
    'disputes_open', (select count(*) from public.tasks t where t.status = 'DISPUTED'),
    'quotes_last_hour', (select count(*) from public.bids b where b.created_at > now() - interval '1 hour'),
    'tasks_today', (select count(*) from public.tasks t where t.created_at >= v_today),
    'signups_today', (select count(*) from public.profiles p where p.created_at >= v_today),
    'help_waiting', (select count(*) from public.support_tickets s where s.status = 'waiting')
  ) into v_out;

  return v_out;
end;
$$;
revoke all on function public.admin_live_counters() from public, anon;
grant execute on function public.admin_live_counters() to authenticated;
