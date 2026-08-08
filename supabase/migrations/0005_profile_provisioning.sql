-- ===========================================================================
-- 0005_profile_provisioning.sql
--
-- ⚠️  WITHOUT THIS, LIVE MODE LOCKS OUT EVERY SINGLE USER.
--
-- The problem: `profiles.id` references `auth.users(id)`. A fresh Google sign-in
-- mints a random auth user id, and nothing was creating or linking a matching
-- profile row. So the first person to sign in — Anish — would authenticate
-- successfully, find no profile, and land on `/auth/no-profile`, whose only
-- control is "sign in with a different account". Every account, forever, with no
-- escape.
--
-- Nor could the seed help: it hardcodes UUIDs derived from strings like
-- "m-anish", which will never equal a real auth user's id.
--
-- The fix is to link by EMAIL on first sign-in. That also gives the invite flow
-- its natural shape: a Lead creates the profile row with the member's Stanford
-- address, and the two halves meet when that person first signs in.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Case-insensitive email matching
--
-- Google may return `Anish@Stanford.edu`. `lib/env.ts` lowercases before
-- checking the domain, but the CHECK constraint in 0001 was case-sensitive, so
-- an address the app accepted could be rejected by Postgres. Align them.
-- --------------------------------------------------------------------------

alter table profiles drop constraint if exists profiles_stanford_email;
alter table profiles add constraint profiles_stanford_email
  check (lower(email) like '%@stanford.edu');

-- Emails are identity here, so make duplicates impossible regardless of case.
--
-- `profiles.email` was declared `unique` in 0001, which Postgres implements as a
-- CONSTRAINT backed by an index. `drop index profiles_email_key` therefore fails
-- with "cannot drop index ... because constraint ... requires it" — the index is
-- owned by the constraint and can only be dropped through it.
alter table profiles drop constraint if exists profiles_email_key;
drop index if exists profiles_email_key;

create unique index if not exists profiles_email_lower_uniq
  on profiles (lower(email));

-- --------------------------------------------------------------------------
-- 2. Link an auth user to their pre-created profile on first sign-in
--
-- SECURITY DEFINER because it runs as the auth system, before the new user has
-- any privileges of their own.
-- --------------------------------------------------------------------------

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_profile profiles;
begin
  -- Only Stanford accounts. The app checks this too, and the CHECK constraint
  -- above is the last line — three layers, because this is the access model.
  if lower(new.email) not like '%@stanford.edu' then
    return new;
  end if;

  select * into invited_profile
  from profiles
  where lower(email) = lower(new.email)
  limit 1;

  if invited_profile.id is not null then
    -- Pre-created by whoever invited them. Repoint the row at the real auth id.
    if invited_profile.id <> new.id then
      update profiles
      set id = new.id,
          last_active_at = now()
      where id = invited_profile.id;
    else
      update profiles set last_active_at = now() where id = new.id;
    end if;
  else
    -- No invite. Create an INACTIVE profile rather than nothing at all.
    --
    -- This matters: with no row they'd hit /auth/no-profile, whose only option
    -- is to sign out. With an inactive row they hit /auth/inactive, which
    -- explains the situation and gives leadership something to activate — one
    -- click instead of re-running an invite.
    insert into profiles (id, email, full_name, global_role, status, joined_at)
    values (
      new.id,
      lower(new.email),
      coalesce(
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'name',
        split_part(new.email, '@', 1)
      ),
      'member',
      'inactive',
      current_date
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- --------------------------------------------------------------------------
-- 3. Keep last_active_at fresh
--
-- The RE-liveness check ("has this RE gone quiet for 14 days?") depends on this
-- column, and it would sit permanently null without something writing to it.
-- --------------------------------------------------------------------------

create or replace function touch_last_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
  set last_active_at = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_signin on auth.users;
create trigger on_auth_user_signin
  after update of last_sign_in_at on auth.users
  for each row
  when (new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute function touch_last_active();

-- --------------------------------------------------------------------------
-- 4. Bootstrap the first Co-Lead
--
-- Chicken-and-egg: only a Lead or Co-Lead can invite anyone, and after this
-- migration every new account is created inactive. Somebody has to be seeded by
-- hand, once.
--
-- Kelvin: uncomment and run this with Anish's real Stanford address BEFORE he
-- first signs in. After that he can invite everyone else through the app.
-- --------------------------------------------------------------------------

-- insert into profiles (id, email, full_name, global_role, status, joined_at)
-- values (
--   gen_random_uuid(),          -- replaced by the real auth id on first sign-in
--   'anish25@stanford.edu',
--   'Anish Bayya',
--   'co_lead',
--   'active',
--   current_date
-- );

-- ===========================================================================
-- Verify
-- ===========================================================================
--
-- Trigger exists:
--   select tgname from pg_trigger where tgname = 'on_auth_user_created';
--
-- After the first real sign-in, the ids must match:
--   select p.email, p.id = u.id as linked, p.status, p.global_role
--   from profiles p join auth.users u on lower(u.email) = lower(p.email);
--
-- Anyone stuck inactive who should not be:
--   update profiles set status = 'active' where email = '<address>';
