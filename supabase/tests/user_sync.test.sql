-- People: created, updated, deleted, kept in step with Inngest (migration 103).
--
-- What is asserted:
--   1. user_sync_apply keeps one ledger row per person: signed_up creates it, the
--      same event twice does nothing more, updates are counted and keep only known
--      field names, deleted is final (a late update or sign-up cannot revive it),
--      and an update from someone never seen is recorded rather than lost.
--   2. A profile edit queues user.updated carrying field NAMES only, once the
--      person has passed the age check, and not for a heartbeat, a deleted account
--      or someone who has not passed. A sign-in change queues it too, without the
--      address.
--   3. Deleting an account through delete_account() queues user.deleted and no
--      user.updated; removing an account from auth outright queues user.deleted
--      for a person the ledger knows, and nothing for one it does not.
--   4. user_sync_repair adds the missing, marks the deleted and the gone, and
--      never brings anyone back.
--   5. Only the service role can call the ledger functions, only admins can read it.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/user_sync.test.sql

begin;

create or replace function pg_temp.make_user(p_name text) returns uuid
language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'test+' || v_user || '@taskdrop.test', '', now(), now(), now());
  update public.profiles set display_name = p_name where id = v_user;
  return v_user;
end;
$$;

create or replace function pg_temp.pass_age(p_user uuid) returns void
language sql as $$
  insert into public.age_checks (user_id, birth_date, passed, min_age)
  values (p_user, date '1990-01-01', true, 18);
$$;

create or replace function pg_temp.events(p_kind text, p_user uuid) returns bigint
language sql as $$
  select count(*) from private.outbox where kind = p_kind and data->>'user_id' = p_user::text;
$$;

-- ---- 1. the ledger ----------------------------------------------------------
do $$
declare
  v_user  uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_row   public.user_sync;
  v_result text;
begin
  if public.user_sync_apply(v_user, 'signed_up', 'e1') <> 'created' then
    raise exception 'FAIL: a first sign-up did not create the ledger row';
  end if;
  if public.user_sync_apply(v_user, 'signed_up', 'e1') <> 'duplicate' then
    raise exception 'FAIL: the same event applied twice was not recognised';
  end if;
  if public.user_sync_apply(v_user, 'signed_up', 'e2') <> 'known' then
    raise exception 'FAIL: a second sign-up event for the same person was not "known"';
  end if;

  if public.user_sync_apply(v_user, 'updated', 'e3', array['bio', 'skills', 'password', 'bio']) <> 'updated' then
    raise exception 'FAIL: an update was not applied';
  end if;
  select * into v_row from public.user_sync where user_id = v_user;
  if v_row.profile_updates <> 1 or v_row.last_changed <> array['bio', 'skills'] then
    raise exception 'FAIL: update count or field names wrong (unknown names must be dropped): % %', v_row.profile_updates, v_row.last_changed;
  end if;
  perform public.user_sync_apply(v_user, 'updated', 'e3', array['bio']);
  if (select profile_updates from public.user_sync where user_id = v_user) <> 1 then
    raise exception 'FAIL: re-applying the same update counted it twice';
  end if;

  if public.user_sync_apply(v_user, 'deleted', 'e4', '{}', true) <> 'deleted' then
    raise exception 'FAIL: a deletion was not applied';
  end if;
  select * into v_row from public.user_sync where user_id = v_user;
  if v_row.state <> 'deleted' or v_row.deleted_at is null or v_row.deleted_by_admin is not true then
    raise exception 'FAIL: deleted state, time or admin flag not recorded';
  end if;
  if public.user_sync_apply(v_user, 'updated', 'e5', array['bio']) <> 'ignored'
     or public.user_sync_apply(v_user, 'signed_up', 'e6') <> 'ignored' then
    raise exception 'FAIL: a late update or sign-up revived a deleted person';
  end if;
  if public.user_sync_apply(v_user, 'deleted', 'e7') <> 'known' then
    raise exception 'FAIL: deleting twice was not "known"';
  end if;
  if (select state from public.user_sync where user_id = v_user) <> 'deleted' then
    raise exception 'FAIL: deleted is not final';
  end if;

  -- An update from someone the ledger never saw is recorded.
  -- (Two statements on purpose: one statement would check the ledger against the
  -- snapshot taken before the function wrote to it.)
  v_result := public.user_sync_apply(v_other, 'updated', 'e8', array['username']);
  if v_result <> 'updated'
     or not exists (select 1 from public.user_sync where user_id = v_other and state = 'active' and profile_updates = 1) then
    raise exception 'FAIL: an update from an unseen person was lost';
  end if;
  -- And so is a deletion.
  if public.user_sync_apply(gen_random_uuid(), 'deleted', 'e9') <> 'deleted' then
    raise exception 'FAIL: a deletion of an unseen person was lost';
  end if;

  begin
    perform public.user_sync_apply(v_user, 'renamed', 'e10');
    raise exception 'FAIL: an unknown event name was accepted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end;
