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
 * Global role.
 *
 * These strings must match the `global_role` enum in the database exactly —
 * see docs/DATA_MODEL.md. `co_lead`, not `admin`.
 *
 * **`member` -> `lead` -> `co_lead` is a ladder. `advisor` is not on it.**
 *
 * An advisor is a faculty or project advisor: they see everything and can say
 * something about anything, but they build nothing. No projects, no
 * deliverables, no hours, no check-ins, and nobody above or below them in the
 * reporting chain. More access than a member in some directions, none of the
 * authority in any.
 *
 * That makes ordering comparisons meaningless, and the code no longer does
 * them. Twenty places once read `globalRole !== "member"` as shorthand for "is
 * leadership" — every one would have handed an advisor the power to invite
 * people, admit them, create club-wide events and file roll-ups. They all go
 * through `isLeadership()` now. If you add a fifth role, that predicate is the
 * first thing to check.
 */
export type GlobalRole = "member" | "advisor" | "lead" | "co_lead";

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
  /**
   * Their Discord user id, so the club's bot can DM them.
   *
   * Opt-in and nullable: no id simply means no Discord notifications, and
   * every send path checks. A snowflake id as TEXT, never a number —
   * JavaScript rounds 64-bit integers past 2^53, so parsing one silently
   * yields a different person's id.
   */
  discordUserId?: string;
  /**
   * When the bot last successfully delivered to `discordUserId`.
   *
   * Having an ID is not the same as being reachable — a typo, a member who
   * never joined the club's server, or DMs switched off all give an ID that
   * looks right and delivers nothing. That's worse than no ID, because both
   * sides believe it's working. Cleared whenever the ID changes.
   */
  discordVerifiedAt?: string;
  globalRole: GlobalRole;
  status: MemberStatus;
  /** The one person they report to. Null for co-leads. */
  leadId: string | null;
  primaryTeamId?: string;
  skills?: string[];
  joinedAt: string;
  /**
   * When they last signed in. Written by the trigger in migration 0005.
   *
   * **Undefined means they have never signed in at all**, and that distinction
   * is the whole reason this reaches the app. Two very different situations
   * look identical on the roster without it:
   *
   *   - Invited, never arrived — usually the email doesn't match the one
   *     Google gives back, so the invite and the person never meet.
   *   - Signed in and waiting to be activated — the trigger creates an
   *     inactive profile for anyone with no invite, so they're sitting at
   *     `/auth/inactive` needing one click from a Lead.
   *
   * "I can't add this person" is nearly always the first; the fix is to check
   * the address, not to invite them again.
   */
  lastActiveAt?: string;
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

export type ProjectNoticeKind = "completed" | "reopened" | "re_paused";

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
// Asking for help — the blocker board
// ---------------------------------------------------------------------------

/**
 * A free-form "I need help with this" post.
 *
 * The blocker board is mostly automatic: a deliverable marked blocked, or a
 * blocker written in a check-in, appears there without anyone posting. This is
 * the third source — the ask that fits neither, and the one that matters most
 * now that joining a project goes through an RE.
 *
 * Without it, a member whose join request is sitting unanswered has exactly one
 * route to being useful and it waits on one person's inbox. "Does anyone know
 * Onshape well enough to look at this?" needs somewhere to go that isn't a
 * project they haven't been added to.
 *
 * **Anyone can answer**, deliberately, not just leadership. The whole point is
 * a second route; routing it back through the same people would rebuild the
 * bottleneck one level up.
 */
export interface HelpRequest {
  id: string;
  /** Who is stuck. */
  memberId: string;
  title: string;
  detail?: string;
  /** Optional — plenty of asks aren't about a specific project. */
  projectId?: string;
  createdAt: string;
  /** Set when it stops needing attention. Kept, not deleted. */
  resolvedAt?: string;
  /** Who marked it resolved. May be the asker or whoever helped. */
  resolvedById?: string;
  /** How it got unstuck, in a line. The part worth reading later. */
  resolutionNote?: string;
  replies: HelpReply[];
}

export interface HelpReply {
  id: string;
  requestId: string;
  memberId: string;
  body: string;
  createdAt: string;
}

/**
 * An ask older than this is failing, whoever it belongs to.
 *
 * Same reasoning as `JOIN_REQUEST_STALE_DAYS` and the review escalation: age,
 * not count. "Nobody has answered Kenji in 6 days" names one person and is
 * actionable; "14 open blockers" is a number you learn to scroll past.
 */
export const HELP_REQUEST_STALE_DAYS = 3;

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
  "pending" | "accepted" | "declined" | "withdrawn";

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
  "open" | "in_progress" | "blocked" | "submitted" | "done";

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
// Updates — twice a week by default, on member-chosen weekdays
// ---------------------------------------------------------------------------

