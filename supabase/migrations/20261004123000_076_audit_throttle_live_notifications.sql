-- 076 — Audit log, ad-impression throttle, live notifications, advisor fixes.
--
-- Audit findings F-09, F-10, S-01 and the performance advisors
-- (docs/audit/SECURITY_FINDINGS.md, docs/audit/SYNC_MATRIX.md).

-- ============================================================ F-10 audit log
-- Who changed what, when, from what to what. Written by a trigger, so an admin
-- RPC cannot change money, roles, settings or a suspension without leaving a row
-- -- and nobody has to remember to add an INSERT to the next admin function.
-- Append-only: no client privileges at all, and a trigger refuses UPDATE/DELETE
-- from every role including the owner.

create table if not exists public.admin_audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor        uuid,
  actor_kind   text not null check (actor_kind in ('admin', 'service', 'operator')),
  action       text not null,
  target_table text not null,
  target_id    text,
  before       jsonb,
  after        jsonb,
  detail       text
);
create index if not exists admin_audit_log_at_idx    on public.admin_audit_log (at desc);
create index if not exists admin_audit_log_actor_idx on public.admin_audit_log (actor, at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_table, target_id);

alter table public.admin_audit_log enable row level security;
drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
create policy admin_audit_log_admin_read on public.admin_audit_log
  for select to authenticated using (private.is_admin());
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;

create or replace function private.audit_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The audit log is append-only' using errcode = '42501';
end;
$$;
drop trigger if exists admin_audit_log_immutable on public.admin_audit_log;
create trigger admin_audit_log_immutable
  before update or delete on public.admin_audit_log
  for each row execute function private.audit_immutable();

create or replace function private.audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_kind   text;
  v_before jsonb;
  v_after  jsonb;
  v_row    jsonb;
begin
  if v_actor is not null and coalesce(private.has_role(v_actor, 'admin'), false) then
    v_kind := 'admin';
  elsif coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then
    v_kind := 'service';
  elsif v_actor is null and session_user in ('postgres', 'supabase_admin') then
    v_kind := 'operator';
  else
    return coalesce(new, old);          -- an ordinary user acting on their own rows
  end if;

  v_row := to_jsonb(coalesce(new, old));
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, n.value), jsonb_object_agg(n.key, to_jsonb(old) -> n.key)
      into v_after, v_before
      from jsonb_each(to_jsonb(new)) n
     where n.key <> 'updated_at' and (to_jsonb(old) -> n.key) is distinct from n.value;
    if v_after is null then
      return new;                       -- nothing meaningful changed
    end if;
  elsif tg_op = 'INSERT' then
    v_after := v_row;
  else
    v_before := v_row;
  end if;

  insert into public.admin_audit_log (actor, actor_kind, action, target_table, target_id, before, after)
  values (v_actor, v_kind, tg_op || ' ' || tg_table_name, tg_table_name,
          coalesce(v_row ->> 'id', v_row ->> 'key', v_row ->> 'user_id'), v_before, v_after);
  return coalesce(new, old);
end;
$$;
revoke all on function private.audit_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['payouts', 'wallet_adjustments', 'user_suspensions', 'user_roles',
                           'dispute_decisions', 'settings', 'crm_broadcasts']
  loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function private.audit_change()', t);
  end loop;
end;
$$;

