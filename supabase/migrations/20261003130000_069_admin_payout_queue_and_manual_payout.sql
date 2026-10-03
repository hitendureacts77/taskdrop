-- 069 -- the Payouts page's two ways to pay, taken from section H of the (never
-- applied) 066 hardening migration:
--   * admin_payout_queue now returns how each withdrawal is being paid (via,
--     attempts, RazorpayX status ...) and refuses non-admins.
--   * admin_mark_payout: paying by hand now takes the withdrawal over from
--     RazorpayX (via = 'manual') so it can never go out twice, refuses to
--     settle one RazorpayX already has, and notifies the worker.

set check_function_bodies = off;

drop function if exists public.admin_payout_queue();

create or replace function public.admin_payout_queue()
returns table (
  id uuid, user_id uuid, display_name text, amount_minor bigint, status payout_status, snapshot text,
  kind text, upi_id text, account_name text, account_number text, ifsc text, requested_at timestamptz,
  via text, attempts integer, last_attempt_at timestamptz, provider_payout_id text, provider_status text,
  provider_status_at timestamptz, failure_note text, has_pan boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  return query
    select
      o.id, o.user_id, pr.display_name, o.amount_minor, o.status, o.destination,
      d.kind, d.upi_id, d.account_name, d.account_number, d.ifsc, o.created_at,
      o.via, o.attempts, o.last_attempt_at, o.provider_payout_id, o.provider_status,
      o.provider_status_at, o.failure_note,
      exists (select 1 from public.payout_profiles pp where pp.user_id = o.user_id)
    from public.payouts o
    left join public.profiles pr on pr.id = o.user_id
    left join lateral (
      select dd.*
        from public.payout_destinations dd
       where dd.user_id = o.user_id
         and (o.destination_id is null or dd.id = o.destination_id)
       order by (dd.upi_id is not distinct from o.destination) desc,
                dd.is_default desc,
                dd.created_at desc
       limit 1
    ) d on true
    where o.status in ('requested', 'processing')
    order by o.created_at;
end;
$fn$;

revoke all on function public.admin_payout_queue() from public, anon;
grant execute on function public.admin_payout_queue() to authenticated;

create or replace function public.admin_mark_payout(p_payout_id uuid, p_status text, p_note text default null::text)
returns payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_row public.payouts;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('processing', 'paid', 'failed') then
    raise exception 'A payout can be moved to processing, paid or failed';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'That payout no longer exists'; end if;
  if v_row.status in ('paid', 'failed', 'cancelled') then
    raise exception 'That payout is already %', v_row.status;
  end if;
  if v_row.via = 'razorpayx' and v_row.last_attempt_at is not null then
    raise exception 'This withdrawal was sent to RazorpayX, so only RazorpayX can settle it. Use "Check with RazorpayX".';
  end if;

  -- A person has taken it over: RazorpayX must never send it as well.
  update public.payouts
     set via = 'manual',
         status = p_status::public.payout_status,
         failure_note = case when p_status = 'failed' then p_note else failure_note end,
         reference = case when p_status = 'paid' then coalesce(p_note, reference) else reference end,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if p_status = 'failed' then
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
     where user_id = v_row.user_id;
    perform private.notify(v_row.user_id, 'payout_failed', 'Withdrawal could not be sent',
      coalesce(p_note, 'It could not be sent') || '. The money is back in your earnings.', null);
  elsif p_status = 'paid' then
    perform private.notify(v_row.user_id, 'payout_paid', 'Money sent to your account',
      'Your withdrawal of ' || to_char(v_row.amount_minor / 100.0, 'FM999999990.00') || ' rupees has been sent.', null);
  end if;

  return v_row;
end;
$function$;

revoke all on function public.admin_mark_payout(uuid, text, text) from public, anon;
grant execute on function public.admin_mark_payout(uuid, text, text) to authenticated;

