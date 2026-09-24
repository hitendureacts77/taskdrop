-- 048_marketplace_features
--
-- The schema behind the second wave of product features: AI-drafted task
-- briefs, the explore / trending surfaces, notifications, saved tasks, help &
-- support, feedback, referrals, usernames with password sign-in, and "go live"
-- for workers.
--
-- Everything here is additive. No existing column changes type, no row is
-- rewritten, no policy is loosened. New writes that move state for someone
-- other than the caller go through SECURITY DEFINER functions that check
-- auth.uid() themselves, exactly like the money RPCs before them.

-- 1 -------------------------------------------------------------------------
-- Profiles: a public handle, a short bio, languages, what the person came to
-- do, and presence. All of it is public by design (profiles_select_all), so
-- nothing private goes here.
alter table public.profiles
  add column if not exists username      text,
  add column if not exists bio           text,
  add column if not exists languages     text[] not null default '{}',
  add column if not exists intent        text,
  add column if not exists last_seen_at  timestamptz,
  add column if not exists live_until    timestamptz,
  add column if not exists referral_code text;

alter table public.profiles
  drop constraint if exists profiles_username_format,
  add constraint profiles_username_format
    check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
  drop constraint if exists profiles_bio_length,
  add constraint profiles_bio_length
    check (bio is null or char_length(bio) <= 500),
  drop constraint if exists profiles_intent_check,
  add constraint profiles_intent_check
    check (intent is null or intent in ('post', 'earn', 'both'));

create unique index if not exists profiles_username_key
  on public.profiles (username) where username is not null;

-- Existing people get a code now; new ones get it from the default.
update public.profiles
   set referral_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
 where referral_code is null;
alter table public.profiles
  alter column referral_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
create unique index if not exists profiles_referral_code_key
  on public.profiles (referral_code) where referral_code is not null;

-- 2 -------------------------------------------------------------------------
-- Tasks: what the brief writer produces, plus how the poster wants providers
-- chosen. assignment_mode 'auto' means the first quote at or under the budget
-- is locked without waiting for the poster (see section 8); the poster still
-- funds escrow before any work starts, so nothing about the money gate moves.
alter table public.tasks
  add column if not exists category        text,
  add column if not exists skills          text[] not null default '{}',
  add column if not exists difficulty      text,
  add column if not exists assignment_mode text not null default 'bids',
  add column if not exists due_at          timestamptz,
  add column if not exists milestones      jsonb not null default '[]'::jsonb;

alter table public.tasks
  drop constraint if exists tasks_difficulty_check,
  add constraint tasks_difficulty_check
    check (difficulty is null or difficulty in ('easy', 'medium', 'hard')),
  drop constraint if exists tasks_assignment_mode_check,
  add constraint tasks_assignment_mode_check
    check (assignment_mode in ('bids', 'auto')),
  drop constraint if exists tasks_milestones_array,
  add constraint tasks_milestones_array
    check (jsonb_typeof(milestones) = 'array' and jsonb_array_length(milestones) <= 6);

create index if not exists tasks_category_open_idx
  on public.tasks (category) where status = 'OPEN';

-- 3 -------------------------------------------------------------------------
-- Saved tasks: a private bookmark list.
create table if not exists public.saved_tasks (
  user_id    uuid not null references auth.users (id) on delete cascade,
  task_id    uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id)
);
alter table public.saved_tasks enable row level security;

drop policy if exists saved_tasks_select_own on public.saved_tasks;
create policy saved_tasks_select_own on public.saved_tasks
  for select using (user_id = (select auth.uid()));
drop policy if exists saved_tasks_insert_own on public.saved_tasks;
create policy saved_tasks_insert_own on public.saved_tasks
  for insert with check (user_id = (select auth.uid()));
drop policy if exists saved_tasks_delete_own on public.saved_tasks;
create policy saved_tasks_delete_own on public.saved_tasks
  for delete using (user_id = (select auth.uid()));

-- 4 -------------------------------------------------------------------------
-- Notifications. Written only by the triggers below (no insert policy), read
-- and marked read by their owner.
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  task_id    uuid references public.tasks (id) on delete cascade,
  ticket_id  uuid,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = (select auth.uid()));
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete using (user_id = (select auth.uid()));

-- One place that writes a notification. It never raises: a notification that
-- cannot be written must not roll back the quote, payment or message that
-- caused it.
create or replace function private.notify(
  p_user uuid, p_kind text, p_title text, p_body text,
  p_task uuid default null, p_ticket uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_user is null then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, task_id, ticket_id)
  values (p_user, p_kind, p_title, p_body, p_task, p_ticket);
