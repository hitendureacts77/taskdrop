-- Audit log, ad-impression throttle, admin-effect notifications, atomic OTP cap.
--
-- Audit findings F-07, F-09, F-10 and sync finding S-01
-- (docs/audit/SECURITY_FINDINGS.md, docs/audit/SYNC_MATRIX.md). These
-- assertions FAIL against migrations <= 075 and PASS against 076 / 077.
--
-- Everything runs inside one transaction that is rolled back, so the test
-- leaves no rows behind.
--
-- is_admin() is overridden for this transaction only: it normally returns true
-- for any session running as postgres (the operator rule, migration 040), which
-- would make every "ordinary user" below an admin.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/audit_and_throttle.test.sql

begin;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = 'public' as
$$ select coalesce(private.has_role(auth.uid(), 'admin'), false) $$;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- An admin session that has verified an authenticator code (migration 080 gates
-- admin money/settings changes on aal2).
create or replace function pg_temp.become_aal2(p_user uuid) returns void
language plpgsql as $
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_admin  uuid := gen_random_uuid();
  v_poster uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_task   uuid;
  v_promo  uuid;
  v_ticket uuid;
  v_n      bigint;
  v_m      bigint;
  v_row    record;
  v_refused boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'audit+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_poster), (v_viewer)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_admin, 'Audit Admin'), (v_poster, 'Ad Owner'), (v_viewer, 'Ad Viewer')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_admin), (v_poster), (v_viewer) on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  -- ---- F-10: an admin's change is recorded, with before and after -----------
  perform pg_temp.become_aal2(v_admin);
  update public.settings set value = to_jsonb((value::text::numeric + 1)) where key = 'min_topup_minor';
  perform pg_temp.as_owner();
  select * into v_row from public.admin_audit_log
   where target_table = 'settings' and target_id = 'min_topup_minor' and actor = v_admin
   order by id desc limit 1;
  if v_row.id is null then raise exception 'FAIL F-10: an admin changing a setting left no audit row'; end if;
  if v_row.actor_kind <> 'admin' or v_row.before is null or v_row.after is null then
    raise exception 'FAIL F-10: the audit row is missing its kind or before/after (%)', v_row;
  end if;

  -- an ordinary user editing their own profile is not audit noise
  select count(*) into v_n from public.admin_audit_log;
  perform pg_temp.become(v_viewer);
  update public.profiles set bio = 'hello' where id = v_viewer;
  perform pg_temp.as_owner();
  select count(*) into v_m from public.admin_audit_log;
  if v_m <> v_n then raise exception 'FAIL F-10: an ordinary profile edit was audited'; end if;

  -- append-only, for every role including the owner
  v_refused := false;
  begin update public.admin_audit_log set detail = 'x' where id = v_row.id; exception when others then v_refused := true; end;
  if not v_refused then raise exception 'FAIL F-10: an audit row could be updated'; end if;
  v_refused := false;
  begin delete from public.admin_audit_log where id = v_row.id; exception when others then v_refused := true; end;
  if not v_refused then raise exception 'FAIL F-10: an audit row could be deleted'; end if;

  -- readable by admins only
  perform pg_temp.become(v_admin);
  select count(*) into v_n from public.admin_audit_log;
  if v_n = 0 then raise exception 'FAIL F-10: an admin cannot read the audit log'; end if;
  v_refused := false;
  begin delete from public.admin_audit_log; exception when others then v_refused := true; end;
  if not v_refused then raise exception 'FAIL F-10: an admin could delete audit rows'; end if;
  perform public.admin_log_event('test.export', 'segment:1', '3 rows');
  perform pg_temp.become(v_viewer);
  select count(*) into v_n from public.admin_audit_log;
  if v_n <> 0 then raise exception 'FAIL F-10: a non-admin can read % audit rows', v_n; end if;
  v_refused := false;
  begin perform public.admin_log_event('x'); exception when others then v_refused := true; end;
  if not v_refused then raise exception 'FAIL F-10: a non-admin could write an audit event'; end if;

  -- ---- S-01: admin effects tell the user ------------------------------------
  perform pg_temp.as_owner();
  select count(*) into v_n from public.notifications where user_id = v_viewer;
  insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason)
  values (v_viewer, 5000, 0, 0, 'audit test');
  select count(*) into v_m from public.notifications where user_id = v_viewer;
  if v_m - v_n <> 1 then raise exception 'FAIL S-01: a wallet adjustment did not notify the user'; end if;

  insert into public.support_tickets (user_id, category, subject, status)
  values (v_viewer, 'other', 'audit test', 'waiting') returning id into v_ticket;
  select count(*) into v_n from public.notifications where user_id = v_viewer;
  perform pg_temp.become(v_admin);
  perform public.resolve_support_ticket(v_ticket);
  perform pg_temp.as_owner();
  select count(*) into v_m from public.notifications where user_id = v_viewer;
  if v_m - v_n <> 1 then raise exception 'FAIL S-01: an admin resolving a ticket did not notify the user'; end if;

  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    raise exception 'FAIL S-01: notifications is not in the realtime publication, so live updates never arrive';
  end if;

  -- ---- F-09: ad impressions cannot be farmed --------------------------------
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Sponsored', 100000, 240) returning id into v_task;
  insert into public.task_promotions (task_id, user_id, amount_minor, days, status, starts_at, ends_at, audience)
  values (v_task, v_poster, 100000, 1, 'active', now() - interval '1 hour', now() + interval '1 day', 'city')
  returning id into v_promo;
  if not exists (select 1 from public.ad_auction() where promotion_id = v_promo) then
    raise exception 'FAIL: the fixture promotion is not live in the auction';
  end if;

  perform pg_temp.become(v_poster);                    -- the advertiser, viewing their own ad
  perform public.record_ad_impression(v_task);
  perform public.record_ad_impression(v_task);
  perform pg_temp.become(v_viewer);                    -- one viewer hammering the RPC
  for i in 1..25 loop perform public.record_ad_impression(v_task); end loop;
  perform set_config('request.jwt.claims', '', true);  -- signed out
  perform public.record_ad_impression(v_task);
  perform pg_temp.as_owner();

  select count(*) into v_n from public.ad_events
   where promotion_id = v_promo and kind = 'impression' and viewer_id = v_poster;
  if v_n <> 0 then raise exception 'FAIL F-09: an advertiser was billed % times for their own views', v_n; end if;
  select count(*) into v_n from public.ad_events
   where promotion_id = v_promo and kind = 'impression' and viewer_id = v_viewer;
  if v_n <> 1 then raise exception 'FAIL F-09: one viewer was billed % impressions in a burst, expected 1', v_n; end if;
  select count(*) into v_n from public.ad_events where promotion_id = v_promo and kind = 'impression';
  if v_n <> 1 then raise exception 'FAIL F-09: % billable impressions in total, expected 1', v_n; end if;

  -- ---- F-07: the OTP guess cap is enforced by a single statement -------------
  insert into public.auth_codes (phone, code, attempts, expires_at, sends_in_window, window_started_at, last_sent_at)
  values ('9000000001', '123456', 3, now() + interval '10 minutes', 1, now(), now());
  select count(*) into v_n from public.consume_auth_attempt('9000000001', 5);   -- 3 -> 4
  select count(*) into v_m from public.consume_auth_attempt('9000000001', 5);   -- 4 -> 5
  if v_n <> 1 or v_m <> 1 then raise exception 'FAIL F-07: guesses under the cap were not counted (% / %)', v_n, v_m; end if;
  select count(*) into v_n from public.consume_auth_attempt('9000000001', 5);   -- at the cap
  if v_n <> 0 then raise exception 'FAIL F-07: a guess past the cap was still allowed'; end if;
  if (select attempts from public.auth_codes where phone = '9000000001') <> 5 then
    raise exception 'FAIL F-07: the counter moved past the cap';
  end if;
  select count(*) into v_n from public.consume_auth_attempt('9000000002', 5);   -- no code requested
  if v_n <> 0 then raise exception 'FAIL F-07: a number with no code returned a row'; end if;

  -- and nobody but the service role can call it
  perform pg_temp.become(v_viewer);
  v_refused := false;
  begin perform public.consume_auth_attempt('9000000001', 5); exception when insufficient_privilege then v_refused := true; end;
  if not v_refused then raise exception 'FAIL F-07: a signed-in user can call consume_auth_attempt'; end if;
  perform pg_temp.as_owner();

  raise notice 'audit_and_throttle: all assertions passed';
end;
$$;

rollback;
