/**
 * The dashboard, scoped to what the viewer is actually responsible for.
 *
 * ---------------------------------------------------------------------------
 * Why this takes a viewer
 * ---------------------------------------------------------------------------
 *
 * It used to take no arguments and return the whole club: every unread report,
 * club-wide compliance, everyone's hours. Two problems with that.
 *
 * The obvious one was privacy — a Lead could read reports written to a different
 * Lead, and (since the page had no gate at all) so could any member who typed
 * the URL.
 *
 * The subtler one is that it made the page useless. Opening a list of thirty
 * items, twenty-six of which aren't yours, tells you nothing about what you owe.
 * The design target is "a leader's weekly obligation fits in 15 minutes", and a
 * list you have to filter by eye fails that before you read a word.
 *
 * On 2026-08-24 the club dropped check-ins and the reporting chain, and the
 * privacy half of that reasoning went with them: there are no reports written to
 * a person any more. **What remains is a PL dashboard** — what you owe is work
 * on YOUR projects, and `flaggedProjects` stays club-wide on purpose, because a
 * blocked project is exactly the thing a passing person should be able to
 * unblock.
 *
 * `logsThisWeek` is the one aggregate left. It maps onto `v_member_hours_weekly`
 * in docs/DATA_MODEL.md as a COUNT of entries, and it still needs a member
 * filter rather than a global aggregate.
 */

