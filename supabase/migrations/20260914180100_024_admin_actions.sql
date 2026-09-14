-- Being an admin did nothing.
--
-- There was exactly one admin-only function in the database -- platform_stats,
-- which reads. No admin could pay a withdrawal, settle a dispute, or grant
-- anyone else access. Meanwhile request_withdrawal took money out of a wallet
-- and left the payout at 'requested' with no path onward, and open_dispute
-- froze a task with no path out. Both were dead ends that only raw SQL could
-- clear.
--
-- Every function here re-checks private.is_admin() itself. The GRANT is to
-- `authenticated`, because PostgREST cannot express "only some of them" -- the
-- check inside is what actually holds the door.
--
-- Bodies below are the deployed definitions.

-- Move a payout along, or fail it and give the money back.
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

-- Settle a disputed task one way or the other.
--   'worker' -> the work stands: release as a normal completion would.
--   'poster' -> refund the escrow to the poster and cancel the task.
-- Deliberately the only way escrow moves on a disputed task, and deliberately
-- not something either party can do to themselves.
create or replace function public.admin_resolve_dispute(
  p_task_id uuid, p_outcome text, p_note text default null
) returns public.tasks
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare
  v_task public.tasks; v_worker uuid; v_escrow bigint;
  v_commission numeric; v_clear_days numeric; v_net bigint;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_outcome not in ('worker','poster') then
    raise exception 'Resolve in favour of the worker or the poster';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'That task no longer exists'; end if;
  if v_task.status <> 'DISPUTED' then raise exception 'That task is not disputed'; end if;

  select a.worker_id, a.escrow_minor into v_worker, v_escrow
    from public.assignments a where a.task_id = p_task_id
   order by a.created_at desc limit 1;

  if p_outcome = 'worker' then
    if v_worker is null then raise exception 'No worker on this task to pay'; end if;
    v_commission := private.setting_num('worker_commission_pct', 0.20);
    v_clear_days := private.setting_num('clearing_period_days', 7);
    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));

    update public.wallets set clearing_minor = clearing_minor + v_net where user_id = v_worker;
    update public.assignments set status = 'released'
     where task_id = p_task_id and worker_id = v_worker;
    update public.tasks
       set status = 'COMPLETED', completed_at = now(),
           clear_at = now() + make_interval(days => v_clear_days::int), updated_at = now()
     where id = p_task_id returning * into v_task;
  else
    -- The poster gets the escrow back as spendable balance.
    if coalesce(v_escrow, 0) > 0 then
      update public.wallets set balance_minor = balance_minor + v_escrow
       where user_id = v_task.poster_id;
    end if;
    update public.assignments set status = 'cancelled' where task_id = p_task_id;
    update public.tasks set status = 'CANCELLED', updated_at = now()
     where id = p_task_id returning * into v_task;
  end if;

  insert into public.cancellations_log (task_id, cancelled_by, reason)
  values (p_task_id, auth.uid(),
          'dispute resolved for the ' || p_outcome || coalesce(' - ' || p_note, ''))
  on conflict do nothing;

  return v_task;
end;
$fn$;

-- Grant or remove admin. The only way in besides raw SQL.
create or replace function public.admin_set_admin(p_user_id uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  -- Removing your own access locks the owner out of their own product.
  if p_user_id = auth.uid() and not p_on then
    raise exception 'You cannot remove your own admin access';
  end if;

  if p_on then
    insert into public.user_roles (user_id, role) values (p_user_id, 'admin')
    on conflict do nothing;
  else
    delete from public.user_roles where user_id = p_user_id and role = 'admin';
  end if;

  return p_on;
end;
$fn$;

revoke all on function public.admin_mark_payout(uuid, text, text) from public, anon;
revoke all on function public.admin_resolve_dispute(uuid, text, text) from public, anon;
revoke all on function public.admin_set_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_mark_payout(uuid, text, text) to authenticated;
grant execute on function public.admin_resolve_dispute(uuid, text, text) to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;

-- An admin who cannot see the payout queue cannot work it. payouts was
-- select-own-only, so the person responsible for sending the money was the one
-- person who could not list what was owed.
drop policy if exists "payouts_admin_reads" on public.payouts;
create policy "payouts_admin_reads"
  on public.payouts for select to authenticated using (private.is_admin());

drop policy if exists "promotions_admin_reads" on public.task_promotions;
create policy "promotions_admin_reads"
  on public.task_promotions for select to authenticated using (private.is_admin());