exception when others then
  null;
end;
$$;
revoke all on function private.notify(uuid, text, text, text, uuid, uuid) from public;

-- Who is doing the work on a task right now: the most recent assignment.
create or replace function private.task_worker(p_task uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.worker_id from public.assignments a
   where a.task_id = p_task
   order by a.created_at desc
   limit 1
$$;
revoke all on function private.task_worker(uuid) from public;

-- A new quote tells the poster.
create or replace function private.on_bid_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = new.task_id;
  if found then
    perform private.notify(
      v_task.poster_id, 'quote',
      'New quote on "' || left(v_task.title, 60) || '"',
      'Someone quoted ₹' || to_char(new.price_minor / 100.0, 'FM999,99,99,990'),
      v_task.id);
  end if;
  return new;
end;
$$;

drop trigger if exists bids_notify_poster on public.bids;
create trigger bids_notify_poster
  after insert on public.bids
  for each row execute function private.on_bid_inserted();

-- Every status change the other side needs to hear about.
create or replace function private.on_task_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_worker uuid;
  v_title  text := left(new.title, 60);
begin
  if new.status = 'LOCKED' and old.status is distinct from 'LOCKED' then
    select b.worker_id into v_worker from public.bids b where b.id = new.locked_bid_id;
    perform private.notify(v_worker, 'picked', 'You were picked for "' || v_title || '"',
      'The poster funds escrow next, then you can start.', new.id);
  end if;

  if new.funded_at is not null and old.funded_at is null then
    perform private.notify(private.task_worker(new.id), 'funded',
      'Escrow funded for "' || v_title || '"', 'You can start the work now.', new.id);
  end if;

  if new.status is distinct from old.status then
    v_worker := private.task_worker(new.id);
    case new.status
      when 'TASK_STARTED' then
        perform private.notify(new.poster_id, 'started', 'Work started on "' || v_title || '"',
          'The timer is running.', new.id);
      when 'WORK_DONE' then
        perform private.notify(new.poster_id, 'submitted', 'Work submitted for "' || v_title || '"',
          'Review it and release the payment, or ask for changes.', new.id);
      when 'REVISION_REQUESTED' then
        perform private.notify(v_worker, 'revision', 'Changes requested on "' || v_title || '"',
          'The poster sent the work back with a note.', new.id);
      when 'COMPLETED', 'AUTO_COMPLETED' then
        perform private.notify(v_worker, 'released', 'Payment released for "' || v_title || '"',
          'Your earnings are clearing.', new.id);
      when 'CANCELLED' then
        -- Whoever did not cancel it is the one who needs telling; both hear it,
        -- which is harmless for the person who pressed the button.
        perform private.notify(v_worker, 'cancelled', '"' || v_title || '" was cancelled', null, new.id);
        perform private.notify(new.poster_id, 'cancelled', '"' || v_title || '" was cancelled', null, new.id);
      when 'DISPUTED' then
        perform private.notify(v_worker, 'dispute', 'A dispute was opened on "' || v_title || '"',
          'Our team will look at it.', new.id);
        perform private.notify(new.poster_id, 'dispute', 'A dispute was opened on "' || v_title || '"',
          'Our team will look at it.', new.id);
      when 'OPEN' then
        if old.status in ('LOCKED', 'TASK_STARTED', 'OVERDUE') then
          perform private.notify(new.poster_id, 'reopened', '"' || v_title || '" is open again',
            'The worker stepped off. New quotes can come in.', new.id);
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

drop trigger if exists tasks_notify_parties on public.tasks;
create trigger tasks_notify_parties
  after update on public.tasks
  for each row execute function private.on_task_changed();

-- A chat message tells the other party, at most once per ten minutes per
-- thread, so a conversation does not become a notification per line.
create or replace function private.on_message_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task  public.tasks;
  v_other uuid;
begin
  select * into v_task from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;
  v_other := case when new.sender_id = v_task.poster_id
                  then private.task_worker(v_task.id)
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
  perform private.notify(v_other, 'message', 'New message on "' || left(v_task.title, 60) || '"',
    left(new.body, 120), v_task.id);
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists messages_notify_other on public.messages;
create trigger messages_notify_other
  after insert on public.messages
  for each row execute function private.on_message_inserted();

-- 5 -------------------------------------------------------------------------
-- Help & support. Readable by the person who opened it and by admins; every
-- write goes through the RPCs below so the status always matches the thread.
create table if not exists public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null,
  subject    text not null,
  page       text,
  status     text not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_status_check check (status in ('waiting', 'answered', 'resolved')),
  constraint support_tickets_category_check check (
    category in ('payment', 'task', 'account', 'safety', 'bug', 'other'))
);
create index if not exists support_tickets_user_idx
  on public.support_tickets (user_id, updated_at desc);

