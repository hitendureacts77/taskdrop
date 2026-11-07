-- Migration 143: api_rate_spend counts a whole request against the rate limit
-- in one call.
--
-- What is asserted:
--   1. A request's cost is added at once; the answer turns false only once the
--      total passes the limit, exactly as the same number of api_rate_hit calls.
--   2. A missing, zero or negative cost still counts one; a huge one is capped.
--   3. Buckets and people are counted apart, and api_rate_hit adds to the same counter.
--   4. Only the service role can call it.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rate_limit.test.sql

begin;

do $$
declare
  a     uuid := gen_random_uuid();
  b     uuid := gen_random_uuid();
  hits  integer;
begin
  -- 1. a batch of 20 against a limit of 25: fits; the next batch of 20 does not
  if not public.api_rate_spend(a, 'read', 25, 20) then raise exception 'FAIL: 20 of 25 should fit'; end if;
  select r.hits into hits from private.api_rate r where r.user_id = a and r.bucket = 'read';
  if hits <> 20 then raise exception 'FAIL: one call should add the whole cost, got %', hits; end if;
  if not public.api_rate_spend(a, 'read', 25, 5) then raise exception 'FAIL: exactly at the limit should still fit'; end if;
  if public.api_rate_spend(a, 'read', 25, 1) then raise exception 'FAIL: over the limit should be refused'; end if;

  -- 2. odd costs
  perform public.api_rate_spend(b, 'write', 60, null);
  perform public.api_rate_spend(b, 'write', 60, 0);
  perform public.api_rate_spend(b, 'write', 60, -5);
  select r.hits into hits from private.api_rate r where r.user_id = b and r.bucket = 'write';
  if hits <> 3 then raise exception 'FAIL: missing, zero and negative costs should count one each, got %', hits; end if;
  perform public.api_rate_spend(b, 'upload', 20, 1000000);
  select r.hits into hits from private.api_rate r where r.user_id = b and r.bucket = 'upload';
  if hits <> 100 then raise exception 'FAIL: a huge cost should be capped at 100, got %', hits; end if;

  -- 3. buckets and people apart; the old function shares the counter
  if not public.api_rate_spend(b, 'read', 25, 1) then raise exception 'FAIL: another person has their own budget'; end if;
  perform public.api_rate_hit(b, 'read', 25);
  select r.hits into hits from private.api_rate r where r.user_id = b and r.bucket = 'read';
  if hits <> 2 then raise exception 'FAIL: api_rate_hit and api_rate_spend should share one counter, got %', hits; end if;

  -- 4. grants
  if has_function_privilege('anon', 'public.api_rate_spend(uuid, text, integer, integer, integer)', 'execute') then
    raise exception 'FAIL: anon must not call api_rate_spend';
  end if;
  if has_function_privilege('authenticated', 'public.api_rate_spend(uuid, text, integer, integer, integer)', 'execute') then
    raise exception 'FAIL: a signed-in person must not spend anyone''s budget';
  end if;
  if not has_function_privilege('service_role', 'public.api_rate_spend(uuid, text, integer, integer, integer)', 'execute') then
    raise exception 'FAIL: the api function (service role) must be able to call api_rate_spend';
  end if;

  raise notice 'rate limit ok';
end;
$$;

rollback;
