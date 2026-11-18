-- 192: Inngest gets ids and amounts only (owner decision 17 Nov 2026, data in India where possible).
--
-- Inngest Cloud runs in the United States. Until now four team-alert events and the
-- sign-up event carried a person's display name. From now on:
--   * the trigger functions send ids (user_id, poster_id) instead of names, and
--   * emit_event strips any personal key as a second lock, so no future caller can
--     leak one by accident (this also covers the sign-up event built in record_birth_date).
-- The team-alert job looks the name up in the database by id (it has service access).
-- Forward-only; stored outbox rows are not touched (the job still reads a legacy
-- name if an old queued event arrives).

create or replace function private.emit_event(p_kind text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'private', 'pg_temp'
as $fn$
declare
  v_id   uuid;
  v_url  text;
  v_req  bigint;
  v_data jsonb := coalesce(p_data, '{}'::jsonb)
    - 'name' - 'from' - 'poster' - 'display_name' - 'email' - 'phone' - 'address';
begin
  begin
    insert into private.outbox (kind, data)
    values (p_kind, v_data)
    returning id into v_id;
  exception when others then
    return;
  end;

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
                     'data', v_data,
                     'ts',   (extract(epoch from clock_timestamp()) * 1000)::bigint),
        headers := jsonb_build_object('Content-Type', 'application/json')
      );
      update private.outbox set request_id = v_req, attempts = attempts + 1 where id = v_id;
    end if;
  exception when others then
    null;
  end;
end;
$fn$;
revoke all on function private.emit_event(text, jsonb) from public, anon, authenticated;

create or replace function private.evt_support() returns trigger
language plpgsql security definer set search_path to 'public', 'private', 'pg_temp' as $fn$
begin
  perform private.emit_event('support.opened', jsonb_build_object(
    'ticket_id', new.id,
    'user_id', new.user_id,
    'category', new.category));
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
      'user_id', new.user_id,
      'amount_rupees', round(new.amount_minor / 100.0, 2),
      'via', new.via));
  elsif new.status::text = 'failed' and old.status::text is distinct from 'failed' then
    perform private.emit_event('payout.failed', jsonb_build_object(
      'payout_id', new.id,
      'user_id', new.user_id,
      'amount_rupees', round(new.amount_minor / 100.0, 2)));
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
    'poster_id', new.poster_id));
  return new;
exception when others then return new;
end;
$fn$;
revoke all on function private.evt_support(), private.evt_payout(), private.evt_dispute() from public, anon, authenticated;