import {
  projectsNeedingAttention,
  club,
  clubIdentity,
  divisions,
  getMember,
  requestsAwaitingLead,
  getProject,
  memberProjects,
  today,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { pendingSignOffs, type PendingSignOff } from "@/lib/signoff";
import { quietProjects, type QuietProject } from "@/lib/quiet";
import { MAX_BACKDATE_DAYS } from "@/lib/store/operations";
import { workToShow, type MyWorkView } from "./my-work";
import {
  isCoLead,
  isLeadership,
  type Actor,
  type OrgGraph,
} from "@/lib/permissions";
import { isREofOrAbove } from "@/lib/permissions";
import type {
  MemberRequest,
  Member,
  Project,
  ProjectNotice,
} from "@/lib/types";
import { preloadLiveStore } from "@/lib/store/request";
import { getTrainingQueue, type TrainingQueueItem } from "@/lib/data/trainings";

/**
 * How long a completion stays news on the dashboard.
 *
 * Two weeks, matching the check-in rhythm: long enough that a Lead who was away
 * still sees it, short enough that the panel never becomes a standing feed
 * nobody reads. It isn't lost afterwards — the project's own page keeps it.
 */
const COMPLETION_NOTICE_DAYS = 14;

function daysSince(iso: string): number {
  const from = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today()}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export interface FlaggedProject {
  project: Project;
  res: Member[];
}

export interface DashboardView {
  club: typeof club;
  /**
   * Whether the club has an academic calendar at all.
   *
   * With no terms, `inSession` is false for every date, so NOBODY is ever
   * asked for a check-in — the review queue stays empty, reliability never
   * accrues, and the core loop of the app is quietly switched off. The Settings
   * page has always said so; nothing else did, and Settings is not a page a
   * Co-Lead opens unprompted.
   *
   * This was the state of the live club: three real projects, real members,
   * and no term. Surfaced on the dashboard because that's where leadership
   * looks, and because it's the one setup step with no visible symptom.
   */
  hasAcademicCalendar: boolean;
  /**
   * True when the viewer is a PL of nothing — changes the whole page's message,
   * and gates the route.
   *
   * Was `isLeadOfNobody`, counted off the reporting chain. Same job, asked of
   * the tree that still exists: this page is about work you are accountable
   * for, and if there is none there is nothing here.
   */
  isREofNothing: boolean;
  counts: {
    /** Committed members across the viewer's projects, not the club. */
    peopleOnMyProjects: number;
    divisions: number;
    projects: number;
  };
  /**
   * Work-log entries written this week on the viewer's projects.
   *
   * Was `hoursThisWeek`, a sum, then a count scoped to the people the viewer
   * oversaw. A COUNT scoped to their PROJECTS now — a liveness reading ("is my
   * part of the club moving?"), never divided by headcount and never shown per
   * person. See the warning in `lib/delivered.ts` about rebuilding the removed
   * signal in a new unit.
   */
  logsThisWeek: number;
  /**
   * Projects of theirs where nobody has logged anything in three weeks.
   *
   * The one thing the reporting removal ADDED rather than took away, and the
   * mitigation for its biggest risk: the chain's real function was that
   * somebody was NAMED as responsible for noticing silence. See `lib/quiet.ts`.
   */
  goneQuiet: QuietProject[];
  /** Club-wide, deliberately: anyone may help with a blocked project. */
  flaggedProjects: FlaggedProject[];
  /** The viewer's own committed projects, so they can log work from here. */
  myProjects: { id: string; name: string }[];
  /**
   * Their own recent entries, grouped by day, so a wrong one can be removed
   * from here too.
   *
   * Typed as My Work's field rather than restated, because it feeds the same
   * `LogWorkForm` component and is produced by the same `workToShow`. Restating
   * the shape here is what let the two drift before.
   */
  recentWork: MyWorkView["recentWork"];
  /**
   * Projects completed recently that named the viewer in the chain.
   *
   * This is where "notify up the chain of command" lands. Without somewhere to
   * arrive, a notice is only a line on a page the recipient has no reason to
   * open — the announcement would exist and reach nobody. Scoped to notices
   * addressed to this person, so it's a small list of things that concern them
   * rather than a club-wide activity feed.
   */
  completions: {
    notice: ProjectNotice;
    project?: Project;
    actor?: Member;
    ageDays: number;
  }[];
  /**
   * Projects below the viewer whose target date moved LATER, recently.
   *
   * The other half of "notify up the chain": a completion changes what a
   * division has achieved, a slip changes what everybody else can plan against,
   * and a Lead needs the second at least as much as the first. Only pushes reach
   * here — `changeProjectDeadline` writes no notice when a date is pulled IN,
   * because good news that notifies trains people to ignore the notice.
   */
  deadlinesMoved: {
    notice: ProjectNotice;
    project?: Project;
    actor?: Member;
    ageDays: number;
  }[];
  /**
   * The PL half of the exception feed — what's waiting on YOU as a PL.
   *
   * Separate from `reviewQueue`, which is the Lead half. Two obligations, two
   * different people, and a dashboard that merged them would tell a Lead who
   * is also a PL that they owe "seven things" without saying which hat.
   */
  reQueue: {
    /**
     * Finished work no PL has signed off. `pendingSignOffs`.
     *
     * This used to sit beside an `unanswered` list of check-in sections needing
     * a PL's reply. Check-ins were removed on 2026-08-24, so that queue could
     * only ever shrink — a backlog of historical rows is a to-do list nobody
     * chose. Replying to the project feed is still possible; it just isn't an
     * obligation with a counter.
     */
    signOffs: PendingSignOff[];
  };
  /**
   * Trainings waiting on the viewer to verify, and clearances that lapsed.
   *
   * The in-app half of "the Lead is notified" when a certification expires.
   * There is deliberately no email — only join requests and review escalations
   * do that — so this is the notification, and it has to be somewhere a Lead
   * already looks rather than a page they'd have to remember to open.
   */
  trainings: {
    pending: TrainingQueueItem[];
    expired: TrainingQueueItem[];
  };
  /**
   * "Can I have access to…" — asks addressed to THIS person by name.
   *
   * Not their reporting subtree, unlike everything else on this page. A member
   * picks who to ask by opening that person's profile, and the point of picking
   * is that somebody owns it. Routing it by chain instead would put it in front
   * of people who never agreed to answer and let the person actually asked off
   * the hook.
   *
   * Co-Leads additionally see everything outstanding, so nothing is stranded
   * when the person asked goes quiet for a fortnight.
   */
  requests: {
    request: MemberRequest;
    asker?: Member;
    /** Days it has been waiting. Age is what makes a queue actionable. */
    ageDays: number;
    /** True when it was addressed to somebody else and we're mopping up. */
    onBehalf: boolean;
  }[];
  today: string;
  maxBackdateDays: number;
}

/*
  `reportsBelow` lived above this, walking `profiles.lead_id` down to collect
  everyone at or below somebody in the reporting chain. It went with the chain on
  2026-08-24, and its cycle guard went with it -- there is no chain left to loop.

  The two guards worth remembering, because both trees that remain still need
  them: `projects.parent_id` and `teams.parent_id` are plain columns, so a loop
  is possible and would HANG the request rather than fail it. `projectChain` and
  `teamChain` in lib/permissions.ts are both cycle-guarded for that reason.
*/

/**
 * The Monday of `today`'s week, as `YYYY-MM-DD`.
 *
 * Every operation is UTC. This used `new Date(today)` with `getDay()` and
 * `setDate()`, which mixes an instant parsed as UTC midnight with LOCAL
 * accessors -- so on a Vercel box in UTC it was right, and in California it read
 * the previous day and returned the wrong Monday for a third of the day. Same
 * class of bug as the one `lib/dates.ts` exists to prevent.
 */
function startOfWeek(today: string): string {
  const d = new Date(Date.parse(`${today.slice(0, 10)}T00:00:00Z`));
  // Monday-based. getUTCDay() is 0 for Sunday, so shift it.
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * `graph` was a placeholder parameter for years — the reporting chain is walked
 * over the in-memory `members` array, so nothing needed it. It's load-bearing
 * now: the PL queue resolves the viewer's project subtree through
 * `isREofOrAbove`, which is the only thing that knows PL authority inherits
 * DOWN the project tree and that a Division Lead is a top PL. Matching `reIds`
 * directly would miss both and silently under-report what somebody owes.
 */
export async function getDashboard(
  actor: Actor,
  graph: OrgGraph
): Promise<DashboardView> {
  /*
    There was a `scope: "mine" | "club"` parameter here, and a Co-Lead-only
    toggle on the page driving it. Both are gone: the only thing it widened was
    the set of people whose check-ins you were accountable for reading, and
    nobody reads check-ins now. What is left is scoped by the project tree, where
    a Co-Lead already sees everything because a Co-Lead is a top PL everywhere.

    Removed rather than left inert. A control that changes nothing is worse than
    a missing one, because somebody clicks it, sees the same numbers, and stops
    trusting the page.
  */
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  // Live, not the seed — signing something off has to drop it out of the
  // queue on the next render.
  const store = readStore();

  /*
    The viewer's scope, and it is now ONE set instead of two.

    Everything on this page used to be scoped two ways: the Lead half by
    `reportsBelow(actor.id)` walking the reporting chain, the PL half by
    `isREofOrAbove`. The chain went on 2026-08-24, so there is one scope left and
    it is the project tree.

    Resolved through the permission module rather than by matching `reIds`
    directly: authority inherits DOWN the project tree, and a Division Lead is a
    top PL over their whole division. Matching ids would miss both and silently
    under-report what somebody owes.

    **The Co-Lead branch is load-bearing, and removing it broke this page once.**
    `isREofOrAbove` has no Co-Lead shortcut, deliberately: it answers "does the
    project tree grant this person authority here", not "is this allowed". The
    Co-Lead answer lives in the `can.*` rules, each of which is
    `isCoLead(actor) || ...`. So a Co-Lead who happens to be PL of nothing and
    leads no division scores zero here — which is the live club exactly, where
    the only Co-Lead is PL of 0 of 12 projects. The whole dashboard rendered
    empty for them: no queue, no quiet projects, zero people, and
    `isREofNothing` true.

    Caught by exercising `getDashboard` rather than by reading it, which is the
    lesson worth keeping: every check in this file is a permission-shaped
    question, and the graph helpers answer a narrower one.
  */
  const myProjectIds = isCoLead(actor)
    ? store.projects.map((p) => p.id)
    : store.projects
        .filter((p) => isREofOrAbove(actor, graph, p.id))
        .map((p) => p.id);
  const myProjectIdSet = new Set(myProjectIds);

  /*
    People committed to those projects. Following doesn't count: watching a
    project is not working on it, and a headcount inflated by watchers is the
    number a PL would use to decide they have enough people.
  */
  const peopleOnMyProjects = new Set(
    store.projectMemberships
      .filter(
        (m) => myProjectIdSet.has(m.projectId) && m.commitment === "committed"
      )
      .map((m) => m.memberId)
  );

  const weekStart = startOfWeek(today());
  /*
    Scoped by PROJECT, not by person, and that is the whole difference.

    It used to count entries by people the viewer oversaw, plus the viewer --
    the "plus the viewer" was there because a Co-Lead who was the only person
    logging saw zero and it read as broken. Scoping by project fixes that
    structurally: your own entries on your own project are in your own projects.

    An entry with no `projectId` (misc work) is deliberately not counted. This
    number answers "is the work I am accountable for moving", and misc work is by
    definition not on any of it.
  */
  const logsThisWeek = store.workLogs.filter(
    (w) =>
      !!w.projectId &&
      myProjectIdSet.has(w.projectId) &&
      w.workDate >= weekStart
  ).length;

  /*
    Trainings waiting on a verifier.

    This was scoped to the viewer's reporting subtree, which is exactly who
    `can.verifyTraining` covered. That rule is now "any Lead, not yourself" as an
    interim while the named-verifier columns land, so the queue matches it: every
    pending request, for anybody who can act on one. See `can.verifyTraining` for
    why the interim is a widening and what narrows it again.

    Gated on `isLeadership` rather than on `can.verifyTraining` with a dummy
    member id. The rule takes a SUBJECT, and there isn't one here — the question
    is "could this person verify anything at all". Passing `""` happened to give
    the right answer and would have started lying the moment the rule looked at
    its third argument for any other reason.
  */
  const trainings = isLeadership(actor)
    ? await getTrainingQueue(store.members.map((m) => m.id))
    : { pending: [], expired: [] };

  /*
    Requests addressed to this person, plus — for a Co-Lead — everything else
    still outstanding, so a request to somebody who has gone quiet is visible
    to the people who can unblock it.
  */
  const mine = requestsAwaitingLead(actor.id);
  const alsoVisible = isCoLead(actor)
    ? store.memberRequests.filter(
        (r) => r.status === "pending" && r.leadId !== actor.id
      )
    : [];
  const requests = [...mine, ...alsoVisible]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((request) => ({
      request,
      asker: getMember(request.memberId),
      ageDays: daysSince(request.createdAt),
      onBehalf: request.leadId !== actor.id,
    }));

  const flaggedProjects: FlaggedProject[] = projectsNeedingAttention().map(
    (project) => ({
      project,
      res: project.reIds
        .map((id) => getMember(id))
        .filter((m): m is Member => m !== undefined),
    })
  );

  const reQueue = {
    signOffs: pendingSignOffs(
      store.deliverables,
      myProjectIds,
      store.members,
      today()
    ),
  };

  /*
    Projects that have gone quiet.

    Was per PERSON -- nothing logged this week while still holding open work,
    rendered on the dashboard of the Lead they reported to. Re-scoped to the
    project, which is the shape that has an owner now, and moved into
    `lib/quiet.ts` because the daily digest needs the same answer and the two
    must not drift. Three weeks rather than one week: see the note on
    `QUIET_AFTER_DAYS` for why a shorter window trains a PL to skip the panel.
  */
  const goneQuiet = quietProjects(
    store.projects,
    myProjectIds,
    store.projectMemberships,
    store.workLogs,
    store.deliverables,
    today()
  );

  return {
    // The editable name/description, falling back to the shipped default.
    club: { ...club, ...clubIdentity() },
    hasAcademicCalendar: store.terms.length > 0,
    isREofNothing: myProjectIds.length === 0,
    counts: {
      peopleOnMyProjects: peopleOnMyProjects.size,
      divisions: divisions().length,
      projects: readStore().projects.length,
    },
    logsThisWeek,
    goneQuiet,
    myProjects: memberProjects(actor.id)
      .filter((m) => m.commitment === "committed")
      .map((m) => ({ id: m.projectId, name: m.project?.name ?? m.projectId })),
    /*
      Literally the same function My Work uses, not a copy of it.

      This block used to be a duplicate of `workToShow` — same fortnight window,
      same stale fallback, same `locked` lookup, written out twice. It mounts the
      same `LogWorkForm` component, so the two had to agree, and a copy that has
      to agree is a copy that eventually won't: the day-by-day grouping would
      have been added on My Work and quietly missing here.
    */
    recentWork: workToShow(actor.id),
    // Addressed to this person, newest first, and only the last fortnight.
    // Older than that it's history rather than news, and the project pages and
    // the completed sections on /projects are where history belongs.
    completions: readStore()
      .projectNotices.filter(
        (n) =>
          n.kind === "completed" &&
          n.notifiedMemberIds.includes(actor.id) &&
          daysSince(n.createdAt) <= COMPLETION_NOTICE_DAYS
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((notice) => ({
        notice,
        project: getProject(notice.projectId),
        actor: getMember(notice.createdById),
        ageDays: daysSince(notice.createdAt),
      })),
    /*
      Deadlines that moved under this person, newest first.

      A SIBLING of `completions` rather than a widening of it, deliberately. That
      block renders in a green "Finished Recently" card, and a slipped deadline
      is not good news — putting the two in one list would either colour a slip
      as an achievement or drain the colour out of a real completion. Same
      window and same audience rule; different meaning, so different card.
    */
    deadlinesMoved: readStore()
      .projectNotices.filter(
        (n) =>
          n.kind === "deadline_pushed" &&
          n.notifiedMemberIds.includes(actor.id) &&
          daysSince(n.createdAt) <= COMPLETION_NOTICE_DAYS
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((notice) => ({
        notice,
        project: getProject(notice.projectId),
        actor: getMember(notice.createdById),
        ageDays: daysSince(notice.createdAt),
      })),
    reQueue,
    trainings,
    requests,
    today: today(),
    maxBackdateDays: MAX_BACKDATE_DAYS,
    flaggedProjects,
  };
}

// Exported for tests.
/*
  `reportsBelow` was exported from here for the digest, which asked the same
  question. Both went with the reporting chain on 2026-08-24. The digest now
  scopes by project, same as this file.
*/
