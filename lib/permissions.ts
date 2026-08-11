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

/**
 * Runs the club, or part of it. A Lead or a Co-Lead — nobody else.
 *
 * This exists because `globalRole !== "member"` used to mean this, in twenty
 * places, and that shorthand was a landmine the moment a fourth role appeared:
 * `advisor` is not a member, so every one of those checks would have silently
 * granted a professor the ability to invite people, admit them, create
 * club-wide events, record attendance and file roll-ups.
 *
 * Named rather than inlined so the next role added has one place to be
 * considered instead of twenty places to be missed.
 */
export function isLeadership(actor: Actor): boolean {
  return actor.globalRole === "lead" || actor.globalRole === "co_lead";
}

/**
 * A faculty or project advisor.
 *
 * Sees everything, can say something about anything, builds nothing. The
 * permission model handles most of this by omission — an advisor is never an
 * RE and never in anybody's Lead chain, so every project and review right
 * declines on its own. This predicate is for the handful of places that have
 * to say something POSITIVE about them: letting them comment, and keeping them
 * out of machinery that assumes a person does engineering work.
 *
 * The things it must keep them out of are all obligations rather than
 * permissions — check-in generation, the commitment tiers, the Lead dropdown,
 * the "you haven't logged hours" nudge. An advisor with a check-in obligation
 * would be late forever, through a page they cannot even reach.
 */
