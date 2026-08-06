/**
 * Everything the My Work page needs, in one call.
 *
 * Breadcrumbs, REs, hours and last-update-per-project are joined HERE rather
 * than looked up per row in the component. Against Postgres, per-row lookups
 * would be one round trip each — and `projectBreadcrumb` is a recursive tree
 * walk, so it would be several.
 */

import {
  getMember,
  hoursOnProject,
  lastEntryForProject,
  myProjects,
  myUpdate,
  projectBreadcrumb,
  projectREs,
} from "@/lib/mock-data";
import type {
  Member,
  Project,
  ProjectMembership,
  ProgressUpdate,
  UpdateEntry,
} from "@/lib/types";

export interface BreadcrumbNode {
  id: string;
  name: string;
  kind: "division" | "team" | "project";
}

/** One of the member's projects, with all context pre-attached. */
export interface MyProjectCard {
  project: Project;
  membership: ProjectMembership;
  breadcrumb: BreadcrumbNode[];
  /** Primary RE first. Who to ask about this project. */
  res: Member[];
  hoursLogged: number;
  /** What this member last said about THIS project, if anything. */
  lastUpdate?: { entry: UpdateEntry; submittedAt: string };
}

/** A section of the current update, tied to a specific project. */
export interface UpdateDraftSection {
  entry: UpdateEntry;
  project: Project;
  breadcrumb: BreadcrumbNode[];
}

export interface MyWorkView {
  me: Member;
  projects: MyProjectCard[];
  currentUpdate: {
    update: ProgressUpdate;
    sections: UpdateDraftSection[];
  };
  totals: {
    projectCount: number;
    reCount: number;
    hoursLogged: number;
  };
}

export async function getMyWork(memberId: string): Promise<MyWorkView> {
  const me = getMember(memberId);
  if (!me) throw new Error(`Member not found: ${memberId}`);

  const projects: MyProjectCard[] = myProjects(memberId).map(
    ({ project, membership }) => ({
      project,
      membership,
      breadcrumb: projectBreadcrumb(project.id),
      res: projectREs(project.id),
      hoursLogged: hoursOnProject(memberId, project.id),
      lastUpdate: lastEntryForProject(memberId, project.id),
    })
  );

  // Only include sections whose project still resolves — a member could have
  // left a project after the draft was seeded.
  const sections: UpdateDraftSection[] = myUpdate.entries.flatMap((entry) => {
    const card = projects.find((p) => p.project.id === entry.projectId);
    if (!card) return [];
    return [
      { entry, project: card.project, breadcrumb: card.breadcrumb },
    ];
  });

  return {
    me,
    projects,
    currentUpdate: { update: myUpdate, sections },
    totals: {
      projectCount: projects.length,
      reCount: projects.filter((p) => p.membership.role === "re").length,
      hoursLogged: projects.reduce((sum, p) => sum + p.hoursLogged, 0),
    },
  };
}
