-- Manual payout mode, the staging way to pay workers: with payout_method
-- 'manual' (the default) a withdrawal is paid by a person and an admin marks it
-- done by hand. Nothing here touches RazorpayX: no payout is sent, no
-- RazorpayX id or attempt is recorded, and the worker still gets paid-out
-- status, a reference and a notification. A failed one puts the money back
-- exactly once, and a payout that already went to RazorpayX cannot be paid by
-- hand as well.
--
-- One transaction, rolled back. Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/manual_payout.test.sql

begin;

create or replace function pg_temp.become(p_user uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

do $$
declare
  v_admin   uuid := gen_random_uuid();
  v_worker  uuid := gen_random_uuid();
  v_p1      uuid;
  v_p2      uuid;
  v_p3      uuid;
  v_row     public.payouts;
  v_err     text;
  v_balance bigint;
  v_n       int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'manualpay+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_worker)) as u(id);
  insert into public.profiles (id, display_name) values (v_admin, 'MP Admin'), (v_worker, 'MP Worker')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';

  -- Manual mode, as on staging. RazorpayX is not involved anywhere below.
  insert into public.settings (key, value) values ('payout_method', '"manual"'::jsonb)
  on conflict (key) do update set value = '"manual"'::jsonb;

  -- The worker has already had the money taken out of the wallet by request_withdrawal.
  insert into public.wallets (user_id, balance_minor) values (v_worker, 0)
  on conflict (user_id) do update set balance_minor = 0;
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_worker, 150000, 'requested', 'UPI · mp@okaxis') returning id into v_p1;
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_worker, 70000, 'requested', 'UPI · mp@okaxis') returning id into v_p2;
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_worker, 30000, 'requested', 'UPI · mp@okaxis') returning id into v_p3;

  select * into v_row from public.payouts where id = v_p1;
  if v_row.via <> 'manual' then raise exception 'FAIL: a new withdrawal was not stamped manual (%)', v_row.via; end if;

  -- ---- the admin's queue shows it, untouched by RazorpayX ----------------------
  perform pg_temp.become(v_admin);
  select count(*) into v_n from public.admin_payout_queue() q
   where q.id = v_p1 and q.via = 'manual' and q.attempts = 0 and q.last_attempt_at is null and q.provider_payout_id is null;
  if v_n <> 1 then raise exception 'FAIL: the manual withdrawal is not in the admin queue as a manual, unsent row'; end if;

  -- ---- paid by hand: straight from requested to paid with the bank reference -----
  v_row := public.admin_mark_payout(v_p1, 'paid', 'UTR123456789');
  if v_row.status <> 'paid' or v_row.reference is distinct from 'UTR123456789' or v_row.via <> 'manual' then
    raise exception 'FAIL: marking a payout paid by hand did not stick (%, %, %)', v_row.status, v_row.reference, v_row.via;
  end if;
  if v_row.provider_payout_id is not null or v_row.sent_at is not null or v_row.last_attempt_at is not null then
    raise exception 'FAIL: a manual payout picked up RazorpayX fields';
  end if;
  perform pg_temp.as_owner();
  if not exists (select 1 from public.notifications where user_id = v_worker and kind = 'payout_paid') then
    raise exception 'FAIL: the worker was not told the money was sent';
  end if;
  select balance_minor into v_balance from public.wallets where user_id = v_worker;
  if v_balance <> 0 then raise exception 'FAIL: paying a withdrawal by hand changed the wallet (%)', v_balance; end if;

  -- paid is final: a second mark, in either direction, is refused
  perform pg_temp.become(v_admin);
  v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''paid'', ''again'')', v_p1));
  if coalesce(v_err, '') not like '%already paid%' then raise exception 'FAIL: a paid withdrawal could be marked paid again (%)', v_err; end if;
  v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''failed'', ''oops'')', v_p1));
  if coalesce(v_err, '') not like '%already paid%' then raise exception 'FAIL: a paid withdrawal could be failed (%)', v_err; end if;
  perform pg_temp.as_owner();
  select balance_minor into v_balance from public.wallets where user_id = v_worker;
  if v_balance <> 0 then raise exception 'FAIL: a refused change moved money (%)', v_balance; end if;

  -- ---- processing first, then paid (the two-step way) --------------------------
  perform pg_temp.become(v_admin);
  v_row := public.admin_mark_payout(v_p2, 'processing', null);
  if v_row.status <> 'processing' or v_row.via <> 'manual' then raise exception 'FAIL: processing by hand did not stick (%)', v_row.status; end if;
  v_row := public.admin_mark_payout(v_p2, 'paid', 'UTR987654321');
  if v_row.status <> 'paid' or v_row.reference is distinct from 'UTR987654321' then
    raise exception 'FAIL: processing then paid by hand did not stick (%, %)', v_row.status, v_row.reference;
  end if;

  -- ---- failed by hand: the money goes back to the worker exactly once -------------
  v_row := public.admin_mark_payout(v_p3, 'failed', 'Wrong UPI id');
  if v_row.status <> 'failed' or v_row.failure_note is distinct from 'Wrong UPI id' then
    raise exception 'FAIL: failing by hand did not stick (%)', v_row.status;
  end if;
  v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''failed'', ''twice'')', v_p3));
  if coalesce(v_err, '') not like '%already failed%' then raise exception 'FAIL: a failed withdrawal could be failed twice (%)', v_err; end if;
  perform pg_temp.as_owner();
  select balance_minor into v_balance from public.wallets where user_id = v_worker;
  if v_balance <> 30000 then raise exception 'FAIL: the failed withdrawal gave back % instead of 30000', v_balance; end if;

  -- ---- a payout RazorpayX already took cannot also be paid by hand --------------------
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_worker, 10000, 'processing', 'UPI · mp@okaxis') returning id into v_p1;
  update public.payouts set via = 'razorpayx', attempts = 1, last_attempt_at = now() where id = v_p1;
  perform pg_temp.become(v_admin);
  v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''paid'', ''x'')', v_p1));
  if coalesce(v_err, '') not like '%only RazorpayX can settle%' then
    raise exception 'FAIL: a payout sent to RazorpayX was marked paid by hand (%)', v_err;
  end if;

  raise notice 'manual_payout: all assertions passed';
end;
$$;

rollback;
