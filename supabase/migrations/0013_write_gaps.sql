-- ---------------------------------------------------------------------------
-- 0013 — the write paths that had no policy, and two upsert targets
--
-- Everything here was found by using the app against the real database. Each
-- one produced an error a member would actually hit.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Inviting someone failed: "new row violates row-level security policy for
--    table update_schedules"
--
-- Every member gets a check-in schedule at the moment they're invited, or they
-- would have no obligation and no way to create one from Settings. But the only
-- write policy was `member_id = auth.uid()` — you could write your own and
-- nobody else's, which makes creating one FOR a new person impossible.
--
-- Leadership, not Co-Leads only: a Lead inviting someone onto their own team is
-- the ordinary case, and it's the same authority the invite itself needs.
-- ---------------------------------------------------------------------------

drop policy if exists update_schedules_write_leadership on update_schedules;
create policy update_schedules_write_leadership on update_schedules
  for all to authenticated
  using (auth_is_leadership())
  with check (auth_is_leadership());

-- ---------------------------------------------------------------------------
-- 2. Check-ins could be written but never removed
--
-- There was no delete policy at all, so a test check-in was permanent. You can
-- remove your own; a Co-Lead can remove anyone's, which is the cleanup path
-- while the club is being set up.
--
-- Deliberately NOT extended to Leads over their reports. A Lead deleting a
-- report they were supposed to read would erase the evidence of the obligation
-- and silence the escalation — the two things that make review mean anything.
-- ---------------------------------------------------------------------------

drop policy if exists progress_updates_delete on progress_updates;
create policy progress_updates_delete on progress_updates
  for delete to authenticated
  using (member_id = auth.uid() or auth_is_co_lead());

-- The per-project halves go with it. `update_entries_write_own` covers the
-- author; this covers a Co-Lead deleting somebody else's.
drop policy if exists update_entries_delete_co_lead on update_entries;
create policy update_entries_delete_co_lead on update_entries
  for delete to authenticated
  using (auth_is_co_lead());

-- ---------------------------------------------------------------------------
-- 3. Changing an existing project membership inserted instead of updating
--
-- `project_members` has a surrogate `id` primary key that the app never
-- carries, so an upsert conflicts on `id`, finds nothing, and inserts — then
-- fails on the unique index over (project_id, member_id).
--
-- The existing index is PARTIAL (`where left_at is null`), and Postgres can't
-- infer a partial index from PostgREST's on_conflict parameter, which has no
-- place to put the predicate. A plain constraint can be named directly.
--
-- Safe because the app deletes membership rows rather than setting `left_at` —
-- nothing writes that column today, so the partial predicate is always true and
-- the two are equivalent. If soft-ended memberships ever arrive, this becomes
-- (project_id, member_id, left_at) instead.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_members_project_member_uniq'
  ) then
    -- Any duplicate pair would block the constraint. There shouldn't be one —
    -- the partial index already forbids it for live rows — but a soft-ended
    -- row plus a live row for the same pair would collide.
    delete from project_members a
      using project_members b
     where a.project_id = b.project_id
       and a.member_id = b.member_id
       and a.left_at is not null
       and b.left_at is null;

    alter table project_members
      add constraint project_members_project_member_uniq
      unique (project_id, member_id);
  end if;
end $$;

insert into schema_migrations (version)
values ('0013_write_gaps')
on conflict (version) do nothing;
