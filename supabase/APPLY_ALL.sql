-- GENERATED FILE — do not edit. Regenerate with `npm run db:bundle`.
--
-- Every migration, in order, as one script. Paste the whole thing into the
-- Supabase SQL editor (Dashboard -> SQL Editor -> New query) and run once.
--
-- Safe to run on an EMPTY database. It is NOT idempotent as a whole: 0001-0003
-- use bare `create table`, so re-running on a populated database will error on
-- the first table that already exists. That's deliberate — failing loudly beats
-- silently half-applying a schema.
--
-- Afterwards, verify from the repo with:  npm run db:check
--
-- Sources: 0001_core_schema.sql, 0002_deliverables_terms_commitment.sql, 0003_join_requests.sql, 0004_rls_policies.sql, 0005_profile_provisioning.sql, 0006_bootstrap_co_lead.sql, 0007_updates_artifacts_events.sql, 0008_migration_ledger_and_review_rls.sql, 0009_deliverable_signoff.sql, 0010_deliverable_signoff_columns.sql, 0011_second_co_lead.sql, 0012_capture_google_avatar.sql, 0013_write_gaps.sql, 0014_division_archive_and_project_notices.sql, 0015_help_requests.sql, 0016_update_entry_responses.sql, 0017_trainings_and_access.sql, 0018_calendar.sql, 0019_profile_delete_policy.sql, 0020_commitment_tiers.sql, 0021_backfill_project_start_dates.sql, 0022_delete_cascade_policies.sql, 0023_re_paused_notice.sql, 0024_event_rsvp_policies.sql, 0025_discord_user_id.sql, 0026_discord_verified.sql, 0027_checkin_reminders.sql, 0028_deliverable_todos.sql, 0029_checkin_late_notice.sql, 0030_discord_invite_url.sql, 0031_advisor_role.sql, 0032_project_advisors.sql, 0033_member_requests.sql, 0034_artifact_write_policies.sql, 0035_storage_buckets.sql, 0036_mcp_tokens.sql, 0037_daily_digest.sql, 0038_guide_blocks.sql, 0039_remove_hours.sql, 0040_deadline_changes.sql


-- ==========================================================================
-- BEGIN 0001_core_schema.sql
-- ==========================================================================

-- ===========================================================================
-- 0001_core_schema.sql — Phase 1 foundation
--
-- Covers people, the org tree, the project tree, and work logs. Later phases
-- add their own migration files; never edit a migration that has already run.
--
-- Run with:  supabase db push        (or paste into the SQL editor)
--
-- Mirrors docs/DATA_MODEL.md. If the two disagree, fix both.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Enums
--
-- These strings must match the TypeScript unions in lib/types.ts EXACTLY.
-- `co_lead`, not `admin` — a mismatch here silently disables every leadership
-- permission, because isCoLead() would never return true.
-- --------------------------------------------------------------------------

create type global_role as enum ('member', 'lead', 'co_lead');
create type member_status as enum ('active', 'inactive', 'alumni');
create type team_kind as enum ('division', 'team');

create type project_phase as enum (
  'concept', 'requirements', 'preliminary_design', 'detailed_design',
  'manufacturing', 'integration', 'testing', 'flight_test', 'complete'
);

-- Separate from phase: phase is WHERE, health is HOW IT'S GOING.
create type project_health as enum ('on_track', 'at_risk', 'blocked', 'complete');

create type project_role as enum ('re', 'contributor', 'observer');

-- --------------------------------------------------------------------------
-- People
-- --------------------------------------------------------------------------

create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null unique,
  full_name         text not null,
  preferred_name    text,
  photo_url         text,
  class_year        int,
  major             text,
  phone             text,
  global_role       global_role not null default 'member',
  status            member_status not null default 'active',
  -- Their ONE direct Team Lead. Self-referencing: this is the reporting chain.
  lead_id           uuid references profiles (id) on delete set null,
  primary_team_id   uuid,
  bio               text,
  skills            text[],
  joined_at         date not null default current_date,
  last_active_at    timestamptz,
  created_at        timestamptz not null default now(),

  -- Only Stanford members. This constraint IS part of the access model.
  constraint profiles_stanford_email check (email like '%@stanford.edu'),
  -- Nobody reports to themselves; deeper cycles are caught by a trigger below.
  constraint profiles_no_self_lead check (id <> lead_id)
);

create index profiles_lead_id_idx on profiles (lead_id);
create index profiles_status_idx on profiles (status);

-- Reassignment is expected to be frequent, and "who was your Lead in spring?"
-- matters when reading an old update.
create table lead_history (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references profiles (id) on delete cascade,
  old_lead_id   uuid references profiles (id) on delete set null,
  new_lead_id   uuid references profiles (id) on delete set null,
  changed_by    uuid references profiles (id) on delete set null,
  reason        text,
  changed_at    timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Org tree — divisions and nested sub-teams
-- --------------------------------------------------------------------------

create table teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  description   text,
  -- NULL parent = Division. Co-Leads add and remove these freely.
  parent_id     uuid references teams (id) on delete restrict,
  kind          team_kind not null default 'team',
  lead_id       uuid references profiles (id) on delete set null,
  re_id         uuid references profiles (id) on delete set null,
  color         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),

  constraint teams_no_self_parent check (id <> parent_id)
);

create index teams_parent_id_idx on teams (parent_id);

alter table profiles
  add constraint profiles_primary_team_fk
  foreign key (primary_team_id) references teams (id) on delete set null;

create table team_memberships (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams (id) on delete cascade,
  member_id   uuid not null references profiles (id) on delete cascade,
  role        text not null default 'member',
  joined_at   timestamptz not null default now(),
  left_at     timestamptz
);

create unique index team_memberships_active_uniq
  on team_memberships (team_id, member_id)
  where left_at is null;

-- --------------------------------------------------------------------------
-- Project tree
-- --------------------------------------------------------------------------

create table projects (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  description       text,
  parent_id         uuid references projects (id) on delete restrict,
  team_id           uuid references teams (id) on delete set null,
  -- The go-to person. A real column, so "who is primary" is deterministic —
  -- never rely on join order for that.
  primary_re_id     uuid not null references profiles (id) on delete restrict,
  phase             project_phase not null default 'concept',
  health            project_health not null default 'on_track',
  start_date        date,
  target_date       date,
  actual_end_date   date,
  -- When false, Gantt dates roll up from children instead.
  dates_overridden  boolean not null default false,
  -- Open by default: members join anything that interests them. This is the
  -- core fix for "go ask a co-lead what to work on."
  is_open_to_join   boolean not null default true,
  open_roles        text,
  time_commitment   text,
  created_by        uuid references profiles (id) on delete set null,
  created_at        timestamptz not null default now(),

  constraint projects_no_self_parent check (id <> parent_id),
  constraint projects_dates_ordered
    check (target_date is null or start_date is null or target_date >= start_date)
);

create index projects_parent_id_idx on projects (parent_id);
create index projects_team_id_idx on projects (team_id);
create index projects_open_idx on projects (is_open_to_join) where is_open_to_join;

create table project_members (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects (id) on delete cascade,
  member_id         uuid not null references profiles (id) on delete cascade,
  -- Multiple REs per project are allowed.
  role              project_role not null default 'contributor',
  -- What this person owns here. Surfaces on their profile.
  responsibility    text,
  joined_at         timestamptz not null default now(),
  left_at           timestamptz,
  -- NULL means they self-enrolled.
  added_by          uuid references profiles (id) on delete set null
);

create unique index project_members_active_uniq
  on project_members (project_id, member_id)
  where left_at is null;

create index project_members_member_idx on project_members (member_id)
  where left_at is null;

-- --------------------------------------------------------------------------
-- Work logging — highest-volume table, most latency-sensitive insert
-- --------------------------------------------------------------------------

create table work_logs (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references profiles (id) on delete cascade,
  -- Optional on purpose: never block logging hours on picking a project.
  project_id    uuid references projects (id) on delete set null,
  work_date     date not null default current_date,
  hours         numeric(4,1) not null,
  description   text,
  -- Distinct from work_date, so back-filling is visible.
  logged_at     timestamptz not null default now(),

  constraint work_logs_hours_sane check (hours > 0 and hours <= 24),
  constraint work_logs_not_future check (work_date <= current_date)
);

create index work_logs_member_date_idx on work_logs (member_id, work_date desc);
create index work_logs_project_date_idx on work_logs (project_id, work_date desc);

-- --------------------------------------------------------------------------
-- Cycle guards
--
-- Both trees are walked with recursive CTEs. A cycle would make those queries
-- run forever, so reject cycles at write time rather than hoping nobody
-- creates one.
-- --------------------------------------------------------------------------

create or replace function check_no_cycle()
returns trigger
language plpgsql
as $$
declare
  cursor_id uuid;
  hops int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  cursor_id := new.parent_id;

  while cursor_id is not null and hops < 100 loop
    if cursor_id = new.id then
      raise exception
        'Cycle detected in %: % cannot be a descendant of itself',
        tg_table_name, new.id;
    end if;

    execute format('select parent_id from %I where id = $1', tg_table_name)
      into cursor_id
      using cursor_id;

    hops := hops + 1;
  end loop;

  return new;
end;
$$;

create trigger teams_no_cycle
  before insert or update of parent_id on teams
  for each row execute function check_no_cycle();

create trigger projects_no_cycle
  before insert or update of parent_id on projects
  for each row execute function check_no_cycle();

-- Same idea for the reporting chain, which uses lead_id rather than parent_id.
create or replace function check_no_lead_cycle()
returns trigger
language plpgsql
as $$
declare
  cursor_id uuid := new.lead_id;
  hops int := 0;
begin
  while cursor_id is not null and hops < 100 loop
    if cursor_id = new.id then
      raise exception 'Cycle detected in reporting chain for %', new.id;
    end if;
    select lead_id into cursor_id from profiles where id = cursor_id;
    hops := hops + 1;
  end loop;
  return new;
end;
$$;

create trigger profiles_no_lead_cycle
  before insert or update of lead_id on profiles
  for each row execute function check_no_lead_cycle();

-- Keep `kind` consistent with the tree rather than trusting callers.
create or replace function sync_team_kind()
returns trigger
language plpgsql
as $$
begin
  new.kind := case when new.parent_id is null then 'division' else 'team' end;
  return new;
end;
$$;

create trigger teams_sync_kind
  before insert or update of parent_id on teams
  for each row execute function sync_team_kind();

-- --------------------------------------------------------------------------
-- Views
--
-- The recursive walks live here so the app doesn't reimplement them, and so a
-- deep tree stays one query instead of one query per node.
-- --------------------------------------------------------------------------

-- Flattened project tree with depth, root, and a readable path.
create or replace view v_project_tree as
with recursive tree as (
  select
    p.id,
    p.id as root_id,
    p.parent_id,
    p.name,
    p.slug,
    p.team_id,
    0 as depth,
    p.name::text as path
  from projects p
  where p.parent_id is null

  union all

  select
    c.id,
    t.root_id,
    c.parent_id,
    c.name,
    c.slug,
    c.team_id,
    t.depth + 1,
    t.path || ' › ' || c.name
  from projects c
  join tree t on c.parent_id = t.id
)
select * from tree;

-- Which Division a project ultimately belongs to.
--
-- A project's team_id may point at a sub-team, so this climbs the org tree.
-- Grouping by team_id directly would hide any project owned by a sub-team from
-- the page whose whole purpose is discoverability.
create or replace view v_project_division as
with recursive up as (
  select t.id as team_id, t.id as current_id, t.parent_id
  from teams t

  union all

  select u.team_id, p.id, p.parent_id
  from up u
  join teams p on u.parent_id = p.id
)
select
  pr.id   as project_id,
  d.id    as division_id,
  d.name  as division_name
from projects pr
join v_project_tree vt on vt.id = pr.id
join projects root on root.id = vt.root_id
join up on up.team_id = root.team_id
join teams d on d.id = up.current_id
where d.parent_id is null;

-- Each member's full reporting chain up to a Co-Lead. Backs Lead-authority
-- permission checks without a round trip per hop.
create or replace view v_lead_chain as
with recursive chain as (
  select p.id as member_id, p.lead_id, 1 as depth
  from profiles p
  where p.lead_id is not null

  union all

  select c.member_id, p.lead_id, c.depth + 1
  from chain c
  join profiles p on p.id = c.lead_id
  where p.lead_id is not null
)
select member_id, lead_id as ancestor_id, depth from chain;

-- Every RE with authority over a project, including inherited from ancestors.
create or replace view v_project_re_authority as
select
  vt.id as project_id,
  pm.member_id
from v_project_tree vt
join v_project_tree anc
  on anc.root_id = vt.root_id
 and vt.path like anc.path || '%'
join project_members pm
  on pm.project_id = anc.id
 and pm.role = 're'
 and pm.left_at is null;

-- Hours per member per week, pre-aggregated.
create or replace view v_member_hours_weekly as
select
  member_id,
  date_trunc('week', work_date)::date as week_start,
  sum(hours) as hours
from work_logs
group by member_id, date_trunc('week', work_date);


-- ==========================================================================
-- END 0001_core_schema.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0002_deliverables_terms_commitment.sql
-- ==========================================================================

-- ===========================================================================
-- 0002_deliverables_terms_commitment.sql
--
-- Three product decisions made after reviewing the org design:
--
--   1. DELIVERABLES replace a task board. One flat list per project, one owner
--      each. No dependencies, no nesting, no critical path.
--   2. TERMS gate every obligation, so finals and breaks stop corrupting the
--      contribution data.
--   3. COMMITMENT splits "following" from "committed", with a cap on the latter.
--
-- Also drops the engagement-weights concept: there is no composite score any
-- more, just four independently-reported signals.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Deliverables
--
-- This is the entire task model. The alternative — tasks with dependencies,
-- sub-tasks and critical-path analysis — would cost an RE an hour a week, and on
-- a volunteer team whose availability swings with midterms the dependency graph
-- is wrong the day after it's entered. A wrong schedule is worse than none,
-- because people plan against it.
--
-- Four fields do the work: title, ONE owner, a date, a status.
-- --------------------------------------------------------------------------

create type deliverable_status as enum ('open', 'in_progress', 'blocked', 'done');

create table deliverables (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects (id) on delete cascade,
  title          text not null,
  -- Exactly one owner, always. Shared ownership means nobody owns it.
  owner_id       uuid not null references profiles (id) on delete restrict,
  due_date       date,
  status         deliverable_status not null default 'open',
  completed_at   timestamptz,
  -- Why it's stuck. Routes to the project's REs.
  blocker_note   text,
  sort_order     int not null default 0,
  created_by     uuid references profiles (id) on delete set null,
  created_at     timestamptz not null default now(),

  -- Status and timestamp can't disagree
  constraint deliverables_done_has_timestamp
    check ((status = 'done') = (completed_at is not null)),
  -- If it's blocked, say why — an unexplained blocker can't be helped with
  constraint deliverables_blocked_has_note
    check (status <> 'blocked' or blocker_note is not null)
);

