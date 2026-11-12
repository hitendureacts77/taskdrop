-- A paid promotion switches on from the payment alone (debug round 1, W1; migration 177).
--
-- The payment webhook and the razorpay function's sync call activate_promotion_from_payment, so a
-- payer who closes the tab still gets the campaign. It switches the right campaign on once, asking
-- again is harmless, the app's own activate_promotion still works after it, it ignores payments that
-- are not settled promotions, and only the service role may call it. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/promotion_from_payment.test.sql

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
begin
  assert not has_function_privilege('authenticated', 'public.activate_promotion_from_payment(uuid)', 'EXECUTE'),
    'activate_promotion_from_payment is service-role only (authenticated)';
  assert not has_function_privilege('anon', 'public.activate_promotion_from_payment(uuid)', 'EXECUTE'),
    'activate_promotion_from_payment is service-role only (anon)';
  assert has_function_privilege('service_role', 'public.activate_promotion_from_payment(uuid)', 'EXECUTE'),
    'the webhook (service role) must be able to call activate_promotion_from_payment';
end;
$$;

do $$
declare
  v_poster  uuid := gen_random_uuid();
  v_task    uuid;
  v_task2   uuid;
  v_promo   public.task_promotions;
  v_promo2  public.task_promotions;
  v_pay     uuid;
  v_unpaid  uuid;
  v_other   uuid;
  v_row     public.task_promotions;
  v_ends    timestamptz;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_poster, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'promopay+' || v_poster || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_poster, 'Promo Payer') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster) on conflict (user_id) do nothing;

  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'promo from payment', 100000, 240) returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'promo from an older link', 100000, 240) returning id into v_task2;
  v_promo  := public.start_promotion(v_task, 3, 24000);
  v_promo2 := public.start_promotion(v_task2, 3, 24000);

  perform pg_temp.as_operator();

  -- Not settled yet: nothing happens.
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, promotion_id)
  values (v_poster, v_task, 'promotion', 24000, 'plink_unpaid', 'created', v_promo.id) returning id into v_unpaid;
  v_row := public.activate_promotion_from_payment(v_unpaid);
  assert v_row.id is null, 'an unsettled payment must not switch a campaign on';
  assert (select status from public.task_promotions where id = v_promo.id) = 'pending', 'still pending';

  -- Settled, for the campaign the link was made for: it switches on, once.
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at, promotion_id)
  values (v_poster, v_task, 'promotion', 24000, 'plink_paid', 'paid', now(), v_promo.id) returning id into v_pay;
  v_row := public.activate_promotion_from_payment(v_pay);
  assert v_row.id = v_promo.id and v_row.status = 'active' and v_row.payment_id = v_pay,
    'the campaign the link was made for switches on';
  assert (select status from public.task_promotions where id = v_promo2.id) = 'pending',
    'the other task''s campaign is untouched';
  assert (select credited_at from public.payments where id = v_pay) is not null,
    'a spent promotion payment is marked credited';
  v_ends := v_row.ends_at;

  v_row := public.activate_promotion_from_payment(v_pay);
  assert v_row.id = v_promo.id and v_row.ends_at = v_ends, 'asking again is harmless and does not extend it';

  -- The app's own call after the webhook: harmless.
  perform pg_temp.become(v_poster);
  v_row := public.activate_promotion(v_promo.id, v_pay);
  assert v_row.status = 'active' and v_row.ends_at = v_ends, 'the app activating again is harmless';

  -- A top-up is never a promotion.
  perform pg_temp.as_operator();
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, null, 'topup', 24000, 'plink_topup_x', 'paid', now()) returning id into v_other;
  v_row := public.activate_promotion_from_payment(v_other);
  assert v_row.id is null, 'a top-up must not switch a campaign on';

  -- A link made before payments.promotion_id: found by person, task and amount.
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task2, 'promotion', 24000, 'plink_legacy', 'paid', now()) returning id into v_other;
  v_row := public.activate_promotion_from_payment(v_other);
  assert v_row.id = v_promo2.id and v_row.status = 'active' and v_row.payment_id = v_other,
    'an older promotion payment switches on the matching pending campaign';

  -- With nothing left to run, a further payment does nothing.
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v_poster, v_task2, 'promotion', 24000, 'plink_spare', 'paid', now()) returning id into v_other;
  v_row := public.activate_promotion_from_payment(v_other);
  assert v_row.id is null, 'no pending campaign: nothing to switch on';

  raise notice 'promotion_from_payment: all assertions passed';
end;
$$;

rollback;
