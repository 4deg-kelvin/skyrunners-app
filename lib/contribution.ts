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
 *   A single number invites optimization. A few honest columns invite judgment.
 *
 * So there is deliberately NO composite score anywhere in this file. Leadership
 * sees three independent signals and forms a view. Members see their own, with
 * the expectations stated plainly, because "efforts are tracked and not wasted"
 * only lands if the member can actually see the tracking.
 *
 * ----------------------------------------------------------------------------
 * The three signals
 * ----------------------------------------------------------------------------
 *
 *   1. DELIVERED    — deliverables and projects completed.   ← the primary one
 *   2. RELIABILITY  — updates submitted on time
 *   3. SCOPE        — RE roles held. Reported, never blended in.
 *
 * DELIVERED is primary on purpose. Finished work can't be faked.
 *
 * SCOPE is reported separately rather than scored because it requires having
 * already been appointed. Blending it in would mean a metric used to pick future
 * leaders substantially measured having already been picked — which is how
 * leadership becomes a clique in a club with annual turnover.
 *
 * ----------------------------------------------------------------------------
 * There used to be a fourth: COMMITMENT, hours against a weekly expectation,
 * expressed as a Core / Committed / Contributing tier. It is gone.
 * ----------------------------------------------------------------------------
 *
 * The club decided on 2026-08-14 that **hours are not the measure; deliverables
 * are.** Two reasons it went rather than being merely de-emphasised:
 *
 *   1. It measured the wrong thing, and said so in its own comments: "someone
 *      can sit in the lab for twelve hours and ship nothing." A signal the code
 *      itself describes as weak evidence, printed on every member's profile
 *      beside one that can't be faked, mostly teaches people to log hours.
 *
 *   2. It could not be left half-removed. The tier was hours ÷ in-session weeks
 *      since joining — a ROLLING average. Stop collecting hours but keep the
 *      ladder and every member's tier decays toward the bottom rung over the
 *      following weeks, on their own profile and in the published rubric, with
 *      no new data causing it. The app would have spent a month telling people
 *      their commitment was collapsing because a feature was half-gone.
 *
 * So work logs still exist, but as a **diary** — what you did, on each project,
 * day by day — not a timesheet. `WorkLog` carries no `hours` field at all now,
 * which is what stops this signal being quietly reconstructed later. The diary
 * feeds the check-in composer (`lib/data/my-work.ts` pre-fills each project's
 * section from it) rather than feeding a number.
 *
 * **Don't add a fourth signal built on volume of anything** — days logged,
 * entries written, sessions attended. Each is the same mistake in a new unit,
 * and each is inflatable in the same way. See `docs/HOURS_REMOVAL_PLAN.md`.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ContributionInputs {
  deliverablesCompleted: number;
  deliverablesOpen: number;
  /** Open, past their due date. */
  deliverablesOverdue: number;
  /**
   * Completed projects this member was COMMITTED to.
   *
   * Not "held a signed-off deliverable on", which was the old rule and scored
   * zero for the RE of a project they carried to the finish. Following doesn't
   * count and membership is RE-controlled, so it can't be self-inflated.
   */
  projectsCompleted: number;

  /**
   * Check-ins whose moment has PASSED. A pending one that isn't late yet is
   * not due — counting it dropped reliability before the member had a chance
   * to write anything.
   */
  updatesDue: number;
  updatesOnTime: number;
  updatesLate: number;

  reRoleCount: number;
  projectsCommitted: number;
}

// ---------------------------------------------------------------------------
// Output — three signals, no composite
// ---------------------------------------------------------------------------

export interface Delivered {
  deliverablesCompleted: number;
  projectsCompleted: number;
  open: number;
  overdue: number;
  /** null when nothing has been assigned — not a zero the member earned. */
  completionRate: number | null;
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
  reliability: Reliability;
  scope: Scope;
}

export function buildContributionRecord(
  i: ContributionInputs
): ContributionRecord {
  const assigned = i.deliverablesCompleted + i.deliverablesOpen;
  const missed = Math.max(0, i.updatesDue - i.updatesOnTime - i.updatesLate);

  return {
    delivered: {
      deliverablesCompleted: i.deliverablesCompleted,
      projectsCompleted: i.projectsCompleted,
      open: i.deliverablesOpen,
      overdue: i.deliverablesOverdue,
      completionRate: assigned > 0 ? i.deliverablesCompleted / assigned : null,
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
  /*
    This row used to read "Core or Committed tier held across a full quarter" —
    a tier that no longer exists, computed from hours the club no longer
    collects. It could not simply be deleted: "sustained" is the criterion the
    other three don't cover, and dropping it would let one heroic week read the
    same as a quarter of steady work.

    So it is restated against something the app still records and a member can
    still see: deliverables finished in MORE THAN ONE period, and check-ins that
    kept arriving late in the quarter. Both are facts about spread over time
    rather than volume — which is the half of the old tier worth keeping, minus
    the hours.
  */
  {
    signal: "Sustained over a quarter",
    what: "Work finished in several different weeks, and check-ins still arriving in week eight",
    why: "Leading requires showing up late in the quarter, not just at the start. Spread over time is the part one heroic week can't fake.",
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
