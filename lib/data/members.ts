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
  hoursOnProject,
  isOverdue,
  memberProjects,
  members,
  myDeliverables,
  projectBreadcrumb,
  projectREs,
} from "@/lib/mock-data";
import {
  buildContributionRecord,
  commitmentTier,
  type CommitmentTier,
  type ContributionRecord,
} from "@/lib/contribution";
import type {
  Deliverable,
  Member,
  Project,
  ProjectMembership,
} from "@/lib/types";
import type { BreadcrumbNode } from "./my-work";

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

export async function getRoster(): Promise<RosterRow[]> {
  return activeMembers().map((member) => {
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
}

export async function getMemberProfile(
  memberId: string,
  canViewEffort: boolean
): Promise<MemberProfileView | null> {
  const member = getMember(memberId);
  if (!member) return null;

  return {
    member,
    lead: member.leadId ? getMember(member.leadId) : undefined,
    directReports: members.filter(
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
  };
}

/** Every member id — used to pre-render profile pages at build time. */
export async function getAllMemberIds(): Promise<string[]> {
  return members.map((m) => m.id);
}
