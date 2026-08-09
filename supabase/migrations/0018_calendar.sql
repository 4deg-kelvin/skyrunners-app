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
