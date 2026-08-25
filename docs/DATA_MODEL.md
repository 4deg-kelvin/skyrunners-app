# Sky Runners App — Data Model

**Version:** 1.0 · Postgres (Supabase)

Reading this as a beginner: each table is a spreadsheet. A **foreign key** (`FK`) is a
column pointing at a row in another table — that's how a task knows which project it
belongs to. `?` marks a nullable (optional) column.

---

## The two trees

Both the org structure and the project structure nest arbitrarily deep. In SQL that's a
**self-referencing foreign key**: a row points at another row in the same table.

```
teams.parent_id     → teams.id      (Division → team → sub-team → …)
projects.parent_id  → projects.id   (Project → sub-project → …)
```

Postgres walks these with a **recursive CTE**. Example — every project beneath one root:

```sql
WITH RECURSIVE subtree AS (
  SELECT * FROM projects WHERE id = $1
  UNION ALL
  SELECT p.* FROM projects p JOIN subtree s ON p.parent_id = s.id
)
SELECT * FROM subtree;
```

This one query powers the project browser, the Gantt rows, and inherited RE permission
checks. It's the reason Postgres is the right database for this app.

> **Optimization for later, not now:** add a denormalized `path` column
> (`'/evtol/airframe/spar'`) so ancestor checks become a string prefix match instead of
> a recursive walk. Only worth it if permission checks get slow. Don't start here.

---

## People

### `profiles`
Extends Supabase's built-in `auth.users`. One row per member.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK → `auth.users.id` |
| `email` | text unique | Enforced `@stanford.edu` |
| `full_name` | text | |
| `preferred_name` | text? | |
| `photo_url` | text? | Supabase Storage |
| `class_year` | int? | |
| `major` | text? | |
| `phone` | text? | |
| `global_role` | enum | `co_lead` \| `lead` \| `member` — must match `GlobalRole` in `lib/types.ts` exactly |
| `status` | enum | `active` \| `inactive` \| `alumni` — never delete people, deactivate them |
| `lead_id` | uuid? FK → profiles | Their **one** direct Lead. Self-referencing. |
| `primary_team_id` | uuid? FK → teams | Home sub-team |
| `bio` | text? | |
| `skills` | text[]? | Powers "find work" matching |
| `joined_at` | date | |
| `last_active_at` | timestamptz? | |

> `lead_id` self-reference creates the reporting chain. Guard against cycles — A
> reporting to B reporting to A would make recursive queries loop forever. Enforce with
> a trigger or a check in the permission module.

### `lead_history`
Audit trail. Reassignment is expected to be frequent, and "who was your Lead in
spring?" matters when reviewing old updates.

`id` · `member_id` FK · `old_lead_id?` FK · `new_lead_id?` FK · `changed_by` FK ·
`reason?` · `changed_at`

---

## Org structure

### `teams`
Divisions and all nested sub-teams live here. A Division is simply a team with
`parent_id IS NULL`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | |
| `slug` | text unique | URL-friendly |
| `description` | text? | |
| `parent_id` | uuid? FK → teams | `NULL` = Division (Co-Lead configured) |
| `kind` | enum | `division` \| `team` — derived, stored for query convenience |
| `lead_id` | uuid? FK → profiles | This unit's Lead |
| `re_id` | uuid? FK → profiles | Division-level Responsible Engineer. Sets up sub-teams beneath this unit |
| `color` | text? | Visual coding across Gantt and calendar |
| `is_active` | bool | |
| `created_at` | timestamptz | |

Seed divisions: Fixed Wing eVTOL, SkyBeta, Spade, DroneHacks, SkyDelta.
Names and spellings are **editable by Co-Leads in the UI** — divisions can be added and
removed as the club's initiatives change, so nothing here is hardcoded.

### `team_memberships`
A member's home team is `profiles.primary_team_id`, but people legitimately span units.

`id` · `team_id` FK · `member_id` FK · `role` (`member` \| `lead` \| `re`) ·
`joined_at` · `left_at?`

---

## Projects

