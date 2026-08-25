/**
 * Work that is finished and waiting on a PL.
 *
 * ===========================================================================
 * Why this file exists, when `lib/review.ts` used to hold it
 * ===========================================================================
 *
 * `review.ts` held two unrelated things behind one name: the reporting chain's
 * escalation of unread check-ins, and this — the PL's sign-off queue. The
 * reporting chain was removed on 2026-08-24 and the file went with it, which
 * nearly took the sign-off queue too. It survives here because it was never about
 * the chain at all: it is a fact about DELIVERABLES and the PL accountable for
 * them, which is the half of the model the club kept.
 *
 * Worth remembering as a general lesson. A file named after a concept can hold
 * code that has nothing to do with it, and deleting by filename is how the other
 * half disappears quietly.
 */

import type { Deliverable, Member } from "./types.ts";

/**
 * How long unconfirmed work waits before it is called out.
 *
 * Three days, and the number is inherited from the check-in escalation that used
 * to sit beside it — deliberately, because the two were the same promise: if
 * something you did lands on somebody's desk, you find out within three days
 * whether it moved.
 */
export const SIGN_OFF_GRACE_DAYS = 3;

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const to = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

export interface PendingSignOff {
  deliverable: Deliverable;
  owner?: Member;
  ageDays: number;
  escalated: boolean;
}

/**
 * Work an owner has finished that no PL has signed off yet.
 *
 * This exists because of a deliberate trade: only a PL can mark a deliverable
 * delivered, which keeps the Delivered count honest but puts one person in the
 * path of everyone else's record. A quiet PL therefore freezes their whole
 * project's count, and — worse — the members affected cannot tell whether they
 * are being ignored or whether the app is broken.
 *
 * So unconfirmed work ages visibly. It turns a silent bottleneck into a stated
 * one, which is the only honest way to run the stricter rule.
 *
 * With the reporting chain gone this matters MORE, not less: it is now the only
 * thing in the app that says "somebody is waiting on you", and the PL is the only
 * person it can say it to.
 *
 * `projectIds` should be the subtree the PL is responsible for — authority
 * inherits DOWN the project tree, so a PL of a parent can sign off on a child.
 */
export function pendingSignOffs(
  deliverables: Deliverable[],
  projectIds: string[],
  members: Member[],
  today: string
): PendingSignOff[] {
  const scope = new Set(projectIds);

  return deliverables
    .filter((d) => d.status === "submitted" && scope.has(d.projectId))
    .map((deliverable) => {
      // `submittedAt` is set whenever status becomes 'submitted', but fall back
      // rather than produce NaN and sort the queue randomly.
      const since = deliverable.submittedAt ?? today;
      const ageDays = Math.max(0, daysBetween(since, today));
      return {
        deliverable,
        owner: members.find((m) => m.id === deliverable.ownerId),
        ageDays,
        escalated: ageDays >= SIGN_OFF_GRACE_DAYS,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays);
}
