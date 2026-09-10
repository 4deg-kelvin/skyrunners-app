/**
 * ============================================================================
 * A milestone's stage is DERIVED, never stored
 * ============================================================================
 *
 * A milestone is a checkpoint with a date and no owner. A deliverable is a unit
 * of work with one owner, and its status is something that owner sets: they
 * start it, they flag it blocked, they mark it done. None of those verbs have a
 * subject on a milestone — there is nobody to start it and nobody to be blocked
 * — so the project page was offering "Start" and "I'm blocked" on rows where
 * the question does not apply, and every milestone sat on "Not started" for
 * ever because no owner existed to move it off.
 *
 * So the only thing anybody records about a milestone is that it was REACHED,
 * and everything else falls out of the dates:
 *
 *   reached   a PL signed it off. The one stored fact.
 *   awaiting  marked reached, waiting on a PL. Rare — usually the PL does both.
 *   overdue   its date has gone and it is not reached. Beats the two below,
 *             because a date that has passed is the actionable case.
 *   active    the earliest one not yet reached. The club's rule: work is
 *             heading for the next checkpoint, so that checkpoint is in
 *             progress by definition rather than by somebody saying so.
 *   waiting   every one after it.
 *
 * ---------------------------------------------------------------------------
 * Why derived and not stored
 * ---------------------------------------------------------------------------
 *
 * Storing it would need a write every time a milestone was reached, to move the
 * next one along — and a missed write leaves the chain wrong for ever with
 * nothing to notice it. Derived, it cannot drift: reach one and the next is
 * active on the next render, delete one and the chain closes up.
 *
 * This is NOT the computed schedule `docs/DECISIONS.md` rejects. Nothing here
 * produces a date, nothing reflows, and nothing blocks: it reads the dates that
 * exist and orders them. Delete every milestone and no date moves.
 */

import { compareDeliverableDueDates } from "./project-order.ts";
import type { Deliverable } from "./types.ts";

export type MilestoneStage =
  "reached" | "awaiting" | "overdue" | "active" | "waiting";

/**
 * Which stage a milestone is at, given the others on its project.
 *
 * `siblings` may be in any order and may include deliverables — they are
 * filtered out here, because a deliverable is not a checkpoint on the chain and
 * letting one sit in the sequence would make the "next checkpoint" depend on
 * how finely somebody split their work.
 */
export function milestoneStage(
  milestone: Deliverable,
  siblings: Deliverable[],
  today: string
): MilestoneStage {
  if (milestone.status === "done") return "reached";
  if (milestone.status === "submitted") return "awaiting";

  /*
    Overdue outranks position in the chain.

    A milestone three places down the list whose date has already gone is a
    fact worth acting on, and calling it "waiting" would bury it behind a chain
    that is evidently not being followed.
  */
  if (milestone.dueDate && milestone.dueDate < today) return "overdue";

  const chain = siblings
    .filter((d) => d.kind === "milestone")
    .sort(compareDeliverableDueDates);

  const next = chain.find((d) => d.status !== "done");
  return next?.id === milestone.id ? "active" : "waiting";
}
