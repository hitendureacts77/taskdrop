-- 114 — promotion prices come from settings, and start_promotion checks them (Phase 3).
--
-- The app offered three lengths (1, 3, 7 days) and a few daily budgets, but the
-- server accepted any budget from 1 paisa up, so a campaign could be bought
-- for whatever the caller sent. The allowed lengths and daily budgets now live
-- in `settings` (the admin can change them) and start_promotion refuses
-- anything else: the total must be exactly one allowed daily budget times one
-- allowed length. The tiers below are the ones both the old and the new app
-- already show, so neither sees a refusal.
--
-- Same name, arguments and return type as migration 022.

insert into public.settings (key, value) values
  ('promotion_daily_budgets_minor', '[5000, 8000, 15000, 30000]'::jsonb),
  ('promotion_durations_days',      '[1, 3, 7]'::jsonb)
on conflict (key) do nothing;

create or replace function public.start_promotion(
  p_task_id uuid,
  p_days integer,
  p_amount_minor bigint
)
returns public.task_promotions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me   uuid := auth.uid();
  v_task public.tasks;
  v_row  public.task_promotions;
  v_lengths jsonb := coalesce((select value from public.settings where key = 'promotion_durations_days'), '[1, 3, 7]'::jsonb);
  v_budgets jsonb := coalesce((select value from public.settings where key = 'promotion_daily_budgets_minor'), '[5000, 8000, 15000, 30000]'::jsonb);
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  -- A setting an admin saved in the wrong shape falls back to the built-in tiers
  -- instead of stopping every purchase with a raw cast error.
  if jsonb_typeof(v_lengths) <> 'array' then
    v_lengths := '[1, 3, 7]'::jsonb;
  elsif exists (select 1 from jsonb_array_elements_text(v_lengths) e where e !~ '^[0-9]{1,4}$') then
    v_lengths := '[1, 3, 7]'::jsonb;
  end if;
  if jsonb_typeof(v_budgets) <> 'array' then
    v_budgets := '[5000, 8000, 15000, 30000]'::jsonb;
  elsif exists (select 1 from jsonb_array_elements_text(v_budgets) e where e !~ '^[0-9]{1,12}$') then
    v_budgets := '[5000, 8000, 15000, 30000]'::jsonb;
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Choose between 1 and 30 days';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Choose a budget';
  end if;
  -- The price list is the server's: a length and a daily budget it offers.
  if not exists (select 1 from jsonb_array_elements_text(v_lengths) l where l::int = p_days) then
    raise exception 'That campaign length is not offered';
  end if;
  if p_amount_minor % p_days <> 0
     or not exists (select 1 from jsonb_array_elements_text(v_budgets) b where b::bigint = p_amount_minor / p_days) then
    raise exception 'That budget is not offered';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'That task no longer exists';
  end if;
  -- Promoting someone else's listing is not a thing.
  if v_task.poster_id <> v_me then
    raise exception 'That is not your task';
  end if;

  -- One live campaign per task. Otherwise the same listing can be paid for
  -- twice over and occupy the sponsored slot against itself.
  if exists (
    select 1 from public.task_promotions
    where task_id = p_task_id and status in ('pending', 'active')
  ) then
    raise exception 'This task already has a campaign running';
  end if;

  insert into public.task_promotions (task_id, user_id, amount_minor, days)
  values (p_task_id, v_me, p_amount_minor, p_days)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.start_promotion(uuid, integer, bigint) from anon, public;
grant execute on function public.start_promotion(uuid, integer, bigint) to authenticated;
