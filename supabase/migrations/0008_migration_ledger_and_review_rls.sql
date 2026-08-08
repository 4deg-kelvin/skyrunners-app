-- ===========================================================================
-- 0008_migration_ledger_and_review_rls.sql
--
-- Two things the database needs before real people depend on it.
--
--   1. A record of which migrations have been applied.
--   2. The read policies 0007 deliberately deferred — without them a Lead
--      cannot read the check-ins they are responsible for reviewing.
--
-- Both are about the same goal: being able to add features later without
-- breaking what's already there, and without anyone having to remember what
-- state the database is in.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The migration ledger
--
-- Until now NOTHING recorded which migrations had run. That is fine with one
-- developer and an empty database, and dangerous the moment there is data:
-- you cannot tell whether 0005 was applied, re-running it may or may not be
-- safe, and two people can apply different subsets without noticing.
--
-- This table makes "what state is the schema in?" a query instead of a guess.
-- `scripts/db-migrate.mjs` writes to it and skips anything already recorded,
-- so applying migrations becomes idempotent at the file level even where the
-- SQL inside isn't.
-- --------------------------------------------------------------------------

create table if not exists schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now(),
  -- Lets a future check catch a migration that was edited AFTER being applied,
  -- which is the failure mode where the file no longer describes the database.
  checksum    text
);

comment on table schema_migrations is
  'One row per applied migration file. Written by scripts/db-migrate.mjs.';

alter table schema_migrations enable row level security;

-- Deliberately no policy for `authenticated`. Deploy metadata is nobody's
-- business through the public API; the migration runner connects as postgres,
-- which bypasses RLS. Enabled-with-no-policy denies everyone, which is right.

-- Backfill what is already applied, so the ledger starts truthful rather than
-- claiming a populated database is empty.
insert into schema_migrations (version) values
  ('0001_core_schema'),
  ('0002_deliverables_terms_commitment'),
  ('0003_join_requests'),
  ('0004_rls_policies'),
  ('0005_profile_provisioning'),
  ('0006_bootstrap_co_lead'),
  ('0007_updates_artifacts_events')
on conflict (version) do nothing;

-- --------------------------------------------------------------------------
-- 2. Who can read a check-in
--
-- 0007 shipped with only "members see their own" and an explicit STILL TO DO,
-- on the principle that denying too much is recoverable and granting too much
-- is not. This closes it, matching lib/permissions.ts exactly:
--
--   personal report  -> the member, and their LEAD CHAIN. Never REs.
--   per-project half -> everyone.
--
-- The asymmetry is the whole privacy model. An RE gets the project's history
-- without getting a person's record.
-- --------------------------------------------------------------------------

-- Is the current user anywhere up this member's reporting chain?
--
-- Recursive because Lead authority inherits UP an arbitrary number of levels —
-- a Co-Lead oversees their Leads' reports too. Capped at 20 hops: profiles has
-- a self-reference CHECK but nothing prevents a longer cycle, and a cycle here
-- would hang every query that touches a check-in.
create or replace function auth_is_lead_of(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select lead_id, 1 as depth
    from profiles where id = target
    union all
    select p.lead_id, c.depth + 1
    from profiles p
    join chain c on p.id = c.lead_id
    where c.lead_id is not null and c.depth < 20
  )
  select exists (select 1 from chain where lead_id = auth.uid())
      or auth_is_co_lead();
$$;

comment on function auth_is_lead_of is
  'True when the caller is anywhere up target''s reporting chain. Mirrors isLeadOfOrAbove() in lib/permissions.ts.';

-- The personal report: the member, or their Lead chain.
create policy progress_updates_read_chain on progress_updates
  for select to authenticated
  using (member_id = auth.uid() or auth_is_lead_of(member_id));

-- Members write and edit their own; nobody writes someone else's.
create policy progress_updates_write_own on progress_updates
  for insert to authenticated with check (member_id = auth.uid());

create policy progress_updates_update_own on progress_updates
  for update to authenticated using (member_id = auth.uid());

-- A Lead marks a report read. Scoped to the chain, and deliberately not to REs:
-- reviewing is one named person's obligation, which is what makes the
-- escalation in lib/review.ts mean anything.
create policy progress_updates_review on progress_updates
  for update to authenticated using (auth_is_lead_of(member_id));

-- --------------------------------------------------------------------------
-- The per-project half is PUBLIC.
--
-- This is the half that belongs to the project rather than the person: it's the
-- project's history, it's how a passing member spots a blocker they could
-- clear, and it's what REs get instead of access to someone's personal record.
-- --------------------------------------------------------------------------

create policy update_entries_read_all on update_entries
  for select to authenticated using (true);

create policy update_entries_write_own on update_entries
  for all to authenticated
  using (
    exists (
      select 1 from progress_updates u
      where u.id = update_entries.update_id and u.member_id = auth.uid()
    )
  );

-- --------------------------------------------------------------------------
-- 3. Hours: the narrower RE question
--
-- 0004 gave work_logs a policy based on auth_can_view_effort. Add the RE case
-- explicitly: an RE may see time logged ON THEIR PROJECT (inheriting down the
-- tree), and nothing else about that person.
-- --------------------------------------------------------------------------

create policy work_logs_read_project_re on work_logs
  for select to authenticated using (auth_is_re_for(project_id));

-- ===========================================================================
-- Verify
-- ===========================================================================
--
--   select version, applied_at from schema_migrations order by version;
--
--   -- Every table must have RLS on:
--   select tablename from pg_tables
--   where schemaname = 'public' and not rowsecurity;
--   -- expect zero rows
