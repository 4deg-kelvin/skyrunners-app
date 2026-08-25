-- ===========================================================================
-- 0047 — comment the columns the reporting removal left behind
-- ===========================================================================
--
-- Drops nothing. On 2026-08-24 the club removed the reporting chain and
-- twice-weekly check-ins, and the app stopped reading a set of columns and one
-- whole table. This file records which ones and why, so the next person to open
-- the schema does not spend an afternoon working out whether `profiles.lead_id`
-- is load-bearing.
--
-- ---------------------------------------------------------------------------
-- Why nothing is dropped
-- ---------------------------------------------------------------------------
--
-- Same reasoning as migration `0039`, which stopped collecting hours and left
-- every hours column in place:
--
--   1. **A dropped column cannot be un-dropped.** Stopping is a club decision.
--      If they reinstate check-ins next quarter, the history of who reported to
--      whom and what they wrote is either still here or gone forever.
--   2. **The rows are the history.** `progress_updates` and `update_entries`
--      hold what people actually wrote, and the per-project half of it is public
--      and part of each project's feed. Those are still SELECTed.
--   3. **Dropping a column is the one schema change that can break a running
--      deploy in both directions.** Nothing is gained by rushing it.
--
-- What IS gone from the app's reach is the `update_schedules` table: it is no
-- longer in `COLLECTIONS` in `lib/store/mapping.ts`, so the per-request snapshot
-- does not load it. The rows stay.
--
-- ---------------------------------------------------------------------------
-- The one that is still live, and must not be confused with the others
-- ---------------------------------------------------------------------------
--
-- **`teams.lead_id` IS LIVE.** It feeds `leadsTeamAbove`, which is what makes a
-- Division Lead a top RE over every project in their division. It is authority
-- over WORK, not over people, and it is the reason the reporting removal did not
-- also strip division leadership. Do not "clean it up" alongside
-- `profiles.lead_id` — the names are similar and the meanings are not.

-- --------------------------------------------------------------------------
-- profiles
-- --------------------------------------------------------------------------

comment on column profiles.lead_id is
  'DEAD since 2026-08-24 — nothing reads this. Was the member''s Lead: who read '
  'their twice-weekly check-in and who escalation ran through. The club removed '
  'the reporting chain; members report to their REs through the work they log. '
  'Kept because the decision could be revisited and a dropped column cannot be '
  'un-dropped. NOTE: teams.lead_id is different and is LIVE.';

-- --------------------------------------------------------------------------
-- progress_updates / update_entries — an archive, still read
-- --------------------------------------------------------------------------

comment on table progress_updates is
  'ARCHIVE since 2026-08-24. Nothing writes here; the club stopped asking for '
  'check-ins. Existing rows still render: the per-project half (update_entries) '
  'is public and part of each project''s feed, and the envelope shows on a '
  'member''s profile behind can.readArchivedCheckIns.';

comment on column progress_updates.lead_id_at_submission is
  'DEAD since 2026-08-24 — nothing reads this. Snapshotted the member''s Lead at '
  'submission so a mid-quarter reassignment could not silently re-file historic '
  'check-ins under the new Lead. There are no Leads and no new check-ins.';

comment on column progress_updates.reviewed_at is
  'DEAD for new rows since 2026-08-24 — nothing sets this. Still READ: a '
  'member''s profile shows "Read by X" on the check-ins somebody did read, which '
  'is a true fact about the past worth keeping.';

comment on column progress_updates.reviewed_by is
  'Same as reviewed_at: nothing sets it, the profile still reads it.';

comment on column progress_updates.reminder_sent_at is
  'DEAD since 2026-08-24. Half of the idempotency guard for the check-in '
  'reminder cron, which was deleted with the reminders. It existed so a retry or '
  'an overlapping invocation updated zero rows rather than DMing twice.';

comment on column progress_updates.late_notice_sent_at is
  'DEAD since 2026-08-24. The other half — one chase per late check-in rather '
  'than one every morning.';

-- --------------------------------------------------------------------------
-- update_schedules — the app no longer loads this table at all
-- --------------------------------------------------------------------------

comment on table update_schedules is
  'DEAD since 2026-08-24 and NOT LOADED by the app — removed from COLLECTIONS in '
  'lib/store/mapping.ts, so it is not in the per-request snapshot. Held which '
  'weekdays each member checked in on, and paused_until for the academic pause. '
  'Rows kept as history.';

comment on column update_schedules.paused_until is
  'DEAD. The academic pause: suppressed obligations and nudges and generated no '
  'missed rows, so a lapse was a pause rather than a debt. Deleted outright '
  'rather than reframed — with no obligations there is nothing to pause. The '
  'principle survived in the copy: nothing accrues against a member who steps '
  'back for a quarter.';

-- --------------------------------------------------------------------------
-- terms — the column kept its name and changed its meaning
-- --------------------------------------------------------------------------

comment on column terms.generates_obligations is
  'STILL LIVE, but renamed in meaning rather than in SQL. Now reads as "the club '
  'is in session during this period" — it drives what the app says about the '
  'current term. It used to decide whether check-in obligations generated at '
  'all, which made a missing calendar the one setup step with no visible '
  'symptom. Not renamed because a migration for a column whose meaning is '
  'documented buys nothing.';

insert into schema_migrations (version)
values ('0047_reporting_chain_comments')
on conflict (version) do nothing;
