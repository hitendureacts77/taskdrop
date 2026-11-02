# Undo files

One file per migration, named like it (`141_marketplace_numbers.down.sql`): the exact SQL that removes what the migration added. Written when the migration is written (plan task 3.7, `docs/RELEASE.md` section 3).

- Only for emergencies, run by a person after checking what depends on it. The build never runs these.
- Migrations only add, so most undos are `drop function` / `drop table`. If a migration changed data and cannot be undone safely, its file says so and names the fix-forward or the restore.
- Migrations before 141 have no undo file; they were made before this rule.