-- For actions that are not a row change (a CSV export, say).
create or replace function public.admin_log_event(p_action text, p_target text default null, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;
  insert into public.admin_audit_log (actor, actor_kind, action, target_table, target_id, detail)
  values (auth.uid(), 'admin', left(coalesce(p_action, 'event'), 80), 'event', left(p_target, 200), left(p_detail, 500));
end;
$$;
revoke all on function public.admin_log_event(text, text, text) from public, anon;
grant execute on function public.admin_log_event(text, text, text) to authenticated;

-- =================================================== F-09 ad-impression throttle
-- Any signed-in user could call record_ad_impression() in a loop and bill a
-- rival's daily budget to zero (or an owner could view their own ad). One
-- billable impression per viewer per promotion per 30 minutes, none for the
-- advertiser's own views, and a daily ceiling per viewer.
create index if not exists ad_events_viewer_promo_idx
  on public.ad_events (viewer_id, promotion_id, kind, created_at desc);

create or replace function public.record_ad_impression(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_row  record;
  v_cost bigint;
begin
  if v_me is null then
    return;
  end if;

  select * into v_row from public.ad_auction() a where a.task_id = p_task_id;
  if not found then
    return; -- not sponsored right now, or out of budget: nothing to bill
  end if;

  if exists (select 1 from public.task_promotions p
              where p.id = v_row.promotion_id and p.user_id = v_me) then
    return; -- an advertiser is never billed for their own views
  end if;

  if exists (select 1 from public.ad_events e
              where e.viewer_id = v_me and e.promotion_id = v_row.promotion_id
                and e.kind = 'impression' and e.created_at > now() - interval '30 minutes') then
    return; -- already counted for this viewer
  end if;

  if (select count(*) from public.ad_events e
       where e.viewer_id = v_me and e.kind = 'impression'
         and e.created_at > now() - interval '1 day') >= 300 then
    return; -- one account cannot generate unlimited billable views
  end if;

  v_cost := greatest(
    round(v_row.charge_minor::numeric / private.setting_num('ad_cpm_divisor', 1000))::bigint,
    private.setting_num('ad_min_charge_minor', 1)::bigint
  );
  v_cost := least(v_cost, v_row.daily_budget_minor - v_row.spent_today_minor);
  if v_cost <= 0 then
    return;
  end if;

  insert into public.ad_events (promotion_id, task_id, viewer_id, kind, cost_minor)
  values (v_row.promotion_id, p_task_id, v_me, 'impression', v_cost);
end;
$$;

-- ================================================= S-01 live notifications
-- The app subscribes to INSERTs on notifications filtered to the signed-in user
-- (data/extras.ts), but the table was not in the realtime publication, so the
-- subscription never fired. RLS (notifications_select_own) still decides who
-- receives which row.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- Admin effects that reached the user's data but never told them.
create or replace function private.notify_wallet_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.notify(
    new.user_id, 'wallet',
    case when new.delta_minor >= 0 then 'Money was added to your wallet' else 'Your wallet balance was adjusted' end,
    format('Your balance changed by ₹%s. Open your wallet for the details.', to_char(abs(new.delta_minor) / 100.0, 'FM999,999,990.00'))
  );
  return new;
end;
$$;
revoke all on function private.notify_wallet_adjustment() from public, anon, authenticated;
drop trigger if exists wallet_adjustments_notify on public.wallet_adjustments;
create trigger wallet_adjustments_notify
  after insert on public.wallet_adjustments
  for each row execute function private.notify_wallet_adjustment();

create or replace function private.notify_ticket_resolved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved'
     and auth.uid() is distinct from new.user_id then   -- not when they closed it themselves
    perform private.notify(new.user_id, 'support', 'Your help request was resolved',
      'Open it to read the reply or tell us if it is not sorted.', null, new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.notify_ticket_resolved() from public, anon, authenticated;
drop trigger if exists support_tickets_notify_resolved on public.support_tickets;
create trigger support_tickets_notify_resolved
  after update of status on public.support_tickets
  for each row execute function private.notify_ticket_resolved();

-- ===================================================== performance advisors
create index if not exists crm_broadcasts_sent_by_idx     on public.crm_broadcasts (sent_by);
create index if not exists crm_broadcasts_to_user_idx     on public.crm_broadcasts (to_user);
create index if not exists crm_notes_author_id_idx        on public.crm_notes (author_id);
create index if not exists crm_segments_created_by_idx    on public.crm_segments (created_by);
create index if not exists crm_user_tags_added_by_idx     on public.crm_user_tags (added_by);
create index if not exists dispute_decisions_decided_by_idx on public.dispute_decisions (decided_by);
create index if not exists dispute_decisions_task_id_idx  on public.dispute_decisions (task_id);
create index if not exists payouts_destination_id_idx     on public.payouts (destination_id);
create index if not exists task_disputes_opened_by_idx    on public.task_disputes (opened_by);
create index if not exists user_suspensions_lifted_by_idx on public.user_suspensions (lifted_by);
create index if not exists user_suspensions_suspended_by_idx on public.user_suspensions (suspended_by);

-- auth.uid() was re-evaluated per row.
drop policy if exists task_disputes_read on public.task_disputes;
create policy task_disputes_read on public.task_disputes
  for select to authenticated
  using (
    private.is_admin()
    or opened_by = (select auth.uid())
    or exists (select 1 from public.tasks t
                where t.id = task_disputes.task_id and t.poster_id = (select auth.uid()))
    or exists (select 1 from public.assignments a
                where a.task_id = task_disputes.task_id and a.worker_id = (select auth.uid()))
  );
