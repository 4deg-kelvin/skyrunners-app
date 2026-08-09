-- ---------------------------------------------------------------------------
-- 0020 — the commitment tiers become data
--
-- `Core is 12+ hrs/week` was four numbers hard-coded in `lib/contribution.ts`,
-- and the published rubric at /how-we-lead printed them. So the one number the
-- club is judged against could only be changed by a deploy — and the moment
-- somebody changed it in conversation without one, the page would be lying
-- about a threshold people are measured on.
--
-- Same reasoning as the trainings catalogue, and the same failure it was built
-- to avoid: the club adjusts its expectations faster than anyone ships code,
-- and a rubric that doesn't match what leadership actually says is worse than
-- no rubric.
--
-- ONE ROW, enforced. This is club-wide configuration, not a per-anything
-- record: a second row would silently mean two different clubs' worth of
-- expectations and nothing would say which one won.
-- ---------------------------------------------------------------------------

create table if not exists club_settings (
  -- Always 1. The check is the whole point — see above.
  id                  integer primary key default 1 check (id = 1),

  -- The four tier floors, in hours per week. Named rather than an array so a
  -- constraint can hold them in order: a rubric where Committed sits above
  -- Core is not a configuration, it's a bug somebody typed.
  core_hours          numeric(4,1) not null default 12,
  committed_hours     numeric(4,1) not null default 8,
  contributing_hours  numeric(4,1) not null default 4,

  -- The floor the club calls "meeting the minimum". Separate from Core because
  -- PROJECT_PLAN states the expectation as a RANGE (10–12), and collapsing it
  -- to one number loses the half that says "you're fine".
  minimum_hours       numeric(4,1) not null default 10,

  updated_at          timestamptz not null default now(),
  updated_by          uuid references profiles(id) on delete set null,

  constraint tiers_in_order check (
    core_hours > committed_hours
    and committed_hours > contributing_hours
    and contributing_hours >= 0
  ),
  -- The minimum has to sit inside the range it describes, or "meets the
  -- minimum" and "is Core" stop being comparable statements.
  constraint minimum_within_range check (
    minimum_hours <= core_hours and minimum_hours >= contributing_hours
  )
);

-- Seed the single row with today's hard-coded values, so applying this changes
-- nothing about what anyone sees.
insert into club_settings (id) values (1) on conflict (id) do nothing;

alter table club_settings enable row level security;

-- Everyone reads it. The rubric is published — a scale that decides
-- advancement but stays hidden from its subject is a performance review with a
-- concealed grade, which is the thing `viewOwnContribution` exists to prevent.
drop policy if exists club_settings_read_all on club_settings;
create policy club_settings_read_all on club_settings
  for select to authenticated using (true);

-- Co-Leads only. This is the definition of the bar the whole club is measured
-- against; it belongs with the other things that reshape the org.
drop policy if exists club_settings_write_co_lead on club_settings;
create policy club_settings_write_co_lead on club_settings
  for update to authenticated
  using (auth_is_co_lead())
  with check (auth_is_co_lead());

insert into schema_migrations (version)
values ('0020_commitment_tiers')
on conflict (version) do nothing;
