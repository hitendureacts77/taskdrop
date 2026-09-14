-- Where money is received.
--
-- There was one text column, profiles.payout_upi, edited in place on the
-- withdraw screen. One destination, no bank option, no way to keep a second
-- one, and changing it silently rewrote where every future payout would go
-- with no record of what it used to be.
create table if not exists public.payout_destinations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('upi', 'bank')),
  label       text,
  upi_id      text,
  account_name   text,
  account_number text,
  ifsc           text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),

  -- Each kind carries its own fields and nothing else. Without this a "bank"
  -- row could be saved with only a UPI id and fail at payout time, which is the
  -- worst moment to discover it.
  constraint payout_destination_shape check (
    (kind = 'upi'  and upi_id is not null
                   and account_number is null and ifsc is null)
    or
    (kind = 'bank' and account_number is not null and ifsc is not null
                   and account_name is not null and upi_id is null)
  ),
  constraint payout_upi_format check (
    upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,32}$'
  ),
  -- Indian IFSC: four letters, a zero, then six alphanumerics.
  constraint payout_ifsc_format check (
    ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'
  ),
  constraint payout_account_format check (
    account_number is null or account_number ~ '^[0-9]{6,18}$'
  )
);

create index if not exists payout_destinations_user_idx
  on public.payout_destinations (user_id, created_at desc);

-- At most one default each. A second default would make "where does my money
-- go" ambiguous at exactly the wrong moment.
create unique index if not exists payout_destinations_one_default_idx
  on public.payout_destinations (user_id)
  where is_default;

alter table public.payout_destinations enable row level security;

drop policy if exists "destinations: own" on public.payout_destinations;
create policy "destinations: own"
  on public.payout_destinations for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "destinations: add own" on public.payout_destinations;
create policy "destinations: add own"
  on public.payout_destinations for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "destinations: remove own" on public.payout_destinations;
create policy "destinations: remove own"
  on public.payout_destinations for delete to authenticated
  using (user_id = (select auth.uid()));

-- is_default is moved through this function rather than by direct update, so
-- the "only one default" rule is applied as one step instead of a client
-- having to clear the old one first and hope nothing fails in between.
create or replace function public.set_default_payout_destination(p_destination_id uuid)
returns public.payout_destinations
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me  uuid := auth.uid();
  v_row public.payout_destinations;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into v_row from public.payout_destinations
   where id = p_destination_id and user_id = v_me;
  if not found then raise exception 'That payout account is not yours'; end if;

  update public.payout_destinations set is_default = false
   where user_id = v_me and is_default;

  update public.payout_destinations set is_default = true
   where id = p_destination_id
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.set_default_payout_destination(uuid) from public, anon;
grant execute on function public.set_default_payout_destination(uuid) to authenticated;

-- Carry the single UPI id people already have across, so nobody has to retype
-- what they already told us.
insert into public.payout_destinations (user_id, kind, upi_id, label, is_default)
select p.id, 'upi', p.payout_upi, 'UPI', true
  from public.profiles p
 where p.payout_upi is not null
   and not exists (
     select 1 from public.payout_destinations d where d.user_id = p.id
   );
