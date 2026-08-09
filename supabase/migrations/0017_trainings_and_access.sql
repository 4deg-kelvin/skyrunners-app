-- ---------------------------------------------------------------------------
-- 0017 — trainings and facility access
--
-- Two questions, one page: "what am I cleared to use?" and, for a Lead, "who
-- on my team can run the laser cutter?" Certifications are the thing that
-- silently blocks work — somebody can't do a task and nobody knew.
--
-- ---------------------------------------------------------------------------
-- THE CATALOGUE IS DATA. This is the whole design.
-- ---------------------------------------------------------------------------
--
--   "More trainings will always be added later, so it should be easy for any
--    Co-Lead to add more trainings which should automatically populate for
--    everyone as they show up."  — Anish, 2026-08-08
--
-- So sections and items are ROWS, not an enum and not a check constraint on a
-- name. Adding "Waterjet" is an insert a Co-Lead does from the UI, not a
-- migration and a deploy. The club will add machines faster than anybody ships
-- deploys for them, and the moment the two drift the page stops matching the
-- shop floor.
--
-- The ONLY enum here is `kind`, which has exactly two values that behave
-- differently (a door versus a machine) rather than a list that grows.
-- ---------------------------------------------------------------------------

create table if not exists training_sections (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- Manual, because the shop's layout isn't alphabetical and "Misc" belongs
  -- last however it's spelled.
  sort_order int not null default 0
);

create table if not exists catalogue_items (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references training_sections(id) on delete cascade,
  name            text not null,
  -- `site_access` = can you get in the door. `machine` = are you cleared on a
  -- specific machine inside that site. NEITHER IMPLIES THE OTHER: Lab 64
  -- access doesn't clear you on the laser cutter, and clearance on the laser
  -- cutter doesn't open the door at 2am — that's "Lab 64 — 24 hour", which is
  -- its own separate access row.
  kind            text not null check (kind in ('site_access', 'machine')),
  -- Null means it never expires, which is every item in the club's list today.
  validity_months int,
  sort_order      int not null default 0,
  -- Retired, not deleted: existing certifications must keep their meaning.
  is_active       boolean not null default true
);

create index if not exists catalogue_items_section_idx
  on catalogue_items (section_id, sort_order);

create table if not exists member_certifications (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references profiles(id) on delete cascade,
  item_id         uuid not null references catalogue_items(id) on delete cascade,
  status          text not null default 'requested'
                  check (status in ('requested', 'verified', 'expired', 'rejected')),
  completed_at    date not null,
  expires_at      date,
  certificate_url text,
  -- Snapshotted, and null on delete rather than cascading: people change roles
  -- and graduate, and "who signed this off" has to stay answerable.
  verified_by     uuid references profiles(id) on delete set null,
  verified_at     timestamptz,
  note            text,
  requested_at    timestamptz not null default now()
);

-- One row per person per item. Without this a member could request the same
-- training twice and a Lead would verify one copy while the other sat pending
-- forever. The app carries the surrogate `id`, so upserts conflict on the PK
-- correctly and this is a guard rather than an upsert target — see the
-- `project_members` note in 0013 for the version of this that went wrong.
create unique index if not exists member_certifications_unique
  on member_certifications (member_id, item_id);

create index if not exists member_certifications_member_idx
  on member_certifications (member_id, status);

alter table training_sections enable row level security;
alter table catalogue_items enable row level security;
alter table member_certifications enable row level security;

-- ---------------------------------------------------------------------------
-- Reading is public to every member.
--
-- Already promised by PUBLIC_TO_ALL_MEMBERS in lib/permissions.ts: "the roster
-- and everyone's profile basics, trainings, and access." Knowing who can run a
-- machine is how you find the person to ask, which is the app's whole thesis.
-- ---------------------------------------------------------------------------

drop policy if exists training_sections_read on training_sections;
create policy training_sections_read on training_sections
  for select to authenticated using (true);

drop policy if exists catalogue_items_read on catalogue_items;
create policy catalogue_items_read on catalogue_items
  for select to authenticated using (true);

drop policy if exists member_certifications_read on member_certifications;
create policy member_certifications_read on member_certifications
  for select to authenticated using (true);

