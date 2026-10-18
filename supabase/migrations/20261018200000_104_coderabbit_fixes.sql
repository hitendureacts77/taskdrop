-- ===========================================================================
-- Migration 104: fixes from CodeRabbit's review of the earlier pull requests
--
--   1. The admin live feed no longer shows a task title that looks like it
--      holds a phone number (8+ digits) or an email address (a poster can type
--      anything). CodeRabbit suggested 6 digits; an Indian pin code has 6, so
--      8 is used to keep ordinary titles visible.
--   2. The four task-access helpers from migration 004 are no longer
--      executable by `anon`. Signed-out visitors have no table grants at all,
--      so no policy of theirs is ever evaluated; the grant did nothing but
--      let them probe the helpers.
--   3. One payment per Razorpay payment link: a second row with the same
--      provider_ref is refused. (The earlier index was not unique.) Rows with no
--      reference are not affected. Checked on the hosted test project: no
--      duplicates existed.
--   4. The live feed's own clean-up moves out of the insert trigger (it ran on
--      every 25th event, inside the user's transaction, and could wait on a
--      locked row) into housekeeping, which Inngest runs hourly and which skips
--      rows another transaction is holding.
--
-- Not changed, on purpose: confirm_release() still trusts the wallet row to
-- exist. Every profile has a wallet (a trigger makes it at sign-up and the
-- hosted test project has none without), so a guard would be dead code.
--
-- Adds only; nothing is dropped or renamed.
-- ===========================================================================

-- ---- 1. live feed: hide titles that look like contact details ---------------
create or replace function private.live_task_posted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := left(coalesce(new.title, ''), 120);
begin
  -- A title is free text. Eight or more digits (a phone number, however it is
  -- spaced; an Indian pin code has six and stays visible) or an "@" (an email)
  -- means we show no title; the admin opens the task itself to read it.
  if length(regexp_replace(v_title, '\D', '', 'g')) >= 8 or position('@' in v_title) > 0 then
    v_title := null;
  end if;

  perform private.admin_live('task_posted', 'task', new.id, new.poster_id,
    jsonb_build_object(
      'title', v_title,
      'who', private.admin_live_name(new.poster_id),
      'amount_minor', new.benchmark_minor,
      'kind', new.kind,
      'category', new.category
    ));
  return null;
exception when others then
  return null;
end;
$$;

-- ---- 2. signed-out visitors cannot call the task-access helpers -------------
-- Postgres gives every function to PUBLIC by default, and anon inherits it, so
-- PUBLIC has to go too; signed-in people and the service role keep their own grants.
revoke execute on function private.is_task_poster(uuid, uuid)      from public, anon;
revoke execute on function private.user_bid_on_task(uuid, uuid)    from public, anon;
revoke execute on function private.user_assigned_task(uuid, uuid)  from public, anon;
revoke execute on function private.task_open_for_bid(uuid, uuid)   from public, anon;
grant execute on function private.is_task_poster(uuid, uuid)      to authenticated, service_role;
grant execute on function private.user_bid_on_task(uuid, uuid)    to authenticated, service_role;
grant execute on function private.user_assigned_task(uuid, uuid)  to authenticated, service_role;
grant execute on function private.task_open_for_bid(uuid, uuid)   to authenticated, service_role;

-- ---- 3. one payment per payment link ----------------------------------------
create unique index if not exists payments_provider_ref_uidx
  on public.payments (provider_ref)
  where provider_ref is not null;

-- ---- 4. the live feed no longer cleans up inside the insert -----------------
create or replace function private.admin_live(
  p_kind text, p_record_type text, p_record_id uuid, p_actor uuid, p_summary jsonb
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

-- Housekeeping now also trims the live feed (30 days), taking only rows nobody
-- else is holding, in bounded batches.
create or replace function public.run_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_rate integer; v_pw integer; v_codes integer; v_sends integer; v_places integer; v_notes integer;
  v_live integer;
begin
  perform private.assert_service_caller();

  delete from private.api_rate where window_start < now() - interval '1 hour';
  get diagnostics v_rate = row_count;

  delete from public.password_attempts where at < now() - interval '30 days';
  get diagnostics v_pw = row_count;

  delete from public.auth_codes where expires_at < now() - interval '1 day';
  get diagnostics v_codes = row_count;

  delete from public.auth_send_log where window_started_at < now() - interval '1 day';
  get diagnostics v_sends = row_count;

  delete from public.places_quota where window_started_at < now() - interval '1 day';
  get diagnostics v_places = row_count;

  delete from public.notifications where created_at < now() - interval '90 days';
  get diagnostics v_notes = row_count;

  delete from public.admin_live_events e
   using (select x.id from public.admin_live_events x
           where x.created_at < now() - interval '30 days'
           order by x.created_at
           limit 5000
           for update skip locked) old
   where e.id = old.id;
  get diagnostics v_live = row_count;

  return jsonb_build_object(
    'api_rate', v_rate, 'password_attempts', v_pw, 'auth_codes', v_codes,
    'auth_send_log', v_sends, 'places_quota', v_places, 'notifications', v_notes,
    'admin_live_events', v_live);
end;
$$;

revoke all on function public.run_housekeeping() from public, anon, authenticated;
grant execute on function public.run_housekeeping() to service_role;
