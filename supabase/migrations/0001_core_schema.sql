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
