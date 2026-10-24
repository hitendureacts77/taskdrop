-- One read rule per table, the new indexes, and the reconcile fix (migrations 122 and 123).
-- Rolls back; leaves nothing.
--
-- A test session runs as postgres, which every admin check lets through, so row visibility cannot
-- be proved here. Before migration 122 was written, the same before/after row counts were taken on
-- the test project for the owner, a stranger and an admin with the shortcut removed (rolled back):
-- identical. What this file keeps true is the shape: one permissive rule per table, role and action,
-- the merged rules still say "own rows or staff", and the staff write rules still guard writes.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/policy_tidy.test.sql

begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_full uuid := gen_random_uuid();
  v_refunded uuid;
  v_unpaid_credit uuid;
  v_n int;
  r record;
begin
  -- 1. No table among the six has two permissive rules answering the same action for the same role.
  for r in
    select c.relname, a.cmd, count(*) as n
      from pg_policy p
      join pg_class c on c.oid = p.polrelid and c.relnamespace = 'public'::regnamespace
      cross join lateral (values ('r'), ('a'), ('w'), ('d')) a(cmd)
     where c.relname in ('app_devices', 'payouts', 'task_promotions', 'wallet_adjustments', 'settings', 'user_roles')
       and p.polpermissive
       and (p.polcmd = a.cmd or p.polcmd = '*')
       and (p.polroles = '{0}' or p.polroles = (select array_agg(oid) from pg_roles where rolname = 'authenticated'))
     group by c.relname, a.cmd
    having count(*) > 1
  loop
    raise exception 'FAIL: % has % permissive rules for action %', r.relname, r.n, r.cmd;
  end loop;

  -- 2. The merged rules exist and the old pairs are gone.
  for r in select * from (values
    ('app_devices', 'app_devices_read'), ('payouts', 'payouts_read'), ('task_promotions', 'promotions_read'),
    ('wallet_adjustments', 'adjustments_read')) as m(t, p)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.t and policyname = r.p) then
      raise exception 'FAIL: % is missing its merged read rule %', r.t, r.p;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.t and policyname = r.p
                    and qual like '%auth.uid()%' and qual like '%is_admin()%') then
      raise exception 'FAIL: % must say "own rows or staff"', r.p;
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and policyname in
      ('app_devices_admin_read', 'app_devices_own_read', 'payouts_admin_reads', 'payouts_select_own',
       'promotions: own reads', 'promotions_admin_reads', 'adjustments: own', 'adjustments: admin reads',
       'settings_admin_write', 'roles_admin_write')) then
    raise exception 'FAIL: an old rule from before migration 122 is still there';
  end if;

  -- 3. Staff write rules still guard insert, update and delete, and nothing else.
  for r in select * from (values ('settings', 'settings_admin'), ('user_roles', 'roles_admin')) as m(t, p) loop
    select count(*) into v_n from pg_policies
     where schemaname = 'public' and tablename = r.t and policyname in (r.p || '_insert', r.p || '_update', r.p || '_delete')
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_admin()%';
    if v_n <> 3 then raise exception 'FAIL: % has % of 3 staff write rules guarded by is_admin()', r.t, v_n; end if;
  end loop;
  if not exists (select 1 from pg_policies where tablename = 'settings' and policyname = 'settings_select_authenticated')
     or not exists (select 1 from pg_policies where tablename = 'user_roles' and policyname = 'roles_select_own_or_admin') then
    raise exception 'FAIL: a read rule that had to stay is gone';
  end if;

  -- 4. The advisor's foreign keys are indexed.
  for r in select * from (values
    ('copyright_notices', 'logged_by'), ('crm_leads', 'created_by'), ('crm_leads', 'user_id'),
    ('crm_owners', 'assigned_by'), ('crm_rules', 'created_by'), ('crm_rules', 'updated_by'),
    ('crm_tasks', 'completed_by'), ('crm_tasks', 'created_by'), ('crm_tasks', 'task_id'),
    ('message_moderation', 'hidden_by'), ('reports', 'handled_by'), ('review_moderation', 'hidden_by'),
    ('task_moderation', 'hidden_by'), ('user_warnings', 'report_id'), ('user_warnings', 'warned_by')) as m(t, col)
  loop
    if not exists (
      select 1 from pg_index i
        join pg_class c on c.oid = i.indrelid and c.relnamespace = 'public'::regnamespace and c.relname = r.t
        join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0] and a.attname = r.col
    ) then
      raise exception 'FAIL: %.% has no index', r.t, r.col;
    end if;
  end loop;

  -- 5. Reconcile: a fully refunded payment is not a mismatch; a paid one with no credit still is.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'tidy+' || v_user || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_user, 'Tidy User') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_user) on conflict (user_id) do nothing;

  insert into public.payments (user_id, purpose, amount_minor, status, paid_at, refunded_minor)
  values (v_user, 'topup', 97850, 'paid', now(), 97850) returning id into v_refunded;
  insert into public.payments (user_id, purpose, amount_minor, status, paid_at, refunded_minor)
  values (v_user, 'topup', 50000, 'paid', now(), 20000) returning id into v_unpaid_credit;

  if exists (select 1 from private.reconcile_rows(current_date - 1, current_date + 1)
              where check_code = 'paid_not_credited' and ref_id = v_refunded) then
    raise exception 'FAIL: a fully refunded payment is flagged paid_not_credited';
  end if;
  if not exists (select 1 from private.reconcile_rows(current_date - 1, current_date + 1)
                  where check_code = 'paid_not_credited' and ref_id = v_unpaid_credit) then
    raise exception 'FAIL: a paid, partly refunded payment with no credit must still be flagged';
  end if;

  raise notice 'policy_tidy: all assertions passed';
end;
$$;

rollback;
