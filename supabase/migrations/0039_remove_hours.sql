-- ===========================================================================
-- 0039_remove_hours.sql
--
-- The club decided on 2026-08-14 that **hours are not the measure; deliverables
-- are.** The work log stops being a timesheet and becomes a diary: what you did,
-- on each project, day by day. The twice-weekly check-in then drafts itself from
-- that diary and only asks about a project the member logged nothing against.
--
-- `docs/HOURS_REMOVAL_PLAN.md` is the agreed plan. This migration is its schema
-- half.
--
-- ---------------------------------------------------------------------------
-- ADDITIVE AND NON-DESTRUCTIVE. Nothing is dropped, nothing is deleted.
-- ---------------------------------------------------------------------------
--
-- Every hour the club recorded stays exactly where it is. The never-hard-delete
-- rule (CLAUDE.md §6) is about people, projects and divisions, but the same
-- reasoning applies with more force here: this is a historical record of work
-- real people did, the decision to stop counting it is a club decision rather
-- than a data-quality problem, and a decision like that can be revisited. A
-- dropped column cannot be un-dropped.
--
-- So the columns survive and the APP stops selecting them. `lib/store/mapping.ts`
-- and `lib/store/supabase.ts` no longer list `work_logs.hours`,
-- `update_entries.hours`, `progress_updates.hours_this_period` or the four
-- `club_settings` tier floors in their column specs, which is what guarantees no
-- hours value can reach a page and be rendered or re-aggregated by accident.
--
-- **This migration must be applied BEFORE the app code is deployed.** Not for
-- the usual reason (a missing column breaking `loadSnapshot`'s explicit select —
-- nothing is added here), but because of the NOT NULL below: the new `logWork`
-- omits `hours` entirely, so every insert would fail until this lands.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. work_logs.hours stops being required
-- ---------------------------------------------------------------------------
--
-- The one genuinely load-bearing statement in this file. `hours numeric(4,1) not
-- null` with no default means an insert that omits it is rejected outright, and
-- `logWork` no longer sends it.
--
-- The CHECK constraint `work_logs_hours_sane` (`hours > 0 and hours <= 24`) is
-- deliberately LEFT IN PLACE, and that is not an oversight. A CHECK fails only
-- on FALSE; against NULL it evaluates to UNKNOWN, which passes. So new rows with
-- no hours are accepted while the constraint still protects the historical
-- values from being overwritten with nonsense.
alter table work_logs
  alter column hours drop not null;

-- `description` becomes the field that matters, and it stays NULLABLE here.
--
-- It is REQUIRED by `logWork` in the application instead. That split is
-- deliberate: rows written before today have no description, and back-filling
-- invented text into a real record of somebody's work is worse than an honest
-- gap. The UI says "logged before notes were required" rather than pretending.
--
-- A `not null` here would have needed exactly that back-fill to apply at all.
comment on column work_logs.hours is
  'Historical only. Never written or read since 0039 (2026-08-14) — hours are not the measure. Kept because it records work real people did.';

comment on column work_logs.description is
  'What was done. Required by lib/store/operations.ts logWork(); nullable here because rows predating 0039 have none. Pre-fills the member''s next check-in.';

-- ---------------------------------------------------------------------------
-- 2. The hours sync trigger goes
-- ---------------------------------------------------------------------------
--
-- From 0007. It recomputed `progress_updates.hours_this_period` as the sum of
-- its `update_entries.hours` on every insert, update and delete of an entry.
--
-- This one IS dropped rather than left dormant, because unlike a column a
-- trigger is not inert: it would keep firing on every check-in write, keep
-- writing a number nothing reads, and — worse — would make
-- `hours_this_period` DISAGREE with the frozen historical entries it used to
-- summarise, since new entries all carry the column default of 0. A stored
-- number that silently decays toward zero is exactly the failure mode this whole
-- change exists to avoid.
--
-- `if exists` so re-running is a verified no-op; `npm run db:migrate` keeps a
-- ledger but the drop should be idempotent on its own.
drop trigger if exists update_entries_sync_hours on update_entries;
drop function if exists sync_update_hours();

comment on column update_entries.hours is
  'Historical only. Not written since 0039 (2026-08-14); its sync trigger was dropped. New rows carry the default 0, which is meaningless rather than wrong.';

comment on column progress_updates.hours_this_period is
  'Historical only. Not written since 0039 (2026-08-14). New rows carry the default 0. Do not sum or display.';

-- ---------------------------------------------------------------------------
-- 3. The commitment tier floors are orphaned, not removed
-- ---------------------------------------------------------------------------
--
-- `core_hours`, `committed_hours`, `contributing_hours` and `minimum_hours` on
-- `club_settings` (from 0020) held the bar a Co-Lead set from Settings. The
-- tiers are gone: `commitmentTier`, `TIER_LABELS`, `getClubTiers` and
-- `TierAdminForm` no longer exist, and /how-we-lead publishes prose instead of a
-- ladder.
--
-- Their CHECK constraints — `tiers_in_order` and `minimum_within_range` — are
-- also left alone. They are harmless while nothing writes these columns (an
-- UPDATE that doesn't mention a column leaves it untouched, so the existing
-- in-order values stay in-order), and they are a useful tripwire if anything
-- ever tries to write three of the four again. See the note in
-- `lib/store/mapping.ts`.
--
-- NOTE for whoever revisits this: the tiers were removed because hours ÷
-- in-session weeks is a ROLLING average, so keeping the ladder while stopping
-- collection would have decayed every member's tier toward the bottom rung over
-- the following weeks, on their own profile, with no new data causing it. That
-- coupling is why hours removal and tier removal had to ship together and
-- cannot be un-shipped separately either.
comment on column club_settings.core_hours is
  'Orphaned by 0039 (2026-08-14). The commitment tiers were removed; nothing reads or writes this. Kept as a record of the last bar the club set.';

comment on column club_settings.committed_hours is
  'Orphaned by 0039 (2026-08-14). See core_hours.';

comment on column club_settings.contributing_hours is
  'Orphaned by 0039 (2026-08-14). See core_hours.';

comment on column club_settings.minimum_hours is
  'Orphaned by 0039 (2026-08-14). See core_hours.';

-- ---------------------------------------------------------------------------
-- 4. Two views now aggregate a dead column
-- ---------------------------------------------------------------------------
--
-- `v_member_hours_weekly` (0001) is `sum(hours)` grouped by week, and
-- `v_member_contribution` (0002) carries an `hours_total`. Both are Phase-1
-- plumbing the application never wired up — it reads whole-table snapshots
-- through `lib/store/supabase.ts` instead — so nothing breaks either way.
--
-- Left in place rather than dropped, for consistency with the columns above and
-- because a view holds no data to lose. But they are misleading to anyone
-- querying the database directly: `sum()` skips NULLs, so from today they report
-- only the historical total and it will never move again. Hence the comments —
-- a stale number with no explanation beside it is how somebody rebuilds the
-- tiers by accident, thinking the data is still live.
comment on view v_member_hours_weekly is
  'HISTORICAL ONLY since 0039 (2026-08-14). work_logs.hours is no longer written, so this reports a frozen total that will never change. Unused by the app. Do not build on it.';

comment on view v_member_contribution is
  'Its hours_total column is HISTORICAL ONLY since 0039 (2026-08-14) and frozen. The live contribution record is three signals with no hours at all — see lib/contribution.ts. Unused by the app.';
