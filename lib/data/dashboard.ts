/**
 * The dashboard, scoped to what the viewer is actually responsible for.
 *
 * ---------------------------------------------------------------------------
 * Why this takes a viewer
 * ---------------------------------------------------------------------------
 *
 * It used to take no arguments and return the whole club: every unread report,
 * club-wide compliance, everyone's hours. Two problems with that.
 *
 * The obvious one is privacy — a Lead could read reports written to a different
 * Lead, and (since the page had no gate at all) so could any member who typed
 * the URL.
 *
 * The subtler one is that it made the page useless. A Lead opening a list of
 * thirty reports, twenty-six of which aren't theirs, cannot tell what they owe.
 * The whole design target is "a Lead's weekly obligation fits in 15 minutes",
 * and a list you have to filter by eye fails that before you read a word.
 *
 * So: `reviewQueue` is only reports written to YOU. Effort aggregates cover only
 * people in your chain. `flaggedProjects` stays club-wide on purpose — a blocked
 * project is exactly the thing a passing person should be able to unblock.
 *
 * PHASE 1 NOTE: `compliance` and `hoursThisWeek` map onto `v_update_compliance`
 * and `v_member_hours_weekly` in docs/DATA_MODEL.md, but both now need a member
 * filter. Views should take the scoped id set rather than aggregating globally.
 */

import {
  atRiskProjects,
  club,
  divisions,
  getMember,
  getProject,
  memberProjects,
  today,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { MAX_BACKDATE_DAYS } from "@/lib/store/operations";
import { isCoLead, type Actor, type OrgGraph } from "@/lib/permissions";
import { escalationsFor, unreadReportsFor, type LeadEscalation } from "@/lib/review";
import type { Member, Project, ProgressUpdate, UpdateEntry } from "@/lib/types";
import { preloadLiveStore } from "@/lib/store/request";

export interface ReviewQueueItem {
  update: ProgressUpdate;
  author?: Member;
  /** Each entry paired with its project, so the UI never has to look it up. */
  sections: { entry: UpdateEntry; project?: Project }[];
  /** Whole days since submission. Drives the ordering and the warning tone. */
  ageDays: number;
  /** Past the grace period — your own Lead can now see this. */
  escalated: boolean;
}

export interface FlaggedProject {
  project: Project;
  res: Member[];
}

export interface DashboardView {
  club: typeof club;
  /** True when the viewer oversees nobody — changes the whole page's message. */
  isLeadOfNobody: boolean;
  counts: {
    /** People in the viewer's chain, not the club, unless they're a Co-Lead. */
    peopleOverseen: number;
    divisions: number;
    projects: number;
  };
  compliance: {
    onTime: number;
    late: number;
    missed: number;
    /** Due but not yet written. Not a failure — the window may still be open. */
    pending: number;
    fraction: number;
  };
  /** Hours logged this week by people the viewer oversees. */
  hoursThisWeek: number;
  /** Reports written TO the viewer and not yet read. Oldest first. */
  reviewQueue: ReviewQueueItem[];
  /** Leads under the viewer who are leaving their people unheard. */
  escalations: LeadEscalation[];
  /** Club-wide, deliberately: anyone may help with a blocked project. */
  flaggedProjects: FlaggedProject[];
  /** The viewer's own committed projects, so they can log hours from here. */
  myProjects: { id: string; name: string }[];
  today: string;
  maxBackdateDays: number;
}

/**
 * Everyone at or below `memberId` in the reporting chain, excluding themselves.
 *
 * Iterative rather than recursive, with a `seen` set: `profiles.lead_id` has a
 * self-reference CHECK but nothing prevents a longer cycle (A leads B leads A),
 * and a cycle here would hang the request rather than render wrong.
 */
function reportsBelow(memberId: string): Member[] {
  const collected: Member[] = [];
  const seen = new Set<string>([memberId]);
  let frontier = [memberId];
  // Read once, outside the loop: the chain walk is O(depth × members) and
  // re-reading the store per level would multiply that for no reason.
  const allMembers = readStore().members;

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const m of allMembers) {
        if (m.leadId === id && !seen.has(m.id)) {
          seen.add(m.id);
          collected.push(m);
          next.push(m.id);
        }
      }
    }
    frontier = next;
  }

  return collected;
}

