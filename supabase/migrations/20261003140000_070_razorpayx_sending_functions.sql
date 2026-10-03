-- 070 -- the sending side of RazorpayX payouts, from section G of the (never
-- applied) 066 hardening migration. The razorpayx-payouts function in this repo
-- (check-all / give-back for the admin Payouts page, sync-mine for the app)
-- needs these; the live ones were the older 065 versions and fail_unsent_payout
-- did not exist. Server-only: callable by the service role, nobody else.

set check_function_bodies = off;


/**
 * Take a withdrawal to hand to RazorpayX. A new request, or one whose last
 * attempt got no answer more than two minutes ago (a crash or a timeout: the
 * caller sends it again with the same idempotency key, and RazorpayX answers
 * with the payout it already made, if it made one). Never anything RazorpayX
 * has already acknowledged.
 */
create or replace function public.claim_payout_for_sending(p_payout_id uuid)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_row public.payouts;
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform sends withdrawals';
  end if;

  update public.payouts
     set status = 'processing',
         attempts = attempts + 1,
         last_attempt_at = now(),
         updated_at = now()
   where id = p_payout_id
     and via = 'razorpayx'
     and destination_id is not null
     and (
       status = 'requested'
       or (status = 'processing'
           and provider_payout_id is null
           and attempts < 5   -- after five tries it waits for a person
           and (last_attempt_at is null or last_attempt_at < now() - interval '2 minutes'))
     )
  returning * into v_row;
  return v_row;
end;
$fn$;

/**
 * An attempt got no clear answer. The withdrawal stays "processing": it is
 * never put back where the worker could cancel it, because RazorpayX may be
 * paying it. The next claim, two minutes on, sends it again with the same key.
 */
create or replace function public.unclaim_payout(p_payout_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform sends withdrawals';
  end if;
  update public.payouts
     set failure_note = left(p_note, 500), updated_at = now()
   where id = p_payout_id and status = 'processing' and provider_payout_id is null;
end;
$fn$;

create or replace function public.record_payout_sent(p_payout_id uuid, p_provider_id text, p_mode text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform sends withdrawals';
  end if;
  update public.payouts
     set provider_payout_id = coalesce(provider_payout_id, p_provider_id),
         mode = coalesce(p_mode, mode),
         sent_at = coalesce(sent_at, now()),
         failure_note = null,
         updated_at = now()
   where id = p_payout_id
     and status in ('requested', 'processing')
     and (provider_payout_id is null or provider_payout_id = p_provider_id);
end;
$fn$;

/**
 * Give the money back for a withdrawal RazorpayX never took: refused before a
 * payout existed, or confirmed by RazorpayX to have no payout under this
 * withdrawal's reference. The caller must know that; this only checks that we
 * never recorded a RazorpayX payout for it.
 *
 * The caller passes the attempt number it checked against RazorpayX. If the
 * withdrawal was sent again since (attempts moved on), or was tried less than
 * p_quiet_minutes ago, nothing changes and the row comes back still open: a
 * fresh attempt may be landing at RazorpayX right now.
 */
drop function if exists public.fail_unsent_payout(uuid, text);
create or replace function public.fail_unsent_payout(
  p_payout_id         uuid,
  p_note              text,
  p_expected_attempts int default null,
  p_quiet_minutes     int default 0
)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_row public.payouts;
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform settles withdrawals';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then return null; end if;
  if v_row.status not in ('requested', 'processing') or v_row.provider_payout_id is not null then
    return v_row;
  end if;
  if p_expected_attempts is not null and v_row.attempts <> p_expected_attempts then
    return v_row;
  end if;
  if coalesce(p_quiet_minutes, 0) > 0
     and v_row.last_attempt_at is not null
     and v_row.last_attempt_at > now() - make_interval(mins => p_quiet_minutes) then
    return v_row;
  end if;

  update public.payouts
     set status = 'failed',
         failure_note = left(coalesce(p_note, 'RazorpayX could not send it'), 500),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
   where user_id = v_row.user_id;

  perform private.notify(v_row.user_id, 'payout_failed', 'Withdrawal could not be sent',
    coalesce(p_note, 'RazorpayX could not send it') || '. The money is back in your earnings.', null);
  return v_row;
end;
$fn$;


do $$
declare f text;
begin
  foreach f in array array[
    'public.claim_payout_for_sending(uuid)',
    'public.unclaim_payout(uuid, text)',
    'public.record_payout_sent(uuid, text, text)',
    'public.fail_unsent_payout(uuid, text, int, int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
