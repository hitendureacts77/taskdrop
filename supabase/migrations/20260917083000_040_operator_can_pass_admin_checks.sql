-- 040_operator_can_pass_admin_checks
--
-- The only way a worker gets paid was unreachable.
--
-- admin_mark_payout, admin_resolve_dispute and admin_set_admin each open with
-- `if not private.is_admin() then raise exception 'Admins only'`. is_admin was
-- has_role(auth.uid(), 'admin') and nothing else. auth.uid() is null unless the
-- call arrives with an end user's JWT -- so in the Supabase SQL Editor, which
-- docs/RUNNING_THE_BUSINESS.md tells the owner to use, it is null, has_role
-- matches no row, and every one of those functions refuses:
--
--   select current_user, auth.uid(), private.is_admin();
--   -> postgres, null, false
--
-- The owner console was removed from the app on purpose, which left the SQL
-- Editor as the only route in. That route did not work. A withdrawal could be
-- requested -- the money leaves the wallet immediately -- and then nothing in
-- the product could move it to 'paid'.
--
-- Two callers are added, both of which can already do anything they like:
--
--   * session_user = postgres/supabase_admin -- the SQL Editor and psql as the
--     project owner. It owns these functions and can UPDATE the tables under
--     them directly.
--   * a service_role JWT -- the server-side key, which has BYPASSRLS. Anything
--     holding it can already write payouts and wallets by hand.
--
-- So this grants no privilege that was not already held; it routes those two
-- through the audited function instead of raw UPDATEs that would debit a wallet
-- without the paired refund. `session_user` is deliberate: SECURITY DEFINER
-- rewrites current_user to the owner (postgres), which would make the check
-- true for every caller. session_user is not rewritten -- PostgREST connects as
-- `authenticator`, never as postgres.
--
-- End users are unaffected: an anon or authenticated JWT carries role 'anon' or
-- 'authenticated', so the only way they pass is still holding the admin role.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select
    -- An admin signed into the app.
    coalesce(private.has_role(auth.uid(), 'admin'), false)
    -- The project owner, at a SQL prompt.
    or session_user in ('postgres', 'supabase_admin')
    -- A trusted server-side caller holding the service key.
    or coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
         ''
       ) = 'service_role';
$fn$;

grant execute on function private.is_admin() to anon, authenticated, service_role;

comment on function private.is_admin() is
  'True for an admin-roled user, the project owner at a SQL prompt, or a service_role caller. The latter two can already write these tables directly; this lets them use the audited functions instead.';

-- Reconciliation needs the bank's reference, not just a status.
--
-- A payout marked 'paid' recorded who and how much and nothing about the actual
-- transfer, so matching the queue against a bank statement meant matching on
-- amount and hoping two workers had not withdrawn the same figure on the same
-- day. admin_mark_payout already took p_note and threw it away unless the
-- payout failed.
alter table public.payouts
  add column if not exists reference text;

comment on column public.payouts.reference is
  'The UPI/IMPS reference of the transfer that settled this payout, written when it is marked paid.';

create or replace function public.admin_mark_payout(
  p_payout_id uuid, p_status text, p_note text default null
) returns public.payouts
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v_row public.payouts;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('processing','paid','failed') then
    raise exception 'A payout can be moved to processing, paid or failed';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'That payout no longer exists'; end if;
  -- Settled is settled. Re-marking a paid payout as failed would refund money
  -- that has already left the building.
  if v_row.status in ('paid','failed','cancelled') then
    raise exception 'That payout is already %', v_row.status;
  end if;

  update public.payouts
     set status = p_status::public.payout_status,
         failure_note = case when p_status = 'failed' then p_note else failure_note end,
         -- Same argument, different meaning either side of the outcome: why it
         -- bounced, or the reference proving it did not.
         reference = case when p_status = 'paid' then coalesce(p_note, reference) else reference end,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  -- A failed transfer means the bank would not take it. The money never left,
  -- so it goes back to where it came from.
  if p_status = 'failed' then
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor
     where user_id = v_row.user_id;
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.admin_mark_payout(uuid, text, text) from public, anon;
grant execute on function public.admin_mark_payout(uuid, text, text) to authenticated;

-- The queue, with everything needed to actually send the money.
--
-- payouts.destination is a snapshot of how the destination *read on screen* at
-- request time, and describeDestination() masks a bank account down to its last
-- four digits. That is right for the worker's own history and useless to the
-- person making the transfer. The live row in payout_destinations has the full
-- account number and IFSC, so it is joined back in here.
--
-- Admin-guarded rather than RLS'd, because it deliberately returns other
-- people's bank details.
create or replace function public.admin_payout_queue()
returns table (
  id             uuid,
  user_id        uuid,
  display_name   text,
  amount_minor   bigint,
  status         public.payout_status,
  snapshot       text,
  kind           text,
  upi_id         text,
  account_name   text,
  account_number text,
  ifsc           text,
  requested_at   timestamptz
)
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select
    o.id,
    o.user_id,
    pr.display_name,
    o.amount_minor,
    o.status,
    o.destination,
    d.kind,
    d.upi_id,
    d.account_name,
    d.account_number,
    d.ifsc,
    o.created_at
  from public.payouts o
  left join public.profiles pr on pr.id = o.user_id
  -- Their default account, falling back to whichever one the snapshot names.
  left join lateral (
    select dd.*
      from public.payout_destinations dd
     where dd.user_id = o.user_id
     order by (dd.upi_id is not distinct from o.destination) desc,
              dd.is_default desc,
              dd.created_at desc
     limit 1
  ) d on true
  where private.is_admin()
    and o.status in ('requested', 'processing')
  order by o.created_at;
$fn$;

revoke all on function public.admin_payout_queue() from public, anon;
grant execute on function public.admin_payout_queue() to authenticated, service_role;

comment on function public.admin_payout_queue() is
  'Every payout still owed, with the full destination details needed to send it. Admins only -- it returns other users bank accounts.';