$$;

-- ---- 2. a profile edit ------------------------------------------------------
do $$
declare
  v_user  uuid := pg_temp.make_user('Edit Tester');
  v_young uuid := pg_temp.make_user('Young Tester');
  v_row   record;
begin
  -- Before the age check: nothing is announced.
  update public.profiles set bio = 'hello there' where id = v_user;
  if pg_temp.events('user.updated', v_user) <> 0 then
    raise exception 'FAIL: an edit before the age check queued user.updated';
  end if;

  perform pg_temp.pass_age(v_user);

  update public.profiles set display_name = 'Secret Name 7731' where id = v_user;
  select * into v_row from private.outbox where kind = 'user.updated' and data->>'user_id' = v_user::text;
  if v_row.id is null then
    raise exception 'FAIL: a name change queued no user.updated';
  end if;
  if v_row.data->'changed' <> '["display_name"]'::jsonb then
    raise exception 'FAIL: user.updated lists the wrong fields: %', v_row.data;
  end if;
  if v_row.data::text like '%7731%' then
    raise exception 'FAIL: user.updated carries the new value: %', v_row.data;
  end if;

  -- The heartbeat and ratings never raise it.
  update public.profiles set last_seen_at = now(), live_until = now() + interval '1 minute' where id = v_user;
  if pg_temp.events('user.updated', v_user) <> 1 then
    raise exception 'FAIL: a heartbeat queued user.updated';
  end if;
  -- Saving the same value is not a change.
  update public.profiles set display_name = 'Secret Name 7731' where id = v_user;
  if pg_temp.events('user.updated', v_user) <> 1 then
    raise exception 'FAIL: saving an unchanged name queued user.updated';
  end if;

  -- Several fields in one save are one event.
  update public.profiles set bio = 'a new bio 5521', skills = array['cleaning', 'cooking'], intent = 'both' where id = v_user;
  if pg_temp.events('user.updated', v_user) <> 2 then
    raise exception 'FAIL: one save of several fields did not queue exactly one event';
  end if;
  select * into v_row from private.outbox
   where kind = 'user.updated' and data->>'user_id' = v_user::text and data->'changed' ? 'bio';
  if v_row.id is null or v_row.data->'changed' <> '["bio", "skills", "intent"]'::jsonb then
    raise exception 'FAIL: the multi-field save listed the wrong fields: %', v_row.data;
  end if;
  if v_row.data::text like '%5521%' or v_row.data::text like '%cleaning%' then
    raise exception 'FAIL: user.updated carries a bio or skill value: %', v_row.data;
  end if;

  -- A sign-in change: the fact, not the address.
  update auth.users set email = 'newaddress4410@taskdrop.test' where id = v_user;
  select * into v_row from private.outbox
   where kind = 'user.updated' and data->>'user_id' = v_user::text and data->'changed' = '["email"]'::jsonb;
  if v_row.id is null then
    raise exception 'FAIL: an email change queued no user.updated';
  end if;
  if v_row.data::text like '%4410%' then
    raise exception 'FAIL: user.updated carries the new email address: %', v_row.data;
  end if;

  -- Someone who never passed the age check is never announced.
  update public.profiles set display_name = 'Young Renamed' where id = v_young;
  update auth.users set email = 'young4411@taskdrop.test' where id = v_young;
  if pg_temp.events('user.updated', v_young) <> 0 then
    raise exception 'FAIL: user.updated was queued for someone who has not passed the age check';
  end if;
end;
$$;

-- ---- 3. deletion ------------------------------------------------------------
do $$
declare
  v_user   uuid := pg_temp.make_user('Delete Me');
  v_known  uuid := pg_temp.make_user('Remove Known');
  v_unseen uuid := pg_temp.make_user('Remove Unseen');
  v_before bigint;
  v_row    record;
