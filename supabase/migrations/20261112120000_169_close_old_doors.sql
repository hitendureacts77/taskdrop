-- 169: two old doors closed.
--
-- B57 (Medium) public.fund_task(task, payment) (027) marks a card-paid job funded with no status
--     or refund checks and without funded_via / funded_minor. Nothing calls it any more (the
--     razorpay functions use fund_task_from_payment; 047 listed it as a candidate for removal),
--     yet every signed-in person could still call it through the data API. Execute is taken
--     away from app users; the function itself stays (migrations only add).
-- B62 (Low-Medium) The hosted project has trg_keep_destination_with_open_payout on
--     public.payout_destinations disabled, though 066 created it enabled: a worker could remove
--     a payout account while a withdrawal to it is on its way. It is switched back on.

do $$
begin
  if to_regprocedure('public.fund_task(uuid, uuid)') is not null then
    revoke all on function public.fund_task(uuid, uuid) from public, anon, authenticated;
    grant execute on function public.fund_task(uuid, uuid) to service_role;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.payout_destinations'::regclass
                and tgname = 'trg_keep_destination_with_open_payout'
                and not tgisinternal) then
    alter table public.payout_destinations enable trigger trg_keep_destination_with_open_payout;
  end if;
end $$;
