-- ---------------------------------------------------------------------------
-- 0027 — remember that a check-in reminder was sent
--
-- The reminder fires four hours before a check-in is due, and only if it
-- hasn't been submitted. Which means something has to remember it already
-- went out, or every cron tick inside that window sends another one — and the
-- fastest way to get a notification channel muted is to send the same nudge
-- four times.
--
-- A timestamp rather than a boolean, so it's possible to tell WHEN somebody
-- was nudged when they say they never were. The column is the whole
-- idempotency mechanism: the job's query excludes rows that already have one.
--
-- Deliberately NOT a separate table. There is exactly one reminder per
-- obligation, it dies with the obligation, and a join table for a nullable
-- timestamp is a table nobody would thank us for.
-- ---------------------------------------------------------------------------

alter table progress_updates
  add column if not exists reminder_sent_at timestamptz;

-- The job scans for "due soon, not submitted, not yet reminded" on every tick.
-- Partial index because the interesting rows are a tiny slice of the table and
-- shrink to nothing as the term goes on.
create index if not exists progress_updates_reminder_idx
  on progress_updates (due_at)
  where reminder_sent_at is null and status = 'pending';

insert into schema_migrations (version)
values ('0027_checkin_reminders')
on conflict (version) do nothing;
