-- 130: staff are not alerted about automated test jobs.
--
-- Every merge into redesigned-2.0 runs the end-to-end tests against this project. Each run leaves one
-- disputed job named "[e2e] dispute" for an admin to decide, and that sent "Dispute opened: [e2e] dispute"
-- to every real staff member (the owner included), a phone push each time. The test accounts' own bells
-- are tidied by the tests; the staff ones were not, so they piled up with wording a customer cannot read.
--
-- Staff alerts about a job whose name starts with "[e2e" are now skipped. The dispute itself still shows
-- in the admin queue; only the bell and push stop. Same function as migration 089 plus one early return.
-- Additive: one function replaced, nothing dropped, no signature change.

create or replace function private.notify_staff(p_area text, p_title text, p_body text, p_except uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if coalesce(p_title, '') like '%[e2e%' or coalesce(p_body, '') like '%[e2e%' then
    return; -- an automated test job, nothing for a person to act on
  end if;
  for r in
    select ur.user_id
      from public.user_roles ur
      left join public.admin_staff s on s.user_id = ur.user_id
     where ur.role = 'admin'
       and coalesce(s.notify, true)
       and ur.user_id is distinct from p_except
       and (coalesce(s.staff_role, 'admin') = 'admin'
            or (p_area = 'money' and s.staff_role = 'finance')
            or (p_area = 'people' and s.staff_role = 'support'))
  loop
    perform private.notify(r.user_id, 'staff_alert', p_title, p_body, null, null);
  end loop;
exception when others then
  null; -- an alert must never stop the action that caused it
end;
$$;
revoke all on function private.notify_staff(text, text, text, uuid) from public, anon, authenticated;
