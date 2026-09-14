-- Campaign lifecycle. Writes to task_promotions happen only here: the table has
-- no INSERT or UPDATE policy, because a client that could insert its own
-- 'active' row would be handing itself free placement.
--
-- Open a campaign. Pending until the money lands.
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
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Choose between 1 and 30 days';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Choose a budget';
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

-- Called once the payment for a campaign has settled.
create or replace function public.activate_promotion(p_promotion_id uuid, p_payment_id uuid)
returns public.task_promotions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.task_promotions;
  v_paid boolean;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_row from public.task_promotions
   where id = p_promotion_id for update;
  if not found then
    raise exception 'That campaign no longer exists';
  end if;
  if v_row.user_id <> v_me then
    raise exception 'That is not your campaign';
  end if;
  -- Already running: say so rather than extending it on a repeated call.
  if v_row.status = 'active' then
    return v_row;
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That campaign is no longer pending';
  end if;

  -- The payment has to be real, settled, and the caller's own. This is the
  -- whole gate between "opened a payment page" and "is being advertised".
  select (p.status = 'paid') into v_paid
    from public.payments p
   where p.id = p_payment_id and p.user_id = v_me;
  if not coalesce(v_paid, false) then
    raise exception 'That payment has not settled yet';
  end if;

  update public.task_promotions
     set status = 'active',
         payment_id = p_payment_id,
         starts_at = now(),
         ends_at = now() + make_interval(days => v_row.days),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- Stop a campaign.
create or replace function public.cancel_promotion(p_promotion_id uuid)
returns public.task_promotions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.task_promotions;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_row from public.task_promotions
   where id = p_promotion_id for update;
  if not found then
    raise exception 'That campaign no longer exists';
  end if;
  if v_row.user_id <> v_me then
    raise exception 'That is not your campaign';
  end if;
  if v_row.status not in ('pending', 'active') then
    raise exception 'That campaign has already finished';
  end if;

  update public.task_promotions
     set status = 'cancelled', updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.start_promotion(uuid, integer, bigint) from anon, public;
revoke all on function public.activate_promotion(uuid, uuid) from anon, public;
revoke all on function public.cancel_promotion(uuid) from anon, public;
grant execute on function public.start_promotion(uuid, integer, bigint) to authenticated;
grant execute on function public.activate_promotion(uuid, uuid) to authenticated;
grant execute on function public.cancel_promotion(uuid) to authenticated;
