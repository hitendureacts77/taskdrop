-- New doors start closed (task 2.18 part C, hole H71, migration 156).
--
-- The catalog is read, so a new table, view or function is covered without touching this file:
--   * every table in `public` has row rules on;
--   * every view runs with the rights of the person asking;
--   * the signed-out role holds no right on any table or view;
--   * the signed-out role can run only the functions on the short list below;
--   * a table created now gives nobody any right.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/new_doors_closed.test.sql

begin;

do $$
declare
  v_bad text[];
begin
  -- Row rules on every table.
  select coalesce(array_agg(c.relname order by c.relname), '{}') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity;
  if cardinality(v_bad) > 0 then
    raise exception 'H71: tables with no row rules: %', v_bad;
  end if;

  -- A view that runs as its owner would skip the row rules of the tables under it.
  select coalesce(array_agg(c.relname order by c.relname), '{}') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and not coalesce(
       exists (select 1 from unnest(c.reloptions) o where lower(o) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')),
       false);
  if cardinality(v_bad) > 0 then
    raise exception 'H71: views that run as their owner: %', v_bad;
  end if;

  -- Nothing signed out, on any table, view or saved view.
  select coalesce(array_agg(c.relname order by c.relname), '{}') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('anon', c.oid, 'insert')
       or has_table_privilege('anon', c.oid, 'update')
       or has_table_privilege('anon', c.oid, 'delete')
       or has_table_privilege('anon', c.oid, 'truncate'));
  if cardinality(v_bad) > 0 then
    raise exception 'H71: the signed-out role has rights on: %', v_bad;
  end if;

  -- Only get_app_controls may run signed out, whatever rights the function runs with. Functions
  -- that belong to an extension are left out: they are not ours and are not doors the app opens.
  select coalesce(array_agg(p.proname order by p.proname), '{}') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname <> 'get_app_controls'
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
  if cardinality(v_bad) > 0 then
    raise exception 'H71: functions anyone can run signed out (revoke them from public, anon and authenticated): %', v_bad;
  end if;
end;
$$;

-- A new table gives nobody any right. Run as the role that runs the migrations.
create table public.h71_probe (id integer primary key);

do $$
begin
  if has_table_privilege('authenticated', 'public.h71_probe', 'select')
     or has_table_privilege('authenticated', 'public.h71_probe', 'insert')
     or has_table_privilege('anon', 'public.h71_probe', 'select') then
    raise exception 'H71: a new table starts with rights for the app roles (migration 156)';
  end if;
end;
$$;

rollback;
