-- ===========================================================================
-- 0056 — a project MAY wait on a single deliverable
-- ===========================================================================
--
-- `0055` shipped three of the four shapes and refused the fourth with a CHECK:
--
--     dependencies_no_project_on_deliverable
--         check (dependent_project_id is null or target_deliverable_id is null)
--
-- The argument was that a whole project waiting on one person's single task
-- inverts the sizes, and that if a project genuinely hinges on one deliverable
-- then the deliverable belongs to that project.
--
-- Real data disproved it within a day. "DroneHacks Surface Stuctures can't
-- start until the course floor plan is signed off" is one sentence, the floor
-- plan is one deliverable on a sibling project, and moving it would be a lie
-- about who owns the work. The available workaround — wait on the whole sibling
-- PROJECT — is strictly worse than the thing being refused: it warns against
-- the project's target date rather than the deliverable's, so the dependency
-- reads as landing weeks later than it does.
--
-- So the constraint goes and all four shapes are legal. What does NOT change is
-- the thing that made the feature allowable in the first place: nothing here
-- computes a date, and nothing here blocks work. See `lib/dependencies.ts`.
--
-- Nothing else needs touching. The four nullable columns, the one-dependent /
-- one-target CHECKs, the self-link CHECKs, the partial unique index and the RLS
-- policies were all written kind-agnostically; this combination was refused by
-- this constraint alone.
-- ===========================================================================

alter table dependencies
  drop constraint if exists dependencies_no_project_on_deliverable;

comment on table dependencies is
  'Declared "this waits on that" links. All four dependent/target kind combinations are legal as of 0056. Nothing derives a date from these and nothing blocks on them — they are displayed, and a date conflict is warned about. Scope (which rows may be linked) is enforced in lib/dependencies.ts, not here, because it depends on the project tree.';

insert into schema_migrations (version)
values ('0056_project_may_wait_on_deliverable')
on conflict (version) do nothing;