create index deliverables_project_idx on deliverables (project_id, sort_order);
create index deliverables_owner_idx on deliverables (owner_id)
  where status <> 'done';
create index deliverables_overdue_idx on deliverables (due_date)
  where status <> 'done';

-- --------------------------------------------------------------------------
-- 2. Academic calendar
--
-- Without this, every finals week and winter break silently generates weeks of
-- `missed` updates for all 35 members. By autumn the contribution data would be
-- meaningless, and nudge emails would be landing on students mid-finals — the
-- worst possible message at the worst possible moment.
-- --------------------------------------------------------------------------

create type term_kind as enum ('quarter', 'finals', 'break', 'summer');

create table terms (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  kind                    term_kind not null,
  starts_on               date not null,
  ends_on                 date not null,
  -- False for finals, breaks and summer. No obligations, no nudges, no
  -- `missed` rows.
  generates_obligations   boolean not null default true,

  constraint terms_ordered check (ends_on >= starts_on)
);

create index terms_range_idx on terms (starts_on, ends_on);

-- Overlapping terms would make "am I in session?" ambiguous.
create extension if not exists btree_gist;
alter table terms add constraint terms_no_overlap
  exclude using gist (daterange(starts_on, ends_on, '[]') with &&);

create or replace function in_session(d date default current_date)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select generates_obligations
     from terms
     where d between starts_on and ends_on
     limit 1),
    false
  );
$$;

-- --------------------------------------------------------------------------
-- 3. Commitment vs following
--
-- Joining was free and interesting, so people committed to five projects and
-- contributed to one. Every roster then overstated its staffing and REs planned
-- against help that never arrived — worse than being short-handed and knowing
-- it. Following stays unlimited; committing is capped.
-- --------------------------------------------------------------------------

create type commitment_level as enum ('following', 'committed');

alter table project_members
  add column commitment commitment_level not null default 'committed';

create index project_members_committed_idx
  on project_members (member_id)
  where commitment = 'committed' and left_at is null;

-- Enforced in the database as well as in lib/permissions.ts. The app should
-- explain the cap kindly; the database should make it true regardless of which
-- code path did the insert.
create or replace function enforce_commitment_cap()
returns trigger
language plpgsql
as $$
declare
  hard_max constant int := 3;
  current_count int;
begin
  if new.commitment <> 'committed' or new.left_at is not null then
    return new;
  end if;

  select count(*) into current_count
  from project_members
  where member_id = new.member_id
    and commitment = 'committed'
    and left_at is null
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if current_count >= hard_max then
    raise exception
      'Commitment cap reached: % is already committed to % projects (max %). Follow it instead, or step back from one.',
      new.member_id, current_count, hard_max;
  end if;

  return new;
end;
$$;

create trigger project_members_commitment_cap
  before insert or update of commitment, left_at on project_members
  for each row execute function enforce_commitment_cap();

-- --------------------------------------------------------------------------
-- 4. Update schedules: two per week, pausable without penalty
-- --------------------------------------------------------------------------

create table update_schedules (
  id                 uuid primary key default gen_random_uuid(),
  member_id          uuid not null unique references profiles (id) on delete cascade,
  updates_per_week   int not null default 2,
  -- 0 = Sunday. Length should match updates_per_week.
  weekdays           int[] not null default array[1, 4],
  due_time           time not null default '23:59',
  timezone           text not null default 'America/Los_Angeles',
  -- Academic pause. Suppresses obligations AND nudges, and generates no
  -- `missed` rows — a lapse must be a pause, never a debt. Someone who drifts
  -- during midterms has to be able to come back without facing a record of
  -- failure, because people don't return to places where they've already failed.
  paused_until       date,

  constraint update_schedules_cadence_sane
    check (updates_per_week between 1 and 5),
  constraint update_schedules_weekdays_valid
    check (array_length(weekdays, 1) between 1 and 7)
);

-- --------------------------------------------------------------------------
-- 5. Views
-- --------------------------------------------------------------------------

-- Project progress as a real percentage, not a vibe.
create or replace view v_project_progress as
select
  p.id as project_id,
  count(d.id)                                              as total,
  count(d.id) filter (where d.status = 'done')             as done,
  count(d.id) filter (where d.status = 'blocked')          as blocked,
  count(d.id) filter (
    where d.status <> 'done' and d.due_date < current_date
  )                                                        as overdue,
  case when count(d.id) = 0 then 0
       else count(d.id) filter (where d.status = 'done')::numeric / count(d.id)
  end                                                      as fraction
from projects p
left join deliverables d on d.project_id = p.id
group by p.id;

-- The four contribution signals, per member. Deliberately NOT combined into a
-- score: a single number invites optimization, four columns invite judgment.
create or replace view v_member_contribution as
select
  pr.id as member_id,
  count(d.id) filter (where d.status = 'done')          as deliverables_completed,
  count(d.id) filter (where d.status <> 'done')         as deliverables_open,
  count(d.id) filter (
    where d.status <> 'done' and d.due_date < current_date
  )                                                     as deliverables_overdue,
  coalesce(sum(w.hours), 0)                             as hours_total,
  count(distinct pm.project_id) filter (
    where pm.commitment = 'committed' and pm.left_at is null
  )                                                     as projects_committed,
  count(distinct pm.project_id) filter (
    where pm.role = 're' and pm.left_at is null
  )                                                     as re_role_count
from profiles pr
left join deliverables d      on d.owner_id = pr.id
left join work_logs w         on w.member_id = pr.id
left join project_members pm  on pm.member_id = pr.id
group by pr.id;

-- Projects that need leadership attention.
--
-- RE authority inherits downward, so an RE who quietly checks out freezes their
-- whole subtree: nobody beneath them can create sub-projects, appoint REs, or
-- get a blocker cleared. This surfaces it instead of letting work stall
-- invisibly for a month. Happens every single year.
create or replace view v_projects_needing_attention as
select
  p.id as project_id,
  p.name,
  case
    when re.last_active_at < now() - interval '14 days' then 're_silent'
    when prog.blocked > 0                              then 'blocker_stale'
    when prog.overdue > 0                              then 'deliverables_overdue'
    when child.child_count > 0 and re_count.n < 2      then 'no_deputy_re'
    else 'health_flagged'
  end as reason,
  re.full_name as primary_re,
  re.last_active_at,
  prog.blocked,
  prog.overdue
from projects p
join profiles re on re.id = p.primary_re_id
left join v_project_progress prog on prog.project_id = p.id
left join (
  select parent_id, count(*) as child_count
  from projects where parent_id is not null group by parent_id
) child on child.parent_id = p.id
left join (
  select project_id, count(*) as n
  from project_members
  where role = 're' and left_at is null
  group by project_id
) re_count on re_count.project_id = p.id
where re.last_active_at < now() - interval '14 days'
   or prog.blocked > 0
   or prog.overdue > 0
   or (child.child_count > 0 and coalesce(re_count.n, 0) < 2)
   or p.health in ('at_risk', 'blocked');


-- ==========================================================================
-- END 0002_deliverables_terms_commitment.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0003_join_requests.sql
-- ==========================================================================

-- ===========================================================================
-- 0003_join_requests.sql
--
-- Membership becomes RE-controlled: members can no longer add themselves to a
-- project. They can see everything, follow anything, and ASK — but the RE
-- decides, because the RE is accountable for the deliverable.
--
-- Two consequences handled here:
--   1. The commitment cap is dropped. An RE staffs a project with whoever they
--      need, and a member can be on as many projects as REs want them on.
--   2. `join_requests` exists so the RE gate can't become a dead end.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Drop the commitment cap
--
-- The cap existed to stop members self-enrolling in five projects and
-- contributing to one. With an RE approving every addition, that problem is
-- solved at the source — a human with context now says yes to each name, which
-- is a better filter than an arbitrary number.
-- --------------------------------------------------------------------------

drop trigger if exists project_members_commitment_cap on project_members;
drop function if exists enforce_commitment_cap();

-- `commitment` stays, with a changed meaning:
--   'committed' — an RE added them. Carries deliverables and update obligations.
--   'following' — they chose to watch. Self-service, unlimited, no obligations.
comment on column project_members.commitment is
  'committed = an RE added them, carries obligations. following = self-service watch-only.';

-- --------------------------------------------------------------------------
-- 2. Join requests
--
-- This table is the reason RE-controlled membership doesn't recreate the very
-- problem the app exists to fix.
--
-- "Go ask the RE" over email produces silence and an invisible member — which is
-- what made people quit, just with a different person to chase. A tracked
-- request lands in the RE's queue, the member can see it's pending, and it
-- escalates when it goes stale. Same gate, no limbo.
-- --------------------------------------------------------------------------

create type join_request_status as enum (
  'pending', 'accepted', 'declined', 'withdrawn'
);

create table join_requests (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects (id) on delete cascade,
  member_id       uuid not null references profiles (id) on delete cascade,
  -- Why they want in and what they'd bring. Lets the RE decide in seconds.
  note            text,
  status          join_request_status not null default 'pending',
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by_id   uuid references profiles (id) on delete set null,
  -- So a decline isn't just silence.
  response_note   text,

  constraint join_requests_decision_consistent
    check ((status in ('accepted', 'declined')) = (decided_at is not null))
);

-- One open request per person per project. Re-asking after a decline is fine.
create unique index join_requests_one_pending
  on join_requests (project_id, member_id)
  where status = 'pending';

create index join_requests_project_idx on join_requests (project_id)
  where status = 'pending';
create index join_requests_member_idx on join_requests (member_id);

-- --------------------------------------------------------------------------
-- 3. Accepting a request adds the member. One action, not two.
--
-- If accepting and adding were separate steps, they would drift — a request
-- marked accepted with no membership row is a member who thinks they're on a
-- project and isn't.
-- --------------------------------------------------------------------------

