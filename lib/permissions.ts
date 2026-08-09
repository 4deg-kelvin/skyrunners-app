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
 *   2. Are you an RE of this project, or of any
 *      project ABOVE it — or do you LEAD a team
 *      that owns any of them?                    -> you own this project subtree
 *   3. Are you this member's Lead,
 *      directly or anywhere up their chain?      -> you oversee this person
 *   4. Is it your own data?                      -> you can always manage it
 *
 * If none of the four are true, the answer is no.
 *
 * Three ideas make this work, and all three are *inheritance*:
 *
 *   - RE authority flows DOWN the project tree. RE of "eVTOL Airframe" can act
 *     on every sub-project beneath it, however deep. There is no depth limit
 *     and there never was — `projectChain` walks to the root.
 *   - Lead authority flows UP the reporting chain. Your Lead's Lead oversees
 *     you too.
 *   - **A Division Lead is a top RE.** Team-lead authority flows DOWN the org
 *     tree and then down the project tree: leading a division gives you RE
 *     powers on every project inside it, and leading a sub-team gives you them
 *     on that sub-team's projects. Q2 is where this lands, deliberately — one
 *     function, so every project rule inherits it at once.
 *
 * Everything else in this file is those four questions applied to specific
 * actions.
 */

import type { GlobalRole, Member, Project, Team } from "./types.ts";

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
  /**
   * A team or division by id.
   *
   * Here because a Division Lead is a top RE over everything in their division
   * (see `leadsTeamAbove`), and answering that needs the org tree. Synchronous
   * like the other three, and for the same reason: it's called in a loop while
   * walking up from a project's team, so a query per call would turn one
   * permission check into several round trips.
   */
  getTeam(id: string): Team | undefined;
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
 * Every team at or above this one, nearest first. Cycle-guarded, like the rest.
 */
export function teamChain(graph: OrgGraph, teamId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = teamId;

  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = graph.getTeam(current)?.parentId ?? null;
  }
  return chain;
}

/**
 * Does the actor lead a team that owns this project, or one above it?
 *
 * **A Division Lead is a top RE.** They're accountable for everything their
 * division builds, so they must be able to do what an RE can do — add
 * deliverables, sign work off, answer join requests, appoint REs — on any
 * project inside it. Before this they could do none of that unless they
 * happened to also be an RE or the person's Lead: they owned the division on
 * the org chart and had no authority inside it, which is the "leaders can't see
 * who's contributing" problem wearing a different hat.
 *
 * Scoped by two walks, both upward, and the pair is the point:
 *
 *   - up the PROJECT tree, so a lead whose team owns a parent project also
 *     covers its sub-projects — those inherit their parent's team by default
 *     and would otherwise slip out of the division's reach;
 *   - up the ORG tree from each of those projects' teams, so a sub-team lead
 *     covers their own team and the Division Lead covers everything beneath.
 *
 * It grants nothing sideways: leading Airframe gives you no say in Avionics,
 * because Avionics is in neither chain.
 */
export function leadsTeamAbove(
  actor: Actor,
  graph: OrgGraph,
  projectId: string
): boolean {
  for (const id of projectChain(graph, projectId)) {
    const teamId = graph.getProject(id)?.teamId;
    if (!teamId) continue;
    for (const owningTeamId of teamChain(graph, teamId)) {
      if (graph.getTeam(owningTeamId)?.leadId === actor.id) return true;
    }
  }
  return false;
}

/**
 * Q2 — RE authority, inherited down the project tree.
 *
 * True if the actor is an RE of this project or any ancestor of it, **or** if
 * they lead a team that owns any of them. Both are the same authority arriving
 * by different routes, so they belong in one function: every `can.*` rule about
 * a project routes through here, which is what makes "a Division Lead is a top
 * RE" one rule rather than twenty places to remember.
 *
 * Depth is unbounded and always has been — `projectChain` walks to the root. An
 * RE four levels up really does own everything below them.
 */
