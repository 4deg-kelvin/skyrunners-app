-- ---------------------------------------------------------------------------
-- 0016 — the RE answers a check-in, section by section
--
-- Reading a check-in and answering it are two different obligations belonging
-- to two different people, and only the first existed.
--
-- A Lead marks the whole check-in read: that's an obligation about a PERSON,
-- and `progress_updates.reviewed_at` already records it. But the useful reply
-- to "the vacuum pump seal is leaking" comes from whoever is accountable for
-- that project. A member on three projects needs three different answers from
-- three different people — which is the entire reason `update_entries` is
-- per-project rather than one text field.
--
-- One response per section, not a thread. This is an answer, not a
-- conversation; a conversation belongs on the blocker board. Threading here
-- would turn a 15-minute weekly obligation into an inbox, which is the failure
-- mode the whole review design is built to avoid.
-- ---------------------------------------------------------------------------

alter table update_entries
  add column if not exists response text,
  -- Snapshotted, and null on delete rather than cascading: REs change over a
  -- project's life, and somebody graduating must not silently erase the answer
  -- they gave.
  add column if not exists responded_by uuid references profiles(id) on delete set null,
  add column if not exists responded_at timestamptz;

-- The exception feed asks "which submitted sections have no answer yet",
-- across every entry. A partial index keeps that to the rows that can match.
create index if not exists update_entries_unanswered_idx
  on update_entries (project_id)
  where response is null;

-- ---------------------------------------------------------------------------
-- Who may write one.
--
-- `update_entries` already has a read policy and a write policy scoped to the
-- author (`update_entries_write_own`). An RE is not the author, so answering
-- somebody else's section had no policy at all and would have been refused —
-- the action would succeed, the response would vanish.
--
-- Gated on `auth_is_re_for` and not on leadership: an RE is very often a plain
-- member, and RE authority is exactly what this is. Same function
-- `projects_update` and `project_notices` use, so the three can't disagree.
-- ---------------------------------------------------------------------------

drop policy if exists update_entries_respond_re on update_entries;
create policy update_entries_respond_re on update_entries
  for update to authenticated
  using (auth_is_re_for(project_id) or auth_is_co_lead())
  with check (auth_is_re_for(project_id) or auth_is_co_lead());

insert into schema_migrations (version)
values ('0016_update_entry_responses')
on conflict (version) do nothing;
