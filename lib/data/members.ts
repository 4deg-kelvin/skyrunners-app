/**
 * Roster and member profiles.
 *
 * PHASE 1 NOTE: the roster needs project counts per member. Do that with one
 * grouped query (or the `v_member_project_counts` view), not a per-member
 * lookup — 40 members × 2 lookups is 80 avoidable round trips.
 */

import {
  certificationsFor,
  daysUntil,
  committedProjectCount,
  deliveredInputsFor,
  getMember,
  getProject,
  daysWorkedOnProject,
  isOverdue,
  memberProjects,
  myRequestsToLeads,
  myDeliverables,
  projectBreadcrumb,
  projectREs,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { buildDelivered, type Delivered } from "@/lib/delivered";
import type {
  Deliverable,
  Member,
  MemberCertification,
  MemberRequest,
  ProgressUpdate,
  Project,
  ProjectMembership,
  UpdateEntry,
} from "@/lib/types";
import type { BreadcrumbNode } from "./my-work";
import { preloadLiveStore } from "@/lib/store/request";

export interface RosterRow {
  member: Member;
  /**
   * Units this person leads, nearest-to-the-top first.
   *
   * `globalRole` says "lead" but not WHAT of, and leading a division is a
   * materially different job from leading a sub-team — a Division Lead is a
   * top PL over everything inside it (see `leadsTeamAbove`). The roster is the
   * page people use to answer "who do I ask about this?", so the answer has to
   * name the thing, not the rank.
   */
  leads: { id: string; name: string; isDivision: boolean }[];
  /** Committed only — following isn't staffing. */
  committedCount: number;
  reCount: number;
  /** Delivered work, the signal that leads. */
  deliverablesCompleted: number;
  openDeliverables: number;
  overdueDeliverables: number;
  /*
    A `tier` and an `hoursPerWeek` used to sit here, gated on the viewer being
    allowed to see effort data. Both went with the commitment tiers on
    2026-08-14.

    Nothing replaced them, deliberately. The roster is a "who do I ask about
    this?" page, and thirty rows each ending in a number is a leaderboard
    whatever the header says — which is the one thing this app has always refused
    to build. Delivered counts stay because they're facts about finished work; a
    rate per person does not. See `lib/delivered.ts`, which is what
    `lib/contribution.ts` became on 2026-08-24.
  */
}

/**
 * Options the leadership controls need.
 *
 * Split from `getRoster` so the roster stays one query's worth of view model,
 * and computed here rather than in the page because pages may not import
 * `lib/mock-data` — ESLint enforces that boundary.
 */
export async function getRoster(): Promise<RosterRow[]> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  // Everyone, not just active people.
  //
  // Filtering to active here meant a deactivated member or an alum vanished
  // from the roster completely — along with the Reactivate button, which lives
  // on their row. Marking someone alumni was a one-way door with no way back.
  //
  // Active first, then by name, so the working roster still reads normally and
  // the rest sits underneath it.
  // Active before everyone else, then by rank, then alphabetically. Rank first
  // because the roster's most common use is "who do I ask about this?" — and
  // that's answered by leadership, not by whoever's name starts with A.
  const byStatus = { active: 0, inactive: 1, alumni: 2 } as const;
  /*
    Advisors sort below leadership and above members.

    Not a statement about seniority — they hold no authority at all. It's the
    same "who do I ask about this?" logic: a faculty advisor is a useful person
    to find, and there are two of them among thirty, so burying them in the
    alphabetical run makes the roster worse at its main job.
  */
  const byRank = { co_lead: 0, lead: 1, advisor: 2, member: 3 } as const;

  return [...readStore().members]
    .sort(
      (a, b) =>
        (byStatus[a.status] ?? 3) - (byStatus[b.status] ?? 3) ||
        (byRank[a.globalRole] ?? 3) - (byRank[b.globalRole] ?? 3) ||
        a.fullName.localeCompare(b.fullName)
    )
    .map((member) => {
      const mine = memberProjects(member.id);
      const deliverables = myDeliverables(member.id);

      return {
        member,
        leads: teamsLedBy(member.id),
        committedCount: committedProjectCount(member.id),
        reCount: mine.filter((p) => p.role === "re").length,
        deliverablesCompleted: deliverables.filter((d) => d.status === "done")
          .length,
        openDeliverables: deliverables.filter((d) => d.status !== "done")
          .length,
        overdueDeliverables: deliverables.filter(isOverdue).length,
      };
    });
}

