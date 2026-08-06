/**
 * Project tree and project detail.
 *
 * PHASE 1 NOTE: `getProjectTree` is the one query worth turning into a single
 * recursive CTE (`v_project_tree` in docs/DATA_MODEL.md). Fetching children per
 * node would be a round trip per project — that's the classic way a tree view
 * gets slow.
 */

import {
  childProjects,
  divisionForProject,
  getMember,
  getProject,
  projectBreadcrumb,
  projectMembers,
  projectREs,
  projects,
  projectUpdateFeed,
  divisions,
} from "@/lib/mock-data";
import type {
  Member,
  Project,
  ProjectMembership,
  Team,
  UpdateEntry,
} from "@/lib/types";
import type { BreadcrumbNode } from "./my-work";

export interface ProjectTreeNode {
  project: Project;
  /** Primary RE first. */
  res: Member[];
  memberCount: number;
  children: ProjectTreeNode[];
}

export interface DivisionProjects {
  division: Team;
  lead?: Member;
  roots: ProjectTreeNode[];
}

function buildNode(project: Project): ProjectTreeNode {
  return {
    project,
    res: projectREs(project.id),
    memberCount: projectMembers(project.id).length,
    children: childProjects(project.id).map(buildNode),
  };
}

/**
 * Every project, grouped under the Division it ultimately belongs to.
 *
 * Grouping uses `divisionForProject`, which walks the org tree upward, rather
 * than matching `teamId` against divisions directly. A project owned by a
 * sub-team (Propulsion, say) would otherwise appear under no division at all
 * and be invisible on the page whose whole job is discoverability.
 */
export async function getProjectTree(): Promise<DivisionProjects[]> {
  const roots = projects.filter((p) => p.parentId === null);

  return divisions().map((division) => ({
    division,
    lead: division.leadId ? getMember(division.leadId) : undefined,
    roots: roots
      .filter((p) => divisionForProject(p.id)?.id === division.id)
      .map(buildNode),
  }));
}

/** Projects whose division can't be resolved — a data-integrity warning. */
export async function getOrphanedProjects(): Promise<Project[]> {
  return projects.filter(
    (p) => p.parentId === null && !divisionForProject(p.id)
  );
}

export interface ProjectMemberRow {
  membership: ProjectMembership;
  member?: Member;
}

export interface ProjectDetailView {
  project: Project;
  breadcrumb: BreadcrumbNode[];
  division?: Team;
  res: Member[];
  members: ProjectMemberRow[];
  children: ProjectTreeNode[];
  parent?: Project;
  /** Every update entry written about this project, newest first. */
  updateFeed: {
    entry: UpdateEntry;
    author?: Member;
    submittedAt: string;
  }[];
}

export async function getProjectBySlug(
  slug: string
): Promise<ProjectDetailView | null> {
  const project = projects.find((p) => p.slug === slug);
  if (!project) return null;

  return {
    project,
    breadcrumb: projectBreadcrumb(project.id),
    division: divisionForProject(project.id),
    res: projectREs(project.id),
    members: projectMembers(project.id).map((pm) => ({
      membership: pm,
      member: pm.member,
    })),
    children: childProjects(project.id).map(buildNode),
    parent: project.parentId ? getProject(project.parentId) : undefined,
    updateFeed: projectUpdateFeed(project.id).map((f) => ({
      entry: f.entry,
      author: getMember(f.memberId),
      submittedAt: f.submittedAt,
    })),
  };
}

/** Every project slug — used to pre-render detail pages at build time. */
export async function getAllProjectSlugs(): Promise<string[]> {
  return projects.map((p) => p.slug);
}