function startOfWeek(today: string): string {
  const d = new Date(today);
  // Monday-based. getDay() is 0 for Sunday, so shift it.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

/**
 * `_graph` is unused today because the chain is walked over the in-memory
 * `members` array. It's in the signature because the Postgres version must
 * resolve the chain through `v_lead_chain`, and adding a parameter later would
 * mean touching every caller — the same reason every function here is already
 * `async` against a synchronous mock.
 */
export async function getDashboard(
  actor: Actor,
  _graph: OrgGraph
): Promise<DashboardView> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  // Live, not the seed — a Lead marking a report reviewed must disappear
  // from their own queue on the next render.
  const { progressUpdates, workLogs } = readStore();

  // A Co-Lead oversees the club; everyone else oversees their own subtree.
  const overseen = isCoLead(actor)
    ? readStore().members.filter((m) => m.id !== actor.id && m.status === "active")
    : reportsBelow(actor.id).filter((m) => m.status === "active");

  const overseenIds = new Set(overseen.map((m) => m.id));

  // Reports written to the viewer personally — their direct reports only. A
  // Lead two levels up sees the escalation instead, not the raw report, so the
  // obligation stays with exactly one person.
  const directReports = readStore().members.filter(
    (m) =>
      m.status === "active" &&
      m.id !== actor.id &&
      // Normally: people who report to you.
      (m.leadId === actor.id ||
        // Plus, for a Co-Lead, anyone with nobody above them. Co-Leads are the
        // top of the chain, so their own check-ins have no Lead to go to —
        // without this they'd write them into a void, which is worse than not
        // asking for them. They go sideways to the other Co-Leads instead.
        (isCoLead(actor) && m.leadId === null))
  );

  const reviewQueue: ReviewQueueItem[] = unreadReportsFor(
    actor.id,
    progressUpdates,
    directReports,
    today()
  ).map((unread) => ({
    update: unread.update,
    author: unread.author,
    ageDays: unread.ageDays,
    escalated: unread.escalated,
    sections: unread.update.entries.map((entry) => ({
      entry,
      project: getProject(entry.projectId),
    })),
  }));

  // Compliance across the people the viewer oversees. Counting the whole club
  // would tell a Lead nothing about whether THEIR people are keeping up.
  const scopedUpdates = progressUpdates.filter((u) => overseenIds.has(u.memberId));
  const onTime = scopedUpdates.filter(
    (u) => u.status === "submitted" || u.status === "reviewed"
  ).length;
  const late = scopedUpdates.filter((u) => u.status === "late").length;
  const missed = scopedUpdates.filter((u) => u.status === "missed").length;
  // Pending is excluded from the ratio on purpose: the window may still be open,
  // and counting an unwritten-but-not-yet-late report as a miss would show a
  // Lead a falling compliance number every single morning.
  const pending = scopedUpdates.filter((u) => u.status === "pending").length;
  const totalDue = onTime + late + missed;

  const weekStart = startOfWeek(today());
  const hoursThisWeek = workLogs
    .filter((w) => overseenIds.has(w.memberId) && w.workDate >= weekStart)
    .reduce((sum, w) => sum + w.hours, 0);

  const flaggedProjects: FlaggedProject[] = atRiskProjects().map((project) => ({
    project,
    res: project.reIds
      .map((id) => getMember(id))
      .filter((m): m is Member => m !== undefined),
  }));

  return {
    club,
    isLeadOfNobody: overseen.length === 0,
    counts: {
      peopleOverseen: overseen.length,
      divisions: divisions().length,
      projects: readStore().projects.length,
    },
    compliance: {
      onTime,
      late,
      missed,
      pending,
      // No data is `0`, and the UI must show "—" rather than 0%. A Lead whose
      // people have nothing due yet is not a Lead at 0% compliance.
      fraction: totalDue === 0 ? 0 : onTime / totalDue,
    },
    hoursThisWeek,
    reviewQueue,
    escalations: escalationsFor(actor.id, readStore().members, progressUpdates, today()),
    myProjects: memberProjects(actor.id)
      .filter((m) => m.commitment === "committed")
      .map((m) => ({ id: m.projectId, name: m.project?.name ?? m.projectId })),
    today: today(),
    maxBackdateDays: MAX_BACKDATE_DAYS,
    flaggedProjects,
  };
}

// Exported for tests.
export { reportsBelow };
