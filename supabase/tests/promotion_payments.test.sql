-- Promotion payments and prices (migrations 110, 111 and 114).
--
-- A campaign is switched on only by a settled payment that was made for a
-- promotion, belongs to the caller and the campaign's task, covers the amount,
-- and has not already run another campaign. A top-up or an escrow payment must
-- not do it. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/promotion_payments.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_task   uuid;
  v_task2  uuid;
  v_promo  public.task_promotions;
  v_promo2 public.task_promotions;
  v_topup  uuid;
  v_escrow uuid;
  v_short  uuid;
  v_good   uuid;
  v_row    public.task_promotions;
  v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'promo+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_other)) as u(id);

  insert into public.profiles (id, display_name)
  values (v_poster, 'Promo Poster'), (v_other, 'Promo Other')
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (v_poster), (v_other)
  on conflict (user_id) do nothing;

  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'promo one', 100000, 240) returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'promo two', 100000, 240) returning id into v_task2;

  v_promo  := public.start_promotion(v_task, 3, 24000);
  v_promo2 := public.start_promotion(v_task2, 3, 24000);

  -- ---- the server's price list (migration 114) -----------------------------
  v_failed := false;
  begin perform public.start_promotion(v_task, 3, 12345);
  exception when others then v_failed := true; end;
  assert v_failed, 'a budget the server does not offer must be refused';
  v_failed := false;
  begin perform public.start_promotion(v_task, 5, 40000);
  exception when others then v_failed := true; end;
  assert v_failed, 'a length the server does not offer must be refused';

  -- ---- payments of the wrong kind or size are refused ---------------------
  perform pg_temp.as_operator();
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, null, 'topup', 500000, 'plink_topup', 'paid', now()) returning id into v_topup;
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task, 'escrow', 500000, 'plink_escrow', 'paid', now()) returning id into v_escrow;
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task, 'promotion', 23999, 'plink_short', 'paid', now()) returning id into v_short;

  perform pg_temp.become(v_poster);
  v_failed := false;
  begin perform public.activate_promotion(v_promo.id, v_topup);
  exception when others then v_failed := true; end;
  assert v_failed, 'a top-up must not switch on a campaign';

  v_failed := false;
  begin perform public.activate_promotion(v_promo.id, v_escrow);
  exception when others then v_failed := true; end;
  assert v_failed, 'an escrow payment must not switch on a campaign';

  v_failed := false;
  begin perform public.activate_promotion(v_promo.id, v_short);
  exception when others then v_failed := true; end;
  assert v_failed, 'a payment that does not cover the campaign must not switch it on';

  -- ---- the right payment does ---------------------------------------------
  perform pg_temp.as_operator();
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task, 'promotion', 24000, 'plink_good', 'paid', now()) returning id into v_good;

  perform pg_temp.become(v_poster);
  v_row := public.activate_promotion(v_promo.id, v_good);
  assert v_row.status = 'active' and v_row.payment_id = v_good, 'the right payment should switch the campaign on';
  v_row := public.activate_promotion(v_promo.id, v_good);
  assert v_row.status = 'active', 'activating again should be harmless';

  perform pg_temp.as_operator();
  assert (select credited_at from public.payments where id = v_good) is not null,
    'a spent promotion payment is marked credited, so the closeout check does not flag it';

  -- ---- one payment, one campaign; and not someone else's ------------------
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin perform public.activate_promotion(v_promo2.id, v_good);
  exception when others then v_failed := true; end;
  assert v_failed, 'a payment cannot run two campaigns (and it was for the other task)';

  perform pg_temp.become(v_other);
  v_failed := false;
  begin perform public.activate_promotion(v_promo2.id, v_good);
  exception when others then v_failed := true; end;
  assert v_failed, 'another account cannot activate someone else''s campaign';

  raise notice 'promotion_payments: all assertions passed';
end;
$$;

rollback;
