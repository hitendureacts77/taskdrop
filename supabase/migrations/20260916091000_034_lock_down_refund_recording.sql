-- 034 — close a hole opened by 033.
--
-- Supabase grants EXECUTE on public functions to anon and authenticated by
-- default privilege, so `revoke ... from public` in 033 was not enough: anon
-- still held its own grant on record_escrow_refund.
--
-- Worse, that function's guard was "auth.uid() is null OR caller is admin" —
-- and an anonymous caller has a null auth.uid(). Anyone holding the anon key,
-- which ships in the app bundle, could have written refunds that never
-- happened, and every phantom paise would have blocked a real refund.
--
-- The guard is now positive identification rather than the absence of one.

revoke all on function public.record_escrow_refund(uuid, text, bigint) from anon;
revoke all on function public.escrow_refund_due(uuid) from anon;

create or replace function public.record_escrow_refund(
  p_payment_id   uuid,
  p_ref          text,
  p_amount_minor bigint
)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay  public.payments;
  v_role text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
begin
  -- Either the call carries the service role (the edge function, after
  -- Razorpay accepted the refund), or it is a signed-in admin. Nothing else.
  if not (v_role = 'service_role'
          or private.is_admin()) then
    raise exception 'Only the platform records refunds';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'A refund needs an amount';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'That payment does not exist';
  end if;

  if v_pay.refunded_minor + p_amount_minor > v_pay.amount_minor then
    raise exception 'That would refund more than was paid';
  end if;

  update public.payments
     set refunded_minor = refunded_minor + p_amount_minor,
         refund_ref     = coalesce(p_ref, refund_ref),
         refunded_at    = now(),
         updated_at     = now()
   where id = p_payment_id
  returning * into v_pay;

  return v_pay;
end;
$$;

revoke all on function public.record_escrow_refund(uuid, text, bigint) from public;
revoke all on function public.record_escrow_refund(uuid, text, bigint) from anon;
revoke all on function public.record_escrow_refund(uuid, text, bigint) from authenticated;
grant execute on function public.record_escrow_refund(uuid, text, bigint) to service_role;
