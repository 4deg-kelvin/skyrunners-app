/**
 * The snake_case ↔ camelCase boundary.
 *
 * Postgres columns are snake_case; `lib/types.ts` is camelCase. CLAUDE.md's rule
 * is that snake_case must never reach a component, so every translation happens
 * here and nowhere else.
 *
 * Each entry describes one collection: which table it lives in, how to read a
 * row into the app's shape, how to write it back, and what identifies a row.
 * That last part is what lets `lib/store/supabase.ts` diff two snapshots and
 * work out what to insert, update and delete — without any operation in
 * `operations.ts` knowing Postgres exists.
 */

import type {
  ClubEvent,
  Deliverable,
  JoinRequest,
  Member,
  ProgressUpdate,
  Project,
  ProjectArtifact,
  ProjectMembership,
  ProjectNotice,
  Team,
  Term,
  UpdateSchedule,
  WorkLog,
} from "../types.ts";
import type { StoreShape } from "./disk.ts";

/** Postgres `null` is the app's `undefined`. */
function opt<T>(v: T | null | undefined): T | undefined {
  return v ?? undefined;
}

/** …and back again, so an emptied field actually clears the column. */
function nul<T>(v: T | undefined): T | null {
  return v === undefined ? null : v;
}

export interface CollectionSpec<T> {
  /** Key in `StoreShape`. */
  key: keyof StoreShape;
  table: string;
  /** Columns to select. Explicit, so a schema change fails loudly here. */
  columns: string;
  /** Stable identity for diffing. Composite for join tables with no id. */
  identify: (row: T) => string;
  /**
   * Which column the upsert conflicts on.
   *
   * Defaults to the primary key, which is correct for every table whose id the
   * app actually carries. Set it where the table has a surrogate `id` we never
   * send: otherwise the upsert finds no conflict, inserts a fresh row, and
   * fails on a unique constraint over the real key instead.
   */
  conflictTarget?: string;
  fromRow: (row: Record<string, unknown>) => T;
  toRow: (value: T) => Record<string, unknown>;
  /**
   * Rows that must exist before this collection can be written, so inserts
   * happen in dependency order and deletes in reverse.
   */
  dependsOn?: (keyof StoreShape)[];
}

const members: CollectionSpec<Member> = {
  key: "members",
  table: "profiles",
  columns:
    "id, email, full_name, preferred_name, photo_url, class_year, major, phone, global_role, status, lead_id, primary_team_id, skills, joined_at",
  identify: (m) => m.id,
  fromRow: (r) => ({
    id: r.id as string,
    email: r.email as string,
    fullName: r.full_name as string,
    preferredName: opt(r.preferred_name as string),
    photoUrl: opt(r.photo_url as string),
    classYear: opt(r.class_year as number),
    major: opt(r.major as string),
    phone: opt(r.phone as string),
    globalRole: r.global_role as Member["globalRole"],
    status: r.status as Member["status"],
    // Stays null: "reports to nobody" is meaningful, and both chain walks
    // terminate on it.
    leadId: (r.lead_id as string) ?? null,
    primaryTeamId: opt(r.primary_team_id as string),
    skills: opt(r.skills as string[]),
    joinedAt: r.joined_at as string,
  }),
  toRow: (m) => ({
    id: m.id,
    email: m.email,
    full_name: m.fullName,
    preferred_name: nul(m.preferredName),
    photo_url: nul(m.photoUrl),
    class_year: nul(m.classYear),
    major: nul(m.major),
    phone: nul(m.phone),
    global_role: m.globalRole,
    status: m.status,
    lead_id: m.leadId,
    primary_team_id: nul(m.primaryTeamId),
    skills: m.skills ?? [],
    joined_at: m.joinedAt,
  }),
};

