/**
 * Every write the app can make.
 *
 * ---------------------------------------------------------------------------
 * Why they all live in one file
 * ---------------------------------------------------------------------------
 *
 * These are the functions that become Postgres calls. Keeping them together and
 * free of UI concerns means the Supabase swap is one file's worth of bodies,
 * with the rules and validation already settled and tested — the same bet
 * `lib/data/*` makes for reads.
 *
 * Every function:
 *   - takes plain data, never a FormData or a React thing
 *   - validates, and returns a typed failure rather than throwing
 *   - is pure with respect to permissions: the CALLER checks `can.*`
 *
 * That last point is deliberate. Permission checks need the org graph, which is
 * request-scoped; embedding them here would either duplicate the graph or make
 * every operation take one. The Server Actions in `lib/actions/*` are the
 * enforcement layer, and they are the only callers.
 */

import { mutate, readStore } from "./disk.ts";
import type {
  Deliverable,
  DeliverableStatus,
  JoinRequest,
  ProgressUpdate,
  WorkLog,
} from "../types.ts";

/**
 * How far back hours can be dated.
 *
 * Seven days covers "I forgot to log all week and it's Sunday", which is the
 * real behaviour, while keeping the numbers close enough to the work that
 * they're worth trusting. Beyond a week people are guessing, and a guessed
 * number that looks precise is worse than a missing one.
 */
export const MAX_BACKDATE_DAYS = 7;

/** Sanity ceiling on a single entry. Catches 80 meaning 8.0. */
const MAX_HOURS_PER_ENTRY = 16;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Stable-ish unique id. Postgres will use `gen_random_uuid()` instead. */
function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Phase 3 — hours
// ---------------------------------------------------------------------------

/**
 * True once a submitted check-in has already reported hours for this date.
 *
 * Hours that a Lead has already read must not change underneath them. Without
 * this, someone could submit "3 hours this week", have it reviewed, then edit it
 * to 12 — and the report the Lead acted on would no longer exist anywhere.
 */
export function hoursAreLocked(memberId: string, workDate: string): boolean {
  const { progressUpdates } = readStore();
  return progressUpdates.some(
    (u) =>
      u.memberId === memberId &&
      (u.status === "submitted" || u.status === "reviewed") &&
      !!u.submittedAt &&
      // Anything dated on or before a submitted check-in has been reported.
      workDate.slice(0, 10) <= u.submittedAt.slice(0, 10)
  );
}

export async function logHours(input: {
  memberId: string;
  projectId: string;
  workDate: string;
  hours: number;
  description?: string;
  /** Today, passed in so this stays testable and render-stable. */
  today: string;
}): Promise<Result<WorkLog>> {
  const { memberId, projectId, workDate, hours, description, today } = input;

  if (!Number.isFinite(hours) || hours <= 0) {
    return fail("Enter how many hours you worked.");
  }
  if (hours > MAX_HOURS_PER_ENTRY) {
    return fail(`That's over ${MAX_HOURS_PER_ENTRY} hours in one go — is it a typo?`);
  }

  const age = daysBetween(workDate, today);
  if (age < 0) {
    return fail("You can't log hours for a future date.");
  }
  if (age > MAX_BACKDATE_DAYS) {
    return fail(
      `That's ${age} days ago. You can log up to ${MAX_BACKDATE_DAYS} days back — ask your Lead to add anything older.`
    );
  }
  if (hoursAreLocked(memberId, workDate)) {
    return fail(
      "You've already submitted a check-in covering that day, so those hours are locked. Log it against today instead."
    );
  }

  const log: WorkLog = {
    id: newId("w"),
    memberId,
    projectId,
    workDate: workDate.slice(0, 10),
    hours,
    description: description?.trim() || undefined,
  };

  await mutate((store) => store.workLogs.push(log));
  return ok(log);
}

