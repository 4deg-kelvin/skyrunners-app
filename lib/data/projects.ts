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
  archivedDivisions,
  artifactsFor,
  childProjects,
  childTeams,
  divisionForProject,
  getMember,
  getProject,
  isOverdue,
  pendingRequestsFor,
  projectAttentionFlags,
  projectBreadcrumb,
  projectDeliverables,
  projectMembers,
  projectNotices,
  projectProgress,
  projectREs,
  projectUpdateFeed,
  divisions,
  today,
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
  ProjectNotice,
  Team,
  UpdateEntry,
} from "@/lib/types";

function daysWaitingOn(since: string): number {
  const ms = new Date(today()).getTime() - new Date(since).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
import type { BreadcrumbNode } from "./my-work";
import { preloadLiveStore } from "@/lib/store/request";

export interface ProjectTreeNode {
  project: Project;
  /** Primary RE first. */
  res: Member[];
  /** Committed members only — following doesn't count as staffing. */
  memberCount: number;
  progress: ReturnType<typeof projectProgress>;
  /**
   * Deliverables somebody has marked blocked.
   *
   * Separate from `project.health`, which is the RE's own judgement and only
   * changes when they update it. Someone marking their work blocked is a fact,
   * and it needs to reach the page people browse — otherwise the person who
   * could unblock them never finds out.
   */
  blockedCount: number;
  children: ProjectTreeNode[];
}

export interface DivisionProjects {
  division: Team;
  lead?: Member;
  roots: ProjectTreeNode[];
}

/**
 * Every project under this one, at any depth.
 *
 * Cycle-guarded: `parentId` is a plain column, and a project reparented under
 * its own child would spin here rather than fail. Mirrors the guard in
 * `operations.ts`, which is what actually refuses the completion — this copy
 * exists so the page can warn first.
 */
function descendantsOf(projectId: string): Project[] {
  const found: Project[] = [];
  const seen = new Set<string>([projectId]);
  let frontier = [projectId];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const parentId of frontier) {
      for (const child of childProjects(parentId)) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        found.push(child);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return found;
}

function buildNode(project: Project): ProjectTreeNode {
  return {
    project,
    res: projectREs(project.id),
    memberCount: projectMembers(project.id).filter(
      (pm) => pm.commitment === "committed"
    ).length,
    progress: projectProgress(project.id),
    blockedCount: projectDeliverables(project.id).filter(
      (d) => d.status === "blocked"
    ).length,
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
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
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
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
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
    /** Which RE answered this section, if one has. */
    responder?: Member;
  }[];
  /**
   * Automatic announcements, newest first, with the chain they went up
   * resolved to names. Rendered in the same feed as `updateFeed`.
   */
  notices: {
    notice: ProjectNotice;
    actor?: Member;
    notified: Member[];
  }[];
  /**
   * Sub-projects at any depth that aren't complete yet.
   *
   * The operation refuses a completion while this is non-empty. Surfacing it
   * here lets the edit form say so BEFORE the submit, rather than only in the
   * error afterwards — the difference between a rule and a rejection.
   */
  incompleteDescendants: { id: string; name: string; slug: string }[];
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
  /**
   * Teams this project could belong to, for the owning-team picker.
   *
   * Both `/projects` and `/find-work` group by division and resolve it by
   * walking up from the project's team, so a project with no team shows up on
   * neither. Fixing that has to be possible from the project itself.
   */
  teamOptions: { id: string; name: string }[];
}

export async function getProjectBySlug(
  slug: string,
  viewerId: string
): Promise<ProjectDetailView | null> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
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
      responder: f.entry.respondedBy
        ? getMember(f.entry.respondedBy)
        : undefined,
    })),
    notices: projectNotices(project.id).map((notice) => ({
      notice,
      actor: getMember(notice.createdById),
      // Resolved here, not in the page: a lookup per recipient inside a render
      // loop is one query per row once this is Postgres.
      notified: notice.notifiedMemberIds
        .map((id) => getMember(id))
        .filter((m): m is Member => Boolean(m)),
    })),
    incompleteDescendants: descendantsOf(project.id)
      .filter((p) => p.phase !== "complete")
      .map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
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
    teamOptions: readStore()
      .teams.filter((t) => t.isActive)
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
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
  await preloadLiveStore();
  return {
    /*
      Two kinds of project can't be a parent for new work.

      **In an archived division.** `createProject` gives a sub-project its
      parent's `teamId`, so picking one would file brand-new work into a
      retired division — where it renders on neither /projects nor /find-work,
      since both group by ACTIVE division. The project would exist, be
      assigned, and be invisible: the disappearing-work failure this app was
      built to remove, arriving through the door archiving just opened.

      **Already complete.** A live child under a finished parent is exactly the
      state `updateProject` refuses to create from the other direction. Offering
      it here would let the form build in one click what the rule forbids, and
      the parent could then never be edited again without reopening it. If work
      really does resume, reopening the parent is the honest move — and it
      announces itself.
    */
    parents: readStore()
      .projects.filter(
        (p) =>
          p.phase !== "complete" && divisionForProject(p.id)?.isActive !== false
      )
      .map((p) => ({ id: p.id, name: p.name })),
    divisions: divisions().map((d) => ({ id: d.id, name: d.name })),
    people: activeMembers().map((m) => ({ id: m.id, name: m.fullName })),
  };
}