create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets (id) on delete cascade,
  sender_id  uuid references auth.users (id) on delete set null,
  from_staff boolean not null default false,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint support_messages_body_length check (char_length(body) between 1 and 4000)
);
create index if not exists support_messages_ticket_idx
  on public.support_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets
  for select using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages
  for select using (
    private.is_admin() or exists (
      select 1 from public.support_tickets t
       where t.id = ticket_id and t.user_id = (select auth.uid())));

create or replace function public.open_support_ticket(
  p_category text, p_body text, p_page text default null
) returns public.support_tickets
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me     uuid := auth.uid();
  v_body   text := btrim(coalesce(p_body, ''));
  v_ticket public.support_tickets;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if char_length(v_body) < 5 then
    raise exception 'Tell us a little more about what happened';
  end if;
  -- A flood guard, not a quota: nobody needs more than five new threads an hour.
  if (select count(*) from public.support_tickets
       where user_id = v_me and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You have opened several requests just now. We will reply to those first.';
  end if;

  insert into public.support_tickets (user_id, category, subject, page)
  values (v_me, p_category, left(regexp_replace(v_body, '\s+', ' ', 'g'), 80), left(p_page, 80))
  returning * into v_ticket;

  insert into public.support_messages (ticket_id, sender_id, from_staff, body)
  values (v_ticket.id, v_me, false, left(v_body, 4000));

  return v_ticket;
end;
$$;

create or replace function public.reply_support_ticket(p_ticket_id uuid, p_body text)
returns public.support_messages
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me     uuid := auth.uid();
  v_ticket public.support_tickets;
  v_staff  boolean := private.is_admin();
  v_msg    public.support_messages;
  v_body   text := btrim(coalesce(p_body, ''));
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if v_body = '' then
    raise exception 'Write a reply first';
  end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found or (v_ticket.user_id <> v_me and not v_staff) then
    raise exception 'That conversation does not exist';
  end if;

  -- An admin writing on their own ticket is a customer there, not staff.
  v_staff := v_staff and v_ticket.user_id <> v_me;

  insert into public.support_messages (ticket_id, sender_id, from_staff, body)
  values (v_ticket.id, v_me, v_staff, left(v_body, 4000))
  returning * into v_msg;

  update public.support_tickets
     set status = case when v_staff then 'answered' else 'waiting' end,
         updated_at = now()
   where id = v_ticket.id;

  if v_staff then
    perform private.notify(v_ticket.user_id, 'support', 'Support replied',
      left(v_body, 120), null, v_ticket.id);
  end if;
  return v_msg;
end;
$$;

create or replace function public.resolve_support_ticket(p_ticket_id uuid)
returns public.support_tickets
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_ticket public.support_tickets;
begin
  update public.support_tickets
     set status = 'resolved', updated_at = now()
   where id = p_ticket_id
     and (user_id = auth.uid() or private.is_admin())
  returning * into v_ticket;
  if not found then
    raise exception 'That conversation does not exist';
  end if;
  return v_ticket;
end;
$$;

-- 6 -------------------------------------------------------------------------
-- Feedback: write-only for users, readable by admins.
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null,
  body       text not null,
  page       text,
  created_at timestamptz not null default now(),
  constraint feedback_kind_check check (kind in ('broken', 'idea', 'confusing', 'praise')),
  constraint feedback_body_length check (char_length(body) between 3 and 2000)
);
alter table public.feedback enable row level security;
drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert with check (user_id = (select auth.uid()));
drop policy if exists feedback_select_admin on public.feedback;
create policy feedback_select_admin on public.feedback
  for select using (private.is_admin() or user_id = (select auth.uid()));

-- 7 -------------------------------------------------------------------------
-- Referrals: who brought whom. Written only by apply_referral_code(), which
-- enforces one referrer per person, no self-referral, and only in the first
-- week of an account. No rewards are paid from here; this records the link.
create table if not exists public.referrals (
  referred_id uuid primary key references auth.users (id) on delete cascade,
  referrer_id uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);
alter table public.referrals enable row level security;
drop policy if exists referrals_select_party on public.referrals;
create policy referrals_select_party on public.referrals
  for select using (referrer_id = (select auth.uid()) or referred_id = (select auth.uid()));

