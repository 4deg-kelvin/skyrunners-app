/**
 * ============================================================================
 * PERMISSIONS — the single source of truth for "who can do what"
 * ============================================================================
 *
 * Every write in this app routes through this file. Nothing checks roles
 * inline. If a rule is wrong, there is exactly one place to fix it.
 *
 * ----------------------------------------------------------------------------
 * The whole model reduces to FOUR questions:
 * ----------------------------------------------------------------------------
 *
 *   1. Are you a Co-Lead?                        -> you can do anything
 *   2. Are you an RE of this project,
 *      or of any project ABOVE it?               -> you own this project subtree
 *   3. Are you this member's Lead,
 *      directly or anywhere up their chain?      -> you oversee this person
 *   4. Is it your own data?                      -> you can always manage it
 *
 * If none of the four are true, the answer is no.
 *
 * Two ideas make this work, and both are *inheritance*:
 *
 *   - RE authority flows DOWN the project tree. RE of "eVTOL Airframe" can act
 *     on every sub-project beneath it, however deep.
 *   - Lead authority flows UP the reporting chain. Your Lead's Lead oversees
 *     you too.
 *
 * Everything else in this file is those four questions applied to specific
 * actions.
 */

import type { GlobalRole, Member, Project } from "./types";

// ---------------------------------------------------------------------------
// The actor: everything we need to know about who is asking
// ---------------------------------------------------------------------------

export interface Actor {
  id: string;
  globalRole: GlobalRole;
}

/**
 * Graph lookups the permission checks need. Backed by mock data now, by
 * Postgres queries later — the rules don't change either way.
 */
export interface OrgGraph {
  getMember(id: string): Member | undefined;
  getProject(id: string): Project | undefined;
  /** REs of this project only — not inherited. */
  directREs(projectId: string): string[];
}

// ---------------------------------------------------------------------------
// The four questions
// ---------------------------------------------------------------------------

/** Q1 */
export function isCoLead(actor: Actor): boolean {
  return actor.globalRole === "co_lead";
}

/** Walk from a project up to the root, collecting ancestors (inclusive). */
export function projectChain(graph: OrgGraph, projectId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = projectId;

  while (current && !seen.has(current)) {
    seen.add(current); // cycle guard — a malformed tree must not hang the app
    chain.push(current);
    current = graph.getProject(current)?.parentId ?? null;
  }
  return chain;
}

/**
 * Q2 — RE authority, inherited down the project tree.
 * True if the actor is an RE of this project or any ancestor of it.
 */
export function isREofOrAbove(
  actor: Actor,
  graph: OrgGraph,
  projectId: string
): boolean {
  return projectChain(graph, projectId).some((id) =>
    graph.directREs(id).includes(actor.id)
  );
}

/** Walk from a member up their reporting chain, collecting their Leads. */
export function leadChain(graph: OrgGraph, memberId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([memberId]);
  let current = graph.getMember(memberId)?.leadId ?? null;

  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = graph.getMember(current)?.leadId ?? null;
  }
  return chain;
}

/**
 * Q3 — Lead authority, inherited up the reporting chain.
 * True if the actor is this member's Lead, or their Lead's Lead, etc.
 */
export function isLeadOfOrAbove(
  actor: Actor,
  graph: OrgGraph,
  memberId: string
): boolean {
  return leadChain(graph, memberId).includes(actor.id);
}

/** Q4 */
export function isSelf(actor: Actor, memberId: string): boolean {
  return actor.id === memberId;
}

// ---------------------------------------------------------------------------
// Rules — each one is the four questions, applied
// ---------------------------------------------------------------------------

