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
  deliverableTodos,
  divisionForProject,
  getMember,
  getProject,
  hoursOnProject,
  isOverdue,
  pendingRequestsFor,
  projectAdvisors,
  advisorOptions,
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
  ClubEvent,
  Deliverable,
  DeliverableTodo,
  JoinRequest,
  Member,
  Project,
  ProjectArtifact,
  ProjectAttentionFlag,
  ProjectMembership,
  ProjectNotice,
  Team,
  WorkLog,
  UpdateEntry,
} from "@/lib/types";

function daysWaitingOn(since: string): number {
  const ms = new Date(today()).getTime() - new Date(since).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
import type { BreadcrumbNode } from "./my-work";
import { preloadLiveStore } from "@/lib/store/request";
import { buildGantt, projectTone, type GanttChart } from "@/lib/gantt";
import {
  isCoLead,
  leadsTeamAtOrAbove,
  type Actor,
  type OrgGraph,
} from "@/lib/permissions";

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
  /*
    `childProjects(null)` rather than filtering the store by hand: it's the
    same set, and it comes back alphabetical. Divisions and every level of
    sub-project sort the same way, from one comparator in `mock-data.ts`.
  */
  const roots = childProjects(null);

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
  /**
   * What this person has logged ON THIS PROJECT.
   *
   * `can.viewMemberHoursOnProject` has existed since the privacy model was
   * written and was referenced by nothing but its own tests — so the one thing
   * an RE is explicitly allowed to see about somebody's effort was computable,
   * permitted, and displayed nowhere.
   *
   * This is the per-project half of the split: an RE sees time spent on their
   * own work, and never the person's total, reliability or record. Those
   * belong to the member and their Lead.
   *
   * Live off `work_logs`, so it moves the moment somebody logs — it does NOT
   * wait for a check-in. A check-in reports hours that were already there.
   */
  hoursOnProject: number;
}

export interface DeliverableRowData {
  deliverable: Deliverable;
  owner?: Member;
  overdue: boolean;
  /**
   * The checklist under it, already ordered.
   *
   * Joined here rather than fetched by the row component, for the same reason
   * everything else on this page is: a lookup inside the render loop is
   * harmless against an array and one round trip per deliverable against
   * Postgres.
   */
  todos: DeliverableTodo[];
}

/** One scheduled session on a project, with everything the row needs. */
export interface ProjectEventRow {
  event: ClubEvent;
  attendees: Member[];
  organiser?: Member;
  isAttending: boolean;
  /** The organiser, or leadership. Same rule as the calendar. */
  canManage: boolean;
}