create or replace function public.apply_referral_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me       uuid := auth.uid();
  v_referrer uuid;
  v_joined   timestamptz;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  select p.id into v_referrer from public.profiles p
   where p.referral_code = upper(btrim(coalesce(p_code, '')));
  if v_referrer is null then
    raise exception 'That referral code does not exist';
  end if;
  if v_referrer = v_me then
    raise exception 'That is your own code';
  end if;
  select p.created_at into v_joined from public.profiles p where p.id = v_me;
  if v_joined < now() - interval '7 days' then
    raise exception 'Referral codes can only be added in your first week';
  end if;
  insert into public.referrals (referred_id, referrer_id)
  values (v_me, v_referrer)
  on conflict (referred_id) do nothing;
  if not found then
    raise exception 'You already used a referral code';
  end if;
  perform private.notify(v_referrer, 'referral', 'Someone joined with your code', null);
  return true;
end;
$$;

-- 8 -------------------------------------------------------------------------
-- Auto-accept. When a poster chose "auto", the first quote at or under the
-- budget is locked on the spot -- the same arithmetic lock_bid() performs for
-- a poster, with the same fee setting. It never raises: if locking fails for
-- any reason the quote simply stays a normal quote for the poster to review.
create or replace function private.auto_accept_bid()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task   public.tasks;
  v_fee    numeric;
  v_escrow bigint;
begin
  select * into v_task from public.tasks where id = new.task_id for update;
  if not found
     or v_task.assignment_mode <> 'auto'
     or v_task.status <> 'OPEN'
     or new.price_minor > v_task.benchmark_minor then
    return new;
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(new.price_minor * (1 + v_fee));

  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, payout_mode)
  values (v_task.id, new.id, new.worker_id, v_escrow, v_task.payout_mode)
  on conflict (task_id, worker_id) do update set escrow_minor = excluded.escrow_minor;

  update public.bids set is_locked = true where id = new.id;

  update public.tasks
     set status = 'LOCKED',
         locked_bid_id = new.id,
         locked_minor = new.price_minor
   where id = v_task.id;

  perform private.notify(v_task.poster_id, 'auto_locked',
    'A quote was auto-accepted on "' || left(v_task.title, 60) || '"',
    'Fund the escrow so the worker can start.', v_task.id);
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists bids_auto_accept on public.bids;
create trigger bids_auto_accept
  after insert on public.bids
  for each row execute function private.auto_accept_bid();

-- 9 -------------------------------------------------------------------------
-- AI assistant usage, one row per person per day. Written by the ai-assistant
-- Edge Function with the service role; readable by its owner for the meter.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default (now() at time zone 'Asia/Kolkata')::date,
  used    integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select using (user_id = (select auth.uid()));

insert into public.settings (key, value)
values ('ai_daily_credits', '10'::jsonb)
on conflict (key) do nothing;

-- Atomically spend one credit; false when today's allowance is gone.
create or replace function public.spend_ai_credit(p_user uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_limit integer := private.setting_num('ai_daily_credits', 10)::integer;
  v_day   date := (now() at time zone 'Asia/Kolkata')::date;
  v_used  integer;
begin
  insert into public.ai_usage (user_id, day, used)
  values (p_user, v_day, 1)
  on conflict (user_id, day) do update
    set used = public.ai_usage.used + 1
    where public.ai_usage.used < v_limit
  returning used into v_used;
  if v_used is null then
    return -1;
  end if;
  return v_limit - v_used;
end;
$$;
revoke all on function public.spend_ai_credit(uuid) from public, anon, authenticated;
grant execute on function public.spend_ai_credit(uuid) to service_role;

-- 10 ------------------------------------------------------------------------
-- Password sign-in throttle, service role only (same rule as auth_codes).
create table if not exists public.password_attempts (
  id       bigint generated always as identity primary key,
  username text not null,
  ip       text,
  ok       boolean not null default false,
  at       timestamptz not null default now()
);
create index if not exists password_attempts_username_idx on public.password_attempts (username, at desc);
create index if not exists password_attempts_ip_idx on public.password_attempts (ip, at desc);
alter table public.password_attempts enable row level security;
comment on table public.password_attempts is
  'Deny-all by design: RLS on, no policies. Written and read only by the password-auth edge function.';

-- 11 ------------------------------------------------------------------------
-- Read-only aggregates for explore / trending. SECURITY DEFINER because they
-- count rows the caller cannot see one by one; they return counts and public
-- profile fields only.

create or replace function public.platform_highlights()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'activeNow',      (select count(*) from public.profiles where last_seen_at > now() - interval '15 minutes'),
    'activeToday',    (select count(*) from public.profiles where last_seen_at > now() - interval '24 hours'),
    'openTasks',      (select count(*) from public.tasks where status = 'OPEN'),
    'completedToday', (select count(*) from public.tasks
                        where status in ('COMPLETED', 'AUTO_COMPLETED')
                          and coalesce(completed_at, updated_at) > now() - interval '24 hours'),
    'liveWorkers',    (select count(*) from public.profiles where live_until > now())
  )
