-- Every role against every door (plan task 2.18 part B).
--
-- Callers: signed out, person A, person B, and one login for each staff role (admin, finance, support, sales,
-- viewer). The tables are read from the catalog, so a new table in `public` is covered with no change here.
--
--   1. Catalog rules for every table: row rules on, the signed-out role holds nothing, no client role holds
--      TRUNCATE / REFERENCES / TRIGGER, no write policy is open to everyone, and only profiles, reviews and settings
--      are readable by every signed-in person.
--   2. One seeded row per table for a ghost, person B and person A (columns found from the catalog). Then for
--      signed out, A and B: what is visible that belongs to someone else (must be nothing, except the four tables
--      that are public on purpose), and that delete, update and insert of the other person's rows change nothing.
--   3. An explicit table of who may read what, for the sensitive tables, for every caller.
--   4. Every admin_* and crm_* function refuses a plain person and the signed-out role, and has a staff check
--      in its own source.
--   5. The staff role limits (people, money, admin areas) and: no role can raise itself or anyone else.
--
-- Staff roles are tested here, on the throwaway database, with made-up logins; no hosted account is involved.
--
-- private.is_admin() is true for any session whose session_user is postgres (migration 040), which is what psql is,
-- so every "ordinary person" would silently be an admin. As in column_lockdown.test.sql it is replaced for this
-- transaction by the real rule PostgREST callers get (the admin role in user_roles). Rolled back at the end.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/role_doors.test.sql

begin;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = 'public' as
$$ select coalesce(private.has_role(auth.uid(), 'admin'), false) $$;