export const can = {
  // --- Org structure ---------------------------------------------------

  /** Only Co-Leads add or remove Divisions. */
  manageDivisions: (actor: Actor) => isCoLead(actor),

  /** A unit's Lead manages the units beneath it; Co-Leads manage anything. */
  manageTeam: (actor: Actor, graph: OrgGraph, teamLeadId?: string) =>
    isCoLead(actor) || (!!teamLeadId && teamLeadId === actor.id),

  /** Reassigning who someone reports to needs authority above them. */
  reassignLead: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) || isLeadOfOrAbove(actor, graph, memberId),

  /** Any Lead or Co-Lead can invite a new member by Stanford email. */
  inviteMember: (actor: Actor) => actor.globalRole !== "member",

  // --- Projects --------------------------------------------------------

  /**
   * Creating projects should feel effortless for leadership, so this is
   * deliberately permissive: any Lead, or any RE creating a sub-project
   * under something they already own.
   */
  createProject: (actor: Actor, graph: OrgGraph, parentProjectId?: string) =>
    isCoLead(actor) ||
    actor.globalRole === "lead" ||
    (!!parentProjectId && isREofOrAbove(actor, graph, parentProjectId)),

  /** Edit details, phase, dates, artifacts, requirements, tasks. */
  manageProject: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /** Appoint or remove REs — multiple REs per project are allowed. */
  assignRE: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /** An RE can add people to their project or anything beneath it. */
  addProjectMember: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /**
   * Self-enrollment. Open by default — the entire point is that members
   * can join anything that interests them without asking permission.
   */
  joinProject: (_actor: Actor, project: Project) => project.isOpenToJoin,

  // --- Hours and updates ------------------------------------------------

  logOwnHours: (actor: Actor, memberId: string) => isSelf(actor, memberId),

  submitOwnUpdate: (actor: Actor, memberId: string) => isSelf(actor, memberId),

  /** Members choose their own three update days. */
  setOwnSchedule: (actor: Actor, memberId: string) => isSelf(actor, memberId),

  /**
   * Reading someone's hours and updates. Restricted, per the decision to keep
   * raw individual effort data out of public view:
   *   - yourself
   *   - anyone up your reporting chain
   *   - an RE of a project you contribute to (or any ancestor of it)
   */
  viewMemberEffort: (
    actor: Actor,
    graph: OrgGraph,
    memberId: string,
    memberProjectIds: string[] = []
  ) =>
    isCoLead(actor) ||
    isSelf(actor, memberId) ||
    isLeadOfOrAbove(actor, graph, memberId) ||
    memberProjectIds.some((pid) => isREofOrAbove(actor, graph, pid)),

  /** Reviewing an update: their Lead chain, or an RE of a referenced project. */
  reviewUpdate: (
    actor: Actor,
    graph: OrgGraph,
    authorId: string,
    updateProjectIds: string[] = []
  ) =>
    isCoLead(actor) ||
    isLeadOfOrAbove(actor, graph, authorId) ||
    updateProjectIds.some((pid) => isREofOrAbove(actor, graph, pid)),

  /** Leads roll their reports' updates up the chain. */
  submitRollup: (actor: Actor) => actor.globalRole !== "member",

  // --- Trainings and facility access ------------------------------------

  /** Members request; nobody self-verifies. */
  requestTraining: (actor: Actor, memberId: string) =>
    isSelf(actor, memberId),

  /** Verified by the member's direct Lead (or above), or a Co-Lead. */
  verifyTraining: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) || isLeadOfOrAbove(actor, graph, memberId),

  grantAccess: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) || isLeadOfOrAbove(actor, graph, memberId),

  // --- Events ------------------------------------------------------------

  createEvent: (actor: Actor) => actor.globalRole !== "member",

  /** Deliberately not scope-limited: leadership can invite anyone, anywhere. */
  inviteToEvent: (actor: Actor) => actor.globalRole !== "member",

  recordAttendance: (actor: Actor) => actor.globalRole !== "member",

  /** Anyone can propose a 1:1 with anyone. */
  requestMeeting: () => true,

  // --- Engagement --------------------------------------------------------

  configureEngagementWeights: (actor: Actor) => isCoLead(actor),

  /** Rankings stay with leadership — a flashlight, not a scoreboard. */
  viewEngagementRankings: (
    actor: Actor,
    graph: OrgGraph,
    memberId?: string
  ) =>
    isCoLead(actor) ||
    (!!memberId && isLeadOfOrAbove(actor, graph, memberId)),
};

/**
 * Things every authenticated Stanford member can see, no checks needed.
 * Listing them explicitly is the point: transparency is the default, and
 * restriction is the exception.
 *
 *   - the full division and team tree
 *   - every project: phase, health, REs, members, responsibilities, artifacts
 *   - who is working on what
 *   - the club calendar and events
 *   - the roster and everyone's profile basics, trainings, and access
 *   - Gantt charts and milestones
 *
 * Restricted: raw individual hour totals, update contents, engagement ranks,
 * and private Lead notes.
 */
export const PUBLIC_TO_ALL_MEMBERS = true;
