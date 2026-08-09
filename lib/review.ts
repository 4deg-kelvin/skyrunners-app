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

import type {
  Deliverable,
  Member,
  ProgressUpdate,
  UpdateEntry,
} from "./types.ts";

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

export interface UnansweredSection {
  entry: UpdateEntry;
  author?: Member;
  projectId: string;
  ageDays: number;
  escalated: boolean;
}

/**
 * Check-in sections nobody has replied to, on projects this RE owns.
 *
 * The counterpart to `unreadReportsFor`, and the reason both exist: reading a
 * check-in and answering it are two obligations belonging to two different
 * people. A Lead marks the whole thing read — that's about the person. An RE
 * answers one project's section — that's about the work, and a member on three
 * projects needs three answers from three people.
 *
 * Only sections with something to answer. A section that says "made progress,
 * no blockers" needs no reply, and putting it in a queue would train the RE to
 * clear the queue rather than read it — the same failure the 15-minute design
 * target is guarding against everywhere else.
 *
 * `projectIds` is the RE's whole subtree: authority inherits down, so an RE of
 * a parent is on the hook for a child's sections too.
 */
export function unansweredSectionsFor(
  updates: ProgressUpdate[],
  projectIds: string[],
  members: Member[],
  today: string
): UnansweredSection[] {
  const scope = new Set(projectIds);

  return updates
    .filter((u) => u.submittedAt)
    .flatMap((update) =>
      update.entries
        .filter(
          (entry) =>
            scope.has(entry.projectId) &&
            !entry.response &&
            // Worth answering: a blocker, or an explicit next step to confirm.
            // Progress alone is a status line, not a question.
            (entry.blockers?.trim() || entry.nextSteps?.trim())
        )
        .map((entry) => {
          const ageDays = Math.max(
            0,
            daysBetween(update.submittedAt!, today)
          );
          return {
            entry,
            author: members.find((m) => m.id === update.memberId),
            projectId: entry.projectId,
            ageDays,
            escalated: ageDays >= REVIEW_GRACE_DAYS,
          };
        })
    )
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