create or replace function pg_temp.become(p_user uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- null when the statement ran; otherwise the error message.
create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- The column that says whose row it is: a uuid column from the list, in this order (profiles: its own id).
create or replace function pg_temp.owner_col(p_table text) returns text
language plpgsql as $$
declare
  v_cands text[] := array['user_id', 'owner_id', 'owner', 'poster_id', 'worker_id', 'sender_id', 'author_id',
                          'reporter_id', 'blocker_id', 'referrer_id', 'created_by', 'opened_by'];
  v_col text;
begin
  if p_table = 'profiles' then return 'id'; end if;
  select a.attname::text into v_col
    from pg_attribute a
   where a.attrelid = format('public.%I', p_table)::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.atttypid = 'uuid'::regtype
     and a.attname::text = any (v_cands)
   order by array_position(v_cands, a.attname::text)
   limit 1;
  return v_col;
end;
$$;

-- Rows owned by p_user (the whole table when it has no owner column). Run as the owner.
create or replace function pg_temp.owned_count(p_table text, p_user uuid) returns bigint
language plpgsql as $$
declare
  v_oc text := pg_temp.owner_col(p_table);
  v bigint;
begin
  if p_table = 'task_private' then   -- no owner column: it belongs to the task's poster
    select count(*) into v from public.task_private tp
     where exists (select 1 from public.tasks t where t.id = tp.task_id and t.poster_id = p_user);
    return v;
  end if;
  if v_oc is null then
    execute format('select count(*) from public.%I', p_table) into v;
  else
    execute format('select count(*) from public.%I where %I = $1', p_table, v_oc) into v using p_user;
  end if;
  return v;
end;
$$;

-- What the current role can see that is NOT its own: rows whose owner column is someone else (the whole table when
-- it has no owner column). -1 when the role has no right to read the table at all. A row on a task the caller is the
-- poster of, or has an assignment on, is the caller's business (a chat has two sides), so it is not counted here; the
-- stranger check below, who has no rows at all, is what proves such rows reach nobody else.
create or replace function pg_temp.foreign_visible(p_table text, p_caller uuid) returns bigint
language plpgsql as $$
declare
  v_oc text := pg_temp.owner_col(p_table);
  v_party text := '';
  v bigint;
begin
  if exists (select 1 from pg_attribute a
              where a.attrelid = format('public.%I', p_table)::regclass
                and a.attname = 'task_id' and a.attnum > 0 and not a.attisdropped) then
    v_party := ' and not exists (select 1 from public.tasks t where t.id = x.task_id and t.poster_id = $1)'
            || ' and not exists (select 1 from public.assignments s where s.task_id = x.task_id and s.worker_id = $1)';
  end if;
  if p_table = 'task_private' then
    select count(*) into v from public.task_private tp
     where not exists (select 1 from public.tasks t where t.id = tp.task_id and t.poster_id = p_caller);
    return v;
  end if;
  if v_oc is null then
    execute format('select count(*) from public.%I x where true', p_table) || v_party into v using p_caller;
  else
    execute format('select count(*) from public.%I x where x.%I is distinct from $1', p_table, v_oc) || v_party into v using p_caller;
  end if;
  return v;
exception when others then
  return -1;
end;
$$;

-- Insert one row for p_owner, built from the catalog: every NOT NULL column without a default gets a value of its
-- type; a foreign key takes a row of the parent that belongs to the ghost; another person column takes the ghost.
-- Runs as whoever is current: as the owner it seeds, as a caller it is an attempt. p_strict: an existing row for
-- p_owner does not count as success. Returns true when a row is there afterwards (non-strict) or was inserted.
create or replace function pg_temp.seed_row(p_table text, p_owner uuid, p_ghost uuid, p_strict boolean default false) returns boolean
language plpgsql as $$
declare
  v_rel regclass := format('public.%I', p_table)::regclass;
  v_oc text := pg_temp.owner_col(p_table);
  c record;
  v_ref record;
  v_oc2 text;
  v_pick text;
  v_val text;
  v_cols text := '';
  v_vals text := '';
  v_n bigint := 0;
  v_sql text;
begin
  for c in
    select a.attnum, a.attname::text as name, a.atttypid, a.attnotnull, a.atthasdef,
           format_type(a.atttypid, a.atttypmod) as ftype,
           t.typcategory::text as cat, t.typname::text as tname, t.typtype::text as ttype
      from pg_attribute a join pg_type t on t.oid = a.atttypid
     where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity = ''
     order by a.attnum
  loop
    v_val := null;
    v_pick := null;
    if v_oc is not null and c.name = v_oc then
      v_val := p_owner::text;
    elsif c.attnotnull and not c.atthasdef then
      v_ref := null;
      select fk.confrelid::regclass::text as reft, rc.attname::text as refcol into v_ref
        from pg_constraint fk
        join pg_attribute rc on rc.attrelid = fk.confrelid and rc.attnum = fk.confkey[1]
       where fk.conrelid = v_rel and fk.contype = 'f'
         and array_length(fk.conkey, 1) = 1 and fk.conkey[1] = c.attnum
       limit 1;
      if v_ref.reft is not null then
        if v_ref.reft in ('auth.users', 'profiles', 'public.profiles') then
          v_pick := p_ghost::text;
        else
          v_oc2 := case when v_ref.reft like '%.%' and v_ref.reft not like 'public.%' then null
                        else pg_temp.owner_col(replace(v_ref.reft, 'public.', '')) end;
          if v_oc2 is not null then
            execute format('select %I::text from %s where %I = $1 limit 1', v_ref.refcol, v_ref.reft, v_oc2)
              into v_pick using p_ghost;
          end if;
          if v_pick is null then
            execute format('select %I::text from %s limit 1', v_ref.refcol, v_ref.reft) into v_pick;
          end if;
        end if;
      end if;
      v_val := coalesce(v_pick, case
        when c.tname = 'uuid' then gen_random_uuid()::text
        when c.ttype = 'e' then (select e.enumlabel::text from pg_enum e where e.enumtypid = c.atttypid order by e.enumsortorder limit 1)
        when c.tname in ('jsonb', 'json') then '{}'
        when c.cat = 'A' then '{}'
        when c.cat = 'B' then 'false'
        when c.cat = 'N' then '1'
        when c.cat = 'D' then case when c.tname = 'date' then '2026-01-01' else '2026-01-01 00:00:00+00' end
        when c.cat = 'T' then '1 hour'
        when c.cat = 'I' then '127.0.0.1'
        when c.cat = 'S' then 'x'
        when c.tname = 'bytea' then '\x00'
        else null end);
      if v_val is null then return false; end if;
    else
      continue;
    end if;
    v_cols := v_cols || case when v_cols = '' then '' else ', ' end || quote_ident(c.name);
    v_vals := v_vals || case when v_vals = '' then '' else ', ' end || format('%L::%s', v_val, c.ftype);
  end loop;

  if v_cols = '' then
    v_sql := format('insert into public.%I default values on conflict do nothing', p_table);
  else
    v_sql := format('insert into public.%I (%s) values (%s) on conflict do nothing', p_table, v_cols, v_vals);
  end if;
  execute v_sql;
  get diagnostics v_n = row_count;
  if v_n = 0 and not p_strict and v_oc is not null then
    execute format('select count(*) from public.%I where %I = $1', p_table, v_oc) into v_n using p_owner;
  end if;
  return v_n > 0;
exception when others then
  return false;
end;
$$;

-- Delete / update of the victim's rows as the current role: how many rows it changed, or -1 when refused.
create or replace function pg_temp.try_delete(p_table text, p_victim uuid) returns bigint
language plpgsql as $$
declare
  v_oc text := pg_temp.owner_col(p_table);
  n bigint;
begin
  if v_oc is null then return -2; end if;
  execute format('delete from public.%I where %I = $1', p_table, v_oc) using p_victim;
  get diagnostics n = row_count;
  return n;
exception when others then
  return -1;
end;
$$;

create or replace function pg_temp.try_update(p_table text, p_victim uuid) returns bigint
language plpgsql as $$
declare
  v_oc text := pg_temp.owner_col(p_table);
  n bigint;
begin
  if v_oc is null then return -2; end if;
  execute format('update public.%I set %I = %I where %I = $1', p_table, v_oc, v_oc, v_oc) using p_victim;
  get diagnostics n = row_count;
  return n;
exception when others then
  return -1;
end;
$$;

-- The call for one function with every argument null, as typed nulls.
create or replace function pg_temp.null_call(p_oid oid) returns text
language plpgsql as $$
declare
  r record;
  v_args text := '';
begin
  select p.proname::text as name, p.pronargs into r from pg_proc p where p.oid = p_oid;
  for i in 0 .. r.pronargs - 1 loop
    v_args := v_args || case when i = 0 then '' else ', ' end
      || format('null::%s', (select format_type(p.proargtypes[i], null) from pg_proc p where p.oid = p_oid));
  end loop;
  return format('select * from public.%I(%s)', r.name, v_args);
end;
$$;

-- ============================================================================
-- 1. Catalog rules for every table
-- ============================================================================
do $do$
declare
  r record;
  v_bad text;
  v_open_read text[] := array['profiles', 'reviews', 'settings'];  -- readable by every signed-in person, on purpose
begin
  -- row rules on everywhere
  select string_agg(c.relname::text, ', ' order by c.relname::text) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'FAIL: tables without row rules (RLS): %', v_bad;
  end if;

  -- the signed-out role holds nothing, at table or column level
  select string_agg(c.relname::text, ', ' order by c.relname::text) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'));
  if v_bad is not null then
    raise exception 'FAIL: the signed-out role holds rights on: %', v_bad;
  end if;

  -- signed-in people never hold the rights row rules cannot cover
  select string_agg(c.relname::text, ', ' order by c.relname::text) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and has_table_privilege('authenticated', c.oid, 'TRUNCATE,REFERENCES,TRIGGER');
  if v_bad is not null then
    raise exception 'FAIL: signed-in people hold TRUNCATE, REFERENCES or TRIGGER on: %', v_bad;
  end if;

  -- no permissive write policy that lets everyone in
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname) into v_bad
    from pg_policies p
   where p.schemaname = 'public' and p.permissive = 'PERMISSIVE'
     and p.roles && array['public', 'anon', 'authenticated']::name[]
     and ((p.cmd = 'INSERT' and (p.with_check is null or p.with_check = 'true'))
       or (p.cmd in ('UPDATE', 'DELETE') and (p.qual is null or p.qual = 'true'))
       or (p.cmd = 'ALL' and (p.qual is null or p.qual = 'true')));
  if v_bad is not null then
    raise exception 'FAIL: write policies open to everyone: %', v_bad;
  end if;

  -- only the named tables may be read by every signed-in person
  select string_agg(p.tablename || '.' || p.policyname, ', ' order by p.tablename, p.policyname) into v_bad
    from pg_policies p
   where p.schemaname = 'public' and p.permissive = 'PERMISSIVE'
     and p.roles && array['public', 'anon', 'authenticated']::name[]
     and p.cmd in ('SELECT', 'ALL') and (p.qual is null or p.qual = 'true')
     and not (p.tablename = any (v_open_read));
  if v_bad is not null then
    raise exception 'FAIL: tables readable by every signed-in person that are not on the list (profiles, reviews, settings): %', v_bad;
  end if;

  raise notice 'role_doors 1/5: catalog rules hold for % tables',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p'));