export interface MemberProjectRow {
  project: Project;
  membership: ProjectMembership;
  breadcrumb: BreadcrumbNode[];
  res: Member[];
  /**
   * Distinct days this member logged work against this project. `0` when the
   * viewer isn't allowed to see their effort data.
   *
   * Was `hoursLogged`. Same permission gate, same reasoning — this is the
   * per-project half of the privacy model, which a PL may see for their own
   * project and nobody else may — just no longer a duration. See
   * `can.viewMemberWorkOnProject`.
   */
  daysWorked: number;
  /** What this person owns here — concrete, not a text field. */
  deliverables: Deliverable[];
  /** Days until the project's target. Negative once passed, undefined if unset. */
  daysToTarget?: number;
}

export interface MemberProfileView {
  member: Member;
  /**
   * Projects this person is a named ADVISOR on, nearest thing they have to a
   * portfolio.
   *
   * Separate from `projects`, which is membership — an advisor is never a member
   * of anything, so without this an advisor's profile lists nothing at all and
   * reads as somebody who does nothing.
   */
  advising: { id: string; name: string; slug: string }[];
  projects: MemberProjectRow[];
  /** What they have finished. Public — see `lib/delivered.ts`. */
  delivered: Delivered;
  /**
   * This person's check-in history, newest first. Empty unless
   * `canReadCheckIns`.
   *
   * An ARCHIVE since 2026-08-24: the club stopped asking for check-ins, so
   * nothing new arrives here. Still gated, and that is deliberate on a profile
   * where everything else is now public. `generalNote` was written under the
   * promise that only the member and their Lead chain would read it, and
   * publishing it retroactively would break a promise about words already
   * typed. The chain is gone, so the gate narrows rather than widens: the member
   * themselves, or a Co-Lead. See `can.readArchivedCheckIns`.
   */
  checkIns: MemberCheckIn[];
  /**
   * The VIEWER's own most recent request to this person, if they've made one.
   *
   * Belongs to the viewer, not the profile's owner, which is why it's passed in
   * rather than derived from `memberId`. Shown so an ask doesn't vanish the
   * moment it's sent — an invisible request is the "email the PL and wait" dead
   * end, and the only move it leaves is to send it again.
   */
  myRequest?: MemberRequest;
  /**
   * What they're cleared on. **Public**, unlike everything else gated by
   * `canViewEffort` — knowing who can run a machine is how you find the person
   * to ask, and `PUBLIC_TO_ALL_MEMBERS` has always listed trainings.
   *
   * Split three ways because they read differently: what they hold, what's
   * waiting on a verifier, and what has lapsed. A lapsed clearance shown next
   * to a valid one, in the same grey, is how somebody ends up on a machine
   * they're no longer cleared for.
   */
  certifications: {
    held: { record: MemberCertification; itemName: string }[];
    pending: { record: MemberCertification; itemName: string }[];
    lapsed: { record: MemberCertification; itemName: string }[];
  };
}

/** One submitted check-in, with each project entry resolved. */
export interface MemberCheckIn {
  update: ProgressUpdate;
  /** Whether a Lead has already read it, and when. */
  reviewedAt?: string;
  reviewedBy?: Member;
  sections: { entry: UpdateEntry; project?: Project }[];
}

