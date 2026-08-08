-- ===========================================================================
-- 0004_rls_policies.sql — Row Level Security
--
-- ⚠️  THIS MIGRATION IS NOT OPTIONAL AND MUST RUN BEFORE ANY REAL DATA EXISTS.
--
-- The anon key ships inside the browser JavaScript bundle. That's by design and
-- it's safe — but ONLY because RLS decides what that key can see. With RLS off,
-- anyone who loads the page can read and write every row in every table
-- directly against the PostgREST endpoint: no login, no Stanford check, no
-- audit. The email CHECK constraint on `profiles` restricts what can be
-- INSERTED, not who can SELECT.
--
-- ---------------------------------------------------------------------------
-- The model, from docs/DECISIONS.md
-- ---------------------------------------------------------------------------
--
--   READS — open to any authenticated member for anything about the WORK:
--     projects, teams, deliverables, artifacts, membership, events, terms.
--     Transparency by default is the whole product thesis.
--
--   READS — restricted for anything about a PERSON'S EFFORT:
--     work_logs, progress_updates, update_entries. Visible to the member
--     themselves, their Lead chain, and REs with authority over a project they
--     contribute to.
--
--   WRITES — go through Server Actions calling lib/permissions.ts. The policies
--     here are the safety net, deliberately a little coarser than the app rules.
--     Belt and braces, not a replacement.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Helper functions
--
-- SECURITY DEFINER so they can read the tables they need without recursing
-- through the very policies being evaluated. Without that, a policy on
-- `profiles` that calls a function which selects from `profiles` deadlocks in
-- infinite recursion — the classic Supabase RLS footgun.
-- --------------------------------------------------------------------------

create or replace function auth_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and status = 'active'
  );
$$;

create or replace function auth_is_co_lead()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and status = 'active'
      and global_role = 'co_lead'
  );
$$;

create or replace function auth_is_leadership()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and status = 'active'
      and global_role in ('lead', 'co_lead')
  );
$$;

/**
 * Can the current user see this member's effort data?
 * Themselves, anyone up their Lead chain, any RE of a project they work on,
 * or a Co-Lead.
 */
