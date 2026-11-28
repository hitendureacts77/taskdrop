-- 242 — a new account is never named from its phone number (Ideas & feedback board).
--
-- A phone sign-up used to get the name "Tasker 0077" (the last four digits, set by the phone-auth function) or,
-- without that, the part of its synthetic email before the @, which is "p" plus the whole number. Both showed phone
-- digits. Now a name made from a phone address is 'New user' (both apps already treat that as "no name yet" and ask
-- for a real one in About you). The phone-auth function no longer sends a name either.
--
-- Forward only: names already saved are not touched. Same name, arguments and return type as 115.

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
        case
          when new.email ilike '%@privaterelay.appleid.com' then null
          when new.email ilike '%@phone.taskdrop.app' then null
          else nullif(split_part(new.email, '@', 1), '')
        end,
        'New user'
      ), 80)
    );
  insert into public.wallets (user_id) values (new.id);
  insert into public.user_roles (user_id, role) values (new.id, 'poster'), (new.id, 'worker');
  return new;
end $$;
