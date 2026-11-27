-- Migration 229: the last two database-side 2.14 holes (H37, H34). Adds only; no table changes.
--
-- H37. The admin website signs a staff member out after 30 idle minutes and 12 hours in all, but the
-- database trusted any admin token until it expired, so a stolen admin token used straight against
-- Supabase skipped both limits. Now private.is_admin() also checks the token's own session
-- (auth.sessions, named by the signed `session_id` claim):
--   * the session must still exist (a signed-out or "ended everywhere" session stops at once);
--   * it must be younger than `admin_session_hours` (default 12), counted from sign-in;
--   * it must have been used (refreshed) within `admin_session_idle_minutes` (default 90). The access
--     token lives an hour, so the database cannot see 30 minutes exactly; 90 is the hour plus the
--     website's 30, and the website's own 30-minute rule still applies in front of it.
-- A token that names no session (a SQL prompt, the service key, a test that sets claims by hand) is
-- judged as before: only a holder of the project's signing key can make such a token, and that key
-- can already make a service-role token. The check runs only for accounts that hold the admin role,
-- so no one else pays for it. An admin's old phone session simply stops counting as admin; the app
-- itself keeps working for them as a normal person.
--
-- H34. Plan B's money_ledger (195) is the add-only record of every money movement. This adds the
-- proof that the books balance: the nightly internal money check (run_reconciliation, 097) now also
-- flags any hold whose ledger does not add up to what was charged:
--   * hold_paid_not_in_ledger: a paid hold whose 'paid' rows differ from charged_minor, or whose
--     worker share is not recorded as 'on_hold' once;
--   * hold_settled_unbalanced: a released, refunded or split hold where released + service fee +
--     commission + refunded + fine paid differs from what was charged.
-- Any row raises the existing "Money check" admin alert.

-- ------------------------------------------------------------------------------------- H37 ---

insert into public.settings (key, value) values
  ('admin_session_hours', to_jsonb(12)),
  ('admin_session_idle_minutes', to_jsonb(90))
on conflict (key) do nothing;

create or replace function private.admin_session_ok()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_claims jsonb;
  v_sid    uuid;
  v_s      record;
  v_hours  integer := greatest(1, least(24, private.setting_num('admin_session_hours', 12)::integer));
  v_idle   integer := greatest(30, least(24 * 60, private.setting_num('admin_session_idle_minutes', 90)::integer));
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return false;
  end;
  if v_claims is null or coalesce(v_claims ->> 'session_id', '') = '' then
    return true;
  end if;
  begin
    v_sid := (v_claims ->> 'session_id')::uuid;
  exception when others then
    return false;
  end;

  select s.created_at, s.updated_at, s.refreshed_at into v_s from auth.sessions s where s.id = v_sid;
  if not found then return false; end if;
  if v_s.created_at < now() - make_interval(hours => v_hours) then return false; end if;
  if greatest(v_s.created_at,
              coalesce(v_s.updated_at, v_s.created_at),
              coalesce(v_s.refreshed_at at time zone 'UTC', v_s.created_at))
     < now() - make_interval(mins => v_idle) then
    return false;
  end if;
  return true;
end;
$fn$;
revoke all on function private.admin_session_ok() from public, anon, authenticated;
comment on function private.admin_session_ok() is
  'H37 (229): an admin token''s session must exist, be under admin_session_hours old and used within admin_session_idle_minutes.';

-- From 040, with the admin branch gated by admin_session_ok(). CASE keeps the session lookup to
-- accounts that hold the admin role.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select
    -- An admin signed into the app or the panel, on a live, young session.
    (case when coalesce(private.has_role(auth.uid(), 'admin'), false)
          then private.admin_session_ok()
          else false end)
    -- The project owner, at a SQL prompt.
    or session_user in ('postgres', 'supabase_admin')
    -- A trusted server-side caller holding the service key.
    or coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
         ''
       ) = 'service_role';
$fn$;

-- ------------------------------------------------------------------------------------- H34 ---

