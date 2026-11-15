-- 178: every new table in `public` gets row level security switched on by itself.
--
-- Until now RLS was only on because each migration remembered to add
-- `enable row level security`. A table made with plain SQL gets none of it from Supabase, so one
-- forgotten line would leave a table open to the public API.
--
-- This adds the event trigger Supabase documents for that case (Row Level Security guide,
-- "Auto-enable RLS for new tables"). After it runs, CREATE TABLE / CREATE TABLE AS / SELECT INTO
-- in the `public` schema ends with `alter table ... enable row level security`.
--
-- What it does NOT do:
--   * It touches no existing table (all 72 already have RLS on).
--   * It adds no policies. A new table with RLS on and no policy is closed to the API until the
--     migration that creates it adds one, which is the safe default.
--   * It never blocks a migration: if the ALTER fails it logs and moves on.
--
-- The function is not for calling by hand: execute is taken away from the API roles so the
-- security advisor does not list it next to the other security-definer functions.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