end;
$do$;

-- ============================================================================
-- 2 and 3. People, seeds, the generic doors and the explicit table
-- ============================================================================
do $do$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_ghost uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_sales uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_task uuid;
  v_u uuid;
  v_t text;
  v_tables text[];
  v_unseeded text[] := '{}';
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_n bigint;
  v_i int;
  v_pass int;
  v_victim uuid;
  v_caller uuid;
  v_label text;
  v_labels text[];
  v_ids uuid[];
  v_kinds text[];
  v_col text;
  v_want text;
  v_seen text := '';
  v_stranger uuid := gen_random_uuid();  -- has no rows anywhere
  v_allowed text[] := array['profiles', 'tasks', 'reviews', 'settings'];  -- readable by others on purpose
  r record;
  -- who may read OTHER people's rows (or, for tables with no owner, any row): none = nothing, some = at least one.
  -- person = A, B (signed out is always none); staff = admin, finance, support, viewer; sales.
  v_expect constant jsonb := '{
    "wallets":             {"person": "none", "staff": "some", "sales": "none"},
    "wallet_adjustments":  {"person": "none", "staff": "some", "sales": "none"},
    "payouts":             {"person": "none", "staff": "some", "sales": "none"},
    "payout_destinations": {"person": "none", "staff": "none", "sales": "none"},
    "payout_profiles":     {"person": "none", "staff": "some", "sales": "none"},
    "task_private":        {"person": "none", "staff": "some", "sales": "some"},
    "profile_private":     {"person": "none", "staff": "none", "sales": "none"},
    "age_checks":          {"person": "none", "staff": "none", "sales": "none"},
    "user_roles":          {"person": "none", "staff": "some", "sales": "some"},
    "admin_staff":         {"person": "none", "staff": "some", "sales": "none"},
    "settings":            {"person": "some", "staff": "some", "sales": "some"},
    "app_controls":        {"person": "none", "staff": "some", "sales": "none"},
    "auth_codes":          {"person": "none", "staff": "none", "sales": "none"},
    "auth_send_log":       {"person": "none", "staff": "none", "sales": "none"},
    "push_tokens":         {"person": "none", "staff": "none", "sales": "none"},
    "platform_ledger":     {"person": "none", "staff": "some", "sales": "none"},
    "admin_audit_log":     {"person": "none", "staff": "some", "sales": "none"},
    "admin_alerts":        {"person": "none", "staff": "some", "sales": "none"},
    "admin_live_events":   {"person": "none", "staff": "some", "sales": "some"}
  }'::jsonb;