export async function deleteWorkLog(
  logId: string,
  memberId: string,
  today: string
): Promise<Result<null>> {
  const { workLogs } = readStore();
  const log = workLogs.find((w) => w.id === logId);

  if (!log) return fail("That entry no longer exists.");
  // Ownership is re-checked here as well as in the action. Cheap, and the cost
  // of getting it wrong is someone deleting another member's hours.
  if (log.memberId !== memberId) return fail("That isn't your entry.");
  if (hoursAreLocked(memberId, log.workDate)) {
    return fail("Those hours are part of a check-in you've already submitted.");
  }
  void today;

  await mutate((store) => {
    store.workLogs = store.workLogs.filter((w) => w.id !== logId);
  });
  return ok(null);
}

// ---------------------------------------------------------------------------
// Phase 4 — deliverables
// ---------------------------------------------------------------------------

export async function createDeliverable(input: {
  projectId: string;
  title: string;
  ownerId: string;
  dueDate?: string;
}): Promise<Result<Deliverable>> {
  const title = input.title.trim();
  if (!title) return fail("Give the deliverable a title.");
  if (!input.ownerId) {
    // Exactly one owner, always — shared ownership means nobody owns it.
    return fail("Every deliverable needs exactly one owner.");
  }

  const { deliverables } = readStore();
  const siblings = deliverables.filter((d) => d.projectId === input.projectId);
  const sortOrder =
    siblings.reduce((max, d) => Math.max(max, d.sortOrder), 0) + 1;

  const deliverable: Deliverable = {
    id: newId("d"),
    projectId: input.projectId,
    title,
    ownerId: input.ownerId,
    dueDate: input.dueDate || undefined,
    status: "open",
    sortOrder,
  };

  await mutate((store) => {
    store.deliverables.push(deliverable);

    // Auto-add the owner to the project if they aren't on it.
    //
    // Adding people IS the RE's authority, so making them do it as a separate
    // step is friction with no safety value — and an owner who isn't a member
    // means the roster stops matching who's actually doing the work.
    const alreadyOn = store.projectMemberships.some(
      (m) => m.projectId === input.projectId && m.memberId === input.ownerId
    );
    if (!alreadyOn) {
      store.projectMemberships.push({
        projectId: input.projectId,
        memberId: input.ownerId,
        role: "contributor",
        joinedAt: new Date().toISOString().slice(0, 10),
        commitment: "committed",
      });
    } else {
      // Already there but only watching — being handed work makes it real.
      const existing = store.projectMemberships.find(
        (m) => m.projectId === input.projectId && m.memberId === input.ownerId
      );
      if (existing && existing.commitment === "following") {
        existing.commitment = "committed";
      }
    }
  });

  return ok(deliverable);
}

/**
 * The owner says it's finished. This does NOT complete it.
 *
 * See `DeliverableStatus` — `submitted` is a claim, `done` is the RE agreeing,
 * and only `done` counts toward the Delivered signal.
 */
export async function submitDeliverable(
  deliverableId: string,
  actorId: string,
  now: string
): Promise<Result<Deliverable>> {
  return updateOne(deliverableId, (d) => {
    if (d.ownerId !== actorId) {
      return fail<Deliverable>("Only the owner can mark this done.");
    }
    if (d.status === "done") return fail<Deliverable>("Already signed off.");

    d.status = "submitted";
    d.submittedAt = now;
    return ok(d);
  });
}

/** The RE agrees. This is the step that makes it count. */
export async function confirmDeliverable(
  deliverableId: string,
  reId: string,
  now: string
): Promise<Result<Deliverable>> {
  return updateOne(deliverableId, (d) => {
    if (d.status === "done") return fail<Deliverable>("Already signed off.");

    d.status = "done";
    d.completedAt = now;
    // Snapshotted: REs change over a project's life, and "who signed this off"
    // must stay answerable after they've moved on.
    d.confirmedById = reId;
    d.blockerNote = undefined;
    return ok(d);
  });
}

/** The RE disagrees — send it back with a reason. */
export async function reopenDeliverable(
  deliverableId: string,
  reason: string,
  now: string
): Promise<Result<Deliverable>> {
  const note = reason.trim();
  if (!note) {
    // A bare rejection is the thing that makes people stop submitting.
    return fail("Say what still needs doing — a rejection with no reason reads as a brush-off.");
  }

  return updateOne(deliverableId, (d) => {
    d.status = "in_progress";
    d.submittedAt = undefined;
    d.completedAt = undefined;
    d.confirmedById = undefined;
    d.blockerNote = note;
    void now;
    return ok(d);
  });
}

