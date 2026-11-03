-- 142: count a whole request against the api rate limit in one call.
--
-- A `batch` request counts once per read inside it (up to 20), so batching
-- never widens the budget. Until now the api function made one api_rate_hit
-- call per read, each an upsert on the same row: up to 20 round trips queued on
-- one row lock per batched screen load (eng review 2026-11-03, F1 / plan R1).
-- api_rate_spend adds the whole cost in one upsert and answers the same
-- question: is the person still within the limit after this request?
--
-- A new name rather than an extra argument on api_rate_hit: two overloads that
-- both accept (p_user, p_bucket, p_limit) would make PostgREST refuse the call
-- as ambiguous, and the api function deployed today still calls api_rate_hit.
-- That function stays exactly as it is (migrations only add).

create or replace function public.api_rate_spend(
  p_user           uuid,
  p_bucket         text,
  p_limit          integer,
  p_cost           integer default 1,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  -- A request always costs at least one; the cap keeps a bad argument from
  -- locking someone out for the rest of the window.
  v_cost  integer := least(greatest(coalesce(p_cost, 1), 1), 100);
  v_hits  integer;
begin
  insert into private.api_rate as r (user_id, bucket, window_start, hits)
  values (p_user, p_bucket, v_start, v_cost)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + v_cost
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Only our own server calls this (with the service key), as with api_rate_hit.
revoke all on function public.api_rate_spend(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.api_rate_spend(uuid, text, integer, integer, integer) to service_role;
