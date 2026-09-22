-- 044 — sponsored placement becomes an auction.
--
-- Paid placement already worked as a boolean: sponsored_tasks returned a bare
-- set of task ids, the feed floated those to the top, and that was the whole
-- of it. Every campaign therefore tied. A poster paying ₹300/day landed
-- wherever they happened to fall against someone paying ₹80/day, which makes
-- the budget tiers on the promote screen decoration -- you could pay four
-- times as much for the same position.
--
-- The view now carries the bid as well as the id. Ranking is on the DAILY
-- budget, not the campaign total: amount_minor is daily x days, so a cheap
-- 7-day campaign has a big total while buying little attention on any given
-- day. Ranking on the total would let it outrank a serious one-day push.
--
-- Expiry stays a property of the window rather than a status to sweep: a
-- campaign is sponsored exactly while now() sits between starts_at and
-- ends_at, so nothing has to run on a schedule for placement to end on time.

create or replace view public.sponsored_tasks as
select p.task_id,
       max(round(p.amount_minor::numeric / greatest(p.days, 1)))::bigint as daily_budget_minor,
       max(p.ends_at) as ends_at
  from public.task_promotions p
 where p.status = 'active'
   and p.starts_at <= now()
   and p.ends_at > now()
 group by p.task_id;

comment on view public.sponsored_tasks is
  'Tasks being paid for right now, with the daily budget that ranks them. Ends when the campaign''s window closes -- no sweep needed.';
