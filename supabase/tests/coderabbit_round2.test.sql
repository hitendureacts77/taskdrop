-- Migration 106 (CodeRabbit's review of PR 28).
--
-- What is asserted:
--   1. The "hidden job" rule lets the assigned worker through.
--   2. An app version with a part too large for an int does not make
--      get_app_controls raise (it used to, which switched every control off).
--   3. user_sync_apply refuses a null event.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/coderabbit_round2.test.sql

begin;

do $$
begin
  if not exists (select 1 from pg_policy
                  where polrelid = 'public.tasks'::regclass and polname = 'tasks_hide_moderated'
                    and pg_get_expr(polqual, polrelid) like '%has_assignment%') then
    raise exception 'FAIL: tasks_hide_moderated does not let the assigned worker see a hidden job';
  end if;
end;
$$;

do $$
declare
  v_cfg jsonb;
begin
  update public.app_controls set min_version = '1.0.0' where platform = 'all';
  v_cfg := public.get_app_controls('web', '99999999999');
  if v_cfg is null or not (v_cfg ? 'maintenance') then
    raise exception 'FAIL: an overlong version broke get_app_controls: %', v_cfg;
  end if;
  if (v_cfg ->> 'update_required')::boolean is distinct from false then
    raise exception 'FAIL: an unreadable version should count as unknown, not as outdated: %', v_cfg;
  end if;
  v_cfg := public.get_app_controls('web', '0.9.0');
  if (v_cfg ->> 'update_required')::boolean is distinct from true then
    raise exception 'FAIL: an old version no longer needs an update: %', v_cfg;
  end if;
end;
$$;

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.user_sync_apply(gen_random_uuid(), null);
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: user_sync_apply accepted a null event';
  end if;
end;
$$;

-- 4. (migration 107) an admin cannot save a minimum version with a part over 6 digits.
do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.admin_set_app_control('web', '{"min_version": "99999999999"}'::jsonb, 'test');
  exception when others then
    v_failed := sqlerrm like 'min_version looks like%';
  end;
  if not v_failed then
    raise exception 'FAIL: an overlong min_version was accepted (or refused for another reason)';
  end if;
end;
$$;

rollback;
