-- Undo for migration 141 (admin_marketplace_numbers). Emergency use only; the build never runs this.
-- Removes the function the migration added. Nothing else depends on it except the admin
-- Reports page, which shows its usual "setup needed" notice when the function is missing.
drop function if exists public.admin_marketplace_numbers(date, date);
