-- ===========================================================================
-- 0050 — Private notes are gone. Nothing about a member is private any more.
-- ===========================================================================
--
-- A check-in carried a `general_note`: whatever you wanted to say that wasn't
-- tied to a project. It was readable by you and your Lead chain, then — when
-- the reporting chain went on 2026-08-24 — by you and the Co-Leads. It was the
-- LAST exception to "everything about a member is public", and CLAUDE.md had a
-- long argument for why it had to survive: those notes were written under a
-- stated promise, and publishing what somebody already typed is the one privacy
-- change that changing your mind cannot undo.
--
-- That argument was sound and it no longer applies. The club is still in
-- testing, and the only `general_note` in the database is the string
-- "amongus" — seven characters, written by a Co-Lead trying the form. There is
-- no promise to keep, so the club chose to remove the concept rather than
-- carry a privacy exception, a permission rule and a special-cased read path
-- for a feature nobody used before it was retired.
--
-- What this fixes at the same time
-- -------------------------------------------------------------------------
--
-- The "public per-project half" of a check-in has never actually been public in
-- live mode, and that WAS a real bug. `update_entries_read_all` is
-- `using (true)`, exactly as designed — but the app never reads `update_entries`
-- directly. `projectUpdateFeed()` iterates `progressUpdates[].entries`, and the
-- snapshot attaches entries by looping over the ENVELOPE rows that came back.
-- So an entry whose envelope RLS filtered out was unreachable no matter what the
-- entries policy said.
--
-- The envelope policy was
--   `member_id = auth.uid() or auth_is_lead_of(member_id)`
-- which, with the reporting chain removed from the application but
-- `profiles.lead_id` still populated on 8 of 12 rows, resolved against a
-- structure nothing maintains. Not restrictive — arbitrary.
--
-- Six entries across four check-ins are affected, all written between 9 and 13
-- August 2026, all before check-ins were retired. Nothing writes either table
-- any more, so this is the last time these rows change.
--
-- Why `general_note` is emptied rather than dropped
-- -------------------------------------------------------------------------
--
-- Same rule as `work_logs.hours` and `profiles.lead_id`: a dropped column
-- cannot be un-dropped, and "stop collecting this" is a club decision that
-- could be revisited. The column stays, empty, with a comment saying so. What
-- is deleted is the CONTENT, which is what "remove private notes" means.
--
-- Re-runnable. Every statement is `if exists` / idempotent.

-- ---------------------------------------------------------------------------
-- 1. Delete the notes.
-- ---------------------------------------------------------------------------
update progress_updates
   set general_note = null
 where general_note is not null;

comment on column progress_updates.general_note is
  'RETIRED 2026-08-24. Was the private half of a check-in — readable by the '
  'member and their Lead chain, later the member and Co-Leads. Emptied in '
  'migration 0050 and no longer selected by the application: there is no such '
  'thing as a private note now. Kept rather than dropped because a dropped '
  'column cannot be un-dropped. DO NOT start writing to it — the row policy '
  'below is `using (true)`, so anything put here is public to the whole club.';

-- ---------------------------------------------------------------------------
-- 2. Open the envelope, so the per-project half is actually public.
-- ---------------------------------------------------------------------------
drop policy if exists progress_updates_read_chain on progress_updates;

-- Redundant once the policy below exists: SELECT policies are OR'd, so
-- "your own" adds nothing to "everyone's". Dropped rather than left, because
-- two policies where one suffices is the shape that makes the next reader
-- wonder which one is doing the work.
drop policy if exists progress_updates_read_own on progress_updates;

-- Dropped first so this file is genuinely re-runnable. `create policy` takes no
-- `if not exists` — the same gap that makes `APPLY_ALL.sql` abort on `0001`'s
-- `create type` — so without this line a second push dies with
-- `42710: policy "progress_updates_read_all" already exists`. Which it did.
drop policy if exists progress_updates_read_all on progress_updates;

create policy progress_updates_read_all
  on progress_updates for select
  using (true);

-- ---------------------------------------------------------------------------
-- 3. Drop the review policy and the function underneath it.
-- ---------------------------------------------------------------------------
--
-- `progress_updates_review` let a "Lead" mark a report reviewed. Nothing marks
-- anything reviewed since 2026-08-24 — `reviewUpdate` was deleted with the
-- escalation module — so this granted a write nothing performs, to an authority
-- that no longer exists.
drop policy if exists progress_updates_review on progress_updates;

-- `auth_is_lead_of` is the SQL mirror of `isLeadOfOrAbove`, deleted from
-- `lib/permissions.ts` on 2026-08-24.
--
-- CHECKED BEFORE DROPPING, the way bug #14 in docs/HANDOFF.md taught: Postgres
-- does not dependency-track function BODIES, so `drop function` succeeds while
-- a `security definer` function still selects from it and the failure surfaces
-- later, at query time. Dropping `v_lead_chain` broke every read of `work_logs`
-- exactly this way.
--
-- Verified against the live database: the only references were the two policies
-- dropped above (`pg_policies.qual`), and no other `pg_proc.prosrc` mentions
-- it. Grep the migrations too — 0008 defines it, 0049 only names it in a
-- comment.
drop function if exists auth_is_lead_of(uuid);

-- Record it, the way every migration here does. `db-push` diffs the ledger
-- against the filenames; a migration that does not insert its own row reports
-- "ok" and then "still not applied", and would re-run on the next push.
insert into schema_migrations (version)
values ('0050_no_private_notes')
on conflict (version) do nothing;
