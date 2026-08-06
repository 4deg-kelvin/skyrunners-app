/**
 * ============================================================================
 * ENGAGEMENT SCORING
 * ============================================================================
 *
 * Philosophy, agreed with Anish:
 *
 *   "It's a flashlight, not a scoreboard."
 *
 * The score exists to help a Lead notice who to talk to — someone quietly
 * carrying a lot, or someone drifting. It is NOT an automatic ranking, and it
 * is visible only to leadership.
 *
 * Two rules follow from that, and they drove every weight below:
 *
 *   1. DELIVERED OUTCOMES OUTWEIGH TIME SPENT. Hours logged is the easiest
 *      signal to game and the weakest proxy for contribution. It gets the
 *      smallest weight of anything we measure.
 *
 *   2. RELIABILITY IS THE STRONGEST SIGNAL. Whether someone submits their
 *      updates on time predicts dependability better than any volume metric,
 *      and it's nearly impossible to fake without actually doing the thing.
 */

// ---------------------------------------------------------------------------
// Recommended weights
// ---------------------------------------------------------------------------

export interface EngagementWeights {
  updateReliability: number;
  taskCompletion: number;
  reResponsibility: number;
  eventAttendance: number;
  hoursLogged: number;
  /** Cross-division work. Zero by default — Anish's call: a member's own choice. */
  breadth: number;
}

/**
 * My recommendation. Sums to 1.0. Co-Leads can retune these in the UI, and
 * every change is versioned so old scores stay interpretable.
 *
 *   30%  Update reliability   — best predictor of dependability, hardest to fake
 *   25%  Task completion      — delivered outcomes, the thing that matters
 *   20%  RE responsibility    — carrying accountability IS contribution,
 *                               scaled by how large the project is
 *   15%  Event attendance     — weighted by each event's importance, so a
 *                               design review counts far more than a social
 *   10%  Hours logged         — deliberately lowest, with diminishing returns
 *    0%  Breadth              — not rewarded; working across divisions is a
 *                               member's own choice, not an obligation
 */
export const RECOMMENDED_WEIGHTS: EngagementWeights = {
  updateReliability: 0.3,
  taskCompletion: 0.25,
  reResponsibility: 0.2,
  eventAttendance: 0.15,
  hoursLogged: 0.1,
  breadth: 0,
};

/**
 * Hours per week that earns full credit on the hours component.
 * Above this, extra hours add nothing — someone living in the lab shouldn't
 * outrank someone efficient, and we don't want to reward performing busyness.
 */
export const HOURS_FULL_CREDIT_PER_WEEK = 8;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface EngagementInputs {
  weeksInPeriod: number;

  updatesDue: number;
  updatesOnTime: number;
  updatesLate: number;

  tasksAssigned: number;
  tasksCompleted: number;

  /** Per project where they're an RE: 1 (small), 2 (medium), 3 (large). */
  reProjectSizeFactors: number[];

  eventsInvited: number;
  /** Sum of importanceWeight for events actually attended. */
  attendedImportanceSum: number;
  /** Sum of importanceWeight for events they were invited to. */
  invitedImportanceSum: number;

  hoursTotal: number;

  divisionsContributedTo: number;
}

export interface EngagementBreakdown {
  updateReliability: number;
  taskCompletion: number;
  reResponsibility: number;
  eventAttendance: number;
  hoursLogged: number;
  breadth: number;
  /** Weighted total, 0-100. */
  score: number;
}

// ---------------------------------------------------------------------------
// Component scores — each returns 0 to 1
// ---------------------------------------------------------------------------

/** Late still counts, at half credit. Late beats absent. */
function updateReliabilityScore(i: EngagementInputs): number {
  if (i.updatesDue === 0) return 1;
  return clamp01((i.updatesOnTime + i.updatesLate * 0.5) / i.updatesDue);
}

function taskCompletionScore(i: EngagementInputs): number {
  if (i.tasksAssigned === 0) return 0;
  return clamp01(i.tasksCompleted / i.tasksAssigned);
}

/**
 * Being an RE is real work, and more so on a bigger project. Three REs on
 * medium projects reaches full credit; we don't want to endlessly reward
 * title collection over doing the job well.
 */
function reResponsibilityScore(i: EngagementInputs): number {
  const total = i.reProjectSizeFactors.reduce((a, b) => a + b, 0);
  return clamp01(total / 6);
}

/** Importance-weighted, so skipping a design review costs more than a social. */
function eventAttendanceScore(i: EngagementInputs): number {
  if (i.invitedImportanceSum === 0) return 1;
  return clamp01(i.attendedImportanceSum / i.invitedImportanceSum);
}

/**
 * Square root gives diminishing returns: doubling your hours does not double
 * your score. Capped at full credit, so there's no incentive to inflate.
 */
function hoursScore(i: EngagementInputs): number {
  if (i.weeksInPeriod <= 0) return 0;
  const perWeek = i.hoursTotal / i.weeksInPeriod;
  return clamp01(Math.sqrt(perWeek / HOURS_FULL_CREDIT_PER_WEEK));
}

function breadthScore(i: EngagementInputs): number {
  return clamp01((i.divisionsContributedTo - 1) / 2);
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

export function computeEngagement(
  inputs: EngagementInputs,
  weights: EngagementWeights = RECOMMENDED_WEIGHTS
): EngagementBreakdown {
  const components = {
    updateReliability: updateReliabilityScore(inputs),
    taskCompletion: taskCompletionScore(inputs),
    reResponsibility: reResponsibilityScore(inputs),
    eventAttendance: eventAttendanceScore(inputs),
    hoursLogged: hoursScore(inputs),
    breadth: breadthScore(inputs),
  };

  const weightSum =
    weights.updateReliability +
    weights.taskCompletion +
    weights.reResponsibility +
    weights.eventAttendance +
    weights.hoursLogged +
    weights.breadth;

  const weighted =
    components.updateReliability * weights.updateReliability +
    components.taskCompletion * weights.taskCompletion +
    components.reResponsibility * weights.reResponsibility +
    components.eventAttendance * weights.eventAttendance +
    components.hoursLogged * weights.hoursLogged +
    components.breadth * weights.breadth;

  // Normalize by the actual weight sum so a Co-Lead's custom weights don't
  // have to add to exactly 1.0 for the score to stay on a 0-100 scale.
  const score = weightSum > 0 ? (weighted / weightSum) * 100 : 0;

  return { ...components, score: Math.round(score) };
}

/**
 * Size bucket for the RE component. Bigger subtree and more people = more
 * coordination load.
 */
export function projectSizeFactor(
  descendantProjectCount: number,
  activeMemberCount: number
): number {
  const magnitude = descendantProjectCount + activeMemberCount;
  if (magnitude >= 10) return 3;
  if (magnitude >= 4) return 2;
  return 1;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Deliberately NOT provided: a "rank all members" function.
 *
 * The data supports it, and it would be three lines. It's omitted because the
 * moment a leaderboard exists in the UI, the score stops being a diagnostic
 * and becomes a target — which is the failure mode we agreed to design
 * against. Leadership sees individual scores in context, next to the
 * member's projects and updates, where the number can be interpreted rather
 * than just compared.
 */
