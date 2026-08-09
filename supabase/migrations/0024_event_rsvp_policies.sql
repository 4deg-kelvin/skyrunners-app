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
