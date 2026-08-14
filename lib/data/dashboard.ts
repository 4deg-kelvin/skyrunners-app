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
 * The obvious one is privacy — a Lead could read reports written to a different
 * Lead, and (since the page had no gate at all) so could any member who typed
 * the URL.
 *
 * The subtler one is that it made the page useless. A Lead opening a list of
 * thirty reports, twenty-six of which aren't theirs, cannot tell what they owe.
 * The whole design target is "a Lead's weekly obligation fits in 15 minutes",
 * and a list you have to filter by eye fails that before you read a word.
 *
 * So: `reviewQueue` is only reports written to YOU. Effort aggregates cover only
 * people in your chain. `flaggedProjects` stays club-wide on purpose — a blocked
 * project is exactly the thing a passing person should be able to unblock.
 *
 * PHASE 1 NOTE: `compliance` and `logsThisWeek` map onto `v_update_compliance`
 * and `v_member_hours_weekly` in docs/DATA_MODEL.md, but both now need a member
 * filter. Views should take the scoped id set rather than aggregating globally.
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
import { MAX_BACKDATE_DAYS } from "@/lib/store/operations";
import { workToShow, type MyWorkView } from "./my-work";
import { isCoLead, type Actor, type OrgGraph } from "@/lib/permissions";
import {
  escalationsFor,
  pendingSignOffs,
  unansweredSectionsFor,
  unreadReportsFor,
  type LeadEscalation,
  type PendingSignOff,
  type UnansweredSection,
} from "@/lib/review";
import { isREofOrAbove } from "@/lib/permissions";
import type {
  MemberRequest,
  Member,
  Project,
  ProgressUpdate,
  ProjectNotice,
  UpdateEntry,
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

export interface ReviewQueueItem {
  update: ProgressUpdate;
  author?: Member;
  /** Each entry paired with its project, so the UI never has to look it up. */
  sections: { entry: UpdateEntry; project?: Project }[];
  /** Whole days since submission. Drives the ordering and the warning tone. */
  ageDays: number;
  /** Past the grace period — your own Lead can now see this. */
  escalated: boolean;
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
  /** True when the viewer oversees nobody — changes the whole page's message. */
  isLeadOfNobody: boolean;
  counts: {
    /** People in the viewer's chain, not the club, unless they're a Co-Lead. */
    peopleOverseen: number;
    divisions: number;
    projects: number;
  };
  compliance: {
    onTime: number;
    late: number;
    missed: number;
    /** Due but not yet written. Not a failure — the window may still be open. */
    pending: number;
    fraction: number;
  };
  /**
   * Work-log entries written this week by people the viewer oversees.
   *
   * Was `hoursThisWeek`, a sum. A COUNT of entries now — a liveness reading
   * ("is my part of the club logging anything?"), never divided by headcount and
   * never shown per person. See the warning in `lib/contribution.ts` about
   * rebuilding the removed signal in a new unit.
   */
  logsThisWeek: number;
  /** Reports written TO the viewer and not yet read. Oldest first. */
  reviewQueue: ReviewQueueItem[];
  /** Leads under the viewer who are leaving their people unheard. */
  escalations: LeadEscalation[];
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
   * The RE half of the exception feed — what's waiting on YOU as an RE.
   *
   * Separate from `reviewQueue`, which is the Lead half. Two obligations, two
   * different people, and a dashboard that merged them would tell a Lead who
   * is also an RE that they owe "seven things" without saying which hat.
   */
  reQueue: {
    /** Finished work no RE has signed off. `pendingSignOffs`. */
    signOffs: PendingSignOff[];
    /** Check-in sections with a blocker or a next step and no reply. */
    unanswered: UnansweredSection[];
  };
  /**
   * People in scope who logged nothing this week while holding open work.
   *
   * The quiet failure the club actually loses people to: not a missed
   * check-in, which is visible, but somebody who simply stops and whose
   * absence nothing reports. Deliberately not a score or a flag on their
   * record — it's a prompt to have a conversation.
   */
  goneQuiet: {
    member: Member;
    openDeliverables: number;
    lastLoggedAt?: string;
  }[];
  /**
   * Per-Lead roll-up. Populated for Co-Leads only, empty for everyone else.
   *
   * Derived rather than written. A roll-up somebody has to compose by hand is
   * a chore that gets skipped in week three, and the numbers already exist —
   * the scarce resource is leadership *reading*, not leadership typing.
   */
  rollUp: {
    lead: Member;
    reports: number;
    unread: number;
    worstUnreadDays: number;
    logsThisWeek: number;
    quietCount: number;
  }[];
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

/**
 * Everyone at or below `memberId` in the reporting chain, excluding themselves.
 *
 * Iterative rather than recursive, with a `seen` set: `profiles.lead_id` has a
 * self-reference CHECK but nothing prevents a longer cycle (A leads B leads A),
 * and a cycle here would hang the request rather than render wrong.
 */
function reportsBelow(memberId: string): Member[] {
  const collected: Member[] = [];
  const seen = new Set<string>([memberId]);
  let frontier = [memberId];
  // Read once, outside the loop: the chain walk is O(depth × members) and
  // re-reading the store per level would multiply that for no reason.
  const allMembers = readStore().members;

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const m of allMembers) {
        if (m.leadId === id && !seen.has(m.id)) {
          seen.add(m.id);
          collected.push(m);
          next.push(m.id);
        }
      }
    }
    frontier = next;
  }

  return collected;
}

