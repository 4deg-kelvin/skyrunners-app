-- ===========================================================================
-- 0048 — make the views respect RLS, and drop the three that are dead
-- ===========================================================================
--
-- Supabase's advisor flagged all ten `v_*` views as CRITICAL "Security Definer
-- View", and it is right. A view created without `security_invoker` runs with
-- the OWNER's privileges, so it reads the underlying tables with RLS bypassed —
-- and every view in the `public` schema is exposed over PostgREST.
--
-- ---------------------------------------------------------------------------
-- This was live, and it was anonymous
-- ---------------------------------------------------------------------------
--
-- Verified against production on 2026-08-25 with nothing but the publishable
-- key — the one that ships in the browser bundle, no sign-in:
--
--     GET /rest/v1/projects?select=slug   ->  []          (RLS working)
--     GET /rest/v1/v_project_tree         ->  [{...}]     (RLS bypassed)
--
-- Same data, same request, different object. Eight of the ten returned rows:
-- project structure and division mapping, the reporting chain, RE authority,
-- per-member weekly HOURS, per-member contribution including `hours_total`, and
-- projects needing attention with `primary_re` and `last_active_at`.
--
-- Keyed by UUID rather than name or email, so this is structural and metric data
-- rather than anything with prose in it. Worth stating the sharpest part anyway:
-- hours and the contribution record are the two things the club decided over two
-- separate removals not to show even to members, and they were world-readable.
--
-- **Nothing in the app read any of them.** `lib/data/*` goes through the
-- per-request snapshot over TABLES, so this migration cannot break a page. The
-- views were written in `0001_core_schema.sql` ahead of the code that was
-- eventually going to use them, and the code never did.
--
-- ---------------------------------------------------------------------------
-- Why `security_invoker` rather than revoking, for the seven that stay
-- ---------------------------------------------------------------------------
--
-- `security_invoker = on` (PG15+) makes the view read its base tables as the
-- CALLER, so the existing RLS policies apply — which is what everyone assumed
-- was happening. It is the actual fix rather than a mitigation: after this, an
-- anonymous call to `v_project_tree` returns `[]` for the same reason
-- `projects` does.
--
-- The `revoke ... from anon` below is belt-and-braces on top. These are internal
-- analytics helpers; no unauthenticated caller has a reason to reach one even
-- with RLS applied. Drop that half if it ever gets in the way — the
-- `security_invoker` half is the part that must not be reverted.
--
-- ---------------------------------------------------------------------------
-- Why three are dropped instead
-- ---------------------------------------------------------------------------
--
-- Securing a view that computes a number the club decided to stop keeping is
-- worse than deleting it: it leaves the shape of the old model sitting in the
-- schema for somebody to rediscover and wire up.
--
--   * `v_lead_chain`        — the reporting chain, removed 2026-08-24
--   * `v_member_hours_weekly`  — hours, removed 2026-08-14
--   * `v_member_contribution`  — the contribution record, removed 2026-08-24
--
-- Note this is a DIFFERENT call from the one made about columns. `profiles.lead_id`
-- and `work_logs.hours` are kept, because a dropped column loses DATA and the
-- club could revisit the decision. A view holds no data — it is derived — so
-- dropping one loses nothing but the derivation, and `git log` has that.

-- --------------------------------------------------------------------------
-- Drop the dead three
-- --------------------------------------------------------------------------

drop view if exists v_lead_chain;
drop view if exists v_member_hours_weekly;
drop view if exists v_member_contribution;

-- --------------------------------------------------------------------------
-- The rest read as the caller from now on
-- --------------------------------------------------------------------------
--
-- `if exists` on each, so this file is safe to re-run and safe to apply to a
-- database where an earlier migration was partially applied.

alter view if exists v_project_tree set (security_invoker = on);
alter view if exists v_project_division set (security_invoker = on);
alter view if exists v_project_re_authority set (security_invoker = on);
alter view if exists v_project_progress set (security_invoker = on);
alter view if exists v_projects_needing_attention set (security_invoker = on);
alter view if exists v_join_requests_for_re set (security_invoker = on);
alter view if exists v_stale_join_requests set (security_invoker = on);

-- --------------------------------------------------------------------------
-- And no anonymous caller needs any of them
-- --------------------------------------------------------------------------

revoke select on v_project_tree from anon;
revoke select on v_project_division from anon;
revoke select on v_project_re_authority from anon;
revoke select on v_project_progress from anon;
revoke select on v_projects_needing_attention from anon;
revoke select on v_join_requests_for_re from anon;
revoke select on v_stale_join_requests from anon;

-- --------------------------------------------------------------------------
-- Say so on the objects themselves
-- --------------------------------------------------------------------------

comment on view v_project_tree is
  'security_invoker = on since 0048 — reads as the caller, so RLS applies. Do '
  'not recreate without it: `create view` defaults to the owner''s privileges '
  'and silently bypasses every policy on projects.';

comment on view v_project_re_authority is
  'security_invoker = on since 0048. Unused by the app — lib/permissions.ts '
  'walks the project tree in memory through OrgGraph, because the four lookups '
  'must stay synchronous.';

insert into schema_migrations (version)
values ('0048_views_respect_rls')
on conflict (version) do nothing;
