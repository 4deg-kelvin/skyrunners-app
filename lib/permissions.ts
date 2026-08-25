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

/*
  `leadChain` and `isLeadOfOrAbove` lived here, and Q3 was "are you this
  member's Lead, directly or anywhere up their chain?".

  The club removed the reporting chain on 2026-08-24. Nobody reports to a
  person; members report to their REs through the work they log on a project.
  So the three-question model is now:

    1. Are you a Co-Lead? -> anything
    2. Are you an RE of this project or any above it, or do you lead a team
       that owns any of them? -> you own this subtree
    3. Is it your own data? -> you can manage it

  Note which inheritance survived and which did not. RE authority flows DOWN
  the project tree and team-lead authority flows down the org tree and then
  down the project tree; both are about accountability for WORK and both stay.
  Lead authority flowed UP a chain of PEOPLE, and that is the one that went.

  `profiles.lead_id` is still a column and `Member.leadId` is still a field --
  neither was dropped, because the decision to stop using them is a club
  decision that could be revisited. Nothing in this file reads either.

  Do not reintroduce a person-to-person authority check here. If a feature
  needs "somebody is accountable for this member", the answer now is the RE of
  the project the work is on.
*/

/** Q3 */
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
   * Co-Lead only, since 2026-08-24. It used to be anyone above them in the
   * reporting chain, on the reasoning that the person who notices somebody has
   * left the club is usually their Lead. There is no chain to be above now, and
   * the alternative -- any Lead may deactivate any member -- is a much bigger
   * right than the one being replaced. Removing somebody from the club is the
   * heaviest reversible act in the app, so it goes to the narrowest holder.
   *
   * Note the asymmetry with `admitMember` below, which stays open to every
   * Lead. Welcoming somebody in and putting somebody out are not symmetric
   * acts, and that was already the design.
   */
  setMemberStatus: (actor: Actor, graph: OrgGraph, memberId: string) =>
    !isSelf(actor, memberId) && isCoLead(actor),

  /**
   * Letting somebody INTO the club for the first time.
   *
   * Separate from `setMemberStatus`, and the difference is not cosmetic. A
   * person who has just signed in with no invite is not on anybody's project,
   * so no RE rule reaches them and the rule above admits only Co-Leads. The
   * roster's Access panel meanwhile offers Activate to every Lead, which made
   * it a dead control for five of the club's seven leaders: the button was
   * there, and pressing it was refused. (The original version of this note said
   * "has no Lead"; the chain is gone and the hole it left is the same one.)
   *
   * Any Lead or Co-Lead, because this is the same act as inviting somebody —
   * `can.inviteMember` is already exactly that wide — and the person who sent
   * them the link is the person who should be able to finish the job. Making
   * them find a Co-Lead recreates the "ask a specific person and wait" dead end
   * that this app exists to remove, at the very first moment a new member
   * touches it.
   *
   * Deliberately NOT wider than the first admission. Once they're in,
   * deactivating them goes back through `setMemberStatus`, which is Co-Lead
   * only — removing somebody from the club is a heavier act than welcoming
   * them.
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

  /** Edit details, phase, dates, requirements, tasks. */
  manageProject: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /**
   * Attach a document to a project's engineering record.
   *
   * Deliberately WIDER than `manageProject`, and the only project write that
   * is. The person who ran the test holds the test report; routing every
   * attachment through the RE rebuilds the "go ask someone" bottleneck this app
   * exists to remove, and the predictable result is an empty record.
   *
   * Curation stays with the RE — `manageArtifact` covers removal. Anyone on the
   * project can ADD to the record; only an RE can take something out of it.
   *
   * `committedToProject` is passed in rather than read from `graph` on purpose.
   * `OrgGraph` carries RE memberships only, and its four lookups are called in
   * loops while walking both trees (see CLAUDE.md) — widening it to hold every
   * project membership would grow the structure that must stay cheap, to answer
   * a question exactly one rule asks. Following a project does NOT count: an
   * observer is watching, not working.
   */
  attachArtifact: (
    actor: Actor,
    graph: OrgGraph,
    projectId: string,
    committedToProject: boolean
  ) =>
    isCoLead(actor) ||
    isREofOrAbove(actor, graph, projectId) ||
    committedToProject,

  /**
   * Remove something already in the engineering record.
   *
   * Once a project is COMPLETE the record stops being a working document and
   * becomes the club's history, so the RE loses this and only a Co-Lead keeps
   * it. That asymmetry is the whole point: history should be hard to rewrite,
   * and the person closest to the work is the one most tempted to tidy it.
   *
   * Note that `attachArtifact` does NOT check phase. Adding to a completed
   * record extends it; removing from one rewrites it. The final report is
   * usually written the week *after* the work stops, and blocking that would
   * mean the record can never actually be finished.
   *
   * The Co-Lead escape hatch is also the repair path: there is no edit-in-place
   * for an artifact, so fixing a bad link on a completed project is a Co-Lead
   * removing it and anyone re-attaching a good one.
   */
  manageArtifact: (actor: Actor, graph: OrgGraph, projectId: string) => {
    if (isCoLead(actor)) return true;
    if (graph.getProject(projectId)?.phase === "complete") return false;
    return isREofOrAbove(actor, graph, projectId);
  },

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
  /*
    Anyone may ask to join a project — except an advisor.

    Not a restriction so much as a category error being closed. Joining is how
    somebody becomes accountable for deliverables, and an advisor holds no
    deliverables by design; the way they attach to a project is an RE naming them
    as its advisor, which is a different act with a different meaning. The button
    was offering them a request that, if approved, would have made them staff.
  */
  requestToJoin: (actor: Actor) => !isAdvisor(actor),

  /** Accepting or declining a request — the RE's call. */
  reviewJoinRequest: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

  /** A member can always withdraw their own request. */
  withdrawJoinRequest: (actor: Actor, requesterId: string) =>
    isSelf(actor, requesterId),

  // --- The work log and updates -----------------------------------------

  logOwnWork: (actor: Actor, memberId: string) => isSelf(actor, memberId),

  submitOwnUpdate: (actor: Actor, memberId: string) => isSelf(actor, memberId),

  /** Members choose which weekdays they check in on. */
  setOwnSchedule: (actor: Actor, memberId: string) => isSelf(actor, memberId),

  /**
   * What ONE person logged on ONE project. PUBLIC since 2026-08-16.
   *
   * ---------------------------------------------------------------------------
   * This used to be RE-and-Lead-chain only, and the club changed its mind
   * ---------------------------------------------------------------------------
   *
   * The old rule answered the RE's question — "who is actually working on the
   * thing I'm accountable for?" — and kept everyone else out, on the reasoning
   * that a member's effort was their own business.
   *
   * That reasoning was about HOURS. When the log was "3.5 hrs — ran the tensile
   * coupons", the number invited comparison, and comparison between volunteers
   * with different course loads is exactly what the club refused to do. Hiding it
   * from everybody but the two people who needed it was the right call.
   *
   * The hours went on 2026-08-14, and what is left is a sentence about a
   * project. Anish's decision on 2026-08-16: **the work you did on a project is
   * the project's business, and the project is public.** A check-in entry and a
   * log entry are now the same kind of thing — one is written as you go and one
   * is written twice a week — so they are shown together, and a Division Lead
   * two levels up can see what is happening in a sub-project without asking.
   *
   * As of 2026-08-24 nothing is private. `viewMemberEffort` and
   * `viewMemberContribution` guarded the person-level view -- reliability, the
   * contribution record, the general note in a check-in that was about no
   * project -- and all three of those things are gone. There is no rule left
   * here to be the narrow half of, which is why this one takes no arguments.
   *
   * Takes no arguments now, like `viewProjectUpdates` and `followProject`. That
   * is the file's convention for "public": the rule stays as the documented
   * answer with a test on it, rather than becoming a function nothing can vary.
   *
   * Worth recording that it was never CALLED even when it did restrict — only
   * its own tests referenced it, and the real gate was `can.manageProject` on
   * the project page. So the privacy this rule described had one implementation
   * somewhere else, which is exactly how a rule and its enforcement drift.
   */
  viewMemberWorkOnProject: () => true,

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
   * access control -- the route is reachable by typing the URL.
   *
   * `hasScope` used to mean "oversees at least one person", counted off the
   * reporting chain. It now means "is an RE of at least one project", which is
   * the same question asked of the tree that still exists: this page is a list
   * of what you owe, and somebody who owes nothing sees an empty page and
   * concludes the app is broken.
   *
   * Still a boolean passed in rather than derived here, and for the original
   * reason: it is a fact about a tree, not about `globalRole`. A plain member
   * named RE of one project belongs here; a `lead` who is RE of nothing does
   * not. What changed is which tree.
   */
  viewLeadershipDashboard: (actor: Actor, hasScope: boolean) =>
    isCoLead(actor) || hasScope,

  /**
   * Edit the club-written material on /getting-started and /leading.
   *
   * Co-Lead only. These pages are the club's official word to a new member
   * about how the club works — the first thing somebody reads and the thing
   * they'll quote back. That is not a wiki, and it is not a Lead-level call.
   *
   * Note what this does NOT cover: the hard-coded half of those pages, which
   * describes how the APP works and has to track the code. Only the rows in
   * `guide_blocks` are editable — see migration 0038.
   */
  manageGuides: (actor: Actor) => isCoLead(actor),

  // --- Trainings and facility access ------------------------------------

  /** Members request; nobody self-verifies. */
  requestTraining: (actor: Actor, memberId: string) => isSelf(actor, memberId),

  /**
   * Verified by any Lead, or a Co-Lead. Not by the member themselves.
   *
   * This was the member's Lead chain until 2026-08-24. There is no chain now,
   * and this is the INTERIM rule while the replacement lands: the club decided
   * each catalogue item is either assigned to a NAMED Lead who signs it off, or
   * marked self-verify. Both need columns that do not exist yet
   * (`catalogue_items.verifier_id`, `catalogue_items.self_verify`), so until
   * then any Lead may verify -- the honest superset of "a named Lead", and
   * strictly narrower than what a Co-Lead-only rule would force, which is a
   * two-person bottleneck on shop access for a 35-person club.
   *
   * **A Co-Lead may verify their own**, and that exception is load-bearing
   * rather than a loophole. "Nobody self-verifies" assumes somebody is above
   * you; a Co-Lead is the top, so a blanket rule meant their record could never
   * be completed at all -- a permanent dead end that quietly pushes them to stop
   * recording trainings. A record nobody keeps is worse than one marked
   * self-verified, which is what the UI shows so it stays honest.
   *
   * Everyone else still needs somebody else, checked here AND again in the
   * operation. When `verifier_id` lands, narrow this to that person plus
   * Co-Leads and keep the self-verify branch separate -- a member ticking a
   * self-verify item is a different act from a Lead signing off a machine.
   */
  verifyTraining: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) || (isLeadership(actor) && !isSelf(actor, memberId)),

  grantAccess: (actor: Actor, graph: OrgGraph, memberId: string) =>
    isCoLead(actor) || (isLeadership(actor) && !isSelf(actor, memberId)),

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
   * `viewLeadershipDashboard(actor, hasScope)`.
   */
  createEvent: (actor: Actor, isOnProject = false) =>
    isLeadership(actor) || isAdvisor(actor) || isOnProject,

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

  /**
   * Asking a Lead for something — access, a key, a licence seat.
   *
   * Anybody may ask, of anybody in leadership. The recipient must be a Lead or
   * Co-Lead, which is checked here rather than only in the UI: the button lives
   * on a profile page, and a profile id is trivially guessable, so "the button
   * only appears on Leads" is a UI convention and not a rule.
   *
   * Not askable of an advisor. They hold no authority, so a request addressed
   * to one is a question that can never be answered — and it would sit in a
   * queue on a dashboard they can't reach.
   */
  requestFromLead: (actor: Actor, recipient: Actor) =>
    isLeadership(recipient) && !isSelf(actor, recipient.id),

  /**
   * Answering one.
   *
   * The person asked, or a Co-Lead. Deliberately NOT their whole Lead chain:
   * the member picked one name, and the point of picking is that somebody owns
   * it. A Co-Lead can answer anything so nothing is stranded when the person
   * asked goes quiet for a fortnight.
   */
  answerMemberRequest: (actor: Actor, leadId: string) =>
    isCoLead(actor) || isSelf(actor, leadId),

  /**
   * Naming an advisor on a project, or removing one.
   *
   * Same authority as adding a member: the RE is accountable for the project,
   * so the RE decides who it tells people to go and ask. Inherits down the
   * project tree, and a Division Lead counts, like every other RE right.
   *
   * Note this grants nothing to the advisor — they could already see and
   * comment on this project, and on every other one. All it changes is whether
   * the project lists them.
   */
  manageProjectAdvisors: (actor: Actor, graph: OrgGraph, projectId: string) =>
    isCoLead(actor) || isREofOrAbove(actor, graph, projectId),

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

  /**
   * Reading somebody's ARCHIVED check-ins -- the member, or a Co-Lead.
   *
   * The one thing on a member's profile that is not public, on a page where
   * everything else now is. Worth stating why, because the obvious reading is
   * that it was missed.
   *
   * A check-in carried a `generalNote`: anything not tied to a project. It was
   * written under a stated promise that only the member and their Lead chain
   * would read it, and a lot of it is "I am underwater in CS 161 and behind on
   * everything". The club stopped asking for check-ins on 2026-08-24 and the
   * chain went with them, so nothing new will ever land here -- but publishing
   * what people already typed would break a promise retroactively, which is the
   * one kind of privacy change that cannot be undone by changing it back.
   *
   * So the gate NARROWS rather than widens. It used to be the member, their
   * whole Lead chain, and Co-Leads; it is now the member and Co-Leads. The
   * per-project half of every one of these is public and always was, and it is
   * in the project's feed where it belongs.
   */
  readArchivedCheckIns: (actor: Actor, memberId: string) =>
    isCoLead(actor) || isSelf(actor, memberId),

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
   * Bulk-delete the empty projects one actor created.
   *
   * Co-Lead only, and NOT `deleteProject`'s rule, even though it deletes
   * projects. `deleteProject` is scoped to one project you are the RE of or
   * above; this operates across the whole club by author, so an RE could
   * otherwise reach projects in a division they have nothing to do with.
   *
   * It exists because an assistant on the MCP server created ~4,000 empty
   * projects, and clicking delete four thousand times is not a recovery plan.
   * The safety is in `emptyProjectsCreatedBy`, which will only offer up projects
   * that carry no work at all — so the worst this can destroy is shells.
   */
  purgeEmptyProjects: (actor: Actor) => isCoLead(actor),

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
