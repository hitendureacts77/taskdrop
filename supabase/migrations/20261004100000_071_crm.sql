-- 071 -- CRM for the admin panel: private notes and follow-ups, tags, account
-- suspension, saved segments and broadcast messages.
--
-- Everything here is admin-only. The tables can be READ by an admin session and
-- are written only through the functions below, each of which checks
-- private.is_admin() itself. Nothing is visible to, or writable by, an ordinary
-- signed-in user.
--
-- Suspending a person bans their sign-in (auth.users.banned_until), ends their
-- sessions and stops withdrawals. Their jobs and money are left exactly where
-- they are; an admin decides what to do with those.

set check_function_bodies = off;

-- ---------------------------------------------------------------- tables --

create table if not exists public.crm_notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  author_id    uuid references auth.users (id) on delete set null,
  body         text not null check (char_length(btrim(body)) between 1 and 4000),
  pinned       boolean not null default false,
  follow_up_at timestamptz,
  done_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists crm_notes_user_idx on public.crm_notes (user_id, created_at desc);
create index if not exists crm_notes_followup_idx on public.crm_notes (follow_up_at) where follow_up_at is not null and done_at is null;

create table if not exists public.crm_tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 30),
  color      text not null default 'blue',
  created_at timestamptz not null default now()
);
create unique index if not exists crm_tags_name_idx on public.crm_tags (lower(btrim(name)));

create table if not exists public.crm_user_tags (
  user_id    uuid not null references auth.users (id) on delete cascade,
  tag_id     uuid not null references public.crm_tags (id) on delete cascade,
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, tag_id)
);
create index if not exists crm_user_tags_tag_idx on public.crm_user_tags (tag_id);

create table if not exists public.user_suspensions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  reason        text not null check (char_length(btrim(reason)) between 1 and 500),
  suspended_by  uuid references auth.users (id) on delete set null,
  suspended_at  timestamptz not null default now(),
  lifted_at     timestamptz,
  lifted_by     uuid references auth.users (id) on delete set null,
  lift_note     text
);
create unique index if not exists user_suspensions_open_idx on public.user_suspensions (user_id) where lifted_at is null;
create index if not exists user_suspensions_user_idx on public.user_suspensions (user_id, suspended_at desc);

create table if not exists public.crm_segments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  criteria   jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_broadcasts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  audience    text not null,
  criteria    jsonb,
  to_user     uuid references auth.users (id) on delete set null,
  sent_by     uuid references auth.users (id) on delete set null,
  sent_at     timestamptz not null default now(),
  recipients  integer not null default 0
);
create index if not exists crm_broadcasts_sent_idx on public.crm_broadcasts (sent_at desc);

