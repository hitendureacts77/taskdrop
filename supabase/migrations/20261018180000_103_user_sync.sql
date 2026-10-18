-- 103 -- people: created, updated, deleted, kept in step with Inngest.
--
-- Three events describe a person's life in the app. All three travel through the
-- outbox like every other event (090), so they are written in the same
-- transaction as the change and cannot be lost or invented:
--
--   user.signed_up   { user_id, name }                 passed the age check (082), already existed
--   user.updated     { user_id, changed: [field...] }  NEW: what changed, never the new value
--   user.deleted     { user_id, by_admin }             account deleted (087); also sent when an
--                                                      account is removed from auth outright
--
-- user.updated carries field NAMES from a fixed list, never what they were set to:
-- a bio, a UPI id or an address must not leave the database (see 090). Heartbeats
-- (last_seen_at, live_until), ratings and updated_at never raise it. Nothing is
-- sent for a person who has not passed the age check, or whose account is deleted.
--
-- Inngest answers each event by writing public.user_sync, a ledger with one row
-- per person: are they active or deleted, when were they first seen, how many
-- profile updates, what changed last. It holds no name, contact or any text.
-- It is what the admin panel and later integrations (mail lists, CRM) read to
-- know who exists, and user_sync_repair() puts it right if an event was ever missed.

-- ------------------------------------------------------------------ ledger --

create table if not exists public.user_sync (
  user_id          uuid primary key,                       -- no FK: the row outlives a removed account
  state            text not null default 'active' check (state in ('active', 'deleted')),
  first_seen_at    timestamptz not null default now(),
  signed_up_at     timestamptz,                            -- when user.signed_up arrived (null for older accounts)
  profile_updates  integer not null default 0,
  last_changed     text[] not null default '{}',           -- field names from the last user.updated
  last_updated_at  timestamptz,
  deleted_at       timestamptz,
  deleted_by_admin boolean,
  last_event_id    text,                                   -- the last event applied, so a re-run is a no-op
  synced_at        timestamptz not null default now()
);
create index if not exists user_sync_state_idx on public.user_sync (state);

alter table public.user_sync enable row level security;

drop policy if exists user_sync_read on public.user_sync;
create policy user_sync_read on public.user_sync
  for select to authenticated using ((select private.is_admin()));

revoke all on public.user_sync from public, anon, authenticated;
grant select on public.user_sync to authenticated;

comment on table public.user_sync is
  'One row per person, kept by the Inngest user-created / user-updated / user-deleted functions. No names or contact details. Admins read it; only the service role writes it.';

-- Everyone who exists today starts in the ledger.
insert into public.user_sync (user_id, state, first_seen_at, deleted_at)
select p.id,
       case when p.deleted_at is not null then 'deleted' else 'active' end,
       p.created_at,
       p.deleted_at
  from public.profiles p
on conflict (user_id) do nothing;

-- ------------------------------------------------------- applying an event --

/**
 * Called by the Inngest user functions with the event they just received.
 * Returns what happened: created, updated, deleted, known (already so),
 * duplicate (this exact event was applied) or ignored (e.g. an update that
 * arrives after the deletion: deleted is final).
 */
create or replace function public.user_sync_apply(
  p_user uuid,
  p_event text,
  p_event_id text default null,
  p_fields text[] default '{}',
  p_by_admin boolean default null
) returns text
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  c_fields constant text[] := array[
    'display_name', 'username', 'avatar_url', 'bio', 'worker_bio', 'skills', 'languages',
    'intent', 'location', 'payout_upi', 'onboarded', 'worker_onboarded', 'email', 'phone'];
  v_row    public.user_sync;
  v_fields text[];
