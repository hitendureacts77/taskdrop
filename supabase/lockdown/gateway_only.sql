-- Gateway-only lockdown: the database stops answering anyone but our own server.
--
-- NOT a migration, on purpose. Run it by hand, once, and only after:
--
--   1. migration 083 is applied;
--   2. the api function (and the updated razorpay function) are deployed;
--   3. the admin panel has API_GATEWAY_SECRET set and is redeployed;
--   4. the new app build is live, and old installed builds have been forced to
--      update -- an old build reads tables directly and STOPS WORKING the
--      moment this runs.
--
-- What changes: PostgREST runs private.require_gateway() before every request.
-- A request without the x-taskdrop-gateway header (i.e. anyone holding only the
-- public anon key) is refused before it touches a table or a function. The
-- service role is unaffected. Supabase Auth, Storage and Realtime are separate
-- services and are not affected by this setting.
--
-- Then live updates stop being sent as raw table changes, which would reveal
-- the tables; the app uses the private pings from migration 083 instead.

alter role authenticator set pgrst.db_pre_request = 'private.require_gateway';
-- The schema description PostgREST serves at /rest/v1/ lists every table and
-- column. Nobody outside our server needs it.
alter role authenticator set pgrst.openapi_mode = 'disabled';
notify pgrst, 'reload config';

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime drop table public.messages;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime drop table public.notifications;
  end if;
end;
$$;

-- --------------------------------------------------------------- to undo --
--
-- alter role authenticator reset pgrst.db_pre_request;
-- alter role authenticator reset pgrst.openapi_mode;
-- notify pgrst, 'reload config';
-- alter publication supabase_realtime add table public.messages, public.notifications;
