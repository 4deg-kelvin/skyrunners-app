/**
 * Everything the My Work page needs, in one call.
 *
 * Breadcrumbs, REs, hours and last-update-per-project are joined HERE rather
 * than looked up per row in the component. Against Postgres, per-row lookups
 * would be one round trip each — and `projectBreadcrumb` is a recursive tree
 * walk, so it would be several.
 */

import { hoursAreLocked, MAX_BACKDATE_DAYS } from "@/lib/store/operations";
import {
  contributionInputsFor,
  daysUntil,
  getMember,
  getProject,
  hoursOnProject,
  inSession,
  isOverdue,
  joinRequestsAwaitingMe,
  deliverableTodos,
  hasLoggedAnyHours,
  lastEntryForProject,
  myDeliverablesOn,
  myJoinRequests,
  myProjects,
  currentUpdateFor,
  projectBreadcrumb,
  projectProgress,
  projectREs,
  recentWorkLogs,
  lastWorkLogs,
  scheduleFor,
  termFor,
  today,
} from "@/lib/mock-data";
import {
  buildContributionRecord,
  type ContributionRecord,
} from "@/lib/contribution";
import type {
  Deliverable,
  DeliverableTodo,
  JoinRequest,
  Member,
  Project,
  ProjectMembership,
  ProgressUpdate,
  UpdateEntry,
  WorkLog,
} from "@/lib/types";
import { preloadLiveStore } from "@/lib/store/request";

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
  /** What this person owns here — the concrete answer, not a text field. */
  myDeliverables: Deliverable[];
  overdueCount: number;
  progress: ReturnType<typeof projectProgress>;
  /**
   * Whole days until the project's target date. Negative once it's passed,
   * undefined when no target is set.
   *
   * Computed here rather than in the card so the page renders identically
   * whenever it renders — the same reason `today` is passed through this view
   * model instead of the components calling `Date.now()`.
   */
  daysToTarget?: number;
}

/** A section of the current update, tied to a specific project. */
export interface UpdateDraftSection {
  entry: UpdateEntry;
  project: Project;
  breadcrumb: BreadcrumbNode[];
}

export interface MyWorkView {
  me: Member;
  /**
   * Who reads this person's check-ins. Undefined for a Co-Lead, who has nobody
   * above them — the UI says so rather than promising a Lead who doesn't exist.
   */
  lead?: Member;
  /**
   * Today, and how far back hours may be dated.
   *
   * Surfaced through the view model because the log-hours form needs both, and
   * pages are not allowed to import `lib/mock-data` or the store directly —
   * ESLint enforces that boundary. Passing them down also keeps the form pure:
   * it never calls `Date.now()` itself, so it renders identically at any moment.
   */
  today: string;
  maxBackdateDays: number;
  /** Projects they've committed to — these carry obligations. */
  committed: MyProjectCard[];
  /** Projects they're only watching. Unlimited. */
  following: MyProjectCard[];
  currentUpdate: {
    update: ProgressUpdate;
    sections: UpdateDraftSection[];
    updatesPerWeek: number;
    /**
     * Whether the club is in a period that generates check-ins at all.
     *
     * Separate from the personal pause: one is the academic calendar, the
     * other is a member choosing to step back. Both mean nothing is owed, and
     * a page that says nothing in either case reads as broken rather than as
     * "you're fine".
     */
    inSession: boolean;
    /** The period covering today, for saying WHY nothing is due. */
    termName?: string;
  };
  /**
   * Everything they own across all projects, soonest due first.
   *
   * `todos` rides along because this is where the owner actually works from —
   * the checklist is theirs to write and tick, and making them open the
   * project page to find it would leave the lists unmaintained.
   */
  myDeliverables: {
    deliverable: Deliverable;
    project: Project;
    todos: DeliverableTodo[];
  }[];
  /** Their own record — always visible to them. */
  contribution: ContributionRecord;
  /**
   * The hours they've logged recently, newest first.
   *
   * Logging hours was write-only: `deleteWorkLog` and `deleteHoursAction`
   * existed, but nothing in the app ever listed a single entry, so there was no
   * button to hang the delete on and a mistyped `80` instead of `8.0` was
   * permanent. `locked` says which ones a submitted check-in has already
   * reported — the operation refuses those, and the row explains itself rather
   * than offering a button that fails.
   */
  recentHours: {
    log: WorkLog;
    project?: Project;
    locked: boolean;
    /** Older than the fortnight window — shown as a reminder, not for editing. */
    stale: boolean;
  }[];
  /**
   * Whether they have ever logged a single hour.
   *
   * Not "recently" — see `hasLoggedAnyHours`. Somebody who has never logged has
   * never met the habit the whole app is built on: check-ins pre-fill from
   * hours, the commitment tier is hours/week, and their profile shows zero
   * effort no matter how much work they've actually done. That is a different
   * problem from being behind, and it needs saying once, plainly.
   */
  hasEverLoggedHours: boolean;
  /** Requests they've sent, so an ask is never invisible. */
  myRequests: {
    request: JoinRequest;
    project?: Project;
    isStale: boolean;
  }[];
  /**
   * Requests waiting on THEM as an RE. Controlling the gate means owing people
   * an answer, so this sits on their home page rather than somewhere they'd have
   * to go looking.
   */
  requestsAwaitingMe: {
    request: JoinRequest;
    project?: Project;
    requester?: Member;
    isStale: boolean;
  }[];
}

