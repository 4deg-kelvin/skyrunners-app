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
  /**
   * How you actually reach this person, and the PREFERRED contact method.
   *
   * Email stays on the record because it's the auth identity — Stanford Google
   * sign-in, and `profiles.email` is what links an invite to an account. But a
   * student emailing an RE about joining a project waits days; a text gets
   * answered. Since `/find-work` lives or dies on someone actually making
   * contact, the phone number is what gets shown.
   *
   * Optional, and the UI falls back to email — never assume it's set. Render it
   * through `<ContactLink>` rather than reading it directly, so the fallback
   * lives in one place.
   */
  phone?: string;
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
  /**
   * False means archived, not deleted.
   *
   * Divisions used to hard-delete once nothing pointed at them, which meant the
   * only way to retire one was to first strip it of everything that recorded
   * what it did. A club that reorganises every year would erase its own history
   * to keep the page tidy.
   *
   * Archived divisions keep their projects, their lead and their name; they
   * simply stop appearing in the tree and in pickers. `/projects/archive` is
   * where they're read back.
   */
  isActive: boolean;
  /** When it was archived. Absent on an active division. */
  archivedAt?: string;
  /** Who archived it. Snapshotted — the person may graduate. */
  archivedBy?: string;
  /** Why it was retired, in one line. Shown in the archive. */
  archiveNote?: string;
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
  /**
   * `committed` — an RE added them. Carries deliverables and update obligations.
   * `following` — they chose to watch. No obligations, self-service, unlimited.
   */
  commitment: "committed" | "following";
  /**
   * Which RE added them. Undefined means they self-enrolled (i.e. followed).
   *
   * Mirrors `project_members.added_by`. Worth recording on an RE-controlled
   * roster: when someone asks "why am I on this project?", the answer should
   * exist somewhere other than one person's memory.
   */
  addedBy?: string;
}

// ---------------------------------------------------------------------------
// Project artifacts
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | "presentation"
  | "github"
  | "requirements"
  | "cad"
  | "test_report"
  | "analysis"
  | "drawing"
  | "doc"
  | "link";

/**
 * An engineering deliverable or reference attached to a project.
 *
 * Two ways to attach something: `fileUrl` for an upload, `externalUrl` for a link
 * to GitHub, Drive, Onshape and so on. Links matter more than uploads here — a
 * student team's CAD lives in Onshape and its code lives in GitHub, and copying
 * files into a second place guarantees the copy goes stale. The app's job is to
 * be the index, not another silo.
 */