export async function getMemberProfile(
  memberId: string,
  /**
   * May the viewer read the archived check-ins? The only gate left on this
   * page — everything else about a member is public as of 2026-08-24.
   */
  canReadCheckIns: boolean,
  /** Who is looking. Only used to find their own outstanding request. */
  viewerId?: string
): Promise<MemberProfileView | null> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  const member = getMember(memberId);
  if (!member) return null;

  return {
    member,
    /*
      Read from `project_advisors` rather than from memberships, because being an
      advisor is not a membership. Public, like everything else about who is on
      what.
    */
    advising: readStore()
      .projectAdvisors.filter((a) => a.memberId === member.id)
      .flatMap((a) => {
        const project = readStore().projects.find((p) => p.id === a.projectId);
        return project
          ? [{ id: project.id, name: project.name, slug: project.slug }]
          : [];
      }),
    projects: memberProjects(memberId).flatMap((pm) => {
      if (!pm.project) return [];
      return [
        {
          project: pm.project,
          membership: pm,
          breadcrumb: projectBreadcrumb(pm.project.id),
          res: projectREs(pm.project.id),
          // Public since 2026-08-16: what you did on a project is the
          // project's business, and the project is public.
          daysWorked: daysWorkedOnProject(memberId, pm.project.id),
          deliverables: myDeliverables(memberId).filter(
            (d) => d.projectId === pm.project!.id
          ),
          daysToTarget: daysUntil(pm.project.targetDate),
        },
      ];
    }),
    delivered: buildDelivered(deliveredInputsFor(memberId)),
    myRequest: viewerId
      ? myRequestsToLeads(viewerId).find((r) => r.leadId === memberId)
      : undefined,
    checkIns: canReadCheckIns
      ? readStore()
          // Only ones actually sent. A `pending` row is a slot the member
          // hasn't filled in yet, and `missed` is an empty one that expired —
          // neither is something to read.
          .progressUpdates.filter(
            (u) => u.memberId === memberId && u.submittedAt
          )
          .sort((a, b) =>
            (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")
          )
          .map((update) => ({
            update,
            reviewedAt: update.reviewedAt ?? undefined,
            reviewedBy: update.reviewedBy
              ? getMember(update.reviewedBy)
              : undefined,
            sections: update.entries.map((entry) => ({
              entry,
              project: getProject(entry.projectId),
            })),
          }))
      : [],
    certifications: (() => {
      // Resolved once into a map — a lookup per record would rescan the whole
      // catalogue for every row.
      const names = new Map(
        readStore().catalogueItems.map((i) => [i.id, i.name])
      );
      const rows = certificationsFor(memberId).map((record) => ({
        record,
        itemName: names.get(record.itemId) ?? "A retired training",
      }));

      return {
        held: rows.filter((r) => r.record.status === "verified"),
        pending: rows.filter((r) => r.record.status === "requested"),
        lapsed: rows.filter((r) => r.record.status === "expired"),
      };
    })(),
  };
}

/*
  `getAllMemberIds` used to live here, for `generateStaticParams`.

  Build-time prerendering was removed — it ran with no request and no session,
  hit the mock-data fallback, and baked profile pages for people who don't
  exist (docs/HANDOFF.md §4). `app/(app)` is `force-dynamic` now, so nothing
  has called this since. Deleted rather than left as a function nobody can
  explain the purpose of.
*/

/**
 * Teams and divisions this person leads. Divisions first.
 *
 * A division is a team with no parent, and the distinction matters on the
 * roster: leading one makes you a top PL over every project inside it, at any
 * depth. Leading a sub-team is the same authority over a much smaller subtree.
 * "Lead" alone says neither.
 */
function teamsLedBy(
  memberId: string
): { id: string; name: string; isDivision: boolean }[] {
  return readStore()
    .teams.filter((t) => t.leadId === memberId && t.isActive !== false)
    .map((t) => ({
      id: t.id,
      name: t.name,
      isDivision: t.parentId === null,
    }))
    .sort(
      (a, b) =>
        Number(b.isDivision) - Number(a.isDivision) ||
        a.name.localeCompare(b.name)
    );
}

/**
 * What kinds of authority this person actually holds.
 *
 * `globalRole` answers "are they leadership" and nothing else — it can't tell
 * you whether a plain member is a PL of three projects, or whether a "lead"
 * runs a division or one sub-team. Both distinctions change what the leadership
 * guide should say to them, and whether they should be offered it at all.
 */
export async function getLeadershipRoles(memberId: string): Promise<{
  /**
   * A PL of at least one project.
   *
   * Also decides whether the Dashboard link appears in the nav, and it has to be
   * the SAME fact `/dashboard` redirects on — `can.viewLeadershipDashboard`.
   *
   * There was a `hasReports` beside this doing that job until 2026-08-24, and
   * the reason it existed is worth carrying over to its replacement. The nav
   * used to key off `globalRole !== "member"`, which got it wrong in both
   * directions: a `lead` with nothing to look at saw a link that bounced them
   * straight back, and a plain member who was entitled to the page saw no link.
   * The fix was to ask the tree rather than the role string. Same fix, different
   * tree: it is now `project_res` rather than `profiles.lead_id`.
   */
  isRE: boolean;
  /** Names of divisions they lead — top-level teams only. */
  divisionsLed: string[];
}> {
  await preloadLiveStore();
  const store = readStore();

  return {
    isRE: store.projects.some((p) => p.reIds.includes(memberId)),
    divisionsLed: teamsLedBy(memberId)
      .filter((t) => t.isDivision)
      .map((t) => t.name),
  };
}
