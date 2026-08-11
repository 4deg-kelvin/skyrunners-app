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
