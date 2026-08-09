/**
 * ============================================================================
 * CONTRIBUTION RECORD
 * ============================================================================
 *
 * This replaces the old composite "engagement score". Anish's framing:
 *
 *   "We don't really need to see a score. We just need to see that members are
 *    being dedicated, and that they know their efforts are being tracked and
 *    not wasted."
 *
 * That's a better instinct than the score was, and it changes the design:
 *
 *   A single number invites optimization. Four honest columns invite judgment.
 *
 * So there is deliberately NO composite score anywhere in this file. Leadership
 * sees four independent signals and forms a view. Members see their own, with
 * the expectations stated plainly, because "efforts are tracked and not wasted"
 * only lands if the member can actually see the tracking.
 *
 * ----------------------------------------------------------------------------
 * The four signals
 * ----------------------------------------------------------------------------
 *
 *   1. DELIVERED    — deliverables and projects completed.   ← the primary one
 *   2. COMMITMENT   — hours against the 12 hr/week expectation, as a tier
 *   3. RELIABILITY  — updates submitted on time
 *   4. SCOPE        — RE roles held. Reported, never blended in.
 *
 * DELIVERED is primary on purpose. Hours are the easiest signal to inflate and
 * the weakest evidence of contribution: someone can sit in the lab for twelve
 * hours and ship nothing. Finished work can't be faked. When the two disagree,
 * trust what shipped.
 *
 * SCOPE is reported separately rather than scored because it requires having
 * already been appointed. Blending it in would mean a metric used to pick future
 * leaders substantially measured having already been picked — which is how
 * leadership becomes a clique in a club with annual turnover.
 */

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

/**
 * The club's stated expectation: 10-12 hrs/week, preferably more.
 *
 * A real note on this number: 12 hrs/week on top of a Stanford course load is
 * roughly a part-time job. Serious teams do run this way (Formula SAE, Solar
 * Car) and it produces excellent results — but it works by SELF-SELECTION, not
 * by enforcement. It has to be stated at recruiting, not discovered in week six.
 *
 * Two consequences worth holding in mind:
 *   - This bar will shrink the club toward its committed core. That may be
 *     exactly what "high class team" means — but it is a different goal from
 *     "stop people quitting", and the two can pull against each other.
 *   - Below-bar members must read as a TIER, not as failing. Someone at 6
 *     hrs/week during midterms is a Contributor, not a delinquent. Tiers keep
 *     them in the club; a red X pushes them out of it.
 */
export const WEEKLY_HOURS_EXPECTATION = 12;
export const WEEKLY_HOURS_MINIMUM = 10;

/**
 * Named tiers rather than a percentage.
 *
 * "You're a Contributor at 6.5 hrs/week; Core is 12+" gives someone a rung to
 * climb. "You scored 54" gives them a verdict.
 */
export type CommitmentTier =
  "core" | "committed" | "contributing" | "light" | "paused";

export const TIER_LABELS: Record<CommitmentTier, string> = {
  core: "Core",
  committed: "Committed",
  contributing: "Contributing",
  light: "Getting started",
  paused: "On academic pause",
};

export const TIER_DESCRIPTIONS: Record<CommitmentTier, string> = {
  core: "12+ hrs/week — meeting the team's full expectation",
  committed: "8–12 hrs/week — close to the bar",
  contributing: "4–8 hrs/week — contributing, room to grow",
  light: "Under 4 hrs/week — just getting started, or stretched thin",
  paused: "Paused for academics. Nothing counted, nothing owed.",
};

export const TIER_THRESHOLDS: {
  tier: CommitmentTier;
  minHoursPerWeek: number;
}[] = [
  { tier: "core", minHoursPerWeek: 12 },
  { tier: "committed", minHoursPerWeek: 8 },
  { tier: "contributing", minHoursPerWeek: 4 },
  { tier: "light", minHoursPerWeek: 0 },
];

