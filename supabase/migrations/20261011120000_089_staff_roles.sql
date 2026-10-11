-- 089 — Staff roles for admins, and staff alerts.
--
-- Until now every admin could do everything. This adds a staff role on top of
-- the existing 'admin' role in user_roles (which still decides who is staff at
-- all, and what they can READ -- private.is_admin() is unchanged):
--
--   admin    everything (the default: an admin with no admin_staff row)
--   finance  money: payouts, wallet changes, dispute decisions
--   support  people: help requests, CRM notes/tags/segments/messages,
--            suspensions, copyright notices
--   viewer   read-only
--
-- Settings, admin access, staff roles and deleting someone else's account stay
-- with full admins.
--
-- Enforced in the database by a trigger on every table those actions write,
-- the same way migration 080 enforces the authenticator code, so it holds
-- whichever client calls the RPC. The admin panel checks first to show a plain
-- message, and is the only check for refunds and RazorpayX (edge functions,
-- which the database sees as the service role).
--
-- Not gated: the service role and operator (webhooks, cron, SQL editor),
-- ordinary users, and an admin acting as a person on their own account.
--
-- admin_staff.notify: staff alerts (an in-app notification and push) when a
-- withdrawal is requested, a dispute is opened (admin, finance) or a help
-- request comes in (admin, support). On by default.
--
-- Only adds: a table, functions and triggers. Nothing is dropped or renamed.

create table if not exists public.admin_staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  staff_role text not null default 'admin' check (staff_role in ('admin', 'finance', 'support', 'viewer')),
  notify     boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table public.admin_staff is
  'Staff role and alert preference for people holding the admin role (migration 089). No row = full admin, alerts on.';

alter table public.admin_staff enable row level security;
drop policy if exists admin_staff_admin_read on public.admin_staff;
create policy admin_staff_admin_read on public.admin_staff
  for select to authenticated using (private.is_admin());
-- No write policies: writes go through admin_set_staff().
revoke all on public.admin_staff from anon;
revoke insert, update, delete on public.admin_staff from authenticated;

