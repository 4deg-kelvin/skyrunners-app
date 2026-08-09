-- ---------------------------------------------------------------------------
-- 0019 — a Co-Lead can delete a profile row
--
-- Deleting a member reported "Record deleted." and deleted nothing.
--
-- `profiles` has RLS enabled and policies for select, insert and update — and
-- none for DELETE. With RLS on, a missing policy doesn't raise an error: the
-- row is simply invisible to the statement, so `delete from profiles where
-- id = …` matches zero rows and PostgREST returns success. The app's diff saw
-- no error and said it worked.
--
-- Exactly the same shape as the `update_entries` gap fixed in 0016: the action
-- succeeds, the write vanishes, and nothing anywhere says so. It's the most
-- expensive kind of RLS bug precisely because it looks like nothing happened.
--
-- `persistDiff` now also verifies that a delete removed what it meant to, so
-- the next missing policy fails loudly instead of lying.
-- ---------------------------------------------------------------------------

-- Co-Leads only, and never their own row.
--
-- The self-check is here as well as in `lib/permissions.ts` and in the
-- operation, because this is the one deletion that can lock somebody out of
-- their own club — and a policy is the only layer a crafted request can't
-- route around.
--
-- Deliberately NOT extended to Leads. Deactivating is the tool for somebody
-- leaving and any Lead can do that; hard deletion exists for broken duplicate
-- rows, which is an administrative act on the shape of the org.
drop policy if exists profiles_delete_co_lead on profiles;
create policy profiles_delete_co_lead on profiles
  for delete to authenticated
  using (auth_is_co_lead() and id <> auth.uid());

-- ---------------------------------------------------------------------------
-- The two `on delete restrict` references, for the record.
--
--   projects.primary_re_id   — a project with no RE is the one state the model
--                              can't represent, so the app refuses to delete
--                              anyone holding one and says which.
--   deliverables.owner_id    — the app removes their deliverables in the same
--                              write, and `persistDiff` orders deletions so
--                              `profiles` goes last.
--
-- Everything else is `cascade` or `set null`, so nothing else blocks it.
-- ---------------------------------------------------------------------------

insert into schema_migrations (version)
values ('0019_profile_delete_policy')
on conflict (version) do nothing;
