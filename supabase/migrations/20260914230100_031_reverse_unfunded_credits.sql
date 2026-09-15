-- Take back the money that was never collected.
--
-- Before the funding gate existed, confirm_release credited workers for tasks
-- whose escrow was never paid. Those credits were still sitting in wallets as
-- clearing balance: 5,680 and 880 rupees across two accounts. Left alone they
-- would have cleared, become withdrawable, and been paid out of the operator's
-- own pocket for work no poster ever funded.
--
-- The amount is computed from the tasks themselves rather than inferred from a
-- difference, and never exceeds what the wallet holds. Every change is written
-- to wallet_adjustments first, with the before-values, so it can be explained
-- and reversed.
do $$
declare
  r record;
  v_take bigint;
begin
  for r in
    with phantom as (
      select a.worker_id as user_id,
             sum(round(t.locked_minor
                 * (1 - private.setting_num('worker_commission_pct', 0.20))))::bigint as minor
        from public.assignments a
        join public.tasks t on t.id = a.task_id
       where t.status in ('COMPLETED', 'AUTO_COMPLETED')
         and t.funded_at is null
         and a.status = 'released'
       group by a.worker_id
    )
    select ph.user_id, ph.minor, w.balance_minor, w.clearing_minor
      from phantom ph
      join public.wallets w on w.user_id = ph.user_id
     where ph.minor > 0
  loop
    -- Never claw back more than is actually there. If some was already
    -- withdrawn, that money is gone and this is not the place to chase it.
    v_take := least(r.minor, r.balance_minor + r.clearing_minor);
    continue when v_take <= 0;

    insert into public.wallet_adjustments
      (user_id, delta_minor, balance_before, clearing_before, reason)
    values
      (r.user_id, -v_take, r.balance_minor, r.clearing_minor,
       'Reversing credit for tasks completed before the funding gate, where escrow was never paid.');

    -- Out of clearing first: it is the unwithdrawable part, so taking it back
    -- cannot strand a withdrawal someone has already requested.
    update public.wallets
       set clearing_minor = greatest(0, clearing_minor - v_take),
           balance_minor  = balance_minor - greatest(0, v_take - clearing_minor)
     where user_id = r.user_id;
  end loop;
end;
$$;

-- Those tasks should also stop claiming to be completed work. They were never
-- paid for, so CANCELLED is what they actually are.
update public.tasks
   set status = 'CANCELLED', updated_at = now()
 where status in ('COMPLETED', 'AUTO_COMPLETED')
   and funded_at is null;
