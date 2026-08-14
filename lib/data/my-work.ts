/**
 * Everything the My Work page needs, in one call.
 *
 * Breadcrumbs, REs, hours and last-update-per-project are joined HERE rather
 * than looked up per row in the component. Against Postgres, per-row lookups
 * would be one round trip each — and `projectBreadcrumb` is a recursive tree
 * walk, so it would be several.
 */

import { workIsLocked, MAX_BACKDATE_DAYS } from "@/lib/store/operations";
import {
  allWorkLogsFor,
  contributionInputsFor,
  daysUntil,
  daysWorkedOnProject,
  getMember,
  getProject,
  inSession,
  isOverdue,
  joinRequestsAwaitingMe,
  deliverableTodos,
  hasLoggedAnyWork,
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
  updatesFor,
} from "@/lib/mock-data";
import {
  buildContributionRecord,
  type ContributionRecord,
} from "@/lib/contribution";
import {
  checkInPeriodStart,
  draftProgressFrom,
  workByProject,
} from "@/lib/checkin-draft";
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
  /**
   * Distinct days this member has logged work against this project.
   *
   * Replaces `hoursLogged`. A count of DAYS rather than of entries, because
   * three entries on one afternoon is one day of work and counting them
   * separately would rebuild the volume metric that was just removed — in a new
   * unit, which is the specific trap named in `lib/contribution.ts`.
   *
   * It feeds nothing. Not a contribution signal, not sorted on, not compared
   * between people: it sits on the card as context for the person whose card it
   * is.
   */
  daysWorked: number;
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

/**
 * A section of the current update, tied to a specific project.
 *
 * `draftProgress` and `needsWriting` are the check-in auto-fill — the reason
 * hours removal added something instead of only taking things away. See
 * `lib/checkin-draft.ts` for the window and the text.
 */
export interface UpdateDraftSection {
  entry: UpdateEntry;
  project: Project;
  breadcrumb: BreadcrumbNode[];
  /**
   * What this member logged against this project since their last check-in,
   * oldest first. Rendered under the box so they can see what the draft is made
   * of — a pre-filled field with no visible source reads as the app inventing
   * words on their behalf.
   */
  loggedWork: WorkLog[];
  /**
   * The pre-filled text for the progress box. Empty when nothing was logged.
   *
   * Editable, deliberately: the log is raw notes, the check-in is what they want
   * their Lead to read.
   */
  draftProgress: string;
  /**
   * True when nothing was logged against this project this period, so the member
   * has to write the line themselves.
   *
   * This is the ONE thing the composer asks for, and it's the same condition
   * `submitCheckIn` refuses on — both derive it from `workByProject`, so the
   * form can't mark a box required that the server would accept, or vice versa.
   */
  needsWriting: boolean;
}

/** One day of the work log, with its entries. Newest day first. */
export interface WorkLogDay {
  /** `YYYY-MM-DD`. Format with `formatDay` at the render site. */
  day: string;
  entries: {
    log: WorkLog;
    project?: Project;
    /** A submitted check-in already reported this day — it can't be removed. */
    locked: boolean;
  }[];
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
   * What they've done recently, grouped by day and newest day first.
   *
   * The day grouping is the second new behaviour of the hours removal: the log
   * stopped being a timesheet, so it now reads as a diary — "Tuesday: reran the
   * FEA; Wednesday: rebuilt the seal" — rather than as a column of numbers.
   *
   * Listing it at all matters for a second, older reason: logging used to be
   * write-only. `deleteWorkLog` existed but nothing in the app ever showed a
   * single entry, so there was no button to hang the delete on and a mistyped
   * entry was permanent. `locked` says which ones a submitted check-in has
   * already reported — the operation refuses those, and the row explains itself
   * rather than offering a button that fails.
   */
  recentWork: {
    days: WorkLogDay[];
    /**
     * True when the fortnight window was empty and this is their last few
     * entries whatever their age — shown as a reminder, not for editing.
     */
    stale: boolean;
  };
  /**
   * Whether they have ever logged anything at all.
   *
   * Not "recently" — see `hasLoggedAnyWork`. Somebody who has never logged has
   * never met the habit the app now leans on hardest: **the check-in drafts
   * itself from the log**, so a member with an empty log has to write every
   * section of every check-in by hand while somebody who logs as they go has to
   * write none of them. That is a different problem from being behind, and it
   * needs saying once, plainly.
   */
  hasEverLoggedWork: boolean;
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
        daysWorked: daysWorkedOnProject(memberId, project.id),
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