function startOfWeek(today: string): string {
  const d = new Date(today);
  // Monday-based. getDay() is 0 for Sunday, so shift it.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

/**
 * `graph` was a placeholder parameter for years — the reporting chain is walked
 * over the in-memory `members` array, so nothing needed it. It's load-bearing
 * now: the RE queue resolves the viewer's project subtree through
 * `isREofOrAbove`, which is the only thing that knows RE authority inherits
 * DOWN the project tree and that a Division Lead is a top RE. Matching `reIds`
 * directly would miss both and silently under-report what somebody owes.
 */
export async function getDashboard(
  actor: Actor,
  graph: OrgGraph,
  /**
   * Co-Leads only: widen the numbers from "people I look after" to the club.
   *
   * The default stays scoped, deliberately. The dashboard is built around a
   * 15-minute weekly obligation, and a Lead opening thirty reports of which
   * twenty-six aren't theirs can't tell what they owe. But a Co-Lead does
   * legitimately need the club-wide view sometimes — so it's a toggle they
   * choose, not the thing they land on.
   */
  scope: "mine" | "club" = "mine"
): Promise<DashboardView> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  // Live, not the seed — a Lead marking a report reviewed must disappear
  // from their own queue on the next render.
  const { progressUpdates, workLogs } = readStore();

  const clubWide = scope === "club" && isCoLead(actor);

  // A Co-Lead oversees the club; everyone else oversees their own subtree.
  const overseen = isCoLead(actor)
    ? readStore().members.filter(
        (m) => m.id !== actor.id && m.status === "active"
      )
    : reportsBelow(actor.id).filter((m) => m.status === "active");

  const overseenIds = new Set(overseen.map((m) => m.id));

  /**
   * The same people, plus you.
   *
   * `overseen` deliberately excludes the viewer — it answers "who do I look
   * after". But the operational numbers below are about the team's week, and
   * leaving yourself out of them meant a Co-Lead who was the only person
   * logging hours saw 0.0 hours and an empty check-in panel. It read as broken,
   * and it was wrong: you're part of the team you run.
   */
  const countedIds = new Set([...overseenIds, actor.id]);

  // Reports written to the viewer personally — their direct reports only. A
  // Lead two levels up sees the escalation instead, not the raw report, so the
  // obligation stays with exactly one person.
  /**
   * Is this person on an academic pause right now?
   *
   * Matters in two directions. A paused MEMBER owes nothing. A paused LEAD
   * still has reports whose check-ins need reading — pausing your own
   * obligations can't quietly pause other people's.
   */
  const pausedNow = (memberId: string): boolean => {
    const schedule = readStore().updateSchedules.find(
      (u) => u.memberId === memberId
    );
    return !!schedule?.pausedUntil && schedule.pausedUntil >= today();
  };

  const everyone = readStore().members;

  const directReports = everyone.filter((m) => {
    if (m.status !== "active" || m.id === actor.id) return false;

    // Club-wide: every active member counts, whoever they report to.
    if (clubWide) return true;

    // Normally: people who report to you.
    if (m.leadId === actor.id) return true;

    // Cover for a paused Lead. If someone who reports to you is a Lead and
    // they're on pause, THEIR reports come to you for the duration — otherwise
    // one person taking two weeks for midterms silently strands everybody
    // underneath them, which is the opposite of what the pause is for.
    if (m.leadId && pausedNow(m.leadId)) {
      const theirLead = everyone.find((x) => x.id === m.leadId);
      if (theirLead?.leadId === actor.id) return true;
      // Nobody above the paused Lead: it lands with the Co-Leads.
      if (isCoLead(actor) && !theirLead?.leadId) return true;
    }

    // A Co-Lead also picks up anyone with nobody above them — including the
    // other Co-Leads, whose own check-ins would otherwise go into a void.
    if (isCoLead(actor) && m.leadId === null) return true;

    return false;
  });

  const reviewQueue: ReviewQueueItem[] = unreadReportsFor(
    actor.id,
    progressUpdates,
    directReports,
    today()
  ).map((unread) => ({
    update: unread.update,
    author: unread.author,
    ageDays: unread.ageDays,
    escalated: unread.escalated,
    sections: unread.update.entries.map((entry) => ({
      entry,
      project: getProject(entry.projectId),
    })),
  }));

  // Compliance across the people the viewer oversees. Counting the whole club
  // would tell a Lead nothing about whether THEIR people are keeping up.
  const scopedUpdates = progressUpdates.filter((u) =>
    countedIds.has(u.memberId)
  );
  const onTime = scopedUpdates.filter(
    (u) => u.status === "submitted" || u.status === "reviewed"
  ).length;
  const late = scopedUpdates.filter((u) => u.status === "late").length;
  const missed = scopedUpdates.filter((u) => u.status === "missed").length;
  // Pending is excluded from the ratio on purpose: the window may still be open,
  // and counting an unwritten-but-not-yet-late report as a miss would show a
  // Lead a falling compliance number every single morning.
  const pending = scopedUpdates.filter((u) => u.status === "pending").length;
  const totalDue = onTime + late + missed;

  const weekStart = startOfWeek(today());
  const logsThisWeek = workLogs.filter(
    (w) => countedIds.has(w.memberId) && w.workDate >= weekStart
  ).length;

  // Trainings this viewer is the verifier for. `overseen` is their reporting
  // subtree, which is exactly who `can.verifyTraining` covers.
  const trainings = await getTrainingQueue(overseen.map((m) => m.id));

  /*
    Requests addressed to this person, plus — for a Co-Lead — everything else
    still outstanding, so a request to somebody who has gone quiet is visible
    to the people who can unblock it.
  */
  const mine = requestsAwaitingLead(actor.id);
  const alsoVisible = isCoLead(actor)
    ? readStore().memberRequests.filter(
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

  // --- the RE half of the exception feed -----------------------------------
  //
  // The viewer's RE subtree, resolved through the permission module rather
  // than by matching `reIds` directly: authority inherits DOWN the project
  // tree, and a Division Lead is a top RE. Matching ids would miss both and
  // silently under-report what somebody actually owes.
  const store = readStore();
  const myProjectIds = store.projects
    .filter((p) => isREofOrAbove(actor, graph, p.id))
    .map((p) => p.id);

  const reQueue = {
    signOffs: pendingSignOffs(
      store.deliverables,
      myProjectIds,
      everyone,
      today()
    ),
    // Your own sections are dropped: an RE writes check-ins on their own
    // projects too, and "Tyler Brooks is waiting on an answer" shown to Tyler
    // is noise that makes the whole panel read as generated rather than owed.
    // If a second RE should answer it, it's still in THEIR queue.
    unanswered: unansweredSectionsFor(
      progressUpdates,
      myProjectIds,
      everyone,
      today()
    ).filter((section) => section.author?.id !== actor.id),
  };

  // --- who has gone quiet --------------------------------------------------
  //
  // Logged NOTHING this week while still holding open work. Not a missed
  // check-in — that's already visible — but the person who simply stopped, which
  // is what the club actually loses people to.
  //
  // The test used to be "zero hours". It is now "no entries at all", which is a
  // slightly WIDER net in one useful direction: somebody who used to log 0.5
  // hours as a placeholder no longer registers as active. One line in the diary
  // is the bar, and one line is also all the check-in needs.
  const goneQuiet = overseen
    .map((member) => {
      const logged = workLogs.some(
        (w) => w.memberId === member.id && w.workDate >= weekStart
      );
      if (logged) return null;

      const openDeliverables = store.deliverables.filter(
        (d) => d.ownerId === member.id && d.status !== "done"
      ).length;
      // No open work means nothing to be quiet about — they may simply be
      // between projects, which `/find-work` is the answer to, not this.
      if (openDeliverables === 0) return null;

      const lastLog = workLogs
        .filter((w) => w.memberId === member.id)
        .sort((a, b) => b.workDate.localeCompare(a.workDate))[0];

      return {
        member,
        openDeliverables,
        lastLoggedAt: lastLog?.workDate,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => (a.lastLoggedAt ?? "").localeCompare(b.lastLoggedAt ?? ""));

  // --- the roll-up, for Co-Leads -------------------------------------------
  const rollUp = isCoLead(actor)
    ? everyone
        .filter(
          (m) =>
            m.globalRole !== "member" &&
            m.globalRole !== "advisor" &&
            m.status === "active" &&
            // Not yourself. A roll-up is what you read to check on OTHER
            // people's oversight — your own reports are already the review
            // queue at the top of this same page, so appearing here is both
            // duplicated and faintly absurd ("Anish Bayya: caught up").
            m.id !== actor.id
        )
        .map((lead) => {
          const theirReports = everyone.filter(
            (m) => m.leadId === lead.id && m.status === "active"
          );
          const unread = unreadReportsFor(
            lead.id,
            progressUpdates,
            theirReports,
            today()
          );
          const reportIds = new Set(theirReports.map((m) => m.id));

          return {
            lead,
            reports: theirReports.length,
            unread: unread.length,
            worstUnreadDays: unread[0]?.ageDays ?? 0,
            logsThisWeek: workLogs.filter(
              (w) => reportIds.has(w.memberId) && w.workDate >= weekStart
            ).length,
            quietCount: goneQuiet.filter((q) => reportIds.has(q.member.id))
              .length,
          };
        })
        // Leads with nobody under them are noise in a roll-up about oversight.
        .filter((row) => row.reports > 0)
        .sort((a, b) => b.worstUnreadDays - a.worstUnreadDays)
    : [];

  return {
    // The editable name/description, falling back to the shipped default.
    club: { ...club, ...clubIdentity() },
    hasAcademicCalendar: store.terms.length > 0,
    isLeadOfNobody: overseen.length === 0,
    counts: {
      peopleOverseen: overseen.length,
      divisions: divisions().length,
      projects: readStore().projects.length,
    },
    compliance: {
      onTime,
      late,
      missed,
      pending,
      // No data is `0`, and the UI must show "—" rather than 0%. A Lead whose
      // people have nothing due yet is not a Lead at 0% compliance.
      fraction: totalDue === 0 ? 0 : onTime / totalDue,
    },
    logsThisWeek,
    reviewQueue,
    escalations: escalationsFor(
      actor.id,
      readStore().members,
      progressUpdates,
      today()
    ),
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
    reQueue,
    goneQuiet,
    rollUp,
    trainings,
    requests,
    today: today(),
    maxBackdateDays: MAX_BACKDATE_DAYS,
    flaggedProjects,
  };
}

// Exported for tests.
export { reportsBelow };
