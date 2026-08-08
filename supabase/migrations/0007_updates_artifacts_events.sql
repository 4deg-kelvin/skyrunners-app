-- ===========================================================================
-- 0007_updates_artifacts_events.sql
--
-- The three things the app already renders and the schema never had.
--
-- Found on 2026-08-07 while finishing Phase 1. `lib/data/my-work.ts`,
-- `dashboard.ts`, `events.ts` and `find-work.ts` cannot be moved off mock data
-- because there is nothing to move them to — `progress_updates`,
-- `update_entries`, `project_artifacts` and `events` appear in `lib/types.ts`
-- and in every page, but in no migration.
--
-- This is the actual Phase 1 blocker. No database credentials fix it.
--
-- Ordering note: additive only, and depends on 0001 (profiles, projects) and
-- 0002 (terms). Safe to apply after 0006 or alongside it.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Enums. Values must match lib/types.ts EXACTLY.
--
-- A mismatch does not throw — it silently fails a comparison, forever. This is
-- the `co_lead` vs `admin` trap from CLAUDE.md §2, and it applies to every enum
-- below. If you change one, change both.
-- --------------------------------------------------------------------------

create type update_status as enum (
  'pending', 'submitted', 'late', 'missed', 'reviewed'
);

create type artifact_kind as enum (
  'presentation', 'github', 'requirements', 'cad',
  'test_report', 'analysis', 'drawing', 'doc', 'link'
);

create type event_kind as enum (
  'design_review', 'company_tour', 'company_visit', 'build_session',
  'general_meeting', 'training', 'social', 'competition', 'one_on_one'
);

-- --------------------------------------------------------------------------
-- Progress updates — the ENVELOPE
--
-- Who, when, what state. Deliberately holds no content: an update spans several
-- projects, and a single text field would be ambiguous to a Lead overseeing more
-- than one of them, and useless to an RE trying to tell whether a blocker is
-- theirs to clear. Content lives in `update_entries`.
-- --------------------------------------------------------------------------

create table progress_updates (
  id                    uuid primary key default gen_random_uuid(),
  member_id             uuid not null references profiles (id) on delete cascade,
  due_at                timestamptz not null,
  submitted_at          timestamptz,
  status                update_status not null default 'pending',
  general_note          text,

  -- Denormalised on purpose: the sum of this update's entries' hours. Recomputed
  -- by trigger below rather than joined on every read, because the dashboard
  -- aggregates it across ~40 members twice a week.
  hours_this_period     numeric(6,2) not null default 0,

  -- SNAPSHOT. Who this person reported to AT SUBMISSION.
  --
  -- CLAUDE.md's rule: snapshot values that change over time. Leads change
  -- mid-quarter, and a review queue that joins live to `profiles.lead_id` would
  -- silently re-file historic updates under the new Lead — making the old Lead's
  -- record of what they reviewed disappear.
  lead_id_at_submission uuid references profiles (id) on delete set null,

  -- Which term this fell in, so out-of-session weeks can be excluded from
  -- reliability without recomputing the academic calendar on every read.
  term_id               uuid references terms (id) on delete set null,

  reviewed_at           timestamptz,
  reviewed_by           uuid references profiles (id) on delete set null,

  created_at            timestamptz not null default now(),

  -- One update per member per due date. Makes the twice-weekly generator
  -- idempotent: re-running it can never double-issue an obligation.
  constraint progress_updates_member_due_uniq unique (member_id, due_at),

  -- A submitted update must say when. Catches a status set without a timestamp,
  -- which would make "on time?" unanswerable.
  constraint progress_updates_submitted_has_time check (
    status not in ('submitted', 'reviewed') or submitted_at is not null
  )
);

-- The member's own view: "what do I owe, soonest first".
create index progress_updates_member_due_idx
  on progress_updates (member_id, due_at desc);

-- The Lead's exception feed: everything outstanding, by who owed it.
create index progress_updates_open_idx
  on progress_updates (lead_id_at_submission, due_at)
  where status in ('pending', 'late', 'submitted');

-- --------------------------------------------------------------------------
-- Update entries — the CONTENT, one row per project
--
-- Anything rendering an update must iterate these and label each with its
-- project. See CLAUDE.md, "Updates are per-project, not one blob".
-- --------------------------------------------------------------------------

create table update_entries (
  id          uuid primary key default gen_random_uuid(),
  update_id   uuid not null references progress_updates (id) on delete cascade,
  project_id  uuid not null references projects (id) on delete cascade,
  progress    text not null,
  blockers    text,
  next_steps  text,
  -- Auto-filled from work_logs, editable by the member.
  hours       numeric(5,2) not null default 0,
  created_at  timestamptz not null default now(),

  -- One entry per project per update. Two would show the same project twice in
  -- a Lead's review with no way to tell which is current.
  constraint update_entries_update_project_uniq unique (update_id, project_id),
  constraint update_entries_hours_sane check (hours >= 0 and hours <= 168)
);

