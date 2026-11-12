-- B57 + B62 (migration 169): the old fund_task door is closed to app users, and a payout account
-- with a withdrawal on its way cannot be removed. Catalog reads only; rolls back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/fund_task_revoked.test.sql

begin;

do $$
begin
  assert to_regprocedure('public.fund_task(uuid, uuid)') is not null, 'fund_task is kept (migrations only add)';
  assert not has_function_privilege('authenticated', 'public.fund_task(uuid, uuid)', 'EXECUTE'),
    'B57: a signed-in person can no longer call fund_task';
  assert not has_function_privilege('anon', 'public.fund_task(uuid, uuid)', 'EXECUTE'),
    'B57: signed out cannot call fund_task';
  assert not has_function_privilege('authenticated', 'public.fund_task_from_payment(uuid)', 'EXECUTE'),
    'fund_task_from_payment stays service-role only';

  -- The wallet's fines read (170, B58) is for signed-in callers only.
  assert not has_function_privilege('anon', 'public.my_cancel_fines()', 'EXECUTE'), 'my_cancel_fines is closed signed out';
  assert has_function_privilege('authenticated', 'public.my_cancel_fines()', 'EXECUTE'), 'my_cancel_fines is open signed in';

  assert exists (select 1 from pg_trigger
                  where tgrelid = 'public.payout_destinations'::regclass
                    and tgname = 'trg_keep_destination_with_open_payout'
                    and tgenabled = 'O'),
    'B62: the payout account guard is switched on';

  raise notice 'fund_task_revoked: all assertions passed';
end;
$$;

rollback;