/** How many divisions sit in the archive. Drives the link on /projects. */
export async function countArchivedDivisions(): Promise<number> {
  await preloadLiveStore();
  return archivedDivisions().length;
}

export interface ArchivedDivision {
  division: Team;
  lead?: Member;
  archivedBy?: Member;
  /** Sub-teams that went with it, so the shape of what was retired is legible. */
  subTeams: Team[];
  /**
   * What it built. Every project that still points at this division or one of
   * its sub-teams — which is the entire reason archiving exists rather than
   * deleting.
   */
  projects: {
    project: Project;
    res: Member[];
    /** Signed-off deliverables. The honest measure of what got finished. */
    delivered: number;
  }[];
  /** Everyone whose primary team was here. Alumni included, deliberately. */
  memberCount: number;
}

/**
 * The archive: divisions that were retired, and what they did.
 *
 * Readable by every member, not just Co-Leads. This is the club's record of
 * what it has built, and the transparency rule applies to activity — the thing
 * gated on leadership is restoring one, which happens in the action.
 */
export async function getArchivedDivisions(): Promise<ArchivedDivision[]> {
  await preloadLiveStore();
  const store = readStore();

  return archivedDivisions().map((division) => {
    // The sub-tree, so a project owned by a sub-team still shows up here
    // rather than looking like it belonged to nothing.
    const teamIds = new Set<string>([division.id]);
    const subTeams: Team[] = [];
    const frontier = [division.id];
    for (let i = 0; i < frontier.length; i++) {
      for (const child of childTeams(frontier[i])) {
        if (teamIds.has(child.id)) continue;
        teamIds.add(child.id);
        subTeams.push(child);
        frontier.push(child.id);
      }
    }

    return {
      division,
      lead: division.leadId ? getMember(division.leadId) : undefined,
      archivedBy: division.archivedBy
        ? getMember(division.archivedBy)
        : undefined,
      subTeams,
      projects: store.projects
        .filter((p) => p.teamId && teamIds.has(p.teamId))
        .map((project) => ({
          project,
          res: projectREs(project.id),
          delivered: projectDeliverables(project.id).filter(
            (d) => d.status === "done"
          ).length,
        }))
        .sort((a, b) => a.project.name.localeCompare(b.project.name)),
      memberCount: store.members.filter(
        (m) => m.primaryTeamId && teamIds.has(m.primaryTeamId)
      ).length,
    };
  });
}

/** Every project slug — used to pre-render detail pages at build time. */
export async function getAllProjectSlugs(): Promise<string[]> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  return readStore().projects.map((p) => p.slug);
}
