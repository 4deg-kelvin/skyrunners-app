/**
 * Display strings and badge tones — the single home for anything user-facing.
 *
 * `types.ts` holds domain *types*; this file holds how they're *shown*. Keeping
 * them apart means renaming a label never touches domain code, and no page ever
 * defines its own copy of a status map.
 *
 * If you find yourself writing `const healthLabel = {...}` in a page, it belongs
 * here instead.
 */

import type {
  ArtifactKind,
  AttentionReason,
  DeliverableStatus,
  EventKind,
  GlobalRole,
  ProjectHealth,
  ProjectPhase,
  ProjectRole,
  CertificationStatus,
  TermKind,
  UpdateStatus,
} from "./types";
import type { BadgeTone } from "@/components/ui/badge";
import type { CalendarClient } from "./calendar/feed-token";

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<GlobalRole, string> = {
  member: "Member",
  advisor: "Advisor",
  lead: "Team Lead",
  co_lead: "Co-Lead",
};

/**
 * Cardinal marks authority. An advisor has none, so they get a neutral badge.
 *
 * It still shows — an advisor's badge is the useful one on a roster, because
 * it's the answer to "why does this person have no projects". A member with no
 * badge reads as a member who hasn't been given anything yet; an advisor with
 * no badge reads as broken data.
 */
export const ROLE_TONES: Record<GlobalRole, BadgeTone> = {
  member: "neutral",
  advisor: "neutral",
  lead: "cardinal",
  co_lead: "cardinal",
};

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  re: "Responsible Engineer",
  contributor: "Contributor",
  observer: "Observer",
};

// ---------------------------------------------------------------------------
// Project phase — where in the lifecycle
// ---------------------------------------------------------------------------

export const PHASE_LABELS: Record<ProjectPhase, string> = {
  concept: "Concept",
  requirements: "Requirements",
  preliminary_design: "Preliminary Design",
  detailed_design: "Detailed Design",
  manufacturing: "Manufacturing",
  integration: "Integration",
  testing: "Testing",
  flight_test: "Flight Test",
  complete: "Complete",
};

/** Ordered, for progress indicators and sorting. */
export const PHASE_ORDER: ProjectPhase[] = [
  "concept",
  "requirements",
  "preliminary_design",
  "detailed_design",
  "manufacturing",
  "integration",
  "testing",
  "flight_test",
  "complete",
];

// ---------------------------------------------------------------------------
// Project health — how it's going. Deliberately separate from phase.
// ---------------------------------------------------------------------------

export const HEALTH_LABELS: Record<ProjectHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
  complete: "Complete",
};

export const HEALTH_TONES: Record<ProjectHealth, BadgeTone> = {
  on_track: "ok",
  at_risk: "warn",
  blocked: "risk",
  complete: "neutral",
};

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export const UPDATE_STATUS_LABELS: Record<UpdateStatus, string> = {
  pending: "Not submitted",
  submitted: "Submitted",
  late: "Late",
  missed: "Missed",
  reviewed: "Reviewed",
};

export const UPDATE_STATUS_TONES: Record<UpdateStatus, BadgeTone> = {
  pending: "warn",
  submitted: "ok",
  late: "warn",
  missed: "risk",
  reviewed: "neutral",
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  design_review: "Design Review",
  company_tour: "Company Tour",
  company_visit: "Company Visit",
  build_session: "Build Session",
  general_meeting: "Meeting",
  training: "Training",
  social: "Social",
  competition: "Competition",
  one_on_one: "1:1",
};

/**
 * Every valid event kind, DERIVED rather than listed.
 *
 * There were three copies of this list — the `EventKind` union in `lib/types.ts`,
 * the keys above, and a hand-written array in `lib/actions/index.ts` — and the MCP
 * server then invented a fourth with `meeting`, `review` and `other` in it. None
 * of those three exist, so `create_event` wrote an unrenderable kind into the
 * store and the label lookup came back `undefined`. Exactly the failure named in
 * CLAUDE.md: an enum mismatch doesn't throw, it just stops meaning anything.
 *
 * `EVENT_KIND_LABELS` is typed `Record<EventKind, string>`, so the compiler
 * guarantees these keys ARE the union — no copy to keep in step.
 */
export const EVENT_KINDS = Object.keys(EVENT_KIND_LABELS) as EventKind[];

/** Narrow an untrusted string, falling back to the harmless default. */
export function eventKindOrDefault(raw: string): EventKind {
  return (EVENT_KINDS as readonly string[]).includes(raw)
    ? (raw as EventKind)
    : "build_session";
}

/** Events at or above this weight are called out as significant. */
export const KEY_EVENT_WEIGHT = 4;

// ---------------------------------------------------------------------------
// Trainings
// ---------------------------------------------------------------------------

/**
 * No category labels here on purpose.
 *
 * Sections ("Robotics Room", "Lab 64") are ROWS in `training_sections`, not a
 * union type — a Co-Lead adds a site from the UI and it appears for everyone.
 * A label map keyed by category would have to be edited and deployed every
 * time, which is precisely the coupling the data-driven catalogue removes.
 * Render `section.name` straight through.
 */

export const CERTIFICATION_STATUS_LABELS: Record<CertificationStatus, string> =
  {
    requested: "Awaiting verification",
    verified: "Verified",
    expired: "Expired",
    rejected: "Not approved",
  };

export const CERTIFICATION_STATUS_TONES: Record<
  CertificationStatus,
  BadgeTone