create index update_entries_update_idx on update_entries (update_id);

-- The RE's view: "what has anyone said about MY project lately". This is the
-- access path that makes per-project entries worth the extra table.
create index update_entries_project_idx on update_entries (project_id);

-- Keep the envelope's total honest. Cheaper and far more reliable than asking
-- every caller to remember to sum the entries.
create or replace function sync_update_hours()
returns trigger
language plpgsql
as $$
declare
  target_update uuid := coalesce(new.update_id, old.update_id);
begin
  update progress_updates
  set hours_this_period = (
    select coalesce(sum(hours), 0) from update_entries
    where update_id = target_update
  )
  where id = target_update;
  return null;
end;
$$;

create trigger update_entries_sync_hours
  after insert or update or delete on update_entries
  for each row execute function sync_update_hours();

-- --------------------------------------------------------------------------
-- Project artifacts
--
-- Mostly links rather than uploads — the club's slides live in Google Drive and
-- its code on GitHub, and copying them here would create a second stale copy.
-- `file_url` exists for the genuine uploads (test reports, drawings).
-- --------------------------------------------------------------------------

create table project_artifacts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects (id) on delete cascade,
  kind            artifact_kind not null,
  title           text not null,
  description     text,
  file_url        text,
  external_url    text,
  version         text,
  uploaded_by     uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now(),

  -- An artifact that is neither a link nor a file is just a title, which would
  -- render as a dead row on the project page.
  constraint project_artifacts_has_target check (
    file_url is not null or external_url is not null
  )
);

create index project_artifacts_project_idx
  on project_artifacts (project_id, kind);

-- --------------------------------------------------------------------------
-- Events
--
-- Attendance is Phase 8; this is only what the calendar needs today. Adding the
-- attendance tables later is additive.
-- --------------------------------------------------------------------------

create table events (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  kind               event_kind not null,
  description        text,

  -- Set by leadership; drives how prominently the calendar surfaces it.
  importance_weight  int not null default 1,

  starts_at          timestamptz not null,
  ends_at            timestamptz,
  location           text,

  -- Null means club-wide. Set to scope an event to one division or project.
  team_id            uuid references teams (id) on delete cascade,
  project_id         uuid references projects (id) on delete cascade,

  created_by         uuid references profiles (id) on delete set null,
  created_at         timestamptz not null default now(),

  constraint events_ends_after_starts check (ends_at is null or ends_at >= starts_at),
  constraint events_weight_range check (importance_weight between 1 and 5)
);

-- The calendar's only real query: "what's coming up".
create index events_starts_at_idx on events (starts_at);

-- ===========================================================================
-- RLS
--
-- 0004 enables RLS per table. These four are new, so they arrive with it OFF —
-- and with RLS off the browser's anon key reads the whole table.
--
-- Activity is transparent (events, artifacts); EFFORT is not (update contents
-- are visible only to the member, their Lead chain, and REs of projects they
-- contribute to). The effort policies need the same helper functions 0004
-- defines, so they are written there, not here.
--
-- ⚠️  These two lines are the dangerous half of this migration. Enabling RLS
-- with no policy denies everything, which is the safe direction — pages will
-- 500 rather than leak. Do not "fix" that by disabling RLS.
-- ===========================================================================

alter table progress_updates  enable row level security;
alter table update_entries    enable row level security;
alter table project_artifacts enable row level security;
alter table events            enable row level security;

-- Transparent by default: any signed-in member sees club activity.
create policy events_read_all on events
  for select to authenticated using (true);

create policy project_artifacts_read_all on project_artifacts
  for select to authenticated using (true);

-- Members always see their own record — a rule that must not regress.
create policy progress_updates_read_own on progress_updates
  for select to authenticated using (member_id = auth.uid());

create policy update_entries_read_own on update_entries
  for select to authenticated using (
    exists (
      select 1 from progress_updates u
      where u.id = update_entries.update_id and u.member_id = auth.uid()
    )
  );

-- ===========================================================================
-- STILL TO DO — do not treat this migration as complete
-- ===========================================================================
--
-- The read policies above cover the member themselves and nothing else. Until
-- the Lead-chain and RE policies land in 0004, a Lead cannot read the updates
-- they are supposed to review. That is deliberate: denying too much is
-- recoverable, and granting too much is not.
--
-- Verify:
--   select tablename, rowsecurity from pg_tables
--   where tablename in ('progress_updates','update_entries','project_artifacts','events');
--   -- rowsecurity must be true for all four.
