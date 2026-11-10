-- Removes everything supabase/seed/fake_world.sql made (staging only).
-- Deleting the fake accounts cascades to their profiles, wallets, tasks, quotes, payments, chats, reviews and map spots.
begin;
delete from auth.users where id::text like 'fa4e0001-%';
commit;
