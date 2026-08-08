-- ===========================================================================
-- 0012_capture_google_avatar.sql
--
-- Fill in a member's photo from their Google account on first sign-in.
--
-- Profile pictures are the classic field nobody sets. Uploads would need
-- Supabase Storage, policies and a retention decision — and Google already
-- hands us a perfectly good avatar URL in the OAuth payload. Taking it costs
-- nothing and means the roster has faces on it from day one instead of
-- initials forever.
--
-- Only ever fills a BLANK photo. Someone who has pasted their own link keeps
-- it, and re-authenticating never overwrites a deliberate choice.
-- ===========================================================================

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_profile profiles;
  google_avatar   text;
begin
  -- Only Stanford accounts. Checked here, in the app, and by a CHECK
  -- constraint — three layers, because this is the access model.
  if lower(new.email) not like '%@stanford.edu' then
    return new;
  end if;

  -- Google uses `avatar_url`; some providers use `picture`. Try both.
  google_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture'
  );

  select * into invited_profile
  from profiles
  where lower(email) = lower(new.email)
  limit 1;

  if invited_profile.id is not null then
    -- Pre-created by whoever invited them. Repoint the row at the real auth id
    -- and fill in anything still blank.
    update profiles
    set id             = new.id,
        last_active_at = now(),
        photo_url      = coalesce(photo_url, google_avatar),
        full_name      = coalesce(
          nullif(full_name, ''),
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'name',
          full_name
        )
    where id = invited_profile.id;
  else
    -- No invite. Create an INACTIVE profile rather than nothing at all: with no
    -- row they hit /auth/no-profile, whose only option is to sign out. With an
    -- inactive row they hit /auth/inactive, which explains the situation and
    -- gives leadership one click to let them in.
    insert into profiles (
      id, email, full_name, photo_url, global_role, status, joined_at
    )
    values (
      new.id,
      lower(new.email),
      coalesce(
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'name',
        split_part(new.email, '@', 1)
      ),
      google_avatar,
      'member',
      'inactive',
      current_date
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- Verify
-- ===========================================================================
--
-- After the next sign-in:
--   select email, full_name, photo_url is not null as has_photo from profiles;
--
-- Existing members are unaffected until they next authenticate. To backfill
-- someone who has already signed in:
--   update profiles p
--   set photo_url = coalesce(
--         u.raw_user_meta_data->>'avatar_url',
--         u.raw_user_meta_data->>'picture')
--   from auth.users u
--   where u.id = p.id and p.photo_url is null;