### `projects`
Nests arbitrarily. Attached to a team, or to a parent project, or both.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | |
| `slug` | text | |
| `description` | text? | |
| `parent_id` | uuid? FK → projects | `NULL` = top-level project |
| `team_id` | uuid? FK → teams | Owning org unit |
| `primary_re_id` | uuid FK → profiles | **Required.** The go-to person. Additional REs live in `project_members` with `role = 're'` — multiple REs per project are allowed |
| `phase` | enum | Where in the lifecycle: `concept` \| `requirements` \| `preliminary_design` \| `detailed_design` \| `manufacturing` \| `integration` \| `testing` \| `flight_test` \| `complete` |
| `health` | enum | How it's going: `on_track` \| `at_risk` \| `blocked` \| `complete`. Separate from phase — *where* and *how* are different questions |
| `start_date` | date? | |
| `target_date` | date? | |
| `actual_end_date` | date? | |
| `dates_overridden` | bool | If false, dates roll up from children (see Gantt) |
| `is_open_to_join` | bool | **Defaults true.** Members enroll in anything that interests them; an RE can close a project if there's a real reason |
| `open_roles` | text? | "Looking for: composites, CFD" |
| `time_commitment` | text? | "~5 hrs/week" — sets expectations before joining |
| `priority` | enum? | `low` \| `medium` \| `high` \| `critical` |
| `created_by` | uuid FK | |
| `created_at` | timestamptz | |

### `project_members`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK | |
| `member_id` | uuid FK | |
| `role` | enum | `re` \| `contributor` \| `observer` |
| `responsibility` | text? | **What this person owns here.** Shows on their profile |
| `joined_at` | timestamptz | |
| `left_at` | timestamptz? | |
| `added_by` | uuid? FK | Null when self-joined via `is_open_to_join` |

Unique on `(project_id, member_id)` where `left_at IS NULL`.

### `project_artifacts`
Engineering deliverables and references.

`id` · `project_id` FK · `kind` (`presentation` \| `github` \| `requirements` \| `cad` \|
`test_report` \| `analysis` \| `drawing` \| `link` \| `other`) · `title` ·
`description?` · `file_url?` (Storage) · `external_url?` (GitHub, Drive) · `version?` ·
`uploaded_by` FK · `created_at`

### `requirements`
Engineering requirements deserve their own table — they need verification tracking that
a generic artifact can't express.

`id` · `project_id` FK · `req_key` (`REQ-EVTOL-014`) · `text` · `rationale?` ·
`verification_method` (`test` \| `analysis` \| `inspection` \| `demonstration`) ·
`status` (`draft` \| `approved` \| `verified` \| `waived`) · `parent_requirement_id?` ·
`owner_id?` FK · `created_at`

---

## Work logging

### `work_logs`
Daily hours. **The highest-volume table and the most latency-sensitive insert.**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `member_id` | uuid FK | |
| `project_id` | uuid? FK | Optional — never block logging on picking a project |
| `work_date` | date | Defaults today |
| `hours` | numeric(4,1) | |
| `description` | text? | Optional by design |
| `logged_at` | timestamptz | Distinct from `work_date` — reveals back-filling |
| `created_at` | timestamptz | |

Index `(member_id, work_date)` and `(project_id, work_date)`.

---

## Updates and the review chain

### `update_schedules`
**Two updates per week**, on weekdays each member picks for themselves.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `member_id` | uuid FK unique | |
| `updates_per_week` | int | **Default 2.** Configurable so leadership can dial the load down if it proves too heavy |
| `weekdays` | int[] | 0–6, Sunday = 0. Length should match `updates_per_week` |
| `paused_until` | date? | **Academic pause.** Suppresses obligations AND nudges, and generates no `missed` rows — a lapse must be a pause, never a debt |
| `due_time` | time | Default 23:59 |
| `timezone` | text | Default `America/Los_Angeles` |
| `is_paused` | bool | Breaks, leave of absence |

