-- Security round 1, test T7 (docs/ULTIMATE_PLAN.md task 2.7, hole H2).
--
-- Every function in `public` that a signed-in or signed-out person can EXECUTE and that runs with
-- the owner's rights (SECURITY DEFINER) must either
--   * check who is calling (auth.uid(), an admin or staff check) before it reads or changes
--     anything, or
--   * be on the short list below of functions that are public on purpose.
-- A new function that does neither fails this test, so the surface cannot grow a hole unseen.
--
-- Read-only: catalog reads only, nothing is called and nothing is written.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rpc_caller_checks.test.sql

begin;

do $$
declare
  r record;
  -- Public on purpose. Each one returns only aggregate, non-personal numbers, or the public
  -- app switches (accepted in the plan's Security section: `get_app_controls` readable signed out).
  public_on_purpose text[] := array[
    'get_app_controls',      -- the admin's switches for the app; readable signed out by design
    'ad_auction',            -- which promoted tasks to show: public listings only
    'platform_highlights',   -- counts: people active now, open tasks
    'public_profile_stats',  -- a person's public profile numbers (jobs done, rating)
    'top_earners',           -- the public leaderboard
    'trending_categories'    -- category counts and average budgets
  ];
  -- What counts as "checks who is calling". `require_people_staff` and friends are the staff gates.
  guard text := 'auth\.uid\(\)|auth\.jwt\(\)|auth\.role\(\)|is_admin|is_staff|has_staff|require_admin|require_[a-z_]*staff|private\.assert';
  unguarded text[] := '{}';
  stale     text[] := '{}';
  n_checked int := 0;
begin
  for r in
    select p.proname, p.prosrc,
           has_function_privilege('anon', p.oid, 'execute') as anon_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.prosecdef
       and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    n_checked := n_checked + 1;
    if r.proname = any (public_on_purpose) then continue; end if;
    if r.anon_exec then
      -- Nothing but the list above may be callable with the public key alone.
      unguarded := unguarded || (r.proname || ' (callable signed out)');
    elsif r.prosrc !~* guard then
      unguarded := unguarded || r.proname;
    end if;
  end loop;

  -- A name left on the list after its function was removed would hide a future hole of the same name.
  select coalesce(array_agg(x), '{}') into stale
    from unnest(public_on_purpose) x
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = x);

  if n_checked < 50 then
    raise exception 'T7: only % callable SECURITY DEFINER functions found; the audit is not looking at the right schema', n_checked;
  end if;
  if cardinality(unguarded) > 0 then
    raise exception 'T7: callable SECURITY DEFINER functions with no caller check: %', unguarded;
  end if;
  if cardinality(stale) > 0 then
    raise exception 'T7: public_on_purpose lists functions that no longer exist: %', stale;
  end if;
  raise notice 'T7 ok: % callable SECURITY DEFINER functions, each checks the caller or is public on purpose', n_checked;
end;
$$;

-- A SECURITY DEFINER function in `private` that the app's roles can execute must be a row-rule helper (listed below).
-- The money functions in `private` are for other functions and triggers only (migration 131).
do $$
declare
  leaked text[];
begin
  select coalesce(array_agg(p.proname), '{}') into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.prosecdef
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
     -- `emit_event` and the `require_*` staff gates are called by the public functions.
     and p.proname !~ '^(require_|emit_event$)'
     -- The row-rule helpers: Postgres runs a policy's functions as the person asking, so they need EXECUTE.
     and p.proname <> all (array[
       'is_admin', 'has_role', 'is_task_poster', 'user_bid_on_task', 'user_assigned_task', 'task_open_for_bid',
       'can_use_task_thread', 'can_read_task_media', 'has_assignment', 'is_blocking', 'blocked_between',
       'bid_is_blocked', 'task_is_hidden', 'review_is_hidden', 'message_is_hidden', 'is_money_blind',
       'assert_not_money_blind', 'setting_num', 'ad_ectr', 'is_crew_member'
     ]);
  if cardinality(leaked) > 0 then
    raise exception 'T7: private SECURITY DEFINER functions the app roles can execute: %', leaked;
  end if;
end;
$$;

rollback;
