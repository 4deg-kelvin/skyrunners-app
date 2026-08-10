-- ---------------------------------------------------------------------------
-- 0029 — remember that a "still open" follow-up was sent
--
-- Sibling of `reminder_sent_at` (0027) and the same idempotency mechanism, for
-- the other half of the job: the reminder goes out BEFORE the deadline, this
-- one goes out after it, once, if the check-in still hasn't been written.
--
-- ---------------------------------------------------------------------------
-- Why a second column instead of reusing the first
-- ---------------------------------------------------------------------------
--
-- They answer different questions and both answers matter. "Were they warned
-- in time?" and "were they chased afterwards?" are the two things somebody
-- asks when a member says they never heard anything, and one column could only
-- ever answer whichever fired last. They also fire under opposite conditions —
-- due_at in the future versus due_at in the past — so a shared column would
-- make the second send clear the first send's evidence.
--
-- ---------------------------------------------------------------------------
-- Once, not daily
-- ---------------------------------------------------------------------------
--
-- Deliberately a timestamp that is set once and never cleared, so a member who
-- stays late gets exactly one follow-up rather than a DM every morning. After
-- that it stops being a notification problem and becomes their Lead's: an
-- unread or missing check-in escalates on age through `lib/review.ts`, which
-- names one person and is actionable. A bot repeating itself daily is how the
-- whole channel gets muted, and a muted channel is worse than no channel
-- because it looks like coverage.
-- ---------------------------------------------------------------------------

alter table progress_updates
  add column if not exists late_notice_sent_at timestamptz;

-- Mirrors `progress_updates_reminder_idx`. The job scans for "overdue, not
-- submitted, not yet chased", which is a tiny slice of the table.
create index if not exists progress_updates_late_notice_idx
  on progress_updates (due_at)
  where late_notice_sent_at is null and status = 'pending';

insert into schema_migrations (version)
values ('0029_checkin_late_notice')
on conflict (version) do nothing;