export function isREofOrAbove(
  actor: Actor,
  graph: OrgGraph,
  projectId: string
): boolean {
  const chain = projectChain(graph, projectId);
  if (chain.some((id) => graph.directREs(id).includes(actor.id))) return true;
  return leadsTeamAbove(actor, graph, projectId);
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

  /*
    `manageDivisions` used to sit here, identical to `manageTeams` below and
    called by nothing but its own test. Two names for one rule is how they
    drift: change the real one and the dead one keeps asserting the old
    behaviour, so the suite stays green while the app doesn't. Use
    `manageTeams` — divisions ARE teams with no parent.
  */

  /** A unit's Lead manages the units beneath it; Co-Leads manage anything. */
  manageTeam: (actor: Actor, graph: OrgGraph, teamLeadId?: string) =>
    isCoLead(actor) || (!!teamLeadId && teamLeadId === actor.id),

  /** Reassigning who someone reports to needs authority above them. */
  reassignLead: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) || isLeadOfOrAbove(actor, graph, memberId),

  /** Any Lead or Co-Lead can invite a new member by Stanford email. */
  inviteMember: (actor: Actor) => actor.globalRole !== "member",

  /**
   * Editing a profile — name shown, photo, major, year, phone, skills.
   *
   * Your own, always. A Co-Lead can also fix someone else's, because typos in a
   * name or a wrong class year otherwise need a database edit, and the person
   * who notices is rarely the person it belongs to.
   *
   * Nothing here grants authority: role, status, reporting line and email are
   * all excluded from `ProfileEdits`, so this can never be a way to promote
   * yourself.
   */
  editProfile: (actor: Actor, memberId: string) =>
    isSelf(actor, memberId) || isCoLead(actor),

  /**
   * Promoting or demoting someone — member ↔ lead ↔ co_lead.
   *
   * **Co-Leads only.** This is the one permission that can change the shape of
   * the permission system itself, so it sits at the very top and nowhere else.
   * If a Team Lead could appoint Team Leads, authority would spread sideways
   * with nobody accountable for it, and the reporting chain — which the whole
   * review and escalation model rests on — would stop meaning anything.
   *
   * A Co-Lead cannot change their OWN role. Not a trust question: it's the
   * lock-out guard. Demoting yourself while you're the only Co-Lead leaves a
   * club with nobody who can appoint anyone, recoverable only by hand-editing
   * the database. `setGlobalRole` in the store enforces the matching invariant
   * that the last Co-Lead can't be removed by anyone.
   */
  setGlobalRole: (actor: Actor, targetId: string) =>
    isCoLead(actor) && !isSelf(actor, targetId),

  /**
   * Deactivating or reactivating someone.
   *
   * Deliberately NOT deletion — history has to survive graduations, and a
   * deactivated member's past check-ins and delivered work stay attached to
   * their projects.
   *
   * Available to anyone above them in the chain, because the person who notices
   * someone has left the club is almost always their Lead, not a Co-Lead.
   */
  setMemberStatus: (actor: Actor, graph: OrgGraph, memberId: string) =>
    !isSelf(actor, memberId) &&
    (isCoLead(actor) || isLeadOfOrAbove(actor, graph, memberId)),

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

  /**
   * Verified by the member's Lead chain, or a Co-Lead.
   *
   * **A Co-Lead may verify their own**, and that exception is load-bearing
   * rather than a loophole. "Nobody self-verifies" assumes somebody is above
   * you; a Co-Lead is the top of the chain, so a blanket rule meant their
   * record could never be completed at all — a permanent dead end, and one
   * that quietly pushes them to stop recording trainings rather than to find
   * a second Co-Lead. A record nobody keeps is worse than one marked
   * self-verified, which is what the UI shows so it stays honest.
   *
   * Everyone else still needs someone above them, checked here AND again in
   * the operation.
   */
  verifyTraining: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) || isLeadOfOrAbove(actor, graph, memberId),

  grantAccess: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) || isLeadOfOrAbove(actor, graph, memberId),

  /**
   * Edit the catalogue itself — add a site, add a machine, retire one.
   *
   * Co-Lead only, same as divisions: it's the shape everything else hangs off.
   * Deliberately a LOW bar to use, though — the requirement is that adding a
   * training is a Co-Lead typing a name, not a developer shipping a deploy, so
   * nothing above this should make it feel like an administrative act.
   */
  manageTrainingCatalogue: (actor: Actor) => isCoLead(actor),

  // --- Events ------------------------------------------------------------

  /**
   * Put something on the calendar.
   *
   * Two different acts behind one name:
   *
   *   - A **club-wide event** (a general meeting, a company tour) is
   *     leadership's, because it implicitly asks everyone to show up.
   *   - An **engineering session on a project you're on** is anybody's. That
   *     is the case the calendar exists for: two people on the wing spar
   *     Thursday night, visible so a third can turn up. Requiring leadership
   *     to schedule that would put a Co-Lead back in the middle of exactly the
   *     thing this app removes them from.
   *
   * `isOnProject` is computed by the caller rather than looked up here —
   * `OrgGraph` has no membership lookup, and adding one for a single rule
   * would put a fifth synchronous method on a hot interface. Same shape as
   * `viewLeadershipDashboard(actor, hasReports)`.
   */
  createEvent: (actor: Actor, isOnProject = false) =>
    actor.globalRole !== "member" || isOnProject,

  /** Your own, or leadership tidying the club calendar. */
  manageEvent: (actor: Actor, createdBy?: string) =>
    actor.globalRole !== "member" || (!!createdBy && createdBy === actor.id),

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

  /**
   * Removing a deliverable outright — the RE's list, so the RE's call.
   *
   * Same authority as creating one. The operation refuses anything already
   * signed off, so this can't be used to erase someone's delivered work.
   */
  deleteDeliverable: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /**
   * Deleting a check-in: your own, or a Co-Lead clearing up.
   *
   * Deliberately NOT a Lead over their reports. A Lead removing a report they
   * were meant to read would erase both the obligation and the escalation,
   * which are the only things making review mean anything.
   */
  deleteCheckIn: (actor: Actor, authorId: string) =>
    isSelf(actor, authorId) || isCoLead(actor),

  /** Which team owns a project. Same authority as editing the project. */
  setProjectTeam: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /**
   * Editing a deliverable's title or date. Same authority as creating one.
   */
  editDeliverable: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /**
   * Deleting a project.
   *
   * `isREofOrAbove` is doing the important work: an RE of a PARENT project can
   * delete a child, because RE authority inherits down the project tree. An RE
   * of a sibling cannot, and neither can a plain member.
   */
  deleteProject: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /** Divisions and sub-teams are the org's shape — Co-Leads only. */
  manageTeams: (actor: Actor) => isCoLead(actor),

  /** Co-Leads set the club's hours expectation and tier thresholds. */
  configureExpectations: (actor: Actor) => isCoLead(actor),

  /** Co-Leads manage the academic calendar that gates all obligations. */
  manageTerms: (actor: Actor) => isCoLead(actor),

  // --- The blocker board ------------------------------------------------

  /**
   * Post an ask, or answer somebody else's.
   *
   * Unconditional for a signed-in member, like `followProject`. The board
   * exists BECAUSE membership is RE-controlled: it's the route to being useful
   * that doesn't wait on one person's inbox. Gating who may answer would
   * rebuild that bottleneck one level up, and "anyone can answer, not just
   * leadership" is the phase's stated point.
   */
  postHelpRequest: () => true,
  replyToHelpRequest: () => true,

  /**
   * Mark an ask sorted.
   *
   * The asker, whoever replied to it, or leadership. Not "anyone", because a
   * passer-by closing somebody's open question makes the board lie — but
   * restricting it to the asker alone strands every ask from someone who got
   * their answer elsewhere and never came back.
   */
  resolveHelpRequest: (
    actor: Actor,
    askerId: string,
    replierIds: string[]
  ) =>
    isSelf(actor, askerId) ||
    replierIds.includes(actor.id) ||
    isCoLead(actor),

  /** Your own ask, or a Co-Lead clearing up. */
  deleteHelpRequest: (actor: Actor, askerId: string) =>
    isSelf(actor, askerId) || isCoLead(actor),
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