export function commitmentTier(
  hoursPerWeek: number,
  isPaused = false
): CommitmentTier {
  if (isPaused) return "paused";
  for (const { tier, minHoursPerWeek } of TIER_THRESHOLDS) {
    if (hoursPerWeek >= minHoursPerWeek) return tier;
  }
  return "light";
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ContributionInputs {
  /** In-session weeks only. Finals and breaks are excluded upstream. */
  activeWeeks: number;
  isPaused: boolean;

  deliverablesCompleted: number;
  deliverablesOpen: number;
  /** Open, past their due date. */
  deliverablesOverdue: number;
  /** Projects that reached `complete` while this member held a deliverable. */
  projectsCompleted: number;

  hoursTotal: number;

  updatesDue: number;
  updatesOnTime: number;
  updatesLate: number;

  reRoleCount: number;
  projectsCommitted: number;
}

// ---------------------------------------------------------------------------
// Output — four signals, no composite
// ---------------------------------------------------------------------------

export interface Delivered {
  deliverablesCompleted: number;
  projectsCompleted: number;
  open: number;
  overdue: number;
  /** null when nothing has been assigned — not a zero the member earned. */
  completionRate: number | null;
}

export interface Commitment {
  hoursTotal: number;
  hoursPerWeek: number;
  tier: CommitmentTier;
  /** Hours per week still needed to reach Core. 0 if already there. */
  hoursToCore: number;
  meetsMinimum: boolean;
}

export interface Reliability {
  /** null when nothing was due — during a pause, or for a new member. */
  onTimeRate: number | null;
  onTime: number;
  late: number;
  missed: number;
}

export interface Scope {
  reRoleCount: number;
  projectsCommitted: number;
}

export interface ContributionRecord {
  delivered: Delivered;
  commitment: Commitment;
  reliability: Reliability;
  scope: Scope;
}

export function buildContributionRecord(
  i: ContributionInputs
): ContributionRecord {
  const assigned = i.deliverablesCompleted + i.deliverablesOpen;
  const hoursPerWeek = i.activeWeeks > 0 ? i.hoursTotal / i.activeWeeks : 0;
  const tier = commitmentTier(hoursPerWeek, i.isPaused);
  const missed = Math.max(0, i.updatesDue - i.updatesOnTime - i.updatesLate);

  return {
    delivered: {
      deliverablesCompleted: i.deliverablesCompleted,
      projectsCompleted: i.projectsCompleted,
      open: i.deliverablesOpen,
      overdue: i.deliverablesOverdue,
      completionRate: assigned > 0 ? i.deliverablesCompleted / assigned : null,
    },
    commitment: {
      hoursTotal: i.hoursTotal,
      hoursPerWeek: Math.round(hoursPerWeek * 10) / 10,
      tier,
      hoursToCore: Math.max(
        0,
        Math.round((WEEKLY_HOURS_EXPECTATION - hoursPerWeek) * 10) / 10
      ),
      meetsMinimum: hoursPerWeek >= WEEKLY_HOURS_MINIMUM,
    },
    reliability: {
      onTimeRate: i.updatesDue > 0 ? i.updatesOnTime / i.updatesDue : null,
      onTime: i.updatesOnTime,
      late: i.updatesLate,
      missed,
    },
    scope: {
      reRoleCount: i.reRoleCount,
      projectsCommitted: i.projectsCommitted,
    },
  };
}

// ---------------------------------------------------------------------------
// Leadership selection
// ---------------------------------------------------------------------------

/**
 * The published rubric for who's ready to lead.
 *
 * This exists as text in the codebase because it has to be published to
 * members. A rubric that decides advancement but stays hidden is a performance
 * review with a concealed scale — and when it leaks, the trust cost is
 * retroactive: it recolors every update the person ever wrote.
 *
 * Ordered. Earlier criteria dominate.
 */
export const LEADERSHIP_RUBRIC = [
  {
    signal: "Delivered",
    what: "Deliverables finished and projects carried to completion",
    why: "Finished work is the only signal that can't be faked. This dominates everything below it.",
  },
  {
    signal: "Sustained commitment",
    what: "Core or Committed tier held across a full quarter, not one heroic week",
    why: "Leading requires showing up in week eight, not just week one.",
  },
  {
    signal: "Reliability",
    what: "Updates in on time; blockers raised early rather than discovered late",
    why: "A lead others depend on has to be predictable.",
  },
  {
    signal: "Lifting others",
    what: "Answering blockers, reviewing work, onboarding new members",
    why: "The job is making other people effective, which is different from being effective yourself.",
  },
] as const;

/**
 * Deliberately NOT provided: any function that ranks members against each other.
 *
 * The data supports it and it would be a few lines. It's absent because the
 * moment a ranking exists in the UI, these four signals stop being a description
 * of someone's work and become a target to optimize. Leadership reads the four
 * columns next to a member's actual projects, where the numbers can be
 * interpreted rather than merely compared.
 */
