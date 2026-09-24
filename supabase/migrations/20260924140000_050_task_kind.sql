-- 050_task_kind
--
-- Posters and workers each publish into the same tasks table: a poster posts a
-- request ("fix my scooter"), a worker lists a service ("scooter repairs, from
-- ₹300"). Nothing recorded which was which, so every feed showed both to
-- everyone. `kind` says it, and each side now browses only the other side's
-- posts: workers see requests, posters see services.
--
-- Existing rows default to 'request' -- there is no way to tell after the fact
-- which ones were worker listings.
alter table public.tasks
  add column if not exists kind text not null default 'request';

alter table public.tasks
  drop constraint if exists tasks_kind_check,
  add constraint tasks_kind_check check (kind in ('request', 'service'));

create index if not exists tasks_kind_open_idx
  on public.tasks (kind, created_at desc) where status = 'OPEN';

-- Quotes are for requests. A worker quoting on another worker's service
-- listing was never meaningful, and the bid policy is where that is enforced.
create or replace function private.task_open_for_bid(t_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.tasks
    where id = t_id and status = 'OPEN' and poster_id <> uid and kind = 'request'
  );
$function$;

-- Trending is about what people need done, so it counts requests only.
create or replace function public.trending_categories(p_limit integer default 8)
returns table (category text, open_count bigint, recent_count bigint, avg_budget_minor bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(t.category,
           case t.pillar when 'services' then 'Services'
                         when 'procurement' then 'Products'
                         else 'Local Intel' end) as category,
         count(*) filter (where t.status = 'OPEN') as open_count,
         count(*) as recent_count,
         round(avg(t.benchmark_minor))::bigint as avg_budget_minor
    from public.tasks t
   where t.created_at > now() - interval '30 days'
     and t.status <> 'CANCELLED'
     and t.kind = 'request'
   group by 1
   order by 2 desc, 3 desc
   limit greatest(1, least(coalesce(p_limit, 8), 20))
$$;
revoke all on function public.trending_categories(integer) from public, anon;
grant execute on function public.trending_categories(integer) to authenticated;
