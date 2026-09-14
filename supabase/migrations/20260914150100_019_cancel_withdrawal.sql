-- Take back a withdrawal that has not been picked up yet.
--
-- The exact inverse of request_withdrawal: that one moves money out of the
-- wallet and opens a payout, this one closes the payout and puts the money
-- back. Everything that matters here is about not doing it twice.
--
-- The payout row is locked FOR UPDATE and its status re-checked *after* the
-- lock. Without that, two taps on Cancel -- or a tap racing an operator marking
-- it paid -- could both read 'requested' and both refund, minting money out of
-- a double-click. With the lock the second one finds 'cancelled' and is told so.
create or replace function public.cancel_withdrawal(p_payout_id uuid)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.payouts;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_row
    from public.payouts
   where id = p_payout_id
   for update;

  if not found then
    raise exception 'That withdrawal no longer exists';
  end if;

  -- Never trust the caller's claim about whose payout this is.
  if v_row.user_id <> v_me then
    raise exception 'That is not your withdrawal';
  end if;

  if v_row.status = 'cancelled' then
    raise exception 'That withdrawal was already cancelled';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'That withdrawal is already being sent and can no longer be cancelled';
  end if;

  update public.payouts
     set status = 'cancelled',
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  update public.wallets
     set balance_minor = balance_minor + v_row.amount_minor
   where user_id = v_me;

  return v_row;
end;
$$;

revoke all on function public.cancel_withdrawal(uuid) from public;
revoke all on function public.cancel_withdrawal(uuid) from anon;
grant execute on function public.cancel_withdrawal(uuid) to authenticated;

comment on function public.cancel_withdrawal(uuid) is
  'Cancels a still-requested payout and returns the money to the wallet. Owner only, single-use, locked against double refunds.';
