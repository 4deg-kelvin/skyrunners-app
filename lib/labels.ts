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
  EventKind,
  GlobalRole,
  ProjectHealth,
  ProjectPhase,
  ProjectRole,
  TrainingCategory,
  TrainingStatus,
  UpdateStatus,
} from "./types";
import type { BadgeTone } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<GlobalRole, string> = {
  member: "Member",
  lead: "Team Lead",
  co_lead: "Co-Lead",
};

export const ROLE_TONES: Record<GlobalRole, BadgeTone> = {
  member: "neutral",
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

/** Events at or above this weight are called out as significant. */
export const KEY_EVENT_WEIGHT = 4;

// ---------------------------------------------------------------------------
// Trainings
// ---------------------------------------------------------------------------

export const TRAINING_CATEGORY_LABELS: Record<TrainingCategory, string> = {
  machine_shop: "Machine Shop",
  lab_equipment: "Lab Equipment",
  safety: "Safety",
  software: "Software",
  online_course: "Online Course",
  flight: "Flight",
};

export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  requested: "Awaiting verification",
  verified: "Verified",
  expired: "Expired",
  rejected: "Not approved",
};

export const TRAINING_STATUS_TONES: Record<TrainingStatus, BadgeTone> = {
  requested: "warn",
  verified: "ok",
  expired: "risk",
  rejected: "neutral",
};
