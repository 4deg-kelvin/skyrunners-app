-- ===========================================================================
-- 0034_artifact_write_policies.sql
--
-- The engineering record gets a writer and a freeze.
--
-- 0007 shipped one policy for all three verbs:
--
--   create policy project_artifacts_write on project_artifacts
--     for all to authenticated using (auth_is_re_for(project_id));
--
-- That was right when nothing could write at all — the "Add link" button on the
-- project page was literally `disabled`, so the record was read-only in
-- practice and the policy never ran. Now that attaching exists, adding and
-- removing need to be different rights:
--
--   INSERT — anyone COMMITTED to the project, plus REs above it and Co-Leads.
--     Wider on purpose. The person who ran the test holds the test report, and
--     making every attachment go through the RE rebuilds the "go ask someone"
--     bottleneck this app exists to remove. The predictable result of the
--     narrow rule is an empty record.
--
--   UPDATE / DELETE — REs and Co-Leads, and Co-Leads ALONE once the project is
--     complete. At that point the record stops being a working document and
--     becomes the club's history. Adding to history extends it; deleting from
--     it rewrites it, and the person closest to the work is the one most
--     tempted to tidy.
--
-- Note that INSERT does NOT check phase. A final report is usually written the
-- week after the work stops, and blocking that would mean the record can never
-- actually be finished.
--
-- Policy-only: no columns change, so `loadSnapshot` is unaffected and this can
-- land before or after the app deploy without a window of 500s. It is still
-- the safety net rather than the rule — `lib/permissions.ts` is the rule, and
-- these are deliberately a shade coarser.
--
-- Ordering: depends on 0004 (auth_is_re_for, auth_is_co_lead) and 0007
-- (project_artifacts). Additive, idempotent, safe to re-run.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Is the current user committed to this project?
--
-- `commitment` is not a column — the app derives it from `role`, where an
-- `observer` row is what following looks like (see `lib/store/mapping.ts`).
-- Following is deliberately NOT enough: watching a project doesn't make its
-- record yours to write.
--
-- SECURITY DEFINER for the same reason as every helper in 0004: it reads
-- project_members from inside a policy evaluation and must not recurse through
-- the policies on that table.
-- --------------------------------------------------------------------------

create or replace function auth_is_committed_to(target_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members
    where project_id = target_project
      and member_id = auth.uid()
      and left_at is null
      and role <> 'observer'
  );
$$;

-- --------------------------------------------------------------------------
-- Replace the single `for all` policy with one per verb.
--
-- The drop must come first: `for all` overlaps every policy below it, and
-- Postgres ORs permissive policies together — leaving it in place would keep
-- granting RE-only DELETE on completed projects no matter what we add.
-- --------------------------------------------------------------------------

drop policy if exists project_artifacts_write on project_artifacts;

create policy project_artifacts_insert on project_artifacts
  for insert to authenticated
  with check (
    auth_is_re_for(project_id)          -- already includes Co-Leads
    or auth_is_committed_to(project_id)
  );

create policy project_artifacts_update on project_artifacts
  for update to authenticated
  using (
    auth_is_co_lead()
    or (
      auth_is_re_for(project_id)
      and not exists (
        select 1 from projects p
        where p.id = project_id and p.phase = 'complete'
      )
    )
  );

create policy project_artifacts_delete on project_artifacts
  for delete to authenticated
  using (
    auth_is_co_lead()
    or (
      auth_is_re_for(project_id)
      and not exists (
        select 1 from projects p
        where p.id = project_id and p.phase = 'complete'
      )
    )
  );

-- ===========================================================================
-- Verify:
--
--   select policyname, cmd from pg_policies
--   where tablename = 'project_artifacts' order by cmd;
--   -- expect: project_artifacts_delete (DELETE), project_artifacts_insert
--   --         (INSERT), project_artifacts_read_all (SELECT),
--   --         project_artifacts_update (UPDATE).
--   -- `project_artifacts_write` (ALL) must be GONE.
-- ===========================================================================
