-- 042 — fund_task_from_payment's guard never fired, and a short payment
-- disappeared silently.
--
-- The guard read:
--
--   if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
--      and current_user <> 'service_role'
--      and current_user <> 'postgres' then raise exception ...
--
-- Inside a SECURITY DEFINER function current_user IS the owner, postgres. So
-- the last condition was always false, the AND chain was always false, and the
-- exception was never raised. It also read request.jwt.claim.role (singular),
-- which PostgREST stopped setting — the modern form is the request.jwt.claims
-- JSON object.
--
-- Nothing was exploitable: EXECUTE is granted to neither anon nor authenticated,
-- so only the service role and the owner could reach it anyway. But a guard that
-- cannot fire is worse than no guard, because it reads like protection.
create or replace function public.fund_task_from_payment(p_payment_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_payment public.payments;
  v_task    public.tasks;
  v_escrow  bigint;
  v_role    text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
begin
  -- Positive identification: the service role, or the owner at a SQL prompt.
  -- session_user is not rewritten by SECURITY DEFINER; current_user is.
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

  select a.escrow_minor into v_escrow
    from public.assignments a
   where a.task_id = v_task.id
   order by a.created_at desc
   limit 1;

  -- Under the agreed escrow, or no quote locked yet. Still refuses to fund —
  -- starting work on short money is the thing this exists to prevent — but the
  -- payment now shows up in payments_unapplied instead of vanishing quietly.
  if v_escrow is null or v_payment.amount_minor < v_escrow then
    return v_task;
  end if;

  update public.tasks
     set funded_at = now(),
         funding_payment_id = p_payment_id,
         updated_at = now()
   where id = v_task.id
  returning * into v_task;

  return v_task;
end;
$$;

revoke all on function public.fund_task_from_payment(uuid) from public, anon, authenticated;
grant execute on function public.fund_task_from_payment(uuid) to service_role;

-- Money that arrived and did not land.
--
-- A settled escrow payment whose task is still unfunded means someone paid and
-- the job cannot start. Before this, that state existed only as the absence of
-- a timestamp — nothing listed it, and the payer was told escrow was held.
create or replace view public.payments_unapplied as
  select p.id            as payment_id,
         p.user_id       as poster_id,
         p.task_id,
         t.title,
         t.status        as task_status,
         p.amount_minor  as paid_minor,
         a.escrow_minor  as expected_minor,
         (a.escrow_minor - p.amount_minor) as short_by_minor,
         p.provider_payment_id,
         p.paid_at
    from public.payments p
    join public.tasks t on t.id = p.task_id
    left join lateral (
      select aa.escrow_minor
        from public.assignments aa
       where aa.task_id = t.id
       order by aa.created_at desc
       limit 1
    ) a on true
   where p.purpose = 'escrow'
     and p.status = 'paid'
     and t.funded_at is null;

comment on view public.payments_unapplied is
  'Escrow payments that settled but did not fund their task. Should always be empty.';

revoke all on public.payments_unapplied from anon, authenticated;
alter view public.payments_unapplied set (security_invoker = true);
