-- ---------------------------------------------------------------------------
-- 0031 — the `advisor` role
--
-- A faculty or project advisor. Somebody who sees everything and can say
-- something about anything, but builds nothing: no projects, no deliverables,
-- no hours, no check-ins, and nobody above or below them in the reporting
-- chain.
--
-- ---------------------------------------------------------------------------
-- This file adds the enum value and NOTHING else, deliberately
-- ---------------------------------------------------------------------------
--
-- Postgres will not let a transaction use an enum value it added in that same
-- transaction, and `scripts/db-migrate.mjs` wraps every migration file in one.
-- So any statement that wanted to WRITE 'advisor' — a backfill, a policy
-- comparing against it, a default — has to live in a later file. Splitting it
-- out is cheaper than discovering that rule from an error message that reads
-- "unsafe use of new value of enum type".
--
-- ---------------------------------------------------------------------------
-- Why a role and not a boolean
-- ---------------------------------------------------------------------------
--
-- An advisor is a different KIND of person, not a member with a flag. Every
-- question the app asks about somebody — do they owe a check-in, do they have a
-- Lead, do they appear in the commitment tiers, can they be given a deliverable
-- — has a different answer for them, and a boolean sitting beside
-- `global_role = 'member'` would mean every one of those checks had to remember
-- to consult both fields. Roles are the thing the app already branches on.
--
-- Note that this breaks the "ordered least to most authority" reading of the
-- enum. Advisor is not a rung on that ladder; it is off to one side. The
-- application no longer relies on the ordering — see `isLeadership` in
-- `lib/permissions.ts`, which replaced twenty `globalRole !== 'member'` checks
-- that would each have silently granted advisors a leadership power.
-- ---------------------------------------------------------------------------

alter type global_role add value if not exists 'advisor';

insert into schema_migrations (version)
values ('0031_advisor_role')
on conflict (version) do nothing;