export interface ProjectArtifact {
  id: string;
  projectId: string;
  kind: ArtifactKind;
  title: string;
  description?: string;
  fileUrl?: string;
  externalUrl?: string;
  version?: string;
  uploadedById: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Project notices — the app writing in the project's own feed
// ---------------------------------------------------------------------------

export type ProjectNoticeKind = "completed" | "reopened";

/**
 * A milestone the app announced, rather than a person writing it.
 *
 * Deliberately NOT a `progress_update`. The feed on a project page is built
 * from update entries, so the obvious way to say "this project finished" would
 * be to synthesise a check-in — and that check-in would then count towards
 * somebody's reliability signal in `lib/contribution.ts`. A record that says a
 * member reported in on a day they didn't is worse than no announcement.
 *
 * So notices are their own row, rendered in the same feed and clearly marked as
 * automatic.
 *
 * `notifiedMemberIds` is the chain of command this went up, snapshotted at the
 * moment it happened. Derived live it would silently re-address itself every
 * time an RE changes or a project moves, and "who was told, and when" is the
 * only thing that makes an announcement worth having.
 */
export interface ProjectNotice {
  id: string;
  projectId: string;
  kind: ProjectNoticeKind;
  /** The autogenerated sentence. Stored, not recomputed — names change. */
  body: string;
  /** Who took the action that produced it. */
  createdById: string;
  createdAt: string;
  /** Everyone up the chain who was told. May be empty for a top-level project. */
  notifiedMemberIds: string[];
}

// ---------------------------------------------------------------------------
// Join requests
// ---------------------------------------------------------------------------

/**
 * Membership is RE-controlled: members cannot add themselves to a project.
 *
 * This table is what keeps that from recreating the problem the app exists to
 * solve. Without it, "ask the RE" means an email that may never get answered,
 * and the member is back in invisible limbo — which is exactly what made people
 * quit, just with a different person to chase.
 *
 * A request is a tracked object instead: it appears in the RE's queue, the
 * member can see it's pending, and it can be escalated when it goes stale. The
 * ask becomes visible rather than lost.
 */
export type JoinRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "withdrawn";

/** A request older than this needs escalating — a silent RE is a blocked member. */
export const JOIN_REQUEST_STALE_DAYS = 5;

export interface JoinRequest {
  id: string;
  projectId: string;
  memberId: string;
  /** Why they want in, and what they'd bring. Helps the RE decide fast. */
  note?: string;
  status: JoinRequestStatus;
  requestedAt: string;
  decidedAt?: string;
  decidedById?: string;
  /** Optional reply, so a decline isn't just silence. */
  responseNote?: string;
}

// ---------------------------------------------------------------------------
// Deliverables — the whole task model
// ---------------------------------------------------------------------------

/**
 * `submitted` is the owner saying "I'm done"; `done` is the RE agreeing.
 *
 * Two steps rather than one because "Delivered" is the primary contribution
 * signal and the one thing that must not be inflatable — if finishing your own
 * work were self-certified, the number would measure confidence rather than
 * output.
 *
 * The cost is real and has to be designed around: an RE who goes quiet freezes
 * their whole project's record. So unconfirmed work escalates the same way an
 * unread check-in does (`lib/review.ts`), which turns a silent bottleneck into a
 * visible one.
 *
 * **Only `done` counts as delivered.** Anything that treats `submitted` as
 * complete — progress bars, the contribution record, "projects completed" —
 * quietly reintroduces self-certification.
 */
export type DeliverableStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "submitted"
  | "done";

/**
 * One flat list per project. Four fields that matter: title, ONE owner, a date,
 * a status.
 *
 * This deliberately replaces a full task board with dependencies, sub-tasks and
 * critical-path analysis. That design would have cost an RE an hour a week to
 * maintain, and on a volunteer team whose availability swings with midterms the
 * dependency graph is wrong the day after it's entered — a wrong schedule is
 * worse than no schedule, because people plan against it.
 *
 * What this list buys, from five minutes of RE upkeep a week:
 *   - every member can see exactly what they own, everywhere
 *   - update drafts pre-fill from open deliverables
 *   - project progress is a real percentage, not a vibe
 *   - "projects completed" becomes a trustworthy leadership signal
 *   - dated deliverables give you an honest timeline without a Gantt chart
 *
 * Exactly one owner, always. Shared ownership means nobody owns it.
 */
export interface Deliverable {
  id: string;
  projectId: string;
  title: string;
  /** Required. Never null, never a list. */
  ownerId: string;
  dueDate?: string;
  status: DeliverableStatus;
  /** When the OWNER marked it done. Not the same as being delivered. */
  submittedAt?: string;
  /** When an RE confirmed it. This is the one that counts. */
  completedAt?: string;
  /** Which RE confirmed. Snapshotted — REs change over a project's life. */
  confirmedById?: string;
  /** Why it's stuck. Routes to the project's REs. */
  blockerNote?: string;
  sortOrder: number;
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

/** Club-wide default. Members pick which weekdays. */
export const UPDATES_PER_WEEK_DEFAULT = 2;

export interface UpdateSchedule {
  memberId: string;
  /** 0 = Sunday. Length should match `updatesPerWeek`. */
  weekdays: number[];
  updatesPerWeek: number;
  dueTime: string;
  /**
   * Academic pause. Suppresses obligations AND nudges, and generates no
   * `missed` rows — a lapse is a pause, never a debt. Someone who drifts during
   * midterms has to be able to come back without facing a record of failure.
   */
  pausedUntil?: string;
}

// ---------------------------------------------------------------------------
// Academic calendar
// ---------------------------------------------------------------------------

export type TermKind = "quarter" | "finals" | "break" | "summer";

/**
 * Stanford runs on quarters, and without this table every finals week and
 * winter break silently generates weeks of `missed` updates for all 35 members.
 * By autumn the contribution data would be meaningless, and nudge emails would
 * be landing on students during finals — the worst possible message at the worst
 * possible moment.
 */
export interface Term {
  id: string;
  name: string;
  kind: TermKind;
  startsOn: string;
  endsOn: string;
  /** False for finals, breaks and summer. No obligations, no nudges. */
  generatesObligations: boolean;
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
  /**
   * Who this person reported to AT SUBMISSION. Mirrors
   * `progress_updates.lead_id_at_submission`.
   *
   * Snapshotted, not derived. Leads change mid-quarter, and a review queue that
   * joined live to `profiles.lead_id` would silently re-file historic check-ins
   * under the new Lead — making the old Lead's record of what they reviewed
   * disappear.
   */
  leadIdAtSubmission?: string;
  /** When a Lead marked it read. Stops the escalation clock in lib/review.ts. */
  reviewedAt?: string;
  /**
   * Which Lead read it. Snapshotted rather than derived, because Leads change
   * and "who was responsible for reading this" has to stay answerable after
   * they've moved on — same reasoning as `lead_id_at_submission`.
   */
  reviewedBy?: string;
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
  /** Set by leadership. Drives how prominently the event is surfaced. */
  importanceWeight: number;
  startsAt: string;
  endsAt?: string;
  location?: string;
}

// ---------------------------------------------------------------------------
// RE liveness
// ---------------------------------------------------------------------------

/** How long an RE can be silent before their projects get flagged. */
export const RE_SILENT_DAYS = 14;
/** How long a blocker can sit unanswered before escalating. */
export const BLOCKER_STALE_DAYS = 7;

/**
 * Why a project needs leadership attention.
 *
 * RE authority inherits down the project tree, so an RE who checks out in
 * January freezes their entire subtree: nobody can create sub-projects, appoint
 * REs, or clear blockers beneath them. It happens every year, and nothing
 * surfaces it — which is the exact disorganization this app exists to remove.
 */
export type AttentionReason =
  | "re_silent"
  | "blocker_stale"
  | "deliverables_overdue"
  | "no_deputy_re"
  | "health_flagged";

export interface ProjectAttentionFlag {
  projectId: string;
  reason: AttentionReason;
  detail: string;
  /** Higher is more urgent. */
  severity: 1 | 2 | 3;
}
