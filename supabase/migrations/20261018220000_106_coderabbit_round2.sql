-- ===========================================================================
-- Migration 106: fixes from CodeRabbit's review of PR 28
--
--   1. A hidden job stays visible to the worker assigned to it (093 hid it from
--      everyone but the poster and admins, so a worker with money in escrow lost
--      sight of the job; the block rule from 097 already makes this exception).
--   2. get_app_controls() ignores a version with a part too large for an int
--      (6 digits per part at most). Before, a header like 99999999999 made the
--      version comparison raise, the api read that as "no controls", and every
--      switch (maintenance, update required, posting, ...) was skipped for that
--      caller.
--   3. user_sync_apply() refuses a null event (a null slipped past the "unknown
--      event" check and fell into the "deleted" branch, which is final).
--   4. escrow_refund_due() applies the Sales money block only to other people's
--      tasks: a Sales login that is also a poster can still read the refund due
--      on its own cancelled task (099 and 100 say it keeps its own money).
--   5. Completed-job reporting uses completed_at, not the mutable updated_at,
--      in the daily business numbers and in the money check "finished without
--      commission" rule. Every finished job on the test project has the stamp.
--
-- Adds only: functions and one policy are replaced; nothing is dropped.
-- ===========================================================================

-- ---- 1. assigned workers keep sight of a hidden job -------------------------
drop policy if exists tasks_hide_moderated on public.tasks;
create policy tasks_hide_moderated on public.tasks
  as restrictive for select
  using (
    not private.task_is_hidden(id)
    or poster_id = (select auth.uid())
    or private.has_assignment(id, (select auth.uid()))
    or private.is_admin()
  );

-- ---- 2. an overlong version cannot switch the controls off ------------------
create or replace function public.get_app_controls(p_platform text default null, p_version text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_platform text := lower(nullif(btrim(p_platform), ''));
  v_version  text := nullif(btrim(p_version), '');
  v_all      public.app_controls;
  v_plat     public.app_controls;
  v_min      text;
  v_banner   public.app_controls;
begin
  if v_platform is null or v_platform not in ('web', 'android', 'ios') then
    v_platform := null;
  end if;
  -- Each part must fit a Postgres int (version_lt casts to int[]).
  if v_version is not null and v_version !~ '^[0-9]{1,6}(\.[0-9]{1,6}){0,2}$' then
    v_version := null;
  end if;

  select * into v_all from public.app_controls where platform = 'all';
  if v_platform is not null then
    select * into v_plat from public.app_controls where platform = v_platform;
  end if;

  -- The higher of the two minimum versions.
  v_min := case
    when v_all.min_version is null then v_plat.min_version
    when v_plat.min_version is null then v_all.min_version
    when private.version_lt(v_all.min_version, v_plat.min_version) then v_plat.min_version
    else v_all.min_version
  end;

  -- A banner counts while it has text and has not ended; the platform's own wins.
  v_banner := case
    when coalesce(btrim(v_plat.banner_text), '') <> ''
         and (v_plat.banner_ends_at is null or v_plat.banner_ends_at > now()) then v_plat
    when coalesce(btrim(v_all.banner_text), '') <> ''
         and (v_all.banner_ends_at is null or v_all.banner_ends_at > now()) then v_all
    else null
  end;

  return jsonb_build_object(
    'platform',            v_platform,
    'maintenance',         coalesce(v_all.maintenance, false) or coalesce(v_plat.maintenance, false),
    'maintenance_message', case when coalesce(v_plat.maintenance, false)
                                then coalesce(v_plat.maintenance_message, v_all.maintenance_message)
                                else coalesce(v_all.maintenance_message, v_plat.maintenance_message) end,
    'min_version',         v_min,
    'update_required',     v_version is not null and v_min is not null and private.version_lt(v_version, v_min),
    'update_url',          coalesce(v_plat.update_url, v_all.update_url),
    'signups_open',        coalesce(v_all.signups_open, true)    and coalesce(v_plat.signups_open, true),
    'signin_phone',        coalesce(v_all.signin_phone, true)    and coalesce(v_plat.signin_phone, true),
    'signin_google',       coalesce(v_all.signin_google, true)   and coalesce(v_plat.signin_google, true),
    'signin_apple',        coalesce(v_all.signin_apple, true)    and coalesce(v_plat.signin_apple, true),
    'signin_password',     coalesce(v_all.signin_password, true) and coalesce(v_plat.signin_password, true),
    'posting',             coalesce(v_all.posting, true)         and coalesce(v_plat.posting, true),
    'bidding',             coalesce(v_all.bidding, true)         and coalesce(v_plat.bidding, true),
    'topups',              coalesce(v_all.topups, true)          and coalesce(v_plat.topups, true),
    'withdrawals',         coalesce(v_all.withdrawals, true)     and coalesce(v_plat.withdrawals, true),
    'promotions',          coalesce(v_all.promotions, true)      and coalesce(v_plat.promotions, true),
    'chat_photos',         coalesce(v_all.chat_photos, true)     and coalesce(v_plat.chat_photos, true),
    'require_phone_verified', coalesce(v_all.require_phone_verified, false) or coalesce(v_plat.require_phone_verified, false),
    'banner_text',         case when v_banner.platform is null then null else btrim(v_banner.banner_text) end,
    'banner_level',        case when v_banner.platform is null then null else v_banner.banner_level end,
    'banner_link',         case when v_banner.platform is null then null else v_banner.banner_link end
  );
end;
$$;

-- ---- 3. user_sync_apply: a null event is refused ----------------------------
create or replace function public.user_sync_apply(
  p_user uuid, p_event text, p_event_id text default null,
  p_fields text[] default '{}', p_by_admin boolean default null
) returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  c_fields constant text[] := array[
    'display_name', 'username', 'avatar_url', 'bio', 'worker_bio', 'skills', 'languages',
    'intent', 'location', 'payout_upi', 'onboarded', 'worker_onboarded', 'email', 'phone'];
  v_row    public.user_sync;
  v_fields text[];
begin
  perform private.assert_service_caller();
  if p_user is null then raise exception 'No person given'; end if;
  if p_event is null or p_event not in ('signed_up', 'updated', 'deleted') then
    raise exception 'Unknown user event: %', p_event;
  end if;

  v_fields := coalesce((
    select array_agg(distinct f order by f)
      from unnest(coalesce(p_fields, '{}')) f
     where f = any (c_fields)), '{}');

  select * into v_row from public.user_sync where user_id = p_user for update;

  if found and p_event_id is not null and v_row.last_event_id = p_event_id then
    return 'duplicate';
  end if;

  if p_event = 'signed_up' then
    if not found then
      insert into public.user_sync (user_id, state, signed_up_at, last_event_id)
      values (p_user, 'active', now(), p_event_id);
      return 'created';
    elsif v_row.state = 'deleted' then
      return 'ignored';
    elsif v_row.signed_up_at is null then
      update public.user_sync
         set signed_up_at = now(), last_event_id = p_event_id, synced_at = now()
       where user_id = p_user;
      return 'created';
    end if;
    update public.user_sync set last_event_id = p_event_id, synced_at = now() where user_id = p_user;
    return 'known';

  elsif p_event = 'updated' then
    if not found then
      insert into public.user_sync (user_id, state, profile_updates, last_changed, last_updated_at, last_event_id)
      values (p_user, 'active', 1, v_fields, now(), p_event_id);
      return 'updated';
    elsif v_row.state = 'deleted' then
      return 'ignored';
    end if;
    update public.user_sync
       set profile_updates = profile_updates + 1,
           last_changed = v_fields,
           last_updated_at = now(),
           last_event_id = p_event_id,
           synced_at = now()
     where user_id = p_user;
    return 'updated';

  else
    if not found then
      insert into public.user_sync (user_id, state, deleted_at, deleted_by_admin, last_event_id)
      values (p_user, 'deleted', now(), p_by_admin, p_event_id);
      return 'deleted';
    elsif v_row.state = 'deleted' then
      update public.user_sync set last_event_id = p_event_id, synced_at = now() where user_id = p_user;
      return 'known';
    end if;
    update public.user_sync
       set state = 'deleted', deleted_at = now(), deleted_by_admin = p_by_admin,
           last_event_id = p_event_id, synced_at = now()
     where user_id = p_user;
    return 'deleted';
  end if;
end;
$$;

-- ---- 4. escrow_refund_due: the Sales block is for other people's tasks ------
create or replace function public.escrow_refund_due(p_task_id uuid)
returns table (payment_id uuid, provider_payment_id text, due_minor bigint, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_task    public.tasks;
  v_pay     public.payments;
  v_penalty bigint;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;

  if v_task.poster_id <> v_me then
    perform private.assert_not_money_blind();
  end if;
  if v_task.poster_id <> v_me and not private.is_admin() then
    raise exception 'That is not your task';
  end if;

  if v_task.status <> 'CANCELLED' then
    return query select null::uuid, null::text, 0::bigint,
      'This task is not cancelled, so nothing is owed back'::text;
    return;
  end if;

  if v_task.funding_payment_id is null then
    return query select null::uuid, null::text, 0::bigint,
      'No escrow was ever paid for this task'::text;
    return;
  end if;

  select * into v_pay from public.payments where id = v_task.funding_payment_id;
  if not found or v_pay.status <> 'paid' then
    return query select null::uuid, null::text, 0::bigint,
      'The escrow payment never settled'::text;
    return;
  end if;

  select coalesce(sum(penalty_or_refund_minor), 0) into v_penalty
    from public.cancellations_log
   where task_id = p_task_id;

  return query
    select v_pay.id,
           v_pay.provider_payment_id,
           greatest(v_pay.amount_minor - v_pay.refunded_minor - v_penalty, 0)::bigint,
           case
             when v_pay.refunded_minor > 0 then 'Already refunded'
             else 'Cancelled task - escrow returned'
           end::text;
end;
$$;

-- ---- 5. finished jobs are dated by completed_at -----------------------------
create or replace function public.admin_business_daily(p_from date, p_to date)
returns table (day date, new_people bigint, jobs_posted bigint, jobs_finished bigint, cancellations bigint,
               disputes_decided bigint, funded_minor bigint, topup_minor bigint, revenue_minor bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > 400 then raise exception 'At most 400 days at a time'; end if;

  return query
  with d as (select generate_series(p_from, p_to, interval '1 day')::date as dd)
  select d.dd,
    (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Kolkata')::date = d.dd),
    (select count(*) from public.tasks t where (t.created_at at time zone 'Asia/Kolkata')::date = d.dd),
    (select count(*) from public.tasks t where t.status::text in ('COMPLETED', 'AUTO_COMPLETED') and (t.completed_at at time zone 'Asia/Kolkata')::date = d.dd),
    (select count(*) from public.cancellations_log c where (c.created_at at time zone 'Asia/Kolkata')::date = d.dd),
    (select count(*) from public.dispute_decisions x where (x.created_at at time zone 'Asia/Kolkata')::date = d.dd),
    coalesce((select sum(pay.amount_minor) from public.payments pay where pay.status::text = 'paid' and pay.purpose::text = 'escrow' and (pay.paid_at at time zone 'Asia/Kolkata')::date = d.dd), 0)::bigint,
    coalesce((select sum(pay.amount_minor) from public.payments pay where pay.status::text = 'paid' and pay.purpose::text = 'topup' and (pay.paid_at at time zone 'Asia/Kolkata')::date = d.dd), 0)::bigint,
    coalesce((select sum(l.amount_minor) from public.platform_ledger l where (l.created_at at time zone 'Asia/Kolkata')::date = d.dd), 0)::bigint
  from d
  order by d.dd;
end;
$$;

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
  order by 6 desc;
end;
$$;
