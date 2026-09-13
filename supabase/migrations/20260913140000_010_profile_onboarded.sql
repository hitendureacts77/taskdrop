-- 010_profile_onboarded
--
-- Signing in sent every user through profile setup, because nothing recorded
-- whether they had already done it. Inferring it from the display name or the
-- location would misfire on anyone who legitimately left a field alone, so the
-- fact gets its own column.

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

-- Everyone who already has a wallet has been using the app; don't send them
-- back through setup on their next sign-in.
update public.profiles p
   set onboarded_at = p.created_at
  from public.wallets w
 where w.user_id = p.id
   and p.onboarded_at is null;
