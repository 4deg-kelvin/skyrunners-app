-- ===========================================================================
-- 0010_deliverable_signoff_columns.sql
--
-- The rest of the two-step sign-off: who claimed the work, who agreed, and the
-- constraint and index that reference the `submitted` state.
--
-- Separate from 0009 because Postgres refuses to use a new enum value in the
-- transaction that created it. 0009 adds the value; this runs afterwards, once
-- it's committed. Both must be applied — 0009 alone leaves the columns missing,
-- and this alone fails on an unknown enum value.
-- ===========================================================================

alter table deliverables
  add column if not exists submitted_at timestamptz,
  -- Snapshotted rather than derived: REs change over a project's life, and
  -- "who signed this off" has to stay answerable after they've moved on.
  add column if not exists confirmed_by uuid references profiles (id) on delete set null;

comment on column deliverables.submitted_at is
  'When the OWNER marked it done. Not the same as delivered.';
comment on column deliverables.confirmed_by is
  'Which RE signed it off. Only `done` counts toward the Delivered signal.';

-- The RE's queue: work waiting on a signature, oldest first.
create index if not exists deliverables_awaiting_signoff_idx
  on deliverables (project_id, submitted_at)
  where status = 'submitted';

-- 0002 asserts a `done` deliverable has `completed_at`. Same idea here: a
-- `submitted` one must say when, or "how long has this been waiting?" is
-- unanswerable and `pendingSignOffs()` in lib/review.ts silently treats it as
-- zero days old — which is precisely the escalation that stops a quiet RE from
-- freezing everyone's record.
alter table deliverables drop constraint if exists deliverables_submitted_has_timestamp;
alter table deliverables add constraint deliverables_submitted_has_timestamp
  check (status <> 'submitted' or submitted_at is not null);

-- ===========================================================================
-- Verify
-- ===========================================================================
--
--   select column_name from information_schema.columns
--   where table_name = 'deliverables'
--     and column_name in ('submitted_at', 'confirmed_by');
--   -- expect both
