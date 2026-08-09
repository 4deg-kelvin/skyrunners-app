/**
 * Roster and member profiles.
 *
 * PHASE 1 NOTE: the roster needs project counts per member. Do that with one
 * grouped query (or the `v_member_project_counts` view), not a per-member
 * lookup — 40 members × 2 lookups is 80 avoidable round trips.
 */

import {
  activeMembers,
  committedProjectCount,
  contributionInputsFor,
  getMember,
  getProject,
  hoursOnProject,
  isOverdue,
  memberProjects,
  myDeliverables,
  projectBreadcrumb,
  projectREs,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import {
  buildContributionRecord,
  commitmentTier,
  type CommitmentTier,
  type ContributionRecord,
} from "@/lib/contribution";
import type {
  Deliverable,
  Member,
  ProgressUpdate,
  Project,
  ProjectMembership,
  UpdateEntry,
} from "@/lib/types";
import type { BreadcrumbNode } from "./my-work";
import { preloadLiveStore } from "@/lib/store/request";

/** People who can be somebody's Lead — leadership plus anyone with reports. */
export interface RosterOptions {
  /** Candidates for the "reports to" dropdown. */
  leadOptions: { id: string; fullName: string }[];
  /** Everyone active, for invite defaults and project assignment. */
  everyone: { id: string; fullName: string }[];
}

export interface RosterRow {
  member: Member;
  lead?: Member;
  /** Committed only — following isn't staffing. */
  committedCount: number;
  reCount: number;
  /** Delivered work, the signal that leads. */
  deliverablesCompleted: number;
  openDeliverables: number;
  overdueDeliverables: number;
  /** Shown only where the viewer is allowed to see effort data. */
  tier: CommitmentTier;
  hoursPerWeek: number;
}

/**
 * Options the leadership controls need.
 *
 * Split from `getRoster` so the roster stays one query's worth of view model,
 * and computed here rather than in the page because pages may not import
 * `lib/mock-data` — ESLint enforces that boundary.
 */
export async function getRosterOptions(): Promise<RosterOptions> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  const active = activeMembers();
  return {
    // Anyone who already leads someone stays eligible even if their global role
    // is `member` — the reporting chain is a fact about the org tree, not about
    // job titles, and demoting someone shouldn't silently orphan their reports.
    leadOptions: active
      .filter(
        (m) =>
          m.globalRole !== "member" ||
          active.some((other) => other.leadId === m.id)
      )
      .map((m) => ({ id: m.id, fullName: m.fullName })),
    everyone: active.map((m) => ({ id: m.id, fullName: m.fullName })),
  };
}

export async function getRoster(): Promise<RosterRow[]> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  // Everyone, not just active people.
  //
  // Filtering to active here meant a deactivated member or an alum vanished
  // from the roster completely — along with the Reactivate button, which lives
  // on their row. Marking someone alumni was a one-way door with no way back.
  //
  // Active first, then by name, so the working roster still reads normally and
  // the rest sits underneath it.
  const order = { active: 0, inactive: 1, alumni: 2 } as const;
  return [...readStore().members]
    .sort(
      (a, b) =>
        (order[a.status] ?? 3) - (order[b.status] ?? 3) ||
        a.fullName.localeCompare(b.fullName)
    )
    .map((member) => {
    const mine = memberProjects(member.id);
    const deliverables = myDeliverables(member.id);
    const inputs = contributionInputsFor(member.id);
    const hoursPerWeek =
      inputs.activeWeeks > 0 ? inputs.hoursTotal / inputs.activeWeeks : 0;

    return {
      member,
      lead: member.leadId ? getMember(member.leadId) : undefined,
      committedCount: committedProjectCount(member.id),
      reCount: mine.filter((p) => p.role === "re").length,
      deliverablesCompleted: deliverables.filter((d) => d.status === "done")
        .length,
      openDeliverables: deliverables.filter((d) => d.status !== "done").length,
      overdueDeliverables: deliverables.filter(isOverdue).length,
      tier: commitmentTier(hoursPerWeek, inputs.isPaused),
      hoursPerWeek: Math.round(hoursPerWeek * 10) / 10,
    };
  });
}

export interface MemberProjectRow {
  project: Project;
  membership: ProjectMembership;
  breadcrumb: BreadcrumbNode[];
  res: Member[];
  hoursLogged: number;
  /** What this person owns here — concrete, not a text field. */
  deliverables: Deliverable[];
}

export interface MemberProfileView {
  member: Member;
  lead?: Member;
  /** People who report directly to this member. */
  directReports: Member[];
  projects: MemberProjectRow[];
  /**
   * Whether the viewer may see hours, update contents, and their contribution
   * record. Decided by the caller via `lib/permissions.ts` — this layer only
   * carries the answer through so the page doesn't re-derive it.
   */
  canViewEffort: boolean;
  /** Only populated when `canViewEffort` is true. */
  contribution?: ContributionRecord;
  /**
   * This person's check-in history, newest first. Empty unless `canViewEffort`.
   *
   * The review QUEUE on the dashboard stays scoped to direct reports, because
   * that's an obligation and it escalates — a Co-Lead with forty items owes
   * nothing in particular. Reading is a different act from being accountable
   * for reading, so it lives here, on the person, and follows the wider rule:
   * yourself, anyone up your chain, or a Co-Lead.
   */
  checkIns: MemberCheckIn[];
}

/** One submitted check-in, with each project entry resolved. */
export interface MemberCheckIn {
  update: ProgressUpdate;
  /** Whether a Lead has already read it, and when. */
  reviewedAt?: string;
  reviewedBy?: Member;
  sections: { entry: UpdateEntry; project?: Project }[];
}

export async function getMemberProfile(
  memberId: string,
  canViewEffort: boolean
): Promise<MemberProfileView | null> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  const member = getMember(memberId);
  if (!member) return null;

  return {
    member,
    lead: member.leadId ? getMember(member.leadId) : undefined,
    directReports: readStore().members.filter(
      (m) => m.leadId === member.id && m.status === "active"
    ),
    projects: memberProjects(memberId).flatMap((pm) => {
      if (!pm.project) return [];
      return [
        {
          project: pm.project,
          membership: pm,
          breadcrumb: projectBreadcrumb(pm.project.id),
          res: projectREs(pm.project.id),
          hoursLogged: canViewEffort
            ? hoursOnProject(memberId, pm.project.id)
            : 0,
          deliverables: myDeliverables(memberId).filter(
            (d) => d.projectId === pm.project!.id
          ),
        },
      ];
    }),
    canViewEffort,
    // Never even compute it for a viewer who isn't allowed to see it
    contribution: canViewEffort
      ? buildContributionRecord(contributionInputsFor(memberId))
      : undefined,
    checkIns: canViewEffort
      ? readStore()
          // Only ones actually sent. A `pending` row is a slot the member
          // hasn't filled in yet, and `missed` is an empty one that expired —
          // neither is something to read.
          .progressUpdates.filter((u) => u.memberId === memberId && u.submittedAt)
          .sort((a, b) =>
            (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")
          )
          .map((update) => ({
            update,
            reviewedAt: update.reviewedAt ?? undefined,
            reviewedBy: update.reviewedBy
              ? getMember(update.reviewedBy)
              : undefined,
            sections: update.entries.map((entry) => ({
              entry,
              project: getProject(entry.projectId),
            })),
          }))
      : [],
  };
}

/** Every member id — used to pre-render profile pages at build time. */
export async function getAllMemberIds(): Promise<string[]> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  return readStore().members.map((m) => m.id);
}