$$;

create or replace function public.trending_categories(p_limit integer default 8)
returns table (category text, open_count bigint, recent_count bigint, avg_budget_minor bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(t.category,
           case t.pillar when 'services' then 'Services'
                         when 'procurement' then 'Products'
                         else 'Local Intel' end) as category,
         count(*) filter (where t.status = 'OPEN') as open_count,
         count(*) as recent_count,
         round(avg(t.benchmark_minor))::bigint as avg_budget_minor
    from public.tasks t
   where t.created_at > now() - interval '30 days'
     and t.status <> 'CANCELLED'
   group by 1
   order by 2 desc, 3 desc
   limit greatest(1, least(coalesce(p_limit, 8), 20))
$$;

create or replace function public.top_earners(p_kind text default 'top_rated', p_limit integer default 10)
returns table (
  id uuid, display_name text, username text, avatar_url text,
  rating numeric, rating_count integer, jobs_done bigint, skill text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with base as (
    select p.id, p.display_name, p.username, p.avatar_url,
           round(p.worker_rating_avg, 1) as rating,
           p.worker_rating_count as rating_count,
           (select count(*) from public.assignments a
              join public.tasks t on t.id = a.task_id
             where a.worker_id = p.id and t.status in ('COMPLETED', 'AUTO_COMPLETED')) as jobs_done,
           (select count(*) from public.bids b
             where b.worker_id = p.id and b.created_at > now() - interval '30 days') as recent_quotes,
           p.skills[1] as skill,
           p.created_at
      from public.profiles p
     where p.onboarded_at is not null
  )
  select id, display_name, username, avatar_url, rating, rating_count, jobs_done, skill
    from base
   where case p_kind
           when 'top_rated'   then rating_count > 0
           when 'most_active' then recent_quotes > 0
           else created_at > now() - interval '60 days'
         end
   order by
     case when p_kind = 'top_rated'   then rating end desc nulls last,
     case when p_kind = 'top_rated'   then rating_count end desc,
     case when p_kind = 'most_active' then recent_quotes end desc,
     created_at desc
   limit greatest(1, least(coalesce(p_limit, 10), 30))
$$;

-- What someone has done, as another person sees it on their public profile.
create or replace function public.public_profile_stats(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'jobsDone', (select count(*) from public.assignments a
                   join public.tasks t on t.id = a.task_id
                  where a.worker_id = p_user and t.status in ('COMPLETED', 'AUTO_COMPLETED')),
    'tasksPosted', (select count(*) from public.tasks t where t.poster_id = p_user),
    'tasksCompletedAsPoster', (select count(*) from public.tasks t
                                where t.poster_id = p_user
                                  and t.status in ('COMPLETED', 'AUTO_COMPLETED'))
  )
$$;

-- 12 ------------------------------------------------------------------------
-- Who may call what. Default EXECUTE-to-PUBLIC is revoked, as in 047.
revoke all on function public.open_support_ticket(text, text, text) from public, anon;
revoke all on function public.reply_support_ticket(uuid, text) from public, anon;
revoke all on function public.resolve_support_ticket(uuid) from public, anon;
revoke all on function public.apply_referral_code(text) from public, anon;
revoke all on function public.platform_highlights() from public, anon;
revoke all on function public.trending_categories(integer) from public, anon;
revoke all on function public.top_earners(text, integer) from public, anon;
revoke all on function public.public_profile_stats(uuid) from public, anon;

grant execute on function public.open_support_ticket(text, text, text) to authenticated;
grant execute on function public.reply_support_ticket(uuid, text) to authenticated;
grant execute on function public.resolve_support_ticket(uuid) to authenticated;
grant execute on function public.apply_referral_code(text) to authenticated;
grant execute on function public.platform_highlights() to authenticated;
grant execute on function public.trending_categories(integer) to authenticated;
grant execute on function public.top_earners(text, integer) to authenticated;
grant execute on function public.public_profile_stats(uuid) to authenticated;

revoke all on function private.on_bid_inserted() from public;
revoke all on function private.on_task_changed() from public;
revoke all on function private.on_message_inserted() from public;
revoke all on function private.auto_accept_bid() from public;
