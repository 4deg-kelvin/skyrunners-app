/**
 * ============================================================================
 * THE CHECK-IN WRITES ITSELF FROM THE WORK LOG
 * ============================================================================
 *
 * This is the half of the hours removal that adds something rather than taking
 * it away. The log stopped being a timesheet and became a diary — what you did,
 * on each project, day by day — and a diary can draft the check-in for you.
 *
 * The behaviour, in one sentence: **for each project you're committed to, your
 * log entries since your last check-in are pre-filled into that project's
 * section; a project you logged nothing against is the one thing you have to
 * write.**
 *
 * ----------------------------------------------------------------------------
 * Why this is a pure module and not two bits of inline code
 * ----------------------------------------------------------------------------
 *
 * Two callers need the SAME answer:
 *
 *   - `lib/data/my-work.ts` pre-fills the composer, so it needs to know which
 *     projects have entries and what text to put in each box.
 *   - `submitCheckIn` in `lib/store/operations.ts` refuses a check-in that
 *     leaves a project silent, so it needs to know which projects had nothing.
 *
 * If those two disagree by a day, the form pre-fills a box and the server then
 * demands the member write in it — or worse, the reverse: the form asks for
 * nothing and the submit is refused for a reason the page never showed. Same
 * reasoning as `lib/artifacts.ts` running its checks on both the client and the
 * server from one function.
 *
 * So the window and the grouping live here, take their inputs as arguments, and
 * touch no store. `lib/dates.ts` owns the date arithmetic.
 */

import { addDays } from "./dates";

/**
 * The shape this module needs from a work log. Structural on purpose: the tests
 * pass literals, and `WorkLog` itself carries fields nothing here reads.
 */
export interface LoggedWork {
  /** Undefined for "misc" — work that belongs to no project. */
  projectId?: string;
  workDate: string;
  description: string;
}

/** A check-in already on record. Only the two fields the window depends on. */
export interface PriorCheckIn {
  submittedAt?: string;
  status: string;
}

/**
 * How far back a member's FIRST check-in reaches.
 *
 * Somebody who has been logging for two months and never checked in should not
 * open the composer to sixty pre-filled lines. A week matches the cadence
 * (twice weekly) and matches `MAX_BACKDATE_DAYS`, so the window can never
 * contain an entry that couldn't have been logged inside it.
 */
export const FIRST_PERIOD_DAYS = 7;

/**
 * The first day this check-in covers.
 *
 * Anchored to the last check-in the member actually SUBMITTED, not to the last
 * one that came due. The plan for this change said "the previous check-in's due
 * date", and this is deliberately narrower, because the due date is wrong in
 * two real cases:
 *
 *   - A LATE check-in was submitted after its due date. Anchoring to the due
 *     date would re-surface entries that check-in already reported, and the
 *     member would send their Lead the same three lines twice.
 *   - A MISSED check-in was never submitted at all. Anchoring to its due date
 *     would silently drop the week before it on the floor — the one week whose
 *     work nobody has yet heard about.
 *
 * Anchoring to the last submission makes this function agree exactly with
 * `workIsLocked` in `lib/store/operations.ts`: an entry is in this period if and
 * only if a submitted check-in hasn't already closed its day out. Those two
 * rules have to mean the same thing, or the composer offers to report an entry
 * the member is no longer allowed to edit.
 *
 * Inclusive of the returned day, matching that lock rule — which locks days
 * STRICTLY before a submission, so work done the same evening still counts.
 */
export function checkInPeriodStart(
  priorCheckIns: PriorCheckIn[],
  today: string
): string {
  const lastSubmitted = priorCheckIns
    .filter((u) => !!u.submittedAt)
    .map((u) => u.submittedAt!.slice(0, 10))
    .sort()
    .pop();

  if (lastSubmitted) return lastSubmitted;
  return addDays(today, -FIRST_PERIOD_DAYS);
}

/** Entries inside the window, oldest first — the order they'd be read in. */
export function workInPeriod<T extends LoggedWork>(
  logs: T[],
  periodStart: string,
  today: string
): T[] {
  return logs
    .filter((w) => {
      const day = w.workDate.slice(0, 10);
      return day >= periodStart && day <= today;
    })
    .sort((a, b) => a.workDate.localeCompare(b.workDate));
}

/**
 * The period's entries, bucketed by project id.
 *
 * Misc entries — no project — are deliberately dropped rather than collected
 * under a key. They belong to no project's section, and the check-in's per-
 * project structure is the thing that makes it readable to a Lead overseeing
 * several projects. A member who wants to mention them has the general note.
 */
export function workByProject<T extends LoggedWork>(
  logs: T[],
  periodStart: string,
  today: string
): Map<string, T[]> {
  const byProject = new Map<string, T[]>();

  for (const log of workInPeriod(logs, periodStart, today)) {
    if (!log.projectId) continue;
    const bucket = byProject.get(log.projectId);
    if (bucket) bucket.push(log);
    else byProject.set(log.projectId, [log]);
  }

  return byProject;
}

/**
 * Turn a project's entries into the text that pre-fills its box.
 *
 * Three decisions worth naming, because each could reasonably have gone the
 * other way:
 *
 *   - **Editable, not fixed.** The caller puts this in a normal textarea. The
 *     log is raw notes written for the member's own benefit; the check-in is
 *     what they want their Lead to read, and those are different registers. A
 *     read-only pre-fill would make the composer a receipt rather than a draft.
 *
 *   - **No dates in the text.** They'd read as a timesheet — the thing being
 *     removed — and the day-by-day list on My Work already answers "when".
 *     What a Lead needs from this box is what moved, not on which afternoon.
 *
 *   - **Identical lines collapse.** Logging "spar layup" on three consecutive
 *     days is normal and honest, and three identical lines in a check-in reads
 *     as a bug in the app rather than as persistence. Order is preserved, so
 *     the first occurrence keeps its place.
 */
export function draftProgressFrom(logs: LoggedWork[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const log of logs) {
    const line = log.description.trim();
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }

  return lines.join("\n");
}