### `progress_updates`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `member_id` | uuid FK | |
| `period_start` / `period_end` | date | |
| `due_at` | timestamptz | Generated from the schedule |
| `submitted_at` | timestamptz? | |
| `status` | enum | `pending` \| `submitted` \| `late` \| `missed` \| `reviewed` |
| `general_note` | text? | Anything not tied to a specific project. Optional |
| `hours_this_period` | numeric | Auto-computed from `work_logs` |
| `lead_id_at_submission` | uuid? FK | Snapshot; Leads change |

### `update_entries`
**One row per project covered by an update.** The progress text lives here, not on
`progress_updates`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `update_id` | uuid FK → progress_updates | |
| `project_id` | uuid FK → projects | |
| `progress` | text | What got done **on this project** |
| `blockers` | text? | **Surface prominently — the early-warning signal.** Routes to this project's REs |
| `next_steps` | text? | |
| `hours` | numeric | Hours on this project in the period. Auto-filled from `work_logs` |

Unique on `(update_id, project_id)`. Index `(project_id, created_at)` for the
per-project activity feed.

> **Why this is a separate table rather than three columns on the update.**
>
> Members work on multiple projects — that's the whole point of open enrollment. If an
> update is one blob of text, "finished the layup, still waiting on parts" is ambiguous
> to a Lead who oversees several of that person's projects, and an RE can't tell whether
> a blocker is theirs to clear. Splitting per project makes every note
> self-locating.
>
> Three things fall out of this for free:
>
> 1. **Per-project activity feeds** — every note anyone wrote about a project, in order
> 2. **Blockers route to the right RE** automatically, via `project_id`
> 3. **Hours reconcile per project**, so the update and the time log agree
>
> Entries are **auto-seeded from `work_logs`** for the period, so submitting an update is
> mostly confirming pre-filled sections rather than recalling what you did. That is the
> single biggest lever on submission rates.

### `update_reviews`

`id` · `update_id` FK · `reviewer_id` FK · `comment?` ·
`flag` (`on_track` \| `needs_support` \| `at_risk`) · `is_private` (Lead-only note) ·
`reviewed_at`

### `rollup_reports`
Lead → up the chain.

`id` · `author_id` FK · `team_id?` FK · `submitted_to_id` FK · `period_start` ·
`period_end` · `summary` · `highlights?` · `concerns?` ·
`status` (`draft` \| `submitted` \| `acknowledged`) · `submitted_at?` ·
`acknowledged_at?`

---

## Tasks, dependencies, milestones → Gantt

### `tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK | |
| `parent_task_id` | uuid? FK → tasks | Subtasks |
| `title` | text | |
| `description` | text? | |
| `assignee_id` | uuid? FK | |
| `status` | enum | `todo` \| `in_progress` \| `blocked` \| `review` \| `done` |
| `priority` | enum? | |
| `start_date` / `due_date` | date? | Gantt bar extent |
| `estimate_hours` | numeric? | |
| `completed_at` | timestamptz? | |
| `is_milestone` | bool | Renders as a diamond |
| `created_by` | uuid FK | |
| `sort_order` | int | Manual ordering within a project |

### `task_dependencies`

`id` · `predecessor_id` FK → tasks · `successor_id` FK → tasks ·
`type` (`FS` finish-to-start \| `SS` start-to-start \| `FF` finish-to-finish) ·
`lag_days` (int, default 0)

Reject cycles on insert — a dependency loop makes critical-path computation
non-terminating.

### `milestones`
Project-level checkpoints, distinct from task milestones.

`id` · `project_id` FK · `name` · `target_date` · `actual_date?` ·
`status` (`upcoming` \| `at_risk` \| `hit` \| `missed`) · `description?`

### Gantt derivation rules

1. Rows mirror the project tree (recursive CTE above); parents are collapsible
2. If `dates_overridden = false`, a project's span = `MIN(child start)` to
   `MAX(child end)` across sub-projects **and** tasks — recursive roll-up
3. Dependency edges drawn from `task_dependencies`
4. **Critical path** = longest dependency chain to each milestone
5. **Slip warning** when a predecessor's actual dates push a successor past a
   milestone's `target_date`