create or replace function apply_accepted_join_request()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'accepted' and coalesce(old.status, 'pending') <> 'accepted' then
    insert into project_members (project_id, member_id, role, commitment, added_by)
    values (new.project_id, new.member_id, 'contributor', 'committed', new.decided_by_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger join_requests_apply_acceptance
  after update of status on join_requests
  for each row execute function apply_accepted_join_request();

-- --------------------------------------------------------------------------
-- 4. Views
-- --------------------------------------------------------------------------

-- An RE's queue. Being the gate means owing people an answer.
create or replace view v_join_requests_for_re as
select
  jr.id            as request_id,
  jr.project_id,
  p.name           as project_name,
  jr.member_id     as requester_id,
  req.full_name    as requester_name,
  req.skills       as requester_skills,
  jr.note,
  jr.requested_at,
  extract(day from now() - jr.requested_at)::int as days_waiting,
  pm.member_id     as re_id
from join_requests jr
join projects p        on p.id = jr.project_id
join profiles req      on req.id = jr.member_id
join project_members pm
  on pm.project_id = jr.project_id
 and pm.role = 're'
 and pm.left_at is null
where jr.status = 'pending';

-- Requests nobody has answered. A silent RE is a blocked member, and this is
-- what lets a Co-Lead notice before that member gives up and drifts away.
create or replace view v_stale_join_requests as
select
  jr.id           as request_id,
  p.name          as project_name,
  req.full_name   as requester_name,
  re.full_name    as primary_re_name,
  jr.requested_at,
  extract(day from now() - jr.requested_at)::int as days_waiting
from join_requests jr
join projects p     on p.id = jr.project_id
join profiles req   on req.id = jr.member_id
join profiles re    on re.id = p.primary_re_id
where jr.status = 'pending'
  and jr.requested_at < now() - interval '5 days';


-- ==========================================================================
-- END 0003_join_requests.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0004_rls_policies.sql
-- ==========================================================================

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


-- ==========================================================================
-- END 0004_rls_policies.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0005_profile_provisioning.sql
-- ==========================================================================

-- ===========================================================================
-- 0005_profile_provisioning.sql
--
-- ⚠️  WITHOUT THIS, LIVE MODE LOCKS OUT EVERY SINGLE USER.
--
-- The problem: `profiles.id` references `auth.users(id)`. A fresh Google sign-in
-- mints a random auth user id, and nothing was creating or linking a matching
-- profile row. So the first person to sign in — Anish — would authenticate
-- successfully, find no profile, and land on `/auth/no-profile`, whose only
-- control is "sign in with a different account". Every account, forever, with no
-- escape.
--
-- Nor could the seed help: it hardcodes UUIDs derived from strings like
-- "m-anish", which will never equal a real auth user's id.
--
-- The fix is to link by EMAIL on first sign-in. That also gives the invite flow
-- its natural shape: a Lead creates the profile row with the member's Stanford
-- address, and the two halves meet when that person first signs in.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Case-insensitive email matching
--
-- Google may return `Anish@Stanford.edu`. `lib/env.ts` lowercases before
-- checking the domain, but the CHECK constraint in 0001 was case-sensitive, so
-- an address the app accepted could be rejected by Postgres. Align them.
-- --------------------------------------------------------------------------

alter table profiles drop constraint if exists profiles_stanford_email;
alter table profiles add constraint profiles_stanford_email
  check (lower(email) like '%@stanford.edu');

-- Emails are identity here, so make duplicates impossible regardless of case.
--
-- `profiles.email` was declared `unique` in 0001, which Postgres implements as a
-- CONSTRAINT backed by an index. `drop index profiles_email_key` therefore fails
-- with "cannot drop index ... because constraint ... requires it" — the index is
-- owned by the constraint and can only be dropped through it.
alter table profiles drop constraint if exists profiles_email_key;
drop index if exists profiles_email_key;

create unique index if not exists profiles_email_lower_uniq
  on profiles (lower(email));

-- --------------------------------------------------------------------------
-- 2. Link an auth user to their pre-created profile on first sign-in
--
-- SECURITY DEFINER because it runs as the auth system, before the new user has
-- any privileges of their own.
-- --------------------------------------------------------------------------

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_profile profiles;
begin
  -- Only Stanford accounts. The app checks this too, and the CHECK constraint
  -- above is the last line — three layers, because this is the access model.
  if lower(new.email) not like '%@stanford.edu' then
    return new;
  end if;

  select * into invited_profile
  from profiles
  where lower(email) = lower(new.email)
  limit 1;

  if invited_profile.id is not null then
    -- Pre-created by whoever invited them. Repoint the row at the real auth id.
    if invited_profile.id <> new.id then
      update profiles
      set id = new.id,
          last_active_at = now()
      where id = invited_profile.id;
    else
      update profiles set last_active_at = now() where id = new.id;
    end if;
  else
    -- No invite. Create an INACTIVE profile rather than nothing at all.
    --
    -- This matters: with no row they'd hit /auth/no-profile, whose only option
    -- is to sign out. With an inactive row they hit /auth/inactive, which
    -- explains the situation and gives leadership something to activate — one
    -- click instead of re-running an invite.
    insert into profiles (id, email, full_name, global_role, status, joined_at)
    values (
      new.id,
      lower(new.email),
      coalesce(
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'name',
        split_part(new.email, '@', 1)
      ),
      'member',
      'inactive',
      current_date
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- --------------------------------------------------------------------------
-- 3. Keep last_active_at fresh
--
-- The RE-liveness check ("has this RE gone quiet for 14 days?") depends on this
-- column, and it would sit permanently null without something writing to it.
-- --------------------------------------------------------------------------

create or replace function touch_last_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
  set last_active_at = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_signin on auth.users;
create trigger on_auth_user_signin
  after update of last_sign_in_at on auth.users
  for each row
  when (new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute function touch_last_active();

-- --------------------------------------------------------------------------
-- 4. Bootstrap the first Co-Lead
--
-- Chicken-and-egg: only a Lead or Co-Lead can invite anyone, and after this
-- migration every new account is created inactive. Somebody has to be seeded by
-- hand, once.
--
-- Kelvin: uncomment and run this with Anish's real Stanford address BEFORE he
-- first signs in. After that he can invite everyone else through the app.
-- --------------------------------------------------------------------------

-- insert into profiles (id, email, full_name, global_role, status, joined_at)
-- values (
--   gen_random_uuid(),          -- replaced by the real auth id on first sign-in
--   'anish25@stanford.edu',
--   'Anish Bayya',
--   'co_lead',
--   'active',
--   current_date
-- );

-- ===========================================================================
-- Verify
-- ===========================================================================
--
-- Trigger exists:
--   select tgname from pg_trigger where tgname = 'on_auth_user_created';
--
-- After the first real sign-in, the ids must match:
--   select p.email, p.id = u.id as linked, p.status, p.global_role
--   from profiles p join auth.users u on lower(u.email) = lower(p.email);
--
-- Anyone stuck inactive who should not be:
--   update profiles set status = 'active' where email = '<address>';


-- ==========================================================================
-- END 0005_profile_provisioning.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0006_bootstrap_co_lead.sql
-- ==========================================================================

-- ===========================================================================
-- 0006_bootstrap_co_lead.sql
--
-- Makes anish25@stanford.edu a Co-Lead.
--
-- WHY THIS IS A SEPARATE MIGRATION RATHER THAN AN EDIT TO 0005
--
-- 0005 ends with a commented-out block that does roughly this, meant to be
-- uncommented before the first sign-in. By the time this was written Kelvin had
-- already stood up the database, so 0005 may well have been applied — and
-- editing an applied migration means the file on disk no longer describes the
-- database, which is the single most confusing state a schema can be in.
--
-- So: additive, and safe to run at ANY time — before the first sign-in, after
-- it, or twice. The three cases it has to survive:
--
--   1. No profile yet          → create one, active, co_lead.
--   2. Profile exists          → promote it, whatever state it's in.
--   3. Already signed in once  → 0005's trigger has repointed the row at the
--                                real auth id. Match on EMAIL, never on id,
--                                or this silently does nothing.
--
-- Requires only 0001. If 0005's block was already uncommented and run, this is
-- a no-op that reports as much.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 0. Let a profile exist before its person does
--
-- `profiles.id` referenced `auth.users(id)`, which makes the invite flow
-- impossible: you cannot pre-create a row for someone who has never signed in,
-- because no auth user exists to point at. Discovered by this migration failing
-- with `violates foreign key constraint "profiles_id_fkey"` — but the same
-- constraint would have broken EVERY invite, not just this bootstrap.
--
-- 0005's `handle_new_auth_user` trigger is built entirely around pre-created
-- rows: it matches an invited profile by email on first sign-in and repoints it
-- at the real auth id. That design and this foreign key cannot both exist.
--
-- So the key goes. `profiles.id` stays a uuid primary key; it simply stops
-- being required to already exist in `auth.users`. A row whose id isn't yet an
-- auth user is exactly what an outstanding invite looks like.
--
-- The trade: nothing at the database level now cascades a profile away when an
-- auth user is deleted. That's acceptable here — this app never hard-deletes
-- people (see CLAUDE.md); it deactivates them, precisely so history survives.
-- --------------------------------------------------------------------------

alter table profiles drop constraint if exists profiles_id_fkey;

do $$
declare
  target_email constant text := 'anish25@stanford.edu';
  target_name  constant text := 'Anish Bayya';
  existing     profiles;
begin
  -- Case-insensitive, because Google may hand back `Anish25@Stanford.edu` and
  -- 0005 made the unique index `lower(email)` for exactly that reason.
  select * into existing
  from profiles
  where lower(email) = lower(target_email)
  limit 1;

  if existing.id is null then
    -- No row yet. The uuid here is a placeholder: 0005's `handle_new_auth_user`
    -- trigger repoints it at the real auth id on first sign-in, matching by
    -- email. Do NOT try to guess the auth id — it doesn't exist yet.
    insert into profiles (id, email, full_name, global_role, status, joined_at)
    values (
      gen_random_uuid(),
      lower(target_email),
      target_name,
      'co_lead',
      'active',
      current_date
    );
    raise notice 'Created % as an active Co-Lead.', target_email;

  elsif existing.global_role = 'co_lead' and existing.status = 'active' then
    raise notice '% is already an active Co-Lead — nothing to do.', target_email;

  else
    -- Promote in place. `status` is set too, because 0005 creates uninvited
    -- accounts as `inactive`: if he signed in before this ran, he has an
    -- inactive row and promoting the role alone would still leave him stuck on
    -- /auth/inactive.
    update profiles
    set global_role = 'co_lead',
        status      = 'active',
        full_name   = coalesce(nullif(full_name, ''), target_name)
    where id = existing.id;
    raise notice 'Promoted % from %/% to co_lead/active.',
      target_email, existing.global_role, existing.status;
  end if;
end $$;

-- ===========================================================================
-- Verify
-- ===========================================================================
--
--   select email, full_name, global_role, status from profiles
--   where lower(email) = 'anish25@stanford.edu';
--
-- Expect exactly one row: co_lead / active.
--
-- After his first sign-in, confirm the trigger linked the row to the auth user
-- (`linked` must be true, or he'll hit /auth/no-profile):
--
--   select p.email, p.id = u.id as linked, p.global_role, p.status
--   from profiles p
--   join auth.users u on lower(u.email) = lower(p.email)
--   where lower(p.email) = 'anish25@stanford.edu';


-- ==========================================================================
-- END 0006_bootstrap_co_lead.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0007_updates_artifacts_events.sql
-- ==========================================================================

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

-- Writing an artifact is an RE's job, inheriting down the project tree.
-- This policy was originally in 0004, which could not work: that migration runs
-- before this table exists. `auth_is_re_for` is defined in 0004, so this is the
-- earliest point both halves are available.
create policy project_artifacts_write on project_artifacts
  for all to authenticated using (auth_is_re_for(project_id));

-- Events are club-wide, so leadership manages them rather than an RE.
create policy events_write on events
  for all to authenticated using (auth_is_leadership());

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


-- ==========================================================================
-- END 0007_updates_artifacts_events.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0008_migration_ledger_and_review_rls.sql
-- ==========================================================================

-- ===========================================================================
-- 0008_migration_ledger_and_review_rls.sql
--
-- Two things the database needs before real people depend on it.
--
--   1. A record of which migrations have been applied.
--   2. The read policies 0007 deliberately deferred — without them a Lead
--      cannot read the check-ins they are responsible for reviewing.
--
-- Both are about the same goal: being able to add features later without
-- breaking what's already there, and without anyone having to remember what
-- state the database is in.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The migration ledger
--
-- Until now NOTHING recorded which migrations had run. That is fine with one
-- developer and an empty database, and dangerous the moment there is data:
-- you cannot tell whether 0005 was applied, re-running it may or may not be
-- safe, and two people can apply different subsets without noticing.
--
-- This table makes "what state is the schema in?" a query instead of a guess.
-- `scripts/db-migrate.mjs` writes to it and skips anything already recorded,
-- so applying migrations becomes idempotent at the file level even where the
-- SQL inside isn't.
-- --------------------------------------------------------------------------

create table if not exists schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now(),
  -- Lets a future check catch a migration that was edited AFTER being applied,
  -- which is the failure mode where the file no longer describes the database.
  checksum    text
);

comment on table schema_migrations is
  'One row per applied migration file. Written by scripts/db-migrate.mjs.';

alter table schema_migrations enable row level security;

-- Deliberately no policy for `authenticated`. Deploy metadata is nobody's
-- business through the public API; the migration runner connects as postgres,
-- which bypasses RLS. Enabled-with-no-policy denies everyone, which is right.

-- Backfill what is already applied, so the ledger starts truthful rather than
-- claiming a populated database is empty.
insert into schema_migrations (version) values
  ('0001_core_schema'),
  ('0002_deliverables_terms_commitment'),
  ('0003_join_requests'),
  ('0004_rls_policies'),
  ('0005_profile_provisioning'),
  ('0006_bootstrap_co_lead'),
  ('0007_updates_artifacts_events')
on conflict (version) do nothing;

-- --------------------------------------------------------------------------
-- 2. Who can read a check-in
--
-- 0007 shipped with only "members see their own" and an explicit STILL TO DO,
-- on the principle that denying too much is recoverable and granting too much
-- is not. This closes it, matching lib/permissions.ts exactly:
--
--   personal report  -> the member, and their LEAD CHAIN. Never REs.
--   per-project half -> everyone.
--
-- The asymmetry is the whole privacy model. An RE gets the project's history
-- without getting a person's record.
-- --------------------------------------------------------------------------

-- Is the current user anywhere up this member's reporting chain?
--
-- Recursive because Lead authority inherits UP an arbitrary number of levels —
-- a Co-Lead oversees their Leads' reports too. Capped at 20 hops: profiles has
-- a self-reference CHECK but nothing prevents a longer cycle, and a cycle here
-- would hang every query that touches a check-in.
create or replace function auth_is_lead_of(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select lead_id, 1 as depth
    from profiles where id = target
    union all
    select p.lead_id, c.depth + 1
    from profiles p
    join chain c on p.id = c.lead_id
    where c.lead_id is not null and c.depth < 20
  )
  select exists (select 1 from chain where lead_id = auth.uid())
      or auth_is_co_lead();
$$;

comment on function auth_is_lead_of is
  'True when the caller is anywhere up target''s reporting chain. Mirrors isLeadOfOrAbove() in lib/permissions.ts.';

-- The personal report: the member, or their Lead chain.
create policy progress_updates_read_chain on progress_updates
  for select to authenticated
  using (member_id = auth.uid() or auth_is_lead_of(member_id));

-- Members write and edit their own; nobody writes someone else's.
create policy progress_updates_write_own on progress_updates
  for insert to authenticated with check (member_id = auth.uid());

create policy progress_updates_update_own on progress_updates
  for update to authenticated using (member_id = auth.uid());

-- A Lead marks a report read. Scoped to the chain, and deliberately not to REs:
-- reviewing is one named person's obligation, which is what makes the
-- escalation in lib/review.ts mean anything.
create policy progress_updates_review on progress_updates
  for update to authenticated using (auth_is_lead_of(member_id));

-- --------------------------------------------------------------------------
-- The per-project half is PUBLIC.
--
-- This is the half that belongs to the project rather than the person: it's the
-- project's history, it's how a passing member spots a blocker they could
-- clear, and it's what REs get instead of access to someone's personal record.
-- --------------------------------------------------------------------------

create policy update_entries_read_all on update_entries
  for select to authenticated using (true);

create policy update_entries_write_own on update_entries
  for all to authenticated
  using (
    exists (
      select 1 from progress_updates u
      where u.id = update_entries.update_id and u.member_id = auth.uid()
    )
  );

-- --------------------------------------------------------------------------
-- 3. Hours: the narrower RE question
--
-- 0004 gave work_logs a policy based on auth_can_view_effort. Add the RE case
-- explicitly: an RE may see time logged ON THEIR PROJECT (inheriting down the
-- tree), and nothing else about that person.
-- --------------------------------------------------------------------------

create policy work_logs_read_project_re on work_logs
  for select to authenticated using (auth_is_re_for(project_id));

-- ===========================================================================
-- Verify
-- ===========================================================================
--
--   select version, applied_at from schema_migrations order by version;
--
--   -- Every table must have RLS on:
--   select tablename from pg_tables
--   where schemaname = 'public' and not rowsecurity;
--   -- expect zero rows


-- ==========================================================================
-- END 0008_migration_ledger_and_review_rls.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0009_deliverable_signoff.sql
-- ==========================================================================

-- ===========================================================================
-- 0009_deliverable_signoff.sql
--
-- Adds the `submitted` state to `deliverable_status`. NOTHING ELSE.
--
-- The two-step sign-off (owner claims `submitted`, an RE agrees `done`) existed
-- only in TypeScript; the enum had no such value. Left alone, the first person
-- to click "Mark done" in live mode would have hit an invalid-enum error.
--
-- ---------------------------------------------------------------------------
-- Why this file is one line
-- ---------------------------------------------------------------------------
--
-- Postgres will not let a new enum value be USED in the transaction that adds
-- it:
--
--   ERROR: unsafe use of new value "submitted" of enum type deliverable_status
--   HINT:  New enum values must be committed before they can be used.
--
-- The migration runner wraps each file in a transaction, so anything
-- referencing 'submitted' — the CHECK constraint, the partial index — has to
-- live in a later file. That's 0010.
--
-- Do not add anything to this migration that mentions 'submitted'.
-- ===========================================================================

alter type deliverable_status add value if not exists 'submitted' before 'done';

-- ===========================================================================
-- Verify
-- ===========================================================================
--
--   select unnest(enum_range(null::deliverable_status));
--   -- expect: open, in_progress, blocked, submitted, done


-- ==========================================================================
-- END 0009_deliverable_signoff.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0010_deliverable_signoff_columns.sql
-- ==========================================================================

-- ===========================================================================
-- 0010_deliverable_signoff_columns.sql
--
-- The rest of the two-step sign-off: who claimed the work, who agreed, and the
-- constraint and index that reference the `submitted` state.
--
-- Separate from 0009 because Postgres refuses to use a new enum value in the
-- transaction that created it. 0009 adds the value; this runs afterwards, once
-- it's committed. Both must be applied — 0009 alone leaves the columns missing,
-- and this alone fails on an unknown enum value.
-- ===========================================================================

alter table deliverables
  add column if not exists submitted_at timestamptz,
  -- Snapshotted rather than derived: REs change over a project's life, and
  -- "who signed this off" has to stay answerable after they've moved on.
  add column if not exists confirmed_by uuid references profiles (id) on delete set null;

comment on column deliverables.submitted_at is
  'When the OWNER marked it done. Not the same as delivered.';
comment on column deliverables.confirmed_by is
  'Which RE signed it off. Only `done` counts toward the Delivered signal.';

-- The RE's queue: work waiting on a signature, oldest first.
create index if not exists deliverables_awaiting_signoff_idx
  on deliverables (project_id, submitted_at)
  where status = 'submitted';

-- 0002 asserts a `done` deliverable has `completed_at`. Same idea here: a
-- `submitted` one must say when, or "how long has this been waiting?" is
-- unanswerable and `pendingSignOffs()` in lib/review.ts silently treats it as
-- zero days old — which is precisely the escalation that stops a quiet RE from
-- freezing everyone's record.
alter table deliverables drop constraint if exists deliverables_submitted_has_timestamp;
alter table deliverables add constraint deliverables_submitted_has_timestamp
  check (status <> 'submitted' or submitted_at is not null);

-- ===========================================================================
-- Verify
-- ===========================================================================
--
--   select column_name from information_schema.columns
--   where table_name = 'deliverables'
--     and column_name in ('submitted_at', 'confirmed_by');
--   -- expect both


-- ==========================================================================
-- END 0010_deliverable_signoff_columns.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0011_second_co_lead.sql
-- ==========================================================================

-- ===========================================================================
-- 0011_second_co_lead.sql
--
-- Adds Jonathan Ananta Lie as a Co-Lead.
--
-- Not just an extra account: until now Anish was the ONLY Co-Lead, and the app
-- refuses to demote or deactivate the last one (see `setGlobalRole` in
-- lib/store/operations.ts). A single Co-Lead is also a single point of failure
-- for every action that only a Co-Lead can take — inviting leadership, changing
-- roles, editing divisions.
--
-- Same idempotent shape as 0006: safe before or after his first sign-in, and
-- safe to run twice. Matches on EMAIL, never on id, because 0005's trigger
-- repoints the row at his real auth id the first time he signs in.
-- ===========================================================================

do $$
declare
  target_email constant text := 'jonlie@stanford.edu';
  target_name  constant text := 'Jonathan Ananta Lie';
  existing     profiles;
begin
  select * into existing
  from profiles
  where lower(email) = lower(target_email)
  limit 1;

  if existing.id is null then
    insert into profiles (id, email, full_name, global_role, status, joined_at)
    values (
      gen_random_uuid(),   -- replaced by the real auth id on first sign-in
      lower(target_email),
      target_name,
      'co_lead',
      'active',
      current_date
    );
    raise notice 'Created % as an active Co-Lead.', target_email;

  elsif existing.global_role = 'co_lead' and existing.status = 'active' then
    raise notice '% is already an active Co-Lead.', target_email;

  else
    update profiles
    set global_role = 'co_lead',
        status      = 'active',
        full_name   = coalesce(nullif(full_name, ''), target_name)
    where id = existing.id;
    raise notice 'Promoted % to co_lead/active.', target_email;
  end if;
end $$;

-- ===========================================================================
-- Verify
-- ===========================================================================
--
--   select email, full_name, global_role, status from profiles
--   where global_role = 'co_lead' order by email;
--   -- expect anish25@ and jonlie@, both active


-- ==========================================================================
-- END 0011_second_co_lead.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0012_capture_google_avatar.sql
-- ==========================================================================

-- ===========================================================================
-- 0012_capture_google_avatar.sql
--
-- Fill in a member's photo from their Google account on first sign-in.
--
-- Profile pictures are the classic field nobody sets. Uploads would need
-- Supabase Storage, policies and a retention decision — and Google already
-- hands us a perfectly good avatar URL in the OAuth payload. Taking it costs
-- nothing and means the roster has faces on it from day one instead of
-- initials forever.
--
-- Only ever fills a BLANK photo. Someone who has pasted their own link keeps
-- it, and re-authenticating never overwrites a deliberate choice.
-- ===========================================================================

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_profile profiles;
  google_avatar   text;
begin
  -- Only Stanford accounts. Checked here, in the app, and by a CHECK
  -- constraint — three layers, because this is the access model.
  if lower(new.email) not like '%@stanford.edu' then
    return new;
  end if;

  -- Google uses `avatar_url`; some providers use `picture`. Try both.
  google_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture'
  );

  select * into invited_profile
  from profiles
  where lower(email) = lower(new.email)
  limit 1;

  if invited_profile.id is not null then
    -- Pre-created by whoever invited them. Repoint the row at the real auth id
    -- and fill in anything still blank.
    update profiles
    set id             = new.id,
        last_active_at = now(),
        photo_url      = coalesce(photo_url, google_avatar),
        full_name      = coalesce(
          nullif(full_name, ''),
          new.raw_user_meta_data->>'full_name',
          new.raw_user_meta_data->>'name',
          full_name
        )
    where id = invited_profile.id;
  else
    -- No invite. Create an INACTIVE profile rather than nothing at all: with no
    -- row they hit /auth/no-profile, whose only option is to sign out. With an
    -- inactive row they hit /auth/inactive, which explains the situation and
    -- gives leadership one click to let them in.
    insert into profiles (
      id, email, full_name, photo_url, global_role, status, joined_at
    )
    values (
      new.id,
      lower(new.email),
      coalesce(
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'name',
        split_part(new.email, '@', 1)
      ),
      google_avatar,
      'member',
      'inactive',
      current_date
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- Verify
-- ===========================================================================
--
-- After the next sign-in:
--   select email, full_name, photo_url is not null as has_photo from profiles;
--
-- Existing members are unaffected until they next authenticate. To backfill
-- someone who has already signed in:
--   update profiles p
--   set photo_url = coalesce(
--         u.raw_user_meta_data->>'avatar_url',
--         u.raw_user_meta_data->>'picture')
--   from auth.users u
--   where u.id = p.id and p.photo_url is null;


-- ==========================================================================
-- END 0012_capture_google_avatar.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0013_write_gaps.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0013 — the write paths that had no policy, and two upsert targets
--
-- Everything here was found by using the app against the real database. Each
-- one produced an error a member would actually hit.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Inviting someone failed: "new row violates row-level security policy for
--    table update_schedules"
--
-- Every member gets a check-in schedule at the moment they're invited, or they
-- would have no obligation and no way to create one from Settings. But the only
-- write policy was `member_id = auth.uid()` — you could write your own and
-- nobody else's, which makes creating one FOR a new person impossible.
--
-- Leadership, not Co-Leads only: a Lead inviting someone onto their own team is
-- the ordinary case, and it's the same authority the invite itself needs.
-- ---------------------------------------------------------------------------

drop policy if exists update_schedules_write_leadership on update_schedules;
create policy update_schedules_write_leadership on update_schedules
  for all to authenticated
  using (auth_is_leadership())
  with check (auth_is_leadership());

-- ---------------------------------------------------------------------------
-- 2. Check-ins could be written but never removed
--
-- There was no delete policy at all, so a test check-in was permanent. You can
-- remove your own; a Co-Lead can remove anyone's, which is the cleanup path
-- while the club is being set up.
--
-- Deliberately NOT extended to Leads over their reports. A Lead deleting a
-- report they were supposed to read would erase the evidence of the obligation
-- and silence the escalation — the two things that make review mean anything.
-- ---------------------------------------------------------------------------

drop policy if exists progress_updates_delete on progress_updates;
create policy progress_updates_delete on progress_updates
  for delete to authenticated
  using (member_id = auth.uid() or auth_is_co_lead());

-- The per-project halves go with it. `update_entries_write_own` covers the
-- author; this covers a Co-Lead deleting somebody else's.
drop policy if exists update_entries_delete_co_lead on update_entries;
create policy update_entries_delete_co_lead on update_entries
  for delete to authenticated
  using (auth_is_co_lead());

-- ---------------------------------------------------------------------------
-- 3. Changing an existing project membership inserted instead of updating
--
-- `project_members` has a surrogate `id` primary key that the app never
-- carries, so an upsert conflicts on `id`, finds nothing, and inserts — then
-- fails on the unique index over (project_id, member_id).
--
-- The existing index is PARTIAL (`where left_at is null`), and Postgres can't
-- infer a partial index from PostgREST's on_conflict parameter, which has no
-- place to put the predicate. A plain constraint can be named directly.
--
-- Safe because the app deletes membership rows rather than setting `left_at` —
-- nothing writes that column today, so the partial predicate is always true and
-- the two are equivalent. If soft-ended memberships ever arrive, this becomes
-- (project_id, member_id, left_at) instead.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_members_project_member_uniq'
  ) then
    -- Any duplicate pair would block the constraint. There shouldn't be one —
    -- the partial index already forbids it for live rows — but a soft-ended
    -- row plus a live row for the same pair would collide.
    delete from project_members a
      using project_members b
     where a.project_id = b.project_id
       and a.member_id = b.member_id
       and a.left_at is not null
       and b.left_at is null;

    alter table project_members
      add constraint project_members_project_member_uniq
      unique (project_id, member_id);
  end if;
end $$;

insert into schema_migrations (version)
values ('0013_write_gaps')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0013_write_gaps.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0014_division_archive_and_project_notices.sql
-- ==========================================================================

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


-- ==========================================================================
-- END 0014_division_archive_and_project_notices.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0015_help_requests.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0015 — the blocker board's third source: free-form asks
--
-- Most of the board is automatic. A deliverable marked blocked, or a blocker
-- written into a check-in, appears there with nobody posting anything. This is
-- the ask that fits neither.
--
-- It matters most now that joining a project goes through an RE. A member whose
-- join request is sitting unanswered otherwise has exactly one route to being
-- useful, and it waits on one person's inbox. "Does anyone know Onshape well
-- enough to look at this?" needs somewhere to go that isn't a project they
-- haven't been added to.
-- ---------------------------------------------------------------------------

create table if not exists help_requests (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references profiles(id) on delete cascade,
  title           text not null,
  detail          text,
  -- Optional: plenty of asks aren't about one project. `set null` rather than
  -- cascade, because deleting a project shouldn't erase the question.
  project_id      uuid references projects(id) on delete set null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references profiles(id) on delete set null,
  resolution_note text
);

-- The board reads open asks oldest-first. Age is the ordering that matters:
-- "nobody has answered Kenji in 6 days" is actionable, "14 open blockers" is a
-- number people learn to scroll past.
create index if not exists help_requests_open_idx
  on help_requests (resolved_at, created_at);

create table if not exists help_replies (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references help_requests(id) on delete cascade,
  member_id  uuid not null references profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists help_replies_request_idx
  on help_replies (request_id, created_at);

alter table help_requests enable row level security;
alter table help_replies enable row level security;

-- ---------------------------------------------------------------------------
-- Anyone signed in can read, post, and answer.
--
-- Deliberately not gated on leadership or on project membership. The whole
-- point of the board is a second route to being useful that doesn't wait on one
-- person — routing answers back through the same people would rebuild the
-- bottleneck one level up.
-- ---------------------------------------------------------------------------

drop policy if exists help_requests_read on help_requests;
create policy help_requests_read on help_requests
  for select to authenticated using (true);

-- You post as yourself. `with check` on the insert is what stops a crafted
-- request appearing under somebody else's name.
drop policy if exists help_requests_insert_own on help_requests;
create policy help_requests_insert_own on help_requests
  for insert to authenticated with check (member_id = auth.uid());

-- Resolving is open to whoever actually unblocked it, not just the asker —
-- often the person who answered knows it's done before the asker comes back.
drop policy if exists help_requests_update on help_requests;
create policy help_requests_update on help_requests
  for update to authenticated using (true) with check (true);

-- Removing one is the asker's own call, or a Co-Lead clearing up.
drop policy if exists help_requests_delete on help_requests;
create policy help_requests_delete on help_requests
  for delete to authenticated
  using (member_id = auth.uid() or auth_is_co_lead());

drop policy if exists help_replies_read on help_replies;
create policy help_replies_read on help_replies
  for select to authenticated using (true);

drop policy if exists help_replies_insert_own on help_replies;
create policy help_replies_insert_own on help_replies
  for insert to authenticated with check (member_id = auth.uid());

drop policy if exists help_replies_modify_own on help_replies;
create policy help_replies_modify_own on help_replies
  for update to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

drop policy if exists help_replies_delete on help_replies;
create policy help_replies_delete on help_replies
  for delete to authenticated
  using (member_id = auth.uid() or auth_is_co_lead());

insert into schema_migrations (version)
values ('0015_help_requests')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0015_help_requests.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0016_update_entry_responses.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0016 — the RE answers a check-in, section by section
--
-- Reading a check-in and answering it are two different obligations belonging
-- to two different people, and only the first existed.
--
-- A Lead marks the whole check-in read: that's an obligation about a PERSON,
-- and `progress_updates.reviewed_at` already records it. But the useful reply
-- to "the vacuum pump seal is leaking" comes from whoever is accountable for
-- that project. A member on three projects needs three different answers from
-- three different people — which is the entire reason `update_entries` is
-- per-project rather than one text field.
--
-- One response per section, not a thread. This is an answer, not a
-- conversation; a conversation belongs on the blocker board. Threading here
-- would turn a 15-minute weekly obligation into an inbox, which is the failure
-- mode the whole review design is built to avoid.
-- ---------------------------------------------------------------------------

alter table update_entries
  add column if not exists response text,
  -- Snapshotted, and null on delete rather than cascading: REs change over a
  -- project's life, and somebody graduating must not silently erase the answer
  -- they gave.
  add column if not exists responded_by uuid references profiles(id) on delete set null,
  add column if not exists responded_at timestamptz;

-- The exception feed asks "which submitted sections have no answer yet",
-- across every entry. A partial index keeps that to the rows that can match.
create index if not exists update_entries_unanswered_idx
  on update_entries (project_id)
  where response is null;

-- ---------------------------------------------------------------------------
-- Who may write one.
--
-- `update_entries` already has a read policy and a write policy scoped to the
-- author (`update_entries_write_own`). An RE is not the author, so answering
-- somebody else's section had no policy at all and would have been refused —
-- the action would succeed, the response would vanish.
--
-- Gated on `auth_is_re_for` and not on leadership: an RE is very often a plain
-- member, and RE authority is exactly what this is. Same function
-- `projects_update` and `project_notices` use, so the three can't disagree.
-- ---------------------------------------------------------------------------

drop policy if exists update_entries_respond_re on update_entries;
create policy update_entries_respond_re on update_entries
  for update to authenticated
  using (auth_is_re_for(project_id) or auth_is_co_lead())
  with check (auth_is_re_for(project_id) or auth_is_co_lead());

insert into schema_migrations (version)
values ('0016_update_entry_responses')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0016_update_entry_responses.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0017_trainings_and_access.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0017 — trainings and facility access
--
-- Two questions, one page: "what am I cleared to use?" and, for a Lead, "who
-- on my team can run the laser cutter?" Certifications are the thing that
-- silently blocks work — somebody can't do a task and nobody knew.
--
-- ---------------------------------------------------------------------------
-- THE CATALOGUE IS DATA. This is the whole design.
-- ---------------------------------------------------------------------------
--
--   "More trainings will always be added later, so it should be easy for any
--    Co-Lead to add more trainings which should automatically populate for
--    everyone as they show up."  — Anish, 2026-08-08
--
-- So sections and items are ROWS, not an enum and not a check constraint on a
-- name. Adding "Waterjet" is an insert a Co-Lead does from the UI, not a
-- migration and a deploy. The club will add machines faster than anybody ships
-- deploys for them, and the moment the two drift the page stops matching the
-- shop floor.
--
-- The ONLY enum here is `kind`, which has exactly two values that behave
-- differently (a door versus a machine) rather than a list that grows.
-- ---------------------------------------------------------------------------

create table if not exists training_sections (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- Manual, because the shop's layout isn't alphabetical and "Misc" belongs
  -- last however it's spelled.
  sort_order int not null default 0
);

create table if not exists catalogue_items (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references training_sections(id) on delete cascade,
  name            text not null,
  -- `site_access` = can you get in the door. `machine` = are you cleared on a
  -- specific machine inside that site. NEITHER IMPLIES THE OTHER: Lab 64
  -- access doesn't clear you on the laser cutter, and clearance on the laser
  -- cutter doesn't open the door at 2am — that's "Lab 64 — 24 hour", which is
  -- its own separate access row.
  kind            text not null check (kind in ('site_access', 'machine')),
  -- Null means it never expires, which is every item in the club's list today.
  validity_months int,
  sort_order      int not null default 0,
  -- Retired, not deleted: existing certifications must keep their meaning.
  is_active       boolean not null default true
);

create index if not exists catalogue_items_section_idx
  on catalogue_items (section_id, sort_order);

create table if not exists member_certifications (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references profiles(id) on delete cascade,
  item_id         uuid not null references catalogue_items(id) on delete cascade,
  status          text not null default 'requested'
                  check (status in ('requested', 'verified', 'expired', 'rejected')),
  completed_at    date not null,
  expires_at      date,
  certificate_url text,
  -- Snapshotted, and null on delete rather than cascading: people change roles
  -- and graduate, and "who signed this off" has to stay answerable.
  verified_by     uuid references profiles(id) on delete set null,
  verified_at     timestamptz,
  note            text,
  requested_at    timestamptz not null default now()
);

-- One row per person per item. Without this a member could request the same
-- training twice and a Lead would verify one copy while the other sat pending
-- forever. The app carries the surrogate `id`, so upserts conflict on the PK
-- correctly and this is a guard rather than an upsert target — see the
-- `project_members` note in 0013 for the version of this that went wrong.
create unique index if not exists member_certifications_unique
  on member_certifications (member_id, item_id);

create index if not exists member_certifications_member_idx
  on member_certifications (member_id, status);

alter table training_sections enable row level security;
alter table catalogue_items enable row level security;
alter table member_certifications enable row level security;

-- ---------------------------------------------------------------------------
-- Reading is public to every member.
--
-- Already promised by PUBLIC_TO_ALL_MEMBERS in lib/permissions.ts: "the roster
-- and everyone's profile basics, trainings, and access." Knowing who can run a
-- machine is how you find the person to ask, which is the app's whole thesis.
-- ---------------------------------------------------------------------------

drop policy if exists training_sections_read on training_sections;
create policy training_sections_read on training_sections
  for select to authenticated using (true);

drop policy if exists catalogue_items_read on catalogue_items;
create policy catalogue_items_read on catalogue_items
  for select to authenticated using (true);

drop policy if exists member_certifications_read on member_certifications;
create policy member_certifications_read on member_certifications
  for select to authenticated using (true);

-- The catalogue itself is the org's shape — Co-Leads only, same as divisions.
drop policy if exists training_sections_write on training_sections;
create policy training_sections_write on training_sections
  for all to authenticated
  using (auth_is_co_lead()) with check (auth_is_co_lead());

drop policy if exists catalogue_items_write on catalogue_items;
create policy catalogue_items_write on catalogue_items
  for all to authenticated
  using (auth_is_co_lead()) with check (auth_is_co_lead());

-- ---------------------------------------------------------------------------
-- Request → verify. NOBODY SELF-VERIFIES.
--
-- A member inserts their own row saying they've done the training. Only
-- leadership can change its status, which is what makes "verified" mean
-- anything at all. `auth_is_leadership` is the closest a policy can get to
-- "their Lead chain or a Co-Lead" without the org graph; the action layer
-- applies the precise rule via `can.verifyTraining`.
-- ---------------------------------------------------------------------------

drop policy if exists member_certifications_request_own on member_certifications;
create policy member_certifications_request_own on member_certifications
  for insert to authenticated with check (member_id = auth.uid());

drop policy if exists member_certifications_verify on member_certifications;
create policy member_certifications_verify on member_certifications
  for update to authenticated
  using (auth_is_leadership()) with check (auth_is_leadership());

-- Withdraw your own request, or leadership clearing up.
drop policy if exists member_certifications_delete on member_certifications;
create policy member_certifications_delete on member_certifications
  for delete to authenticated
  using (member_id = auth.uid() or auth_is_leadership());

-- ---------------------------------------------------------------------------
-- Seed the club's real catalogue.
--
-- Idempotent on name, so re-running never duplicates. Deliberately a SEED and
-- not a fixture: everything here is editable in the app afterwards.
-- ---------------------------------------------------------------------------

insert into training_sections (name, sort_order) values
  ('Robotics Room', 1),
  ('Lab 64', 2),
  ('PRL', 3),
  ('CHIP', 4),
  ('Misc', 99)
on conflict do nothing;

do $$
declare
  robotics uuid;
  lab64    uuid;
  prl      uuid;
  chip     uuid;
begin
  select id into robotics from training_sections where name = 'Robotics Room' limit 1;
  select id into lab64    from training_sections where name = 'Lab 64'        limit 1;
  select id into prl      from training_sections where name = 'PRL'           limit 1;
  select id into chip     from training_sections where name = 'CHIP'          limit 1;

  insert into catalogue_items (section_id, name, kind, sort_order)
  values
    -- Site access: can you get in the door.
    (robotics, 'Robotics Room',                  'site_access', 0),
    (lab64,    'Lab 64',                         'site_access', 0),
    (lab64,    'Lab 64 — 24 hour',               'site_access', 1),
    (prl,      'PRL',                            'site_access', 0),
    (chip,     'CHIP',                           'site_access', 0),

    (robotics, '3D printers',                    'machine', 10),
    (robotics, 'H2D Printer',                    'machine', 11),
    (robotics, 'Makera desktop CNC',             'machine', 12),
    (robotics, 'Battery handling and soldering', 'machine', 13),

    (lab64,    'PRUSA 3D Printing',              'machine', 10),
    (lab64,    'Trotec laser cutter',            'machine', 11),
    (lab64,    'Fablight metal laser cutter',    'machine', 12),
    (lab64,    'Soldering',                      'machine', 13),
    (lab64,    'Machining tools',                'machine', 14),
    (lab64,    'Vapor Phase One',                'machine', 15),
    (lab64,    'Reflow oven',                    'machine', 16),
    (lab64,    'Vacuum former',                  'machine', 17),

    -- PRL has CNCs that need PRL training; everything else there is covered by
    -- the door alone.
    (prl,      'CNC machines',                   'machine', 10),

    (chip,     '3D printers',                    'machine', 10),
    (chip,     'Laser cutter',                   'machine', 11),
    (chip,     'Electronic equipment',           'machine', 12)
  on conflict do nothing;
end $$;

insert into schema_migrations (version)
values ('0017_trainings_and_access')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0017_trainings_and_access.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0018_calendar.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0018 — the calendar
--
-- The calendar answers "what is happening right now, and can I join it?" It is
-- NOT a meeting-scheduling tool: no availability matching, no invite
-- negotiation, no RSVP round trip. Its job is the same as /find-work — make it
-- possible to plug into the club's work without asking a Co-Lead.
--
-- The case that pays for it is the AD-HOC ENGINEERING SESSION. Two people on
-- the wing spar on Thursday night shows up, and a third can turn up.
-- Everything below is in service of that.
-- ---------------------------------------------------------------------------

alter table events
  -- Set for an engineering session. Links the event to the work, and is what
  -- lets `can.createEvent` say "a project you're on".
  add column if not exists project_id uuid references projects(id) on delete cascade,
  -- Who made it, so a member can edit or cancel their own session without
  -- needing leadership. Null on delete, not cascade: somebody graduating must
  -- not delete the club's calendar history.
  add column if not exists created_by uuid references profiles(id) on delete set null,
  -- Names on a session rather than an RSVP flow. The point is "these two are
  -- working on it", not tracking acceptance — an array, for the same reason
  -- project_notices.notified_member_ids is one: write-once, read-whole, never
  -- queried by attendee across events.
  add column if not exists attendee_ids uuid[] not null default '{}',
  -- Anyone can turn up to an open session; a 1:1 is the two people in it.
  -- Defaults true, because an event nobody said otherwise about is one you can
  -- join, which is the behaviour this calendar exists for.
  add column if not exists is_open boolean not null default true,
  add column if not exists notes text;

-- The calendar reads a date window, always. Every view is "this week" or
-- "what's next", never "all events ever".
create index if not exists events_window_idx on events (starts_at);

-- ---------------------------------------------------------------------------
-- Importance is 1–5, and it is NOT a proxy for "is this official".
--
-- A company tour can be a 5 and a routine standup a 2. The constraint is here
-- so a bad write fails loudly rather than producing an event that sorts into
-- nowhere.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_importance_range'
  ) then
    -- Clamp anything already out of range first, or the constraint can't be
    -- added on a database that has been in use.
    update events set importance_weight = least(greatest(importance_weight, 1), 5);
    alter table events
      add constraint events_importance_range
      check (importance_weight between 1 and 5);
  end if;
end $$;

alter table events enable row level security;

-- ---------------------------------------------------------------------------
-- Public to every member, per transparency-by-default for activity. Seeing
-- what's happening is the entire feature; a calendar you can't read is a
-- private diary.
--
-- 1:1s included. They show as a busy block so the time is visible — there is
-- no agenda field, deliberately, so nothing private is on the row to leak.
-- ---------------------------------------------------------------------------

drop policy if exists events_read on events;
create policy events_read on events
  for select to authenticated using (true);

-- Any member can create one. That's the point: a member running a session for
-- a project they're on shouldn't need leadership, and the narrower rule
-- ("a project you're on", "leadership for club-wide") is applied in the action
-- layer where the org graph is available.
drop policy if exists events_insert on events;
create policy events_insert on events
  for insert to authenticated with check (auth.uid() = created_by);

-- Your own, or leadership's. An attendee can't quietly rewrite somebody else's
-- session — they can stop attending, which is an edit to the array by the
-- owner or by leadership.
drop policy if exists events_update on events;
create policy events_update on events
  for update to authenticated
  using (created_by = auth.uid() or auth_is_leadership())
  with check (created_by = auth.uid() or auth_is_leadership());

drop policy if exists events_delete on events;
create policy events_delete on events
  for delete to authenticated
  using (created_by = auth.uid() or auth_is_leadership());

-- ---------------------------------------------------------------------------
-- Hours logged to no project — "misc".
--
-- Follows directly from strangers being able to join a session they saw here:
-- somebody who turns up to help on a project they aren't committed to still
-- worked those hours, and the log refused them because `project_id` had to
-- match a project they were on.
--
-- The column is already nullable; this only documents that null is meaningful
-- rather than missing data.
-- ---------------------------------------------------------------------------
comment on column work_logs.project_id is
  'Null means misc — helping out on something you are not committed to. Set when the hours belong to one project.';

insert into schema_migrations (version)
values ('0018_calendar')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0018_calendar.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0019_profile_delete_policy.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0019 — a Co-Lead can delete a profile row
--
-- Deleting a member reported "Record deleted." and deleted nothing.
--
-- `profiles` has RLS enabled and policies for select, insert and update — and
-- none for DELETE. With RLS on, a missing policy doesn't raise an error: the
-- row is simply invisible to the statement, so `delete from profiles where
-- id = …` matches zero rows and PostgREST returns success. The app's diff saw
-- no error and said it worked.
--
-- Exactly the same shape as the `update_entries` gap fixed in 0016: the action
-- succeeds, the write vanishes, and nothing anywhere says so. It's the most
-- expensive kind of RLS bug precisely because it looks like nothing happened.
--
-- `persistDiff` now also verifies that a delete removed what it meant to, so
-- the next missing policy fails loudly instead of lying.
-- ---------------------------------------------------------------------------

-- Co-Leads only, and never their own row.
--
-- The self-check is here as well as in `lib/permissions.ts` and in the
-- operation, because this is the one deletion that can lock somebody out of
-- their own club — and a policy is the only layer a crafted request can't
-- route around.
--
-- Deliberately NOT extended to Leads. Deactivating is the tool for somebody
-- leaving and any Lead can do that; hard deletion exists for broken duplicate
-- rows, which is an administrative act on the shape of the org.
drop policy if exists profiles_delete_co_lead on profiles;
create policy profiles_delete_co_lead on profiles
  for delete to authenticated
  using (auth_is_co_lead() and id <> auth.uid());

-- ---------------------------------------------------------------------------
-- The two `on delete restrict` references, for the record.
--
--   projects.primary_re_id   — a project with no RE is the one state the model
--                              can't represent, so the app refuses to delete
--                              anyone holding one and says which.
--   deliverables.owner_id    — the app removes their deliverables in the same
--                              write, and `persistDiff` orders deletions so
--                              `profiles` goes last.
--
-- Everything else is `cascade` or `set null`, so nothing else blocks it.
-- ---------------------------------------------------------------------------

insert into schema_migrations (version)
values ('0019_profile_delete_policy')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0019_profile_delete_policy.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0020_commitment_tiers.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0020 — the commitment tiers become data
--
-- `Core is 12+ hrs/week` was four numbers hard-coded in `lib/contribution.ts`,
-- and the published rubric at /how-we-lead printed them. So the one number the
-- club is judged against could only be changed by a deploy — and the moment
-- somebody changed it in conversation without one, the page would be lying
-- about a threshold people are measured on.
--
-- Same reasoning as the trainings catalogue, and the same failure it was built
-- to avoid: the club adjusts its expectations faster than anyone ships code,
-- and a rubric that doesn't match what leadership actually says is worse than
-- no rubric.
--
-- ONE ROW, enforced. This is club-wide configuration, not a per-anything
-- record: a second row would silently mean two different clubs' worth of
-- expectations and nothing would say which one won.
-- ---------------------------------------------------------------------------

create table if not exists club_settings (
  -- Always 1. The check is the whole point — see above.
  id                  integer primary key default 1 check (id = 1),

  -- The four tier floors, in hours per week. Named rather than an array so a
  -- constraint can hold them in order: a rubric where Committed sits above
  -- Core is not a configuration, it's a bug somebody typed.
  core_hours          numeric(4,1) not null default 12,
  committed_hours     numeric(4,1) not null default 8,
  contributing_hours  numeric(4,1) not null default 4,

  -- The floor the club calls "meeting the minimum". Separate from Core because
  -- PROJECT_PLAN states the expectation as a RANGE (10–12), and collapsing it
  -- to one number loses the half that says "you're fine".
  minimum_hours       numeric(4,1) not null default 10,

  updated_at          timestamptz not null default now(),
  updated_by          uuid references profiles(id) on delete set null,

  constraint tiers_in_order check (
    core_hours > committed_hours
    and committed_hours > contributing_hours
    and contributing_hours >= 0
  ),
  -- The minimum has to sit inside the range it describes, or "meets the
  -- minimum" and "is Core" stop being comparable statements.
  constraint minimum_within_range check (
    minimum_hours <= core_hours and minimum_hours >= contributing_hours
  )
);

-- Seed the single row with today's hard-coded values, so applying this changes
-- nothing about what anyone sees.
insert into club_settings (id) values (1) on conflict (id) do nothing;

alter table club_settings enable row level security;

-- Everyone reads it. The rubric is published — a scale that decides
-- advancement but stays hidden from its subject is a performance review with a
-- concealed grade, which is the thing `viewOwnContribution` exists to prevent.
drop policy if exists club_settings_read_all on club_settings;
create policy club_settings_read_all on club_settings
  for select to authenticated using (true);

-- Co-Leads only. This is the definition of the bar the whole club is measured
-- against; it belongs with the other things that reshape the org.
drop policy if exists club_settings_write_co_lead on club_settings;
create policy club_settings_write_co_lead on club_settings
  for update to authenticated
  using (auth_is_co_lead())
  with check (auth_is_co_lead());

insert into schema_migrations (version)
values ('0020_commitment_tiers')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0020_commitment_tiers.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0021_backfill_project_start_dates.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0021 — give every existing project a start date
--
-- `createProject` never set `start_date`. The column has existed since 0001,
-- the type has always had the field, and the demo seed uses it — but nothing
-- in the app wrote it, so every project made through the UI has none.
--
-- Nothing surfaced that until now, because nothing drew a span. A Gantt bar
-- needs a left edge, and a project without one renders as an open-ended bar
-- that starts wherever the chart happens to start — which reads as a decision
-- somebody made rather than as missing data.
--
-- Backfilling to TODAY is Anish's call, and it's the honest one available: the
-- real start dates were never recorded and inventing plausible ones would put
-- fiction on a chart people plan against. Every existing project reads as
-- starting the day the timeline shipped, which is at least true of the record.
--
-- LEAST(current_date, target_date) because 0001 carries
--
--     check (target_date is null or start_date is null or target_date >= start_date)
--
-- and a project already past its target — of which there are some — would
-- otherwise fail this statement and roll the whole migration back.
-- ---------------------------------------------------------------------------

update projects
set start_date = least(current_date, coalesce(target_date, current_date))
where start_date is null;

insert into schema_migrations (version)
values ('0021_backfill_project_start_dates')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0021_backfill_project_start_dates.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0022_delete_cascade_policies.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0022 — the two delete policies the cascades need
--
-- `deleteMember` and `deleteProject` are both Co-Lead operations that clear
-- everything hanging off the row. `lib/store/supabase.ts` turns that into one
-- DELETE per table, so every table in the cascade needs a policy the Co-Lead
-- passes. Two didn't, and both features were therefore broken in live mode:
--
--   join_requests   had NO delete policy at all
--   work_logs       had `member_id = auth.uid()`, so a Co-Lead could clear
--                   their own hours and nobody else's
--
-- Since `persistDiff` now checks the affected-row count, these failed LOUDLY
-- rather than silently — which is the only reason they were found. Before that
-- change, `deleteProject` would have reported success, removed the project,
-- and left orphaned rows behind.
--
-- This is the same shape as the `profiles` bug in 0019 and it will keep
-- recurring: **RLS does not raise on a missing policy.** Any time an operation
-- starts clearing a new table on cascade, check the policy covers whoever is
-- allowed to trigger the cascade — the type checker cannot see this.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- join_requests
--
-- Withdrawing is an UPDATE to `status = 'withdrawn'`, deliberately — a
-- withdrawn ask stays on the record so the RE can see it happened rather than
-- watching a row vanish from their queue. So this is ONLY for the cascade, and
-- it's scoped to the people who can trigger one.
-- --------------------------------------------------------------------------
drop policy if exists join_requests_delete on join_requests;
create policy join_requests_delete on join_requests
  for delete to authenticated
  using (auth_is_re_for(project_id) or auth_is_co_lead());

-- --------------------------------------------------------------------------
-- work_logs
--
-- Deliberately NOT widened to leadership. Hours are the raw material of the
-- Commitment signal, and a Lead quietly deleting a report's logged time would
-- change how that person is described with no record of it. A Co-Lead can,
-- because they're the only ones who can delete a member or a project at all —
-- and both of those operations already refuse to erase real history unless
-- explicitly forced, and say what will be lost.
--
-- A member deleting their OWN mistyped entry is the existing
-- `work_logs_write_own` policy and is untouched.
-- --------------------------------------------------------------------------
drop policy if exists work_logs_delete_co_lead on work_logs;
create policy work_logs_delete_co_lead on work_logs
  for delete to authenticated
  using (auth_is_co_lead());

insert into schema_migrations (version)
values ('0022_delete_cascade_policies')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0022_delete_cascade_policies.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0023_re_paused_notice.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0023 — a third kind of project notice, and an editable club identity
--
-- 1. `re_paused`
--
-- The standing "No deputy RE" warning is gone (see `projectAttentionFlags`).
-- It fired on every parent project with one RE, which in a club this size is
-- most of them, most of the time — and there is frequently no second person to
-- name, so it was permanent and unactionable. A warning like that teaches
-- people to ignore the flags beside it.
--
-- The risk it pointed at is real though, so it's covered at the three moments
-- it actually bites:
--
--   * the RE goes quiet          -> folded into `re_silent`, severity raised
--   * somebody tries to remove   -> `wouldStrandSubProjects` refuses
--   * the RE takes a pause       -> THIS, a notice to their Lead
--
-- The pause case is the one with no other signal at all: an academic pause is
-- a good thing the app actively encourages, and it silently leaves a subtree
-- with nobody able to unblock it. The member isn't doing anything wrong, so
-- nothing is shown to them — their Lead is simply told, and can name a deputy.
--
-- 2. `club_settings.name` / `.description`
--
-- These were a hard-coded literal in `lib/mock-data.ts` rendering in live mode,
-- so the club's own name was the one thing about it nobody could change.
-- ---------------------------------------------------------------------------

alter table project_notices
  drop constraint if exists project_notices_kind_check;

alter table project_notices
  add constraint project_notices_kind_check
  check (kind in ('completed', 'reopened', 're_paused'));

-- --------------------------------------------------------------------------
-- Club identity, alongside the commitment tiers already in this table.
--
-- Nullable with no default: `lib/mock-data.ts` holds the fallback, so an
-- un-edited club keeps reading exactly as it does today and this migration
-- changes nothing visible.
-- --------------------------------------------------------------------------
alter table club_settings
  add column if not exists club_name text,
  add column if not exists club_description text;

insert into schema_migrations (version)
values ('0023_re_paused_notice')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0023_re_paused_notice.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0024_event_rsvp_policies.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0024 — members can RSVP, and run their own sessions
--
-- `events_write` (0007) was `for all to authenticated using
-- (auth_is_leadership())`, written when the calendar was a leadership noticeboard
-- and every event was club-wide. 0018 turned it into something members
-- participate in — `created_by`, `project_id`, sessions a member schedules for
-- their own project, and turning up to anything open — and never revisited the
-- policy. So three things the app explicitly permits were refused by the
-- database:
--
--   * RSVP to an open event      -> UPDATE on events.attendee_ids
--   * create a session           -> INSERT, for a project you're committed to
--   * edit or cancel your own    -> UPDATE, when you aren't leadership
--
-- The reported symptom was a member pressing "I'll be there" and getting
-- "Saving events changed nothing" — which is the affected-row check doing its
-- job. Before that check existed this would have silently done nothing.
--
-- **The lesson, since this is now the fourth time:** widening WHO may do
-- something in `lib/permissions.ts` does not widen it in Postgres. The two live
-- in different languages in different directories and nothing links them. When
-- a feature grows a new audience, its policies need re-reading.
--
-- ---------------------------------------------------------------------------
-- Why RSVP needs a trigger and not just a policy
-- ---------------------------------------------------------------------------
--
-- Attendance is a `uuid[]` ON the event row, so RSVP is an UPDATE of the whole
-- row. RLS grants are per-row, not per-column, and `WITH CHECK` only sees the
-- NEW row — it cannot say "only attendee_ids changed". A policy loose enough to
-- let anybody RSVP is therefore loose enough to let anybody rename the event.
--
-- Column-level GRANTs can't help either: leadership and members are the same
-- `authenticated` role, so a column grant would restrict both or neither.
--
-- So the policy allows the row, and a BEFORE UPDATE trigger enforces the
-- column. That gives the precise rule — a member may change the guest list of
-- an open event and nothing else — with real teeth rather than trusting the
-- application layer alone.
--
-- The clean long-term fix is an `event_attendees` join table, which makes RSVP
-- an INSERT/DELETE with a trivial policy. `ClubEvent.attendeeIds` justifies the
-- array as "write-once, read-whole, never queried by attendee" — that stopped
-- being true the moment attendees started writing to it themselves. Noted in
-- docs/HANDOFF.md as the follow-up; not done now because it's a data migration
-- on the eve of launch and this is correct in the meantime.
-- ---------------------------------------------------------------------------

drop policy if exists events_write on events;

-- --------------------------------------------------------------------------
-- Creating. Leadership anywhere; anyone else only as themselves.
--
-- The app additionally requires a plain member to be COMMITTED to the project
-- they're scheduling for (`can.createEvent`). That check needs the membership
-- table and the org graph, and duplicating it here would be a second copy of a
-- rule that would drift. What the database guarantees is narrower and still
-- worth having: whatever you create is attributed to you.
-- --------------------------------------------------------------------------
drop policy if exists events_insert on events;
create policy events_insert on events
  for insert to authenticated
  with check (auth_is_leadership() or created_by = auth.uid());

-- --------------------------------------------------------------------------
-- Editing. The organiser, or leadership tidying the club calendar.
-- Mirrors `can.manageEvent` exactly.
-- --------------------------------------------------------------------------
drop policy if exists events_update_manage on events;
create policy events_update_manage on events
  for update to authenticated
  using (auth_is_leadership() or created_by = auth.uid())
  with check (auth_is_leadership() or created_by = auth.uid());

-- --------------------------------------------------------------------------
-- Turning up. Anyone, to anything open — that is the point of the calendar.
--
-- A closed event is excluded here and stays excluded: `setEventAttendance`
-- refuses one in the app, and its guest list may only be set by the organiser
-- through `setEventGuestList`, which lands on the policy above.
-- --------------------------------------------------------------------------
drop policy if exists events_rsvp on events;
create policy events_rsvp on events
  for update to authenticated
  using (is_open)
  with check (is_open);

-- --------------------------------------------------------------------------
-- …and the column guard that makes the broad RSVP policy safe.
-- --------------------------------------------------------------------------
create or replace function events_rsvp_only_touches_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The organiser and leadership edit freely; this guard is for everyone else.
  if auth_is_leadership() or old.created_by = auth.uid() then
    return new;
  end if;

  if new.title is distinct from old.title
     or new.kind is distinct from old.kind
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.location is distinct from old.location
     or new.notes is distinct from old.notes
     or new.project_id is distinct from old.project_id
     or new.importance_weight is distinct from old.importance_weight
     or new.is_open is distinct from old.is_open
     or new.created_by is distinct from old.created_by
  then
    raise exception
      'Only the organiser can change this event. You can add or remove yourself from it.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists events_rsvp_guard on events;
create trigger events_rsvp_guard
  before update on events
  for each row
  execute function events_rsvp_only_touches_attendance();

insert into schema_migrations (version)
values ('0024_event_rsvp_policies')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0024_event_rsvp_policies.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0025_discord_user_id.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0025 — a member's Discord id, so the app can DM them
--
-- Notifications are in-app only, which means somebody added to a project finds
-- out the next time they happen to open the site. For the events that matter —
-- you've been put on something, your ask was answered, one of your people just
-- checked in — that's too late to be useful.
--
-- A DM rather than a channel post, deliberately. A channel that fires on every
-- club event gets muted inside a week, and a muted channel is worse than no
-- channel: it looks like notification coverage and delivers none. A DM arrives
-- for exactly the person who needs to act, and nobody else sees it.
--
-- Nullable and opt-in. A member who never fills it in simply gets nothing
-- extra, and every path checks for it — see `lib/notify/discord.ts`.
--
-- Stored as text, not a number: Discord snowflakes are 64-bit and JavaScript
-- rounds those past 2^53. `"1234567890123456789"` survives; 1234567890123456789
-- silently becomes a different id.
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists discord_user_id text;

-- Digits only, 17-20 of them. Catches the commonest paste errors — a username
-- like "anish#0001", or the whole "<@1234...>" mention wrapper.
alter table profiles
  drop constraint if exists profiles_discord_user_id_check;
alter table profiles
  add constraint profiles_discord_user_id_check
  check (discord_user_id is null or discord_user_id ~ '^[0-9]{17,20}$');

insert into schema_migrations (version)
values ('0025_discord_user_id')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0025_discord_user_id.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0026_discord_verified.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0026 — proof that a member's Discord ID actually reaches them
--
-- 0025 added `discord_user_id`. Having one is not the same as being reachable:
-- a typo'd snowflake, a member who never joined the club's Discord server, or
-- anyone with "allow DMs from server members" switched off all produce an ID
-- that looks correct and silently delivers nothing.
--
-- That's the worst state to be in — worse than no ID at all — because the app
-- and the member both believe notifications are working. So an ID only counts
-- once the bot has successfully sent to it, and this column is the receipt.
--
-- Cleared whenever the ID changes (see `updateProfile`), because a new ID is
-- an unproven one.
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists discord_verified_at timestamptz;

insert into schema_migrations (version)
values ('0026_discord_verified')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0026_discord_verified.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0027_checkin_reminders.sql
-- ==========================================================================

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


-- ==========================================================================
-- END 0027_checkin_reminders.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0028_deliverable_todos.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0028 — checklists under a deliverable
--
-- ---------------------------------------------------------------------------
-- This is NOT sub-tasks, and the distinction is the whole design
-- ---------------------------------------------------------------------------
--
-- `CLAUDE.md` says the deliverable IS the task model: one flat list, one owner,
-- one date, no dependencies, no sub-tasks. That still holds, and this doesn't
-- break it — because a todo is deliberately not a unit of work.
--
-- The problem it solves: "move the parts from Trudy's office to the robotics
-- room" was being entered as a deliverable, because it was a thing that needed
-- doing and a deliverable was the only place to put it. But a deliverable
-- COUNTS — it's the Delivered signal, the one contribution measure that can't
-- be inflated — and a fifteen-minute errand sitting next to a spar redesign
-- makes that number meaningless. Ten errands and somebody looks twice as
-- productive as the person who shipped the airframe.
--
-- So todos carry no owner, no date, no credit, and never appear in any count.
-- They exist to be ticked. What they DO carry is a gate: a deliverable can't be
-- signed off while any of its todos are open, which is what makes writing them
-- down worth doing rather than a second place to keep a list nobody reads.
--
-- If you find yourself wanting an owner or a due date on one of these, it isn't
-- a todo — it's a deliverable, and it should be one.
-- ---------------------------------------------------------------------------

create table if not exists deliverable_todos (
  id            uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references deliverables(id) on delete cascade,
  title         text not null check (length(trim(title)) > 0),
  done          boolean not null default false,
  -- Who ticked it and when. Not for credit — for answering "who said this was
  -- handled?" three weeks later, which is the only question anybody asks.
  done_at       timestamptz,
  done_by       uuid references profiles(id) on delete set null,
  sort_order    integer not null default 0,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  -- `done` and `done_at` must agree, or "3 of 5 done" and the list disagree.
  constraint todo_done_has_timestamp check (
    (done and done_at is not null) or (not done and done_at is null)
  )
);

-- Always read as "the todos for this deliverable", never across deliverables.
create index if not exists deliverable_todos_parent_idx
  on deliverable_todos (deliverable_id, sort_order);

alter table deliverable_todos enable row level security;

-- Public to read, like the deliverables they hang off. Seeing what's left on a
-- piece of work is how somebody spots that they could pick one up.
drop policy if exists deliverable_todos_read on deliverable_todos;
create policy deliverable_todos_read on deliverable_todos
  for select to authenticated using (true);

-- --------------------------------------------------------------------------
-- Written by the deliverable's OWNER or any RE of its project.
--
-- Wider than `deliverables_manage`, which is REs only. The owner is the person
-- actually doing the work and the one who discovers what it turns out to
-- involve — making them ask an RE to add "book the CNC" would guarantee the
-- list stays empty and the feature goes unused.
--
-- `auth_is_re_for` already includes Co-Leads.
-- --------------------------------------------------------------------------
drop policy if exists deliverable_todos_write on deliverable_todos;
create policy deliverable_todos_write on deliverable_todos
  for all to authenticated
  using (
    exists (
      select 1 from deliverables d
      where d.id = deliverable_todos.deliverable_id
        and (d.owner_id = auth.uid() or auth_is_re_for(d.project_id))
    )
  )
  with check (
    exists (
      select 1 from deliverables d
      where d.id = deliverable_todos.deliverable_id
        and (d.owner_id = auth.uid() or auth_is_re_for(d.project_id))
    )
  );

insert into schema_migrations (version)
values ('0028_deliverable_todos')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0028_deliverable_todos.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0029_checkin_late_notice.sql
-- ==========================================================================

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


-- ==========================================================================
-- END 0029_checkin_late_notice.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0030_discord_invite_url.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0030 — the club's Discord invite link
--
-- ---------------------------------------------------------------------------
-- Data, not a constant, for the same reason the club's name is
-- ---------------------------------------------------------------------------
--
-- An invite link is not permanent by nature. Discord's default expires after
-- seven days, anybody with Manage Server can revoke one, and a server that
-- gets raided regenerates all of them. Hard-coding it means the day it stops
-- working is a deploy, and in the meantime every new member follows a dead
-- link on the page whose entire job is getting them set up.
--
-- So a Co-Lead pastes the current one into Settings and it appears everywhere
-- at once — the getting-started guide and the "you haven't connected Discord"
-- banner. Same reasoning as `club_name` (0023), the trainings catalogue and
-- the commitment tiers: the club changes faster than anyone ships.
--
-- ---------------------------------------------------------------------------
-- Why the CHECK is not paranoia
-- ---------------------------------------------------------------------------
--
-- This value renders as a link in a banner on every page, for every member,
-- and specifically to the people who are newest and most likely to click
-- whatever they are told to. A typo is harmless; a pasted phishing URL is not.
-- The constraint keeps it to Discord's own two invite hosts, so the worst a
-- mistake can do is point at the wrong server.
-- ---------------------------------------------------------------------------

alter table club_settings
  add column if not exists discord_invite_url text;

alter table club_settings
  drop constraint if exists club_settings_discord_invite_url_check;

alter table club_settings
  add constraint club_settings_discord_invite_url_check check (
    discord_invite_url is null
    or discord_invite_url ~ '^https://(discord\.gg|discord\.com/invite)/[A-Za-z0-9-]+$'
  );

insert into schema_migrations (version)
values ('0030_discord_invite_url')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0030_discord_invite_url.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0031_advisor_role.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0031 — the `advisor` role
--
-- A faculty or project advisor. Somebody who sees everything and can say
-- something about anything, but builds nothing: no projects, no deliverables,
-- no hours, no check-ins, and nobody above or below them in the reporting
-- chain.
--
-- ---------------------------------------------------------------------------
-- This file adds the enum value and NOTHING else, deliberately
-- ---------------------------------------------------------------------------
--
-- Postgres will not let a transaction use an enum value it added in that same
-- transaction, and `scripts/db-migrate.mjs` wraps every migration file in one.
-- So any statement that wanted to WRITE 'advisor' — a backfill, a policy
-- comparing against it, a default — has to live in a later file. Splitting it
-- out is cheaper than discovering that rule from an error message that reads
-- "unsafe use of new value of enum type".
--
-- ---------------------------------------------------------------------------
-- Why a role and not a boolean
-- ---------------------------------------------------------------------------
--
-- An advisor is a different KIND of person, not a member with a flag. Every
-- question the app asks about somebody — do they owe a check-in, do they have a
-- Lead, do they appear in the commitment tiers, can they be given a deliverable
-- — has a different answer for them, and a boolean sitting beside
-- `global_role = 'member'` would mean every one of those checks had to remember
-- to consult both fields. Roles are the thing the app already branches on.
--
-- Note that this breaks the "ordered least to most authority" reading of the
-- enum. Advisor is not a rung on that ladder; it is off to one side. The
-- application no longer relies on the ordering — see `isLeadership` in
-- `lib/permissions.ts`, which replaced twenty `globalRole !== 'member'` checks
-- that would each have silently granted advisors a leadership power.
-- ---------------------------------------------------------------------------

alter type global_role add value if not exists 'advisor';

insert into schema_migrations (version)
values ('0031_advisor_role')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0031_advisor_role.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0032_project_advisors.sql
-- ==========================================================================

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


-- ==========================================================================
-- END 0032_project_advisors.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0033_member_requests.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0033 — "can I have access to…" — a member asks one named Lead for something
--
-- ---------------------------------------------------------------------------
-- Why this is not the trainings catalogue
-- ---------------------------------------------------------------------------
--
-- `catalogue_items` already handles doors and machines: a member requests a
-- clearance, a Lead verifies it, it lands on the dashboard. That flow stays
-- exactly as it is and should be used for anything with a `kind` — the
-- robotics room, the laser cutter, the mill.
--
-- This is for everything that has no `kind` and never will: the Fusion team
-- drive, an Onshape seat, the GitHub org, a key to the cabinet, borrowing the
-- good calipers. Forcing those into `site_access` would either lie about what
-- they are or push the club to invent a taxonomy of software, which is the
-- `TrainingCategory` mistake the catalogue was built to avoid.
--
-- The line between the two: **if it needs training, it's a catalogue item; if
-- it just needs somebody to say yes, it's one of these.**
--
-- ---------------------------------------------------------------------------
-- Addressed to ONE person, on purpose
-- ---------------------------------------------------------------------------
--
-- `lead_id` is not nullable and there is no "any leader" fanout. A request
-- everybody can see is a request nobody owns — the bystander effect, the same
-- reason `blockerAudience` routes a blocker to one person instead of five.
-- The member picks who by opening that person's profile, which also means the
-- app never has to guess who owns the Fusion drive.
--
-- A Co-Lead can answer anything, so nothing is stranded if the person asked
-- goes quiet for a fortnight.
-- ---------------------------------------------------------------------------

create table if not exists member_requests (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references profiles(id) on delete cascade,
  -- Who they asked. `cascade` rather than `set null`: with no recipient this
  -- row is unanswerable and belongs to nobody's queue, and a request that can
  -- never be closed is worse than one that's gone.
  lead_id      uuid not null references profiles(id) on delete cascade,
  body         text not null check (length(trim(body)) > 0),
  status       text not null default 'pending'
                 check (status in ('pending', 'granted', 'declined')),
  -- The Lead's answer. Required when declining — see `answerMemberRequest`;
  -- "no" with no reason is the thing that stops people asking again.
  response     text,
  responded_by uuid references profiles(id) on delete set null,
  responded_at timestamptz,
  created_at   timestamptz not null default now(),

  -- Status and its evidence must agree, or the dashboard count and the row
  -- disagree about whether anything is owed.
  constraint member_request_answered_together check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

-- The queue reads "pending, addressed to me, oldest first". Age is what makes
-- it actionable: "Kenji has been waiting 6 days" beats "4 open requests".
create index if not exists member_requests_queue_idx
  on member_requests (lead_id, created_at)
  where status = 'pending';

create index if not exists member_requests_mine_idx
  on member_requests (member_id, created_at desc);

alter table member_requests enable row level security;

-- --------------------------------------------------------------------------
-- Readable by the two people it concerns, and by Co-Leads.
--
-- NOT public, unlike most activity in this app. A request can be personal in a
-- way a deliverable never is — "can I get into the building outside hours
-- because I don't have anywhere else to work" — and the transparency default
-- covers the club's WORK, not what somebody had to ask for.
-- --------------------------------------------------------------------------
drop policy if exists member_requests_read on member_requests;
create policy member_requests_read on member_requests
  for select to authenticated
  using (
    member_id = auth.uid()
    or lead_id = auth.uid()
    or auth_is_co_lead()
  );

-- Anybody may ask, but only as themselves — `member_id = auth.uid()` is what
-- stops a request being filed in somebody else's name.
drop policy if exists member_requests_create on member_requests;
create policy member_requests_create on member_requests
  for insert to authenticated
  with check (member_id = auth.uid());

-- Answered by the person asked, or a Co-Lead. The asker may also update their
-- own row, which is how withdrawing works.
drop policy if exists member_requests_update on member_requests;
create policy member_requests_update on member_requests
  for update to authenticated
  using (lead_id = auth.uid() or member_id = auth.uid() or auth_is_co_lead())
  with check (lead_id = auth.uid() or member_id = auth.uid() or auth_is_co_lead());

drop policy if exists member_requests_delete on member_requests;
create policy member_requests_delete on member_requests
  for delete to authenticated
  using (member_id = auth.uid() or auth_is_co_lead());

insert into schema_migrations (version)
values ('0033_member_requests')
on conflict (version) do nothing;


-- ==========================================================================
-- END 0033_member_requests.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0034_artifact_write_policies.sql
-- ==========================================================================

-- ===========================================================================
-- 0034_artifact_write_policies.sql
--
-- The engineering record gets a writer and a freeze.
--
-- 0007 shipped one policy for all three verbs:
--
--   create policy project_artifacts_write on project_artifacts
--     for all to authenticated using (auth_is_re_for(project_id));
--
-- That was right when nothing could write at all — the "Add link" button on the
-- project page was literally `disabled`, so the record was read-only in
-- practice and the policy never ran. Now that attaching exists, adding and
-- removing need to be different rights:
--
--   INSERT — anyone COMMITTED to the project, plus REs above it and Co-Leads.
--     Wider on purpose. The person who ran the test holds the test report, and
--     making every attachment go through the RE rebuilds the "go ask someone"
--     bottleneck this app exists to remove. The predictable result of the
--     narrow rule is an empty record.
--
--   UPDATE / DELETE — REs and Co-Leads, and Co-Leads ALONE once the project is
--     complete. At that point the record stops being a working document and
--     becomes the club's history. Adding to history extends it; deleting from
--     it rewrites it, and the person closest to the work is the one most
--     tempted to tidy.
--
-- Note that INSERT does NOT check phase. A final report is usually written the
-- week after the work stops, and blocking that would mean the record can never
-- actually be finished.
--
-- Policy-only: no columns change, so `loadSnapshot` is unaffected and this can
-- land before or after the app deploy without a window of 500s. It is still
-- the safety net rather than the rule — `lib/permissions.ts` is the rule, and
-- these are deliberately a shade coarser.
--
-- Ordering: depends on 0004 (auth_is_re_for, auth_is_co_lead) and 0007
-- (project_artifacts). Additive, idempotent, safe to re-run.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Is the current user committed to this project?
--
-- `commitment` is not a column — the app derives it from `role`, where an
-- `observer` row is what following looks like (see `lib/store/mapping.ts`).
-- Following is deliberately NOT enough: watching a project doesn't make its
-- record yours to write.
--
-- SECURITY DEFINER for the same reason as every helper in 0004: it reads
-- project_members from inside a policy evaluation and must not recurse through
-- the policies on that table.
-- --------------------------------------------------------------------------

create or replace function auth_is_committed_to(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members
    where project_id = target_project
      and member_id = auth.uid()
      and left_at is null
      and role <> 'observer'
  );
$$;

-- --------------------------------------------------------------------------
-- Replace the single `for all` policy with one per verb.
--
-- The drop must come first: `for all` overlaps every policy below it, and
-- Postgres ORs permissive policies together — leaving it in place would keep
-- granting RE-only DELETE on completed projects no matter what we add.
-- --------------------------------------------------------------------------

drop policy if exists project_artifacts_write on project_artifacts;

create policy project_artifacts_insert on project_artifacts
  for insert to authenticated
  with check (
    auth_is_re_for(project_id)          -- already includes Co-Leads
    or auth_is_committed_to(project_id)
  );

create policy project_artifacts_update on project_artifacts
  for update to authenticated
  using (
    auth_is_co_lead()
    or (
      auth_is_re_for(project_id)
      and not exists (
        select 1 from projects p
        where p.id = project_id and p.phase = 'complete'
      )
    )
  );

create policy project_artifacts_delete on project_artifacts
  for delete to authenticated
  using (
    auth_is_co_lead()
    or (
      auth_is_re_for(project_id)
      and not exists (
        select 1 from projects p
        where p.id = project_id and p.phase = 'complete'
      )
    )
  );

-- ===========================================================================
-- Verify:
--
--   select policyname, cmd from pg_policies
--   where tablename = 'project_artifacts' order by cmd;
--   -- expect: project_artifacts_delete (DELETE), project_artifacts_insert
--   --         (INSERT), project_artifacts_read_all (SELECT),
--   --         project_artifacts_update (UPDATE).
--   -- `project_artifacts_write` (ALL) must be GONE.
-- ===========================================================================


-- ==========================================================================
-- END 0034_artifact_write_policies.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0035_storage_buckets.sql
-- ==========================================================================

-- ===========================================================================
-- 0035_storage_buckets.sql
--
-- File storage, finally. Two buckets, deliberately different.
--
--   project-docs  PRIVATE. Engineering documents attached to a project.
--   avatars       PUBLIC.  Profile photos.
--
-- Why they differ, since "just make both public" is the tempting shortcut:
--
--   A profile photo is already effectively public — `profiles.photo_url` has
--   held a Google avatar URL since 0012, and those are unauthenticated URLs
--   anyone can fetch. A public avatars bucket changes nothing about who can
--   see a member's face, and it avoids re-minting a signed URL for every face
--   on the roster page on every render.
--
--   An engineering document is NOT already public. `project_artifacts_read_all`
--   requires an authenticated Stanford session today, and a public bucket would
--   quietly downgrade that to "anyone who ever sees the URL, forever". Loosening
--   a boundary later is easy; tightening one is impossible, because every URL
--   already handed out keeps working. So: private, read through short-lived
--   signed URLs minted per request in `lib/data/projects.ts`.
--
-- BOTH are capped at 512 KB server-side. The app checks the same number before
-- uploading, but a client-side limit is a courtesy, not a control — this is
-- the one that holds. Supabase enforces `file_size_limit` and
-- `allowed_mime_types` at the storage API, so a hand-rolled request can't get
-- past them either.
--
-- Ordering: depends on 0001 (profiles), 0007 (project_artifacts) and 0034
-- (auth_is_committed_to). Idempotent — safe to re-run.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The buckets
-- --------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-docs',
  'project-docs',
  false,
  524288,                                    -- 512 KB
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    -- STEP files have no registered MIME type and browsers send this for any
    -- extension they don't know. Excluding it would reject the exact format
    -- this feature was asked for.
    'application/octet-stream'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  524288,                                    -- 512 KB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- --------------------------------------------------------------------------
-- 2. Reading the project id out of an object path
--
-- Path convention is `<project_id>/<artifact_id>-<filename>`, so the first
-- folder segment IS the project the policies need to check against.
--
-- Wrapped in an exception handler rather than casting inline, because a
-- straight `(storage.foldername(name))[1]::uuid` raises on any object whose
-- first segment isn't a UUID — and a raising policy fails the whole statement
-- instead of just denying that row.
-- --------------------------------------------------------------------------

create or replace function storage_project_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, storage
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception
  when others then return null;
end;
$$;

-- --------------------------------------------------------------------------
-- 3. project-docs policies
--
-- Mirrors `project_artifacts` in 0034, one level down: anyone committed to the
-- project may add, only an RE may remove, and a Co-Lead alone once the project
-- is complete. Deliberately the same shape, because a file the row points at
-- and the row itself becoming separately reachable is how you end up with
-- orphaned documents nobody can see and nobody can delete.
-- --------------------------------------------------------------------------

drop policy if exists project_docs_read on storage.objects;
drop policy if exists project_docs_insert on storage.objects;
drop policy if exists project_docs_delete on storage.objects;

-- Any signed-in member, same as reading the artifact row. Activity is
-- transparent; this is the file behind a row they can already see.
create policy project_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'project-docs' and auth_is_member());

create policy project_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-docs'
    and storage_project_id(name) is not null
    and (
      auth_is_re_for(storage_project_id(name))
      or auth_is_committed_to(storage_project_id(name))
    )
  );

create policy project_docs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-docs'
    and storage_project_id(name) is not null
    and (
      auth_is_co_lead()
      or (
        auth_is_re_for(storage_project_id(name))
        and not exists (
          select 1 from projects p
          where p.id = storage_project_id(name) and p.phase = 'complete'
        )
      )
    )
  );

