-- 141 -- The two marketplace numbers, for the admin Reports page (plan task 3.3b).
--
--   Time to first offer   how long a new task waits for its first offer.
--   Fill rate             of the tasks posted, the share that got done and paid.
--
-- admin_marketplace_numbers(from, to) returns one row for everything ('all'),
-- one per category ('category') and one per area label ('area', the 15 busiest).
-- Only tasks posted in the window (Indian Standard Time days) are counted, so a
-- task still being worked on counts as not yet filled; the admin page says so.
-- Rates are worked out in the page from the counts, so a group with nothing to
-- divide by shows a dash, never 0%.
--
-- "Got an offer" = at least one row in bids. "Done and paid" = COMPLETED or
-- AUTO_COMPLETED (money is released only then). Read-only, admins only, no
-- money amounts, so it is open to every admin role. Only adds a function.

create or replace function public.admin_marketplace_numbers(p_from date, p_to date)
returns table (
  group_kind text,
  group_label text,
  tasks_posted bigint,
  tasks_with_offer bigint,
  tasks_filled bigint,
  median_first_offer_seconds numeric,
  p90_first_offer_seconds numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > 400 then raise exception 'At most 400 days at a time'; end if;

  return query
  with t as (
    select tk.id,
           coalesce(nullif(btrim(tk.category), ''), 'Uncategorised') as category,
           coalesce(nullif(btrim(tk.loc_label), ''), 'No area') as area,
           (tk.status::text in ('COMPLETED', 'AUTO_COMPLETED')) as filled,
           extract(epoch from (
             (select min(b.created_at) from public.bids b where b.task_id = tk.id) - tk.created_at
           )) as first_offer_s
      from public.tasks tk
     where (tk.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ),
  areas as (
    select a.area from t a group by a.area order by count(*) desc, a.area limit 15
  )
  select 'all'::text, 'All tasks'::text,
         count(*)::bigint,
         count(*) filter (where x.first_offer_s is not null)::bigint,
         count(*) filter (where x.filled)::bigint,
         (percentile_cont(0.5) within group (order by x.first_offer_s))::numeric,
         (percentile_cont(0.9) within group (order by x.first_offer_s))::numeric
    from t x
  union all
  select 'category'::text, g.category,
         count(*)::bigint,
         count(*) filter (where g.first_offer_s is not null)::bigint,
         count(*) filter (where g.filled)::bigint,
         (percentile_cont(0.5) within group (order by g.first_offer_s))::numeric,
         (percentile_cont(0.9) within group (order by g.first_offer_s))::numeric
    from t g
   group by g.category
  union all
  select 'area'::text, g.area,
         count(*)::bigint,
         count(*) filter (where g.first_offer_s is not null)::bigint,
         count(*) filter (where g.filled)::bigint,
         (percentile_cont(0.5) within group (order by g.first_offer_s))::numeric,
         (percentile_cont(0.9) within group (order by g.first_offer_s))::numeric
    from t g
   where g.area in (select a.area from areas a)
   group by g.area;
end;
$fn$;

revoke all on function public.admin_marketplace_numbers(date, date) from public, anon;
grant execute on function public.admin_marketplace_numbers(date, date) to authenticated;
