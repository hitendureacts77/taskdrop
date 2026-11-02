-- Migration 139: repeat keys (idempotency keys) for the api function's writes.
--
-- What is asserted:
--   1. A first claim is "new"; after the reply is saved, a repeat is "done" with that reply.
--   2. The same key with a different request is "mismatch"; an unsaved key is "running", then "lost" after 5 minutes.
--   3. A saved reply is never overwritten, and keys are per person (two people may use the same key).
--   4. Expired rows are pruned by later claims, and a deleted account takes its keys with it.
--   5. Only the service role can call the functions, and the table is closed to the app's roles.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/repeat_keys.test.sql

begin;

do $$
declare
  a     uuid := gen_random_uuid();
  b     uuid := gen_random_uuid();
  k     text := 'key-0123456789abcdef';
  v     jsonb;
  n     integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test+' || a || '@taskdrop.test', '', now(), now(), now()),
         (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test+' || b || '@taskdrop.test', '', now(), now(), now());

  -- 1. new, then done with the saved reply
  v := public.api_repeat_claim(a, k, 'payTaskFromWallet', 'hash-1');
  if v->>'state' <> 'new' then raise exception 'first claim: expected new, got %', v; end if;
  perform public.api_repeat_save(a, k, '{"ok":true,"data":{"id":"p1"}}'::jsonb);
  v := public.api_repeat_claim(a, k, 'payTaskFromWallet', 'hash-1');
  if v->>'state' <> 'done' or v->'reply'->'data'->>'id' <> 'p1' then raise exception 'repeat: expected done p1, got %', v; end if;

  -- 2. mismatch, running, lost
  v := public.api_repeat_claim(a, k, 'payTaskFromWallet', 'hash-2');
  if v->>'state' <> 'mismatch' then raise exception 'other arguments: expected mismatch, got %', v; end if;
  v := public.api_repeat_claim(a, k, 'startTask', 'hash-1');
  if v->>'state' <> 'mismatch' then raise exception 'other op: expected mismatch, got %', v; end if;
  perform public.api_repeat_claim(a, 'key-running-000000', 'lockBid', 'h');
  v := public.api_repeat_claim(a, 'key-running-000000', 'lockBid', 'h');
  if v->>'state' <> 'running' then raise exception 'unsaved: expected running, got %', v; end if;
  update private.api_repeat_keys set created_at = now() - interval '6 minutes' where key = 'key-running-000000';
  v := public.api_repeat_claim(a, 'key-running-000000', 'lockBid', 'h');
  if v->>'state' <> 'lost' then raise exception 'abandoned: expected lost, got %', v; end if;

  -- 3. a saved reply stays; keys are per person
  perform public.api_repeat_save(a, k, '{"ok":false}'::jsonb);
  v := public.api_repeat_claim(a, k, 'payTaskFromWallet', 'hash-1');
  if v->'reply'->'data'->>'id' <> 'p1' then raise exception 'saved reply was overwritten: %', v; end if;
  v := public.api_repeat_claim(b, k, 'payTaskFromWallet', 'hash-1');
  if v->>'state' <> 'new' then raise exception 'another person, same key: expected new, got %', v; end if;

  -- 4. pruning and account deletion
  update private.api_repeat_keys set created_at = now() - interval '25 hours' where user_id = a and key = k;
  perform public.api_repeat_claim(b, 'key-prune-trigger-0', 'sendMessage', 'h');
  select count(*) into n from private.api_repeat_keys where user_id = a and key = k;
  if n <> 0 then raise exception 'expired key was not pruned'; end if;
  -- A deleted account takes its keys with it (the foreign key cascades; deleting a user here would also touch
  -- every other table that points at auth.users, which account_deletion.test.sql covers).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.api_repeat_keys'::regclass and contype = 'f'
      and confrelid = 'auth.users'::regclass and confdeltype = 'c'
  ) then raise exception 'api_repeat_keys does not cascade when an account is deleted'; end if;

  -- The key shape is checked by the table too.
  begin
    perform public.api_repeat_claim(a, 'short', 'lockBid', 'h');
    raise exception 'a malformed key was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- 5. who may call what
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.api_repeat_claim(uuid, text, text, text)', 'execute') then
      raise exception '% can call api_repeat_claim', r;
    end if;
    if has_function_privilege(r, 'public.api_repeat_save(uuid, text, jsonb)', 'execute') then
      raise exception '% can call api_repeat_save', r;
    end if;
    if has_table_privilege(r, 'private.api_repeat_keys', 'select') then
      raise exception '% can read private.api_repeat_keys', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.api_repeat_claim(uuid, text, text, text)', 'execute') then
    raise exception 'service_role cannot call api_repeat_claim';
  end if;
end;
$$;

rollback;

\echo 'repeat_keys: all assertions passed'
