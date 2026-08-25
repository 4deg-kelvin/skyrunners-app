-- ===========================================================================
-- 0049 — URGENT: repair the two policies 0048 broke
-- ===========================================================================
--
-- **Apply this immediately after 0048.** Until it lands, a `select` on
-- `work_logs` or `update_schedules` can fail with
-- `relation "v_lead_chain" does not exist`, and `work_logs` is read by the
-- per-request snapshot on every page.
--
-- ---------------------------------------------------------------------------
-- What I got wrong, and the general lesson
-- ---------------------------------------------------------------------------
--
-- 0048 dropped `v_lead_chain`, having checked that no APPLICATION code read it.
-- That was the wrong thing to check. `auth_can_view_effort()` — a `security
-- definer` SQL function from 0004 — selects from it, and two RLS policies call
-- that function.
--
-- **Postgres did not stop me, and that is the part worth remembering.** It
-- records dependencies for views on views and for policies on views, so
-- `drop view` normally errors with "other objects depend on it". A FUNCTION BODY
-- is an opaque string: nothing is recorded, the drop succeeds, and the breakage
-- surfaces at query time instead. So before dropping any view, grep the
-- migrations for its name — `pg_depend` will not save you.
--
-- Worse, the failure is intermittent. `work_logs` has two SELECT policies and
-- Postgres OR's them, but SQL does not guarantee evaluation order, so a caller
-- who satisfies `work_logs_read_project_re` may or may not also evaluate the
-- broken one. It worked for some callers and errored for others.
--
-- ---------------------------------------------------------------------------
-- Why the fix is to replace the policies, not to restore the view
-- ---------------------------------------------------------------------------
--
-- Recreating `v_lead_chain` would restore a working query that implements a model
-- the club removed on 2026-08-24. `auth_can_view_effort` is the SQL mirror of
-- `can.viewMemberEffort`, which was deleted — so the function and both policies
-- are answering a question nobody asks any more.
--
-- The right answers, matching the app exactly:
--
--   * **`work_logs` is PUBLIC to any signed-in member.** Decided 2026-08-16 and
--     `can.viewMemberWorkOnProject` is literally `() => true`. The RLS policy
--     was still the pre-2026-08-16 restriction, which means the database and the
--     app have disagreed about this for over a week — the app just never noticed,
--     because `work_logs` is also covered by `work_logs_read_project_re` and the
--     snapshot mostly reads as an RE.
--   * **`update_schedules` is a dead table.** Nothing loads it (0047), so the
--     narrowest workable policy is own-row plus Co-Lead.
--
-- Scope is deliberately minimal: exactly the two broken policies and the function
-- they call. `progress_updates` still has policies built on `auth_is_lead_of`,
-- which is conceptually dead but NOT broken — that function uses an inline
-- recursive CTE, not the dropped view. Auditing those is a separate, considered
-- change, because `progress_updates` feeds the public project feed and narrowing
-- it carelessly would hide a project's own history.

-- --------------------------------------------------------------------------
-- work_logs — public to signed-in members, matching the app since 2026-08-16
-- --------------------------------------------------------------------------

drop policy if exists work_logs_read on work_logs;
create policy work_logs_read on work_logs
  for select to authenticated
  using (true);

comment on policy work_logs_read on work_logs is
  'Public to any signed-in member since 2026-08-16 — mirrors '
  'can.viewMemberWorkOnProject(), which returns true. Was '
  'auth_can_view_effort(member_id) until 0049; that restriction existed because '
  'the log carried HOURS, and a number invites comparison between volunteers '
  'with different course loads. The hours went on 2026-08-14.';

-- `work_logs_read_project_re` from 0008 is left alone. It is now redundant
-- rather than wrong, and dropping a policy that grants nothing extra is a change
-- with no upside.

-- --------------------------------------------------------------------------
-- update_schedules — a dead table, so the narrowest thing that works
-- --------------------------------------------------------------------------

drop policy if exists update_schedules_read on update_schedules;
create policy update_schedules_read on update_schedules
  for select to authenticated
  using (member_id = auth.uid() or auth_is_co_lead());

comment on policy update_schedules_read on update_schedules is
  'The table is dead — nothing loads it since 0047, when check-in schedules were '
  'removed from COLLECTIONS. Rows kept as history, so the policy is own-row plus '
  'Co-Lead rather than open.';

-- --------------------------------------------------------------------------
-- And the function itself, now that nothing calls it
-- --------------------------------------------------------------------------
--
-- After the two policies above, `auth_can_view_effort` has no callers. Dropped
-- rather than left in place: a `security definer` function that reads a view
-- which no longer exists is a loaded gun for whoever writes the next policy and
-- reasonably assumes the helpers work.

drop function if exists auth_can_view_effort(uuid);

insert into schema_migrations (version)
values ('0049_fix_work_logs_policy')
on conflict (version) do nothing;