  /*
    The work log for the period this check-in covers.

    Computed ONCE here, from the same two functions `submitCheckIn` uses, so the
    form and the server agree about which projects have something to go on. If
    they disagreed, the composer would mark a box required that the server would
    accept — or, worse, accept a box the server then refuses, with the reason
    never shown on the page.
  */
  const periodStart = checkInPeriodStart(updatesFor(memberId), today());
  const loggedByProject = workByProject(
    allWorkLogsFor(memberId),
    periodStart,
    today()
  );

  const sections: UpdateDraftSection[] = projects.map((card) => {
    const existing = existingByProject.get(card.project.id);
    const loggedWork = loggedByProject.get(card.project.id) ?? [];

    return {
      // A synthetic entry when there's no draft row yet. It carries the
      // project's real id, so submitting writes against the right project —
      // `submitCheckIn` keys on `projectId`, never on this id.
      entry: existing ?? {
        id: `draft-${currentUpdate.id}-${card.project.id}`,
        updateId: currentUpdate.id,
        projectId: card.project.id,
        progress: "",
      },
      project: card.project,
      breadcrumb: card.breadcrumb,
      loggedWork,
      /*
        Anything already saved on the row wins over the draft.

        Only relevant if a member half-writes a check-in and comes back, but
        getting it the other way round would silently overwrite their own words
        with a machine-generated summary — the single least forgivable thing this
        feature could do.
      */
      draftProgress: existing?.progress.trim()
        ? existing.progress
        : draftProgressFrom(loggedWork),
      needsWriting: loggedWork.length === 0 && !existing?.progress.trim(),
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

      Two different rows used to end up here. One was a row seeded from logged
      hours, empty, which is the thing the filter above exists to remove —
      letting it back in through this loop would undo the fix. The other is a
      sentence somebody typed before the project completed, and discarding that
      is exactly what this loop was written to prevent.

      Nothing seeds an empty row any more, so in practice only the second kind
      arrives. The check stays because it costs nothing and the invariant it
      protects — never show an empty box for finished work — is the one that got
      this loop written in the first place.
    */
    const wroteSomething = Boolean(
      entry.progress.trim() || entry.blockers?.trim() || entry.nextSteps?.trim()
    );
    if (project.phase === "complete" && !wroteSomething) continue;

    sections.push({
      entry,
      project,
      breadcrumb: projectBreadcrumb(project.id),
      /*
        No draft, and never required.

        This is a project they've LEFT or one that finished. Asking somebody to
        account for work on a project they're no longer on would be the composer
        blocking a submission over something the member can't act on — and
        `needsWriting: false` is what keeps `submitCheckIn` from refusing it,
        since both sides read this same condition.
      */
      loggedWork: [],
      draftProgress: entry.progress,
      needsWriting: false,
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
    hasEverLoggedWork: hasLoggedAnyWork(memberId),
    recentWork: workToShow(memberId),
  };
}

/**
 * The work log, grouped into days.
 *
 * The fortnight window first, because its main job is letting somebody fix or
 * remove a wrong entry. When that's empty we fall back to their last few entries
 * whatever their age and mark them `stale`, so the page can say "you haven't
 * logged in a while — last time you were on X doing Y" instead of showing a
 * blank space to the one person who most needs the reminder.
 *
 * Grouping happens here rather than in the component for the usual reason: the
 * page renders identically whenever it renders, and `locked` is a store
 * question the component isn't allowed to ask.
 */
export function workToShow(memberId: string): MyWorkView["recentWork"] {
  const recent = recentWorkLogs(memberId);
  const stale = recent.length === 0;
  const logs = stale ? lastWorkLogs(memberId) : recent;

  /*
    A Map keyed by day, filled in the order the logs arrive.

    Both sources are already sorted newest-first, so insertion order is the
    display order and no second sort is needed. Building this with an object
    would re-sort the keys as strings — which happens to be the same order for
    `YYYY-MM-DD`, but only by luck, and it would break the day the format
    changed.
  */
  const byDay = new Map<string, WorkLogDay["entries"]>();

  for (const log of logs) {
    const day = log.workDate.slice(0, 10);
    const entry = {
      log,
      project: log.projectId ? getProject(log.projectId) : undefined,
      locked: workIsLocked(memberId, log.workDate),
    };
    const bucket = byDay.get(day);
    if (bucket) bucket.push(entry);
    else byDay.set(day, [entry]);
  }

  return {
    days: [...byDay].map(([day, entries]) => ({ day, entries })),
    stale,
  };
}
