-- ===========================================================================
-- 0054 — `profiles.skills` can never be NULL again, so a Lead can admit people
-- ===========================================================================
--
-- Migration `0051` added `profiles_guard_authority`, whose admit branch lets a
-- Lead (not just a Co-Lead) flip a pending member to active — but ONLY if the
-- write touches nothing except `status`:
--
--   elsif not (
--     auth_is_leadership() and old.status = 'inactive' and new.status = 'active'
--     and (to_jsonb(new) - 'status' - 'updated_at')
--       = (to_jsonb(old) - 'status' - 'updated_at')
--   ) then raise ...
--
-- That is a good guard. It broke admissions anyway, because of a three-way
-- interaction nothing in the repo made visible:
--
--   1. `handle_new_auth_user` (migration 0001) provisions a new Stanford
--      sign-in with an explicit column list that OMITS `skills`:
--
--        insert into profiles (id, email, full_name, photo_url,
--                              global_role, status, joined_at)
--
--   2. `profiles.skills` is `text[]` with **no default** — the only nullable
--      column on the table that is an array. So the new row holds NULL.
--
--   3. `lib/store/mapping.ts` is asymmetric for exactly this column: it reads
--      with `opt()` (NULL becomes `undefined`) and writes `m.skills ?? []`
--      (`undefined` becomes `[]`). Every other nullable column uses the
--      `opt`/`nul` pair, which round-trips NULL unchanged.
--
-- The currently deployed `persistDiff` sends the WHOLE row on an update
-- (`lib/store/supabase.ts`, `spec.toRow(value)`), so admitting somebody sends
-- `skills = '{}'` against a stored NULL. In jsonb that is `[]` versus `null`,
-- `is distinct from` is true, the equality check fails, and the trigger raises
--
--   "You may admit this member, but only a Co-Lead can edit their profile."
--
-- Net effect on production: **the next Stanford account to sign in could only
-- be admitted by a Co-Lead.** A Team or Division Lead pressing the same button
-- got a permission error naming a rule they had not broken. Nobody was stuck
-- when this was found — there were zero pending profiles — but every future one
-- would have been.
--
-- Why this fix and not another
-- -------------------------------------------------------------------------
--
-- Three things could have been changed. This is the cheapest and the most
-- durable:
--
--   - **The column** (here). Removes the NULL state entirely, so no write path
--     can recreate the mismatch and no reader has to remember the asymmetry.
--     Matches its own siblings: `calendar_clients text[] not null default '{}'`
--     from 0041 already looks like this, which is why THAT column never had the
--     bug.
--   - The mapping (`?? []` -> `nul()`). Correct too, but it only helps code
--     paths that go through the mapping, and leaves a NULL sitting in the row
--     for anything that does not.
--   - Full-row updates. Genuinely the deeper issue and it is fixed on the
--     `fix/codebase-reliability-review` branch, which sends only changed
--     columns — an admit would then send `status` alone and the guard's
--     comparison would pass trivially. But that branch is an unmerged draft,
--     and admissions should not wait on a review.
--
-- The three are complements, not alternatives. This one is safe to keep after
-- that branch lands.
--
-- Re-runnable: `set default` and `set not null` are both idempotent, and the
-- backfill is a no-op once it has run.

-- ---------------------------------------------------------------------------
-- 1. Backfill first — `set not null` would be refused while a NULL exists.
-- ---------------------------------------------------------------------------
update profiles set skills = '{}' where skills is null;

-- ---------------------------------------------------------------------------
-- 2. Then close the door, both ways.
-- ---------------------------------------------------------------------------
--
-- The DEFAULT covers inserts that omit the column — which is every account
-- created by `handle_new_auth_user`. The NOT NULL covers inserts that pass an
-- explicit NULL, and makes "this is always an array" an invariant the database
-- enforces rather than one each caller has to remember.
--
-- Nothing writes NULL here today: `toRow` sends `m.skills ?? []`, so the app
-- cannot, and the provisioning trigger simply leaves the column out.
alter table profiles alter column skills set default '{}';
alter table profiles alter column skills set not null;

comment on column profiles.skills is
  'Free-text skills a member lists on their own profile. NOT NULL DEFAULT '
  '''{}'' since migration 0054: a NULL here made `to_jsonb(new)` differ from '
  '`to_jsonb(old)` on a full-row update, which tripped the admit branch of '
  '`profiles_guard_authority` and stopped a Lead from admitting new members.';

insert into schema_migrations (version)
values ('0054_profiles_skills_default')
on conflict (version) do nothing;
