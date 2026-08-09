/**
 * Everything the My Work page needs, in one call.
 *
 * Breadcrumbs, REs, hours and last-update-per-project are joined HERE rather
 * than looked up per row in the component. Against Postgres, per-row lookups
 * would be one round trip each — and `projectBreadcrumb` is a recursive tree
 * walk, so it would be several.
 */

import { MAX_BACKDATE_DAYS } from "@/lib/store/operations";
import {
  contributionInputsFor,
  getMember,
  hoursOnProject,
  isOverdue,
  joinRequestsAwaitingMe,
  lastEntryForProject,
  myDeliverablesOn,
  myJoinRequests,
  myProjects,
  currentUpdateFor,
  projectBreadcrumb,
  projectProgress,
  projectREs,
  scheduleFor,
  today,
} from "@/lib/mock-data";
import {
  buildContributionRecord,
  type ContributionRecord,
} from "@/lib/contribution";
import type {
  Deliverable,
  JoinRequest,
  Member,
  Project,
  ProjectMembership,
  ProgressUpdate,
  UpdateEntry,
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
  };
  /** Everything they own across all projects, soonest due first. */
  myDeliverables: { deliverable: Deliverable; project: Project }[];
  /** Their own record — always visible to them. */
  contribution: ContributionRecord;
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
      };
    }
  );

  const committed = cards.filter((c) => c.membership.commitment === "committed");
  const following = cards.filter((c) => c.membership.commitment === "following");
  const projects = committed;

  // Only include sections whose project still resolves — a member could have
  // left a project after the draft was seeded.
  const currentUpdate = currentUpdateFor(memberId);
  const sections: UpdateDraftSection[] = currentUpdate.entries.flatMap((entry) => {
    const card = projects.find((p) => p.project.id === entry.projectId);
    if (!card) return [];
    return [
      { entry, project: card.project, breadcrumb: card.breadcrumb },
    ];
  });

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
    },
    myDeliverables: cards
      .flatMap((c) =>
        c.myDeliverables.map((d) => ({ deliverable: d, project: c.project }))
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
  };
}
