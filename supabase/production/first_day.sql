-- Production's first-day safety (plan task 5.9; holes H1, H3, H15; 2.18 part H).
--
-- NOT a migration, on purpose: migrations also run on staging, where these shortcuts are meant to be on.
-- scripts/production-first-day.mjs runs this file on PRODUCTION ONLY, after every approved deploy
-- (.github/workflows/production-database.yml), then supabase/lockdown/gateway_only.sql, then checks the result.
-- CI also rehearses both on its throwaway database (the `database` job), so a broken statement fails there first.
--
-- Every statement is idempotent: running it again changes nothing that is already right. It only switches
-- things to their SAFE value, so a deploy can never switch a test shortcut back on.
--
-- What it does NOT set: the money settings in task 5.9's table. A fresh database already gets every one of them
-- from the migrations (001, 059, 064, 066, 079, 114, 133, 086), so production-first-day.mjs only checks them.
-- push_via_inngest stays as the migrations leave it (off) until Inngest is synced for production
-- (supabase/cutover/inngest_background_jobs.sql, an owner-approved step in docs/PRODUCTION_GO.md).

-- H1 / H15: migration 053 turns "any phone number signs in with an on-screen code" ON. Off here.
insert into public.settings (key, value, updated_at)
values ('dev_otp_for_all', 'false'::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now()
 where public.settings.value is distinct from excluded.value;

-- Admin money actions need the authenticator code (migration 080). Switching it on never needs a code.
insert into public.settings (key, value, updated_at)
values ('admin_require_mfa', 'true'::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now()
 where public.settings.value is distinct from excluded.value;

-- Migration 127: 'production' makes the money functions refuse any rzp_test_ key and removes the staging ribbon.
update public.app_controls
   set environment = 'production'
 where platform = 'all' and environment is distinct from 'production';

-- 2.18 H: the GraphQL door. Supabase installs pg_graphql on a new project; the app never uses it.
-- (Undo, only if a future feature needs it: create extension pg_graphql;)
drop extension if exists pg_graphql;

-- The signed-out role gets no table rights at all in public (the app reads through `api` as the signed-in caller,
-- and guests through `api`'s own server-side reads). The migrations already revoke these one by one; this is the
-- belt for a table a future migration forgets. Functions are left alone: one is open to anon on purpose.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