begin
  perform private.assert_service_caller();
  if p_user is null then raise exception 'No person given'; end if;
  if p_event not in ('signed_up', 'updated', 'deleted') then
    raise exception 'Unknown user event: %', p_event;
  end if;

  v_fields := coalesce((
    select array_agg(distinct f order by f)
      from unnest(coalesce(p_fields, '{}')) f
     where f = any (c_fields)), '{}');

  select * into v_row from public.user_sync where user_id = p_user for update;

  if found and p_event_id is not null and v_row.last_event_id = p_event_id then
    return 'duplicate';
  end if;

  if p_event = 'signed_up' then
    if not found then
      insert into public.user_sync (user_id, state, signed_up_at, last_event_id)
      values (p_user, 'active', now(), p_event_id);
      return 'created';
    elsif v_row.state = 'deleted' then
      return 'ignored';
    elsif v_row.signed_up_at is null then
      update public.user_sync
         set signed_up_at = now(), last_event_id = p_event_id, synced_at = now()
       where user_id = p_user;
      return 'created';
    end if;
    update public.user_sync set last_event_id = p_event_id, synced_at = now() where user_id = p_user;
    return 'known';

  elsif p_event = 'updated' then
    if not found then
      -- An update from someone we never heard sign up: record them, do not lose the update.
      insert into public.user_sync (user_id, state, profile_updates, last_changed, last_updated_at, last_event_id)
      values (p_user, 'active', 1, v_fields, now(), p_event_id);
      return 'updated';
    elsif v_row.state = 'deleted' then
      return 'ignored';
    end if;
    update public.user_sync
       set profile_updates = profile_updates + 1,
           last_changed = v_fields,
           last_updated_at = now(),
           last_event_id = p_event_id,
           synced_at = now()
     where user_id = p_user;
    return 'updated';

  else  -- deleted
    if not found then
      insert into public.user_sync (user_id, state, deleted_at, deleted_by_admin, last_event_id)
      values (p_user, 'deleted', now(), p_by_admin, p_event_id);
      return 'deleted';
    elsif v_row.state = 'deleted' then
      update public.user_sync set last_event_id = p_event_id, synced_at = now() where user_id = p_user;
      return 'known';
    end if;
    update public.user_sync
       set state = 'deleted', deleted_at = now(), deleted_by_admin = p_by_admin,
           last_event_id = p_event_id, synced_at = now()
     where user_id = p_user;
    return 'deleted';
  end if;
end;
$fn$;

/**
 * Puts the ledger right if an event was ever missed: adds people it has not
 * seen, and marks as deleted anyone whose account is deleted or gone. Never
 * brings anyone back to life. Returns what it fixed.
 */
create or replace function public.user_sync_repair()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $fn$
declare
  v_added   integer;
  v_deleted integer;
  v_gone    integer;
  v_clash   integer;
begin
  perform private.assert_service_caller();

  insert into public.user_sync (user_id, state, first_seen_at, deleted_at)
  select p.id, case when p.deleted_at is not null then 'deleted' else 'active' end, p.created_at, p.deleted_at
    from public.profiles p
  on conflict (user_id) do nothing;
  get diagnostics v_added = row_count;

  update public.user_sync s
     set state = 'deleted', deleted_at = coalesce(s.deleted_at, p.deleted_at, now()), synced_at = now()
    from public.profiles p
   where p.id = s.user_id and p.deleted_at is not null and s.state = 'active';
  get diagnostics v_deleted = row_count;

  update public.user_sync s
     set state = 'deleted', deleted_at = coalesce(s.deleted_at, now()), synced_at = now()
   where s.state = 'active' and not exists (select 1 from public.profiles p where p.id = s.user_id);
  get diagnostics v_gone = row_count;

  select count(*) into v_clash
    from public.user_sync s join public.profiles p on p.id = s.user_id
   where s.state = 'deleted' and p.deleted_at is null;

  return jsonb_build_object('added', v_added, 'marked_deleted', v_deleted, 'marked_gone', v_gone, 'clashes', v_clash);
end;
$fn$;

revoke all on function public.user_sync_apply(uuid, text, text, text[], boolean),
  public.user_sync_repair() from public, anon, authenticated;
grant execute on function public.user_sync_apply(uuid, text, text, text[], boolean),
  public.user_sync_repair() to service_role;

-- ----------------------------------------------------------------- emitters --

-- A profile edit. Only the columns below can raise it, so the one-a-minute
-- heartbeat on last_seen_at never does.
create or replace function private.evt_profile_updated() returns trigger
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $fn$
declare
  v_changed text[] := '{}';
