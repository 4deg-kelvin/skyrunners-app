-- ---------------------------------------------------------------------------
-- 0014 — archiving a division instead of erasing it, and notices in a
--        project's own feed
--
-- Two features that both come down to the same rule: the club's history has to
-- survive the tidying-up.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Divisions archive rather than delete
--
-- `teams.is_active` already existed and nothing wrote it. Deleting a division
-- was only permitted once no project and no sub-team pointed at it, which meant
-- retiring one required first stripping away everything that recorded what it
-- did. A club that reorganises every year would erase its own history to keep
-- a page tidy.
--
-- These three columns are what turns `is_active = false` into an archive you
-- can read rather than a row that has quietly vanished: when, who, and why.
-- `archived_by` is set null on delete rather than cascading — the person who
-- archived a division graduating must not take the division with them.
-- ---------------------------------------------------------------------------

alter table teams
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references profiles(id) on delete set null,
  add column if not exists archive_note text;

-- The archive page reads exactly this set, and the projects tree reads its
-- complement. Both are hot paths on a page every member opens.
create index if not exists teams_archived_idx on teams (is_active, archived_at desc);

-- ---------------------------------------------------------------------------
-- 2. Project notices — the app writing in a project's feed
--
-- "Recent Updates On This Project" is built from `update_entries`, so the
-- obvious way to announce a completion would be to synthesise a check-in. That
-- check-in would then count towards somebody's reliability signal: a record
-- saying a member reported in on a day they didn't. Worse than no announcement.
--
-- So a notice is its own row, rendered in the same feed and marked automatic.
--
-- `notified_member_ids` is an array rather than a join table because it is
-- write-once, read-whole, and never queried by recipient across notices. Every
-- read is "who was told about THIS", which the row already answers.
--
-- Snapshotted, not derived: recomputing the chain of command later would
-- silently re-address the announcement every time an RE changes or a project
-- moves, and "who was told, and when" is the whole point of having one.
-- ---------------------------------------------------------------------------

create table if not exists project_notices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('completed', 'reopened')),
  body text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  notified_member_ids uuid[] not null default '{}'
);

create index if not exists project_notices_project_idx
  on project_notices (project_id, created_at desc);

alter table project_notices enable row level security;

-- Readable by everyone signed in. A notice says a project finished, which is
-- the public per-project half of the transparency rule — the same half that
-- makes update entries readable while the personal report is not.
drop policy if exists project_notices_read on project_notices;
create policy project_notices_read on project_notices
  for select to authenticated
  using (true);

-- Written by the app, never by hand, and only as a side effect of an action
-- that already checked `can.manageProject`.
--
-- `auth_is_re_for` and not `auth_is_leadership`: an RE is very often a plain
-- member, and RE authority is what completing a project needs. Gating on
-- leadership would let the action succeed and then have the database refuse
-- the notice — the completion would save and the announcement would vanish.
-- Same function `projects_update` uses, so the two can't disagree.
drop policy if exists project_notices_write on project_notices;
create policy project_notices_write on project_notices
  for all to authenticated
  using (auth_is_re_for(project_id) or auth_is_co_lead())
  with check (auth_is_re_for(project_id) or auth_is_co_lead());

insert into schema_migrations (version)
values ('0014_division_archive_and_project_notices')
on conflict (version) do nothing;
