-- ---------------------------------------------------------------------------
-- 0032 — which advisors are named on which projects
--
-- An advisor can see and comment on everything in the club; this table is the
-- separate, smaller question of who a given project should ASK. A faculty
-- advisor who oversees Aerostructures is still available to Avionics, but only
-- Aerostructures should list them under "Who to ask".
--
-- ---------------------------------------------------------------------------
-- Why not a `role` on project_members
-- ---------------------------------------------------------------------------
--
-- Because `project_members` drives staffing, and staffing drives /find-work.
-- Membership rows feed "N committed members", the unstaffed-first ordering on
-- the discoverability page, and the roster counts on every project card. An
-- advisor is not staff — a project with two engineers and a professor is a
-- project with two engineers — and adding a fourth `project_role` would put
-- them into every one of those numbers unless each count remembered to exclude
-- it. That is the shape of bug this schema keeps trying to avoid: a default
-- that silently includes something it shouldn't.
--
-- A separate table cannot leak. Nothing counts it unless it asks for it.
-- ---------------------------------------------------------------------------

create table if not exists project_advisors (
  project_id  uuid not null references projects(id) on delete cascade,
  member_id   uuid not null references profiles(id) on delete cascade,
  -- Who named them, for the same reason `project_members.added_by` exists:
  -- "why is this person on here" should be answerable by something other than
  -- one person's memory.
  added_by    uuid references profiles(id) on delete set null,
  added_at    timestamptz not null default now(),
  primary key (project_id, member_id)
);

create index if not exists project_advisors_member_idx
  on project_advisors (member_id);

alter table project_advisors enable row level security;

-- Public to read, like everything else about who is on what. The club's
-- transparency default: activity is visible, personal reports are not.
drop policy if exists project_advisors_read on project_advisors;
create policy project_advisors_read on project_advisors
  for select to authenticated using (true);

-- --------------------------------------------------------------------------
-- Named by the project's REs, or a Co-Lead.
--
-- Same rule as adding a member: the RE is accountable for the project, so the
-- RE decides who it says to go and ask. `auth_is_re_for` already includes
-- Co-Leads and inherits down the project tree.
--
-- Note there is NO check here that the named person is actually an advisor.
-- That belongs in `lib/store/operations.ts` where a readable error can be
-- returned; an RLS refusal surfaces as "the database refused it", which tells
-- the RE nothing about what to do instead.
-- --------------------------------------------------------------------------
drop policy if exists project_advisors_write on project_advisors;
create policy project_advisors_write on project_advisors
  for all to authenticated
  using (auth_is_re_for(project_id))
  with check (auth_is_re_for(project_id));

insert into schema_migrations (version)
values ('0032_project_advisors')
on conflict (version) do nothing;