export interface ProjectDetailView {
  project: Project;
  breadcrumb: BreadcrumbNode[];
  division?: Team;
  res: Member[];
  /**
   * Faculty or project advisors named on this project.
   *
   * Separate from `members` and `res` on purpose — an advisor is not staff, so
   * they appear beside "Who to ask" and in none of the counts. See
   * `ProjectAdvisor`.
   */
  advisors: Member[];
  /** Active advisors not already named here, for the RE's picker. */
  advisorChoices: { id: string; fullName: string }[];
  members: ProjectMemberRow[];
  children: ProjectTreeNode[];
  parent?: Project;
  /**
   * This project's own timeline: its span, its deliverables, its sub-projects.
   *
   * Scoped to the project and nothing above or beside it. The division chart
   * on /projects answers "how does the division's work stack up"; this one
   * answers "how does MY work stack up", which is the question somebody
   * standing on this page actually has. Deliverables appear here and ONLY here
   * — putting every deliverable in the club on the division chart would bury
   * the projects under a hundred diamonds.
   */
  timeline: GanttChart | null;
  /**
   * Sessions and reviews scheduled for this project, soonest first.
   *
   * The other half of the calendar link. An event already carried a
   * `projectId` and the calendar already linked BACK to the project — but
   * nothing went the other way, so somebody reading a project had no idea a
   * build session for it was on Thursday. That is exactly the "I can't find
   * something to do" problem the app exists to remove, arriving on the page
   * where the work is described.
   *
   * Past events are dropped. A project page is about what happens next; the
   * calendar is the record.
   */
  events: ProjectEventRow[];
  /**
   * Recent hours logged against this project, newest first, with what people
   * wrote.
   *
   * The per-project half of the effort split, and the useful half for an RE:
   * "3.5 hrs — ran the tensile coupons" tells you what happened, where "3.5
   * hrs" only tells you somebody was busy. The description field has existed
   * since hours logging shipped and was rendered on exactly one screen: the
   * member's own list of their own entries.
   *
   * Independent of deliverables and of check-ins. Logging is blocked only by
   * not being on the project, dating it more than a week back, or a check-in
   * already having reported that day — signing a deliverable off has no
   * bearing on it at all.
   */
  recentHours: {
    log: WorkLog;
    member?: Member;
  }[];
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
  viewerId: string,
  /** Whether the viewer may manage anyone's event here. Same rule as the calendar. */
  viewerIsLeadership = false
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
      hoursOnProject: hoursOnProject(pm.memberId, project.id),
    })),
    advisors: projectAdvisors(project.id),
    advisorChoices: advisorOptions()
      .filter(
        (a) => !projectAdvisors(project.id).some((named) => named.id === a.id)
      )
      .map((a) => ({ id: a.id, fullName: a.fullName })),
    children: childProjects(project.id).map(buildNode),
    parent: project.parentId ? getProject(project.parentId) : undefined,
    timeline: projectTimeline(project),
    events: upcomingEventsFor(project.id, viewerId, viewerIsLeadership),
    recentHours: recentHoursOn(project.id),
    deliverables: projectDeliverables(project.id).map((d) => ({
      deliverable: d,
      owner: getMember(d.ownerId),
      overdue: isOverdue(d),
      todos: deliverableTodos(d.id),
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
export async function getProjectFormOptions(actor?: {
  actor: Actor;
  graph: OrgGraph;
}): Promise<{
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
      .map((p) => ({ id: p.id, name: p.name }))
      // Alphabetical, like every other list of projects. A dropdown ordered by
      // whatever the database felt like is one you have to read end to end.
      .sort((a, b) => a.name.localeCompare(b.name)),
    /*
      Only divisions this person may actually file work into.

      `can.createProject` is division-scoped for Leads, so offering every
      division would put options in the dropdown that fail on submit — a dead
      control with extra steps. Co-Leads get all of them; a Division Lead gets
      theirs; a sub-team lead gets the division above their team, since that's
      where `teamChain` says their authority reaches.

      Undefined actor means "don't filter" — the page always passes one, and
      the permission check on the action is the real gate either way.
    */
    divisions: divisions()
      .filter(
        (d) =>
          !actor ||
          isCoLead(actor.actor) ||
          leadsTeamAtOrAbove(actor.actor, actor.graph, d.id)
      )
      .map((d) => ({ id: d.id, name: d.name })),
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

/*
  `getAllProjectSlugs` used to live here, for `generateStaticParams` — removed
  for the same reason as `getAllMemberIds`. See the note in `lib/data/members.ts`
  and docs/HANDOFF.md §4.
*/

/**
 * One project's own timeline: its span, its deliverables, its sub-projects.
 *
 * Deliverables are here and nowhere else. On the division chart they'd bury
 * five projects under a hundred diamonds; on the project you're reading, they
 * ARE the work, and seeing that three of them land the same week is the point.
 *
 * Sub-projects come with their own deliverables, capped at the same two levels
 * as everywhere else — `buildGantt` drops anything deeper and reports how much.
 */
function projectTimeline(project: Project): GanttChart | null {
  const now = today();
  const store = readStore();
  const rows: Parameters<typeof buildGantt>[0] = [];
  const seen = new Set<string>();

  const addProject = (p: Project, depth: number) => {
    // `parent_id` is a plain column; a loop would hang the request rather than
    // fail it. Same guard as `projectChain`.
    if (seen.has(p.id)) return;
    seen.add(p.id);

    const progress = projectProgress(p.id);
    rows.push({
      id: p.id,
      name: p.name,
      // The project you're already on doesn't need a link to itself.
      href: p.id === project.id ? undefined : `/projects/${p.slug}`,
      start: p.startDate,
      end: p.targetDate,
      depth,
      tone: projectTone(
        p.phase,
        p.health,
        !!p.targetDate && p.targetDate < now
      ),
      progress: progress.total > 0 ? progress.fraction : undefined,
      kind: "project",
    });

    // Its deliverables sit one level in from it — they belong to it, and the
    // indent is the only thing saying so once there are sub-projects too.
    for (const d of projectDeliverables(p.id)) {
      if (!d.dueDate) continue; // A date-less deliverable has nowhere to sit.
      rows.push({
        id: d.id,
        name: d.title,
        end: d.dueDate,
        depth: depth + 1,
        /*
          Past its date is RED, not amber.

          A deliverable has one date and one owner — there is no "slightly
          late". It's either done, or the date has gone and somebody needs to
          either do it or move it. Amber said "keep an eye on this" about a
          thing that has already failed, and next to a red blocked diamond it
          read as the lesser problem when it's the same problem.

          Blocked and overdue share the colour deliberately: both mean "this
          needs a person today", and splitting them into two shades of urgent
          makes neither register.
        */
        tone:
          d.status === "done"
            ? "done"
            : d.status === "blocked" || isOverdue(d)
              ? "risk"
              : "neutral",
        kind: "deliverable",
      });
    }

    /*
      Sessions and reviews scheduled for this project, alongside its
      deliverables.

      This is the calendar link made visible where the work is. A build session
      on Thursday is a date about this project in exactly the way a deliverable
      due date is, and the chart's whole job is showing that things land near
      each other — a design review the day before a deliverable is due is worth
      seeing, and no list sorted by type would show it.

      Only upcoming ones. Past sessions would drag the window months backwards
      and squash everything that hasn't happened yet into the right-hand edge.
    */
    for (const event of store.events) {
      if (event.projectId !== p.id) continue;
      if (event.startsAt.slice(0, 10) < now) continue;
      rows.push({
        id: event.id,
        name: event.title,
        end: event.startsAt.slice(0, 10),
        depth: depth + 1,
        // Deliberately neutral. Tone carries HEALTH everywhere else on this
        // chart, and a session is neither on track nor at risk — colouring it
        // would make the other rows' colours mean less.
        tone: "neutral",
        kind: "event",
      });
    }

    for (const child of childProjects(p.id)) addProject(child, depth + 1);
  };

  addProject(project, 0);

  // Only this project, undated, and nothing under it — an axis with one
  // nameless bar on it tells you less than the empty space would.
  if (!rows.some((r) => r.start || r.end)) return null;
  return buildGantt(rows, now);
}

/**
 * This project's upcoming sessions, soonest first.
 *
 * Closed events still appear. The time IS taken and the calendar shows it to
 * everyone for that reason — hiding an invite-only design review from the
 * project it's about would make the project page quietly less true than the
 * calendar. What a non-attendee can't do is join it.
 */
function upcomingEventsFor(
  projectId: string,
  viewerId: string,
  isLeadership: boolean
): ProjectEventRow[] {
  const store = readStore();
  const now = today();

  return store.events
    .filter((e) => e.projectId === projectId && e.startsAt.slice(0, 10) >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((event) => ({
      event,
      attendees: event.attendeeIds
        .map((id) => getMember(id))
        .filter((m): m is Member => Boolean(m)),
      organiser: event.createdBy ? getMember(event.createdBy) : undefined,
      isAttending: event.attendeeIds.includes(viewerId),
      canManage: isLeadership || event.createdBy === viewerId,
    }));
}

/**
 * The last three weeks of logged work on one project.
 *
 * Three weeks rather than everything: an RE wants "what's been happening",
 * and a project a year old would render a wall nobody reads. The total per
 * person is on the member rows above for the longer view.
 */
function recentHoursOn(projectId: string): { log: WorkLog; member?: Member }[] {
  const cutoff = new Date(`${today()}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 21);
  const from = cutoff.toISOString().slice(0, 10);

  return readStore()
    .workLogs.filter((w) => w.projectId === projectId && w.workDate >= from)
    .sort(
      (a, b) => b.workDate.localeCompare(a.workDate) || b.id.localeCompare(a.id)
    )
    .map((log) => ({ log, member: getMember(log.memberId) }));
}
