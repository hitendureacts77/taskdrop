-- 054: a record of demo rows, so demo data can be removed exactly.
--
-- supabase/seed/demo_account.sql fills an account with sample jobs, quotes,
-- earnings and reviews and logs every row it creates here;
-- supabase/seed/demo_account_remove.sql deletes precisely those rows.
create table if not exists private.demo_seed (
  tbl        text not null,
  row_id     uuid not null,
  created_at timestamptz not null default now(),
  primary key (tbl, row_id)
);
revoke all on private.demo_seed from public, anon, authenticated;