export async function getMyWork(memberId: string): Promise<MyWorkView> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  const me = getMember(memberId);
  if (!me) throw new Error(`Member not found: ${memberId}`);

  const cards: MyProjectCard[] = myProjects(memberId).map(
    ({ project, membership }) => {
      const mine = myDeliverablesOn(memberId, project.id);
      return {
        project,
        membership,
        breadcrumb: projectBreadcrumb(project.id),
        res: projectREs(project.id),
        hoursLogged: hoursOnProject(memberId, project.id),
        lastUpdate: lastEntryForProject(memberId, project.id),
        myDeliverables: mine,
        overdueCount: mine.filter(isOverdue).length,
        progress: projectProgress(project.id),
        daysToTarget: daysUntil(project.targetDate),
      };
    }
  );

  const committed = cards.filter(
    (c) => c.membership.commitment === "committed"
  );
  const following = cards.filter(
    (c) => c.membership.commitment === "following"
  );
  /*
    Committed AND still running.

    A finished project has nothing to report on. It stayed in the composer
    because "being on the project creates a section" was written before
    completion existed as a real state, so somebody with four delivered
    projects got four empty boxes asking what moved forward on work that
    isn't moving. That's the fastest way to teach people the form is
    busywork.

    Filtering on the CURRENT phase rather than remembering anything means a
    reopened project comes straight back — which is the behaviour that has to
    hold, since a project can go back to active when a sign-off is withdrawn.
  */
  const projects = committed.filter((c) => c.project.phase !== "complete");

  const currentUpdate = currentUpdateFor(memberId);

  /*
    One section per COMMITTED PROJECT, not per pre-existing entry.

    This used to map over `currentUpdate.entries`, which meant the composer
    only offered a box for a project that already had a draft row — and those
    rows are seeded from logged hours. So a member who was on three projects
    and hadn't logged anything this period saw "no project sections to fill in"
    and could write nothing at all.

    That got it exactly backwards. The check-in most worth reading is the one
    from somebody who did NOTHING and needs to say why — blocked, waiting on a
    part, buried in midterms. Requiring hours before you can report is
    requiring progress before you can report a lack of it.

    Hours and open deliverables AUTO-FILL a section; they don't create it.
    Being on the project creates it.
  */
  const existingByProject = new Map(
    currentUpdate.entries.map((entry) => [entry.projectId, entry])
  );

  const sections: UpdateDraftSection[] = projects.map((card) => {
    const existing = existingByProject.get(card.project.id);
    return {
      // A synthetic entry when there's no draft row yet. It carries the
      // project's real id, so submitting writes against the right project —
      // `submitCheckIn` keys on `projectId`, never on this id.
      entry: existing ?? {
        id: `draft-${currentUpdate.id}-${card.project.id}`,
        updateId: currentUpdate.id,
        projectId: card.project.id,
        progress: "",
        hours: card.hoursLogged,
      },
      project: card.project,
      breadcrumb: card.breadcrumb,
    };
  });

  /*
    Entries for projects they've since LEFT still render, at the end.

    Dropping them would silently discard something already written — and it's
    usually the handover note explaining why they left, which is the one part
    of that check-in anybody needs.
  */
  for (const entry of currentUpdate.entries) {
    if (projects.some((p) => p.project.id === entry.projectId)) continue;
    const project = getProject(entry.projectId);
    if (!project) continue;

    /*
      …but a project that FINISHED mid-period only comes back if they'd
      already written something in it.

      Two different rows end up here. One is a row seeded from logged hours,
      empty, which is the thing the filter above exists to remove — letting it
      back in through this loop would undo the fix. The other is a sentence
      somebody typed before the project completed, and discarding that is
      exactly what this loop was written to prevent.

      Hours alone aren't content: they're a fact the app recorded, not a thing
      the member said.
    */
    const wroteSomething = Boolean(
      entry.progress.trim() || entry.blockers?.trim() || entry.nextSteps?.trim()
    );
    if (project.phase === "complete" && !wroteSomething) continue;

    sections.push({
      entry,
      project,
      breadcrumb: projectBreadcrumb(project.id),
    });
  }

  return {
    me,
    lead: me.leadId ? getMember(me.leadId) : undefined,
    today: today(),
    maxBackdateDays: MAX_BACKDATE_DAYS,
    committed,
    following,
    currentUpdate: {
      update: currentUpdate,
      sections,
      updatesPerWeek: scheduleFor(memberId)?.updatesPerWeek ?? 2,
      inSession: inSession(today()),
      termName: termFor(today())?.name,
    },
    myDeliverables: cards
      .flatMap((c) =>
        c.myDeliverables.map((d) => ({
          deliverable: d,
          project: c.project,
          todos: deliverableTodos(d.id),
        }))
      )
      .filter((x) => x.deliverable.status !== "done")
      .sort((a, b) =>
        (a.deliverable.dueDate ?? "9999").localeCompare(
          b.deliverable.dueDate ?? "9999"
        )
      ),
    contribution: buildContributionRecord(contributionInputsFor(memberId)),
    myRequests: myJoinRequests(memberId),
    requestsAwaitingMe: joinRequestsAwaitingMe(memberId),
    hasEverLoggedHours: hasLoggedAnyHours(memberId),
    recentHours: hoursToShow(memberId),
  };
}

/**
 * What to show beside the log-hours form.
 *
 * The fortnight window first, because its job is letting somebody fix a
 * mistyped number. When that's empty we fall back to their last few entries
 * whatever their age and mark them `stale`, so the form can say "you haven't
 * logged in a while — last time you were on X doing Y" instead of showing a
 * blank space to the one person who most needs the reminder.
 */
function hoursToShow(memberId: string) {
  const recent = recentWorkLogs(memberId);
  const stale = recent.length === 0;
  const logs = stale ? lastWorkLogs(memberId) : recent;

  return logs.map((log) => ({
    log,
    project: log.projectId ? getProject(log.projectId) : undefined,
    locked: hoursAreLocked(memberId, log.workDate),
    stale,
  }));
}
