-- Migration 178: a new table in `public` gets row level security on by itself.
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/auto_enable_rls.test.sql

begin;

do $$
declare
  v_rls boolean;
begin
  -- 1. The trigger exists and is on.
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls' and evtenabled = 'O') then
    raise exception 'FAIL 1: event trigger ensure_rls is missing or switched off';
  end if;

  -- 2. CREATE TABLE in public ends with RLS on.
  create table public._auto_rls_probe_a (id int);
  select relrowsecurity into v_rls from pg_class where oid = 'public._auto_rls_probe_a'::regclass;
  if v_rls is not true then raise exception 'FAIL 2: CREATE TABLE left RLS off'; end if;

  -- 3. CREATE TABLE AS in public ends with RLS on.
  create table public._auto_rls_probe_b as select 1 as x;
  select relrowsecurity into v_rls from pg_class where oid = 'public._auto_rls_probe_b'::regclass;
  if v_rls is not true then raise exception 'FAIL 3: CREATE TABLE AS left RLS off'; end if;

  -- 4. A table in another schema is left alone.
  create schema _auto_rls_probe_s;
  create table _auto_rls_probe_s.t (id int);
  select relrowsecurity into v_rls from pg_class where oid = '_auto_rls_probe_s.t'::regclass;
  if v_rls is not false then raise exception 'FAIL 4: a table outside public was changed'; end if;

  -- 5. The API roles cannot call the function by hand.
  if has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')
     or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute') then
    raise exception 'FAIL 5: anon or authenticated can execute rls_auto_enable()';
  end if;

  raise notice 'auto_enable_rls: all checks passed';
end
$$;

rollback;
