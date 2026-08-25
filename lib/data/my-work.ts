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
  deliveredInputsFor,
  daysUntil,
  daysWorkedOnProject,
  getMember,
  getProject,
  isOverdue,
  joinRequestsAwaitingMe,
  deliverableTodos,
  hasLoggedAnyWork,
  lastEntryForProject,
  myDeliverablesOn,
  myJoinRequests,
  myProjects,
  projectBreadcrumb,
  projectProgress,
  projectREs,
  recentWorkLogs,
  lastWorkLogs,
  today,
} from "@/lib/mock-data";
import { buildDelivered, type Delivered } from "@/lib/delivered";
import type {
  Deliverable,
  DeliverableTodo,
  JoinRequest,
  Member,
  Project,
  ProjectMembership,
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
   * unit, which is the specific trap named in `lib/delivered.ts`.
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
  /**
   * What they have finished. Two counts, public like everything else.
   *
   * This was a three-signal `ContributionRecord` until 2026-08-24. Reliability
   * measured check-ins filed on time and the club stopped filing them; Scope
   * measured RE roles held, which measures having already been chosen. See
   * `lib/delivered.ts`.
   */
  delivered: Delivered;
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

  return {
    me,
    today: today(),
    maxBackdateDays: MAX_BACKDATE_DAYS,
    committed,
    following,
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
    delivered: buildDelivered(deliveredInputsFor(memberId)),
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
