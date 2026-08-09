/**
 * ============================================================================
 * FIND WORK
 * ============================================================================
 *
 * This is the feature the whole app exists for.
 *
 * The club's stated root problem is that a member can't find something to do
 * without asking a Co-Lead. Every other page here is supporting cast; this is
 * the direct answer.
 *
 * Because membership is RE-controlled, "finding work" means two things, and the
 * page has to do both:
 *
 *   1. See what needs doing across the whole club
 *   2. Know exactly who to ask, and be able to ask in one click
 *
 * Ordering matters more than it looks. A list sorted by "newest" or by division
 * would bury the work that actually needs people. So: projects explicitly
 * flagged as needing help first, then unstaffed and understaffed ones, then
 * everything else. The top of this list should always be somewhere a member is
 * genuinely useful.
 */

import { readStore } from "@/lib/store/disk";
import {
  divisionForProject,
  isOverdue,
  projectDeliverables,
  projectMembers,
  projectProgress,
  projectREs,
} from "@/lib/mock-data";
import type { Deliverable, Member, Project, Team } from "@/lib/types";
import { preloadLiveStore } from "@/lib/store/request";

export type WorkSignal =
  | "needs_help"
  | "unstaffed"
  | "unowned_deliverables"
  | "overdue"
  | "open_roles"
  | "healthy";

export interface OpenWorkCard {
  project: Project;
  division?: Team;
  res: Member[];
  memberCount: number;
  progress: ReturnType<typeof projectProgress>;
  /** Deliverables nobody has picked up, or that are behind. */
  needsAttention: Deliverable[];
  signals: WorkSignal[];
  /** Higher sorts first. */
  priority: number;
  /** Whether the viewer is already involved, so we can grey it out. */
  viewerStatus: "committed" | "following" | "requested" | "none";
  /** Skills the project asked for, matched against the viewer's. */
  matchedSkills: string[];
}

export interface FindWorkView {
  /** Sorted so the most useful place to help is first. */
  openWork: OpenWorkCard[];
  /** Distinct skill areas across all open roles, for filtering. */
  skillAreas: string[];
  counts: {
    total: number;
    needingHelp: number;
    unstaffed: number;
  };
}

function signalsFor(
  project: Project,
  memberCount: number,
  needsAttention: Deliverable[]
): WorkSignal[] {
  const signals: WorkSignal[] = [];

  if (project.health === "blocked" || project.health === "at_risk") {
    signals.push("needs_help");
  }
  if (memberCount === 0) signals.push("unstaffed");
  if (memberCount === 1) signals.push("unowned_deliverables");
  if (needsAttention.some(isOverdue)) signals.push("overdue");
  if (project.openRoles) signals.push("open_roles");
  if (signals.length === 0) signals.push("healthy");

  return signals;
}

/**
 * Priority score. Deliberately crude and readable rather than clever — a Co-Lead
 * should be able to look at the ordering and understand why something is on top.
 */
function priorityFor(signals: WorkSignal[], project: Project): number {
  let score = 0;
  if (signals.includes("unstaffed")) score += 50;
  if (signals.includes("needs_help")) score += 40;
  if (signals.includes("overdue")) score += 25;
  if (signals.includes("open_roles")) score += 20;
  if (signals.includes("unowned_deliverables")) score += 15;
  // Early-phase projects are the easiest to join usefully — there's shaping work
  // left, rather than a half-built thing to catch up on.
  if (project.phase === "concept" || project.phase === "requirements")
    score += 10;
  return score;
}

export async function getFindWork(
  viewerId: string,
  viewerSkills: string[] = []
): Promise<FindWorkView> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  const lowerSkills = viewerSkills.map((s) => s.toLowerCase());

  const openWork: OpenWorkCard[] = readStore()
    .projects.filter((p) => p.phase !== "complete")
    .map((project) => {
      const members = projectMembers(project.id).filter(
        (pm) => pm.commitment === "committed"
      );
      const memberCount = members.length;

      const deliverables = projectDeliverables(project.id);
      const needsAttention = deliverables.filter(
        (d) => d.status === "blocked" || isOverdue(d)
      );

      const signals = signalsFor(project, memberCount, needsAttention);

      const mine = projectMembers(project.id).find(
        (pm) => pm.memberId === viewerId
      );
      // Live, not the seed: after asking to join, the card must immediately say
      // "Request pending" rather than offering the button again.
      const hasRequested = readStore().joinRequests.some(
        (r) =>
          r.projectId === project.id &&
          r.memberId === viewerId &&
          r.status === "pending"
      );

      const viewerStatus: OpenWorkCard["viewerStatus"] = mine
        ? mine.commitment === "committed"
          ? "committed"
          : "following"
        : hasRequested
          ? "requested"
          : "none";

      // Naive substring match on both sides, so "CFD" finds "CFD analysis" and
      // "computer vision" finds "vision". Good enough, and easy to reason about.
      const roleText = (project.openRoles ?? "").toLowerCase();
      const matchedSkills = lowerSkills.filter(
        (s) =>
          roleText.includes(s) || s.split(" ").some((w) => roleText.includes(w))
      );

      return {
        project,
        division: divisionForProject(project.id),
        res: projectREs(project.id),
        memberCount,
        progress: projectProgress(project.id),
        needsAttention,
        signals,
        priority:
          priorityFor(signals, project) + (matchedSkills.length > 0 ? 30 : 0),
        viewerStatus,
        matchedSkills,
      };
    })
    .sort((a, b) => {
      // Projects the viewer is already committed to go last — they're looking
      // for something NEW.
      if (a.viewerStatus === "committed" && b.viewerStatus !== "committed")
        return 1;
      if (b.viewerStatus === "committed" && a.viewerStatus !== "committed")
        return -1;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.project.name.localeCompare(b.project.name);
    });

  const skillAreas = Array.from(
    new Set(
      readStore()
        .projects.flatMap((p) => (p.openRoles ?? "").split(","))
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).sort();

  return {
    openWork,
    skillAreas,
    counts: {
      total: openWork.length,
      needingHelp: openWork.filter((w) => w.signals.includes("needs_help"))
        .length,
      unstaffed: openWork.filter((w) => w.signals.includes("unstaffed")).length,
    },
  };
}
