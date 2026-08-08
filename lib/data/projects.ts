/**
 * Project tree and project detail.
 *
 * PHASE 1 NOTE: `getProjectTree` is the one query worth turning into a single
 * recursive CTE (`v_project_tree` in docs/DATA_MODEL.md). Fetching children per
 * node would be a round trip per project — that's the classic way a tree view
 * gets slow.
 */

import {
  activeMembers,
  artifactsFor,
  childProjects,
  divisionForProject,
  getMember,
  getProject,
  isOverdue,
  pendingRequestsFor,
  projectAttentionFlags,
  projectBreadcrumb,
  projectDeliverables,
  projectMembers,
  projectProgress,
  projectREs,
  projectUpdateFeed,
  divisions,
  TODAY,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import type {
  Deliverable,
  JoinRequest,
  Member,
  Project,
  ProjectArtifact,
  ProjectAttentionFlag,
  ProjectMembership,
  Team,
  UpdateEntry,
} from "@/lib/types";

function daysWaitingOn(since: string): number {
  const ms = new Date(TODAY).getTime() - new Date(since).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
import type { BreadcrumbNode } from "./my-work";

export interface ProjectTreeNode {
  project: Project;
  /** Primary RE first. */
  res: Member[];
  /** Committed members only — following doesn't count as staffing. */
  memberCount: number;
  progress: ReturnType<typeof projectProgress>;
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
    memberCount: projectMembers(project.id).filter(
      (pm) => pm.commitment === "committed"
    ).length,
    progress: projectProgress(project.id),
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
  const roots = readStore().projects.filter((p) => p.parentId === null);

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
  return readStore().projects.filter(
    (p) => p.parentId === null && !divisionForProject(p.id)
  );
}

export interface ProjectMemberRow {
  membership: ProjectMembership;
  member?: Member;
}

export interface DeliverableRowData {
  deliverable: Deliverable;
  owner?: Member;
  overdue: boolean;
}

export interface ProjectDetailView {
  project: Project;
  breadcrumb: BreadcrumbNode[];
  division?: Team;
  res: Member[];
  members: ProjectMemberRow[];
  children: ProjectTreeNode[];
  parent?: Project;
  /** The whole task model: one flat list, one owner each. */
  deliverables: DeliverableRowData[];
  /** The project's engineering record — mostly links, not uploads. */
  artifacts: { artifact: ProjectArtifact; uploadedBy?: Member }[];
  progress: ReturnType<typeof projectProgress>;
  /** Why this project may need leadership attention. */
  attentionFlags: ProjectAttentionFlag[];
  /** Every update entry written about this project, newest first. */
  updateFeed: {
    entry: UpdateEntry;
    author?: Member;
    submittedAt: string;
  }[];
  /** Requests waiting on the RE, with requester attached. */
  pendingRequests: {
    request: JoinRequest;
    requester?: Member;
    daysWaiting: number;
  }[];
  /** The viewer's own pending request, if they've already asked. */
  myPendingRequest?: JoinRequest;
  /**
   * Who an RE can hand work to: everyone active, not just current members.
   *
   * Assigning a deliverable is how someone gets added (the action auto-adds
   * them), so limiting this to existing members would reintroduce the two-step
   * that decision removed. It lives here rather than in the page because pages
   * are not allowed to import `lib/mock-data` — ESLint enforces that boundary.
   */
  assignableMembers: { id: string; fullName: string }[];
}

export async function getProjectBySlug(
  slug: string,
  viewerId: string
): Promise<ProjectDetailView | null> {
  const project = readStore().projects.find((p) => p.slug === slug);
  if (!project) return null;

  const allFlags = projectAttentionFlags();
  const requests = pendingRequestsFor(project.id);

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
    deliverables: projectDeliverables(project.id).map((d) => ({
      deliverable: d,
      owner: getMember(d.ownerId),
      overdue: isOverdue(d),
    })),
    artifacts: artifactsFor(project.id).map((a) => ({
      artifact: a,
      uploadedBy: getMember(a.uploadedById),
    })),
    progress: projectProgress(project.id),
    attentionFlags: allFlags.filter((f) => f.projectId === project.id),
    updateFeed: projectUpdateFeed(project.id).map((f) => ({
      entry: f.entry,
      author: getMember(f.memberId),
      submittedAt: f.submittedAt,
    })),
    pendingRequests: requests.map((r) => ({
      request: r,
      requester: getMember(r.memberId),
      daysWaiting: daysWaitingOn(r.requestedAt),
    })),
    myPendingRequest: requests.find((r) => r.memberId === viewerId),
    assignableMembers: activeMembers().map((m) => ({
      id: m.id,
      fullName: m.fullName,
    })),
  };
}

/**
 * Options the "new project" form needs.
 *
 * Here rather than in the page because pages may not import `lib/mock-data`.
 */
export async function getProjectFormOptions(): Promise<{
  parents: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
  people: { id: string; name: string }[];
}> {
  return {
    parents: readStore().projects.map((p) => ({ id: p.id, name: p.name })),
    divisions: divisions().map((d) => ({ id: d.id, name: d.name })),
    people: activeMembers().map((m) => ({ id: m.id, name: m.fullName })),
  };
}

/** Every project slug — used to pre-render detail pages at build time. */
export async function getAllProjectSlugs(): Promise<string[]> {
  return readStore().projects.map((p) => p.slug);
}