do $$
declare t text;
begin
  foreach t in array array['crm_notes','crm_tags','crm_user_tags','user_suspensions','crm_segments','crm_broadcasts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_admin())', t || '_admin_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------- segments --

/**
 * Who matches a set of filters. Every key is optional:
 *   role               'any' | 'worker' | 'poster'   (poster = not signed up to work)
 *   joined_within_days joined in the last N days
 *   inactive_days      not seen for N days
 *   tag_id             carries this tag
 *   min_wallet_minor   money in their wallet (ready + clearing) is at least this
 *   never_posted       has never posted a job
 *   available_now      switched on "available now"
 *   include_suspended  suspended people are left out unless this is true
 */
create or replace function private.crm_segment_ids(p_criteria jsonb)
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  c           jsonb   := coalesce(p_criteria, '{}'::jsonb);
  v_role      text    := coalesce(nullif(c ->> 'role', ''), 'any');
  v_joined    int     := nullif(c ->> 'joined_within_days', '')::int;
  v_inactive  int     := nullif(c ->> 'inactive_days', '')::int;
  v_tag       uuid    := nullif(c ->> 'tag_id', '')::uuid;
  v_min       bigint  := nullif(c ->> 'min_wallet_minor', '')::bigint;
  v_never     boolean := coalesce((c ->> 'never_posted')::boolean, false);
  v_live      boolean := coalesce((c ->> 'available_now')::boolean, false);
  v_susp      boolean := coalesce((c ->> 'include_suspended')::boolean, false);
begin
  if v_role not in ('any', 'worker', 'poster') then
    raise exception 'role must be any, worker or poster';
  end if;
  return query
    select p.id
      from public.profiles p
     where (v_role = 'any'
            or (v_role = 'worker' and p.worker_onboarded_at is not null)
            or (v_role = 'poster' and p.worker_onboarded_at is null))
       and (v_joined is null or p.created_at >= now() - make_interval(days => v_joined))
       and (v_inactive is null or coalesce(p.last_seen_at, p.created_at) < now() - make_interval(days => v_inactive))
       and (v_tag is null or exists (select 1 from public.crm_user_tags ut where ut.user_id = p.id and ut.tag_id = v_tag))
       and (v_min is null or coalesce((select w.balance_minor + w.clearing_minor from public.wallets w where w.user_id = p.id), 0) >= v_min)
       and (not v_never or not exists (select 1 from public.tasks t where t.poster_id = p.id))
       and (not v_live or p.live_until > now())
       and (v_susp or not exists (select 1 from public.user_suspensions s where s.user_id = p.id and s.lifted_at is null));
end;
$fn$;
revoke all on function private.crm_segment_ids(jsonb) from public, anon, authenticated;

create or replace function public.crm_segment_users(p_criteria jsonb)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  return query select * from private.crm_segment_ids(p_criteria);
end;
$fn$;

create or replace function public.crm_save_segment(p_name text, p_criteria jsonb)
returns public.crm_segments
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_row public.crm_segments;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Give the segment a name'; end if;
  perform count(*) from private.crm_segment_ids(p_criteria);  -- rejects bad criteria now, not later
  insert into public.crm_segments (name, criteria, created_by)
  values (left(btrim(p_name), 60), coalesce(p_criteria, '{}'::jsonb), auth.uid())
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.crm_delete_segment(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  delete from public.crm_segments where id = p_id;
end;
$fn$;

-- ----------------------------------------------------------------- notes --

create or replace function public.crm_add_note(p_user uuid, p_body text, p_follow_up timestamptz default null)
returns public.crm_notes
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_row public.crm_notes;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Write the note first'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'That person no longer exists'; end if;
  insert into public.crm_notes (user_id, author_id, body, follow_up_at)
  values (p_user, auth.uid(), left(btrim(p_body), 4000), p_follow_up)
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function public.crm_update_note(p_note uuid, p_pinned boolean default null, p_done boolean default null)
returns public.crm_notes
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_row public.crm_notes;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  update public.crm_notes
     set pinned  = coalesce(p_pinned, pinned),
         done_at = case when p_done is null then done_at when p_done then coalesce(done_at, now()) else null end
   where id = p_note
  returning * into v_row;
  if not found then raise exception 'That note no longer exists'; end if;
  return v_row;
end;
$fn$;

create or replace function public.crm_delete_note(p_note uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  delete from public.crm_notes where id = p_note;
end;
$fn$;

-- ------------------------------------------------------------------ tags --

create or replace function public.crm_assign_tag(p_user uuid, p_name text, p_color text default null)
returns public.crm_tags
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_tag  public.crm_tags;
  v_colors text[] := array['blue', 'green', 'gold', 'red', 'purple', 'grey'];
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if v_name = '' then raise exception 'Type a tag name'; end if;
  if char_length(v_name) > 30 then raise exception 'Tags are at most 30 characters'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'That person no longer exists'; end if;

  select * into v_tag from public.crm_tags where lower(btrim(name)) = lower(v_name);
  if not found then
    insert into public.crm_tags (name, color)
    values (v_name, case when p_color = any (v_colors) then p_color else v_colors[1 + (select count(*)::int from public.crm_tags) % array_length(v_colors, 1)] end)
    returning * into v_tag;
  end if;
  insert into public.crm_user_tags (user_id, tag_id, added_by) values (p_user, v_tag.id, auth.uid()) on conflict do nothing;
  return v_tag;
end;
$fn$;

create or replace function public.crm_remove_tag(p_user uuid, p_tag uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  delete from public.crm_user_tags where user_id = p_user and tag_id = p_tag;
end;
$fn$;

create or replace function public.crm_delete_tag(p_tag uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  delete from public.crm_tags where id = p_tag;
end;
$fn$;

-- ------------------------------------------------------------ suspension --

create or replace function public.crm_suspend_user(p_user uuid, p_reason text)
returns public.user_suspensions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_row public.user_suspensions;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say why, so the next admin knows'; end if;
  if p_user = auth.uid() then raise exception 'You cannot suspend yourself'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user and role = 'admin') then
    raise exception 'An admin cannot be suspended from here';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'That person no longer exists'; end if;
  if exists (select 1 from public.user_suspensions where user_id = p_user and lifted_at is null) then
    raise exception 'That person is already suspended';
  end if;

  insert into public.user_suspensions (user_id, reason, suspended_by)
  values (p_user, left(btrim(p_reason), 500), auth.uid())
  returning * into v_row;

  -- No sign-in, no refresh, no more pushes. A short-lived access token already
  -- issued can still work until it expires (up to an hour).
  update auth.users set banned_until = now() + interval '100 years' where id = p_user;
  delete from auth.sessions where user_id = p_user;
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from public.push_tokens where user_id = p_user;
  return v_row;
end;
$fn$;

create or replace function public.crm_unsuspend_user(p_user uuid, p_note text default null)
returns public.user_suspensions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_row public.user_suspensions;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  update public.user_suspensions
     set lifted_at = now(), lifted_by = auth.uid(), lift_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where user_id = p_user and lifted_at is null
  returning * into v_row;
  if not found then raise exception 'That person is not suspended'; end if;
  update auth.users set banned_until = null where id = p_user;
  perform private.notify(p_user, 'announcement', 'Your account is active again',
    'You can use TaskDrop as normal. Sign in again to continue.', null);
  return v_row;
end;
$fn$;

-- A suspended person cannot ask for a withdrawal either (their sign-in is
-- already blocked; this closes the hour a still-valid token could be used).
create or replace function public.request_withdrawal(
  p_amount_minor bigint,
  p_destination text default null::text,
  p_destination_id uuid default null::uuid
)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me      uuid := auth.uid();
  v_balance bigint;
  v_min     bigint := private.setting_num('min_withdraw_minor', 10000)::bigint;
  v_dest    public.payout_destinations;
  v_label   text;
  v_row     public.payouts;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public.user_suspensions where user_id = v_me and lifted_at is null) then
    raise exception 'Your account is suspended. Contact support.';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter an amount to withdraw';
  end if;
  if p_amount_minor < v_min then
    raise exception 'The minimum withdrawal is % rupees', (v_min / 100);
  end if;

  if p_destination_id is not null then
    select * into v_dest from public.payout_destinations where id = p_destination_id and user_id = v_me;
    if not found then
      raise exception 'Choose one of your saved bank accounts or UPI IDs';
    end if;
    v_label := case
      when v_dest.kind = 'upi' then 'UPI · ' || v_dest.upi_id
      else 'Bank · ' || coalesce(v_dest.account_name, '') || ' · ••••' || right(coalesce(v_dest.account_number, ''), 4)
    end;
  else
    if not exists (select 1 from public.payout_destinations where user_id = v_me) then
      raise exception 'Add a bank account or UPI ID before withdrawing';
    end if;
    v_label := nullif(btrim(coalesce(p_destination, '')), '');
    if v_label is null then
      raise exception 'Choose the bank account or UPI ID to send the money to';
    end if;
  end if;

  select balance_minor into v_balance from public.wallets where user_id = v_me for update;
  if not found then
    raise exception 'No wallet found';
  end if;
  if v_balance < p_amount_minor then
    raise exception 'That is more than your earnings available to withdraw';
  end if;

  update public.wallets set balance_minor = balance_minor - p_amount_minor where user_id = v_me;

  insert into public.payouts (user_id, amount_minor, destination, destination_id)
  values (v_me, p_amount_minor, v_label, p_destination_id)
  returning * into v_row;

  return v_row;
end;
$function$;

-- ------------------------------------------------------------- broadcasts --

/**
 * Send one message to a person or to everyone matching the filters. It lands in
 * each person's notification list, and the existing notifications trigger sends
 * the phone push. At most 5,000 people per send, so one slip cannot spam the
 * whole user base.
 */
create or replace function public.crm_send_broadcast(
  p_title    text,
  p_body     text,
  p_criteria jsonb default null,
  p_user     uuid default null,
  p_label    text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_ids   uuid[];
  v_uid   uuid;
  v_n     integer;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if v_title = '' or char_length(v_title) > 80 then raise exception 'The title needs 1 to 80 characters'; end if;
  if v_body = '' or char_length(v_body) > 500 then raise exception 'The message needs 1 to 500 characters'; end if;

  if p_user is not null then
    v_ids := array[p_user];
  else
    select coalesce(array_agg(x), '{}') into v_ids from private.crm_segment_ids(p_criteria) x;
  end if;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'Nobody matches, so nothing was sent'; end if;
  if v_n > 5000 then raise exception 'That is % people. A single message is limited to 5,000: narrow the audience.', v_n; end if;

  foreach v_uid in array v_ids loop
    perform private.notify(v_uid, 'announcement', v_title, v_body, null);
  end loop;

  insert into public.crm_broadcasts (title, body, audience, criteria, to_user, sent_by, recipients)
  values (v_title, v_body, coalesce(nullif(btrim(p_label), ''), case when p_user is not null then 'One person' else 'Everyone matching the filters' end),
          p_criteria, p_user, auth.uid(), v_n);
  return v_n;
end;
$fn$;

-- --------------------------------------------------------------- grants --

do $$
declare f text;
begin
  foreach f in array array[
    'public.crm_segment_users(jsonb)',
    'public.crm_save_segment(text, jsonb)',
    'public.crm_delete_segment(uuid)',
    'public.crm_add_note(uuid, text, timestamptz)',
    'public.crm_update_note(uuid, boolean, boolean)',
    'public.crm_delete_note(uuid)',
    'public.crm_assign_tag(uuid, text, text)',
    'public.crm_remove_tag(uuid, uuid)',
    'public.crm_delete_tag(uuid)',
    'public.crm_suspend_user(uuid, text)',
    'public.crm_unsuspend_user(uuid, text)',
    'public.crm_send_broadcast(text, text, jsonb, uuid, text)',
    'public.request_withdrawal(bigint, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
