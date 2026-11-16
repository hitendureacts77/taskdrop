-- 179: why a person earns on TaskDrop, asked in worker onboarding.
--
-- Someone who picks "Earn" or "Both" at sign-up (or sets up the Earn side later) is asked one more
-- question: are they here to get customers for a business they already run, to earn money doing
-- tasks like gig work, or something else? The answer lets TaskDrop tell the two kinds of helper
-- apart (copy, tips, the admin's numbers) without guessing from their bio.
--
--   business  - "Get customers for my business"
--   gig       - "Earn money doing tasks"
--   other     - "Something else"
--
-- Additive only (rule 2): a new nullable column, a check on its values, and the column write grant
-- the api's user client needs. Private to the owner (columns.ts PROFILE_PRIVATE): other people never
-- see it on a profile card.

alter table public.profiles
  add column if not exists earn_goal text;

alter table public.profiles
  drop constraint if exists profiles_earn_goal_check;
alter table public.profiles
  add constraint profiles_earn_goal_check
    check (earn_goal is null or earn_goal in ('business', 'gig', 'other'));

comment on column public.profiles.earn_goal is
  'Why this person earns on TaskDrop: business (sales for an existing business), gig (earn doing tasks) or other. Asked in worker onboarding; owner-only.';

grant update (earn_goal) on public.profiles to authenticated;
