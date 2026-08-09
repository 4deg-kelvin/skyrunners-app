/**
 * Free-form "I need help" asks.
 *
 * ---------------------------------------------------------------------------
 * What this used to be
 * ---------------------------------------------------------------------------
 *
 * This built a whole blocker board: three sources merged — blocked
 * deliverables, blockers written into check-ins, and free-form asks — on their
 * own page at `/blockers`.
 *
 * Two of those three now live where they belong. A blocked deliverable is a
 * fact about a project, and the project row already carries a "N blocked"
 * badge; `getDivisionExtras` lists them per division underneath the tree. A
 * separate page asked people to navigate away to read something about the
 * project in front of them, and the nav reached eight items paying for it.
 *
 * The free-form ask is the one with nowhere else to go, and the one that
 * matters most. Membership is RE-controlled, so a member waiting on a join
 * request otherwise has exactly one route to being useful and it depends on a
 * single person answering their inbox. "Does anyone know Onshape well enough
 * to look at this?" needs a home that isn't a project they haven't joined.
 *
 * So this shrank to the part that earns its keep.
 */

import { getMember, getProject, helpRequests, today } from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { can, type Actor } from "@/lib/permissions";
import { preloadLiveStore } from "@/lib/store/request";
import {
  HELP_REQUEST_STALE_DAYS,
  type HelpRequest,
  type Member,
  type Project,
} from "@/lib/types";

export interface BlockerItem {
  key: string;
  title: string;
  detail?: string;
  member?: Member;
  project?: Project;
  since: string;
  ageDays: number;
  /** Past `HELP_REQUEST_STALE_DAYS` with nothing back. Age, never count. */
  stale: boolean;
  request: HelpRequest;
  repliers: Member[];
  /**
   * Resolved here, not in the component.
   *
   * The rule is "the asker, whoever replied, or a Co-Lead" — which needs the
   * actor and the ask's reply list together. A client component has neither,
   * and re-deriving it there would be a second copy of a permission rule,
   * which is the thing `lib/permissions.ts` exists to prevent.
   */
  canClose: boolean;
  canDelete: boolean;
}

function daysSince(iso: string): number {
  const from = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today()}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function toItem(request: HelpRequest, actor: Actor): BlockerItem {
  const ageDays = daysSince(request.createdAt);
  const replierIds = request.replies.map((r) => r.memberId);

  return {
    key: `ask:${request.id}`,
    title: request.title,
    detail: request.detail,
    member: getMember(request.memberId),
    project: request.projectId ? getProject(request.projectId) : undefined,
    since: request.createdAt,
    ageDays,
    stale: ageDays >= HELP_REQUEST_STALE_DAYS,
    request,
    repliers: request.replies
      .map((r) => getMember(r.memberId))
      .filter((m): m is Member => Boolean(m)),
    canClose: can.resolveHelpRequest(actor, request.memberId, replierIds),
    canDelete: can.deleteHelpRequest(actor, request.memberId),
  };
}

/**
 * Open asks, oldest first.
 *
 * Age-sorted, always, and never by project or severity. Same reasoning as the
 * check-in escalation: "14 open" is a number people learn to scroll past,
 * while "nobody has answered Kenji in 6 days" names one person and is
 * actionable.
 */
export async function getOpenAsks(actor: Actor): Promise<BlockerItem[]> {
  await preloadLiveStore();

  return helpRequests()
    .filter((r) => !r.resolvedAt)
    .map((r) => toItem(r, actor))
    .sort((a, b) => a.since.localeCompare(b.since));
}

/**
 * Asks that got sorted, newest first, with the note on how.
 *
 * Kept rather than deleted — the note is the useful half, and it's how the
 * next person with the same problem finds the answer without asking again.
 * Shown on the asker's own profile rather than club-wide, because at that
 * point it's part of their record and not a live queue.
 */
export async function getResolvedAsksFor(
  memberId: string,
  actor: Actor
): Promise<BlockerItem[]> {
  await preloadLiveStore();

  return readStore()
    .helpRequests.filter((r) => r.memberId === memberId && r.resolvedAt)
    .map((r) => toItem(r, actor))
    .sort((a, b) =>
      (b.request.resolvedAt ?? "").localeCompare(a.request.resolvedAt ?? "")
    );
}

/** Projects a member could attach an ask to. Everything still running. */
export async function getAskProjectOptions(): Promise<
  { id: string; name: string }[]
> {
  await preloadLiveStore();
  return readStore()
    .projects.filter((p) => p.phase !== "complete")
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