const teams: CollectionSpec<Team> = {
  key: "teams",
  table: "teams",
  columns:
    "id, name, slug, description, parent_id, lead_id, is_active, archived_at, archived_by, archive_note",
  identify: (t) => t.id,
  fromRow: (r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    description: opt(r.description as string),
    // Null means a Division. `teams.kind` also encodes this in SQL, but
    // parentId is what the app branches on, so it stays the single source.
    parentId: (r.parent_id as string) ?? null,
    leadId: opt(r.lead_id as string),
    isActive: r.is_active as boolean,
    archivedAt: opt(r.archived_at as string),
    archivedBy: opt(r.archived_by as string),
    archiveNote: opt(r.archive_note as string),
  }),
  toRow: (t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    description: nul(t.description),
    parent_id: t.parentId,
    // Keep the SQL enum consistent with the tree shape, or a division created
    // through the app would be stored as a sub-team.
    kind: t.parentId === null ? "division" : "team",
    lead_id: nul(t.leadId),
    is_active: t.isActive,
    archived_at: nul(t.archivedAt),
    archived_by: nul(t.archivedBy),
    archive_note: nul(t.archiveNote),
  }),
  dependsOn: ["members"],
};

const projects: CollectionSpec<Project> = {
  key: "projects",
  table: "projects",
  columns:
    "id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment",
  identify: (p) => p.id,
  fromRow: (r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    description: opt(r.description as string),
    parentId: (r.parent_id as string) ?? null,
    teamId: opt(r.team_id as string),
    primaryReId: r.primary_re_id as string,
    // Filled in by the loader from project_members — `reIds` is derived, not a
    // column, and the two must never disagree.
    reIds: [],
    phase: r.phase as Project["phase"],
    health: r.health as Project["health"],
    startDate: opt(r.start_date as string),
    targetDate: opt(r.target_date as string),
    datesOverridden: r.dates_overridden as boolean,
    isOpenToJoin: r.is_open_to_join as boolean,
    openRoles: opt(r.open_roles as string),
    timeCommitment: opt(r.time_commitment as string),
  }),
  toRow: (p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: nul(p.description),
    parent_id: p.parentId,
    team_id: nul(p.teamId),
    primary_re_id: p.primaryReId,
    phase: p.phase,
    health: p.health,
    start_date: nul(p.startDate),
    target_date: nul(p.targetDate),
    dates_overridden: p.datesOverridden,
    is_open_to_join: p.isOpenToJoin,
    open_roles: nul(p.openRoles),
    time_commitment: nul(p.timeCommitment),
  }),
  dependsOn: ["members", "teams"],
};

const projectMemberships: CollectionSpec<ProjectMembership> = {
  key: "projectMemberships",
  table: "project_members",
  columns:
    "project_id, member_id, role, responsibility, joined_at, left_at, added_by",
  // No surrogate id in the app's shape, so identity is the pair — which is
  // also the unique constraint added in 0013. That constraint is what this
  // upsert conflicts on; without it, changing an existing membership (making
  // someone an RE) inserts a second row and fails.
  identify: (m) => `${m.projectId}:${m.memberId}`,
  conflictTarget: "project_id,member_id",
  fromRow: (r) => ({
    projectId: r.project_id as string,
    memberId: r.member_id as string,
    role: r.role as ProjectMembership["role"],
    responsibility: opt(r.responsibility as string),
    joinedAt: r.joined_at as string,
    // `following` isn't a column; an observer row is what following looks like.
    commitment: r.role === "observer" ? "following" : "committed",
    addedBy: opt(r.added_by as string),
  }),
  toRow: (m) => ({
    project_id: m.projectId,
    member_id: m.memberId,
    role: m.commitment === "following" ? "observer" : m.role,
    responsibility: nul(m.responsibility),
    joined_at: m.joinedAt,
    added_by: nul(m.addedBy),
  }),
  dependsOn: ["members", "projects"],
};

const deliverables: CollectionSpec<Deliverable> = {
  key: "deliverables",
  table: "deliverables",
  columns:
    "id, project_id, title, owner_id, due_date, status, submitted_at, completed_at, confirmed_by, blocker_note, sort_order",
  identify: (d) => d.id,
  fromRow: (r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    ownerId: r.owner_id as string,
    dueDate: opt(r.due_date as string),
    status: r.status as Deliverable["status"],
    submittedAt: opt(r.submitted_at as string),
    completedAt: opt(r.completed_at as string),
    confirmedById: opt(r.confirmed_by as string),
    blockerNote: opt(r.blocker_note as string),
    sortOrder: r.sort_order as number,
  }),
  toRow: (d) => ({
    id: d.id,
    project_id: d.projectId,
    title: d.title,
    owner_id: d.ownerId,
    due_date: nul(d.dueDate),
    status: d.status,
    submitted_at: nul(d.submittedAt),
    completed_at: nul(d.completedAt),
    confirmed_by: nul(d.confirmedById),
    blocker_note: nul(d.blockerNote),
    sort_order: d.sortOrder,
  }),
  dependsOn: ["members", "projects"],
};

