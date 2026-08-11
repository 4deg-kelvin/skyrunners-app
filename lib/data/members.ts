/**
 * Roster and member profiles.
 *
 * PHASE 1 NOTE: the roster needs project counts per member. Do that with one
 * grouped query (or the `v_member_project_counts` view), not a per-member
 * lookup — 40 members × 2 lookups is 80 avoidable round trips.
 */

import {
  activeMembers,
  certificationsFor,
  daysUntil,
  committedProjectCount,
  contributionInputsFor,
  getMember,
  getProject,
  hoursOnProject,
  isOverdue,
  memberProjects,
  myDeliverables,
  projectBreadcrumb,
  projectREs,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { isAdvisor } from "@/lib/permissions";
import {
  buildContributionRecord,
  commitmentTier,
  type CommitmentTier,
  type ContributionRecord,
} from "@/lib/contribution";
import type {
  Deliverable,
  Member,
  MemberCertification,
  ProgressUpdate,
  Project,
  ProjectMembership,
  UpdateEntry,
} from "@/lib/types";
import type { BreadcrumbNode } from "./my-work";
import { preloadLiveStore } from "@/lib/store/request";

/** People who can be somebody's Lead — leadership plus anyone with reports. */
export interface RosterOptions {
  /** Candidates for the "reports to" dropdown. */
  /**
   * Candidates for "reports to", grouped and sorted.
   *
   * `group` drives an `<optgroup>` so the picker reads as an org chart rather
   * than a list of names in whatever order the database returned them. That
   * order was insertion order, which meant the answer somebody wanted was in a
   * random position and the list gave no clue who any of these people were.
   */
  leadOptions: {
    id: string;
    fullName: string;
    group: "Co-Leads" | "Team Leads" | "Others who lead someone";
  }[];
  /** Everyone active, for invite defaults and project assignment. */
  everyone: { id: string; fullName: string }[];
}

export interface RosterRow {
  member: Member;
  lead?: Member;
  /**
   * Units this person leads, nearest-to-the-top first.
   *
   * `globalRole` says "lead" but not WHAT of, and leading a division is a
   * materially different job from leading a sub-team — a Division Lead is a
   * top RE over everything inside it (see `leadsTeamAbove`). The roster is the
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
  /** Shown only where the viewer is allowed to see effort data. */
  tier: CommitmentTier;
  hoursPerWeek: number;
}

/**
 * Options the leadership controls need.
 *
 * Split from `getRoster` so the roster stays one query's worth of view model,
 * and computed here rather than in the page because pages may not import
 * `lib/mock-data` — ESLint enforces that boundary.
 */
/** Most senior first. Drives both the sort and the `<optgroup>` order. */
const GROUP_ORDER = [
  "Co-Leads",
  "Team Leads",
  "Others who lead someone",
] as const;

export async function getRosterOptions(): Promise<RosterOptions> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  const active = activeMembers();
  return {
    // Anyone who already leads someone stays eligible even if their global role
    // is `member` — the reporting chain is a fact about the org tree, not about
    // job titles, and demoting someone shouldn't silently orphan their reports.
    leadOptions: active
      .filter(
        (m) =>
          // Advisors are never candidates. Nobody reports to them — that's
          // half the definition of the role — and offering one here would
          // create a reporting line whose owner has no review queue to read it
          // in, so the member's check-ins would go somewhere nothing renders.
          !isAdvisor(m) &&
          (m.globalRole !== "member" ||
            active.some((other) => other.leadId === m.id))
      )
      .map((m) => ({
        id: m.id,
        fullName: m.fullName,
        group:
          m.globalRole === "co_lead"
            ? ("Co-Leads" as const)
            : m.globalRole === "lead"
              ? ("Team Leads" as const)
              : ("Others who lead someone" as const),
      }))
      // Rank first, then alphabetically. Same order as the roster itself, and
      // for the same reason: the question is "who does this person report
      // to?", which is answered by seniority long before it's answered by
      // whose name starts with A.
      .sort(
        (a, b) =>
          GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
          a.fullName.localeCompare(b.fullName)
      ),
    everyone: active.map((m) => ({ id: m.id, fullName: m.fullName })),
  };
}

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
      const inputs = contributionInputsFor(member.id);
      const hoursPerWeek =
        inputs.activeWeeks > 0 ? inputs.hoursTotal / inputs.activeWeeks : 0;

      return {
        member,
        lead: member.leadId ? getMember(member.leadId) : undefined,
        leads: teamsLedBy(member.id),
        committedCount: committedProjectCount(member.id),
        reCount: mine.filter((p) => p.role === "re").length,
        deliverablesCompleted: deliverables.filter((d) => d.status === "done")
          .length,
        openDeliverables: deliverables.filter((d) => d.status !== "done")
          .length,
        overdueDeliverables: deliverables.filter(isOverdue).length,
        tier: commitmentTier(hoursPerWeek, inputs.isPaused),
        hoursPerWeek: Math.round(hoursPerWeek * 10) / 10,
      };
    });
}

