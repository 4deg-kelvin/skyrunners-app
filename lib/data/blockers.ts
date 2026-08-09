/**
 * The blocker board — one club-wide list of everything that's stuck.
 *
 * ---------------------------------------------------------------------------
 * Why three sources, merged
 * ---------------------------------------------------------------------------
 *
 * Being stuck already gets recorded in two places, and neither of them is
 * somewhere a person who could help would ever look:
 *
 *   - a deliverable marked `blocked`, with a note, sitting on a project page
 *   - a blocker written into a check-in, sitting in one Lead's review queue
 *
 * Both are invisible to the person who happens to know the answer. Merging them
 * with free-form asks into a single page is the entire feature: the club's
 * root problem is "I can't find something to do without asking a Co-Lead", and
 * its mirror image is "I can't find anyone to unstick me without asking one".
 *
 * ---------------------------------------------------------------------------
 * Why age, not count
 * ---------------------------------------------------------------------------
 *
 * Sorted oldest-first, always. The same reasoning as the check-in escalation in
 * `lib/review.ts`: "14 open blockers" is a number people learn to scroll past,
 * while "nobody has answered Kenji in 6 days" names one person and is
 * actionable. Anything that re-sorted this by project or by severity would undo
 * that.
 */

import {
  getMember,
  getProject,
  helpRequests,
  openBlockerDeliverables,
  today,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { preloadLiveStore } from "@/lib/store/request";
import {
  HELP_REQUEST_STALE_DAYS,
  type Deliverable,
  type HelpRequest,
  type Member,
  type Project,
} from "@/lib/types";

/**
 * Where a stuck thing came from. Rendered differently, sorted together.
 *
 *   `deliverable` — an RE or owner marked a piece of work blocked
 *   `check_in`    — somebody wrote a blocker in their twice-weekly update
 *   `ask`         — a free-form post, the only one anyone creates deliberately
 */
export type BlockerSource = "deliverable" | "check_in" | "ask";

export interface BlockerItem {
  /** Stable within a render — used as the React key and nothing else. */
  key: string;
  source: BlockerSource;
  title: string;
  /** The blocker note, the check-in text, or the ask's detail. */
  detail?: string;
  /** Who is stuck. */
  member?: Member;
  project?: Project;
  /** When it became visible as stuck. Drives the ordering. */
  since: string;
  ageDays: number;
  /** Past `HELP_REQUEST_STALE_DAYS` with nothing back. */
  stale: boolean;
  /** Only an `ask` carries these — the others are answered where they live. */
  request?: HelpRequest;
  repliers: Member[];
  /** Only a `deliverable` carries this, for the link to its project. */
  deliverable?: Deliverable;
}

export interface BlockerBoardView {
  open: BlockerItem[];
  /** Resolved asks, newest first. Kept — the answer is the useful half. */
  resolved: BlockerItem[];
  /** Projects the viewer could attach an ask to. Everything active. */
  projectOptions: { id: string; name: string }[];
  /** Their own open asks, so the page can say "you have one waiting". */
  myOpenCount: number;
}

function daysSince(iso: string): number {
  const from = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today()}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function withAge(
  item: Omit<BlockerItem, "ageDays" | "stale">
): BlockerItem {
  const ageDays = daysSince(item.since);
  return { ...item, ageDays, stale: ageDays >= HELP_REQUEST_STALE_DAYS };
}

export async function getBlockerBoard(
  viewerId: string
): Promise<BlockerBoardView> {
  await preloadLiveStore();
  const store = readStore();

  // --- 1. Deliverables somebody marked blocked -----------------------------
  const fromDeliverables = openBlockerDeliverables().map((deliverable) =>
    withAge({
      key: `deliverable:${deliverable.id}`,
      source: "deliverable",
      title: deliverable.title,
      detail: deliverable.blockerNote,
      member: getMember(deliverable.ownerId),
      project: getProject(deliverable.projectId),
      // No "blocked at" column exists, so the due date is the closest honest
      // proxy for how long this has been a problem. Falling back to today
      // rather than to the epoch: an undated blocker is new, not ancient, and
      // guessing old would push real six-day-old asks off the top of the page.
      since: deliverable.dueDate ?? today(),
      repliers: [],
      deliverable,
    })
  );

  // --- 2. Blockers written into a check-in ---------------------------------
  //
  // Only from SUBMITTED updates, and only the most recent per project+member:
  // somebody who reports the same blocker in four consecutive check-ins has one
  // problem, not four, and four rows would bury everyone else.
  const seenCheckIn = new Set<string>();
  const fromCheckIns = store.progressUpdates
    .filter((u) => u.submittedAt)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .flatMap((update) =>
      update.entries
        .filter((entry) => entry.blockers?.trim())
        .flatMap((entry) => {
          const dedupeKey = `${update.memberId}:${entry.projectId}`;
          if (seenCheckIn.has(dedupeKey)) return [];
          seenCheckIn.add(dedupeKey);

          const project = getProject(entry.projectId);
          return [
            withAge({
              key: `entry:${entry.id}`,
              source: "check_in",
              title: project ? `Blocked on ${project.name}` : "Blocked",
              detail: entry.blockers,
              member: getMember(update.memberId),
              project,
              since: update.submittedAt!,
              repliers: [],
            }),
          ];
        })
    );

  // --- 3. Free-form asks ---------------------------------------------------
  const asks = helpRequests().map((request) =>
    withAge({
      key: `ask:${request.id}`,
      source: "ask",
      title: request.title,
      detail: request.detail,
      member: getMember(request.memberId),
      project: request.projectId ? getProject(request.projectId) : undefined,
      since: request.createdAt,
      request,
      repliers: request.replies
        .map((r) => getMember(r.memberId))
        .filter((m): m is Member => Boolean(m)),
    })
  );

  const open = [...fromDeliverables, ...fromCheckIns, ...asks.filter(
    (a) => !a.request?.resolvedAt
  )].sort((a, b) => a.since.localeCompare(b.since));

  const resolved = asks
    .filter((a) => a.request?.resolvedAt)
    .sort((a, b) =>
      (b.request?.resolvedAt ?? "").localeCompare(a.request?.resolvedAt ?? "")
    );

  return {
    open,
    resolved,
    projectOptions: store.projects
      .filter((p) => p.phase !== "complete")
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    myOpenCount: open.filter((item) => item.member?.id === viewerId).length,
  };
}
