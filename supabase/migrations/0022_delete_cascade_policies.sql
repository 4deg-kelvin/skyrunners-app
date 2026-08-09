-- ---------------------------------------------------------------------------
-- 0022 — the two delete policies the cascades need
--
-- `deleteMember` and `deleteProject` are both Co-Lead operations that clear
-- everything hanging off the row. `lib/store/supabase.ts` turns that into one
-- DELETE per table, so every table in the cascade needs a policy the Co-Lead
-- passes. Two didn't, and both features were therefore broken in live mode:
--
--   join_requests   had NO delete policy at all
--   work_logs       had `member_id = auth.uid()`, so a Co-Lead could clear
--                   their own hours and nobody else's
--
-- Since `persistDiff` now checks the affected-row count, these failed LOUDLY
-- rather than silently — which is the only reason they were found. Before that
-- change, `deleteProject` would have reported success, removed the project,
-- and left orphaned rows behind.
--
-- This is the same shape as the `profiles` bug in 0019 and it will keep
-- recurring: **RLS does not raise on a missing policy.** Any time an operation
-- starts clearing a new table on cascade, check the policy covers whoever is
-- allowed to trigger the cascade — the type checker cannot see this.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- join_requests
--
-- Withdrawing is an UPDATE to `status = 'withdrawn'`, deliberately — a
-- withdrawn ask stays on the record so the RE can see it happened rather than
-- watching a row vanish from their queue. So this is ONLY for the cascade, and
-- it's scoped to the people who can trigger one.
-- --------------------------------------------------------------------------
drop policy if exists join_requests_delete on join_requests;
create policy join_requests_delete on join_requests
  for delete to authenticated
  using (auth_is_re_for(project_id) or auth_is_co_lead());

-- --------------------------------------------------------------------------
-- work_logs
--
-- Deliberately NOT widened to leadership. Hours are the raw material of the
-- Commitment signal, and a Lead quietly deleting a report's logged time would
-- change how that person is described with no record of it. A Co-Lead can,
-- because they're the only ones who can delete a member or a project at all —
-- and both of those operations already refuse to erase real history unless
-- explicitly forced, and say what will be lost.
--
-- A member deleting their OWN mistyped entry is the existing
-- `work_logs_write_own` policy and is untouched.
-- --------------------------------------------------------------------------
drop policy if exists work_logs_delete_co_lead on work_logs;
create policy work_logs_delete_co_lead on work_logs
  for delete to authenticated
  using (auth_is_co_lead());

insert into schema_migrations (version)
values ('0022_delete_cascade_policies')
on conflict (version) do nothing;
