-- 084: per-person rate limit for the api Edge Function.
--
-- Every request to the api function counts against the caller in a one-minute
-- window, per bucket (reads, writes, uploads). Over the limit, the function
-- answers 429 before running anything. The counter lives in Postgres because
-- Edge Function instances share no memory: a limit kept in one instance would
-- be a limit per instance, not per person.
--
-- Fixed windows, not a sliding log: one row per person, bucket and minute, a
-- single upsert per request, and old rows swept every ten minutes.

create table if not exists private.api_rate (
  user_id      uuid        not null,
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (user_id, bucket, window_start)
);

-- private is not exposed through the API; RLS on with no policies as well, so
-- the table stays deny-all even if that ever changes.
alter table private.api_rate enable row level security;

create or replace function public.api_rate_hit(
  p_user           uuid,
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits  integer;
begin
  insert into private.api_rate as r (user_id, bucket, window_start, hits)
  values (p_user, p_bucket, v_start, 1)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Only our own server calls this (with the service key), naming the caller it
-- has already verified. A user must not be able to spend someone else's quota.
revoke all on function public.api_rate_hit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.api_rate_hit(uuid, text, integer, integer) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'api-rate-prune') then
    perform cron.unschedule('api-rate-prune');
  end if;
  perform cron.schedule(
    'api-rate-prune',
    '*/10 * * * *',
    $c$delete from private.api_rate where window_start < now() - interval '1 hour'$c$
  );
end;
$$;
