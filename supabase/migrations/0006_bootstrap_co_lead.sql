-- ===========================================================================
-- 0006_bootstrap_co_lead.sql
--
-- Makes anish25@stanford.edu a Co-Lead.
--
-- WHY THIS IS A SEPARATE MIGRATION RATHER THAN AN EDIT TO 0005
--
-- 0005 ends with a commented-out block that does roughly this, meant to be
-- uncommented before the first sign-in. By the time this was written Kelvin had
-- already stood up the database, so 0005 may well have been applied — and
-- editing an applied migration means the file on disk no longer describes the
-- database, which is the single most confusing state a schema can be in.
--
-- So: additive, and safe to run at ANY time — before the first sign-in, after
-- it, or twice. The three cases it has to survive:
--
--   1. No profile yet          → create one, active, co_lead.
--   2. Profile exists          → promote it, whatever state it's in.
--   3. Already signed in once  → 0005's trigger has repointed the row at the
--                                real auth id. Match on EMAIL, never on id,
--                                or this silently does nothing.
--
-- Requires only 0001. If 0005's block was already uncommented and run, this is
-- a no-op that reports as much.
-- ===========================================================================

do $$
declare
  target_email constant text := 'anish25@stanford.edu';
  target_name  constant text := 'Anish Bayya';
  existing     profiles;
begin
  -- Case-insensitive, because Google may hand back `Anish25@Stanford.edu` and
  -- 0005 made the unique index `lower(email)` for exactly that reason.
  select * into existing
  from profiles
  where lower(email) = lower(target_email)
  limit 1;

  if existing.id is null then
    -- No row yet. The uuid here is a placeholder: 0005's `handle_new_auth_user`
    -- trigger repoints it at the real auth id on first sign-in, matching by
    -- email. Do NOT try to guess the auth id — it doesn't exist yet.
    insert into profiles (id, email, full_name, global_role, status, joined_at)
    values (
      gen_random_uuid(),
      lower(target_email),
      target_name,
      'co_lead',
      'active',
      current_date
    );
    raise notice 'Created % as an active Co-Lead.', target_email;

  elsif existing.global_role = 'co_lead' and existing.status = 'active' then
    raise notice '% is already an active Co-Lead — nothing to do.', target_email;

  else
    -- Promote in place. `status` is set too, because 0005 creates uninvited
    -- accounts as `inactive`: if he signed in before this ran, he has an
    -- inactive row and promoting the role alone would still leave him stuck on
    -- /auth/inactive.
    update profiles
    set global_role = 'co_lead',
        status      = 'active',
        full_name   = coalesce(nullif(full_name, ''), target_name)
    where id = existing.id;
    raise notice 'Promoted % from %/% to co_lead/active.',
      target_email, existing.global_role, existing.status;
  end if;
end $$;

-- ===========================================================================
-- Verify
-- ===========================================================================
--
--   select email, full_name, global_role, status from profiles
--   where lower(email) = 'anish25@stanford.edu';
--
-- Expect exactly one row: co_lead / active.
--
-- After his first sign-in, confirm the trigger linked the row to the auth user
-- (`linked` must be true, or he'll hit /auth/no-profile):
--
--   select p.email, p.id = u.id as linked, p.global_role, p.status
--   from profiles p
--   join auth.users u on lower(u.email) = lower(p.email)
--   where lower(p.email) = 'anish25@stanford.edu';