const workLogs: CollectionSpec<WorkLog> = {
  key: "workLogs",
  table: "work_logs",
  columns: "id, member_id, project_id, work_date, hours, description",
  identify: (w) => w.id,
  fromRow: (r) => ({
    id: r.id as string,
    memberId: r.member_id as string,
    projectId: r.project_id as string,
    workDate: r.work_date as string,
    hours: Number(r.hours),
    description: opt(r.description as string),
  }),
  toRow: (w) => ({
    id: w.id,
    member_id: w.memberId,
    project_id: w.projectId,
    work_date: w.workDate,
    hours: w.hours,
    description: nul(w.description),
  }),
  dependsOn: ["members", "projects"],
};

const joinRequests: CollectionSpec<JoinRequest> = {
  key: "joinRequests",
  table: "join_requests",
  columns:
    "id, project_id, member_id, note, status, requested_at, decided_at, decided_by_id, response_note",
  identify: (r) => r.id,
  fromRow: (r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    memberId: r.member_id as string,
    note: opt(r.note as string),
    status: r.status as JoinRequest["status"],
    requestedAt: r.requested_at as string,
    decidedAt: opt(r.decided_at as string),
    decidedById: opt(r.decided_by_id as string),
    responseNote: opt(r.response_note as string),
  }),
  toRow: (j) => ({
    id: j.id,
    project_id: j.projectId,
    member_id: j.memberId,
    note: nul(j.note),
    status: j.status,
    requested_at: j.requestedAt,
    decided_at: nul(j.decidedAt),
    decided_by_id: nul(j.decidedById),
    response_note: nul(j.responseNote),
  }),
  dependsOn: ["members", "projects"],
};

const updateSchedules: CollectionSpec<UpdateSchedule> = {
  key: "updateSchedules",
  table: "update_schedules",
  columns: "member_id, weekdays, updates_per_week, due_time, paused_until",
  identify: (s) => s.memberId,
  // Surrogate `id` PK the app never sees; the real key is member_id. Without
  // this, pausing check-ins failed with "duplicate key value violates
  // update_schedules_member_id_key".
  conflictTarget: "member_id",
  fromRow: (r) => ({
    memberId: r.member_id as string,
    weekdays: (r.weekdays as number[]) ?? [],
    updatesPerWeek: r.updates_per_week as number,
    dueTime: r.due_time as string,
    pausedUntil: opt(r.paused_until as string),
  }),
  toRow: (s) => ({
    member_id: s.memberId,
    weekdays: s.weekdays,
    updates_per_week: s.updatesPerWeek,
    due_time: s.dueTime,
    paused_until: nul(s.pausedUntil),
  }),
  dependsOn: ["members"],
};

const terms: CollectionSpec<Term> = {
  key: "terms",
  table: "terms",
  columns: "id, name, kind, starts_on, ends_on, generates_obligations",
  identify: (t) => t.id,
  fromRow: (r) => ({
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as Term["kind"],
    startsOn: r.starts_on as string,
    endsOn: r.ends_on as string,
    generatesObligations: r.generates_obligations as boolean,
  }),
  toRow: (t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    starts_on: t.startsOn,
    ends_on: t.endsOn,
    generates_obligations: t.generatesObligations,
  }),
};

const events: CollectionSpec<ClubEvent> = {
  key: "events",
  table: "events",
  columns: "id, title, kind, importance_weight, starts_at, ends_at, location",
  identify: (e) => e.id,
  fromRow: (r) => ({
    id: r.id as string,
    title: r.title as string,
    kind: r.kind as ClubEvent["kind"],
    importanceWeight: r.importance_weight as number,
    startsAt: r.starts_at as string,
    endsAt: opt(r.ends_at as string),
    location: opt(r.location as string),
  }),
  toRow: (e) => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    importance_weight: e.importanceWeight,
    starts_at: e.startsAt,
    ends_at: nul(e.endsAt),
    location: nul(e.location),
  }),
};