export type UpdateStatus =
  "pending" | "submitted" | "late" | "missed" | "reviewed";

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
  /**
   * The RE's answer to THIS project's section.
   *
   * **The RE responds, not the Lead**, and that split is the point. A Lead
   * marks the whole check-in read — that's an obligation about a person. The
   * useful reply to "the vacuum pump seal is leaking" comes from whoever is
   * accountable for that project, and a member on three projects needs three
   * different people, not one person guessing at three contexts.
   *
   * One response per section rather than a thread: this is an answer, not a
   * conversation. A conversation belongs on the blocker board or in a message,
   * and threading here would turn a 15-minute weekly obligation into an inbox.
   */
  response?: string;
  /** Which RE answered. Snapshotted — REs change over a project's life. */
  respondedBy?: string;
  respondedAt?: string;
}

export interface ProgressUpdate {
  id: string;
  memberId: string;
  dueAt: string;
  /**
   * When the "due in a few hours" nudge went out, if it did.
   *
   * Half of the idempotency mechanism for the reminder cron: the job claims
   * this column before sending, so a retry or an overlapping invocation
   * updates zero rows and gives up rather than sending twice. See
   * `app/api/cron/checkin-reminders/route.ts`.
   */
  reminderSentAt?: string;
  /**
   * When the "this is still open" follow-up went out, if it did.
   *
   * The other half, and the reason a late member gets exactly one chase rather
   * than one every morning. Separate from `reminderSentAt` because they answer
   * different questions — was she warned in time, was she chased afterwards —
   * and fire under opposite conditions.
   */
  lateNoticeSentAt?: string;
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

/**
 * ============================================================================
 * The catalogue is DATA, not a type. This is the whole design.
 * ============================================================================
 *
 * There used to be a `TrainingCategory` union here — `machine_shop | safety |
 * software | …` — and it was the wrong shape for the actual requirement:
 *
 *   "More trainings will always be added later, so it should be easy for any
 *    Co-Lead to add more trainings which should automatically populate for
 *    everyone as they show up."  — Anish, 2026-08-08
 *
 * A union type means adding "Waterjet" is a code change, a migration, a
 * deploy, and a developer. As rows, it's a Co-Lead typing a name. **Do not
 * reintroduce an enum of training names**, however tempting the type safety
 * looks — the club will add machines faster than anyone will ship deploys for
 * them, and the moment the two drift the page stops matching the shop.
 *
 * The only enum here is `kind`, which has exactly two values that are
 * genuinely different behaviours (a door versus a machine), not a list that
 * grows.
 */

/** A site, or `Misc` for the things that belong to no site. */
export interface TrainingSection {
  id: string;
  name: string;
  /** Manual ordering — the shop's layout isn't alphabetical. */
  sortOrder: number;
}

/**
 * Two genuinely different things, deliberately in one table.
 *
 *   `site_access` — can you get in the door. A keycard.
 *   `machine`     — are you cleared on a specific machine, inside a site.
 *
 * **Neither implies the other**, in either direction: Lab 64 access doesn't
 * clear you on the laser cutter, and being cleared on the laser cutter doesn't
 * open the door at 2am (that's "Lab 64 — 24 hour", its own separate access).
 * They share a table because the request → verify flow, the expiry rules and
 * the certificate field are identical, and two tables would mean writing all
 * of that twice.
 */
export type CatalogueItemKind = "site_access" | "machine";

export interface CatalogueItem {
  id: string;
  sectionId: string;
  name: string;
  kind: CatalogueItemKind;
  /**
   * How long it stays valid. Undefined means forever, which is the case for
   * everything in the club's list today.
   *
   * When it IS set, expiry doesn't just grey the row out — the certification
   * is cancelled and the member's Lead is told, because an expired clearance
   * that still reads as valid is the one failure mode that gets somebody hurt.
   */
  validityMonths?: number;
  sortOrder: number;
  /** Retired rather than deleted, so existing records keep their meaning. */
  isActive: boolean;
}

/**
 * One member's standing on one catalogue item.
 *
 * `requested` is the entry point: a member says they've done the training.
 * **Nobody self-verifies** — `can.verifyTraining` is their Lead chain or a
 * Co-Lead, and the operation refuses the member's own id regardless.
 */
export type CertificationStatus =
  "requested" | "verified" | "expired" | "rejected";

export interface MemberCertification {
  id: string;
  memberId: string;
  itemId: string;
  status: CertificationStatus;
  /** When the member says they did it. */
  completedAt: string;
  /** Computed from `validityMonths` at verification. Absent means no expiry. */
  expiresAt?: string;
  certificateUrl?: string;
  /**
   * Who verified, and when. Snapshotted, same reasoning as
   * `lead_id_at_submission`: people change roles and "who signed this off"
   * has to stay answerable after they've graduated.
   */
  verifiedById?: string;
  verifiedAt?: string;
  /** Why it was rejected, or any note the verifier left. */
  note?: string;
  requestedAt: string;
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

/**
 * Anything the club gets together for.
 *
 * ---------------------------------------------------------------------------
 * What this calendar is for, and what it isn't
 * ---------------------------------------------------------------------------
 *
 * It answers *"what is happening right now, and can I join it?"* It is **not**
 * a meeting-scheduling tool — there's no availability matching, no invite
 * negotiation, no RSVP round-trip. Its job is the same as `/find-work`: make
 * it possible to plug into the club's work without asking a Co-Lead.
 *
 * The case that matters most is the **ad-hoc engineering session**. If two
 * people are working on the wing spar on Thursday night, that shows up and a
 * third person can turn up. Everything else here is in service of that.
 *
 * A `one_on_one` is two engineers sitting down to engineer — explicitly not a
 * performance review. It appears as a busy block so the time is visible;
 * there's no agenda field, deliberately.
 */
export interface ClubEvent {
  id: string;
  title: string;
  kind: EventKind;
  /**
   * 1–5, so the view can lead with what matters without hiding the rest.
   *
   * **Not a proxy for "is this official".** A company tour can be a 5 and a
   * routine standup a 2. Leadership sets it on club-wide events; a member
   * creating an engineering session gets a sensible default by kind.
   */
  importanceWeight: number;
  startsAt: string;
  endsAt?: string;
  location?: string;
  /** Set for an engineering session. Links the event to the work. */
  projectId?: string;
  /** Who created it, so a member can edit or cancel their own session. */
  createdBy?: string;
  /**
   * Who's expected. Names on a session rather than an RSVP flow — the point
   * is "these two are working on it", not tracking acceptance.
   *
   * A `uuid[]` rather than a join table for the same reason
   * `ProjectNotice.notifiedMemberIds` is: write-once, read-whole, never
   * queried by attendee across events.
   */
  attendeeIds: string[];
  /** Anyone can turn up to an open session; a 1:1 is the two people in it. */
  isOpen: boolean;
  notes?: string;
}

/** Default prominence by kind, so nobody has to think about it every time. */
export const DEFAULT_EVENT_IMPORTANCE: Record<EventKind, number> = {
  design_review: 4,
  company_tour: 5,
  company_visit: 4,
  build_session: 3,
  general_meeting: 4,
  training: 3,
  social: 3,
  competition: 5,
  // Visible so the time is known, quiet so it never outranks club work.
  one_on_one: 1,
};

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
  /*
    `no_deputy_re` used to live here as a standing flag on any parent project
    with one RE. Removed 2026-08-09: in a club this size that's most of them,
    most of the time, and there is frequently no second person to name — so it
    was permanent, unactionable, and taught people to ignore the flags beside
    it. The risk is covered three other ways now: `re_silent` says so when the
    sole RE actually goes quiet, `removeProjectMember` refuses to strip the
    last RE off a parent project, and pausing in that position alerts the RE's
    Lead.
  */
  | "health_flagged"
  /**
   * Past its target date and still not complete.
   *
   * Raised because health is the RE's own judgement and only moves when they
   * move it — so a project could read "3 days overdue" next to a green "On
   * track", which is the app saying two contradictory things at once. The
   * badge states the fact; this flag asks the RE to reconcile it by moving the
   * date or changing the health. Annotating a contradiction without offering a
   * way to close it is just a tidier lie.
   */
  | "past_target";

export interface ProjectAttentionFlag {
  projectId: string;
  reason: AttentionReason;
  detail: string;
  /**
   * Higher is more urgent.
   *
   * 4 is reserved for "and nobody can cover" — a sole RE who has gone quiet
   * leaves every sub-project with no route to a decision at all, which is
   * worse than the same silence on a project someone else can act on.
   */
  severity: 1 | 2 | 3 | 4;
}

// ---------------------------------------------------------------------------
// Club-wide configuration
// ---------------------------------------------------------------------------

/**
 * The commitment tier thresholds, editable by a Co-Lead.
 *
 * These were four constants in `lib/contribution.ts`, printed verbatim by the
 * published rubric at `/how-we-lead`. So the bar the whole club is measured
 * against needed a deploy to change — and the first time somebody adjusted the
 * expectation in a meeting without one, the rubric would be stating a number
 * nobody was actually using.
 *
 * Same rule as the trainings catalogue: **the club changes its expectations
 * faster than anyone ships code.** Hours are per week.
 *
 * Exactly one row exists (`id = 1`, enforced by a check constraint). It is
 * club-wide configuration, not a record of anything.
 */
export interface ClubSettings {
  id: string;
  /**
   * What the club calls itself. Undefined falls back to the shipped default.
   *
   * Was a hard-coded literal in `lib/mock-data.ts` that rendered in LIVE mode,
   * which made the club's own name the one thing about it nobody could change.
   */
  clubName?: string;
  clubDescription?: string;
  /**
   * The club's Discord invite, e.g. `https://discord.gg/abc123`.
   *
   * Editable rather than hard-coded because an invite link is not permanent by
   * nature: Discord's default expires in seven days, and anyone with Manage
   * Server can revoke one. A constant means the day it dies is a deploy, and
   * until then every new member follows a dead link from the page whose whole
   * job is getting them set up.
   *
   * Validated to Discord's own invite hosts in the operation AND by a CHECK in
   * migration 0030 — it renders as a link in a banner shown to every member,
   * so a pasted phishing URL is the failure worth designing against.
   */
  discordInviteUrl?: string;
  coreHours: number;
  committedHours: number;
  contributingHours: number;
  /** The floor the club calls "meeting the minimum" — the low end of 10–12. */
  minimumHours: number;
  updatedAt?: string;
  updatedBy?: string;
}

// ---------------------------------------------------------------------------
// Checklists under a deliverable
// ---------------------------------------------------------------------------

/**
 * One tickable item on a deliverable. NOT a sub-task.
 *
 * The deliverable is still the whole task model — one owner, one date, no
 * dependencies. A todo is deliberately none of those things: no owner, no due
 * date, no credit, and it never appears in any count.
 *
 * It exists because "move the parts from Trudy's office" was being entered as a
 * DELIVERABLE, since that was the only place to put a thing that needed doing.
 * But deliverables feed the Delivered signal — the one contribution measure
 * that can't be inflated — and a fifteen-minute errand sitting beside a spar
 * redesign makes that number mean nothing.
 *
 * What a todo does carry is a gate: `confirmDeliverable` refuses while any are
 * open. That's what makes writing them down worth the keystrokes instead of
 * being a second list nobody maintains.
 *
 * **If you want to give one an owner or a date, it isn't a todo.** It's a
 * deliverable, and it should be one.
 */
export interface DeliverableTodo {
  id: string;
  deliverableId: string;
  title: string;
  done: boolean;
  /** Set iff `done`. Answers "who said this was handled?", not who gets credit. */
  doneAt?: string;
  doneBy?: string;
  sortOrder: number;
  createdBy?: string;
}

/**
 * An advisor named on a specific project.
 *
 * An advisor can already see and comment on everything in the club; this is the
 * narrower question of who a given project should ASK. A faculty advisor who
 * oversees Aerostructures remains available to Avionics, but only
 * Aerostructures lists them under "Who to ask".
 *
 * NOT a `project_role` on `ProjectMembership`, deliberately. Membership drives
 * staffing — the committed count, /find-work's unstaffed-first ordering, the
 * roster figures — and a professor is not staff. A separate row cannot leak
 * into a number that nothing asked it to be part of.
 */
export interface ProjectAdvisor {
  projectId: string;
  memberId: string;
  /** Which RE named them. Same reason `ProjectMembership.addedBy` exists. */
  addedBy?: string;
  addedAt: string;
}

// ---------------------------------------------------------------------------
// Asking a Lead for something
// ---------------------------------------------------------------------------

export type MemberRequestStatus = "pending" | "granted" | "declined";

/**
 * A member asks ONE named Lead for something. Free-form.
 *
 * The catch-all for everything the trainings catalogue deliberately doesn't
 * model: the Fusion team drive, an Onshape seat, the GitHub org, a key to the
 * cabinet. The line between the two is whether it needs TRAINING — a laser
 * cutter does and is a `CatalogueItem`; a shared drive doesn't and is this.
 *
 * Addressed to one person and never fanned out. A request everybody can see is
 * a request nobody owns, which is the bystander effect `blockerAudience`
 * already avoids for blockers. The member chooses by opening that person's
 * profile, which is also how the app avoids having to know who owns what.
 */
export interface MemberRequest {
  id: string;
  /** Who asked. */
  memberId: string;
  /** Who they asked. Always somebody in leadership — see `can.requestFromLead`. */
  leadId: string;
  body: string;
  status: MemberRequestStatus;
  /** The answer. Required on a decline: "no" with no reason stops people asking. */
  response?: string;
  respondedBy?: string;
  respondedAt?: string;
  createdAt: string;
}
