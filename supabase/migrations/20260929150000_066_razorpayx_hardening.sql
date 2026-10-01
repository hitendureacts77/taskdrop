-- 066 — RazorpayX withdrawals that can never be paid twice, and the money fixes
-- found when the live system was checked on 29 Sep 2026.
--
-- What changes, in the order it appears below:
--
--   A. Settings: the most one withdrawal can be (₹1,00,000; UPI caps there).
--   B. Carried over from 060 and 062, which were never applied live (their
--      files are now empty): the earnings-per-day function, and the refund
--      claim that stops a card refund being sent twice. The razorpay function's
--      refund-escrow action already calls claim_escrow_refund, which does not
--      exist live -- so refunding an older card-paid job errors today.
--   C. Name and PAN, once, before the first withdrawal (payout_profiles).
--   D. A withdrawal's life at RazorpayX, written down: how often it was tried,
--      RazorpayX's own status, fee, tax, and whether a bank bounced it later.
--   E. Workers add their own bank/UPI accounts but can no longer set the
--      RazorpayX ids on them, and cannot remove an account while a withdrawal
--      to it is on its way.
--   F. request_withdrawal: needs name + PAN, respects the maximum, and marks
--      old-style requests (account named only in text) as manual.
--   G. Sending. The rule that makes double payment impossible: once a
--      withdrawal has been handed to RazorpayX it never goes back to
--      "requested" (where the worker could cancel it and get the money back
--      while RazorpayX still pays it). Retries reuse the same idempotency key,
--      so RazorpayX answers them with the payout it already has. Only
--      RazorpayX's own status settles it -- including a bank bouncing it after
--      it was paid, and a payout cancelled inside RazorpayX, neither of which
--      was handled before.
--   H. Admin: the payout queue says what RazorpayX said; a withdrawal that
--      reached RazorpayX can no longer be marked paid or failed by hand; and
--      admin_payout_queue now refuses non-admins instead of returning nothing
--      (the razorpayx-payouts function used it as its admin check, so any
--      signed-in user could press "send all").
--   I. Disputes. admin_resolve_dispute failed every time (it wrote 'cancelled'
--      into assignment_status and a uuid into cancelled_by), freezing the job's
--      money. Worker wins: their share is paid like any finished job. Poster
--      wins: everything they paid comes back, the same way as a cancellation.
--   J. A worker walking off an older card-paid job left the job marked paid;
--      the next hire, at any price, started on the old payment. That payment
--      now goes to the poster's wallet and the job must be paid again.
--   K. Earnings still "clearing" from before clearing became instant are
--      released now instead of on 30 Sep - 5 Oct.
--   L. One admin figure set for the Payouts page: what TaskDrop holds for
--      people, against what is in RazorpayX.

set check_function_bodies = off;

-- --------------------------------------------------------------- A. settings --

insert into public.settings (key, value)
values ('max_withdraw_minor', to_jsonb(10000000))
on conflict (key) do nothing;

-- ------------------------------------------------ B. carried over (060, 062) --

