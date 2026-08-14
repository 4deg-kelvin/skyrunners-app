-- ===========================================================================
-- 0040_deadline_changes.sql
--
-- Moving a project's target date, with the old date kept.
--
-- An RE could already change `projects.target_date` through the project editor,
-- and nothing recorded that it had moved. So a project that slipped three times
-- looked identical to one that was always due in March: the schedule stayed
-- believable only because nobody could check it.
--
-- ---------------------------------------------------------------------------
-- Why a table and not a column
-- ---------------------------------------------------------------------------
--
-- The tempting cheap version is `original_target_date` on `projects` — one
-- column, no join. It answers "has this slipped" and nothing else, and the
-- questions people actually ask are "how many times", "by how much each time",
-- "who agreed to it" and "why". A project that slips repeatedly is the case
-- worth seeing, and a single column flattens exactly that case.
--
-- The baseline the Gantt draws is then `min(from_date)` for the project, which
-- falls out of the history rather than being stored twice and going stale.
--
-- ---------------------------------------------------------------------------
-- The reason is REQUIRED, in the app and here
-- ---------------------------------------------------------------------------
--
-- Same asymmetry as declining a member request and rejecting a signed-off
-- deliverable: the action that makes the record *worse* has to be explained,
-- while the one that makes it better does not. A slipped date with no reason is
-- the thing this table exists to prevent — it would record that the schedule
-- moved without recording anything anybody can learn from.
--
-- Enforced twice deliberately. The CHECK is here because a validation that
-- lives only in the app is one `psql` away from not existing — the same
-- reasoning as the Discord invite host check in 0030.
-- ===========================================================================

create table if not exists project_deadline_changes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,

  -- Null would mean "no target before this". The application refuses that case
  -- (setting a first date is not a slip, and the editor handles it), but the
  -- column stays nullable so the history can express it if that ever changes.
  from_date   date,
  to_date     date not null,

  reason      text not null,

  -- Snapshotted like every other "who did this" column in the schema: REs
  -- change over a project's life, and "who agreed to move this" has to stay
  -- answerable after they have graduated.
  changed_by  uuid references profiles (id) on delete set null,
  changed_at  timestamptz not null default now(),

  -- Whitespace is not a reason. `btrim` so " " can't satisfy `not null`.
  constraint deadline_reason_not_blank check (length(btrim(reason)) > 0),

  -- A shape rule, not an integrity one. This renders in a project's history and
  -- in a notice sent up the chain; an essay pasted here lands in both.
  constraint deadline_reason_sane check (length(reason) <= 400),

  -- A "change" that changes nothing is noise in the history and would let
  -- somebody pad the record. Only guarded when there was a previous date.
  constraint deadline_actually_moved check (from_date is null or from_date <> to_date)
);

-- The only access path: one project's history, newest first.
create index if not exists project_deadline_changes_project_idx
  on project_deadline_changes (project_id, changed_at desc);

alter table project_deadline_changes enable row level security;

-- Readable by everyone signed in.
--
-- A slipped deadline is the public per-project half of the transparency rule —
-- the same half that makes check-in entries readable while the personal report
-- is not. It is also the half that matters most here: a schedule nobody can
-- audit is a schedule people plan against and then stop trusting.
drop policy if exists project_deadline_changes_read on project_deadline_changes;
create policy project_deadline_changes_read on project_deadline_changes
  for select to authenticated
  using (true);

-- `for all`, not `for insert` — and that is load-bearing twice over.
--
--   1. `persistDiff` splits inserts from updates, but an UPDATE needs a policy
--      it can reach, and a `for update` policy is unreachable through an upsert
--      (see docs/HANDOFF.md section 9 — this bug has now happened four times).
--   2. Deleting a project cascades these rows away, and `lib/data/rls.test.ts`
--      fails the build if a cascaded table has no DELETE policy. RLS does not
--      raise on a missing policy; the statement matches nothing and returns
--      success, so the cascade would silently leave orphans.
--
-- `auth_is_re_for` rather than `auth_is_leadership`, matching `projects_update`
-- and `project_notices_write`: an RE is very often a plain member, and moving
-- the date of a project you run is an RE's call. Gating on leadership would let
-- the action succeed in the app and then have Postgres refuse the history row —
-- the date would move and the record of it moving would vanish, which is the
-- exact failure this migration exists to prevent.
drop policy if exists project_deadline_changes_write on project_deadline_changes;
create policy project_deadline_changes_write on project_deadline_changes
  for all to authenticated
  using (auth_is_re_for(project_id) or auth_is_co_lead())
  with check (auth_is_re_for(project_id) or auth_is_co_lead());

-- ---------------------------------------------------------------------------
-- A fourth kind of project notice
-- ---------------------------------------------------------------------------
--
-- Completing a project already announces itself up the project tree. A slipped
-- deadline is the other event a Lead needs to hear about without going looking,
-- and for the same reason: it changes what everyone else can plan against.
--
-- `kind` is a text column with a CHECK rather than a Postgres enum, so widening
-- it is a constraint swap and carries none of the `alter type ... add value`
-- transaction restrictions. Same shape as 0023 adding `re_paused`.
alter table project_notices
  drop constraint if exists project_notices_kind_check;

alter table project_notices
  add constraint project_notices_kind_check
  check (kind in ('completed', 'reopened', 're_paused', 'deadline_pushed'));

comment on table project_deadline_changes is
  'Every move of projects.target_date, with why and by whom. min(from_date) per project is the Gantt baseline. Added 0040 (2026-08-14).';