begin
  perform pg_temp.pass_age(v_user);
  perform public.user_sync_apply(v_user, 'signed_up', 'd1');
  select count(*) into v_before from private.outbox where kind = 'user.updated' and data->>'user_id' = v_user::text;

  perform private.delete_account(v_user);
  select * into v_row from private.outbox where kind = 'user.deleted' and data->>'user_id' = v_user::text;
  if v_row.id is null or (v_row.data->>'by_admin')::boolean is not false then
    raise exception 'FAIL: delete_account did not queue user.deleted (by_admin false): %', v_row.data;
  end if;
  if (select count(*) from private.outbox where kind = 'user.updated' and data->>'user_id' = v_user::text) <> v_before then
    raise exception 'FAIL: deleting an account queued user.updated on the way out';
  end if;

  -- Removed from auth outright: announced only if the ledger knew the person.
  perform public.user_sync_apply(v_known, 'signed_up', 'd2');
  delete from auth.users where id = v_known;
  select * into v_row from private.outbox where kind = 'user.deleted' and data->>'user_id' = v_known::text;
  if v_row.id is null or (v_row.data->>'removed')::boolean is not true then
    raise exception 'FAIL: removing a known account from auth queued no user.deleted: %', v_row.data;
  end if;
  delete from public.user_sync where user_id = v_unseen;
  delete from auth.users where id = v_unseen;
  if pg_temp.events('user.deleted', v_unseen) <> 0 then
    raise exception 'FAIL: removing an account the ledger never saw queued user.deleted';
  end if;
  -- Already deleted through delete_account() and recorded in the ledger: removing
  -- the auth row later says nothing more.
  perform public.user_sync_apply(v_user, 'deleted', 'd3');
  delete from auth.users where id = v_user;
  if pg_temp.events('user.deleted', v_user) <> 1 then
    raise exception 'FAIL: an account deleted twice was announced twice';
  end if;
end;
$$;

-- ---- 4. repair --------------------------------------------------------------
do $$
declare
  v_missing uuid := pg_temp.make_user('Missing Row');
  v_stale   uuid := pg_temp.make_user('Stale Active');
  v_gone    uuid := gen_random_uuid();
  v_clash   uuid := pg_temp.make_user('Clash Case');
  v_out     jsonb;
begin
  delete from public.user_sync where user_id = v_missing;

  perform public.user_sync_apply(v_stale, 'signed_up', 'r1');
  update public.profiles set deleted_at = now() where id = v_stale;

  perform public.user_sync_apply(v_gone, 'signed_up', 'r2');

  perform public.user_sync_apply(v_clash, 'signed_up', 'r3');
  perform public.user_sync_apply(v_clash, 'deleted', 'r4');

  v_out := public.user_sync_repair();

  if not exists (select 1 from public.user_sync where user_id = v_missing and state = 'active') then
    raise exception 'FAIL: repair did not add a person the ledger had missed';
  end if;
  if (select state from public.user_sync where user_id = v_stale) <> 'deleted' then
    raise exception 'FAIL: repair did not mark a deleted account as deleted';
  end if;
  if (select state from public.user_sync where user_id = v_gone) <> 'deleted' then
    raise exception 'FAIL: repair did not mark a removed account as deleted';
  end if;
  if (select state from public.user_sync where user_id = v_clash) <> 'deleted' then
    raise exception 'FAIL: repair brought a deleted person back';
  end if;
  if (v_out->>'added')::int < 1 or (v_out->>'marked_deleted')::int < 1
     or (v_out->>'marked_gone')::int < 1 or (v_out->>'clashes')::int < 1 then
    raise exception 'FAIL: repair did not report what it did: %', v_out;
  end if;
  -- Running it again changes nothing.
  v_out := public.user_sync_repair();
  if (v_out->>'added')::int <> 0 or (v_out->>'marked_deleted')::int <> 0 or (v_out->>'marked_gone')::int <> 0 then
    raise exception 'FAIL: a second repair changed things: %', v_out;
  end if;
end;
$$;

-- ---- 5. who may do what -----------------------------------------------------
do $$
declare
  fn       text;
  v_user   uuid := gen_random_uuid();
  v_failed boolean;
begin
  foreach fn in array array['user_sync_apply', 'user_sync_repair'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = fn
                  and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
      raise exception 'FAIL: a signed-in or anonymous caller can execute public.%()', fn;
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = fn
                      and has_function_privilege('service_role', p.oid, 'EXECUTE')) then
      raise exception 'FAIL: the service role cannot execute public.%(), so Inngest cannot work', fn;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.user_sync', 'SELECT')
     or has_table_privilege('authenticated', 'public.user_sync', 'INSERT')
     or has_table_privilege('authenticated', 'public.user_sync', 'UPDATE')
     or has_table_privilege('authenticated', 'public.user_sync', 'DELETE') then
    raise exception 'FAIL: the ledger can be read by anon or written by a signed-in user';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.user_sync'::regclass and relrowsecurity) then
    raise exception 'FAIL: row level security is off on user_sync';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform public.user_sync_apply(gen_random_uuid(), 'signed_up', 'x1');
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: user_sync_apply ran for an authenticated claim';
  end if;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

rollback;