-- --------------------------------------------------------------------------
-- 4. avatars policies
--
-- Path convention is `<member_id>/<filename>`, so the folder IS the owner.
-- Reading is open because the bucket is public; these three cover writes.
--
-- Nobody can write into somebody else's folder — including a Co-Lead. Changing
-- another member's photo isn't an administrative need, it's an impersonation
-- vector, and there is no case for it.
-- --------------------------------------------------------------------------

drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;

create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- --------------------------------------------------------------------------
-- 5. Where an uploaded document lives
--
-- `file_url` cannot hold this. The bucket is private, so there is no permanent
-- URL to store — only a path we sign on demand. Putting a path in a column
-- called `_url` would mean every reader has to guess which of the two it got,
-- and `ArtifactList` renders `fileUrl` straight into an href.
--
-- The existing constraint requires a link OR a file; an upload is now a third
-- way to satisfy it.
-- --------------------------------------------------------------------------

alter table project_artifacts
  add column if not exists storage_path text;

alter table project_artifacts
  drop constraint if exists project_artifacts_has_target;

alter table project_artifacts
  add constraint project_artifacts_has_target check (
    file_url is not null
    or external_url is not null
    or storage_path is not null
  );

-- ===========================================================================
-- Verify:
--
--   select id, public, file_size_limit from storage.buckets
--   where id in ('project-docs', 'avatars');
--   -- project-docs: public=false, 524288.  avatars: public=true, 524288.
--
--   select policyname, cmd from pg_policies
--   where tablename = 'objects' and schemaname = 'storage'
--     and policyname like any (array['project_docs%', 'avatars%']);
--   -- expect 6: 3 project_docs (select/insert/delete), 3 avatars
--   --           (insert/update/delete).
-- ===========================================================================


