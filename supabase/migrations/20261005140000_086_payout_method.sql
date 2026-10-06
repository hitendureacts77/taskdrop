-- 086 -- One switch for how withdrawals are paid: 'manual' (an admin pays each
-- one from their own UPI app or bank) or 'razorpayx' (RazorpayX sends it).
--
--   * settings.payout_method, default 'manual'. Changing it needs the admin's
--     authenticator code, like every other setting (migration 080).
--   * New withdrawals are stamped with whichever method is on when they are asked
--     for (payouts.via), so a switch never re-routes money already in motion.
--   * admin_set_payout_method(): flips the switch. Going to 'razorpayx' also moves
--     withdrawals that are still only "requested" (nobody has started paying them)
--     over to RazorpayX, so the backlog goes out too.

insert into public.settings (key, value) values ('payout_method', '"manual"'::jsonb)
on conflict (key) do nothing;

create or replace function private.stamp_payout_method()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_method text;
begin
  select trim(both '"' from value::text) into v_method from public.settings where key = 'payout_method';
  new.via := case when v_method = 'razorpayx' then 'razorpayx' else 'manual' end;
  return new;
end;
$fn$;
revoke all on function private.stamp_payout_method() from public, anon, authenticated;

drop trigger if exists stamp_payout_method on public.payouts;
create trigger stamp_payout_method
  before insert on public.payouts
  for each row execute function private.stamp_payout_method();

create or replace function public.admin_set_payout_method(p_method text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_method not in ('manual', 'razorpayx') then
    raise exception 'The payout method is manual or razorpayx';
  end if;

  insert into public.settings (key, value) values ('payout_method', to_jsonb(p_method))
  on conflict (key) do update set value = excluded.value;

  if p_method = 'razorpayx' then
    update public.payouts
       set via = 'razorpayx', updated_at = now()
     where status = 'requested' and via = 'manual' and last_attempt_at is null;
  end if;

  return p_method;
end;
$fn$;

revoke all on function public.admin_set_payout_method(text) from public, anon;
grant execute on function public.admin_set_payout_method(text) to authenticated;
