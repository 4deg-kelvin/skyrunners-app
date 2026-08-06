/**
 * Domain types for the Sky Runners app.
 *
 * These mirror the schema in docs/DATA_MODEL.md. Once Supabase is wired up
 * these will be generated from the database instead of hand-written, but
 * having them now lets us build real UI against mock data.
 */

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Global role. Ordered least to most authority.
 *
 * These strings must match the `global_role` enum in the database exactly —
 * see docs/DATA_MODEL.md. `co_lead`, not `admin`.
 */
export type GlobalRole = "member" | "lead" | "co_lead";

export type MemberStatus = "active" | "inactive" | "alumni";

export interface Member {
  id: string;
  fullName: string;
  preferredName?: string;
  email: string;
  photoUrl?: string;
  classYear?: number;
  major?: string;
  globalRole: GlobalRole;
  status: MemberStatus;
  /** The one person they report to. Null for co-leads. */
  leadId: string | null;
  primaryTeamId?: string;
  skills?: string[];
  joinedAt: string;
}

// ---------------------------------------------------------------------------
// Org tree — divisions and nested teams
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  slug: string;
  description?: string;
  /** Null means this is a Division (top level, Co-Lead managed). */
  parentId: string | null;
  leadId?: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Project tree
// ---------------------------------------------------------------------------

/**
 * Where the project is in its lifecycle. Deliberately aerospace-flavored,
 * since that's the vocabulary the team already uses in design reviews.
 */
export type ProjectPhase =
  | "concept"
  | "requirements"
  | "preliminary_design"
  | "detailed_design"
  | "manufacturing"
  | "integration"
  | "testing"
  | "flight_test"
  | "complete";

/** Separate from phase: phase is *where*, health is *how it's going*. */
export type ProjectHealth = "on_track" | "at_risk" | "blocked" | "complete";

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  /** Null means top-level project. */
  parentId: string | null;
  teamId?: string;
  /**
   * The go-to person, accountable for deliverables.
   * Mirrors `projects.primary_re_id` — a real column, so it's deterministic.
   */
  primaryReId: string;
  /**
   * All REs including the primary. Derived from `project_members` rows with
   * `role = 're'`, so never rely on array order for who's primary — use
   * `primaryReId` for that.
   */
  reIds: string[];
  phase: ProjectPhase;
  health: ProjectHealth;
  startDate?: string;
  targetDate?: string;
  /** When false, Gantt dates roll up from children instead. */
  datesOverridden: boolean;
  /** Members self-enroll by default; an RE can close a project if needed. */
  isOpenToJoin: boolean;
  openRoles?: string;
  timeCommitment?: string;
}

export type ProjectRole = "re" | "contributor" | "observer";

export interface ProjectMembership {
  projectId: string;
  memberId: string;
  role: ProjectRole;
  /** What this person owns here. Surfaces on their profile. */
  responsibility?: string;
  joinedAt: string;
}

// ---------------------------------------------------------------------------
// Work logging
// ---------------------------------------------------------------------------

export interface WorkLog {
  id: string;
  memberId: string;
  projectId?: string;
  workDate: string;
  hours: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Updates — 3x per week, on member-chosen weekdays
// ---------------------------------------------------------------------------

export type UpdateStatus =
  | "pending"
  | "submitted"
  | "late"
  | "missed"
  | "reviewed";

export interface UpdateSchedule {
  memberId: string;
  /** 0 = Sunday. Three entries by default. */
  weekdays: number[];
  dueTime: string;
  isPaused: boolean;
}

/**
 * One project's worth of an update.
 *
 * This is the important structural bit: a member on three projects writes three
 * entries, each attached to a specific project. Without this, an update saying
 * "finished the layup, waiting on parts" is ambiguous to a reader who oversees
 * several of that person's projects — and REs would have to guess whether a
 * blocker is theirs to unblock.
 */
export interface UpdateEntry {
  id: string;
  updateId: string;
  projectId: string;
  progress: string;
  blockers?: string;
  nextSteps?: string;
  /** Hours on this project during the period. Auto-filled from work_logs. */
  hours: number;
}

export interface ProgressUpdate {
  id: string;
  memberId: string;
  dueAt: string;
  submittedAt?: string;
  status: UpdateStatus;
  /** One entry per project worked on. Auto-seeded from logged hours. */
  entries: UpdateEntry[];
  /** Anything not tied to a specific project. Optional. */
  generalNote?: string;
  hoursThisPeriod: number;
}

// ---------------------------------------------------------------------------
// Trainings and facility access
// ---------------------------------------------------------------------------

export type TrainingCategory =
  | "machine_shop"
  | "lab_equipment"
  | "safety"
  | "software"
  | "online_course"
  | "flight";

export interface TrainingType {
  id: string;
  name: string;
  category: TrainingCategory;
  validityMonths?: number;
}

/**
 * Members submit a request; their direct Lead or a Co-Lead verifies it.
 * `requested` is the entry point of that flow.
 */
export type TrainingStatus =
  | "requested"
  | "verified"
  | "expired"
  | "rejected";

export interface MemberTraining {
  id: string;
  memberId: string;
  trainingTypeId: string;
  completedAt: string;
  expiresAt?: string;
  certificateUrl?: string;
  status: TrainingStatus;
  verifiedById?: string;
}

export interface AccessType {
  id: string;
  name: string;
  location?: string;
}

export interface MemberAccess {
  id: string;
  memberId: string;
  accessTypeId: string;
  grantedAt?: string;
  expiresAt?: string;
  status: "requested" | "active" | "expired" | "revoked";
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventKind =
  | "design_review"
  | "company_tour"
  | "company_visit"
  | "build_session"
  | "general_meeting"
  | "training"
  | "social"
  | "competition"
  | "one_on_one";

export interface ClubEvent {
  id: string;
  title: string;
  kind: EventKind;
  /** Set by leadership. Feeds engagement scoring. */
  importanceWeight: number;
  startsAt: string;
  endsAt?: string;
  location?: string;
}