Compute this **server-side in one pass** and cache it. Doing it client-side per row will
be slow once there are hundreds of tasks.

---

## Events and attendance

### `events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | |
| `description` | text? | |
| `kind` | enum | `design_review` \| `company_tour` \| `company_visit` \| `build_session` \| `general_meeting` \| `training` \| `social` \| `competition` \| `one_on_one` |
| `importance_weight` | numeric | Default per kind. **Feeds contribution tracking** |
| `starts_at` / `ends_at` | timestamptz | |
| `location` | text? | |
| `team_id?` / `project_id?` | uuid FK | Optional scoping |
| `is_club_wide` | bool | |
| `created_by` | uuid FK | |
| `external_org` | text? | Which company, for tours and visits |

### `event_invitations`

`id` · `event_id` FK · `invitee_id` FK · `invited_by` FK ·
`rsvp` (`pending` \| `yes` \| `no` \| `maybe`) · `responded_at?` · `is_required` bool

### `event_attendance`
Separate from RSVP — intent and reality diverge, and the gap is informative.

`id` · `event_id` FK · `member_id` FK · `attended` bool · `checked_in_at?` ·
`recorded_by` FK · `notes?`

### `meeting_requests`
Member-to-member 1:1 scheduling.

`id` · `requester_id` FK · `recipient_id` FK · `proposed_times` (timestamptz[]) ·
`confirmed_time?` · `status` (`pending` \| `confirmed` \| `declined` \| `cancelled`) ·
`topic?` · `event_id?` FK (created on confirmation)

---

## Trainings, certifications, facility access

### `training_types`
Admin-configured catalog.

`id` · `name` · `category` (`machine_shop` \| `lab_equipment` \| `safety` \| `software` \|
`online_course` \| `flight` \| `other`) · `description?` · `issuing_body?` ·
`validity_months?` (null = never expires) · `requires_verification` bool ·
`is_prerequisite_for` (uuid[]?)

### `member_trainings`

`id` · `member_id` FK · `training_type_id` FK · `completed_at` date ·
`expires_at?` date (computed from `validity_months`) · `certificate_url?` (Storage —
**the one-click certificate pull-up**) · `verified_by?` FK · `verified_at?` ·
`status` (`requested` \| `verified` \| `expired` \| `rejected`) · `notes?`

### `access_types`
e.g. Robotics Room keycard, Lab 64 24-hour, PRL, machine shop after-hours.

`id` · `name` · `description?` · `location?` · `requires_trainings` (uuid[]?) ·
`granting_authority?`

### `member_access`

`id` · `member_id` FK · `access_type_id` FK · `granted_at` date · `expires_at?` date ·
`status` (`requested` \| `active` \| `expired` \| `revoked`) · `granted_by?` FK · `notes?`

---

## Contribution tracking

### `terms`
Versioned so historical scores stay interpretable after leadership retunes them.

`id` · `version` int · `hours_weight` · `update_ontime_weight` ·
`event_attendance_weight` · `task_completion_weight` · `re_responsibility_weight` ·
`breadth_weight` · `hours_diminishing_threshold` numeric? · `effective_from` date ·
`created_by` FK · `is_current` bool

### `member_contribution`
Computed periodically rather than on every page load — the underlying query spans five
tables and shouldn't run per request.

`id` · `member_id` FK · `period_start` · `period_end` · `hours_total` ·
`updates_due` · `updates_ontime` · `updates_late` · `updates_missed` ·
`events_invited` · `events_attended` · `weighted_event_score` ·
`tasks_assigned` · `tasks_completed` · `projects_active` · `re_count` ·
`raw_score` · `normalized_score` · `weights_version` · `computed_at`

Refresh nightly via Vercel Cron.

---

## Notifications and invitations

### `notifications`

