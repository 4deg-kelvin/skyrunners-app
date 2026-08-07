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