> = {
  requested: "warn",
  verified: "ok",
  // Red, not grey. An expired clearance that reads as merely "inactive" is how
  // somebody ends up on a machine they're no longer cleared for.
  expired: "risk",
  rejected: "neutral",
};

/** Site access versus machine clearance — the only enum in this feature. */
export const CATALOGUE_KIND_LABELS = {
  site_access: "Site access",
  machine: "Machine training",
} as const;

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  open: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  // Says who it's waiting on, not just that it's waiting. "Submitted" would
  // read to the owner as "I'm finished" — they are, but the RE isn't, and the
  // whole point of the extra step is that the difference is visible.
  submitted: "Awaiting RE sign-off",
  done: "Done",
};

export const DELIVERABLE_STATUS_TONES: Record<DeliverableStatus, BadgeTone> = {
  open: "neutral",
  in_progress: "warn",
  blocked: "risk",
  // Deliberately not "ok" — it isn't delivered yet, and a green badge here
  // would make the sign-off step feel decorative.
  submitted: "cardinal",
  done: "ok",
};

/*
  `TIER_TONES` lived here — badge tones for the Core / Committed / Contributing
  commitment tiers. The tiers were removed on 2026-08-14 (hours are not the
  measure; deliverables are), so the tones went with them.

  Nothing replaced it. If you find yourself adding a per-member badge tone map
  back into this file, read `lib/contribution.ts` first: the record is three
  signals and none of them is a rung a person sits on.
*/

// ---------------------------------------------------------------------------
// Project attention flags
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Calendar subscriptions
// ---------------------------------------------------------------------------

/**
 * What to call each calendar app in the UI.
 *
 * The keys are what `clientFromUserAgent` produces, and `other` is a real value
 * rather than a fallback: an unrecognised agent still proves a subscription
 * exists, which is the fact the badge reports. "Another calendar app" is honest
 * about what we know and reads better than the raw token.
 */
export const CALENDAR_CLIENT_LABELS: Record<CalendarClient, string> = {
  apple: "Apple Calendar",
  google: "Google Calendar",
  outlook: "Outlook",
  other: "Another calendar app",
};

// ---------------------------------------------------------------------------
// Project artifacts
// ---------------------------------------------------------------------------

export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  presentation: "Presentation",
  github: "Code",
  requirements: "Requirements",
  cad: "CAD",
  test_report: "Test report",
  analysis: "Analysis",
  drawing: "Drawing",
  doc: "Document",
  link: "Link",
};

/**
 * Grouping order for the artifacts list.
 *
 * Presentations and requirements first because those are what someone new to a
 * project reads to understand it — which is the main reason this list exists.
 */
export const ARTIFACT_KIND_ORDER: ArtifactKind[] = [
  "presentation",
  "requirements",
  "cad",
  "github",
  "analysis",
  "test_report",
  "drawing",
  "doc",
  "link",
];

// ---------------------------------------------------------------------------
// Weekdays
// ---------------------------------------------------------------------------

/** Index = day number, Sunday = 0, matching JS `Date.getDay()` and the DB. */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const WEEKDAY_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/**
 * Days offered for update deadlines. All seven.
 *
 * This used to be weekdays only, on the reasoning that a Saturday deadline
 * reads as "the club expects weekend work". That got it backwards for the
 * people it was meant to protect: a student whose week is packed with classes
 * and who actually builds on Sunday afternoon was being told to report on a day
 * they hadn't worked. The deadline follows the work; it doesn't create it.
 *
 * Monday first, weekend last — the order the week is planned in, and it keeps
 * Saturday and Sunday reading as a pair rather than splitting them across the
 * row the way a Sunday-first calendar would.
 */
export const SELECTABLE_UPDATE_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * Sort comparator putting days in week order rather than numeric order.
 *
 * Sunday is 0, so a plain `a - b` puts it first — "You'll submit on Sunday and
 * Saturday" for a weekend pair, which reads backwards. Storage stays numeric
 * (that's what the DB column holds); this is for anything a person reads.
 */
export function byWeekOrder(a: number, b: number): number {
  const order = SELECTABLE_UPDATE_DAYS as readonly number[];
  return order.indexOf(a) - order.indexOf(b);
}

// ---------------------------------------------------------------------------
// Academic calendar
// ---------------------------------------------------------------------------

export const TERM_KIND_LABELS: Record<TermKind, string> = {
  quarter: "Quarter",
  finals: "Finals week",
  break: "Break",
  summer: "Summer",
};

/** Only a quarter generates check-in obligations. Everything else is a pause. */
export const TERM_KIND_HINTS: Record<TermKind, string> = {
  quarter: "Check-ins run normally.",
  finals: "No check-ins, no nudges, and no missed rows.",
  break: "No check-ins, no nudges, and no missed rows.",
  summer: "No check-ins by default — override if a team is running.",
};

export const TERM_KIND_ORDER: TermKind[] = [
  "quarter",
  "finals",
  "break",
  "summer",
];

// ---------------------------------------------------------------------------
// Project attention flags
// ---------------------------------------------------------------------------

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  re_silent: "RE has gone quiet",
  blocker_stale: "Blocker unanswered",
  deliverables_overdue: "Deliverables overdue",
  health_flagged: "Flagged by its RE",
  past_target: "Past its target date",
};

// ---------------------------------------------------------------------------
// When the next check-in is due
// ---------------------------------------------------------------------------
