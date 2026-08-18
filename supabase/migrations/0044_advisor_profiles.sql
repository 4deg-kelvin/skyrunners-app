-- ===========================================================================
-- 0044 — advisor profiles: degrees, current role, employer
-- ===========================================================================
--
-- An advisor is a faculty or industry advisor. They own no deliverables and file
-- no check-ins by design, so the things that make a student's profile worth
-- reading are all absent from theirs — before this, an advisor's page was a name
-- and an email address. A student deciding whether to ask them about a composite
-- layup has nothing to go on.
--
-- ---------------------------------------------------------------------------
-- Why a separate table rather than columns on `profiles`
-- ---------------------------------------------------------------------------
--
-- Three reasons, in order of how much they matter.
--
--   1. **The app can ship before this migration is applied.** `profiles` is read
--      by the per-request snapshot with an EXPLICIT column list, so adding a
--      column there means the app selects it — and a select naming a column that
--      does not exist yet fails EVERY page with a 500 until the SQL lands (see
--      docs/HANDOFF.md on `loadSnapshot`). A separate table is read by its own
--      fail-soft query in `lib/advisors/store.ts`, which returns null if the
--      table is missing. Deploy order stops being load-bearing.
--   2. It is sparse. One or two rows in a club of thirty-five, so three nullable
--      columns on every profile would be mostly empty.
--   3. `degrees` is a LIST OF RECORDS, not a scalar.
--
-- ---------------------------------------------------------------------------
-- Why `degrees` is jsonb and not three parallel arrays
-- ---------------------------------------------------------------------------
--
-- Each degree is a triple: what it was, where, and when. Parallel `text[]`
-- columns would let the three drift out of alignment — a degree with somebody
-- else's year is worse than no year — and there is no way to make Postgres
-- enforce that they stay the same length. jsonb keeps a degree as one object.
--
-- Not a child table, because nothing ever queries across degrees: they are read
-- and written as a whole list, always for one person, and a table would add a
-- join and an ordering column to buy a query nobody makes.

create table if not exists advisor_profiles (
  member_id  uuid primary key references profiles (id) on delete cascade,

  -- [{ "degree": "PhD Aeronautics", "school": "Stanford", "year": 2011 }, …]
  -- Order is meaningful and preserved: advisors list the relevant one first.
  degrees    jsonb not null default '[]'::jsonb,

  -- What they do now. Two fields rather than one string, so "Staff Engineer" and
  -- "Joby Aviation" can be rendered, sorted and searched separately later.
  job_title  text,
  employer   text,

  updated_at timestamptz not null default now(),

  -- A guard rather than a schema: jsonb would happily accept a string or a
  -- number here, and the form has no reason to send either.
  constraint advisor_profiles_degrees_is_array
    check (jsonb_typeof(degrees) = 'array')
);

comment on table advisor_profiles is
  'Faculty/industry advisor background. Separate from profiles so the app can '
  'ship before this migration is applied — see the header of 0044.';

alter table advisor_profiles enable row level security;

-- ---------------------------------------------------------------------------
-- Readable by the whole club, writable only by its owner
-- ---------------------------------------------------------------------------
--
-- Public on purpose: this is the advisor equivalent of the roster, and the entire
-- point is that a member can find out who to ask without asking a Co-Lead first.
-- Nothing here is sensitive — it is what somebody would put on a faculty page.
drop policy if exists advisor_profiles_read on advisor_profiles;
create policy advisor_profiles_read on advisor_profiles
  for select to authenticated
  using (true);

-- `for all` rather than separate insert/update policies, and that is deliberate:
-- `persistDiff` splits inserts from updates, an upsert never reaches a
-- `for update` policy, and a cascade delete needs a DELETE policy or it silently
-- matches nothing. Same reasoning as `calendar_feeds_own` in 0041.
drop policy if exists advisor_profiles_own on advisor_profiles;
create policy advisor_profiles_own on advisor_profiles
  for all to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());
