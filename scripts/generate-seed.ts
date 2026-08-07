/**
 * Turns lib/mock-data.ts into supabase/seed.sql.
 *
 *   npm run seed:generate
 *
 * Why generate rather than hand-write: the mock data is already realistic and
 * already the fixture the UI was designed against. Maintaining a second copy in
 * SQL would guarantee the two drift apart. This keeps one source of truth.
 *
 * Deterministic UUIDs are derived from the string ids ("m-anish", "p-layup"), so
 * re-running produces identical output and the seed stays diffable.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  club,
  deliverables,
  members,
  projectMemberships,
  projects,
  teams,
  joinRequests,
  terms,
  updateSchedules,
  workLogs,
} from "../lib/mock-data.ts";

/** Stable UUIDv5-ish id from any string key. */
function uuid(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    // version 5
    "5" + h.slice(13, 16),
    // variant bits
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

function q(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function qArray(values: string[] | undefined): string {
  if (!values || values.length === 0) return "null";
  return `array[${values.map((v) => q(v)).join(", ")}]`;
}

const lines: string[] = [];

lines.push(`-- ===========================================================================
-- seed.sql — GENERATED FILE, DO NOT EDIT BY HAND
--
-- Regenerate with:  npm run seed:generate
-- Source of truth:  lib/mock-data.ts
--
-- Development only. Never run against production.
--
-- NOTE: profiles.id references auth.users(id), so real auth users must exist
-- first. For local development either seed auth.users yourself, or drop the
-- foreign key while iterating:
--   alter table profiles drop constraint profiles_id_fkey;
-- ===========================================================================

-- Club: ${club.name} — ${club.description}

begin;

-- Wipe in dependency order so re-seeding is idempotent
delete from update_schedules;
delete from join_requests;
delete from terms;
delete from deliverables;
delete from work_logs;
delete from project_members;
delete from projects;
delete from team_memberships;
update profiles set primary_team_id = null, lead_id = null;
delete from teams;
delete from profiles;
`);

// --- profiles ---------------------------------------------------------------
// Inserted with lead_id null first, then updated, so insert order can't violate
// the self-referencing foreign key.
lines.push(`
-- Members (lead_id set afterwards to avoid ordering problems)`);
for (const m of members) {
  lines.push(
    `insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values (` +
      [
        q(uuid(m.id)),
        q(m.email),
        q(m.fullName),
        q(m.globalRole),
        q(m.status),
        m.classYear ?? "null",
        q(m.major),
        qArray(m.skills),
        q(m.joinedAt),
      ].join(", ") +
      `);`
  );
}

// --- teams -----------------------------------------------------------------
lines.push(`
-- Divisions first (parent_id null), then nested teams`);
const sortedTeams = [
  ...teams.filter((t) => t.parentId === null),
  ...teams.filter((t) => t.parentId !== null),
];
for (const t of sortedTeams) {
  lines.push(
    `insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values (` +
      [
        q(uuid(t.id)),
        q(t.name),
        q(t.slug),
        q(t.description),
        t.parentId ? q(uuid(t.parentId)) : "null",
        t.leadId ? q(uuid(t.leadId)) : "null",
        t.isActive ? "true" : "false",
      ].join(", ") +
      `);`
  );
}

// --- reporting chain + home teams ------------------------------------------
lines.push(`
-- Reporting chain and home teams`);
for (const m of members) {
  const sets: string[] = [];
  if (m.leadId) sets.push(`lead_id = ${q(uuid(m.leadId))}`);
  if (m.primaryTeamId) sets.push(`primary_team_id = ${q(uuid(m.primaryTeamId))}`);
  if (sets.length > 0) {
    lines.push(
      `update profiles set ${sets.join(", ")} where id = ${q(uuid(m.id))};`
    );
  }
}

// --- projects --------------------------------------------------------------
// Parents before children, so parent_id always resolves.
lines.push(`
-- Projects, parents before children`);
const emitted = new Set<string>();
const remaining = [...projects];
let guard = 0;
while (remaining.length > 0 && guard < 1000) {
  guard++;
  const next = remaining.findIndex(
    (p) => p.parentId === null || emitted.has(p.parentId)
  );
  if (next === -1) break; // unreachable unless the fixture has a cycle
  const p = remaining.splice(next, 1)[0];
  emitted.add(p.id);

  lines.push(
    `insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values (` +
      [
        q(uuid(p.id)),
        q(p.name),
        q(p.slug),
        q(p.description),
        p.parentId ? q(uuid(p.parentId)) : "null",
        p.teamId ? q(uuid(p.teamId)) : "null",
        q(uuid(p.primaryReId)),
        q(p.phase),
        q(p.health),
        q(p.startDate),
        q(p.targetDate),
        p.datesOverridden ? "true" : "false",
        p.isOpenToJoin ? "true" : "false",
        q(p.openRoles),
        q(p.timeCommitment),
      ].join(", ") +
      `);`
  );
}

// --- project members -------------------------------------------------------
lines.push(`
-- Project membership and responsibilities`);
for (const pm of projectMemberships) {
  lines.push(
    `insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values (` +
      [
        q(uuid(pm.projectId)),
        q(uuid(pm.memberId)),
        q(pm.role),
        q(pm.responsibility),
        q(pm.joinedAt),
        q(pm.commitment),
      ].join(", ") +
      `);`
  );
}

// --- deliverables ----------------------------------------------------------
// The whole task model: one flat list per project, one owner each.
lines.push(`
-- Deliverables`);
for (const d of deliverables) {
  lines.push(
    `insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values (` +
      [
        q(uuid(d.projectId)),
        q(d.title),
        q(uuid(d.ownerId)),
        q(d.dueDate),
        q(d.status),
        d.completedAt ? q(d.completedAt) : "null",
        q(d.blockerNote),
        d.sortOrder,
      ].join(", ") +
      `);`
  );
}

// --- join requests ---------------------------------------------------------
// Membership is RE-controlled, so these are how members ask in.
lines.push(`
-- Join requests`);
for (const r of joinRequests) {
  lines.push(
    `insert into join_requests (project_id, member_id, note, status, requested_at, decided_at, decided_by_id) values (` +
      [
        q(uuid(r.projectId)),
        q(uuid(r.memberId)),
        q(r.note),
        q(r.status),
        q(r.requestedAt),
        r.decidedAt ? q(r.decidedAt) : "null",
        r.decidedById ? q(uuid(r.decidedById)) : "null",
      ].join(", ") +
      `);`
  );
}

// --- academic calendar -----------------------------------------------------
lines.push(`
-- Academic terms. Obligations generate ONLY where generates_obligations is true,
-- so finals and breaks never produce missed-update rows.`);
for (const t of terms) {
  lines.push(
    `insert into terms (name, kind, starts_on, ends_on, generates_obligations) values (` +
      [
        q(t.name),
        q(t.kind),
        q(t.startsOn),
        q(t.endsOn),
        t.generatesObligations ? "true" : "false",
      ].join(", ") +
      `);`
  );
}

// --- update schedules ------------------------------------------------------
lines.push(`
-- Update schedules: two per week, on days each member picks`);
for (const s of updateSchedules) {
  lines.push(
    `insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values (` +
      [
        q(uuid(s.memberId)),
        s.updatesPerWeek,
        `array[${s.weekdays.join(", ")}]`,
        q(s.dueTime),
      ].join(", ") +
      `);`
  );
}

// --- work logs -------------------------------------------------------------
lines.push(`
-- Logged hours`);
for (const w of workLogs) {
  lines.push(
    `insert into work_logs (member_id, project_id, work_date, hours, description) values (` +
      [
        q(uuid(w.memberId)),
        w.projectId ? q(uuid(w.projectId)) : "null",
        q(w.workDate),
        w.hours,
        q(w.description),
      ].join(", ") +
      `);`
  );
}

lines.push(`
commit;

-- Sanity checks
-- select count(*) from profiles;        -- expect ${members.length}
-- select count(*) from teams;           -- expect ${teams.length}
-- select count(*) from projects;        -- expect ${projects.length}
-- select count(*) from project_members; -- expect ${projectMemberships.length}
-- Every project should resolve to a division:
-- select p.name from projects p
--   left join v_project_division d on d.project_id = p.id
--   where d.division_id is null;
`);

const out = "supabase/seed.sql";
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(
  `Wrote ${out}: ${members.length} members, ${teams.length} teams, ` +
    `${projects.length} projects, ${projectMemberships.length} memberships, ` +
    `${workLogs.length} work logs.`
);