-- The catalogue itself is the org's shape — Co-Leads only, same as divisions.
drop policy if exists training_sections_write on training_sections;
create policy training_sections_write on training_sections
  for all to authenticated
  using (auth_is_co_lead()) with check (auth_is_co_lead());

drop policy if exists catalogue_items_write on catalogue_items;
create policy catalogue_items_write on catalogue_items
  for all to authenticated
  using (auth_is_co_lead()) with check (auth_is_co_lead());

-- ---------------------------------------------------------------------------
-- Request → verify. NOBODY SELF-VERIFIES.
--
-- A member inserts their own row saying they've done the training. Only
-- leadership can change its status, which is what makes "verified" mean
-- anything at all. `auth_is_leadership` is the closest a policy can get to
-- "their Lead chain or a Co-Lead" without the org graph; the action layer
-- applies the precise rule via `can.verifyTraining`.
-- ---------------------------------------------------------------------------

drop policy if exists member_certifications_request_own on member_certifications;
create policy member_certifications_request_own on member_certifications
  for insert to authenticated with check (member_id = auth.uid());

drop policy if exists member_certifications_verify on member_certifications;
create policy member_certifications_verify on member_certifications
  for update to authenticated
  using (auth_is_leadership()) with check (auth_is_leadership());

-- Withdraw your own request, or leadership clearing up.
drop policy if exists member_certifications_delete on member_certifications;
create policy member_certifications_delete on member_certifications
  for delete to authenticated
  using (member_id = auth.uid() or auth_is_leadership());

-- ---------------------------------------------------------------------------
-- Seed the club's real catalogue.
--
-- Idempotent on name, so re-running never duplicates. Deliberately a SEED and
-- not a fixture: everything here is editable in the app afterwards.
-- ---------------------------------------------------------------------------

insert into training_sections (name, sort_order) values
  ('Robotics Room', 1),
  ('Lab 64', 2),
  ('PRL', 3),
  ('CHIP', 4),
  ('Misc', 99)
on conflict do nothing;

do $$
declare
  robotics uuid;
  lab64    uuid;
  prl      uuid;
  chip     uuid;
begin
  select id into robotics from training_sections where name = 'Robotics Room' limit 1;
  select id into lab64    from training_sections where name = 'Lab 64'        limit 1;
  select id into prl      from training_sections where name = 'PRL'           limit 1;
  select id into chip     from training_sections where name = 'CHIP'          limit 1;

  insert into catalogue_items (section_id, name, kind, sort_order)
  values
    -- Site access: can you get in the door.
    (robotics, 'Robotics Room',                  'site_access', 0),
    (lab64,    'Lab 64',                         'site_access', 0),
    (lab64,    'Lab 64 — 24 hour',               'site_access', 1),
    (prl,      'PRL',                            'site_access', 0),
    (chip,     'CHIP',                           'site_access', 0),

    (robotics, '3D printers',                    'machine', 10),
    (robotics, 'H2D Printer',                    'machine', 11),
    (robotics, 'Makera desktop CNC',             'machine', 12),
    (robotics, 'Battery handling and soldering', 'machine', 13),

    (lab64,    'PRUSA 3D Printing',              'machine', 10),
    (lab64,    'Trotec laser cutter',            'machine', 11),
    (lab64,    'Fablight metal laser cutter',    'machine', 12),
    (lab64,    'Soldering',                      'machine', 13),
    (lab64,    'Machining tools',                'machine', 14),
    (lab64,    'Vapor Phase One',                'machine', 15),
    (lab64,    'Reflow oven',                    'machine', 16),
    (lab64,    'Vacuum former',                  'machine', 17),

    -- PRL has CNCs that need PRL training; everything else there is covered by
    -- the door alone.
    (prl,      'CNC machines',                   'machine', 10),

    (chip,     '3D printers',                    'machine', 10),
    (chip,     'Laser cutter',                   'machine', 11),
    (chip,     'Electronic equipment',           'machine', 12)
  on conflict do nothing;
end $$;

insert into schema_migrations (version)
values ('0017_trainings_and_access')
on conflict (version) do nothing;
