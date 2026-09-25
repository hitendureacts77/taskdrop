-- Removes exactly the rows demo_account.sql created (logged in
-- private.demo_seed), resets the demo account's wallet to zero, and
-- recomputes its ratings from whatever reviews remain. The bio, skills and
-- languages it filled in are left as they are.

begin;
set local session_replication_role = replica;

-- Tasks point at their locked bid and funding payment; unhook them first.
update public.tasks set locked_bid_id = null, funding_payment_id = null
 where id in (select row_id from private.demo_seed where tbl = 'tasks');

delete from public.notifications where id in (select row_id from private.demo_seed where tbl = 'notifications');
delete from public.messages      where id in (select row_id from private.demo_seed where tbl = 'messages');
delete from public.reviews       where id in (select row_id from private.demo_seed where tbl = 'reviews');
delete from public.saved_tasks   where task_id in (select row_id from private.demo_seed where tbl = 'tasks');
delete from public.assignments   where id in (select row_id from private.demo_seed where tbl = 'assignments');
delete from public.payments      where id in (select row_id from private.demo_seed where tbl = 'payments');
delete from public.bids          where id in (select row_id from private.demo_seed where tbl = 'bids');
delete from public.payouts       where id in (select row_id from private.demo_seed where tbl = 'payouts');
delete from public.tasks         where id in (select row_id from private.demo_seed where tbl = 'tasks');

update public.wallets set balance_minor = 0, clearing_minor = 0
 where user_id = 'b74bef3a-41f4-470e-9e58-10d9cfac032d';

update public.profiles p set
  worker_rating_avg   = coalesce((select avg(rating) from public.reviews r where r.subject_id = p.id and r.about_role = 'worker'), 0),
  worker_rating_count = (select count(*) from public.reviews r where r.subject_id = p.id and r.about_role = 'worker'),
  poster_rating_avg   = coalesce((select avg(rating) from public.reviews r where r.subject_id = p.id and r.about_role = 'poster'), 0),
  poster_rating_count = (select count(*) from public.reviews r where r.subject_id = p.id and r.about_role = 'poster')
 where p.id = 'b74bef3a-41f4-470e-9e58-10d9cfac032d';

delete from private.demo_seed;
commit;
