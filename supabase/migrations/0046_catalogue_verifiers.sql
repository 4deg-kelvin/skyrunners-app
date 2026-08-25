-- ===========================================================================
-- 0046 — who verifies each training, and which ones are self-verify
-- ===========================================================================
--
-- Until 2026-08-24 a training was verified by the member's Lead chain. The club
-- removed the reporting chain, so verification needs a per-ITEM answer instead.
-- That answer is the RE pattern applied to a machine: accountability sits with a
-- named person rather than with a rank.
--
--   * A named verifier signs off requests for that item. "Tyler verifies the
--     mill" is a sentence a new member can act on; "ask your Lead" is not, and
--     was the thing being removed.
--   * Self-verify means the member ticks it and nobody is asked. Right for
--     anything where the honest answer is "did you read this" — a shop induction
--     video, a document — and it removes the queue entirely for those, which is
--     most of what was clogging it.
--
-- Unconfigured items fall back to "any Lead" (see `can.verifyTraining`). That is
-- deliberate rather than a gap: a catalogue of thirty machines cannot be
-- assigned in one sitting, and "nobody can verify this yet" would lock people
-- out of the shop.
--
-- ---------------------------------------------------------------------------
-- Why a separate table rather than two columns on `catalogue_items`
-- ---------------------------------------------------------------------------
--
-- Two columns on the item is the better schema, and this is a compromise. The
-- reason is in docs/HANDOFF.md and it has bitten this repo before:
-- `catalogue_items` is read by the per-request snapshot with an EXPLICIT column
-- list, so the moment the app selects a column that does not exist yet, EVERY
-- page 500s until this file is applied. The database password was rejected while
-- this shipped, so two columns meant either shipping nothing or shipping an
-- outage.
--
-- Read through its own fail-soft query in `lib/trainings/verifiers.ts`, which
-- returns an empty map if the table is absent — so deploy order stops mattering
-- and the feature switches itself on the moment this lands, with no second
-- deploy. Same pattern as 0044 (`advisor_profiles`) and 0045
-- (`work_log_replies`).
--
-- **Worth folding into `catalogue_items` once the database is reachable.** It is
-- a mechanical change: two columns, a backfill from this table, one module.
--
-- ---------------------------------------------------------------------------
-- The lock-out safeguard lives in the application, not here
-- ---------------------------------------------------------------------------
--
-- Somebody who is still the named verifier for a training cannot be demoted out
-- of leadership or deactivated, and the refusal NAMES the items so whoever is
-- making the change knows what to reassign first. Enforced in `setGlobalRole`
-- and `setMemberStatus`, not as a constraint, for the same reason the "last
-- Co-Lead" guard lives there: a CHECK cannot produce a message that says "Tyler
-- verifies the mill and the laser cutter; reassign those first", and a bare
-- constraint violation on an org-chart edit is the kind of message people work
-- around by deleting something else. What they would delete here is a safety
-- record.
--
-- `on delete set null` on `verifier_id` is the backstop for the case the guard
-- deliberately allows: a Co-Lead force-deleting a duplicate profile. The item
-- falls back to "any Lead" rather than pointing at a row that is gone.

create table if not exists catalogue_verifiers (
  -- One config row per item, enforced by the primary key.
  item_id     uuid primary key
                references catalogue_items (id) on delete cascade,
  -- The one person who signs this off. Null when self-verify, or when nobody has
  -- been named yet — both fall back to `can.verifyTraining`.
  verifier_id uuid references profiles (id) on delete set null,
  self_verify boolean not null default false,
  updated_at  timestamptz not null default now(),
  -- Naming somebody AND marking it self-verify is contradictory: it would leave
  -- a person recorded as accountable for a sign-off that never reaches them.
  -- Refused here as well as in `saveCatalogueVerifier`, which clears the
  -- verifier when self-verify is set.
  constraint verifier_xor_self_verify
    check (not (self_verify and verifier_id is not null))
);

comment on table catalogue_verifiers is
  'Per-item training verification: a named verifier, or self-verify. Replaces '
  'Lead-chain verification, removed 2026-08-24. Separate from catalogue_items so '
  'the app could ship before this landed — worth folding in, see 0046 header.';

-- One index, on the column the lock-out safeguard queries. `item_id` is already
-- the primary key, so it needs nothing.
create index if not exists catalogue_verifiers_verifier_idx
  on catalogue_verifiers (verifier_id)
  where verifier_id is not null;

alter table catalogue_verifiers enable row level security;

-- Readable by everyone signed in, like `catalogue_items` itself. Knowing who
-- signs off the mill is exactly what a member needs before asking, and hiding it
-- recreates the "go ask a Co-Lead" bottleneck this app exists to remove.
drop policy if exists catalogue_verifiers_read on catalogue_verifiers;
create policy catalogue_verifiers_read on catalogue_verifiers
  for select to authenticated
  using (true);

-- `for all`, not `for insert` + `for update`. `saveCatalogueVerifier` upserts,
-- and an upsert never reaches a `for update` policy — a policy that never
-- matches does not raise, the statement affects zero rows and returns success.
-- Same shape and same reason as `work_log_replies_re` in 0045.
--
-- Co-Lead only, same as `catalogue_items_write`: the catalogue is the shape
-- everything else hangs off.
drop policy if exists catalogue_verifiers_write on catalogue_verifiers;
create policy catalogue_verifiers_write on catalogue_verifiers
  for all to authenticated
  using (auth_is_co_lead()) with check (auth_is_co_lead());

insert into schema_migrations (version)
values ('0046_catalogue_verifiers')
on conflict (version) do nothing;