export interface MemberProjectRow {
  project: Project;
  membership: ProjectMembership;
  breadcrumb: BreadcrumbNode[];
  res: Member[];
  hoursLogged: number;
  /** What this person owns here — concrete, not a text field. */
  deliverables: Deliverable[];
  /** Days until the project's target. Negative once passed, undefined if unset. */
  daysToTarget?: number;
}

export interface MemberProfileView {
  member: Member;
  lead?: Member;
  /** People who report directly to this member. */
  directReports: Member[];
  projects: MemberProjectRow[];
  /**
   * Whether the viewer may see hours, update contents, and their contribution
   * record. Decided by the caller via `lib/permissions.ts` — this layer only
   * carries the answer through so the page doesn't re-derive it.
   */
  canViewEffort: boolean;
  /** Only populated when `canViewEffort` is true. */
  contribution?: ContributionRecord;
  /**
   * This person's check-in history, newest first. Empty unless `canViewEffort`.
   *
   * The review QUEUE on the dashboard stays scoped to direct reports, because
   * that's an obligation and it escalates — a Co-Lead with forty items owes
   * nothing in particular. Reading is a different act from being accountable
   * for reading, so it lives here, on the person, and follows the wider rule:
   * yourself, anyone up your chain, or a Co-Lead.
   */
  checkIns: MemberCheckIn[];
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
  canViewEffort: boolean
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
    lead: member.leadId ? getMember(member.leadId) : undefined,
    directReports: readStore().members.filter(
      (m) => m.leadId === member.id && m.status === "active"
    ),
    projects: memberProjects(memberId).flatMap((pm) => {
      if (!pm.project) return [];
      return [
        {
          project: pm.project,
          membership: pm,
          breadcrumb: projectBreadcrumb(pm.project.id),
          res: projectREs(pm.project.id),
          hoursLogged: canViewEffort
            ? hoursOnProject(memberId, pm.project.id)
            : 0,
          deliverables: myDeliverables(memberId).filter(
            (d) => d.projectId === pm.project!.id
          ),
          daysToTarget: daysUntil(pm.project.targetDate),
        },
      ];
    }),
    canViewEffort,
    // Never even compute it for a viewer who isn't allowed to see it
    contribution: canViewEffort
      ? buildContributionRecord(contributionInputsFor(memberId))
      : undefined,
    checkIns: canViewEffort
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
 * roster: leading one makes you a top RE over every project inside it, at any
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
 * you whether a plain member is an RE of three projects, or whether a "lead"
 * runs a division or one sub-team. Both distinctions change what the leadership
 * guide should say to them, and whether they should be offered it at all.
 */
export async function getLeadershipRoles(memberId: string): Promise<{
  isRE: boolean;
  /** Names of divisions they lead — top-level teams only. */
  divisionsLed: string[];
  /**
   * At least one person reports to them directly.
   *
   * Decides whether the Dashboard link appears in the nav, and it is the SAME
   * fact `/dashboard` redirects on — `can.viewLeadershipDashboard`. The nav
   * used to key off `globalRole !== "member"` instead, which got it wrong in
   * both directions: a `lead` with no reports saw a link that bounced them
   * straight back, and a plain member who had been given reports saw no link
   * for a page they were entitled to. Reporting lines are a fact about the org
   * tree, not about a role string.
   */
  hasReports: boolean;
}> {
  await preloadLiveStore();
  const store = readStore();

  return {
    isRE: store.projects.some((p) => p.reIds.includes(memberId)),
    divisionsLed: teamsLedBy(memberId)
      .filter((t) => t.isDivision)
      .map((t) => t.name),
    hasReports: store.members.some(
      (m) => m.leadId === memberId && m.status === "active"
    ),
  };
}
