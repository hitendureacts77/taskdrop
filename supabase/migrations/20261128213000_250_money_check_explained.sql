-- 250: Money check "Mark explained" (admin design v2, work package WP1, F105/F108).
--
-- The Money check (admin_reconcile) lists things in TaskDrop's own books that don't add up. Some of
-- them have a known reason (a test payment, a refund done by hand in the Razorpay dashboard). Staff
-- who may handle money can now write what happened; the line then leaves the "What to look at" list
-- and the note goes to the audit log. Nothing about money changes: this is a note, not a correction.
--
-- A line is identified by its check code + what it points at (job, withdrawal, payment). Lines that
-- point at nothing (ref_id null) also keep their time, so one note never hides a different line.

create table if not exists private.money_check_explained (
  id           uuid primary key default gen_random_uuid(),
  check_code   text not null check (char_length(check_code) between 1 and 60),
  ref_type     text not null default '' check (char_length(ref_type) <= 40),
  ref_id       uuid,
  at           timestamptz,
  note         text not null check (char_length(note) between 3 and 500),
  explained_by uuid not null,
  explained_at timestamptz not null default now()
);
-- One note per line: a second note replaces the first (the audit log keeps both).
create unique index if not exists money_check_explained_line
  on private.money_check_explained (check_code, ref_type, coalesce(ref_id::text, ''), coalesce(at, 'epoch'::timestamptz))
  ;
alter table private.money_check_explained enable row level security;
revoke all on table private.money_check_explained from public, anon, authenticated;

-- Write: money staff only (Admin, Finance), same guard as every other money action.
create or replace function public.admin_mark_money_check_explained(
  p_check_code text, p_ref_type text, p_ref_id uuid, p_at timestamptz, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_note  text := btrim(coalesce(p_note, ''));
  v_code  text := btrim(coalesce(p_check_code, ''));
  v_type  text := btrim(coalesce(p_ref_type, ''));
  v_at    timestamptz := case when p_ref_id is null then p_at else null end;
begin
  perform private.assert_not_money_blind();
  v_actor := private.assert_money_staff();
  if v_code !~ '^[a-z0-9_]{1,60}$' then raise exception 'That check is not known'; end if;
  if v_type !~ '^[a-z0-9_]{0,40}$' then raise exception 'That check line is not known'; end if;
  if char_length(v_note) < 3 then raise exception 'Write what happened (at least a few words)'; end if;
  v_note := left(v_note, 500);

  insert into private.money_check_explained as e (check_code, ref_type, ref_id, at, note, explained_by)
  values (v_code, v_type, p_ref_id, v_at, v_note, v_actor)
  on conflict (check_code, ref_type, coalesce(ref_id::text, ''), coalesce(at, 'epoch'::timestamptz))
  do update set note = excluded.note, explained_by = excluded.explained_by, explained_at = now();

  perform public.admin_log_event('money_check_explained',
    left(v_code || ':' || coalesce(nullif(v_type, ''), 'line') || ':' || coalesce(p_ref_id::text, coalesce(v_at::text, 'none')), 200),
    left('what happened: ' || v_note, 500));
end;
$$;

-- Read: the same people who can read the Money check (money staff, or Viewer), never money-blind roles.
create or replace function public.admin_money_check_explained(p_limit integer default 500)
returns table (check_code text, ref_type text, ref_id uuid, at timestamptz, note text, explained_by_name text, explained_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not coalesce(private.staff_can(auth.uid(), 'money') or private.staff_role(auth.uid()) = 'viewer', false) then
    raise exception 'Your staff role (%) can''t see this.', private.staff_role(auth.uid()) using errcode = '42501';
  end if;
  return query
    select e.check_code, e.ref_type, e.ref_id, e.at, e.note, p.display_name, e.explained_at
      from private.money_check_explained e
      left join public.profiles p on p.id = e.explained_by
     order by e.explained_at desc
     limit greatest(1, least(coalesce(p_limit, 500), 2000));
end;
$$;

revoke all on function public.admin_mark_money_check_explained(text, text, uuid, timestamptz, text) from public, anon;
revoke all on function public.admin_money_check_explained(integer) from public, anon;
grant execute on function public.admin_mark_money_check_explained(text, text, uuid, timestamptz, text) to authenticated;
grant execute on function public.admin_money_check_explained(integer) to authenticated;