`id` · `recipient_id` FK · `kind` (`update_due` \| `update_late` \| `update_reviewed` \|
`event_invite` \| `project_added` \| `task_assigned` \| `lead_changed` \|
`rollup_due` \| `training_expiring` \| `training_request` \| `meeting_request` \|
**`project_deadline_approaching`** \| **`milestone_at_risk`**) · `title` · `body?` ·
`link?` · `read_at?` · `emailed_at?` · `created_at`

> The last two go to **REs**, not the assignee. An RE is accountable for the
> deliverable, so they need to see a slipping deadline before it slips — that's what
> makes the reminder useful rather than a post-mortem. `training_request` goes to the
> member's Lead when a training verification is waiting on them.

### `member_invitations`

`id` · `email` (`@stanford.edu` enforced) · `invited_by` FK · `intended_role` ·
`intended_team_id?` FK · `intended_lead_id?` FK · `token` unique ·
`expires_at` · `accepted_at?` · `accepted_by?` FK

### `audit_log`
Role changes, Lead reassignments, and access grants need a paper trail.

`id` · `actor_id?` FK · `action` · `entity_type` · `entity_id` · `before?` jsonb ·
`after?` jsonb · `created_at`

---

## Enforced invariants

Things the database or permission module must guarantee:

1. `profiles.email` ends in `@stanford.edu`
2. No cycles in `profiles.lead_id`, `teams.parent_id`, `projects.parent_id`,
   `tasks.parent_task_id`, or `task_dependencies`
3. Every `project` has a non-null `primary_re_id`, and that person also appears in
   `project_members` with `role = 're'`
4. `work_logs.hours` between 0 and 24; `work_date` not in the future
5. A member has at most one active `project_members` row per project
6. Exactly one `terms` row with `is_current = true`
7. Deactivating a member reassigns or nulls their mentees' `lead_id` — never orphan
   someone
8. Deleting a project requires reparenting or cascading its children, explicitly chosen

---

## Views

> **Every view needs `security_invoker = on`, and this is not optional.**
> A view created without it reads its base tables as the OWNER, so RLS does not
> apply — and every view in `public` is exposed over PostgREST. On 2026-08-25 ten
> views were returning real member data to an ANONYMOUS caller holding nothing
> but the publishable key, including per-member hours and a contribution record.
> Fixed in `0048`. Write `create view x with (security_invoker = on) as ...`, or
> the next one leaks the same way.
>
> Second rule, from the same day: **before dropping a view, grep the migrations
> for its name.** Postgres records dependencies for views-on-views and
> policies-on-views, but a FUNCTION BODY is an opaque string — dropping
> `v_lead_chain` silently broke `auth_can_view_effort()` and, through it, every
> read of `work_logs`. `pg_depend` will not save you. See `0049`.

| View | Purpose | State |
|---|---|---|
| `v_project_tree` | Flattened tree with depth and materialized path | live, invoker |
| `v_project_division` | Resolves a project to its division | live, invoker |
| `v_project_re_authority` | Who holds RE authority where | live, invoker |
| `v_project_progress` | Deliverable counts and fraction per project | live, invoker |
| `v_projects_needing_attention` | The exception feed | live, invoker |
| `v_join_requests_for_re` | Requests awaiting an RE | live, invoker |
| `v_stale_join_requests` | Requests past the escalation window | live, invoker |
| `v_lead_chain` | Each member's reporting chain | **dropped `0048`** — no chain |
| `v_member_hours_weekly` | Hours per member per week | **dropped `0048`** — no hours |
| `v_member_contribution` | The contribution record | **dropped `0048`** — deleted 2026-08-24 |

**None of the live ones is read by the app.** `lib/data/*` goes through the
per-request snapshot over TABLES, and `lib/permissions.ts` walks the trees in
memory through `OrgGraph` because its four lookups must stay synchronous. The
views were written ahead of code that never arrived — worth knowing before
assuming one is load-bearing.

Still unbuilt, and named here because the old version of this table listed them
as though they existed: `v_project_rollup_dates` (recursive Gantt spans) and
`v_open_projects` (the Find Work feed). `v_update_compliance` and `v_org_chain`
are no longer wanted at all — check-in compliance and the reporting chain both
went in 2026-08.
