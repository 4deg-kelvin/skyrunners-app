/**
 * Which projects have gone quiet. A pure module, called from the dashboard and
 * the daily digest so the two can't disagree.
 *
 * ---------------------------------------------------------------------------
 * Why this exists, and why it is about PROJECTS
 * ---------------------------------------------------------------------------
 *
 * "Gone quiet" was a person-shaped signal until 2026-08-24: nothing logged this
 * week while still holding open work, rendered on the dashboard of the Lead they
 * reported to. It went with the reporting chain, and it is the one thing in that
 * removal that took something real away rather than a second way of doing
 * something.
 *
 * The chain's actual function was that somebody was NAMED as responsible for
 * noticing. Losing people quietly is what this club loses people to — not to a
 * lack of reporting — so "the RE reads their project's feed" is lighter by
 * design but only works if something surfaces silence.
 *
 * So it comes back re-scoped to the project, which is the shape that has an
 * owner now: a project has REs, RE authority inherits down the tree, and a
 * Division Lead is a top RE. Every quiet project has somebody it is addressed
 * to, which is exactly what the old flag had and what a bare feed does not.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT here
 * ---------------------------------------------------------------------------
 *
 * **No per-person breakdown.** It would be trivial — the work logs carry
 * `memberId` — and it would rebuild the thing the club removed: a list of names
 * ranked by how recently each showed up. The unit is the project. If an RE wants
 * to know who has been quiet on it, they open the project and read the feed,
 * where the answer sits next to what the work actually is.
 *
 * **No count of entries.** Silence is a date, not a volume. "Three entries this
 * week" invites more logging rather than more work, which is the trap named in
 * `lib/delivered.ts`.
 */

import type { Deliverable, Project, ProjectMembership, WorkLog } from "./types";

/**
 * How long silence has to last before it means anything.
 *
 * Three weeks, and the number is doing real work. A volunteer team's week
 * swings with midterms: one quiet week is normal, two is a bad fortnight, three
 * is somebody who has drifted off and usually does not come back on their own.
 * Shorter and the flag fires constantly during finals, which teaches an RE to
 * skip the section — the failure mode every "0 items" panel on this dashboard
 * was designed around.
 */
export const QUIET_AFTER_DAYS = 21;

/**
 * A project's grace period before silence counts.
 *
 * A project created on Monday with a deliverable and nobody having logged
 * anything yet is not quiet, it is new. Without this, every project would be
 * born flagged, and the first thing an RE would learn is that the flag is wrong.
 */
const NEW_PROJECT_GRACE_DAYS = QUIET_AFTER_DAYS;

export interface QuietProject {
  project: Project;
  /**
   * The most recent workDate anybody logged against it, or undefined if nobody
   * ever has.
   *
   * `YYYY-MM-DD`, compared as a string. See `lib/dates.ts` for why: the club
   * runs on Pacific time and Vercel runs on UTC, so building `Date`s to compare
   * two calendar dates rolls over at 5pm California time.
   */
  lastLoggedAt?: string;
  /** Days since `lastLoggedAt`. Undefined when nothing was ever logged. */
  daysSince?: number;
  /** Committed members. Following doesn't count — watching isn't working. */
  committedCount: number;
  /** Open deliverables on it, which is what makes silence worth raising. */
  openDeliverables: number;
}

/** Whole days between two `YYYY-MM-DD` dates. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Projects among `projectIds` where nobody has logged anything in three weeks.
 *
 * Worst first — never-logged before merely-stale, because a project with open
 * work and no history at all is the one nobody ever started.
 */
export function quietProjects(
  projects: Project[],
  projectIds: string[],
  memberships: ProjectMembership[],
  workLogs: WorkLog[],
  deliverables: Deliverable[],
  today: string
): QuietProject[] {
  const scope = new Set(projectIds);
  const out: QuietProject[] = [];

  for (const project of projects) {
    if (!scope.has(project.id)) continue;
    // A finished project is supposed to be silent. Flagging one would tell an
    // RE their completed work needs attention.
    if (project.phase === "complete") continue;

    const openDeliverables = deliverables.filter(
      (d) =>
        d.projectId === project.id &&
        d.status !== "done" &&
        d.status !== "submitted"
    ).length;
    const committedCount = memberships.filter(
      (m) => m.projectId === project.id && m.commitment === "committed"
    ).length;

    /*
      Nothing at stake, nothing to raise.

      An unstaffed project with no open work is not quiet, it is dormant or
      finished-but-unmarked, and `/find-work` already ranks unstaffed projects
      first — which is the right place for it, because the action there is
      "somebody join this" rather than "an RE chase somebody".
    */
    if (openDeliverables === 0 && committedCount === 0) continue;

    const dates = workLogs
      .filter((w) => w.projectId === project.id)
      .map((w) => w.workDate.slice(0, 10))
      .sort();
    const lastLoggedAt = dates.at(-1);

    if (lastLoggedAt) {
      const daysSince = daysBetween(lastLoggedAt, today);
      if (daysSince < QUIET_AFTER_DAYS) continue;
      out.push({
        project,
        lastLoggedAt,
        daysSince,
        committedCount,
        openDeliverables,
      });
      continue;
    }

    /*
      Never logged. Only counts once the project has had time to get going, and
      `startDate` is the clock rather than a creation timestamp — a project
      entered in advance for next quarter should not be flagged the day it is
      created. An undated project falls back to being flagged, because an
      undated project with open work and no activity is the exact shell the
      994-project incident produced.
    */
    if (
      project.startDate &&
      daysBetween(project.startDate, today) < NEW_PROJECT_GRACE_DAYS
    ) {
      continue;
    }

    out.push({ project, committedCount, openDeliverables });
  }

  return out.sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999));
}