begin
  -- ---- people ----------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'roledoors+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_a), (v_b), (v_ghost), (v_admin), (v_finance), (v_support), (v_sales), (v_viewer)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_a, 'Door A'), (v_b, 'Door B'), (v_ghost, 'Door Ghost'), (v_admin, 'Door Admin'),
         (v_finance, 'Door Finance'), (v_support, 'Door Support'), (v_sales, 'Door Sales'), (v_viewer, 'Door Viewer')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'poster'::app_role from unnest(array[v_a, v_b, v_ghost]) u
  on conflict do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'worker'::app_role from unnest(array[v_a, v_b, v_ghost]) u
  on conflict do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin'::app_role from unnest(array[v_admin, v_finance, v_support, v_sales, v_viewer]) u
  on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role)
  values (v_finance, 'finance'), (v_support, 'support'), (v_sales, 'sales'), (v_viewer, 'viewer')
  on conflict (user_id) do update set staff_role = excluded.staff_role;

  -- ---- hand-made rows for the sensitive tables: ghost, B and A ----------------
  foreach v_u in array array[v_ghost, v_b, v_a] loop
    insert into public.wallets (user_id, balance_minor) values (v_u, 5000)
      on conflict (user_id) do update set balance_minor = excluded.balance_minor;
    insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason)
      values (v_u, 100, 4900, 0, 'role doors fixture');
    insert into public.payouts (user_id, amount_minor, status, destination)
      values (v_u, 1000, 'requested', 'roledoor@upi');
    insert into public.payout_destinations (user_id, kind, upi_id)
      values (v_u, 'upi', 'roledoor@okaxis');
    insert into public.payout_profiles (user_id, legal_name, pan)
      values (v_u, 'Role Door Person', 'ABCDE1234F')
      on conflict (user_id) do nothing;
    insert into public.profile_private (user_id, loc_lat, loc_lng)
      values (v_u, 12.9, 77.6)
      on conflict (user_id) do update set loc_lat = excluded.loc_lat;
    insert into public.age_checks (user_id, birth_date, passed, min_age)
      values (v_u, '1990-01-01', true, 18)
      on conflict (user_id) do update set passed = true;
    insert into public.push_tokens (token, user_id) values ('roledoor-' || v_u, v_u);
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
      values (v_u, 'services', 'role doors task', 10000, 60) returning id into v_task;
    insert into public.task_private (task_id, loc_lat, loc_lng, address)
      values (v_task, 12.9, 77.6, 'Role Door Building, 1 Test Road')
      on conflict (task_id) do update set address = excluded.address;
  end loop;
  insert into public.admin_alerts (kind, title) values ('role_doors', 'role doors fixture');
  insert into public.admin_audit_log (actor_kind, action, target_table) values ('operator', 'role_doors', 'fixture');
  insert into public.admin_live_events (kind, record_type) values ('signup', 'profile');
  insert into public.platform_ledger (kind, amount_minor, note) values ('adjustment', 1, 'role doors fixture');
  insert into public.auth_codes (phone, code, expires_at) values ('+910000000001', '000000', now() + interval '1 hour')
    on conflict (phone) do nothing;
  insert into public.auth_send_log (ip, sends) values ('203.0.113.9', 1) on conflict (ip) do nothing;
  insert into public.app_controls (platform) values ('all') on conflict (platform) do nothing;

  -- the sensitive tables must really hold B's rows (or, with no owner column, any row), or the table below proves nothing
  for r in select k as t from jsonb_object_keys(v_expect) as k loop
    if pg_temp.owned_count(r.t, v_b) = 0 and r.t <> 'admin_staff' then   -- admin_staff: only the staff logins have a row
      raise exception 'FAIL: the fixture put no row in % for person B, so its checks would pass for the wrong reason', r.t;
    end if;
  end loop;

  -- ---- one generated row per table, for the ghost first (parents), then B, then A ---------------
  select array_agg(c.relname::text order by c.relname::text) into v_tables
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname::text not in ('user_roles', 'admin_staff');   -- hand-made: a generated first enum value would be 'admin'
  begin
    perform set_config('session_replication_role', 'replica', true);   -- parents may be missing; allowed only if the role may
  exception when others then
    raise notice 'role_doors: could not switch off triggers for seeding (%); tables whose parents are missing stay unseeded', sqlerrm;
  end;
  for v_pass in 1 .. 3 loop
    foreach v_t in array v_tables loop
      perform pg_temp.seed_row(v_t, v_ghost, v_ghost);
    end loop;
  end loop;
  foreach v_t in array v_tables loop
    perform pg_temp.seed_row(v_t, v_b, v_ghost);
    perform pg_temp.seed_row(v_t, v_a, v_ghost);
  end loop;
  begin
    perform set_config('session_replication_role', 'origin', true);
  exception when others then null;
  end;
  foreach v_t in array v_tables loop
    if pg_temp.owner_col(v_t) is not null and pg_temp.owned_count(v_t, v_b) = 0 then
      v_unseeded := v_unseeded || v_t;
    end if;
  end loop;
  raise notice 'role_doors: generated rows for % of % tables; no generated row (the doors for these rest on the catalog rules and the explicit table): %',
    array_length(v_tables, 1) - coalesce(array_length(v_unseeded, 1), 0), array_length(v_tables, 1),
    coalesce(array_to_string(v_unseeded, ', '), 'none');

  -- ---- 2. generic doors: signed out, A, B ----------------------------------------------------
  v_labels := array['signed out', 'person A', 'person B'];
  v_ids := array[null, v_a, v_b]::uuid[];
  for v_i in 1 .. 3 loop
    v_label := v_labels[v_i];
    v_caller := v_ids[v_i];
    v_victim := case when v_i = 3 then v_a else v_b end;

    perform pg_temp.as_owner();
    v_before := '{}'::jsonb;
    foreach v_t in array v_tables loop
      v_before := v_before || jsonb_build_object(v_t, pg_temp.owned_count(v_t, v_victim));
    end loop;

    if v_i = 1 then perform pg_temp.as_anon(); else perform pg_temp.become(v_caller); end if;
    v_seen := '';
    foreach v_t in array v_tables loop
      v_n := pg_temp.foreign_visible(v_t, v_caller);
      if v_n > 0 then
        v_seen := v_seen || format(' %s=%s', v_t, v_n);
        if v_i = 1 or not (v_t = any (v_allowed)) then
          raise exception 'FAIL: % can read % row(s) in public.% that belong to someone else', v_label, v_n, v_t;
        end if;
      end if;
      v_n := pg_temp.try_delete(v_t, v_victim);
      if v_n > 0 then raise exception 'FAIL: % deleted % row(s) of another person in public.%', v_label, v_n, v_t; end if;
      v_n := pg_temp.try_update(v_t, v_victim);
      if v_n > 0 then raise exception 'FAIL: % changed % row(s) of another person in public.%', v_label, v_n, v_t; end if;
      if pg_temp.seed_row(v_t, v_victim, v_ghost, true) then
        raise exception 'FAIL: % inserted a row for another person in public.%', v_label, v_t;
      end if;
    end loop;
    raise notice 'role_doors: % sees others'' rows only in:%', v_label, coalesce(nullif(v_seen, ''), ' nothing');

    perform pg_temp.as_owner();
    v_after := '{}'::jsonb;
    foreach v_t in array v_tables loop
      v_after := v_after || jsonb_build_object(v_t, pg_temp.owned_count(v_t, v_victim));
    end loop;
    if v_after is distinct from v_before then
      raise exception 'FAIL: % changed the other person''s rows (before %, after %)', v_label, v_before, v_after;
    end if;
  end loop;

  -- A stranger with no rows at all: nothing here is theirs and they are no party to anything, so every row counts.
  perform pg_temp.as_owner();
  perform pg_temp.become(v_stranger);
  foreach v_t in array v_tables loop
    v_n := pg_temp.foreign_visible(v_t, v_stranger);
    if v_n > 0 and not (v_t = any (v_allowed)) then
      raise exception 'FAIL: a stranger can read % row(s) in public.%', v_n, v_t;
    end if;
  end loop;

  -- ---- 3. the explicit table for every caller --------------------------------------------------
  v_labels := array['signed out', 'person A', 'person B', 'admin', 'finance', 'support', 'viewer', 'sales'];
  v_ids := array[null, v_a, v_b, v_admin, v_finance, v_support, v_viewer, v_sales]::uuid[];
  v_kinds := array['anon', 'person', 'person', 'staff', 'staff', 'staff', 'staff', 'sales'];
  for v_i in 1 .. 8 loop
    perform pg_temp.as_owner();
    if v_kinds[v_i] = 'anon' then perform pg_temp.as_anon(); else perform pg_temp.become(v_ids[v_i]); end if;
    for r in select e.key as t, e.value as v from jsonb_each(v_expect) e loop
      v_n := greatest(pg_temp.foreign_visible(r.t, v_ids[v_i]), 0);
      v_want := case when v_kinds[v_i] = 'anon' then 'none' else r.v ->> v_kinds[v_i] end;
      if v_want = 'none' and v_n <> 0 then
        raise exception 'FAIL: % can read % row(s) of public.% that it should not read', v_labels[v_i], v_n, r.t;
      elsif v_want = 'some' and v_n = 0 then
        raise exception 'FAIL: % can no longer read public.% (expected to), or the fixture is missing', v_labels[v_i], r.t;
      end if;
    end loop;
  end loop;
  perform pg_temp.as_owner();
  raise notice 'role_doors 2-3/5: generic doors and the explicit read table hold';
