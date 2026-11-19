-- Full undo of migration 193 (Plan B money flow). NOT a migration: run by hand, only if the owner asks.
--
-- The quick undo is one setting and needs nothing here:
--   update public.settings set value = to_jsonb('wallet'::text) where key = 'money_flow';
-- Every changed function then runs today's wallet path again.
--
-- This file also removes the new tables, settings and functions it safely can. The changed function bodies
-- (lock_bid, auto_accept_bid, pay_task_from_wallet, credit_topup, confirm_release, auto_complete_due,
-- cancel_task, admin_resolve_dispute) are left as they are: they call the helpers below only on their
-- Plan B branches, so the helpers are replaced by wallet-only stubs instead of being dropped.
--
-- Refuses to run while any hold still has money at Razorpay (held or waiting to move): settle those first.

begin;

do $$
begin
  if exists (select 1 from public.task_holds
              where status in ('held', 'release_asked', 'refund_asked', 'split_asked', 'failed')) then
    raise exception 'Some Plan B holds still have money at the payment company. Settle them before undoing 193.';
  end if;
end $$;

update public.settings set value = to_jsonb('wallet'::text) where key = 'money_flow';

-- Stubs the changed functions can still call: Plan B is off and no hold exists.
create or replace function private.plan_b_on() returns boolean language sql stable as $$ select false $$;
create or replace function private.payee_ready(p_user uuid) returns boolean language sql stable as $$ select false $$;

-- New public functions.
drop function if exists public.plan_b_checkout_terms(uuid, uuid);
drop function if exists public.plan_b_set_order(uuid, text, text);
drop function if exists public.plan_b_mark_paid(text, text, text, bigint);
drop function if exists public.plan_b_claim_move(uuid);
drop function if exists public.plan_b_record_move(uuid, text, boolean, text, text);
drop function if exists public.plan_b_moves_due(integer);
drop function if exists public.plan_b_expire_unpaid();
drop function if exists public.plan_b_save_payee(uuid, text, text, text, text, text, text);
drop function if exists public.plan_b_payee_status(text, text, text, text);
drop function if exists public.plan_b_first_webhook(text, text, text);
drop function if exists public.record_money_match(date, text, bigint, jsonb);
drop function if exists public.plan_b_config();
drop function if exists public.my_money_mode();
drop function if exists public.my_task_hold(uuid);
drop function if exists public.my_money_ledger(integer);
drop function if exists public.admin_set_money_paused(boolean, text);
drop function if exists public.admin_plan_b_overview();
drop function if exists public.admin_plan_b_retry_move(uuid, text);

-- Kept on purpose: the table public.task_holds (empty by now) and the private helpers that use its row
-- type (task_hold, plan_b_open_hold, plan_b_ask_release, plan_b_ask_refund, ledger_add, plan_b_amounts,
-- money_paused, money_provider, assert_service). The changed bodies declare "v_hold public.task_holds",
-- and plpgsql checks declared types when a function is first called, so dropping the table would break
-- confirm_release, cancel_task and the rest even on the wallet path. To remove them too, first restore
-- the bodies from migrations 167, 148, 128, 066 and 063.
drop table if exists public.money_webhook_events;
drop table if exists public.money_match_runs;
drop table if exists public.money_ledger;
drop function if exists private.money_ledger_append_only();
drop table if exists public.payout_accounts;

delete from public.settings where key in ('money_flow', 'money_provider', 'money_paused', 'plan_b_unpaid_hours');

commit;