-- The staff role of an admin; null for anyone who is not an admin.
create or replace function private.staff_role(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user is null or not coalesce(private.has_role(p_user, 'admin'), false) then null
    else coalesce((select s.staff_role from public.admin_staff s where s.user_id = p_user), 'admin')
  end;
$$;
revoke all on function private.staff_role(uuid) from public, anon, authenticated;

-- What each staff role may change. Areas: money, people, admin.
create or replace function private.staff_can(p_user uuid, p_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.staff_role(p_user)
    when 'admin'   then true
    when 'finance' then p_area = 'money'
    when 'support' then p_area = 'people'
    else false
  end;
$$;
revoke all on function private.staff_can(uuid, text) from public, anon, authenticated;

create or replace function private.require_staff_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_area   text := tg_argv[0];
  v_row    jsonb := to_jsonb(coalesce(new, old));
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_role   text;
  v_mfa    boolean;
begin
  if v_actor is null or coalesce(v_claims ->> 'role', '') = 'service_role' then
    return coalesce(new, old);
  end if;
  v_role := private.staff_role(v_actor);
  if v_role is null then
    return coalesce(new, old); -- not an admin: RLS and the RPCs decide, as before
  end if;

  -- An admin is also a person, acting on their own account.
  if tg_table_name = 'payouts' and (v_row ->> 'user_id')::uuid = v_actor
     and (tg_op = 'INSERT'
          or (tg_op = 'UPDATE' and v_row ->> 'status' = 'cancelled' and v_old ->> 'status' = 'requested')) then
    return coalesce(new, old);
  end if;
  if tg_table_name in ('wallet_adjustments', 'support_tickets', 'account_deletions')
     and (v_row ->> 'user_id')::uuid = v_actor then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'user_roles' and (v_row ->> 'user_id')::uuid = v_actor and v_row ->> 'role' <> 'admin' then
    return coalesce(new, old); -- becoming a poster or worker
  end if;
  if tg_table_name = 'support_messages' and not coalesce((v_row ->> 'from_staff')::boolean, false) then
    return coalesce(new, old); -- writing on their own help request
  end if;
  -- Anyone on staff may switch their own alerts on or off (their role stays
  -- what it is; admin_set_staff upserts, so this can arrive as an INSERT).
  if tg_table_name = 'admin_staff' and tg_op <> 'DELETE' and (v_row ->> 'user_id')::uuid = v_actor
     and v_row ->> 'staff_role' = v_role then
    return new;
  end if;

  if not private.staff_can(v_actor, v_area) then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', v_role
      using errcode = '42501';
  end if;

  -- Changing someone's staff role is a change of power: it needs the
  -- authenticator code too, like granting admin (migration 080).
  if tg_table_name = 'admin_staff' then
    select s.value = 'true'::jsonb into v_mfa from public.settings s where s.key = 'admin_require_mfa';
    if coalesce(v_mfa, true) and coalesce(v_claims ->> 'aal', '') <> 'aal2' then
      raise exception 'Verify your authenticator code first (Security page in the admin panel)'
        using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.require_staff_permission() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('payouts', 'money'), ('wallet_adjustments', 'money'), ('dispute_decisions', 'money'),
      ('user_suspensions', 'people'), ('crm_notes', 'people'), ('crm_tags', 'people'),
      ('crm_user_tags', 'people'), ('crm_segments', 'people'), ('crm_broadcasts', 'people'),
      ('copyright_notices', 'people'), ('support_tickets', 'people'), ('support_messages', 'people'),
      ('settings', 'admin'), ('user_roles', 'admin'), ('admin_staff', 'admin'), ('account_deletions', 'admin')
    ) as t(tbl, area)
  loop
    if to_regclass('public.' || r.tbl) is null then
      continue; -- a feature whose migration isn't applied here
    end if;
    execute format('drop trigger if exists require_staff_permission on public.%I', r.tbl);
    execute format('create trigger require_staff_permission before insert or update or delete on public.%I
                    for each row execute function private.require_staff_permission(%L)', r.tbl, r.area);
  end loop;
end;
$$;

-- Audit staff role changes like every other change of power.
drop trigger if exists audit_admin_staff on public.admin_staff;
create trigger audit_admin_staff after insert or update or delete on public.admin_staff
  for each row execute function private.audit_change();

-- Losing admin access clears the staff row, so adding them back starts fresh.
create or replace function private.clear_staff_on_admin_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' then
    delete from public.admin_staff where user_id = old.user_id;
  end if;
  return old;
end;
$$;
revoke all on function private.clear_staff_on_admin_removed() from public, anon, authenticated;
drop trigger if exists clear_staff_on_admin_removed on public.user_roles;
create trigger clear_staff_on_admin_removed after delete on public.user_roles
  for each row execute function private.clear_staff_on_admin_removed();

-- Set someone's staff role and alerts. They may be given a role before they
-- are made admin (the panel does that, so a new Viewer is never briefly a full
-- admin); the row only counts while they hold the admin role.
create or replace function public.admin_set_staff(p_user_id uuid, p_role text, p_notify boolean default null)
returns text
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_current text;
  v_full    int;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_role not in ('admin', 'finance', 'support', 'viewer') then
    raise exception 'Unknown staff role %', p_role;
  end if;
  v_current := coalesce((select staff_role from public.admin_staff where user_id = p_user_id), 'admin');

  if p_user_id = auth.uid() and p_role <> v_current then
    raise exception 'You cannot change your own staff role';
  end if;

  -- Never leave TaskDrop without a full admin.
  if v_current = 'admin' and p_role <> 'admin' and private.has_role(p_user_id, 'admin') then
    select count(*) into v_full
      from public.user_roles ur
      left join public.admin_staff s on s.user_id = ur.user_id
     where ur.role = 'admin' and coalesce(s.staff_role, 'admin') = 'admin';
    if v_full <= 1 then
      raise exception 'This is the last full admin; make someone else a full admin first';
    end if;
  end if;

  insert into public.admin_staff (user_id, staff_role, notify, updated_at, updated_by)
  values (p_user_id, p_role, coalesce(p_notify, true), now(), auth.uid())
  on conflict (user_id) do update
    set staff_role = excluded.staff_role,
        notify     = coalesce(p_notify, public.admin_staff.notify),
        updated_at = now(),
        updated_by = auth.uid();
  return p_role;
end;
$fn$;
revoke all on function public.admin_set_staff(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_staff(uuid, text, boolean) to authenticated;

-- ------------------------------------------------------------ staff alerts --

create or replace function private.notify_staff(p_area text, p_title text, p_body text, p_except uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select ur.user_id
      from public.user_roles ur
      left join public.admin_staff s on s.user_id = ur.user_id
     where ur.role = 'admin'
       and coalesce(s.notify, true)
       and ur.user_id is distinct from p_except
       and (coalesce(s.staff_role, 'admin') = 'admin'
            or (p_area = 'money' and s.staff_role = 'finance')
            or (p_area = 'people' and s.staff_role = 'support'))
  loop
    perform private.notify(r.user_id, 'staff_alert', p_title, p_body, null, null);
  end loop;
exception when others then
  null; -- an alert must never stop the action that caused it
end;
$$;
revoke all on function private.notify_staff(text, text, text, uuid) from public, anon, authenticated;

create or replace function private.staff_alert_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text = 'requested' then
    perform private.notify_staff('money', 'Withdrawal request',
      format('₹%s from %s. Open the admin panel to pay it.',
             to_char(new.amount_minor / 100.0, 'FM99,99,99,990.00'),
             coalesce((select p.display_name from public.profiles p where p.id = new.user_id), 'someone')),
      new.user_id);
  end if;
  return new;
exception when others then
  return new;
end;
$$;

create or replace function private.staff_alert_dispute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text = 'DISPUTED' and old.status::text is distinct from 'DISPUTED' then
    perform private.notify_staff('money', 'Dispute opened',
      format('“%s” needs a decision. Open the admin panel.', left(coalesce(new.title, 'A job'), 80)), null);
  end if;
  return new;
exception when others then
  return new;
end;
$$;

create or replace function private.staff_alert_support()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_staff('people', 'New help request',
    format('%s. Open the admin panel to reply.', left(coalesce(nullif(new.subject, ''), 'Someone needs help'), 80)),
    new.user_id);
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function private.staff_alert_payout() from public, anon, authenticated;
revoke all on function private.staff_alert_dispute() from public, anon, authenticated;
revoke all on function private.staff_alert_support() from public, anon, authenticated;

drop trigger if exists staff_alert_payout on public.payouts;
create trigger staff_alert_payout after insert on public.payouts
  for each row execute function private.staff_alert_payout();
drop trigger if exists staff_alert_dispute on public.tasks;
create trigger staff_alert_dispute after update of status on public.tasks
  for each row execute function private.staff_alert_dispute();
drop trigger if exists staff_alert_support on public.support_tickets;
create trigger staff_alert_support after insert on public.support_tickets
  for each row execute function private.staff_alert_support();