begin
  if old.deleted_at is not null or new.deleted_at is not null then return new; end if;

  if new.display_name is distinct from old.display_name then v_changed := array_append(v_changed, 'display_name'); end if;
  if new.username is distinct from old.username then v_changed := array_append(v_changed, 'username'); end if;
  if new.avatar_url is distinct from old.avatar_url then v_changed := array_append(v_changed, 'avatar_url'); end if;
  if new.bio is distinct from old.bio then v_changed := array_append(v_changed, 'bio'); end if;
  if new.worker_bio is distinct from old.worker_bio then v_changed := array_append(v_changed, 'worker_bio'); end if;
  if new.skills is distinct from old.skills then v_changed := array_append(v_changed, 'skills'); end if;
  if new.languages is distinct from old.languages then v_changed := array_append(v_changed, 'languages'); end if;
  if new.intent is distinct from old.intent then v_changed := array_append(v_changed, 'intent'); end if;
  if new.loc_lat is distinct from old.loc_lat or new.loc_lng is distinct from old.loc_lng
     or new.loc_label is distinct from old.loc_label then v_changed := array_append(v_changed, 'location'); end if;
  if new.payout_upi is distinct from old.payout_upi then v_changed := array_append(v_changed, 'payout_upi'); end if;
  if new.onboarded_at is distinct from old.onboarded_at then v_changed := array_append(v_changed, 'onboarded'); end if;
  if new.worker_onboarded_at is distinct from old.worker_onboarded_at then v_changed := array_append(v_changed, 'worker_onboarded'); end if;

  if cardinality(v_changed) = 0 then return new; end if;
  -- Nothing about a person until we know they are an adult (migration 082).
  if not exists (select 1 from public.age_checks a where a.user_id = new.id and a.passed) then return new; end if;

  perform private.emit_event('user.updated', jsonb_build_object('user_id', new.id, 'changed', to_jsonb(v_changed)));
  return new;
exception when others then return new;
end;
$fn$;

-- A change to how someone signs in. Only that it changed, never the address or number.
create or replace function private.evt_auth_user_updated() returns trigger
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $fn$
declare
  v_changed text[] := '{}';
begin
  if new.email is distinct from old.email then v_changed := array_append(v_changed, 'email'); end if;
  if new.phone is distinct from old.phone then v_changed := array_append(v_changed, 'phone'); end if;
  if cardinality(v_changed) = 0 then return new; end if;
  if not exists (select 1 from public.profiles p where p.id = new.id and p.deleted_at is null) then return new; end if;
  if not exists (select 1 from public.age_checks a where a.user_id = new.id and a.passed) then return new; end if;

  perform private.emit_event('user.updated', jsonb_build_object('user_id', new.id, 'changed', to_jsonb(v_changed)));
  return new;
exception when others then return new;
end;
$fn$;

-- An account removed from auth outright (the dashboard, a clean-up script)
-- rather than through delete_account(). Without this the ledger would say the
-- person is still active. delete_account() keeps the auth row, so it is not
-- affected; neither is anyone the ledger never saw.
create or replace function private.evt_auth_user_deleted() returns trigger
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $fn$
begin
  if exists (select 1 from public.user_sync s where s.user_id = old.id and s.state <> 'deleted') then
    perform private.emit_event('user.deleted', jsonb_build_object('user_id', old.id, 'by_admin', null, 'removed', true));
  end if;
  return old;
exception when others then return old;
end;
$fn$;

revoke all on function private.evt_profile_updated(), private.evt_auth_user_updated(),
  private.evt_auth_user_deleted() from public, anon, authenticated;

drop trigger if exists evt_profile_updated on public.profiles;
create trigger evt_profile_updated
  after update of display_name, username, avatar_url, bio, worker_bio, skills, languages, intent,
                  loc_lat, loc_lng, loc_label, payout_upi, onboarded_at, worker_onboarded_at
  on public.profiles
  for each row execute function private.evt_profile_updated();

drop trigger if exists evt_auth_user_updated on auth.users;
create trigger evt_auth_user_updated
  after update of email, phone on auth.users
  for each row execute function private.evt_auth_user_updated();

drop trigger if exists evt_auth_user_deleted on auth.users;
create trigger evt_auth_user_deleted
  after delete on auth.users
  for each row execute function private.evt_auth_user_deleted();
