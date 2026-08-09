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
