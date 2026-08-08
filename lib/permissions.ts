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

import type { GlobalRole, Member, Project } from "./types.ts";

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

  /**
   * ONLY an RE (or a Co-Lead) puts someone on a project.
   *
   * Members can't add themselves. The RE is accountable for the deliverable, so
   * they decide who's working on it — and it keeps rosters honest, since every
   * name on a project got there because someone with context said yes.
   *
   * No cap: an RE can staff a project with whoever they need, and a member can
   * be on as many projects as REs want them on.
   */
  addProjectMember: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  removeProjectMember: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /**
   * Following a project: no permission needed, unlimited.
   *
   * This is the self-service half. Members see everything happening across the
   * club and can watch anything — they just can't put themselves on the roster.
   */
  followProject: () => true,

  /**
   * Asking to join: any member, any project.
   *
   * This is the crucial counterpart to RE-controlled membership. "Go ask the RE"
   * via email produces silence and an invisible member; a tracked request lands
   * in the RE's queue, is visible to the member as pending, and escalates when
   * it goes stale. Same gate, no limbo.
   */
  requestToJoin: (_actor: Actor, project: Project) => project.isOpenToJoin,

  /** Accepting or declining a request — the RE's call. */
  reviewJoinRequest: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /** A member can always withdraw their own request. */
  withdrawJoinRequest: (actor: Actor, requesterId: string) =>
    isSelf(actor, requesterId),

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
  /**
   * A person's WHOLE effort record — total hours, reliability, their private
   * twice-weekly report.
   *
   * Reporting chain only. An RE used to qualify here via any shared project,
   * which leaked more than it should: being RE of one project a person
   * contributes to revealed their hours on every OTHER project, plus their
   * compliance record. An RE needs to know what's happening on their project,
   * not how someone is doing overall — that's the Lead's job.
   *
   * For the narrower question, use `viewMemberHoursOnProject`.
   */
  viewMemberEffort: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) ||
    isSelf(actor, memberId) ||
    isLeadOfOrAbove(actor, graph, memberId),

  /**
   * Hours ONE person logged on ONE project.
   *
   * The RE's legitimate need: "who is actually putting time into the thing I'm
   * accountable for?" Scoped to that project, and inheriting down the project
   * tree — an RE of a parent sees time on its children, because they're
   * accountable for that subtree.
   */
  viewMemberHoursOnProject: (
    actor: Actor,
    graph: OrgGraph,
    memberId: string,
    projectId: string
  ) =>
    isCoLead(actor) ||
    isSelf(actor, memberId) ||
    isLeadOfOrAbove(actor, graph, memberId) ||
    isREofOrAbove(actor, graph, projectId),

  /**
   * Reading someone's private twice-weekly report, and marking it reviewed.
   *
   * Reporting chain ONLY — deliberately not REs. A Lead reviews their own
   * reports and nobody else's, which is what makes the 15-minute weekly
   * obligation achievable and what makes the escalation in `lib/review.ts`
   * meaningful: if a report goes unread, exactly one person is accountable.
   *
   * REs are not cut out of the loop; they get the per-project half of the same
   * update through `viewProjectUpdates`, which is public.
   */
  reviewUpdate: (actor: Actor, graph: OrgGraph, authorId: string) =>
    isCoLead(actor) || isLeadOfOrAbove(actor, graph, authorId),

  /**
   * The per-project half of an update — progress, blockers, next steps.
   *
   * Public, on purpose. It belongs to the PROJECT, not to the person: it's the
   * project's history, it's how anyone finds out what's happening without
   * asking a Co-Lead, and it's what lets a passing member unblock someone.
   *
   * What stays private is the personal envelope around it — the general note,
   * the total across every project, and the reliability record.
   */
  viewProjectUpdates: () => true,

  /**
   * Opening the leadership dashboard at all.
   *
   * The nav already hides the link from plain members, but hiding a link is not
   * access control — the route was reachable by typing the URL, and it renders
   * other people's hours and a review queue. Anyone who oversees at least one
   * person has a reason to be here; nobody else does.
   *
   * Takes `graph` and the viewer's own id rather than just the role, because
   * "leads somebody" is a fact about the org tree, not about `globalRole`. A
   * member who has been given reports should see it; a `lead` with none has
   * nothing to look at.
   */
  viewLeadershipDashboard: (actor: Actor, hasReports: boolean) =>
    isCoLead(actor) || hasReports,

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

  // --- Deliverables ------------------------------------------------------

  /** REs shape the list; that's the five minutes a week the model costs them. */
  manageDeliverables: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /** You can always update the status of something you own. */
  updateDeliverableStatus: (
    actor: Actor,
    graph: OrgGraph,
    projectId: string,
    ownerId: string
  ) =>
    isSelf(actor, ownerId) ||
    isCoLead(actor) ||
    isREofOrAbove(actor, graph, projectId),

  // --- Contribution record ------------------------------------------------

  /**
   * A member can always see their OWN contribution record.
   *
   * This is the point of the whole model: "members should know their efforts are
   * being tracked and not wasted" only works if they can see the tracking. A
   * record that decides advancement but stays hidden from its subject is a
   * performance review with a concealed scale.
   */
  viewOwnContribution: () => true,

  /** Someone else's record: their Lead chain, or an RE they work for. */
  /**
   * The four contribution signals for one person.
   *
   * Same reporting-chain-only rule as `viewMemberEffort`, and for the same
   * reason: reliability and commitment describe the person, not the project, so
   * they belong to whoever is responsible for supporting that person. An RE
   * sharing one project is not that.
   */
  viewMemberContribution: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) ||
    isSelf(actor, memberId) ||
    isLeadOfOrAbove(actor, graph, memberId),

  /** Co-Leads set the club's hours expectation and tier thresholds. */
  configureExpectations: (actor: Actor) => isCoLead(actor),

  /** Co-Leads manage the academic calendar that gates all obligations. */
  manageTerms: (actor: Actor) => isCoLead(actor),
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
 * Restricted: raw individual hour totals, update contents, contribution records,
 * and private Lead notes.
 */
export const PUBLIC_TO_ALL_MEMBERS = true;