-- From 123, with two Plan B checks added at the end (the first six are unchanged).
create or replace function private.reconcile_rows(p_from date, p_to date)
returns table (check_code text, severity text, ref_type text, ref_id uuid, amount_minor bigint, at timestamptz, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select 'funded_without_paid_payment'::text, 'high'::text, 'task'::text, t.id, t.locked_minor::bigint, t.funded_at,
         ('Job is funded but its payment is ' || coalesce(pay.status::text, 'missing'))::text
    from public.tasks t
    left join public.payments pay on pay.id = t.funding_payment_id
   where t.funded_at is not null and t.funding_payment_id is not null and coalesce(pay.status::text, '') <> 'paid'
     and (t.funded_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'paid_not_credited'::text, 'high'::text, 'payment'::text, pay.id, pay.amount_minor::bigint, pay.paid_at,
         ('Paid ' || pay.purpose::text || ' with no credit recorded')::text
    from public.payments pay
   where pay.status::text = 'paid' and pay.credited_at is null
     and coalesce(pay.refunded_minor, 0) < pay.amount_minor
     and not exists (select 1 from public.tasks t where t.funding_payment_id = pay.id)
     and (pay.paid_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'payment_stuck_created'::text, 'medium'::text, 'payment'::text, pay.id, pay.amount_minor::bigint, pay.created_at,
         'Payment link created and never paid'::text
    from public.payments pay
   where pay.status::text = 'created' and pay.created_at < now() - interval '2 days'
     and (pay.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'payout_waiting_long'::text, 'medium'::text, 'payout'::text, po.id, po.amount_minor::bigint, po.created_at,
         'Withdrawal still waiting'::text
    from public.payouts po
   where po.status::text = 'requested' and po.created_at < now() - interval '3 days'
     and (po.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'payout_paid_no_reference'::text, 'high'::text, 'payout'::text, po.id, po.amount_minor::bigint, po.updated_at,
         'Paid via RazorpayX without a provider reference'::text
    from public.payouts po
   where po.status::text = 'paid' and po.via = 'razorpayx' and po.provider_payout_id is null
     and (po.updated_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'finished_without_commission'::text, 'high'::text, 'task'::text, t.id, null::bigint, t.completed_at,
         'Finished job has no worker commission in the ledger'::text
    from public.tasks t
   where t.status::text in ('COMPLETED', 'AUTO_COMPLETED') and t.funded_at is not null
     and exists (select 1 from public.assignments a where a.task_id = t.id)
     and not exists (select 1 from public.platform_ledger l where l.task_id = t.id and l.kind = 'worker_commission')
     and (t.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  -- H34: a paid hold must show the payment, and the worker's share on hold, exactly once.
  select 'hold_paid_not_in_ledger'::text, 'high'::text, 'hold'::text, h.id, h.charged_minor, h.paid_at,
         ('Paid hold: ledger shows ' || coalesce(l.paid, 0) || ' paid and ' || coalesce(l.on_hold, 0)
          || ' on hold, expected ' || h.charged_minor || ' and ' || h.worker_share_minor)::text
    from public.task_holds h
    left join lateral (
      select sum(m.amount_minor) filter (where m.kind = 'paid') as paid,
             sum(m.amount_minor) filter (where m.kind = 'on_hold') as on_hold
        from public.money_ledger m where m.hold_id = h.id
    ) l on true
   where h.paid_at is not null
     and (coalesce(l.paid, 0) <> h.charged_minor
          or (h.worker_share_minor > 0 and coalesce(l.on_hold, 0) <> h.worker_share_minor))
     and (h.paid_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  -- H34: once settled, every rupee paid has gone somewhere, and no more than that.
  select 'hold_settled_unbalanced'::text, 'high'::text, 'hold'::text, h.id, h.charged_minor, coalesce(h.settled_at, h.updated_at),
         ('Settled hold (' || h.status || '): ' || coalesce(l.out_minor, 0) || ' went out of '
          || h.charged_minor || ' charged (' || coalesce(l.paid, 0) || ' recorded as paid)')::text
    from public.task_holds h
    left join lateral (
      select sum(m.amount_minor) filter (where m.kind = 'paid') as paid,
             sum(m.amount_minor) filter (where m.kind in ('released', 'service_fee', 'commission', 'refunded', 'fine_paid')) as out_minor
        from public.money_ledger m where m.hold_id = h.id
    ) l on true
   where h.status in ('released', 'refunded', 'split')
     and h.paid_at is not null
     and coalesce(l.out_minor, 0) <> h.charged_minor
     and (coalesce(h.settled_at, h.updated_at) at time zone 'Asia/Kolkata')::date between p_from and p_to
  order by 6 desc;
end;
$$;
revoke all on function private.reconcile_rows(date, date) from public, anon, authenticated;