export async function setDeliverableStatus(
  deliverableId: string,
  status: Extract<DeliverableStatus, "open" | "in_progress" | "blocked">,
  blockerNote?: string
): Promise<Result<Deliverable>> {
  if (status === "blocked" && !blockerNote?.trim()) {
    // A blocker with no reason can't be routed to anyone who could clear it,
    // which makes the blocker board useless.
    return fail("Say what's blocking it, so someone can unblock you.");
  }

  return updateOne(deliverableId, (d) => {
    d.status = status;
    d.blockerNote = status === "blocked" ? blockerNote?.trim() : undefined;
    d.submittedAt = undefined;
    return ok(d);
  });
}

async function updateOne(
  deliverableId: string,
  fn: (d: Deliverable) => Result<Deliverable>
): Promise<Result<Deliverable>> {
  return mutate((store) => {
    const found = store.deliverables.find((d) => d.id === deliverableId);
    if (!found) return fail<Deliverable>("That deliverable no longer exists.");
    return fn(found);
  });
}

// ---------------------------------------------------------------------------
// Check-in review
// ---------------------------------------------------------------------------

/**
 * A Lead marks a report read.
 *
 * The queue and the escalation were both built before this existed, which meant
 * a Lead could see what they owed but had no way to discharge it — the queue
 * only ever grew. This is the write that closes the loop and stops the
 * escalation clock.
 *
 * `reviewedBy` is recorded because "who read this" has to stay answerable after
 * the person has moved on, the same reason `lead_id_at_submission` is
 * snapshotted on the row.
 */
export async function markUpdateReviewed(input: {
  updateId: string;
  reviewedBy: string;
  today: string;
}): Promise<Result<ProgressUpdate>> {
  return mutate((store) => {
    const update = store.progressUpdates.find((u) => u.id === input.updateId);
    if (!update) return fail<ProgressUpdate>("That check-in no longer exists.");

    if (update.status === "reviewed") {
      return fail<ProgressUpdate>("Already marked as read.");
    }
    if (update.status !== "submitted" && update.status !== "late") {
      // Nothing has been written yet, so there is nothing to have read.
      return fail<ProgressUpdate>("That check-in hasn't been submitted yet.");
    }

    update.status = "reviewed";
    update.reviewedAt = input.today;
    update.reviewedBy = input.reviewedBy;
    return ok(update);
  });
}

// ---------------------------------------------------------------------------
// Phase 2 — membership
// ---------------------------------------------------------------------------

/**
 * Ask an RE to be added to a project.
 *
 * This is the operation that makes `/find-work` mean anything. "Email the RE"
 * produces silence and an invisible member, which is the original problem
 * wearing a different hat — a tracked request lands in a queue, shows as
 * pending, and escalates at 5 days.
 */
export async function requestToJoin(input: {
  projectId: string;
  memberId: string;
  note?: string;
  today: string;
}): Promise<Result<JoinRequest>> {
  const { joinRequests, projectMemberships } = readStore();

  const alreadyCommitted = projectMemberships.some(
    (m) =>
      m.projectId === input.projectId &&
      m.memberId === input.memberId &&
      m.commitment === "committed"
  );
  if (alreadyCommitted) return fail("You're already on this project.");

  // One open ask at a time. Without this, an impatient member clicking twice
  // puts two identical rows in the RE's queue, and the RE has to work out
  // whether they're the same person asking twice or a bug.
  const openAsk = joinRequests.find(
    (r) =>
      r.projectId === input.projectId &&
      r.memberId === input.memberId &&
      r.status === "pending"
  );
  if (openAsk) return fail("You've already asked — it's still with the RE.");

  const request: JoinRequest = {
    id: newId("jr"),
    projectId: input.projectId,
    memberId: input.memberId,
    note: input.note?.trim() || undefined,
    status: "pending",
    requestedAt: input.today,
  };

  await mutate((store) => store.joinRequests.push(request));
  return ok(request);
}

