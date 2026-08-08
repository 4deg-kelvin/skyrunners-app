-- ===========================================================================
-- 0011_second_co_lead.sql
--
-- Adds Jonathan Ananta Lie as a Co-Lead.
--
-- Not just an extra account: until now Anish was the ONLY Co-Lead, and the app
-- refuses to demote or deactivate the last one (see `setGlobalRole` in
-- lib/store/operations.ts). A single Co-Lead is also a single point of failure
-- for every action that only a Co-Lead can take — inviting leadership, changing
-- roles, editing divisions.
--
-- Same idempotent shape as 0006: safe before or after his first sign-in, and
-- safe to run twice. Matches on EMAIL, never on id, because 0005's trigger
-- repoints the row at his real auth id the first time he signs in.
-- ===========================================================================

do $$
declare
  target_email constant text := 'jonlie@stanford.edu';
  target_name  constant text := 'Jonathan Ananta Lie';
  existing     profiles;
begin
  select * into existing
  from profiles
  where lower(email) = lower(target_email)
  limit 1;

  if existing.id is null then
    insert into profiles (id, email, full_name, global_role, status, joined_at)
    values (
      gen_random_uuid(),   -- replaced by the real auth id on first sign-in
      lower(target_email),
      target_name,
      'co_lead',
      'active',
      current_date
    );
    raise notice 'Created % as an active Co-Lead.', target_email;

  elsif existing.global_role = 'co_lead' and existing.status = 'active' then
    raise notice '% is already an active Co-Lead.', target_email;

  else
    update profiles
    set global_role = 'co_lead',
        status      = 'active',
        full_name   = coalesce(nullif(full_name, ''), target_name)
    where id = existing.id;
    raise notice 'Promoted % to co_lead/active.', target_email;
  end if;
end $$;

-- ===========================================================================
-- Verify
-- ===========================================================================
--
--   select email, full_name, global_role, status from profiles
--   where global_role = 'co_lead' order by email;
--   -- expect anish25@ and jonlie@, both active
