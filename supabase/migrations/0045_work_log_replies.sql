-- ===========================================================================
-- 0045 — replying to a work-log line
-- ===========================================================================
--
-- The project page merged the work log and the check-in feed into one list on
-- 2026-08-16, because with hours gone they are the same kind of thing: somebody
-- saying what they did here. A check-in entry could be replied to and a log line
-- could not, which made the merge visibly half-done — Anish's note was simply
-- "you should be able to reply to all of these".
--
-- ---------------------------------------------------------------------------
-- Why a separate table rather than three columns on `work_logs`
-- ---------------------------------------------------------------------------
--
-- `update_entries` carries its reply inline (`response`, `responded_by`,
-- `responded_at`, migration 0016), and doing the same here would be the obvious
-- symmetry. It is the wrong call for one reason that outweighs it: `work_logs` is
-- read by the per-request SNAPSHOT with an explicit column list, so the app would
-- select three columns that do not exist until this file is applied — and a
-- select naming a missing column fails EVERY page in the club, not just this
-- feature. That trap has already cost one outage; see docs/HANDOFF.md and
-- `migration-before-push`.
--
-- A separate table is read by its own fail-soft query in `lib/worklog/replies.ts`,
-- which returns "no replies" if the table is missing. So the code ships first, the
-- feature switches itself on when this lands, and the deploy order stops being
-- load-bearing. Same reasoning as `advisor_profiles` in 0044.
--
-- ---------------------------------------------------------------------------
-- Why `project_id` is stored here even though `work_logs` has one
-- ---------------------------------------------------------------------------
--
-- So the RLS policy can call `auth_is_re_for(project_id)` directly, exactly as
-- `update_entries_respond_re` does. Reaching through to `work_logs` for it would
-- need a subquery in the policy, and RE authority INHERITS down the project tree —
-- a policy that got that wrong would refuse an inherited RE's reply silently,
-- which is precisely the failure 0016 was written to fix.
--
-- The duplication is safe because a reply cannot move between projects: it is
-- created with its log line's project and never updated.

create table if not exists work_log_replies (
  -- One reply per log line, enforced by the primary key. An answer, not a
  -- conversation — the same rule `UpdateEntry.response` states, and for the same
  -- reason: threading here would turn a weekly obligation into an inbox.
  work_log_id  uuid primary key references work_logs (id) on delete cascade,
  project_id   uuid not null references projects (id) on delete cascade,
  response     text not null,
  -- Snapshotted, because REs change over a project's life and the answer should
  -- keep saying who actually gave it.
  responded_by uuid references profiles (id) on delete set null,
  responded_at timestamptz not null default now()
);

create index if not exists work_log_replies_project_idx
  on work_log_replies (project_id);

comment on table work_log_replies is
  'An RE''s answer to one work-log line. Separate from work_logs so the app can '
  'ship before this migration is applied — see the header of 0045.';

alter table work_log_replies enable row level security;

-- Public to read, like the feed it appears in. The log line itself became public
-- on 2026-08-16 (`can.viewMemberWorkOnProject`), and a reply that only its author
-- could see would be a worse version of no reply at all.
drop policy if exists work_log_replies_read on work_log_replies;
create policy work_log_replies_read on work_log_replies
  for select to authenticated
  using (true);

-- `for all`, not `for insert` + `for update`: an upsert never reaches a
-- `for update` policy, and clearing a reply deletes the row, which needs DELETE
-- reachability or it silently matches nothing. Same shape as
-- `calendar_feeds_own` and for the same two reasons.
drop policy if exists work_log_replies_re on work_log_replies;
create policy work_log_replies_re on work_log_replies
  for all to authenticated
  using (auth_is_re_for(project_id) or auth_is_co_lead())
  with check (auth_is_re_for(project_id) or auth_is_co_lead());

insert into schema_migrations (version)
values ('0045_work_log_replies')
on conflict (version) do nothing;