create or replace function public.admin_earnings_daily(p_since date)
returns table (day date, kind text, amount_minor bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  return query
    select (l.created_at at time zone 'Asia/Kolkata')::date as day,
           l.kind,
           sum(l.amount_minor)::bigint
      from public.platform_ledger l
     where l.created_at >= (p_since::timestamp at time zone 'Asia/Kolkata')
     group by 1, 2
     order by 1, 2;
end;
$fn$;

revoke all on function public.admin_earnings_daily(date) from public, anon;
grant execute on function public.admin_earnings_daily(date) to authenticated;

alter table public.payments
  add column if not exists refund_claimed_at timestamptz;

comment on column public.payments.refund_claimed_at is
  'Set while a refund of this payment is being sent. ''infinity'' = sent but not recorded; a person must reconcile it and clear this.';

create or replace function public.claim_escrow_refund(p_payment_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_ok boolean;
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform sends refunds';
  end if;

  update public.payments
     set refund_claimed_at = now()
   where id = p_payment_id
     and (refund_claimed_at is null or refund_claimed_at < now() - interval '15 minutes')
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$fn$;

create or replace function public.release_escrow_refund_claim(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform sends refunds';
  end if;

  update public.payments
     set refund_claimed_at = null
   where id = p_payment_id
     and refund_claimed_at <> 'infinity';
end;
$fn$;

revoke all on function public.claim_escrow_refund(uuid) from public, anon, authenticated;
revoke all on function public.release_escrow_refund_claim(uuid) from public, anon, authenticated;
grant execute on function public.claim_escrow_refund(uuid) to service_role;
grant execute on function public.release_escrow_refund_claim(uuid) to service_role;

-- ------------------------------------------------------- C. name and PAN --

create table if not exists public.payout_profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  legal_name text not null check (char_length(btrim(legal_name)) between 3 and 80),
  pan        text not null check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payout_profiles is
  'The name and PAN a worker gives before their first withdrawal. Written only through save_payout_profile().';

drop trigger if exists trg_payout_profiles_updated on public.payout_profiles;
create trigger trg_payout_profiles_updated before update on public.payout_profiles
  for each row execute function public.set_updated_at();

alter table public.payout_profiles enable row level security;
drop policy if exists payout_profiles_read on public.payout_profiles;
create policy payout_profiles_read on public.payout_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

revoke all on public.payout_profiles from anon, authenticated;
grant select on public.payout_profiles to authenticated;

create or replace function public.save_payout_profile(p_legal_name text, p_pan text)
returns public.payout_profiles
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me   uuid := auth.uid();
  v_name text := regexp_replace(btrim(coalesce(p_legal_name, '')), '\s+', ' ', 'g');
  v_pan  text := upper(regexp_replace(coalesce(p_pan, ''), '\s', '', 'g'));
  v_row  public.payout_profiles;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 80 then
    raise exception 'Enter your full name as it is on your PAN card';
  end if;
  if v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'That PAN doesn''t look right. A PAN looks like ABCDE1234F.';
  end if;

  insert into public.payout_profiles (user_id, legal_name, pan)
  values (v_me, v_name, v_pan)
  on conflict (user_id) do update
     set legal_name = excluded.legal_name, pan = excluded.pan, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.save_payout_profile(text, text) from public, anon;
grant execute on function public.save_payout_profile(text, text) to authenticated;

/** The caller's own name and the last four of their PAN, for the app to show. */
create or replace function public.my_payout_profile()
returns table (legal_name text, pan_last4 text, updated_at timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select p.legal_name, right(p.pan, 4), p.updated_at
    from public.payout_profiles p
   where p.user_id = auth.uid();
$fn$;

revoke all on function public.my_payout_profile() from public, anon;
grant execute on function public.my_payout_profile() to authenticated;

-- ------------------------------------------- D. a withdrawal at RazorpayX --

alter table public.payouts
  add column if not exists via                text not null default 'razorpayx',
  add column if not exists attempts           integer not null default 0,
  add column if not exists last_attempt_at    timestamptz,
  add column if not exists provider_status    text,
  add column if not exists provider_status_at timestamptz,
  add column if not exists fee_minor          bigint,
  add column if not exists tax_minor          bigint,
  add column if not exists reversed_at        timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payouts_via_check') then
    alter table public.payouts add constraint payouts_via_check check (via in ('razorpayx', 'manual'));
  end if;
end $$;

comment on column public.payouts.via is
  '''razorpayx'': sent by the razorpayx-payouts function and settled only by RazorpayX''s answer. ''manual'': paid by a person and recorded with admin_mark_payout.';
comment on column public.payouts.last_attempt_at is
  'When it was last handed to RazorpayX. Once set, the withdrawal can no longer be cancelled or settled by hand.';
comment on column public.payouts.provider_status is
  'RazorpayX''s own word for it: queued, pending, scheduled, processing, processed, reversed, failed, rejected, cancelled.';

-- Withdrawals from before this migration. Run once (only rows that have never
-- been through 066's own sending, i.e. attempts = 0).
--
-- 1. Asked for before RazorpayX: the account is named only in text, so a
--    person pays them.
update public.payouts
   set via = 'manual'
 where destination_id is null and provider_payout_id is null and attempts = 0;

-- 2. Sent by 065 and accepted by RazorpayX: only RazorpayX settles them.
update public.payouts
   set attempts = 1, last_attempt_at = coalesce(sent_at, updated_at)
 where provider_payout_id is not null and attempts = 0;

-- 3. 065 tried to send it, got no clear answer and put it back to
--    "requested" (its unclaim wrote a note). RazorpayX may have paid it, so it
--    must not be cancellable; 066 resends it with the same key.
update public.payouts
   set status = 'processing', attempts = 1, last_attempt_at = updated_at
 where status = 'requested' and via = 'razorpayx' and destination_id is not null
   and provider_payout_id is null and failure_note is not null and attempts = 0;

-- 4. "processing" with no RazorpayX id under 065 means either 065's sender
--    was mid-way or a person marked it to pay by hand; the two can't be told
--    apart. Neither may be sent again automatically: a person checks RazorpayX
--    first and settles it by hand.
update public.payouts
   set via = 'manual',
       failure_note = coalesce(failure_note || ' ', '') || 'Check RazorpayX for this withdrawal before paying it by hand: it may already have been sent.'
 where status = 'processing' and provider_payout_id is null and attempts = 0
   and last_attempt_at is null and destination_id is not null;

create index if not exists payouts_open_idx on public.payouts (created_at) where status in ('requested', 'processing');

-- ------------------------------------------------ E. payout accounts --

-- Workers add their own accounts; only the platform writes the RazorpayX ids.
revoke insert, update on public.payout_destinations from anon, authenticated;
grant insert (user_id, kind, label, upi_id, account_name, account_number, ifsc, is_default)
  on public.payout_destinations to authenticated;

create or replace function private.keep_destination_with_open_payout()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if exists (
    select 1 from public.payouts p
     where p.destination_id = old.id and p.status in ('requested', 'processing')
  ) then
    raise exception 'A withdrawal to this account is on its way. Remove the account once it has arrived.';
  end if;
  return old;
end;
$fn$;

revoke all on function private.keep_destination_with_open_payout() from public, anon, authenticated;

drop trigger if exists trg_keep_destination_with_open_payout on public.payout_destinations;
create trigger trg_keep_destination_with_open_payout
  before delete on public.payout_destinations
  for each row execute function private.keep_destination_with_open_payout();

-- --------------------------------------------------- F. asking for money --

create or replace function public.request_withdrawal(
  p_amount_minor   bigint,
  p_destination    text default null::text,
  p_destination_id uuid default null
)
returns payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me      uuid := auth.uid();
  v_balance bigint;
  v_min     bigint := private.setting_num('min_withdraw_minor', 10000)::bigint;
  v_max     bigint := private.setting_num('max_withdraw_minor', 10000000)::bigint;
  v_dest    public.payout_destinations;
  v_label   text;
  v_row     public.payouts;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter an amount to withdraw';
  end if;
  if p_amount_minor < v_min then
    raise exception 'The minimum withdrawal is % rupees', (v_min / 100);
  end if;
  if p_amount_minor > v_max then
    raise exception 'The most you can withdraw at once is % rupees', (v_max / 100);
  end if;
  if not exists (select 1 from public.payout_profiles where user_id = v_me) then
    raise exception 'Add your name and PAN before withdrawing'
      using hint = 'payout_profile_missing';
  end if;

  if p_destination_id is not null then
    select * into v_dest from public.payout_destinations where id = p_destination_id and user_id = v_me;
    if not found then
      raise exception 'Choose one of your saved bank accounts or UPI IDs';
    end if;
    if v_dest.kind = 'bank' and coalesce(btrim(v_dest.account_name), '') = '' then
      raise exception 'Add the account holder''s name to this bank account first';
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

  update public.wallets set balance_minor = balance_minor - p_amount_minor, updated_at = now() where user_id = v_me;

  insert into public.payouts (user_id, amount_minor, destination, destination_id, via)
  values (v_me, p_amount_minor, v_label, p_destination_id,
          case when p_destination_id is null then 'manual' else 'razorpayx' end)
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.request_withdrawal(bigint, text, uuid) from public, anon;
grant execute on function public.request_withdrawal(bigint, text, uuid) to authenticated;

-- ------------------------------------------------------------- G. sending --

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

/**
 * What RazorpayX says about a withdrawal, from its webhook or from asking it.
 * Safe in any order and any number of times:
 *
 *   processed                              -> paid (bank reference kept)
 *   failed / rejected / cancelled / reversed -> failed, money back in earnings
 *   reversed after it was paid             -> failed, money back in earnings
 *   queued / pending / scheduled / processing / initiated
 *                                          -> still on its way; status kept
 *                                             for the admin panel
 *
 * A finished withdrawal never changes again, except paid -> reversed.
 */
create or replace function public.record_payout_status(
  p_payout_id   uuid,
  p_provider_id text,
  p_status      text,
  p_utr         text default null,
  p_fee_minor   bigint default null,
  p_tax_minor   bigint default null,
  p_note        text default null
)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_row    public.payouts;
  v_status text := lower(coalesce(p_status, ''));
  v_note   text;
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform settles withdrawals';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then return null; end if;

  -- A withdrawal a person is paying by hand has nothing to do with RazorpayX.
  if v_row.via = 'manual' then return v_row; end if;

  -- One idempotency key per withdrawal means one RazorpayX payout. A second
  -- one is never settled on; a person has to look at it.
  if p_provider_id is not null and v_row.provider_payout_id is not null and v_row.provider_payout_id <> p_provider_id then
    update public.payouts
       set failure_note = left('RazorpayX reported a second payout (' || p_provider_id || ') for this withdrawal. Check both in RazorpayX.', 500),
           updated_at = now()
     where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  if v_row.status in ('failed', 'cancelled') then
    -- Given back as "never sent", yet RazorpayX now reports a live payout for
    -- it. The worker may get paid twice; a person has to look.
    if v_row.provider_payout_id is null and p_provider_id is not null
       and v_status not in ('failed', 'rejected', 'cancelled', 'reversed') then
      update public.payouts
         set provider_payout_id = p_provider_id,
             provider_status = nullif(v_status, ''),
             provider_status_at = now(),
             failure_note = left('Check in RazorpayX: payout ' || p_provider_id || ' (' || coalesce(nullif(v_status, ''), 'unknown')
               || ') exists for this withdrawal, but the money was already given back to the worker.', 500),
             updated_at = now()
       where id = v_row.id
      returning * into v_row;
    end if;
    return v_row;
  end if;

  if v_row.status = 'paid' then
    if v_status <> 'reversed' then
      return v_row;
    end if;
    -- The bank sent it back after it had arrived. RazorpayX credits TaskDrop's
    -- account, so the worker gets it back in earnings.
    v_note := coalesce(nullif(btrim(p_note), ''), 'Your bank sent the money back');
    update public.payouts
       set status = 'failed',
           provider_status = 'reversed',
           provider_status_at = now(),
           reversed_at = now(),
           failure_note = left(v_note, 500),
           updated_at = now()
     where id = v_row.id
    returning * into v_row;
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
     where user_id = v_row.user_id;
    perform private.notify(v_row.user_id, 'payout_failed', 'Your withdrawal came back',
      v_note || '. The money is back in your earnings; check your account details and withdraw again.', null);
    return v_row;
  end if;

  -- Still open: requested or processing.
  update public.payouts
     set provider_payout_id = coalesce(provider_payout_id, p_provider_id),
         sent_at = case when coalesce(provider_payout_id, p_provider_id) is not null then coalesce(sent_at, now()) else sent_at end,
         provider_status = nullif(v_status, ''),
         provider_status_at = now(),
         fee_minor = coalesce(p_fee_minor, fee_minor),
         tax_minor = coalesce(p_tax_minor, tax_minor),
         reference = coalesce(nullif(btrim(p_utr), ''), reference),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if v_status = 'processed' then
    update public.payouts set status = 'paid', failure_note = null, updated_at = now()
     where id = v_row.id
    returning * into v_row;
    perform private.notify(v_row.user_id, 'payout_paid', 'Money sent to your account',
      'Your withdrawal of ' || to_char(v_row.amount_minor / 100.0, 'FM999999990.00') || ' rupees has been sent'
      || coalesce(' (bank reference ' || v_row.reference || ')', '') || '.', null);
  elsif v_status in ('failed', 'rejected', 'cancelled', 'reversed') then
    v_note := coalesce(nullif(btrim(p_note), ''),
      case v_status
        when 'rejected' then 'The withdrawal was rejected'
        when 'cancelled' then 'The withdrawal was cancelled at RazorpayX'
        when 'reversed' then 'Your bank sent the money back'
        else 'The bank could not take the transfer'
      end);
    update public.payouts
       set status = 'failed', failure_note = left(v_note, 500),
           reversed_at = case when v_status = 'reversed' then now() else reversed_at end,
           updated_at = now()
     where id = v_row.id
    returning * into v_row;
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
     where user_id = v_row.user_id;
    perform private.notify(v_row.user_id, 'payout_failed', 'Withdrawal could not be sent',
      v_note || '. The money is back in your earnings; check your account details and try again.', null);
  elsif v_row.status = 'requested' and v_row.provider_payout_id is not null then
    update public.payouts set status = 'processing', updated_at = now() where id = v_row.id
    returning * into v_row;
  end if;

  return v_row;
end;
$fn$;

/**
 * Kept for the functions deployed before this migration. 'paid' and 'failed'
 * now go through record_payout_status, so the rules above apply either way.
 */
create or replace function public.settle_payout(
  p_payout_id uuid,
  p_outcome   text,
  p_reference text default null,
  p_note      text default null
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
  if p_outcome not in ('paid', 'failed') then
    raise exception 'A payout settles as paid or failed';
  end if;

  select * into v_row from public.payouts where id = p_payout_id;
  if not found then return null; end if;

  if p_outcome = 'paid' then
    return public.record_payout_status(p_payout_id, null, 'processed', p_reference, null, null, null);
  end if;
  if v_row.provider_payout_id is null then
    return public.fail_unsent_payout(p_payout_id, p_note);
  end if;
  return public.record_payout_status(p_payout_id, null, 'failed', null, null, null, p_note);
end;
$fn$;

create or replace function public.save_payout_fund_account(p_destination_id uuid, p_contact_id text, p_fund_account_id text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform links payout accounts';
  end if;
  update public.payout_destinations
     set rzp_contact_id = p_contact_id, rzp_fund_account_id = p_fund_account_id
   where id = p_destination_id;
end;
$fn$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.claim_payout_for_sending(uuid)',
    'public.unclaim_payout(uuid, text)',
    'public.record_payout_sent(uuid, text, text)',
    'public.fail_unsent_payout(uuid, text, int, int)',
    'public.record_payout_status(uuid, text, text, text, bigint, bigint, text)',
    'public.settle_payout(uuid, text, text, text)',
    'public.save_payout_fund_account(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------- H. admin --

drop function if exists public.admin_payout_queue();

create or replace function public.admin_payout_queue()
returns table (
  id uuid, user_id uuid, display_name text, amount_minor bigint, status payout_status, snapshot text,
  kind text, upi_id text, account_name text, account_number text, ifsc text, requested_at timestamptz,
  via text, attempts integer, last_attempt_at timestamptz, provider_payout_id text, provider_status text,
  provider_status_at timestamptz, failure_note text, has_pan boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  return query
    select
      o.id, o.user_id, pr.display_name, o.amount_minor, o.status, o.destination,
      d.kind, d.upi_id, d.account_name, d.account_number, d.ifsc, o.created_at,
      o.via, o.attempts, o.last_attempt_at, o.provider_payout_id, o.provider_status,
      o.provider_status_at, o.failure_note,
      exists (select 1 from public.payout_profiles pp where pp.user_id = o.user_id)
    from public.payouts o
    left join public.profiles pr on pr.id = o.user_id
    left join lateral (
      select dd.*
        from public.payout_destinations dd
       where dd.user_id = o.user_id
         and (o.destination_id is null or dd.id = o.destination_id)
       order by (dd.upi_id is not distinct from o.destination) desc,
                dd.is_default desc,
                dd.created_at desc
       limit 1
    ) d on true
    where o.status in ('requested', 'processing')
    order by o.created_at;
end;
$fn$;

revoke all on function public.admin_payout_queue() from public, anon;
grant execute on function public.admin_payout_queue() to authenticated;

create or replace function public.admin_mark_payout(p_payout_id uuid, p_status text, p_note text default null::text)
returns payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_row public.payouts;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('processing', 'paid', 'failed') then
    raise exception 'A payout can be moved to processing, paid or failed';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'That payout no longer exists'; end if;
  if v_row.status in ('paid', 'failed', 'cancelled') then
    raise exception 'That payout is already %', v_row.status;
  end if;
  if v_row.via = 'razorpayx' and v_row.last_attempt_at is not null then
    raise exception 'This withdrawal was sent to RazorpayX, so only RazorpayX can settle it. Use "Check with RazorpayX".';
  end if;

  -- A person has taken it over: RazorpayX must never send it as well.
  update public.payouts
     set via = 'manual',
         status = p_status::public.payout_status,
         failure_note = case when p_status = 'failed' then p_note else failure_note end,
         reference = case when p_status = 'paid' then coalesce(p_note, reference) else reference end,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if p_status = 'failed' then
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
     where user_id = v_row.user_id;
    perform private.notify(v_row.user_id, 'payout_failed', 'Withdrawal could not be sent',
      coalesce(p_note, 'It could not be sent') || '. The money is back in your earnings.', null);
  elsif p_status = 'paid' then
    perform private.notify(v_row.user_id, 'payout_paid', 'Money sent to your account',
      'Your withdrawal of ' || to_char(v_row.amount_minor / 100.0, 'FM999999990.00') || ' rupees has been sent.', null);
  end if;

  return v_row;
end;
$function$;

revoke all on function public.admin_mark_payout(uuid, text, text) from public, anon;
grant execute on function public.admin_mark_payout(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- I. disputes --

create table if not exists public.dispute_decisions (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid not null references public.tasks (id) on delete cascade,
  decided_by            uuid references auth.users (id) on delete set null,
  outcome               text not null check (outcome in ('worker', 'poster')),
  note                  text,
  worker_paid_minor     bigint not null default 0,
  poster_refunded_minor bigint not null default 0,
  created_at            timestamptz not null default now()
);

alter table public.dispute_decisions enable row level security;
drop policy if exists dispute_decisions_admin_read on public.dispute_decisions;
create policy dispute_decisions_admin_read on public.dispute_decisions
  for select to authenticated using (private.is_admin());
revoke all on public.dispute_decisions from anon, authenticated;
grant select on public.dispute_decisions to authenticated;

create or replace function public.admin_resolve_dispute(p_task_id uuid, p_outcome text, p_note text default null::text)
returns tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_task       public.tasks;
  v_assign     public.assignments;
  v_net        bigint := 0;
  v_back       bigint := 0;
  v_clear_days numeric := private.setting_num('clearing_period_days', 0);
begin
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;
  if p_outcome not in ('worker', 'poster') then
    raise exception 'Resolve in favour of the worker or the poster';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'That task no longer exists';
  end if;
  if v_task.status <> 'DISPUTED' then
    raise exception 'That task is not disputed';
  end if;

  select * into v_assign from public.assignments a
   where a.task_id = p_task_id and a.status in ('started', 'assigned')
   order by (a.status = 'started') desc, a.created_at desc
   limit 1;

  if p_outcome = 'worker' then
    if v_task.funded_at is null then
      raise exception 'Nothing was paid for this job, so there is nothing to pay the worker';
    end if;
    if v_assign.id is null then
      raise exception 'No worker on this task to pay';
    end if;

    -- Paid like a finished job; TaskDrop's share is booked by the completion
    -- trigger. With no clearing period the worker's share goes straight to
    -- their earnings here (not through the sweep, which has to guess the
    -- worker); otherwise it waits in clearing for this same worker.
    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - private.setting_num('worker_commission_pct', 0.20)));
    insert into public.wallets (user_id) values (v_assign.worker_id) on conflict (user_id) do nothing;
    update public.assignments set status = 'released' where id = v_assign.id;

    if v_clear_days <= 0 then
      update public.wallets set balance_minor = balance_minor + v_net, updated_at = now()
       where user_id = v_assign.worker_id;
      update public.tasks
         set status = 'COMPLETED', completed_at = now(), clear_at = now(), cleared_at = now(), updated_at = now()
       where id = p_task_id
      returning * into v_task;
    else
      update public.wallets set clearing_minor = clearing_minor + v_net, updated_at = now()
       where user_id = v_assign.worker_id;
      update public.tasks
         set status = 'COMPLETED',
             completed_at = now(),
             clear_at = now() + make_interval(days => v_clear_days::int),
             updated_at = now()
       where id = p_task_id
      returning * into v_task;
    end if;
  else
    -- Everything the poster paid comes back, fee included, the same way as a
    -- cancellation: the cancellations_log row below fires the wallet refund
    -- for jobs paid from the wallet; a job paid by card shows up in Refunds.
    v_back := case
      when v_task.funded_via = 'wallet' and v_task.wallet_refunded_at is null then coalesce(v_task.funded_minor, 0)
      when v_task.funding_payment_id is not null then coalesce((
        select greatest(p.amount_minor - p.refunded_minor, 0) from public.payments p where p.id = v_task.funding_payment_id), 0)
      else 0
    end;

    update public.assignments set status = 'refunded'
     where task_id = p_task_id and status in ('assigned', 'started');

    update public.tasks
       set status = 'CANCELLED', completed_at = now(), updated_at = now()
     where id = p_task_id
    returning * into v_task;

    insert into public.cancellations_log (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
    values (p_task_id, 'poster', 'normal', 'DISPUTED', v_task.locked_minor, 0);
  end if;

  insert into public.dispute_decisions (task_id, decided_by, outcome, note, worker_paid_minor, poster_refunded_minor)
  values (p_task_id, auth.uid(), p_outcome, nullif(btrim(coalesce(p_note, '')), ''), v_net, v_back);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

revoke all on function public.admin_resolve_dispute(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_dispute(uuid, text, text) to authenticated;

-- ------------------------------------------ J. older card-paid jobs --

alter table public.payments
  add column if not exists wallet_credited_minor bigint,
  add column if not exists wallet_credited_at    timestamptz;

comment on column public.payments.wallet_credited_at is
  'An older per-job card payment whose worker walked off: its money was moved to the poster''s wallet (credits) and the job unfunded.';

/**
 * A job paid by card that is open again because the worker walked off. The
 * next hire may cost more, so the old payment must not fund it: what is left
 * of it goes to the poster's wallet (as top-up credits) and the job is paid
 * again when a quote is locked. Safe to run twice.
 */
create or replace function private.move_card_payment_to_wallet(p_task_id uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task   public.tasks;
  v_pay    public.payments;
  v_amount bigint := 0;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found
     or v_task.status <> 'OPEN'
     or v_task.funded_at is null
     or v_task.funding_payment_id is null
     or v_task.funded_via is not distinct from 'wallet' then
    return 0;
  end if;

  select * into v_pay from public.payments where id = v_task.funding_payment_id for update;
  -- A card refund already under way for this payment is left to finish.
  if found and v_pay.wallet_credited_at is null and v_pay.refund_claimed_at is null then
    v_amount := greatest(coalesce(v_pay.amount_minor, 0) - coalesce(v_pay.refunded_minor, 0), 0);
    if v_amount > 0 then
      insert into public.wallets (user_id) values (v_task.poster_id) on conflict (user_id) do nothing;
      update public.wallets set credits_minor = credits_minor + v_amount, updated_at = now()
       where user_id = v_task.poster_id;
      update public.payments set wallet_credited_minor = v_amount, wallet_credited_at = now(), updated_at = now()
       where id = v_pay.id;
      perform private.notify(v_task.poster_id, 'wallet_refund', 'Money back in your wallet',
        'The worker stepped off "' || left(v_task.title, 60) || '". The '
        || to_char(v_amount / 100.0, 'FM999999990.00') || ' rupees you paid is in your wallet for the next person you hire.',
        v_task.id);
    end if;
  end if;

  update public.tasks
     set funded_at = null, funded_via = null, funded_minor = null, funded_credits_minor = 0,
         funding_payment_id = null, wallet_refunded_at = null
   where id = v_task.id;
  return v_amount;
end;
$fn$;
revoke all on function private.move_card_payment_to_wallet(uuid) from public, anon, authenticated;

create or replace function private.refund_wallet_on_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task    public.tasks;
  v_credits bigint;
begin
  select * into v_task from public.tasks where id = new.task_id for update;
  if not found then
    return new;
  end if;

  -- Paid by card (funded_via is 'payment', or empty on jobs paid before 066),
  -- and open again after a walk-off.
  if v_task.funding_payment_id is not null
     and v_task.funded_via is distinct from 'wallet'
     and v_task.status = 'OPEN'
     and v_task.funded_at is not null then
    perform private.move_card_payment_to_wallet(v_task.id);
    return new;
  end if;

  if v_task.funded_via is distinct from 'wallet'
     or v_task.funded_at is null
     or v_task.wallet_refunded_at is not null
     or coalesce(v_task.funded_minor, 0) <= 0 then
    return new;
  end if;

  v_credits := least(coalesce(v_task.funded_credits_minor, 0), v_task.funded_minor);

  update public.wallets
     set credits_minor = credits_minor + v_credits,
         balance_minor = balance_minor + (v_task.funded_minor - v_credits),
         updated_at = now()
   where user_id = v_task.poster_id;

  if v_task.status = 'OPEN' then
    update public.tasks
       set funded_at = null, funded_via = null, funded_minor = null,
           funded_credits_minor = 0, wallet_refunded_at = null
     where id = v_task.id;
  else
    update public.tasks set wallet_refunded_at = now() where id = v_task.id;
  end if;

  perform private.notify(v_task.poster_id, 'wallet_refund',
    'Money back in your wallet',
    'The ' || to_char(v_task.funded_minor / 100.0, 'FM999999990.00') || ' rupees locked for "' || left(v_task.title, 60) || '" is back in your wallet.',
    v_task.id);
  return new;
end;
$fn$;
revoke all on function private.refund_wallet_on_cancel() from public, anon, authenticated;

/**
 * A card payment for a job (the payment webhook calls this). Same as before,
 * except that it marks the job as paid by card, and only pays for a job that
 * is hired and waiting to start. A payment that lands after the worker walked
 * off funds nothing and shows up in Refunds instead.
 */
create or replace function public.fund_task_from_payment(p_payment_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_payment public.payments;
  v_task    public.tasks;
  v_escrow  bigint;
  v_role    text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
begin
  if not (v_role = 'service_role' or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'not authorised';
  end if;
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'That payment does not exist';
  end if;
  if v_payment.status <> 'paid' or v_payment.purpose <> 'escrow' then
    return null;
  end if;
  if v_payment.task_id is null then
    return null;
  end if;
  select * into v_task from public.tasks where id = v_payment.task_id for update;
  if not found then
    return null;
  end if;
  if v_task.poster_id <> v_payment.user_id then
    raise exception 'That payment was not made by the poster of this task';
  end if;
  if v_task.funded_at is not null then
    return v_task;
  end if;
  if v_task.status <> 'LOCKED' then
    return v_task;
  end if;
  if v_payment.wallet_credited_at is not null then
    return v_task;
  end if;
  select a.escrow_minor into v_escrow
    from public.assignments a
   where a.task_id = v_task.id
   order by a.created_at desc
   limit 1;
  if v_escrow is null or v_payment.amount_minor < v_escrow then
    return v_task;
  end if;
  update public.tasks
     set funded_at = now(),
         funded_via = 'payment',
         funding_payment_id = p_payment_id,
         updated_at = now()
   where id = v_task.id
  returning * into v_task;
  return v_task;
end;
$fn$;

-- Jobs paid by card since 063 were left without funded_via.
update public.tasks
   set funded_via = 'payment'
 where funded_at is not null and funded_via is null and funding_payment_id is not null;

-- Jobs paid by card that a worker already walked off before this migration:
-- still marked as paid while open, so the next hire would ride on the old
-- payment. Move it to the poster's wallet now, as a walk-off does from here on.
do $$
declare v_id uuid;
begin
  for v_id in
    select t.id from public.tasks t
     where t.status = 'OPEN' and t.funded_at is not null
       and t.funding_payment_id is not null and t.funded_via is distinct from 'wallet'
  loop
    perform private.move_card_payment_to_wallet(v_id);
  end loop;
end $$;

-- The clearing sweeps pay the worker the job was released to, not whoever
-- was hired last (a job can have an older assignment that was refunded).
create or replace function public.settle_cleared_earnings()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task        record;
  v_worker      uuid;
  v_commission  numeric;
  v_net         bigint;
  v_count       integer := 0;
begin
  v_commission := private.setting_num('worker_commission_pct', 0.20);

  for v_task in
    select t.id, t.locked_minor
      from public.tasks t
     where t.cleared_at is null
       and t.clear_at is not null
       and t.clear_at <= now()
       and t.status in ('COMPLETED', 'AUTO_COMPLETED')
     order by t.clear_at
     for update
  loop
    v_worker := null;
    select a.worker_id into v_worker
      from public.assignments a
     where a.task_id = v_task.id
     order by (a.status = 'released') desc, a.created_at desc
     limit 1;

    if v_worker is not null then
      v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));
      -- Never move more than is actually sitting in clearing.
      update public.wallets w
         set clearing_minor = w.clearing_minor - least(v_net, w.clearing_minor),
             balance_minor  = w.balance_minor  + least(v_net, w.clearing_minor)
       where w.user_id = v_worker;
    end if;

    update public.tasks set cleared_at = now() where id = v_task.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

create or replace function public.settle_my_cleared_earnings()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task       record;
  v_me         uuid := auth.uid();
  v_commission numeric;
  v_net        bigint;
  v_count      integer := 0;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  v_commission := private.setting_num('worker_commission_pct', 0.20);

  for v_task in
    select t.id, t.locked_minor
      from public.tasks t
     where t.cleared_at is null
       and t.clear_at is not null
       and t.clear_at <= now()
       and t.status in ('COMPLETED', 'AUTO_COMPLETED')
       and ( select a.worker_id
               from public.assignments a
              where a.task_id = t.id
              order by (a.status = 'released') desc, a.created_at desc
              limit 1 ) = v_me
     order by t.clear_at
     for update
  loop
    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));

    update public.wallets w
       set clearing_minor = w.clearing_minor - least(v_net, w.clearing_minor),
           balance_minor  = w.balance_minor  + least(v_net, w.clearing_minor)
     where w.user_id = v_me;

    update public.tasks set cleared_at = now() where id = v_task.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

-- A payment moved to the wallet is applied, not waiting to be applied.
create or replace view public.payments_unapplied with (security_invoker = true) as
 select p.id as payment_id,
    p.user_id as poster_id,
    p.task_id,
    t.title,
    t.status as task_status,
    p.amount_minor as paid_minor,
    a.escrow_minor as expected_minor,
    (a.escrow_minor - p.amount_minor) as short_by_minor,
    p.provider_payment_id,
    p.paid_at
   from ((public.payments p
     join public.tasks t on ((t.id = p.task_id)))
     left join lateral ( select aa.escrow_minor
           from public.assignments aa
          where (aa.task_id = t.id)
          order by aa.created_at desc
         limit 1) a on (true))
  where ((p.purpose = 'escrow'::payment_purpose) and (p.status = 'paid'::payment_status) and (t.funded_at is null)
         and p.wallet_credited_at is null and p.refunded_minor < p.amount_minor);

revoke all on public.payments_unapplied from anon, authenticated;
grant select on public.payments_unapplied to service_role;

-- ------------------------------------------------ K. stuck clearing --

update public.tasks
   set clear_at = now()
 where cleared_at is null
   and clear_at > now()
   and status in ('COMPLETED', 'AUTO_COMPLETED')
   and private.setting_num('clearing_period_days', 0) <= 0;

select public.settle_cleared_earnings();

-- ------------------------------------------- L. the Payouts page's figures --

/**
 * What TaskDrop holds for other people, in paise. The Payouts page sets this
 * against the RazorpayX balance: whatever is left over is TaskDrop's own.
 *
 * A withdrawal RazorpayX has already taken out of the balance (processing,
 * initiated) is not counted again; one it is holding back (queued for low
 * balance, pending, scheduled), or one it has not answered for yet, is.
 */
drop function if exists public.admin_money_position();
create or replace function public.admin_money_position()
returns table (
  credits_minor bigint,
  earnings_minor bigint,
  clearing_minor bigint,
  locked_minor bigint,
  in_flight_minor bigint,
  refunds_owed_minor bigint,
  unapplied_minor bigint,
  held_for_people_minor bigint,
  ready_to_withdraw_minor bigint,
  taskdrop_earned_minor bigint
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_credits   bigint;
  v_earnings  bigint;
  v_clearing  bigint;
  v_locked    bigint;
  v_flight    bigint;
  v_refunds   bigint;
  v_unapplied bigint;
  v_earned    bigint;
begin
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  select coalesce(sum(w.credits_minor), 0), coalesce(sum(w.balance_minor), 0), coalesce(sum(w.clearing_minor), 0)
    into v_credits, v_earnings, v_clearing
    from public.wallets w;

  select coalesce(sum(
           case
             when t.funded_via = 'wallet' and t.wallet_refunded_at is null then coalesce(t.funded_minor, 0)
             when t.funded_via is distinct from 'wallet' and t.funding_payment_id is not null then coalesce((
               select greatest(p.amount_minor - p.refunded_minor, 0) from public.payments p where p.id = t.funding_payment_id), 0)
             else 0
           end), 0)
    into v_locked
    from public.tasks t
   where t.funded_at is not null
     and t.status in ('LOCKED', 'TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED', 'DISPUTED');

  select coalesce(sum(o.amount_minor), 0) into v_flight
    from public.payouts o
   where o.status in ('requested', 'processing')
     and not (o.provider_payout_id is not null
              and coalesce(o.provider_status, '') in ('processing', 'initiated', 'processed'));

  select coalesce(sum(r.due_minor), 0)::bigint into v_refunds from public.refunds_outstanding r;
  select coalesce(sum(u.paid_minor), 0)::bigint into v_unapplied from public.payments_unapplied u;

  select coalesce(sum(l.amount_minor), 0) into v_earned from public.platform_ledger l;

  return query select v_credits, v_earnings, v_clearing, v_locked, v_flight, v_refunds, v_unapplied,
    (v_credits + v_earnings + v_clearing + v_locked + v_flight + v_refunds + v_unapplied)::bigint,
    (v_earnings + v_clearing + v_flight)::bigint,
    v_earned;
end;
$fn$;

revoke all on function public.admin_money_position() from public, anon;
grant execute on function public.admin_money_position() to authenticated;