-- ==========================================================================
-- END 0035_storage_buckets.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0036_mcp_tokens.sql
-- ==========================================================================

-- ===========================================================================
-- 0036_mcp_tokens.sql
--
-- Personal tokens, so a member can point their own AI at the club through the
-- MCP server at /api/mcp.
--
-- Deliberately NOT part of the app snapshot. Every other table in this schema
-- is loaded wholesale into `lib/store/*` on every request, and credentials have
-- no business being in a structure that renders pages. `lib/mcp/*` queries this
-- table directly.
--
-- Ordering: depends on 0001 (profiles). Additive, idempotent.
-- ===========================================================================

create table if not exists mcp_tokens (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references profiles (id) on delete cascade,

  -- What device or client this is for. Exists so revoking means something —
  -- "revoke one of your three tokens" is unanswerable without a name.
  name          text not null,

  -- SHA-256 of the token, hex. NEVER the token itself.
  --
  -- The plaintext is shown once, at creation, and then it is genuinely gone:
  -- a leaked database backup must not hand somebody the club's whole API. This
  -- is also why there is no "show token again" button anywhere in the UI.
  token_hash    text not null unique,

  -- 'read' or 'write'. Read is the default in the UI, because most people
  -- connecting an assistant want to ask questions, and a token that can only
  -- answer them cannot damage anything.
  scope         text not null default 'read'
                  check (scope in ('read', 'write')),

  created_at    timestamptz not null default now(),
  -- Surfaced in Settings so a token nobody uses is visible and revocable.
  last_used_at  timestamptz,
  -- A student's token should not outlive their membership by years.
  expires_at    timestamptz not null default (now() + interval '180 days'),
  revoked_at    timestamptz
);