end;
$do$;

-- ============================================================================
-- 4. admin_* and crm_* functions refuse a plain person and the signed-out role
-- ============================================================================
do $do$
declare
  v_a uuid := gen_random_uuid();
  r record;
  v_err text;
  v_count int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'roledoors-fn+' || v_a || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_a, 'Door Fn A') on conflict (id) do nothing;

  for r in
    select p.oid, p.proname::text as name, p.prosrc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.provariadic = 0
       and (p.proname like 'admin\_%' or p.proname like 'crm\_%')
     order by p.proname, p.oid
  loop
    v_count := v_count + 1;
    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      raise exception 'FAIL: the signed-out role can execute public.%', r.name;
    end if;
    if not has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      continue;   -- refused before it starts
    end if;
    if r.prosrc !~* '(is_admin\s*\(|require_[a-z_]+\s*\(|staff_can\s*\(|assert_[a-z_]+\s*\(|has_role\s*\()' then
      raise exception 'FAIL: public.% can be called by a signed-in person and its source has no staff check', r.name;
    end if;
    perform pg_temp.become(v_a);
    v_err := pg_temp.try(pg_temp.null_call(r.oid));
    perform pg_temp.as_owner();
    if v_err is null then
      raise exception 'FAIL: a plain person ran public.% without being refused', r.name;
    end if;
  end loop;
  if v_count = 0 then raise exception 'FAIL: no admin_* or crm_* functions were found, so nothing was checked'; end if;
  raise notice 'role_doors 4/5: % admin_* and crm_* functions refuse a plain person and the signed-out role', v_count;