create or replace function auth_can_view_effort(target_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() = target_member
    or auth_is_co_lead()
    or exists (
      select 1 from v_lead_chain
      where member_id = target_member and ancestor_id = auth.uid()
    )
    or exists (
      select 1
      from project_members target_pm
      join v_project_re_authority auth_re
        on auth_re.project_id = target_pm.project_id
      where target_pm.member_id = target_member
        and target_pm.left_at is null
        and auth_re.member_id = auth.uid()
    );
$$;

/** Does the current user hold RE authority over this project, or above it? */
create or replace function auth_is_re_for(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth_is_co_lead()
    or exists (
      select 1 from v_project_re_authority
      where project_id = target_project and member_id = auth.uid()
    );
$$;

-- --------------------------------------------------------------------------
-- Enable RLS on every table. Any table left out is wide open.
-- --------------------------------------------------------------------------

alter table profiles            enable row level security;
alter table lead_history        enable row level security;
alter table teams               enable row level security;
alter table team_memberships    enable row level security;
alter table projects            enable row level security;
alter table project_members     enable row level security;
-- project_artifacts is created in 0007 and enables its own RLS there.
-- `requirements` was removed — no migration creates it. See the note below.
alter table deliverables        enable row level security;
alter table join_requests       enable row level security;
alter table work_logs           enable row level security;
alter table terms               enable row level security;
alter table update_schedules    enable row level security;

-- --------------------------------------------------------------------------
-- People
-- --------------------------------------------------------------------------

-- Everyone can see the roster. Profiles carry no effort data — hours and update
-- contents live in their own tables, which is what makes this safe.
create policy profiles_read_all on profiles
  for select using (auth_is_member() or id = auth.uid());

create policy profiles_update_own on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and status = 'active');

-- Only Co-Leads change roles, status, or reporting lines.
create policy profiles_manage_leadership on profiles
  for update using (auth_is_co_lead());

create policy profiles_insert_leadership on profiles
  for insert with check (auth_is_leadership());

create policy lead_history_read on lead_history
  for select using (auth_is_leadership() or member_id = auth.uid());

create policy lead_history_insert on lead_history
  for insert with check (auth_is_leadership());

-- --------------------------------------------------------------------------
-- Org and project structure — readable by all, written by leadership/REs
-- --------------------------------------------------------------------------

create policy teams_read on teams
  for select using (auth_is_member());
create policy teams_write on teams
  for all using (auth_is_leadership());

create policy team_memberships_read on team_memberships
  for select using (auth_is_member());
create policy team_memberships_write on team_memberships
  for all using (auth_is_leadership());

create policy projects_read on projects
  for select using (auth_is_member());
create policy projects_insert on projects
  for insert with check (auth_is_leadership());
create policy projects_update on projects
  for update using (auth_is_re_for(id));
create policy projects_delete on projects
  for delete using (auth_is_co_lead());

-- Membership is RE-controlled. Members cannot add themselves — that's the
-- product decision, enforced here as well as in lib/permissions.ts.
create policy project_members_read on project_members
  for select using (auth_is_member());
create policy project_members_write on project_members
  for all using (auth_is_re_for(project_id));

-- `project_artifacts` policies used to live here and could not work: the table
-- isn't created until 0007, so this migration failed on a clean database with
-- `relation "project_artifacts" does not exist`. They now live in 0007,
-- alongside the table itself.
--
-- The `requirements` policies were also removed. No migration has ever created
-- that table and none is planned — it's a leftover from an earlier design where
-- requirements were a first-class entity rather than a project artifact. A
-- policy on a table that doesn't exist is not a harmless no-op; it aborts the
-- whole migration.

-- --------------------------------------------------------------------------
-- Deliverables — public to read, so everyone can see who owns what
-- --------------------------------------------------------------------------

create policy deliverables_read on deliverables
  for select using (auth_is_member());

-- REs shape the list.
create policy deliverables_manage on deliverables
  for all using (auth_is_re_for(project_id));

-- An owner can update their own item's status without RE authority. Scoped to
-- UPDATE only, so they can't create work for themselves or delete evidence.
create policy deliverables_owner_update on deliverables
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- --------------------------------------------------------------------------
-- Join requests
-- --------------------------------------------------------------------------

create policy join_requests_read on join_requests
  for select using (
    member_id = auth.uid()
    or auth_is_re_for(project_id)
    or auth_is_leadership()
  );

-- Anyone can ask, but only for themselves.
create policy join_requests_insert_own on join_requests
  for insert with check (member_id = auth.uid());

-- Withdraw your own.
create policy join_requests_update_own on join_requests
  for update using (member_id = auth.uid())
  with check (member_id = auth.uid() and status in ('pending', 'withdrawn'));

-- Accept or decline: the RE's call.
create policy join_requests_review on join_requests
  for update using (auth_is_re_for(project_id));

-- --------------------------------------------------------------------------
-- Effort data — the restricted set
-- --------------------------------------------------------------------------

create policy work_logs_read on work_logs
  for select using (auth_can_view_effort(member_id));

create policy work_logs_write_own on work_logs
  for all using (member_id = auth.uid())
  with check (member_id = auth.uid());

create policy update_schedules_read on update_schedules
  for select using (auth_can_view_effort(member_id));

create policy update_schedules_write_own on update_schedules
  for all using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- --------------------------------------------------------------------------
-- Academic calendar — everyone reads, Co-Leads write
-- --------------------------------------------------------------------------

create policy terms_read on terms
  for select using (auth_is_member());
create policy terms_write on terms
  for all using (auth_is_co_lead());

-- ===========================================================================
-- Verify after running
-- ===========================================================================
--
-- Every table must show rowsecurity = true:
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' order by tablename;
--
-- Every table must have at least one policy:
--   select tablename, count(*) from pg_policies
--   where schemaname = 'public' group by tablename order by tablename;
--
-- Smoke test as an anonymous user (should return zero rows, not an error):
--   set role anon;
--   select count(*) from profiles;
--   reset role;