const projectArtifacts: CollectionSpec<ProjectArtifact> = {
  key: "projectArtifacts",
  table: "project_artifacts",
  columns:
    "id, project_id, kind, title, description, file_url, external_url, version, uploaded_by, created_at",
  identify: (a) => a.id,
  fromRow: (r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    kind: r.kind as ProjectArtifact["kind"],
    title: r.title as string,
    description: opt(r.description as string),
    fileUrl: opt(r.file_url as string),
    externalUrl: opt(r.external_url as string),
    version: opt(r.version as string),
    uploadedById: (r.uploaded_by as string) ?? "",
    createdAt: r.created_at as string,
  }),
  toRow: (a) => ({
    id: a.id,
    project_id: a.projectId,
    kind: a.kind,
    title: a.title,
    description: nul(a.description),
    file_url: nul(a.fileUrl),
    external_url: nul(a.externalUrl),
    version: nul(a.version),
    uploaded_by: a.uploadedById || null,
    created_at: a.createdAt,
  }),
  dependsOn: ["members", "projects"],
};

/**
 * Progress updates carry their entries inline in the app's shape but live in
 * two tables. The loader stitches them; the writer splits them.
 */
const progressUpdates: CollectionSpec<ProgressUpdate> = {
  key: "progressUpdates",
  table: "progress_updates",
  columns:
    "id, member_id, due_at, submitted_at, status, general_note, hours_this_period, lead_id_at_submission, reviewed_at, reviewed_by",
  identify: (u) => u.id,
  fromRow: (r) => ({
    id: r.id as string,
    memberId: r.member_id as string,
    dueAt: r.due_at as string,
    submittedAt: opt(r.submitted_at as string),
    status: r.status as ProgressUpdate["status"],
    entries: [],
    generalNote: opt(r.general_note as string),
    hoursThisPeriod: Number(r.hours_this_period ?? 0),
    leadIdAtSubmission: opt(r.lead_id_at_submission as string),
    reviewedAt: opt(r.reviewed_at as string),
    reviewedBy: opt(r.reviewed_by as string),
  }),
  toRow: (u) => ({
    id: u.id,
    member_id: u.memberId,
    due_at: u.dueAt,
    submitted_at: nul(u.submittedAt),
    status: u.status,
    general_note: nul(u.generalNote),
    hours_this_period: u.hoursThisPeriod,
    lead_id_at_submission: nul(u.leadIdAtSubmission),
    reviewed_at: nul(u.reviewedAt),
    reviewed_by: nul(u.reviewedBy),
  }),
  dependsOn: ["members"],
};

/**
 * `notified_member_ids` is a `uuid[]` rather than a join table.
 *
 * It's write-once, read-whole, and never queried by recipient across notices —
 * every read is "who was told about THIS", which an array answers in the row
 * you already have. A join table would add a second collection and a second
 * diff for a list that is never edited after it's written.
 */
const projectNotices: CollectionSpec<ProjectNotice> = {
  key: "projectNotices",
  table: "project_notices",
  columns:
    "id, project_id, kind, body, created_by, created_at, notified_member_ids",
  identify: (n) => n.id,
  fromRow: (r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    kind: r.kind as ProjectNotice["kind"],
    body: r.body as string,
    createdById: (r.created_by as string) ?? "",
    createdAt: r.created_at as string,
    notifiedMemberIds: (r.notified_member_ids as string[]) ?? [],
  }),
  toRow: (n) => ({
    id: n.id,
    project_id: n.projectId,
    kind: n.kind,
    body: n.body,
    created_by: n.createdById || null,
    created_at: n.createdAt,
    notified_member_ids: n.notifiedMemberIds,
  }),
  dependsOn: ["members", "projects"],
};

/**
 * Order matters: inserts run top to bottom, deletes bottom to top, so a row is
 * never written before what it references or deleted while still referenced.
 */
export const COLLECTIONS = [
  members,
  teams,
  projects,
  projectMemberships,
  deliverables,
  workLogs,
  joinRequests,
  updateSchedules,
  terms,
  events,
  projectArtifacts,
  progressUpdates,
  projectNotices,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as CollectionSpec<any>[];

export { progressUpdates as progressUpdatesSpec };
