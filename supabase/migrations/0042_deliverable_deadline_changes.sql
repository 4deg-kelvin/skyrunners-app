-- ===========================================================================
-- 0042_deliverable_deadline_changes.sql
--
-- Pushing back a DELIVERABLE's due date, with the same recorded history that
-- 0040 gave a project's target.
--
-- ---------------------------------------------------------------------------
-- One history table, not two
-- ---------------------------------------------------------------------------
--
-- The obvious alternative is a parallel `deliverable_deadline_changes` table.
-- Rejected, because the question people ask is about the project as a whole:
-- "this slipped three weeks — what moved, and why?" With two tables that answer
-- needs a union in every reader, and the project page would show two separate
-- history lists that have to be mentally interleaved.
--
-- So `project_deadline_changes` gains a nullable `deliverable_id`:
--
--   deliverable_id IS NULL  ->  the PROJECT's target moved
--   deliverable_id IS SET   ->  that deliverable's due date moved
--
-- `project_id` stays NOT NULL either way, because a deliverable always belongs to
-- a project and keeping it means the project's history reads as one ordered list
-- with no join. That is the whole benefit.
-- ===========================================================================

alter table project_deadline_changes
  add column if not exists deliverable_id uuid
    references deliverables (id) on delete cascade;

-- The access path stays "one project's history, newest first" — now covering both
-- kinds of row, which is exactly what the project page renders.
create index if not exists project_deadline_changes_deliverable_idx
  on project_deadline_changes (deliverable_id, changed_at desc)
  where deliverable_id is not null;

-- ---------------------------------------------------------------------------
-- RLS needs nothing new, and that is worth stating rather than assuming
-- ---------------------------------------------------------------------------
--
-- The policies from 0040 are scoped by `project_id`, which every row still
-- carries — so a deliverable row is readable and writable by exactly the people
-- who could already see the project's own history. `auth_is_re_for(project_id)`
-- is also the right authority for this: moving a deliverable's date is an RE's
-- call, the same as moving the project's.
--
-- The `on delete cascade` above is covered too. 0040's write policy is `for all`,
-- so DELETE is reachable — and `lib/data/rls.test.ts` would fail the build if it
-- were not, because the app clears these rows when a deliverable is deleted.

comment on column project_deadline_changes.deliverable_id is
  'Set when this row records a DELIVERABLE due-date move; null when it records the project target moving. project_id is populated either way so one query gives a project its whole schedule history. Added 0042.';
