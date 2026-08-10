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