/** The RE decides. Accepting adds them; declining must say something. */
export async function decideJoinRequest(input: {
  requestId: string;
  decidedById: string;
  accept: boolean;
  responseNote?: string;
  today: string;
}): Promise<Result<JoinRequest>> {
  return mutate((store) => {
    const request = store.joinRequests.find((r) => r.id === input.requestId);
    if (!request) return fail<JoinRequest>("That request no longer exists.");
    if (request.status !== "pending") {
      return fail<JoinRequest>("That request has already been answered.");
    }

    request.status = input.accept ? "accepted" : "declined";
    request.decidedAt = input.today;
    request.decidedById = input.decidedById;
    request.responseNote = input.responseNote?.trim() || undefined;

    if (input.accept) {
      const existing = store.projectMemberships.find(
        (m) =>
          m.projectId === request.projectId && m.memberId === request.memberId
      );
      if (existing) {
        // They were following; approving the ask makes it real.
        existing.commitment = "committed";
      } else {
        store.projectMemberships.push({
          projectId: request.projectId,
          memberId: request.memberId,
          role: "contributor",
          joinedAt: input.today,
          commitment: "committed",
          addedBy: input.decidedById,
        });
      }
    }

    return ok(request);
  });
}

/** Withdraw your own ask. */
export async function withdrawJoinRequest(
  requestId: string,
  memberId: string
): Promise<Result<null>> {
  return mutate((store) => {
    const request = store.joinRequests.find((r) => r.id === requestId);
    if (!request) return fail<null>("That request no longer exists.");
    if (request.memberId !== memberId) return fail<null>("That isn't your request.");
    request.status = "withdrawn";
    return ok(null);
  });
}

/**
 * Follow / unfollow — self-service, unlimited, no obligations.
 *
 * The counterpart to RE-controlled membership: you can't add yourself to the
 * work, but nobody needs permission to pay attention. Following is what stops
 * "membership is controlled" from feeling like "you're shut out".
 */
export async function setFollowing(input: {
  projectId: string;
  memberId: string;
  following: boolean;
  today: string;
}): Promise<Result<null>> {
  return mutate((store) => {
    const existing = store.projectMemberships.find(
      (m) => m.projectId === input.projectId && m.memberId === input.memberId
    );

    if (input.following) {
      if (existing) return ok(null); // already on it, in some capacity
      store.projectMemberships.push({
        projectId: input.projectId,
        memberId: input.memberId,
        role: "observer",
        joinedAt: input.today,
        commitment: "following",
      });
      return ok(null);
    }

    // Never silently drop a committed membership — that's an RE decision, and
    // losing it here would quietly strip someone of their deliverables.
    if (existing && existing.commitment === "committed") {
      return fail<null>(
        "You're a committed member here. Ask the RE to take you off."
      );
    }
    store.projectMemberships = store.projectMemberships.filter(
      (m) => !(m.projectId === input.projectId && m.memberId === input.memberId)
    );
    return ok(null);
  });
}

/** RE removes someone from their project. */
export async function removeProjectMember(input: {
  projectId: string;
  memberId: string;
}): Promise<Result<{ reassigned: number }>> {
  return mutate((store) => {
    const openWork = store.deliverables.filter(
      (d) =>
        d.projectId === input.projectId &&
        d.ownerId === input.memberId &&
        d.status !== "done"
    );

    store.projectMemberships = store.projectMemberships.filter(
      (m) => !(m.projectId === input.projectId && m.memberId === input.memberId)
    );

    // Their open deliverables don't vanish with them — they'd become invisible
    // work that nobody knows is unowned. Park them as blocked so the RE has to
    // deal with them, which is exactly who should.
    for (const d of openWork) {
      d.status = "blocked";
      d.blockerNote = "Owner left the project — needs reassigning.";
      d.submittedAt = undefined;
    }

    return ok({ reassigned: openWork.length });
  });
}
