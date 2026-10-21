-- 115 — new accounts take their name from Google and Apple (Phase 4).
--
-- handle_new_user() named a new profile from display_name, else the part of
-- the email before the @. A Google or Apple sign-in carries the person's name
-- as full_name / name in the user metadata, which was ignored, and an Apple
-- "Hide my email" address (xyz@privaterelay.appleid.com) turned into a
-- meaningless name.
--
-- Order now: display_name, full_name, name, the email's first part (unless it
-- is an Apple relay address), 'New user'. Phone accounts are unchanged: their
-- synthetic email still gives the same name it always did, which both apps
-- already treat as "no name yet". Same name, arguments and return type; the
-- trigger on auth.users is untouched.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
    values (
      new.id,
      left(coalesce(
        nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
        nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
        nullif(btrim(new.raw_user_meta_data->>'name'), ''),
        case when new.email ilike '%@privaterelay.appleid.com' then null else nullif(split_part(new.email, '@', 1), '') end,
        'New user'
      ), 80)
    );
  insert into public.wallets (user_id) values (new.id);
  insert into public.user_roles (user_id, role) values (new.id, 'poster'), (new.id, 'worker');
  return new;
end $$;
