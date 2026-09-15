-- Money by person, on one basis this time.
--
-- The first attempt mixed a windowed flow with an all-time balance, so "owed
-- out" came out larger than everything workers had ever earned. This one is
-- all-time throughout, and every row satisfies a stated identity:
--
--     earned = paid out + still owed
--
-- If that ever fails to hold, the row is flagged rather than quietly shown, so
-- a discrepancy surfaces here instead of in someone's bank account.
--
-- Admins only: these are other people's financial positions.
create or replace function public.people_money()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_commission numeric := private.setting_num('worker_commission_pct', 0.20);
  v_out jsonb;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;

  with spent as (
    select t.poster_id as user_id, sum(t.locked_minor)::bigint as minor
      from public.tasks t
     where t.status in ('COMPLETED', 'AUTO_COMPLETED') and t.funded_at is not null
     group by t.poster_id
  ),
  earned as (
    select a.worker_id as user_id,
           sum(round(t.locked_minor * (1 - v_commission)))::bigint as minor
      from public.assignments a
      join public.tasks t on t.id = a.task_id
     where t.status in ('COMPLETED', 'AUTO_COMPLETED') and t.funded_at is not null
     group by a.worker_id
  ),
  withdrawn as (
    select o.user_id, sum(o.amount_minor)::bigint as minor
      from public.payouts o where o.status = 'paid' group by o.user_id
  ),
  in_flight as (
    -- Requested or being sent: already out of the wallet, not yet in a bank.
    select o.user_id, sum(o.amount_minor)::bigint as minor
      from public.payouts o
     where o.status in ('requested', 'processing') group by o.user_id
  ),
  escrowed as (
    select t.poster_id as user_id, sum(a.escrow_minor)::bigint as minor
      from public.assignments a
      join public.tasks t on t.id = a.task_id
     where a.status in ('assigned', 'started') and t.funded_at is not null
     group by t.poster_id
  )
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.volume_minor desc), '[]'::jsonb)
    into v_out
  from (
    select p.id as user_id,
           p.display_name as name,
           coalesce(s.minor, 0)  as spent_minor,
           coalesce(e.minor, 0)  as earned_minor,
           coalesce(pd.minor, 0) as paid_out_minor,
           coalesce(w.balance_minor, 0) + coalesce(w.clearing_minor, 0)
             + coalesce(fl.minor, 0) as owed_minor,
           coalesce(esc.minor, 0) as in_escrow_minor,
           -- The identity above. True means the row adds up.
           (coalesce(e.minor, 0) = coalesce(pd.minor, 0)
              + coalesce(w.balance_minor, 0) + coalesce(w.clearing_minor, 0)
              + coalesce(fl.minor, 0)) as reconciles,
           (coalesce(s.minor, 0) + coalesce(e.minor, 0)) as volume_minor
      from public.profiles p
      left join spent     s   on s.user_id   = p.id
      left join earned    e   on e.user_id   = p.id
      left join withdrawn pd  on pd.user_id  = p.id
      left join in_flight fl  on fl.user_id  = p.id
      left join escrowed  esc on esc.user_id = p.id
      left join public.wallets w on w.user_id = p.id
     where coalesce(s.minor, 0) > 0
        or coalesce(e.minor, 0) > 0
        or coalesce(esc.minor, 0) > 0
        or coalesce(w.balance_minor, 0) + coalesce(w.clearing_minor, 0) > 0
     limit 50
  ) x;

  return v_out;
end;
$fn$;

revoke all on function public.people_money() from public, anon;
grant execute on function public.people_money() to authenticated;
