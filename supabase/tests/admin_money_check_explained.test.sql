-- Migrations 250 + 251: Money check "Mark explained" and the Plan B money moves list. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_money_check_explained.test.sql

begin;

create or replace function pg_temp.as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end;
$$;

do $$
declare
  v_admin  uuid := gen_random_uuid();
  v_plain  uuid := gen_random_uuid();
  v_ref    uuid := gen_random_uuid();
  v_n      integer;
  v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'mce250+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_plain)) as u(id);
  insert into public.profiles (id, display_name) values (v_admin, 'Admin 250'), (v_plain, 'Plain 250') on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  set local role authenticated;

  -- A customer cannot mark or read.
  perform pg_temp.as_user(v_plain);
  v_failed := false;
  begin
    perform public.admin_mark_money_check_explained('no_commission', 'task', v_ref, null, 'test payment');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a customer must not mark a money check line';
  v_failed := false;
  begin
    perform * from public.admin_money_check_explained(10);
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a customer must not read the notes';
  v_failed := false;
  begin
    perform * from public.admin_plan_b_moves(10);
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a customer must not read the money moves';

  -- An admin can.
  perform pg_temp.as_user(v_admin);
  v_failed := false;
  begin
    perform public.admin_mark_money_check_explained('no_commission', 'task', v_ref, null, 'x');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a note that is too short is refused';
  v_failed := false;
  begin
    perform public.admin_mark_money_check_explained('Bad Code;', 'task', v_ref, null, 'test payment');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'an odd check code is refused';

  perform public.admin_mark_money_check_explained('no_commission', 'task', v_ref, null, 'test payment');
  perform public.admin_mark_money_check_explained('no_commission', 'task', v_ref, null, 'test payment, done by hand');
  select count(*) into v_n from public.admin_money_check_explained(50) e where e.ref_id = v_ref;
  assert v_n = 1, 'a second note replaces the first';
  select count(*) into v_n from public.admin_money_check_explained(50) e where e.ref_id = v_ref and e.note = 'test payment, done by hand';
  assert v_n = 1, 'the newest note is kept';

  -- Lines that point at nothing are told apart by their time.
  perform public.admin_mark_money_check_explained('never_paid', 'payment', null, '2026-11-01T10:00:00Z', 'link never opened');
  perform public.admin_mark_money_check_explained('never_paid', 'payment', null, '2026-11-02T10:00:00Z', 'link never opened');
  select count(*) into v_n from public.admin_money_check_explained(50) e where e.check_code = 'never_paid' and e.ref_id is null;
  assert v_n = 2, 'two lines without a reference keep two notes';

  reset role;
  select count(*) into v_n from public.admin_audit_log where action = 'money_check_explained' and actor = v_admin;
  assert v_n = 4, 'every note goes to the audit log';
  set local role authenticated;
  perform pg_temp.as_user(v_admin);
  perform * from public.admin_plan_b_moves(10);
  reset role;
end;
$$;

rollback;