end;
$do$;

-- ============================================================================
-- 5. staff role limits, and no role raises itself
-- ============================================================================
do $do$
declare
  v_person uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_sales uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_pay_fin uuid;
  v_pay_adm uuid;
  v_pay_other uuid;
  v_err text;
  v_u uuid;
  v_label text;
  v_roles_before jsonb;
  v_roles_after jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'roledoors-staff+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_person), (v_other), (v_admin), (v_finance), (v_support), (v_sales), (v_viewer)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_person, 'RD Person'), (v_other, 'RD Other'), (v_admin, 'RD Admin'), (v_finance, 'RD Finance'),
         (v_support, 'RD Support'), (v_sales, 'RD Sales'), (v_viewer, 'RD Viewer')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin'::app_role from unnest(array[v_admin, v_finance, v_support, v_sales, v_viewer]) u
  on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role)
  values (v_finance, 'finance'), (v_support, 'support'), (v_sales, 'sales'), (v_viewer, 'viewer')
  on conflict (user_id) do update set staff_role = excluded.staff_role;
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';

  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_person, 10000, 'requested', 'roledoor1@upi') returning id into v_pay_fin;
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_person, 10000, 'requested', 'roledoor2@upi') returning id into v_pay_adm;
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_person, 10000, 'requested', 'roledoor3@upi') returning id into v_pay_other;

  -- ---- people area: admin, support and sales may; finance and viewer may not ----------------
  foreach v_u in array array[v_admin, v_support, v_sales] loop
    perform pg_temp.become(v_u);
    v_err := pg_temp.try(format('select public.crm_add_note(%L, ''role doors note'', null)', v_person));
    perform pg_temp.as_owner();
    if v_err is not null then raise exception 'FAIL: a role that should reach people was refused the CRM note: %', v_err; end if;
  end loop;
  foreach v_u in array array[v_finance, v_viewer] loop
    perform pg_temp.become(v_u);
    v_err := pg_temp.try(format('select public.crm_add_note(%L, ''role doors note'', null)', v_person));
    perform pg_temp.as_owner();
    if v_err is null then raise exception 'FAIL: finance or a viewer wrote a CRM note'; end if;
  end loop;

  -- ---- money area: admin and finance may; support, viewer and sales may not ----------------
  perform pg_temp.become(v_admin);
  v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''processing'', null)', v_pay_adm));
  perform pg_temp.as_owner();
  if v_err is not null then raise exception 'FAIL: a full admin was refused a payout change: %', v_err; end if;
  perform pg_temp.become(v_finance);
  v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''processing'', null)', v_pay_fin));
  perform pg_temp.as_owner();
  if v_err is not null then raise exception 'FAIL: finance was refused a payout change: %', v_err; end if;
  foreach v_u in array array[v_support, v_viewer, v_sales] loop
    perform pg_temp.become(v_u);
    v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''processing'', null)', v_pay_other));
    perform pg_temp.as_owner();
    if v_err is null then raise exception 'FAIL: support, a viewer or sales moved a payout'; end if;
    perform pg_temp.become(v_u);
    v_err := pg_temp.try(format(
      'insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason) values (%L, 100, 0, 0, ''x'')', v_person));
    perform pg_temp.as_owner();
    if v_err is null then raise exception 'FAIL: support, a viewer or sales changed someone''s wallet'; end if;
  end loop;
  if (select status::text from public.payouts where id = v_pay_other) <> 'requested' then
    raise exception 'FAIL: a payout moved without a money role';
  end if;

  -- ---- admin area (settings, staff, admin access): full admin only -------------------------
  perform pg_temp.become(v_admin);
  v_err := pg_temp.try('select public.admin_set_payout_method(''manual'')');
  perform pg_temp.as_owner();
  if v_err is not null then raise exception 'FAIL: a full admin was refused a setting: %', v_err; end if;
  foreach v_u in array array[v_finance, v_support, v_sales, v_viewer, v_person] loop
    perform pg_temp.become(v_u);
    v_err := pg_temp.try('select public.admin_set_payout_method(''manual'')');
    if v_err is null then raise exception 'FAIL: a role below full admin (or a plain person) changed a setting'; end if;
    v_err := pg_temp.try('update public.settings set value = value where key = ''review_window_days''');
    perform pg_temp.as_owner();
  end loop;

  -- ---- no role raises itself or anyone else ------------------------------------------------
  select jsonb_object_agg(user_id::text, staff_role) into v_roles_before from public.admin_staff;
  foreach v_u in array array[v_person, v_finance, v_support, v_sales, v_viewer] loop
    perform pg_temp.become(v_u, 'aal2');
    perform pg_temp.try(format('select public.admin_set_staff(%L, ''admin'')', v_u));
    perform pg_temp.try(format('select public.admin_set_admin(%L, true)', v_u));
    perform pg_temp.try(format('insert into public.user_roles (user_id, role) values (%L, ''admin'')', v_u));
    perform pg_temp.try(format('update public.user_roles set role = ''admin'' where user_id = %L', v_u));
    perform pg_temp.try(format('update public.admin_staff set staff_role = ''admin'' where user_id = %L', v_u));
    perform pg_temp.try(format('insert into public.admin_staff (user_id, staff_role) values (%L, ''admin'') on conflict (user_id) do update set staff_role = ''admin''', v_u));
    -- and nobody else either
    perform pg_temp.try(format('select public.admin_set_admin(%L, true)', v_other));
    perform pg_temp.try(format('select public.admin_set_staff(%L, ''admin'')', v_other));
    perform pg_temp.try(format('insert into public.user_roles (user_id, role) values (%L, ''admin'')', v_other));
    perform pg_temp.try(format('insert into public.admin_staff (user_id, staff_role) values (%L, ''admin'') on conflict (user_id) do update set staff_role = ''admin''', v_other));
    perform pg_temp.as_owner();
  end loop;
  foreach v_u in array array[v_person, v_other] loop
    if exists (select 1 from public.user_roles where user_id = v_u and role = 'admin') then
      raise exception 'FAIL: someone below full admin made a person an admin';
    end if;
  end loop;
  select jsonb_object_agg(user_id::text, staff_role) into v_roles_after from public.admin_staff;
  if v_roles_after is distinct from v_roles_before then
    raise exception 'FAIL: a staff role changed without a full admin (before %, after %)', v_roles_before, v_roles_after;
  end if;
  if (select count(*) from public.user_roles where role = 'admin' and user_id in (v_finance, v_support, v_sales, v_viewer)) <> 4 then
    raise exception 'FAIL: an admin role was removed or changed by someone below full admin';
  end if;

  -- the signed-out role cannot call any of it either
  perform pg_temp.as_anon();
  if pg_temp.try('select public.admin_set_staff(null, ''admin'')') is null
     or pg_temp.try('select public.admin_set_admin(null, true)') is null
     or pg_temp.try('insert into public.user_roles (user_id, role) values (null, ''admin'')') is null then
    raise exception 'FAIL: the signed-out role was not refused';
  end if;
  perform pg_temp.as_owner();

  raise notice 'role_doors 5/5: staff role limits hold and no role can raise itself';
  raise notice 'role_doors: all assertions passed';
end;
$do$;

rollback;
