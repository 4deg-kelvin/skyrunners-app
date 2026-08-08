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
-- Sources: 0001_core_schema.sql, 0002_deliverables_terms_commitment.sql, 0003_join_requests.sql, 0004_rls_policies.sql, 0005_profile_provisioning.sql, 0006_bootstrap_co_lead.sql, 0007_updates_artifacts_events.sql, 0008_migration_ledger_and_review_rls.sql


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
