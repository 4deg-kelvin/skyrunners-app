/**
 * Roster and member profiles.
 *
 * PHASE 1 NOTE: the roster needs project counts per member. Do that with one
 * grouped query (or the `v_member_project_counts` view), not a per-member
 * lookup — 40 members × 2 lookups is 80 avoidable round trips.
 */

import {
  activeMembers,
  getMember,
  hoursOnProject,
  memberProjects,
  members,
  projectBreadcrumb,
  projectREs,
} from "@/lib/mock-data";
import type { Member, Project, ProjectMembership } from "@/lib/types";
import type { BreadcrumbNode } from "./my-work";

export interface RosterRow {
  member: Member;
  lead?: Member;
  projectCount: number;
  reCount: number;
}

export async function getRoster(): Promise<RosterRow[]> {
  return activeMembers().map((member) => {
    const mine = memberProjects(member.id);
    return {
      member,
      lead: member.leadId ? getMember(member.leadId) : undefined,
      projectCount: mine.length,
      reCount: mine.filter((p) => p.role === "re").length,
    };
  });
}

export interface MemberProjectRow {
  project: Project;
  membership: ProjectMembership;
  breadcrumb: BreadcrumbNode[];
  res: Member[];
  hoursLogged: number;
}

export interface MemberProfileView {
  member: Member;
  lead?: Member;
  /** People who report directly to this member. */
  directReports: Member[];
  projects: MemberProjectRow[];
  /**
   * Whether the viewer may see hours, update contents, and engagement.
   * Decided by the caller via `lib/permissions.ts` — this layer only carries
   * the answer through so the page doesn't re-derive it.
   */
  canViewEffort: boolean;
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
        },
      ];
    }),
    canViewEffort,
  };
}

/** Every member id — used to pre-render profile pages at build time. */
export async function getAllMemberIds(): Promise<string[]> {
  return members.map((m) => m.id);
}
