-- 053: development sign-in codes for every number.
--
-- SMS (MSG91) is not configured yet, so phone-auth can't text anyone. With
-- this on, it hands back a fresh code for any number and the app fills it in.
-- That means anyone who knows a phone number can sign in as it: this is for
-- development only. phone-auth ignores it automatically once MSG91 keys are
-- set, and it must be switched off before real people use the app:
--
--   update public.settings set value = 'false'::jsonb, updated_at = now()
--    where key = 'dev_otp_for_all';

insert into public.settings (key, value, updated_at)
values ('dev_otp_for_all', 'true'::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now();
