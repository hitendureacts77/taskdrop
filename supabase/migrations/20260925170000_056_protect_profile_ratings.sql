-- 056: people cannot edit their own ratings.
--
-- profiles is updatable by its owner (name, bio, skills, location...), and
-- the table-level grant also covered the rating columns -- so anyone could
-- give themselves 5 stars from the browser console. Ratings and the referral
-- code are written only by server functions (submit_review etc.), which run
-- as the table owner; a direct edit from a signed-in client is refused.

create or replace function private.guard_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.worker_rating_avg   is distinct from old.worker_rating_avg or
       new.worker_rating_count is distinct from old.worker_rating_count or
       new.poster_rating_avg   is distinct from old.poster_rating_avg or
       new.poster_rating_count is distinct from old.poster_rating_count or
       new.referral_code       is distinct from old.referral_code or
       new.id                  is distinct from old.id or
       new.created_at          is distinct from old.created_at
     ) then
    raise exception 'Ratings and account fields are set by TaskDrop, not edited directly';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function private.guard_profile_columns();
