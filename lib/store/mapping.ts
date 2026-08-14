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
  CatalogueItem,
  DeliverableTodo,
  MemberRequest,
  ProjectAdvisor,
  ClubSettings,
  ClubEvent,
  Deliverable,
  HelpReply,
  HelpRequest,
  JoinRequest,
  Member,
  MemberCertification,
  ProgressUpdate,
  Project,
  ProjectArtifact,
  ProjectMembership,
  ProjectDeadlineChange,
  ProjectNotice,
  Team,
  Term,
  TrainingSection,
  UpdateSchedule,
  WorkLog,
  GuideBlock,
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
    "id, email, full_name, preferred_name, photo_url, class_year, major, phone, discord_user_id, discord_verified_at, calendar_clients, calendar_synced_at, global_role, status, lead_id, primary_team_id, skills, joined_at, last_active_at, daily_digest_opt_out",
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
    discordUserId: opt(r.discord_user_id as string),
    discordVerifiedAt: opt(r.discord_verified_at as string),
    calendarClients: (r.calendar_clients as string[]) ?? [],
    calendarSyncedAt: opt(r.calendar_synced_at as string),
    globalRole: r.global_role as Member["globalRole"],
    status: r.status as Member["status"],
    // Stays null: "reports to nobody" is meaningful, and both chain walks
    // terminate on it.
    leadId: (r.lead_id as string) ?? null,
    primaryTeamId: opt(r.primary_team_id as string),
    skills: opt(r.skills as string[]),
    joinedAt: r.joined_at as string,
    lastActiveAt: opt(r.last_active_at as string),
    dailyDigestOptOut: (r.daily_digest_opt_out as boolean) ?? false,
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
    discord_user_id: nul(m.discordUserId),
    discord_verified_at: nul(m.discordVerifiedAt),
    /*
      Written back so a diff never blanks them, but the feed route is what
      actually SETS them — through the service role, because the caller is Apple
      Calendar and there is no session. See `recordFeedFetch`.
    */
    calendar_clients: m.calendarClients ?? [],
    calendar_synced_at: nul(m.calendarSyncedAt),
    global_role: m.globalRole,
    status: m.status,
    lead_id: m.leadId,
    primary_team_id: nul(m.primaryTeamId),
    skills: m.skills ?? [],
    joined_at: m.joinedAt,
    last_active_at: nul(m.lastActiveAt),
    daily_digest_opt_out: m.dailyDigestOptOut ?? false,
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
  /*
    `hours` is deliberately absent.

    The column still exists in Postgres and still holds every number the club
    recorded before 2026-08-14 — nothing was deleted, per the never-hard-delete
    rule. It is simply not selected, so no hours value can reach the app and get
    rendered or re-aggregated by accident. Migration 0039 dropped its NOT NULL
    so inserts that omit it succeed.

    `description` maps through `str`, not `opt`: it's required on write now, but
    historical rows predate that and have NULL, and the app's type says
    `string`. Coercing here rather than at every read site is what keeps the two
    honest — see `WorkLog` in lib/types.ts.
  */
  columns: "id, member_id, project_id, work_date, description",
  identify: (w) => w.id,
  fromRow: (r) => ({
    id: r.id as string,
    memberId: r.member_id as string,
    projectId: r.project_id as string,
    workDate: r.work_date as string,
    description: (r.description as string | null) ?? "",
  }),
  toRow: (w) => ({
    id: w.id,
    member_id: w.memberId,
    project_id: w.projectId,
    work_date: w.workDate,
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
  columns:
    "id, title, kind, importance_weight, starts_at, ends_at, location, project_id, created_by, attendee_ids, is_open, notes",
  identify: (e) => e.id,
  fromRow: (r) => ({
    id: r.id as string,
    title: r.title as string,
    kind: r.kind as ClubEvent["kind"],
    importanceWeight: Number(r.importance_weight ?? 3),
    startsAt: r.starts_at as string,
    endsAt: opt(r.ends_at as string),
    location: opt(r.location as string),
    projectId: opt(r.project_id as string),
    createdBy: opt(r.created_by as string),
    attendeeIds: (r.attendee_ids as string[]) ?? [],
    // Defaults true: an event nobody said otherwise about is one you can turn
    // up to, which is the behaviour this calendar exists for.
    isOpen: (r.is_open as boolean) ?? true,
    notes: opt(r.notes as string),
  }),
  toRow: (e) => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    importance_weight: e.importanceWeight,
    starts_at: e.startsAt,
    ends_at: nul(e.endsAt),
    location: nul(e.location),
    project_id: nul(e.projectId),
    created_by: nul(e.createdBy),
    attendee_ids: e.attendeeIds,
    is_open: e.isOpen,
    notes: nul(e.notes),
  }),
  dependsOn: ["members", "projects"],
};

