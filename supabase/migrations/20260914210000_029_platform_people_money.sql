-- Money by person, for the owner console.
--
-- The stats that used to sit here counted heads: active, new, average rating.
-- None of it told the owner anything they could act on. What an operator
-- actually wants is who is spending, who is earning, and what the business
-- owes each of them right now.
--
-- One row per person the money has touched. Admins only: these are other
-- people's financial positions.
create or replace function public.platform_people_money(p_days integer default 30)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_since      timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_commission numeric := private.setting_num('worker_commission_pct', 0.20);
  v_out        jsonb;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;

  with spent as (
    -- What each poster has actually paid for completed work in the window.
    -- funded_at is required: a task nobody paid for is not spending.
    select t.poster_id as user_id, sum(t.locked_minor) as minor
      from public.tasks t
     where t.status in ('COMPLETED', 'AUTO_COMPLETED')
       and t.completed_at >= v_since and t.funded_at is not null
     group by t.poster_id
  ),
  earned as (
    -- What each worker took home, after commission.
    select a.worker_id as user_id,
           sum(round(t.locked_minor * (1 - v_commission))) as minor
      from public.assignments a
      join public.tasks t on t.id = a.task_id
     where t.status in ('COMPLETED', 'AUTO_COMPLETED')
       and t.completed_at >= v_since and t.funded_at is not null
     group by a.worker_id
  ),
  escrowed as (
    -- Their money in live escrow right now. Not windowed: a balance, not a flow.
    select t.poster_id as user_id, sum(a.escrow_minor) as minor
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
           coalesce(s.minor, 0)::bigint   as spent_minor,
           coalesce(e.minor, 0)::bigint   as earned_minor,
           coalesce(esc.minor, 0)::bigint as in_escrow_minor,
           -- What TaskDrop owes them today: withdrawable plus still clearing.
           coalesce(w.balance_minor, 0)::bigint
             + coalesce(w.clearing_minor, 0)::bigint as wallet_minor,
           (coalesce(e.minor, 0) - coalesce(s.minor, 0))::bigint as net_minor,
           (coalesce(s.minor, 0) + coalesce(e.minor, 0))::bigint as volume_minor
      from public.profiles p
      left join spent    s   on s.user_id   = p.id
      left join earned   e   on e.user_id   = p.id
      left join escrowed esc on esc.user_id = p.id
      left join public.wallets w on w.user_id = p.id
     -- Only people the money has touched; a signed-up account that has done
     -- nothing is noise in a financial view.
     where coalesce(s.minor, 0) > 0
        or coalesce(e.minor, 0) > 0
        or coalesce(esc.minor, 0) > 0
        or coalesce(w.balance_minor, 0) + coalesce(w.clearing_minor, 0) > 0
     limit 50
  ) x;

  return v_out;
end;
$fn$;

revoke all on function public.platform_people_money(integer) from public, anon;
grant execute on function public.platform_people_money(integer) to authenticated;