create index if not exists mcp_tokens_member_idx
  on mcp_tokens (member_id) where revoked_at is null;

-- The MCP server's hot path: hash the presented token, look it up.
create index if not exists mcp_tokens_hash_idx on mcp_tokens (token_hash);

-- --------------------------------------------------------------------------
-- RLS
--
-- A member manages their own tokens and cannot see anybody else's — not even
-- a Co-Lead, and that is on purpose. A token is a credential, not club data.
-- There is no administrative reason to read someone else's, and every reason
-- not to be able to.
--
-- `token_hash` is unreadable by design anyway (it's a hash), but the rows also
-- carry names and usage times, which say a lot about how somebody works.
-- --------------------------------------------------------------------------

alter table mcp_tokens enable row level security;

drop policy if exists mcp_tokens_own_select on mcp_tokens;
drop policy if exists mcp_tokens_own_insert on mcp_tokens;
drop policy if exists mcp_tokens_own_update on mcp_tokens;
drop policy if exists mcp_tokens_own_delete on mcp_tokens;

create policy mcp_tokens_own_select on mcp_tokens
  for select to authenticated using (member_id = auth.uid());

create policy mcp_tokens_own_insert on mcp_tokens
  for insert to authenticated with check (member_id = auth.uid());

-- Revoking is an update (setting `revoked_at`), not a delete: the row is the
-- record that the token existed, and `last_used_at` on a revoked token is how
-- you find out whether it was used before you killed it.
create policy mcp_tokens_own_update on mcp_tokens
  for update to authenticated using (member_id = auth.uid());

create policy mcp_tokens_own_delete on mcp_tokens
  for delete to authenticated using (member_id = auth.uid());

-- ===========================================================================
-- Verify:
--
--   select column_name from information_schema.columns
--   where table_name = 'mcp_tokens' order by ordinal_position;
--
--   select policyname, cmd from pg_policies
--   where tablename = 'mcp_tokens' order by cmd;
--   -- expect four, all scoped to auth.uid().
-- ===========================================================================


-- ==========================================================================
-- END 0036_mcp_tokens.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0037_daily_digest.sql
-- ==========================================================================

-- ===========================================================================
-- 0037_daily_digest.sql
--
-- Bookkeeping for the daily Discord digest that REs and Leads receive.
--
-- Two columns on `profiles`, both about the SAME failure: a bot that says too
-- much gets muted, and a muted bot is worse than no bot, because everything
-- else the club sends goes with it.
--
--   daily_digest_opt_out   somebody decided they don't want it.
--   daily_digest_sent_on   the last day one actually went out.
--
-- Ordering: depends on 0001 (profiles). Additive, idempotent.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- The off switch
--
-- Opt-OUT rather than opt-in, deliberately. The digest is for people holding
-- responsibility — an RE whose project has gone quiet, a Lead whose report is
-- blocked — and those are exactly the people who won't go and enable a feature
-- they've never seen. Default on, one checkbox in Settings to stop it.
--
-- A plain member who is neither an RE nor a Lead never receives one at all, so
-- this column is irrelevant to most of the club.
-- --------------------------------------------------------------------------

alter table profiles
  add column if not exists daily_digest_opt_out boolean not null default false;

-- --------------------------------------------------------------------------
-- Send-once memory
--
-- A DATE, not a timestamp: the question is "has today's gone out", and a
-- timestamp invites arithmetic that gets timezones wrong. The club runs on
-- Pacific and the database is UTC, so the value written is the club-time day
-- from `todayInClubTime()`, never `now()::date`.
--
-- Written BEFORE the DM, same as `reminder_sent_at` in 0027: a crash between
-- the two costs one missed digest, where the other order costs a duplicate on
-- every retry. Missing one is much cheaper than a bot that repeats itself.
-- --------------------------------------------------------------------------

alter table profiles
  add column if not exists daily_digest_sent_on date;

-- Anyone who hasn't had today's yet, cheaply.
create index if not exists profiles_digest_idx
  on profiles (daily_digest_sent_on)
  where daily_digest_opt_out = false;

-- ===========================================================================
-- Verify:
--
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_name = 'profiles'
--     and column_name like 'daily_digest%';
--   -- expect two: boolean default false, and date.
-- ===========================================================================


-- ==========================================================================
-- END 0037_daily_digest.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0038_guide_blocks.sql
-- ==========================================================================

-- ===========================================================================
-- 0038_guide_blocks.sql
--
-- Club-written material on the two guide pages: /getting-started ("New here?")
-- and /leading ("What can a Lead do").
--
-- ---------------------------------------------------------------------------
-- What is DATA here, and what stays in code
-- ---------------------------------------------------------------------------
--
-- Not everything on those pages becomes editable, and the line matters.
--
--   Code  — how the APP works. "Log hours from My Work", "sign-off is what
--           counts", the permission table on /leading. If a Co-Lead could edit
--           those they would drift from the app the moment a feature changed,
--           and a guide that confidently describes a button that no longer
--           exists is worse than no guide.
--
--   Data  — how the CLUB works. Where the Fusion licence comes from, which
--           Google Doc explains the KiCad setup, what a Lead is expected to
--           chase this quarter. The club changes these faster than anybody
--           ships a deploy, which is the same argument that made the trainings
--           catalogue data rather than an enum (CLAUDE.md §9).
--
-- So this table holds the second kind, and the pages render it in a named slot
-- underneath the hard-coded material.
--
-- Ordering: depends on 0001 (profiles). Additive, idempotent.
-- ===========================================================================

create table if not exists guide_blocks (
  id          uuid primary key default gen_random_uuid(),

  -- Which page it appears on. A text check rather than an enum, deliberately:
  -- adding a third guide page should not need a migration that alters a type.
  page        text not null check (page in ('getting_started', 'leading')),

  /*
    'link' points at something outside the app — a Google Doc, a Drive folder,
    a YouTube walkthrough. 'note' is prose the club wants on the page.

    Two kinds rather than one, because they render differently and a link with
    no URL is a dead row. The check constraint below makes that impossible.
  */
  kind        text not null default 'link' check (kind in ('link', 'note')),

  title       text not null,
  -- Optional for a link (one line of "what is this"), the whole point for a note.
  body        text,
  url         text,

  /*
    A heading the club invents — "Software setup", "Shop safety", "Templates".
    Free text, not an enum, for the same reason as `page`. Blank groups under a
    default heading rather than vanishing.
  */
  category    text,

  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Who last touched it, so "who wrote this" is answerable a year later.
  updated_by  uuid references profiles (id) on delete set null,

  -- A link with no URL renders as a dead row on a page new members are told to
  -- trust. Same shape as `project_artifacts_has_target` in 0007.
  constraint guide_blocks_link_has_url check (kind <> 'link' or url is not null),
  constraint guide_blocks_note_has_body check (kind <> 'note' or body is not null)
);

create index if not exists guide_blocks_page_idx
  on guide_blocks (page, sort_order);

-- --------------------------------------------------------------------------
-- RLS
--
-- Read: every signed-in member. These pages ARE the onboarding — a new member
-- has to be able to read them on day one, before they are on any project.
--
-- Write: Co-Leads only. This is the club's official word to new members about
-- how the club works; it is not a wiki. `auth_is_co_lead()` comes from 0004.
-- --------------------------------------------------------------------------

alter table guide_blocks enable row level security;

drop policy if exists guide_blocks_read on guide_blocks;
drop policy if exists guide_blocks_write on guide_blocks;

create policy guide_blocks_read on guide_blocks
  for select to authenticated using (auth_is_member());

create policy guide_blocks_write on guide_blocks
  for all to authenticated using (auth_is_co_lead())
  with check (auth_is_co_lead());

-- ===========================================================================
-- Verify:
--
--   select policyname, cmd from pg_policies
--   where tablename = 'guide_blocks' order by cmd;
--   -- expect ALL (co-lead) and SELECT (any member).
-- ===========================================================================


-- ==========================================================================
-- END 0038_guide_blocks.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0039_remove_hours.sql
-- ==========================================================================

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


-- ==========================================================================
-- END 0039_remove_hours.sql
-- ==========================================================================


-- ==========================================================================
-- BEGIN 0040_deadline_changes.sql
-- ==========================================================================

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


-- ==========================================================================
-- END 0040_deadline_changes.sql
-- ==========================================================================
