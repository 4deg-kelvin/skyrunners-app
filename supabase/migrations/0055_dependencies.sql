-- ===========================================================================
-- 0055 — Dependencies: "this is waiting on that", declared and displayed
-- ===========================================================================
--
-- The club asked for this on 2026-09-08. `docs/DECISIONS.md` and the header of
-- `lib/gantt.ts` both reject a critical-path Gantt, so it is worth being exact
-- about what this is and is not, because the difference is the reason it was
-- allowed to exist.
--
-- **Rejected, and still rejected:** a schedule COMPUTED from a dependency
-- graph. Slack, earliest-start, critical path, dates that reflow when one moves.
-- On a volunteer team whose availability swings with midterms that is wrong the
-- day after it is entered, and a wrong schedule is worse than none because
-- people plan against it.
--
-- **This:** a row saying one thing waits on another, drawn where both appear.
-- Nothing computes a date. Nothing blocks a sign-off. `lib/dependencies.ts`
-- holds the reasoning in full and is the only place the rules live.
--
-- Four columns instead of two, and why
-- -------------------------------------------------------------------------
--
-- Either end can be a project or a deliverable, which is the classic case for a
-- polymorphic `(kind, id)` pair. That is refused here in favour of four
-- nullable columns with REAL foreign keys, because the alternative has no
-- referential integrity: nothing would stop a row pointing at a deleted
-- project, and the app would then render a dependency on something that does
-- not exist. `on delete cascade` means a deleted project or deliverable takes
-- its links with it, which is the behaviour every reader can then assume.
--
-- The cost is two `num_nonnulls` checks instead of a NOT NULL, paid once here.
--
-- Which combinations are legal
-- -------------------------------------------------------------------------
--
--   deliverable → deliverable    "my layup waits on your mould"
--   project     → project        "load testing waits on the spar redesign"
--   deliverable → project        "the coupon report waits on layup qualification"
--
-- `project → deliverable` is refused by a CHECK, not merely by the UI. A whole
-- project waiting on one person's single task inverts the sizes: if a project
-- genuinely hinges on one deliverable, either that deliverable belongs to the
-- project or the two projects depend on each other.
--
-- Scope — siblings and ancestors — is NOT enforced here
-- -------------------------------------------------------------------------
--
-- Deliberately. It needs a recursive walk of `projects.parent_id` on every
-- write, and the app already computes the eligible list to build the picker
-- (`eligibleProjectTargets`). Duplicating a tree walk in SQL buys a guard
-- against a hand-crafted API call, at the price of two implementations of the
-- same rule that will disagree the first time either is edited.
--
-- What IS enforced here is everything that cannot be fixed by a later edit: the
-- shape, referential integrity, and no self-reference. A too-broad link is a
-- visible mistake somebody can delete; a dangling one is a rendering bug.
--
-- Re-runnable.

create table if not exists dependencies (
  id uuid primary key default gen_random_uuid(),

  -- The thing that is WAITING. Exactly one of these two is set.
  dependent_project_id     uuid references projects (id) on delete cascade,
  dependent_deliverable_id uuid references deliverables (id) on delete cascade,

  -- The thing it waits ON. Exactly one of these two is set.
  target_project_id     uuid references projects (id) on delete cascade,
  target_deliverable_id uuid references deliverables (id) on delete cascade,

  -- Optional one-line "why", written by whoever added it. The picker asks for
  -- it but does not require it: a link with no note is still a true fact, and
  -- demanding prose is how a control stops being used.
  note text,

  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint dependencies_one_dependent
    check (num_nonnulls(dependent_project_id, dependent_deliverable_id) = 1),
  constraint dependencies_one_target
    check (num_nonnulls(target_project_id, target_deliverable_id) = 1),

  -- No project → deliverable. See the header.
  constraint dependencies_no_project_on_deliverable
    check (dependent_project_id is null or target_deliverable_id is null),

  -- Nothing waits on itself.
  constraint dependencies_not_self check (
    dependent_project_id is null
    or target_project_id is null
    or dependent_project_id <> target_project_id
  ),
  constraint dependencies_not_self_deliverable check (
    dependent_deliverable_id is null
    or target_deliverable_id is null
    or dependent_deliverable_id <> target_deliverable_id
  )
);

/*
  One link per pair, in one direction.

  A partial unique index rather than a table constraint, because the columns are
  nullable and `unique` treats NULLs as distinct — so the plain constraint would
  happily allow the same link twice. `coalesce` to a fixed sentinel makes the
  four columns compare as one key.
*/
create unique index if not exists dependencies_unique_pair
  on dependencies (
    coalesce(dependent_project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(dependent_deliverable_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_deliverable_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Read paths: "what does this wait on" and "what waits on this". Both are used
-- — the second is what lets a project page warn that somebody else is blocked
-- on it, which is the half a PL cannot otherwise discover.
create index if not exists dependencies_dependent_project_idx
  on dependencies (dependent_project_id);
create index if not exists dependencies_dependent_deliverable_idx
  on dependencies (dependent_deliverable_id);
create index if not exists dependencies_target_project_idx
  on dependencies (target_project_id);
create index if not exists dependencies_target_deliverable_idx
  on dependencies (target_deliverable_id);

comment on table dependencies is
  'One thing waiting on another, declared by a PL and displayed. NOT a '
  'critical path: nothing here computes a date and nothing blocks a sign-off. '
  'See lib/dependencies.ts for the rules and docs/DECISIONS.md for why the '
  'computed version stays rejected.';

alter table dependencies enable row level security;

-- Public to the club, like every other fact about a project. A dependency is
-- part of the answer to "what is happening here".
drop policy if exists dependencies_read on dependencies;
create policy dependencies_read on dependencies
  for select to authenticated
  using (true);

/*
  Writes belong to the DEPENDENT side's PL, and only that side.

  The asymmetry is the point: declaring "my work waits on yours" is a statement
  about MY work, and needs no permission from you. The reverse — being able to
  declare that somebody else's project waits on mine — would let anyone hang a
  warning off a project they have nothing to do with.

  `auth_is_re_for` walks the project tree since 0052, so a parent's PL and a
  Division Lead both qualify. A deliverable's dependency is governed by its
  project's PL rather than by the deliverable's owner: the PL shapes the
  deliverables, and this is a statement about the shape of the work.
*/
drop policy if exists dependencies_write_dependent_side on dependencies;
create policy dependencies_write_dependent_side on dependencies
  for all to authenticated
  using (
    auth_is_co_lead()
    or (
      dependent_project_id is not null
      and auth_is_re_for(dependent_project_id)
    )
    or (
      dependent_deliverable_id is not null
      and auth_is_re_for(
        (select d.project_id from deliverables d
          where d.id = dependencies.dependent_deliverable_id)
      )
    )
  )
  with check (
    auth_is_co_lead()
    or (
      dependent_project_id is not null
      and auth_is_re_for(dependent_project_id)
    )
    or (
      dependent_deliverable_id is not null
      and auth_is_re_for(
        (select d.project_id from deliverables d
          where d.id = dependencies.dependent_deliverable_id)
      )
    )
  );

insert into schema_migrations (version)
values ('0055_dependencies')
on conflict (version) do nothing;