export function isAdvisor(actor: Actor | { globalRole: GlobalRole }): boolean {
  return actor.globalRole === "advisor";
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

/**
 * Does the actor lead this team, or one above it in the org tree?
 *
 * The team-only half of `leadsTeamAbove`, which walks the project tree first.
 * Used where the target is a division rather than a project — filing new work,
 * where there is no project to walk up from yet.
 */
export function leadsTeamAtOrAbove(
  actor: Actor,
  graph: OrgGraph,
  teamId: string
): boolean {
  for (const id of teamChain(graph, teamId)) {
    if (graph.getTeam(id)?.leadId === actor.id) return true;
  }
  return false;
}

/**
 * Q2b — RE authority arriving from STRICTLY ABOVE this project.
 *
 * ---------------------------------------------------------------------------
 * Doing the work and approving the work are different jobs
 * ---------------------------------------------------------------------------
 *
 * `isREofOrAbove` answers "may you act on this project". This answers the
 * narrower question "may you APPROVE it" — and the difference is that the
 * project's own RE is excluded, whatever else is true about them.
 *
 * The assigned RE is accountable for FINISHING a project. The RE above them —
 * or the Division Lead, who is a top RE — is accountable for reviewing it and
 * agreeing it's actually done. Letting one person hold both means "complete"
 * only ever means "the person who built it says so", which is exactly what the
 * two-step deliverable sign-off already refuses at the smaller scale.
 *
 * Only two things go through here, and both are the same act — withdrawing or
 * granting an approval on someone else's work:
 *
 *   - marking a project complete           (`can.completeProject`)
 *   - challenging a signed-off deliverable (`can.withdrawSignOff`)
 *
 * Everything else about a project still runs on `isREofOrAbove`, because the
 * assigned RE must be able to do their job.
 *
 * **Being the project's own RE disqualifies you even if you'd qualify another
 * way.** A Division Lead who assigns a project to themselves is wearing both
 * hats, and the app can't fix that organizationally — but it can decline to
 * pretend a review happened. It escalates to whoever is above them.
 *
 * **Co-Leads are the escape hatch**, checked by the callers rather than here.
 * Without one, a Co-Lead who is the RE of a top-level project could never
 * complete it — there is nobody above them — and the project would be stuck
 * forever. That fallback is why this can be strict everywhere else.
 */
export function isREaboveProject(
  actor: Actor,
  graph: OrgGraph,
  projectId: string
): boolean {
  if (graph.directREs(projectId).includes(actor.id)) return false;

  // `projectChain` starts AT the project, so drop the head: only ancestors.
  const ancestors = projectChain(graph, projectId).slice(1);
  if (ancestors.some((id) => graph.directREs(id).includes(actor.id))) {
    return true;
  }

  // The Division Lead route. A team lead sits above the projects their team
  // owns by org position rather than project position, which is what makes
  // them the reviewer of record for a top-level project with no parent.
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
  inviteMember: (actor: Actor) => isLeadership(actor),

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

  /**
   * Letting somebody INTO the club for the first time.
   *
   * Separate from `setMemberStatus`, and the difference is not cosmetic. A
   * person who has just signed in with no invite has **no Lead** — the trigger
   * in migration 0005 creates their profile with `lead_id` null — so
   * `isLeadOfOrAbove` can never be true for anybody, and the rule above admits
   * only Co-Leads. The roster's Access panel meanwhile offers Activate to every
   * Lead, which made it a dead control for five of the club's seven leaders:
   * the button was there, and pressing it was refused.
   *
   * Any Lead or Co-Lead, because this is the same act as inviting somebody —
   * `can.inviteMember` is already exactly that wide — and the person who sent
   * them the link is the person who should be able to finish the job. Making
   * them find a Co-Lead recreates the "ask a specific person and wait" dead end
   * that this app exists to remove, at the very first moment a new member
   * touches it.
   *
   * Deliberately NOT wider than the first admission. Once they're in and have a
   * Lead, deactivating them goes back through `setMemberStatus`, which is
   * chain-scoped — removing somebody from the club is a heavier act than
   * welcoming them, and it belongs to whoever is accountable for them.
   */
  admitMember: (actor: Actor, memberId: string) =>
    !isSelf(actor, memberId) && isLeadership(actor),

  // --- Projects --------------------------------------------------------

  /**
   * Creating projects should feel effortless for leadership, so this is
   * deliberately permissive: any Lead, or any RE creating a sub-project
   * under something they already own.
   */
  createProject: (
    actor: Actor,
    graph: OrgGraph,
    target: { parentProjectId?: string; teamId?: string } = {}
  ) => {
    if (isCoLead(actor)) return true;

    // Under something they already own: RE authority, inheriting down.
    if (target.parentProjectId) {
      return isREofOrAbove(actor, graph, target.parentProjectId);
    }

    /*
      Otherwise it lands in a division, and a Lead may only file work into a
      unit they actually lead.

      This used to be a bare `globalRole === "lead"` — the only unscoped rule in
      the file, so a sub-team lead in Airframe could start a top-level project
      in Avionics. That contradicts every other rule here, which all ask WHERE,
      and it's the shape of the silo problem the app exists to remove: work
      appearing in a division whose lead didn't know about it and isn't
      accountable for it.

      Walks UP the org tree, so a Division Lead covers their sub-teams and a
      sub-team lead covers only their own. Nothing sideways.
    */
    if (target.teamId) return leadsTeamAtOrAbove(actor, graph, target.teamId);

    // No target named. This is the "should the button exist at all" question,
    // and it can't be answered here — `OrgGraph` looks teams up by id and has
    // no way to enumerate them. The page asks `creatableDivisions` instead.
    return false;
  },

  /** Edit details, phase, dates, artifacts, requirements, tasks. */
  manageProject: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /**
   * Marking a project COMPLETE — the review step, not the editing step.
   *
   * Deliberately narrower than `manageProject`: the assigned RE runs the
   * project and can change anything else about it, but cannot declare their own
   * work finished. See `isREaboveProject` for why, and for the Co-Lead escape
   * hatch that stops the top of the tree deadlocking.
   *
   * Only guards the crossing INTO complete. Reopening runs on `manageProject`,
   * because admitting something isn't finished makes the record more
   * conservative, not less — and an RE whose project has restarted must not
   * need permission to say so.
   */
  completeProject: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREaboveProject(actor, graph, projectId),

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
  /*
    Anybody may ask, always.

    This used to return `project.isOpenToJoin`, which turned "we're not
    recruiting right now" into "you may not even ask" — and hid the button
    that is the entire point of Find Work. A member who can't ask has no route
    in at all except knowing somebody, which is the problem this app exists to
    remove.

    `isOpenToJoin` is now a SIGNAL: the card says the RE isn't looking, so
    nobody wastes an ask, and somebody who really is the right person can still
    make the case. The RE decides either way — that hasn't changed.
  */
  requestToJoin: () => true,

  /** Accepting or declining a request — the RE's call. */
  reviewJoinRequest: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /** A member can always withdraw their own request. */
  withdrawJoinRequest: (actor: Actor, requesterId: string) =>
    isSelf(actor, requesterId),

  // --- Hours and updates ------------------------------------------------

  logOwnHours: (actor: Actor, memberId: string) => isSelf(actor, memberId),

  submitOwnUpdate: (actor: Actor, memberId: string) => isSelf(actor, memberId),

  /** Members choose which weekdays they check in on. */
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
  submitRollup: (actor: Actor) => isLeadership(actor),

  // --- Trainings and facility access ------------------------------------

  /** Members request; nobody self-verifies. */
  requestTraining: (actor: Actor, memberId: string) => isSelf(actor, memberId),

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
    isLeadership(actor) || isOnProject,

  /** Your own, or leadership tidying the club calendar. */
  manageEvent: (actor: Actor, createdBy?: string) =>
    isLeadership(actor) || (!!createdBy && createdBy === actor.id),

  /** Deliberately not scope-limited: leadership can invite anyone, anywhere. */
  inviteToEvent: (actor: Actor) => isLeadership(actor),

  /**
   * Creating an event nobody can join — a fixed guest list.
   *
   * Co-Lead only, and narrower than `createEvent` on purpose. An open calendar
   * is the point of this feature: `/find-work` and the calendar exist so a
   * member can plug into the club's work without asking permission, and every
   * closed event is a small subtraction from that. The cases that genuinely
   * need one — a sponsor visit with a headcount, an interview panel, a
   * leadership sit-down — are all things a Co-Lead is arranging anyway.
   *
   * A 1:1 is closed too, and needs none of this: it's closed by its KIND
   * rather than by a choice, because two people sitting down together is
   * definitionally not something a third can drop into.
   */
  createClosedEvent: (actor: Actor) => isCoLead(actor),

  /**
   * Deciding who is ON an event, as opposed to joining one yourself.
   *
   * The organiser, or a Co-Lead. This is what makes a closed event work at
   * all — `setEventAttendance` refuses one by design, so without this an
   * invite-only event's list could never change after it was created.
   */
  manageEventGuestList: (actor: Actor, createdBy?: string) =>
    isCoLead(actor) || (!!createdBy && createdBy === actor.id),

  recordAttendance: (actor: Actor) => isLeadership(actor),

  /** Anyone can propose a 1:1 with anyone. */
  requestMeeting: () => true,

  // --- Deliverables ------------------------------------------------------

  /** REs shape the list; that's the five minutes a week the model costs them. */
  manageDeliverables: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /**
   * The checklist under a deliverable — add, tick, rename, remove.
   *
   * Deliberately WIDER than `manageDeliverables`, and this is the only rule in
   * the file where the owner of a row gets a right their RE-only neighbours
   * don't. The person doing the work is the one who discovers what it turns out
   * to involve — book the CNC, chase the vendor, get the fixture back off
   * Trudy — and making them ask an RE to write each of those down guarantees
   * the list stays empty and the feature goes unused.
   *
   * It's safe to be wide because a todo is worth nothing. It carries no owner,
   * no date and no credit, and it appears in no count; the only thing it can do
   * is hold up a sign-off, and the RE can clear it themselves. Compare
   * `manageDeliverables`, which is RE-only precisely because a deliverable DOES
   * count.
   *
   * `ownerId` is the deliverable's owner, not the todo's — todos have no owner.
   */
  manageDeliverableTodos: (
    actor: Actor,
    graph: OrgGraph,
    projectId: string,
    ownerId: string
  ) =>
    isCoLead(actor) ||
    isSelf(actor, ownerId) ||
    isREofOrAbove(actor, graph, projectId),

  /**
   * Challenging work that has ALREADY been signed off.
   *
   * Signing off stays with the RE at the project's own level — that's their
   * job, it's the five minutes a week the deliverable model costs them, and
   * `manageDeliverables` still covers it. This is the different, rarer act:
   * saying a sign-off was wrong. The engineering doesn't meet the requirement,
   * the part failed on the bench, the work was not actually done.
   *
   * That has to come from above the person who signed it, or it's the same
   * signature marking its own homework — so it routes through
   * `isREaboveProject` rather than `isREofOrAbove`. The RE who signed off
   * cannot quietly un-sign it; they ask the person above them, and the record
   * shows a challenge rather than an edit.
   *
   * It is genuinely destructive — it removes a completed deliverable from
   * somebody's Delivered signal, the one thing in the contribution model that
   * can't be inflated — so the operation demands a reason in writing.
   */
  withdrawSignOff: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREaboveProject(actor, graph, projectId),

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

  /**
   * Moving the commitment tier floors.
   *
   * Co-Lead only, for the same reason as `manageTeams`: this is the definition
   * of the bar every member is measured against, and it's printed publicly at
   * `/how-we-lead`. Editable at all because the club adjusts its expectations
   * faster than anyone ships a deploy — see `ClubSettings`.
   */
  manageEngagementWeights: (actor: Actor) => isCoLead(actor),

  /**
   * Delete somebody's record outright.
   *
   * Co-Lead only, and never yourself. This is NOT the tool for somebody
   * leaving the club — that's `setMemberStatus`, which keeps their history.
   * This is for a broken row: the duplicate profile created when an invite
   * email doesn't match the address Google returns, which can never be signed
   * in to and clutters every picker.
   *
   * The operation re-checks self-deletion, refuses the last Co-Lead, and
   * refuses anyone holding real history unless forced.
   */
  deleteMember: (actor: Actor, memberId: string) =>
    isCoLead(actor) && !isSelf(actor, memberId),

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
  resolveHelpRequest: (actor: Actor, askerId: string, replierIds: string[]) =>
    isSelf(actor, askerId) || replierIds.includes(actor.id) || isCoLead(actor),

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
