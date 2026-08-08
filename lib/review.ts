/**
 * Whether Leads are actually reading their reports' check-ins — and who to tell
 * when they aren't.
 *
 * ---------------------------------------------------------------------------
 * The problem this solves
 * ---------------------------------------------------------------------------
 *
 * A member writes an honest twice-weekly report, says they're stuck, and nobody
 * reads it. From the member's side that's indistinguishable from the app not
 * existing — and it's worse than silence, because they spent effort on it. Two
 * of those and they stop writing.
 *
 * So an unread report escalates. Not to "management" in the abstract: to exactly
 * one named person, the Lead above the Lead who didn't read it. Reviewing is a
 * single person's obligation (see `can.reviewUpdate` — REs deliberately can't do
 * it), which is what makes "whose fault is this?" answerable at all.
 *
 * ---------------------------------------------------------------------------
 * Why it escalates on AGE, not on count
 * ---------------------------------------------------------------------------
 *
 * "You have 12 unread reports" is a number a busy person learns to ignore, and
 * it punishes Leads with more reports. "Kenji's report has been unread for 6
 * days" names one person, is obviously actionable, and is equally embarrassing
 * whether you lead three people or fifteen.
 *
 * Everything here is pure: `Date.now()` is never called, the current date is
 * always passed in. That keeps it testable and keeps a rendered page from
 * changing depending on when it renders.
 */

import type { Deliverable, Member, ProgressUpdate } from "./types.ts";

/**
 * Grace period before an unread report escalates.
 *
 * Three days, chosen against the twice-weekly rhythm rather than picked round:
 * reports land ~3–4 days apart, so this fires just before the next one is due.
 * A Lead gets a full working weekend to catch up, and no report is ever chased
 * while the one after it is still unwritten.
 */
export const REVIEW_GRACE_DAYS = 3;

/** Updates that are waiting on a human. Not yet late — just outstanding. */
export function isAwaitingReview(update: ProgressUpdate): boolean {
  return update.status === "submitted";
}

/**
 * Whole calendar days between two ISO strings.
 *
 * Both are truncated to their date part FIRST, and that's the whole point.
 * JavaScript parses `"2026-08-06"` as UTC midnight but
 * `"2026-08-01T18:40"` (no zone) as *local* time — so comparing a submission
 * timestamp against a date-only "today" silently mixes two clocks. In Pacific
 * time that quietly loses a day: a report submitted five days ago reported as
 * four, which is the difference between escalating and not.
 *
 * Nobody would notice, because it's only wrong by one and only near midnight.
 * Comparing dates as dates removes the class of bug entirely.
 */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000);
}

export interface UnreadReport {
  update: ProgressUpdate;
  author?: Member;
  /** Whole days since it was submitted. */
  ageDays: number;
  /** Past the grace period — the Lead above should be told. */
  escalated: boolean;
}

/**
 * The Lead's own queue: reports written *to them* and not yet read.
 *
 * Sorted oldest first. That ordering is the entire user interface for this
 * feature — the thing most likely to have gone stale is the thing you see, so a
 * Lead working top-down is always fixing the worst case.
 */
export function unreadReportsFor(
  leadId: string,
  updates: ProgressUpdate[],
  directReports: Member[],
  today: string
): UnreadReport[] {
  const reportIds = new Set(directReports.map((m) => m.id));

  return updates
    .filter((u) => isAwaitingReview(u) && reportIds.has(u.memberId))
    .map((update) => {
      // `submittedAt` should always be set when status is 'submitted' — there's
      // a CHECK constraint for it in 0007 — but this runs against mock data too,
      // so fall back to the due date rather than producing NaN.
      const since = update.submittedAt ?? update.dueAt;
      const ageDays = Math.max(0, daysBetween(since, today));
      return {
        update,
        author: directReports.find((m) => m.id === update.memberId),
        ageDays,
        escalated: ageDays >= REVIEW_GRACE_DAYS,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays);
}

export interface LeadEscalation {
  /** The Lead who hasn't read them. */
  lead: Member;
  /** Their unread reports, past grace, oldest first. */
  overdue: UnreadReport[];
  /** Age of the oldest. What to lead the message with. */
  worstAgeDays: number;
}

/**
 * What the Lead ABOVE sees: which of my Leads are leaving people unheard.
 *
 * Note the shape of the result — it reports on *Leads*, not on updates. A list
 * of 30 unread reports is data; "Priya has three people waiting, the oldest six
 * days" is something you can act on in one conversation.
 *
 * Only Leads with at least one escalated report appear, so an empty array is the
 * healthy case and the UI can say nothing at all.
 */
export function escalationsFor(
  viewerId: string,
  allMembers: Member[],
  updates: ProgressUpdate[],
  today: string
): LeadEscalation[] {
  const myLeads = allMembers.filter(
    (m) => m.leadId === viewerId && m.globalRole !== "member"
  );

  return myLeads
    .map((lead) => {
      const theirReports = allMembers.filter((m) => m.leadId === lead.id);
      const overdue = unreadReportsFor(
        lead.id,
        updates,
        theirReports,
        today
      ).filter((r) => r.escalated);

      return { lead, overdue, worstAgeDays: overdue[0]?.ageDays ?? 0 };
    })
    .filter((e) => e.overdue.length > 0)
    .sort((a, b) => b.worstAgeDays - a.worstAgeDays);
}

export interface PendingSignOff {
  deliverable: Deliverable;
  owner?: Member;
  ageDays: number;
  escalated: boolean;
}

/**
 * Work an owner has finished that no RE has signed off yet.
 *
 * This exists because of a trade Anish chose deliberately: only an RE can mark a
 * deliverable delivered, which keeps the primary contribution signal honest but
 * puts one person in the path of everyone else's record. A quiet RE therefore
 * freezes their whole project's "Delivered" count, and — worse — the members
 * affected can't tell whether they're being ignored or whether the app is
 * broken.
 *
 * So unconfirmed work ages exactly like an unread check-in does, on the same
 * grace period. It turns a silent bottleneck into a visible one, which is the
 * only honest way to run the stricter rule.
 *
 * `projectIds` should be the subtree the RE is responsible for — authority
 * inherits DOWN the project tree, so an RE of a parent can sign off on a child.
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
        escalated: ageDays >= REVIEW_GRACE_DAYS,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays);
}

/**
 * A Lead's own review record, for their self-check.
 *
 * Shown to the Lead about themselves — deliberately not to peers, and never
 * ranked against other Leads. Same reasoning as the absent engagement
 * leaderboard: the moment "reports read" becomes a comparable score, it gets
 * optimised by clicking 'reviewed' without reading.
 */
export function reviewRecordFor(
  leadId: string,
  updates: ProgressUpdate[],
  directReports: Member[],
  today: string
): { unread: number; escalated: number; worstAgeDays: number } {
  const unread = unreadReportsFor(leadId, updates, directReports, today);
  const escalated = unread.filter((r) => r.escalated);
  return {
    unread: unread.length,
    escalated: escalated.length,
    worstAgeDays: unread[0]?.ageDays ?? 0,
  };
}