const projectArtifacts: CollectionSpec<ProjectArtifact> = {
  key: "projectArtifacts",
  table: "project_artifacts",
  columns:
    "id, project_id, kind, title, description, file_url, external_url, storage_path, version, uploaded_by, created_at",
  identify: (a) => a.id,
  fromRow: (r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    kind: r.kind as ProjectArtifact["kind"],
    title: r.title as string,
    description: opt(r.description as string),
    fileUrl: opt(r.file_url as string),
    externalUrl: opt(r.external_url as string),
    storagePath: opt(r.storage_path as string),
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
    storage_path: nul(a.storagePath),
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
  /*
    `hours_this_period` is absent for the same reason as `work_logs.hours` —
    the column stays, the app stops reading it. It is `not null default 0` in
    SQL, so omitting it from an insert is safe; the 0 it lands on is now
    meaningless rather than wrong, and the trigger that used to recompute it
    from `update_entries` was dropped in migration 0039.
  */
  columns:
    "id, member_id, due_at, reminder_sent_at, late_notice_sent_at, submitted_at, status, general_note, lead_id_at_submission, reviewed_at, reviewed_by",
  identify: (u) => u.id,
  fromRow: (r) => ({
    id: r.id as string,
    memberId: r.member_id as string,
    dueAt: r.due_at as string,
    reminderSentAt: opt(r.reminder_sent_at as string),
    lateNoticeSentAt: opt(r.late_notice_sent_at as string),
    submittedAt: opt(r.submitted_at as string),
    status: r.status as ProgressUpdate["status"],
    entries: [],
    generalNote: opt(r.general_note as string),
    leadIdAtSubmission: opt(r.lead_id_at_submission as string),
    reviewedAt: opt(r.reviewed_at as string),
    reviewedBy: opt(r.reviewed_by as string),
  }),
  toRow: (u) => ({
    id: u.id,
    member_id: u.memberId,
    due_at: u.dueAt,
    reminder_sent_at: nul(u.reminderSentAt),
    late_notice_sent_at: nul(u.lateNoticeSentAt),
    submitted_at: nul(u.submittedAt),
    status: u.status,
    general_note: nul(u.generalNote),
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
 * Target-date moves. Append-only — see `ProjectDeadlineChange`.
 *
 * `identify` is the row id rather than a natural key, because a project can
 * legitimately move the same date twice (out, back in, out again) and a
 * composite key would make the second move overwrite the first.
 */
const projectDeadlineChanges: CollectionSpec<ProjectDeadlineChange> = {
  key: "projectDeadlineChanges",
  table: "project_deadline_changes",
  columns: "id, project_id, from_date, to_date, reason, changed_by, changed_at",
  identify: (c) => c.id,
  fromRow: (r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    fromDate: opt(r.from_date as string),
    toDate: r.to_date as string,
    reason: (r.reason as string) ?? "",
    changedById: opt(r.changed_by as string),
    changedAt: r.changed_at as string,
  }),
  toRow: (c) => ({
    id: c.id,
    project_id: c.projectId,
    from_date: nul(c.fromDate),
    to_date: c.toDate,
    reason: c.reason,
    changed_by: nul(c.changedById),
    changed_at: c.changedAt,
  }),
  // `deliverables` too, since 0042: a row may reference one, and inserting
  // before it exists would violate the foreign key.
  dependsOn: ["members", "projects", "deliverables"],
};

/**
 * Help requests carry their replies inline, the same shape `progressUpdates`
 * uses for entries: two tables, one object. `supabase.ts` stitches on read and
 * splits on write.
 */
const helpRequests: CollectionSpec<HelpRequest> = {
  key: "helpRequests",
  table: "help_requests",
  columns:
    "id, member_id, title, detail, project_id, created_at, resolved_at, resolved_by, resolution_note",
  identify: (h) => h.id,
  fromRow: (r) => ({
    id: r.id as string,
    memberId: r.member_id as string,
    title: r.title as string,
    detail: opt(r.detail as string),
    projectId: opt(r.project_id as string),
    createdAt: r.created_at as string,
    resolvedAt: opt(r.resolved_at as string),
    resolvedById: opt(r.resolved_by as string),
    resolutionNote: opt(r.resolution_note as string),
    // Filled in by the loader, like `ProgressUpdate.entries`.
    replies: [],
  }),
  toRow: (h) => ({
    id: h.id,
    member_id: h.memberId,
    title: h.title,
    detail: nul(h.detail),
    project_id: nul(h.projectId),
    created_at: h.createdAt,
    resolved_at: nul(h.resolvedAt),
    resolved_by: nul(h.resolvedById),
    resolution_note: nul(h.resolutionNote),
  }),
  dependsOn: ["members", "projects"],
};

/** Columns for the replies table, which has no collection of its own. */
export const HELP_REPLY_COLUMNS = "id, request_id, member_id, body, created_at";

export function helpReplyFromRow(r: Record<string, unknown>): HelpReply {
  return {
    id: r.id as string,
    requestId: r.request_id as string,
    memberId: r.member_id as string,
    body: (r.body as string) ?? "",
    createdAt: r.created_at as string,
  };
}

export function helpReplyToRow(reply: HelpReply) {
  return {
    id: reply.id,
    request_id: reply.requestId,
    member_id: reply.memberId,
    body: reply.body,
    created_at: reply.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Trainings and facility access
// ---------------------------------------------------------------------------

const trainingSections: CollectionSpec<TrainingSection> = {
  key: "trainingSections",
  table: "training_sections",
  columns: "id, name, sort_order",
  identify: (s) => s.id,
  fromRow: (r) => ({
    id: r.id as string,
    name: r.name as string,
    sortOrder: Number(r.sort_order ?? 0),
  }),
  toRow: (s) => ({ id: s.id, name: s.name, sort_order: s.sortOrder }),
};

const catalogueItems: CollectionSpec<CatalogueItem> = {
  key: "catalogueItems",
  table: "catalogue_items",
  columns: "id, section_id, name, kind, validity_months, sort_order, is_active",
  identify: (i) => i.id,
  fromRow: (r) => ({
    id: r.id as string,
    sectionId: r.section_id as string,
    name: r.name as string,
    kind: r.kind as CatalogueItem["kind"],
    validityMonths: opt(r.validity_months as number),
    sortOrder: Number(r.sort_order ?? 0),
    isActive: r.is_active as boolean,
  }),
  toRow: (i) => ({
    id: i.id,
    section_id: i.sectionId,
    name: i.name,
    kind: i.kind,
    validity_months: nul(i.validityMonths),
    sort_order: i.sortOrder,
    is_active: i.isActive,
  }),
  dependsOn: ["trainingSections"],
};

const certifications: CollectionSpec<MemberCertification> = {
  key: "certifications",
  table: "member_certifications",
  columns:
    "id, member_id, item_id, status, completed_at, expires_at, certificate_url, verified_by, verified_at, note, requested_at",
  identify: (c) => c.id,
  fromRow: (r) => ({
    id: r.id as string,
    memberId: r.member_id as string,
    itemId: r.item_id as string,
    status: r.status as MemberCertification["status"],
    completedAt: r.completed_at as string,
    expiresAt: opt(r.expires_at as string),
    certificateUrl: opt(r.certificate_url as string),
    verifiedById: opt(r.verified_by as string),
    verifiedAt: opt(r.verified_at as string),
    note: opt(r.note as string),
    requestedAt: r.requested_at as string,
  }),
  toRow: (c) => ({
    id: c.id,
    member_id: c.memberId,
    item_id: c.itemId,
    status: c.status,
    completed_at: c.completedAt,
    expires_at: nul(c.expiresAt),
    certificate_url: nul(c.certificateUrl),
    verified_by: nul(c.verifiedById),
    verified_at: nul(c.verifiedAt),
    note: nul(c.note),
    requested_at: c.requestedAt,
  }),
  dependsOn: ["members", "catalogueItems"],
};

/**
 * Order matters: inserts run top to bottom, deletes bottom to top, so a row is
 * never written before what it references or deleted while still referenced.
 */
/**
 * One row, always. `identify` returns a constant for that reason — the diff
 * must see an edit as an UPDATE to the same row, never as a second club.
 */
const clubSettings: CollectionSpec<ClubSettings> = {
  key: "clubSettings",
  table: "club_settings",
  /*
    The four tier-floor columns are absent, and the `tiers_in_order` /
    `minimum_within_range` constraints from migration 0020 still guard them in
    Postgres. That's fine as long as nothing writes them: an UPDATE that doesn't
    mention a column leaves it alone, so the existing in-order values stay
    in-order. Don't add them back to this spec without re-reading 0020 — a
    partial write of three of the four would trip a constraint the app no longer
    has any UI to satisfy.
  */
  columns:
    "id, club_name, club_description, discord_invite_url, updated_at, updated_by",
  identify: () => "1",
  fromRow: (r) => ({
    id: String(r.id ?? "1"),
    clubName: opt(r.club_name as string),
    clubDescription: opt(r.club_description as string),
    discordInviteUrl: opt(r.discord_invite_url as string),
    updatedAt: opt(r.updated_at as string),
    updatedBy: opt(r.updated_by as string),
  }),
  toRow: (c) => ({
    id: 1,
    club_name: nul(c.clubName),
    club_description: nul(c.clubDescription),
    discord_invite_url: nul(c.discordInviteUrl),
    updated_at: c.updatedAt ?? new Date().toISOString(),
    updated_by: nul(c.updatedBy),
  }),
};

const deliverableTodos: CollectionSpec<DeliverableTodo> = {
  key: "deliverableTodos",
  table: "deliverable_todos",
  columns:
    "id, deliverable_id, title, done, done_at, done_by, sort_order, created_by",
  identify: (t) => t.id,
  fromRow: (r) => ({
    id: r.id as string,
    deliverableId: r.deliverable_id as string,
    title: r.title as string,
    done: Boolean(r.done),
    doneAt: opt(r.done_at as string),
    doneBy: opt(r.done_by as string),
    sortOrder: Number(r.sort_order ?? 0),
    createdBy: opt(r.created_by as string),
  }),
  toRow: (t) => ({
    id: t.id,
    deliverable_id: t.deliverableId,
    title: t.title,
    done: t.done,
    done_at: nul(t.doneAt),
    done_by: nul(t.doneBy),
    sort_order: t.sortOrder,
    created_by: nul(t.createdBy),
  }),
  dependsOn: ["deliverables"],
};

const projectAdvisors: CollectionSpec<ProjectAdvisor> = {
  key: "projectAdvisors",
  table: "project_advisors",
  columns: "project_id, member_id, added_by, added_at",
  // Composite key: one advisor can be on many projects and one project can
  // have several advisors, so neither column identifies a row on its own.
  identify: (a) => `${a.projectId}:${a.memberId}`,
  fromRow: (r) => ({
    projectId: r.project_id as string,
    memberId: r.member_id as string,
    addedBy: opt(r.added_by as string),
    addedAt: r.added_at as string,
  }),
  toRow: (a) => ({
    project_id: a.projectId,
    member_id: a.memberId,
    added_by: nul(a.addedBy),
    added_at: a.addedAt,
  }),
  dependsOn: ["projects", "members"],
};

const memberRequests: CollectionSpec<MemberRequest> = {
  key: "memberRequests",
  table: "member_requests",
  columns:
    "id, member_id, lead_id, body, status, response, responded_by, responded_at, created_at",
  identify: (r) => r.id,
  fromRow: (r) => ({
    id: r.id as string,
    memberId: r.member_id as string,
    leadId: r.lead_id as string,
    body: r.body as string,
    status: r.status as MemberRequest["status"],
    response: opt(r.response as string),
    respondedBy: opt(r.responded_by as string),
    respondedAt: opt(r.responded_at as string),
    createdAt: r.created_at as string,
  }),
  toRow: (r) => ({
    id: r.id,
    member_id: r.memberId,
    lead_id: r.leadId,
    body: r.body,
    status: r.status,
    response: nul(r.response),
    responded_by: nul(r.respondedBy),
    responded_at: nul(r.respondedAt),
    created_at: r.createdAt,
  }),
  dependsOn: ["members"],
};

const guideBlocks: CollectionSpec<GuideBlock> = {
  key: "guideBlocks",
  table: "guide_blocks",
  columns:
    "id, page, kind, title, body, url, category, sort_order, updated_at, updated_by",
  identify: (b) => b.id,
  fromRow: (r) => ({
    id: r.id as string,
    page: r.page as GuideBlock["page"],
    kind: r.kind as GuideBlock["kind"],
    title: r.title as string,
    body: opt(r.body as string),
    url: opt(r.url as string),
    category: opt(r.category as string),
    sortOrder: r.sort_order as number,
    updatedAt: r.updated_at as string,
    updatedById: opt(r.updated_by as string),
  }),
  toRow: (b) => ({
    id: b.id,
    page: b.page,
    kind: b.kind,
    title: b.title,
    body: nul(b.body),
    url: nul(b.url),
    category: nul(b.category),
    sort_order: b.sortOrder,
    updated_at: b.updatedAt,
    updated_by: nul(b.updatedById),
  }),
  dependsOn: ["members"],
};

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
  projectDeadlineChanges,
  helpRequests,
  trainingSections,
  catalogueItems,
  certifications,
  clubSettings,
  deliverableTodos,
  projectAdvisors,
  memberRequests,
  guideBlocks,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as CollectionSpec<any>[];

export { progressUpdates as progressUpdatesSpec };

/**
 * The profiles spec, for the one place that reads a single profile directly.
 *
 * `lib/data/viewer.ts` fetches the signed-in member on its own rather than
 * through the snapshot, and used to carry its own hand-written column list.
 * That list silently fell behind: `phone`, `discord_user_id` and
 * `discord_verified_at` were all added here and never there, so the signed-in
 * member object had no phone and no Discord — the profile form rendered
 * placeholders over saved values, and the Discord banner could never see that
 * somebody had verified.
 *
 * Nothing about that fails loudly. The query succeeds, the columns are simply
 * absent, and every consumer reads `undefined` as "not set". Exporting the
 * spec means there is one definition of what a profile is.
 */
export { members as membersSpec };
