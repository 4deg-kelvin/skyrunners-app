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
