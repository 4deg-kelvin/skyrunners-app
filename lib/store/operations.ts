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
 *   - leaves ROLE and GRAPH questions to the caller
 *
 * ---------------------------------------------------------------------------
 * The one honest exception, so nobody trusts a rule that isn't true
 * ---------------------------------------------------------------------------
 *
 * "Operations check no permissions" is nearly right and was stated flatly here
 * for a long time, which is worse than stating it precisely. The real division:
 *
 *   ROLE and GRAPH questions — "is this person a Co-Lead", "do they lead a team
 *   above this project", "are they in this member's Lead chain" — need the
 *   request-scoped org graph. They live in `lib/permissions.ts` and are checked
 *   by the Server Actions in `lib/actions/*`, which are the only callers of
 *   this file. Embedding them here would mean duplicating the graph or
 *   threading it through twenty signatures.
 *
 *   OWNERSHIP questions — "is this YOUR work log", "is this YOUR join request"
 *   — need the row, which only this layer has. Four operations check them
 *   here, against an actor id the action derived from the session:
 *   `deleteWorkLog`, `withdrawJoinRequest`, `submitDeliverable`, and
 *   `setEventAttendance`. They are the last line rather than the only one, and
 *   they fail with a sentence the member can act on.
 *
 * If you add an operation that takes an `actorId`, it is almost certainly in
 * the second group — and the id must come from the session, never the form.
 */

import { mutate, readStore, type StoreShape } from "./disk.ts";
import { todayInClubTime } from "../dates.ts";
import { checkLinkPermanence } from "../artifacts.ts";
import { repeatProblem } from "../calendar/recurrence.ts";
import { DEFAULT_EVENT_IMPORTANCE } from "../types.ts";
import type {
  ArtifactKind,
  CatalogueItem,
  CatalogueItemKind,
  ClubEvent,
  Deliverable,
  DeliverableStatus,
  DeliverableTodo,
  MemberRequest,
  ProjectAdvisor,
  GlobalRole,
  GuideBlock,
  HelpReply,
  HelpRequest,
  JoinRequest,
  Member,
  ClubSettings,
  MemberCertification,
  MemberStatus,
  Project,
  ProjectArtifact,
  Team,
  Term,
  TrainingSection,
  UpdateEntry,
  WorkLog,
} from "../types.ts";

/**
 * How far back a work-log entry can be dated.
 *
 * Seven days covers "I forgot to log all week and it's Sunday", which is the
 * real behaviour, while keeping the entry close enough to the work that it's
 * worth trusting. Beyond a week people are reconstructing from memory, and a
 * confidently-written wrong account is worse than a missing one.
 */
export const MAX_BACKDATE_DAYS = 7;

/**
 * Set when someone is removed from a project while still owning open work.
 *
 * A sentinel rather than free text, because reassigning has to recognise it and
 * clear it — and must NOT clear a blocker somebody actually wrote.
 */
export const OWNER_LEFT_NOTE = "Owner left the project — needs reassigning.";

/**
 * Ceiling on one entry's note.
 *
 * Not a data-integrity rule — Postgres would take far more — but a shape rule.
 * This is a diary line that pre-fills a check-in section, and an essay pasted
 * here lands verbatim in front of a Lead reading twelve of them. Generous enough
 * that nobody hits it describing a real day's work.
 */
const MAX_DESCRIPTION_CHARS = 500;

/**
 * How many projects one person may create in a day and leave with no work on them.
 *
 * Set after an assistant connected to the MCP server created ~4,000 empty
 * projects in one run. See the long note in `createProject` for why the ceiling
 * counts EMPTY projects rather than requests, and why it lives in this file.
 *
 * Twenty-five is far above a planning session and far below a loop. It's a
 * backstop, not a quota — the number should never be reached by a person.
 */
export const MAX_EMPTY_PROJECTS_PER_DAY = 25;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/**
 * Run a write, turning a failed SAVE into a normal `Result` rather than a throw.
 *
 * The rule checks inside each operation already return `fail(...)`, and the UI
 * shows those inline. But the save itself happens afterwards, in `mutate()` —
 * and if Postgres rejects the row (a constraint, an RLS policy, a column that
 * doesn't exist), that rejection used to travel straight past the action layer
 * and hit Next's error boundary. The user got "This page didn't load" with the
 * actual reason visible only in a server log they can't reach.
 *
 * A refused write and a broken write are different things and should read
 * differently, so the message says which one this is and quotes the database.
 */
async function guarded<T>(
  fn: (store: StoreShape) => Result<T>
): Promise<Result<T>> {
  try {
    return await mutate(fn);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail<T>(`Couldn't save that — the database refused it: ${detail}`);
  }
}

/**
 * A real UUID.
 *
 * Every id column in the schema is `uuid`, so the readable ids this used to
 * mint (`m-anish`, `p-wing-spar`) are rejected outright by Postgres. The seed
 * data keeps its readable ids because demo mode never touches the database;
 * anything created at runtime gets a real one.
 *
 * `prefix` is ignored, and kept only so call sites read as documentation of
 * what's being created.
 */
function newId(_prefix: string): string {
  return crypto.randomUUID();
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// ---------------------------------------------------------------------------
// The work log — a diary, not a timesheet
// ---------------------------------------------------------------------------

/**
 * Too old to remove — the entry has become part of the project's record.
 *
 * ---------------------------------------------------------------------------
 * The window is the SAME one you can log into: seven days
 * ---------------------------------------------------------------------------
 *
 * This used to mean "a submitted check-in has already reported this date", and
 * the reason was a good one: what somebody had already read must not change
 * underneath them. Check-ins went on 2026-08-24, so that test could never fire
 * again and every entry would have stayed removable forever.
 *
 * Seven days, matching `MAX_BACKDATE_DAYS` exactly — the period you can still
 * write into is the period you can still correct. Somebody who logs the wrong
 * project notices within a day or two. Past a week the entry is other people's
 * context: it sits in the project's public feed, its Project Lead may have
 * replied to it, and the digest has already reported it.
 *
 * ---------------------------------------------------------------------------
 * `today` is a PARAMETER, and that is not a style preference
 * ---------------------------------------------------------------------------
 *
 * The first version read `todayInClubTime()` itself and broke two tests
 * immediately, because `logWork` computes its own `age` from the `today` it was
 * PASSED — so the two disagreed by whatever the fixture date was. Same class of
 * bug as the composer's `DEMO_TODAY` trap: two places deciding "what day is it"
 * separately will eventually pick different days, and the symptom is a refusal
 * carrying a reason the page never showed.
 *
 * Pure, so callers pass their own day. `memberId` went with the check-in lookup:
 * the rule is about the date, and ownership is checked by the caller holding the
 * row.
 */
export function workIsLocked(workDate: string, today: string): boolean {
  return daysBetween(workDate, today) > MAX_BACKDATE_DAYS;
}

/**
 * Record what you did on a day. The highest-frequency write in the app.
 *
 * Was `logHours`, and the change is not just the name. It used to take a number
 * and an OPTIONAL note; it now takes a REQUIRED note and no number. That
 * inversion is the whole point of the change: the note is the thing the club
 * actually wanted, and it was the field people skipped.
 *
 * The note carries real weight downstream — it pre-fills that project's section
 * of the next check-in — so an entry without one is now worthless rather than
 * merely thin, which is what justifies refusing it here instead of accepting a
 * blank.
 */
export async function logWork(input: {
  memberId: string;
  /**
   * Omit for "misc" — helping on something you aren't committed to.
   *
   * Follows directly from the calendar: somebody sees an open build session,
   * turns up, and spends an afternoon on a project they're not on the roster
   * for. That work is real. Refusing it made the honest answer impossible and
   * left logging against the wrong project as the only way through.
   */
  projectId?: string;
  workDate: string;
  description: string;
  /** Today, passed in so this stays testable and render-stable. */
  today: string;
}): Promise<Result<WorkLog>> {
  const { memberId, projectId, workDate, description, today } = input;

  const note = description.trim();
  if (!note) {
    return fail("Say what you did — a line is enough.");
  }
  if (note.length > MAX_DESCRIPTION_CHARS) {
    return fail(
      `That's ${note.length} characters. Keep it under ${MAX_DESCRIPTION_CHARS} — this is one line about what you did, not a report.`
    );
  }

  const age = daysBetween(workDate, today);
  if (age < 0) {
    return fail("You can't log work for a future date.");
  }
  if (age > MAX_BACKDATE_DAYS) {
    return fail(
      `That's ${age} days ago. You can log up to ${MAX_BACKDATE_DAYS} days back — ask the project's Lead to add anything older.`
    );
  }
  /*
    No second check here.

    There used to be a `workIsLocked` call, back when it meant "a submitted
    check-in already reported this day" — a genuinely different rule from the
    backdate window above. Now both are the same seven days, so it would be a
    second refusal for the same reason with worse wording. The message above
    names the number of days and what to do about it.
  */

  const log: WorkLog = {
    id: newId("w"),
    memberId,
    projectId,
    workDate: workDate.slice(0, 10),
    description: note,
  };

  return guarded((store) => {
    store.workLogs.push(log);
    return ok(log);
  });
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
  // of getting it wrong is someone deleting another member's log entry.
  if (log.memberId !== memberId) return fail("That isn't your entry.");
  if (workIsLocked(log.workDate, today)) {
    return fail(
      `You can only remove an entry within ${MAX_BACKDATE_DAYS} days of the day ` +
        `it covers. This one is part of the project's record now.`
    );
  }

  return guarded((store) => {
    store.workLogs = store.workLogs.filter((w) => w.id !== logId);
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Phase 4 — deliverables
// ---------------------------------------------------------------------------

/**
 * A deliverable cannot be due after the project it belongs to.
 *
 * Same rule as a sub-project not outliving its parent, and the same reasoning:
 * the project's target is a promise made to whoever is above it, and the
 * promise only holds if the work inside it lands first. A deliverable dated
 * past its project is arithmetic that doesn't close, and it's silent — both
 * dates look fine on their own row, and you find out at the project's deadline.
 *
 * No project target means no constraint. Plenty of long-running projects have
 * no end date, and inventing one to satisfy a rule would put a fake deadline in
 * front of everybody.
 *
 * Returns the message rather than a Result so both the create and the update
 * path can use it, and so the sentence naming the project and its date lives
 * in exactly one place.
 */
function dueAfterProject(
  store: StoreShape,
  projectId: string,
  dueDate?: string
): string | null {
  if (!dueDate) return null;
  const project = store.projects.find((p) => p.id === projectId);
  if (!project?.targetDate) return null;
  if (dueDate <= project.targetDate) return null;

  return `${project.name} is due ${project.targetDate}, so this can't be due ${dueDate}. Move the project's target first, or bring this in.`;
}

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

  return guarded((store) => {
    const tooLate = dueAfterProject(
      store,
      input.projectId,
      deliverable.dueDate
    );
    if (tooLate) return fail<Deliverable>(tooLate);

    store.deliverables.push(deliverable);

    // Auto-add the owner to the project if they aren't on it.
    //
    // Adding people IS the PL's authority, so making them do it as a separate
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
        joinedAt: todayInClubTime(),
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
    return ok(deliverable);
  });
}

/**
 * "There are still 3 things ticked off on this", or null if there aren't.
 *
 * The one rule the checklist enforces, in the one place both callers can see
 * it. A deliverable with an open item on its own list is, by the list's own
 * account, not finished — so neither the owner's claim nor the PL's sign-off
 * can go through while one is open.
 *
 * Blocking the owner's claim as well as the PL's approval is deliberate. If
 * only sign-off were gated, the wall would land in front of the PL, who is the
 * busier person and not the one who knows whether the item is really
 * outstanding. This way whoever wrote the list is the one told about it.
 */
function openTodoBlock(
  store: StoreShape,
  deliverableId: string
): string | null {
  const open = store.deliverableTodos.filter(
    (t) => t.deliverableId === deliverableId && !t.done
  );
  if (open.length === 0) return null;

  const first = open[0].title;
  return open.length === 1
    ? `The checklist still has "${first}" open. Tick it off, or delete it if it turned out not to be needed.`
    : `The checklist still has ${open.length} items open, starting with "${first}". Tick them off, or delete the ones that turned out not to be needed.`;
}

/**
 * The owner says it's finished. This does NOT complete it.
 *
 * See `DeliverableStatus` — `submitted` is a claim, `done` is the PL agreeing,
 * and only `done` counts toward the Delivered signal.
 */
export async function submitDeliverable(
  deliverableId: string,
  actorId: string,
  now: string
): Promise<Result<Deliverable>> {
  return guarded((store) => {
    const d = store.deliverables.find((x) => x.id === deliverableId);
    if (!d) return fail<Deliverable>("That deliverable no longer exists.");

    if (d.ownerId !== actorId) {
      return fail<Deliverable>("Only the owner can mark this done.");
    }
    if (d.status === "done") return fail<Deliverable>("Already signed off.");

    const blocked = openTodoBlock(store, deliverableId);
    if (blocked) return fail<Deliverable>(blocked);

    d.status = "submitted";
    d.submittedAt = now;
    return ok(d);
  });
}

/** The PL agrees. This is the step that makes it count. */
export async function confirmDeliverable(
  deliverableId: string,
  reId: string,
  now: string
): Promise<Result<Deliverable>> {
  return guarded((store) => {
    const d = store.deliverables.find((x) => x.id === deliverableId);
    if (!d) return fail<Deliverable>("That deliverable no longer exists.");
    if (d.status === "done") return fail<Deliverable>("Already signed off.");

    /*
      A PL can clear this themselves — ticking an item is a right they have —
      so this isn't a dead end for them, it's a prompt to look at the list
      before putting their name on the work.
    */
    const blocked = openTodoBlock(store, deliverableId);
    if (blocked) return fail<Deliverable>(blocked);

    d.status = "done";
    d.completedAt = now;
    // Snapshotted: PLs change over a project's life, and "who signed this off"
    // must stay answerable after they've moved on.
    d.confirmedById = reId;
    d.blockerNote = undefined;
    return ok(d);
  });
}

// ---------------------------------------------------------------------------
// Checklists under a deliverable
//
// Deliberately thin. A todo has a title and a tick and nothing else — see
// `DeliverableTodo` for why adding an owner or a date to one is the wrong move.
//
// None of these check permission: `can.manageDeliverableTodos` does, in the
// action layer, because the answer depends on the org graph and this file
// never sees it.
// ---------------------------------------------------------------------------

export async function addDeliverableTodo(input: {
  deliverableId: string;
  title: string;
  actorId: string;
}): Promise<Result<DeliverableTodo>> {
  const title = input.title.trim();
  if (!title) return fail<DeliverableTodo>("Give the item a name.");
  if (title.length > 200) {
    return fail<DeliverableTodo>(
      "That's long for a checklist item — if it needs a paragraph, it's probably a deliverable."
    );
  }

  return guarded((store) => {
    const parent = store.deliverables.find((d) => d.id === input.deliverableId);
    if (!parent) {
      return fail<DeliverableTodo>("That deliverable no longer exists.");
    }
    if (parent.status === "done") {
      return fail<DeliverableTodo>(
        "That deliverable is signed off. Adding to its checklist now wouldn't change anything — reopen it first if the work isn't actually finished."
      );
    }

    const siblings = store.deliverableTodos.filter(
      (t) => t.deliverableId === input.deliverableId
    );
    // Appended, never inserted. A checklist is read top to bottom.
    const sortOrder =
      siblings.reduce((max, t) => Math.max(max, t.sortOrder), -1) + 1;

    const todo: DeliverableTodo = {
      id: newId("todo"),
      deliverableId: input.deliverableId,
      title,
      done: false,
      sortOrder,
      createdBy: input.actorId,
    };
    store.deliverableTodos.push(todo);
    return ok(todo);
  });
}

export async function setDeliverableTodoDone(input: {
  todoId: string;
  done: boolean;
  actorId: string;
  now: string;
}): Promise<Result<DeliverableTodo>> {
  return guarded((store) => {
    const todo = store.deliverableTodos.find((t) => t.id === input.todoId);
    if (!todo) return fail<DeliverableTodo>("That item no longer exists.");

    todo.done = input.done;
    /*
      Cleared on untick, not just set on tick. The database has a CHECK
      constraint that `done` and `done_at` agree (migration 0028) — leaving a
      stale timestamp behind would be rejected by Postgres and pass silently in
      demo mode, which is the worst kind of divergence between the two.
    */
    todo.doneAt = input.done ? input.now : undefined;
    todo.doneBy = input.done ? input.actorId : undefined;
    return ok(todo);
  });
}

export async function renameDeliverableTodo(input: {
  todoId: string;
  title: string;
}): Promise<Result<DeliverableTodo>> {
  const title = input.title.trim();
  if (!title) return fail<DeliverableTodo>("Give the item a name.");

  return guarded((store) => {
    const todo = store.deliverableTodos.find((t) => t.id === input.todoId);
    if (!todo) return fail<DeliverableTodo>("That item no longer exists.");
    todo.title = title;
    return ok(todo);
  });
}

/**
 * Deleting is allowed, and unlike a deliverable there's no record to protect.
 *
 * That asymmetry is the point: `deleteDeliverable` refuses signed-off work
 * because it counts towards somebody's Delivered signal. A todo counts towards
 * nothing, so "that turned out not to be needed" is a perfectly good reason to
 * remove one, and requiring it be ticked instead would put a false tick in the
 * record.
 */
export async function deleteDeliverableTodo(
  todoId: string
): Promise<Result<{ id: string }>> {
  return guarded((store) => {
    const index = store.deliverableTodos.findIndex((t) => t.id === todoId);
    if (index === -1)
      return fail<{ id: string }>("That item no longer exists.");
    store.deliverableTodos.splice(index, 1);
    return ok({ id: todoId });
  });
}

/**
 * A PL above says a signed-off deliverable wasn't actually done.
 *
 * ---------------------------------------------------------------------------
 * Why this isn't just `reopenDeliverable`
 * ---------------------------------------------------------------------------
 *
 * `reopenDeliverable` handles a CLAIM being rejected — the owner said done, the
 * PL disagrees, nothing ever counted. This handles an APPROVAL being withdrawn,
 * which is a different and heavier thing:
 *
 *   - It takes a completed deliverable back off somebody's record. Delivered is
 *     the primary contribution signal precisely because it can't be inflated,
 *     so removing one is not a status edit — it's a correction to the club's
 *     history, and it needs a reason attached in writing.
 *   - It contradicts a named person's judgement, not the owner's. That's why
 *     `can.withdrawSignOff` requires authority from ABOVE the project: the PL
 *     who signed it cannot quietly un-sign it.
 *   - **A complete project goes back to active with it.** "The engineering
 *     doesn't meet requirements" and "the project is finished" cannot both be
 *     true. Leaving the project complete would keep it out of `/find-work` and
 *     in the club's record of what got built, with nobody assigned to fix the
 *     thing that just failed — the exact hidden-work failure this app exists to
 *     remove. A notice goes up the tree, same as any completion change, so the
 *     people told it was done are told it isn't.
 *
 * Cascading here is deliberate and is NOT in tension with `updateProject`
 * refusing to complete children on a parent's behalf. That refusal protects
 * work from being signed off by someone who didn't review it. This runs the
 * other way: it withdraws an approval, which is always the safe direction.
 */
export async function withdrawSignOff(input: {
  deliverableId: string;
  reason: string;
  actorId: string;
  today: string;
}): Promise<Result<Deliverable>> {
  const note = input.reason.trim();
  if (!note) {
    return fail<Deliverable>(
      "Say what doesn't meet the requirement. Taking a sign-off back off someone's record without a reason is the worst version of this."
    );
  }

  return guarded((store) => {
    const d = store.deliverables.find((x) => x.id === input.deliverableId);
    if (!d) return fail<Deliverable>("That deliverable no longer exists.");
    if (d.status !== "done") {
      return fail<Deliverable>(
        "That isn't signed off, so there's nothing to take back. Send it back instead."
      );
    }

    d.status = "in_progress";
    d.completedAt = undefined;
    d.submittedAt = undefined;
    d.confirmedById = undefined;
    d.blockerNote = note;

    const project = store.projects.find((p) => p.id === d.projectId);
    if (!project) return ok(d);

    /*
      Reopen the project if this rejection contradicts it being finished.

      `phase` is a LIFECYCLE stage, not a status, and nothing here knows which
      stage the work fell back to — the app never recorded where the project was
      before it was completed. `testing` is a placeholder, chosen because it's
      where "doesn't meet the requirement" is usually discovered, and the notice
      says so out loud rather than letting a wrong stage sit there looking
      authoritative. The PL corrects it in one edit.

      `at_risk` rather than `blocked`: something needs redoing, which isn't the
      same as being unable to proceed.
    */
    if (project.phase === "complete") {
      project.phase = "testing";
      project.health = "at_risk";

      const actor = store.members.find((m) => m.id === input.actorId);
      const who = actor?.preferredName || actor?.fullName || "Someone";

      store.projectNotices.push({
        id: newId("notice"),
        projectId: project.id,
        kind: "reopened",
        body:
          `${project.name} is back in the active list. ${who} rejected "${d.title}" — ${note} ` +
          `It's been put back to testing as a placeholder; whoever picks this up should set the real phase.`,
        createdById: input.actorId,
        createdAt: input.today,
        notifiedMemberIds: completionAudience(store, project, input.actorId),
      });
    }

    return ok(d);
  });
}

/** The PL disagrees — send it back with a reason. */
export async function reopenDeliverable(
  deliverableId: string,
  reason: string,
  now: string
): Promise<Result<Deliverable>> {
  const note = reason.trim();
  if (!note) {
    // A bare rejection is the thing that makes people stop submitting.
    return fail(
      "Say what still needs doing — a rejection with no reason reads as a brush-off."
    );
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
  return guarded((store) => {
    const found = store.deliverables.find((d) => d.id === deliverableId);
    if (!found) return fail<Deliverable>("That deliverable no longer exists.");
    return fn(found);
  });
}

// ---------------------------------------------------------------------------
// People — invite, roles, reporting chain, status
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Slugs that are real pages under `/projects/`.
 *
 * Next resolves a static segment ahead of `[slug]`, so a project called
 * "Archive" would get the URL `/projects/archive` and render the archive page
 * instead of itself — permanently unreachable, with nothing anywhere saying
 * why. Cheaper to rename at creation than to debug later.
 */
const RESERVED_PROJECT_SLUGS = new Set(["archive", "new"]);

/** Invite someone by Stanford email. They become real on first sign-in. */
export async function inviteMember(input: {
  email: string;
  fullName: string;
  /**
   * Optional at invite time, but asked for here because it's what the whole
   * app shows instead of an email — a PL's contact line, a Lead chasing a
   * check-in. Left to the member's own profile edit, it stayed empty and every
   * contact link silently fell back to email.
   */
  phone?: string;
  globalRole: GlobalRole;
  primaryTeamId?: string;
  today: string;
}): Promise<Result<Member>> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const phone = input.phone?.trim();

  if (!fullName) return fail("Enter their name.");
  // Same rule as lib/env.ts and the CHECK constraint in 0001. Stated three
  // times on purpose — this IS the access model.
  if (!email.endsWith("@stanford.edu")) {
    return fail("Must be a stanford.edu address.");
  }

  const { members } = readStore();
  if (members.some((m) => m.email.toLowerCase() === email)) {
    return fail("Someone with that address is already on the roster.");
  }

  const member: Member = {
    id: newId("member"),
    fullName,
    email,
    phone: phone || undefined,
    globalRole: input.globalRole,
    // Active immediately. The alternative — invited-but-inactive — means a new
    // member signs in and is told they can't come in yet, which is the opposite
    // of the welcome this app exists to provide.
    status: "active",
    // Still on the row because `profiles.lead_id` still exists; nothing reads
    // it and nothing sets it since the reporting chain went on 2026-08-24.
    leadId: null,
    primaryTeamId: input.primaryTeamId || undefined,
    joinedAt: input.today,
    skills: [],
  };

  return guarded((store) => {
    store.members.push(member);
    return ok(member);
  });
}

/**
 * Fields a member may change about themselves.
 *
 * Deliberately a narrow, explicit list rather than `Partial<Member>`. Role,
 * status, leadId and email are all absent, and that's the point — this is a
 * self-service endpoint, so anything reachable through it is something a member
 * can grant themselves. Adding a field later is one line here plus one input;
 * accidentally exposing `globalRole` would be a privilege-escalation bug.
 */
export interface ProfileEdits {
  preferredName?: string;
  phone?: string;
  discordUserId?: string;
  major?: string;
  classYear?: number;
  photoUrl?: string;
  skills?: string[];
  /**
   * A few lines in their own words. Blank clears it, like every other field here.
   *
   * Matters most for an advisor, whose profile has no deliverables to read
   * instead — see `Member.bio`.
   */
  bio?: string;
}

/**
 * Update your own profile.
 *
 * Every field is optional and blank clears it, so the same operation covers
 * "fill this in when you join" and "fix it later" without a second code path.
 */
export async function updateProfile(input: {
  memberId: string;
  edits: ProfileEdits;
}): Promise<Result<Member>> {
  const { edits } = input;

  if (edits.classYear !== undefined) {
    const year = edits.classYear;
    // A typo'd year quietly sorts someone to the top of every roster and makes
    // "graduating soon" wrong. Cheap to catch here.
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return fail("That doesn't look like a class year.");
    }
  }

  if (edits.photoUrl && !/^https?:\/\//i.test(edits.photoUrl)) {
    return fail("A photo link needs to start with http:// or https://");
  }

  /*
    A Discord id is 17-20 digits and nothing else.

    Checked here as well as by the column constraint, because the two things
    people actually paste — a username like `anish#0001`, or a whole
    `<@1234567890>` mention — both look plausible and would silently never
    receive anything. A constraint violation would say
    `violates check constraint "profiles_discord_user_id_check"`, which tells
    a member nothing.
  */
  if (edits.discordUserId) {
    const id = edits.discordUserId.trim();
    if (!/^[0-9]{17,20}$/.test(id)) {
      return fail(
        "A Discord ID is a long string of digits — not your username. Turn on Developer Mode in Discord, right-click your name, and Copy User ID."
      );
    }
  }

  return guarded((store) => {
    const member = store.members.find((m) => m.id === input.memberId);
    if (!member) return fail<Member>("That member no longer exists.");

    // Empty string means "clear it"; undefined means "don't touch it". The
    // distinction matters — a form always posts every field, so without it
    // nobody could ever remove something they'd typed.
    const text = (v: string | undefined) =>
      v === undefined ? undefined : v.trim() || null;

    const apply = <K extends keyof ProfileEdits>(
      key: K,
      value: string | null | undefined
    ) => {
      if (value === undefined) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (member as any)[key] = value ?? undefined;
    };

    apply("preferredName", text(edits.preferredName));
    apply("phone", text(edits.phone));
    /*
      `apply` and not a bespoke branch: blank clears it, like every other text
      field here. Without this line the field is accepted by the type, written
      nowhere, and the advisor's bio silently never saves.
    */
    apply("bio", text(edits.bio));

    /*
      A changed ID is an unproven ID.

      Without this, somebody could verify one id, paste a different one, and
      keep the green tick — which is precisely the false confidence the
      verification exists to remove.
    */
    if (edits.discordUserId !== undefined) {
      const next = edits.discordUserId.trim() || undefined;
      if (next !== member.discordUserId) {
        member.discordVerifiedAt = undefined;
      }
      member.discordUserId = next;
    }
    apply("major", text(edits.major));
    apply("photoUrl", text(edits.photoUrl));

    if (edits.classYear !== undefined) {
      member.classYear = edits.classYear || undefined;
    }
    if (edits.skills !== undefined) {
      // Skills drive the matching on /find-work, so trim and drop blanks —
      // a stray "" would match nothing and render as an empty chip.
      member.skills = edits.skills.map((s) => s.trim()).filter(Boolean);
    }

    return ok(member);
  });
}

/**
 * Promote or demote — member ↔ lead ↔ co_lead.
 *
 * Refuses to remove the last Co-Lead. That leaves a club where nobody can
 * appoint anyone, fixable only by hand-editing the database, and it's the sort
 * of thing that happens at 1am during a leadership handover.
 */
/**
 * Trainings this person is still the named verifier for, as a sentence.
 *
 * The lock-out safeguard the club asked for: you cannot take somebody out of a
 * leadership position while a training is assigned to them, and the refusal has
 * to NAME what is blocking it. "Tyler verifies the mill and the laser cutter;
 * reassign those first" is actionable; "not allowed" on an org-chart edit is the
 * kind of message people work around by deleting something else, and what they
 * would delete here is a safety record.
 *
 * Synchronous and store-only, deliberately. It runs inside `guarded`, which
 * holds the write, and an async read in there would be a query inside a
 * transaction. In LIVE mode `catalogue_verifiers` is not in the snapshot -- see
 * `lib/trainings/verifiers.ts` on why it cannot be -- so this returns null and
 * the guard does not fire. That is the honest trade for shipping before the
 * migration: the guard is real in demo mode and today, and becomes real in live
 * mode when 0046 lands and the collection can join the snapshot.
 *
 * Returns null when there is nothing blocking, so the caller reads as a guard
 * rather than as a length check on a list that is usually empty.
 */
function verifierLockOut(store: StoreShape, memberId: string): string | null {
  const held = (store.catalogueVerifiers ?? []).filter(
    (v) => v.verifierId === memberId
  );
  if (held.length === 0) return null;

  const names = held.map(
    (v) =>
      store.catalogueItems.find((i) => i.id === v.itemId)?.name ??
      "a retired training"
  );
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  return `They verify ${list}. Assign ${
    names.length === 1 ? "it" : "those"
  } to somebody else first, or mark ${
    names.length === 1 ? "it" : "them"
  } self-verify -- otherwise nobody can clear anyone for the shop.`;
}

export async function setGlobalRole(input: {
  memberId: string;
  role: GlobalRole;
}): Promise<Result<Member>> {
  return guarded((store) => {
    const member = store.members.find((m) => m.id === input.memberId);
    if (!member) return fail<Member>("That member no longer exists.");
    if (member.globalRole === input.role) return ok(member);

    if (member.globalRole === "co_lead" && input.role !== "co_lead") {
      const others = store.members.filter(
        (m) =>
          m.globalRole === "co_lead" &&
          m.id !== member.id &&
          m.status === "active"
      );
      if (others.length === 0) {
        return fail<Member>(
          "This is the only Co-Lead. Promote someone else first, or the club is left with nobody who can appoint anyone."
        );
      }
    }

    /*
      Anybody losing authority leaves their reports pointing at somebody who no
      longer has any — reviews and escalations would still route to them, and
      nothing would ever be read. Re-point those reports upward.

      Both halves went with the reporting chain on 2026-08-24. There is nothing
      to re-point: losing a title costs somebody no authority over people,
      because nobody held any. What a demotion still costs is the PL side, and
      that lives on `project_res` and `teams.lead_id` -- neither of which this
      function touches, deliberately. Demoting a Division Lead does NOT silently
      hand their division to nobody; `setTeamLead` is a separate, deliberate act.
    */

    /*
      The lock-out safeguard. Refused rather than cascaded, same family as the
      "last Co-Lead" guard above and as a parent project that cannot complete
      while a child is open: the app should not quietly decide who inherits a
      safety sign-off.

      Only on the way DOWN. Promoting a verifier to Co-Lead takes nothing away —
      they can still verify, and a Co-Lead can verify anything.
    */
    if (input.role === "member" || input.role === "advisor") {
      const blocking = verifierLockOut(store, member.id);
      if (blocking) return fail<Member>(blocking);
    }

    member.globalRole = input.role;

    return ok(member);
  });
}

// ---------------------------------------------------------------------------
// Asking a Lead for something
// ---------------------------------------------------------------------------

export async function createMemberRequest(input: {
  memberId: string;
  leadId: string;
  body: string;
  now: string;
}): Promise<Result<MemberRequest>> {
  const body = input.body.trim();
  if (!body) {
    return fail<MemberRequest>("Say what you need — one line is plenty.");
  }
  if (body.length > 1000) {
    return fail<MemberRequest>(
      "That's very long for a request. If it needs a paragraph, it probably needs a conversation — send a short version and say you'd like to talk."
    );
  }

  return guarded((store) => {
    const lead = store.members.find((m) => m.id === input.leadId);
    if (!lead) return fail<MemberRequest>("That person no longer exists.");
    if (lead.status !== "active") {
      return fail<MemberRequest>(
        `${lead.fullName}'s account isn't active, so they'd never see this. Ask somebody else.`
      );
    }

    /*
      One open request per person per recipient.

      Not a technical limit — a guard against the thing that actually happens,
      which is somebody pressing the button again a day later because nothing
      visibly changed. Three copies of the same ask makes the queue look busier
      than it is and makes the Lead answer the same question twice.
    */
    const open = store.memberRequests.find(
      (r) =>
        r.memberId === input.memberId &&
        r.leadId === input.leadId &&
        r.status === "pending"
    );
    if (open) {
      return fail<MemberRequest>(
        `You already have a request open with ${lead.fullName}. Withdraw it first if you want to change what you asked for.`
      );
    }

    const request: MemberRequest = {
      id: newId("request"),
      memberId: input.memberId,
      leadId: input.leadId,
      body,
      status: "pending",
      createdAt: input.now,
    };
    store.memberRequests.push(request);
    return ok(request);
  });
}

/**
 * Grant or decline. A decline REQUIRES a reason.
 *
 * Same rule as rejecting a deliverable or a training: "no" with nothing after
 * it is what stops somebody asking again, and the whole point of routing these
 * through the app rather than a DM is that the answer is recorded somewhere the
 * member can re-read it.
 *
 * Granting doesn't require one, because the grant IS the answer.
 */
export async function answerMemberRequest(input: {
  requestId: string;
  status: "granted" | "declined";
  response: string;
  responderId: string;
  now: string;
}): Promise<Result<MemberRequest>> {
  const response = input.response.trim();
  if (input.status === "declined" && !response) {
    return fail<MemberRequest>(
      "Say why, even briefly. A bare no is the thing that stops people asking next time — and if it's a 'not yet', that's worth them knowing."
    );
  }

  return guarded((store) => {
    const request = store.memberRequests.find((r) => r.id === input.requestId);
    if (!request) return fail<MemberRequest>("That request no longer exists.");
    if (request.status !== "pending") {
      return fail<MemberRequest>("That one has already been answered.");
    }

    request.status = input.status;
    request.response = response || undefined;
    request.respondedBy = input.responderId;
    request.respondedAt = input.now;
    return ok(request);
  });
}

/**
 * The asker changes their mind.
 *
 * Deleted rather than marked withdrawn. Nothing hangs off it — no record, no
 * count, no history worth keeping — and leaving a tombstone in the Lead's queue
 * would mean withdrawing didn't actually clear anything.
 */
export async function withdrawMemberRequest(input: {
  requestId: string;
  memberId: string;
}): Promise<Result<{ id: string }>> {
  return guarded((store) => {
    const request = store.memberRequests.find((r) => r.id === input.requestId);
    if (!request) return fail<{ id: string }>("That request no longer exists.");
    /*
      Ownership, checked HERE because this is the layer holding the row — the
      same exception the header of this file names for `deleteWorkLog` and
      friends. `lib/permissions.ts` never sees a request id.
    */
    if (request.memberId !== input.memberId) {
      return fail<{ id: string }>("That isn't your request.");
    }
    if (request.status !== "pending") {
      return fail<{ id: string }>(
        "That one has already been answered, so there's nothing to withdraw."
      );
    }

    store.memberRequests = store.memberRequests.filter(
      (r) => r.id !== input.requestId
    );
    return ok({ id: input.requestId });
  });
}

// ---------------------------------------------------------------------------
// Advisors named on a project
// ---------------------------------------------------------------------------

/**
 * Name an advisor on a project.
 *
 * The role check is HERE rather than in RLS. Migration 0032 deliberately
 * doesn't verify that the named person is an advisor, because an RLS refusal
 * reaches the user as "the database refused it" — true, useless, and it tells
 * a PL nothing about what to do instead. A `fail()` here reaches them as a
 * sentence.
 */
export async function addProjectAdvisor(input: {
  projectId: string;
  memberId: string;
  actorId: string;
  now: string;
}): Promise<Result<ProjectAdvisor>> {
  return guarded((store) => {
    const project = store.projects.find((p) => p.id === input.projectId);
    if (!project) return fail<ProjectAdvisor>("That project no longer exists.");

    const person = store.members.find((m) => m.id === input.memberId);
    if (!person) return fail<ProjectAdvisor>("That member no longer exists.");

    if (person.globalRole !== "advisor") {
      return fail<ProjectAdvisor>(
        `${person.fullName} isn't an advisor. This slot is for a faculty or project advisor — to put somebody on the project as an engineer, add them as a member instead. A Co-Lead can change somebody's role on the roster.`
      );
    }
    if (person.status !== "active") {
      return fail<ProjectAdvisor>(
        `${person.fullName}'s account isn't active, so naming them here would point people at somebody who can't open the project.`
      );
    }

    const already = store.projectAdvisors.some(
      (a) => a.projectId === input.projectId && a.memberId === input.memberId
    );
    if (already) {
      return fail<ProjectAdvisor>(
        `${person.fullName} is already an advisor on this project.`
      );
    }

    const row: ProjectAdvisor = {
      projectId: input.projectId,
      memberId: input.memberId,
      addedBy: input.actorId,
      addedAt: input.now,
    };
    store.projectAdvisors.push(row);
    return ok(row);
  });
}

/**
 * Take an advisor off a project.
 *
 * No guard beyond existing, unlike removing a member. Nothing hangs off this
 * row — no deliverables, no hours, no history — so removing it takes nothing
 * away from anybody's record. It only changes who the project says to ask.
 */
export async function removeProjectAdvisor(input: {
  projectId: string;
  memberId: string;
}): Promise<Result<{ projectId: string; memberId: string }>> {
  return guarded((store) => {
    const before = store.projectAdvisors.length;
    store.projectAdvisors = store.projectAdvisors.filter(
      (a) => !(a.projectId === input.projectId && a.memberId === input.memberId)
    );
    if (store.projectAdvisors.length === before) {
      return fail<{ projectId: string; memberId: string }>(
        "They aren't listed as an advisor on this project."
      );
    }
    return ok({ projectId: input.projectId, memberId: input.memberId });
  });
}

/** Deactivate or reactivate. Never deletes — history must survive. */
export async function setMemberStatus(input: {
  memberId: string;
  status: MemberStatus;
}): Promise<Result<Member>> {
  return guarded((store) => {
    const member = store.members.find((m) => m.id === input.memberId);
    if (!member) return fail<Member>("That member no longer exists.");

    if (member.globalRole === "co_lead" && input.status !== "active") {
      const others = store.members.filter(
        (m) =>
          m.globalRole === "co_lead" &&
          m.id !== member.id &&
          m.status === "active"
      );
      if (others.length === 0) {
        return fail<Member>("This is the only active Co-Lead.");
      }
    }

    /*
      The same lock-out safeguard as `setGlobalRole`, and it matters more here.

      Deactivating somebody is what actually happens when a verifier graduates,
      and it is the case where "the app quietly decides who inherits a safety
      sign-off" would do real damage: the mill would still list a verifier, that
      verifier would be inactive, and nobody would find out until a member's
      request sat unanswered for a fortnight.

      Reactivating is never blocked -- it only ever gives authority back.
    */
    if (input.status !== "active") {
      const blocking = verifierLockOut(store, member.id);
      if (blocking) return fail<Member>(blocking);
    }

    member.status = input.status;

    if (input.status !== "active") {
      /*
        Two cleanups used to live here and both went with the reporting chain on
        2026-08-24: re-pointing their reports upward, and dropping their open
        check-in obligations so they did not accrue as missed. Nobody has reports
        and nobody owes a check-in.

        What replaces the second one is nothing, deliberately. An inactive
        member's open DELIVERABLES stay open and stay theirs, because a
        deliverable is somebody's accountable work rather than a recurring
        obligation -- silently unassigning it would remove it from the PL's queue,
        which is the one person who needs to know it now has no owner. It shows
        up on the project as work with an inactive owner, which is the truth.
      */
    }

    return ok(member);
  });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * When a new project starts. Today, unless that would be after it's due.
 *
 * A target in the past is legitimate — somebody entering work the club has been
 * doing for a month, or a deadline already missed. But `0001_core_schema.sql`
 * carries
 *
 *     check (target_date is null or start_date is null or target_date >= start_date)
 *
 * so defaulting to today there would produce a row that is fine in demo mode
 * and fails on INSERT against Postgres — a bug that only appears in live mode,
 * which is the worst place to find one.
 */
function startDateFor(input: {
  startDate?: string;
  targetDate?: string;
  today: string;
}): string {
  const start = input.startDate || input.today;
  if (input.targetDate && input.targetDate < start) return input.targetDate;
  return start;
}

export async function createProject(input: {
  name: string;
  description?: string;
  parentId: string | null;
  teamId?: string;
  primaryReId: string;
  /** Defaults to `today`. Nothing in the UI asks for it yet. */
  startDate?: string;
  targetDate?: string;
  createdBy: string;
  today: string;
}): Promise<Result<Project>> {
  const name = input.name.trim();
  if (!name) return fail("Give the project a name.");
  if (!input.primaryReId) {
    // A project with no accountable person is how work goes quiet. The PL is
    // the whole point of the model.
    return fail("Every project needs a Project Lead.");
  }

  const store = readStore();
  const { projects } = store;

  /*
    ---------------------------------------------------------------------------
    The runaway guard. This exists because of a real incident.
    ---------------------------------------------------------------------------

    A member connected an assistant to the MCP server and it created ~4,000
    empty projects called "Project ABCX", "Project ABDG" and so on. Nothing was
    bypassed: he was entitled to create projects in his own division, and every
    individual call was legitimate. The failure was that there was no ceiling,
    and an agent in a loop reaches a scale no human hand ever would.

    Why it's HERE and not in the MCP layer: `operations.ts` is the only write
    choke point, so this covers the website, the MCP server and anything added
    later. A limit that lives in one caller is a limit the next caller doesn't
    have.

    Why "empty projects created today" rather than a request rate limit:

      - A rate limit needs shared state across serverless invocations, which
        means a table and a migration. This needs neither, and reads data the
        store has already loaded.
      - It targets the thing that is actually wrong. A lead legitimately filing
        eight projects in a planning session is fine; twenty-five UNTOUCHED ones
        in a day is not a person working, and a real one clears the way by
        putting a deliverable on them or deleting them.
      - It degrades honestly: the ceiling is per-creator per-day, so one runaway
        assistant cannot deny the feature to anybody else.

    A project stops counting the moment it has a deliverable, so the limit never
    blocks somebody doing real work — only somebody accumulating shells.
  */
  const createdTodayEmpty = store.projectMemberships.filter(
    (m) =>
      m.addedBy === input.createdBy &&
      m.joinedAt === input.today &&
      m.role === "re" &&
      !store.deliverables.some((d) => d.projectId === m.projectId)
  ).length;

  if (createdTodayEmpty >= MAX_EMPTY_PROJECTS_PER_DAY) {
    return fail<Project>(
      `You've created ${createdTodayEmpty} projects today that still have no deliverables on them. ` +
        `That's the daily ceiling, and it exists because an assistant in a loop once made four thousand of them. ` +
        `Add a deliverable to the ones you meant, or delete the rest, and this clears immediately.`
    );
  }

  // Same nesting rule as `updateProject`. Enforced on the way in as well, or
  // the constraint is one edit away from being bypassed: create the child with
  // a late date and it simply sits there, since the update path only checks
  // when a date MOVES.
  if (input.parentId && input.targetDate) {
    const parent = projects.find((p) => p.id === input.parentId);
    if (parent?.targetDate && input.targetDate > parent.targetDate) {
      return fail<Project>(
        `${parent.name} is due ${parent.targetDate}, so work inside it can't be due ${input.targetDate}.`
      );
    }
  }

  let slug = slugify(name);
  if (
    projects.some((p) => p.slug === slug) ||
    RESERVED_PROJECT_SLUGS.has(slug)
  ) {
    // Slugs are the URL, so a collision would make one project unreachable —
    // whether it collides with another project or with a real page.
    slug = `${slug}-${projects.length + 1}`;
  }

  const project: Project = {
    id: newId("project"),
    name,
    slug,
    description: input.description?.trim() || undefined,
    parentId: input.parentId,
    // A sub-project inherits its parent's team unless told otherwise, so it
    // can't fall outside every division and vanish from /projects.
    teamId:
      input.teamId ||
      (input.parentId
        ? projects.find((p) => p.id === input.parentId)?.teamId
        : undefined),
    primaryReId: input.primaryReId,
    reIds: [input.primaryReId],
    phase: "concept",
    health: "on_track",
    /*
      Today, unless told otherwise.

      This was simply never set, so every project created through the app had
      no start date at all — only the seed had them. Nothing surfaced it yet,
      because nothing draws a span: a bar needs a left edge, and there wasn't
      one. Backfilling later would be guesswork, so it starts being recorded
      now even though the thing that reads it isn't built.

      Today is the honest answer. A project exists from the moment somebody
      created it; the alternative is asking for a date at creation, and
      creating projects is meant to feel effortless for leadership.
    */
    startDate: startDateFor(input),
    targetDate: input.targetDate || undefined,
    /*
      True only when somebody actually named an end date.

      `datesOverridden = false` means "roll this project's dates up from its
      children" — a parent with no date of its own spans whatever its
      sub-projects span. Hard-coding false meant a target the creator typed by
      hand would have been treated as derived and overwritten by a roll-up.
    */
    datesOverridden: Boolean(input.targetDate),
    isOpenToJoin: true,
    /*
      Recorded from now on. The column was always there; nothing wrote it.

      `input.createdBy` was already being passed in by every caller and used only
      for the membership's `addedBy`, so this is the same value finally landing
      where somebody looking for "who made this" would go first.
    */
    createdBy: input.createdBy,
  };

  return guarded((store) => {
    store.projects.push(project);
    store.projectMemberships.push({
      projectId: project.id,
      memberId: input.primaryReId,
      role: "re",
      joinedAt: input.today,
      commitment: "committed",
      addedBy: input.createdBy,
    });
    return ok(project);
  });
}

/** Add someone to a project, as a contributor or a PL. */
export async function addProjectMember(input: {
  projectId: string;
  memberId: string;
  asRE: boolean;
  responsibility?: string;
  addedBy: string;
  today: string;
}): Promise<Result<null>> {
  return guarded((store) => {
    const project = store.projects.find((p) => p.id === input.projectId);
    if (!project) return fail<null>("That project no longer exists.");
    if (!store.members.some((m) => m.id === input.memberId)) {
      return fail<null>("That member no longer exists.");
    }

    const existing = store.projectMemberships.find(
      (m) => m.projectId === input.projectId && m.memberId === input.memberId
    );

    if (existing) {
      existing.commitment = "committed";
      existing.role = input.asRE ? "re" : existing.role;
      if (input.responsibility)
        existing.responsibility = input.responsibility.trim();
    } else {
      store.projectMemberships.push({
        projectId: input.projectId,
        memberId: input.memberId,
        role: input.asRE ? "re" : "contributor",
        responsibility: input.responsibility?.trim() || undefined,
        joinedAt: input.today,
        commitment: "committed",
        addedBy: input.addedBy,
      });
    }

    // `reIds` mirrors the memberships and is what permission checks read, so
    // the two must never disagree.
    if (input.asRE && !project.reIds.includes(input.memberId)) {
      project.reIds.push(input.memberId);
    }

    return ok(null);
  });
}

/** Add or remove PL status on a project. */
/**
 * Would this leave a project that has sub-projects with a single PL?
 *
 * PL authority inherits DOWNWARD, so the PLs of a parent are the escalation
 * route for everything beneath it. Strip it to one person and every
 * sub-project's unblock path runs through somebody who might graduate, go on
 * exchange, or simply stop answering — and nobody else has the authority to
 * act.
 *
 * This replaced a standing "No deputy PL" warning that fired on every parent
 * project with one PL. That was permanent, unactionable (there often isn't a
 * second person to name), and taught people to ignore the flags around it. A
 * guard at the moment of removal is the same protection at the one moment
 * somebody can do something about it — and it doesn't nag anyone who has
 * simply never had a deputy.
 *
 * Returns the message, so `setProjectRE` and `removeProjectMember` can't drift.
 */
function wouldStrandSubProjects(
  store: StoreShape,
  projectId: string,
  losingReId: string
): string | null {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return null;
  if (!project.reIds.includes(losingReId)) return null;

  const hasChildren = store.projects.some((p) => p.parentId === projectId);
  if (!hasChildren) return null;

  const remaining = project.reIds.filter((id) => id !== losingReId);
  if (remaining.length > 0) return null;

  const childCount = store.projects.filter(
    (p) => p.parentId === projectId
  ).length;
  return (
    `That would leave ${project.name} with no PL, and ${childCount} sub-project` +
    `${childCount === 1 ? "" : "s"} escalate through it. Name another PL first — ` +
    `otherwise nobody can unblock the work underneath.`
  );
}

export async function setProjectRE(input: {
  projectId: string;
  memberId: string;
  isRE: boolean;
}): Promise<Result<null>> {
  return guarded((store) => {
    const project = store.projects.find((p) => p.id === input.projectId);
    if (!project) return fail<null>("That project no longer exists.");

    if (input.isRE) {
      if (!project.reIds.includes(input.memberId)) {
        project.reIds.push(input.memberId);
      }
      const m = store.projectMemberships.find(
        (x) => x.projectId === input.projectId && x.memberId === input.memberId
      );
      if (m) {
        m.role = "re";
        m.commitment = "committed";
      }
      return ok(null);
    }

    if (project.primaryReId === input.memberId) {
      // Removing the primary would leave the project with no go-to person and
      // `primaryReId` pointing at someone with no authority over it.
      return fail<null>(
        "They're the primary PL. Make someone else primary first."
      );
    }

    const stranded = wouldStrandSubProjects(
      store,
      input.projectId,
      input.memberId
    );
    if (stranded) return fail<null>(stranded);

    project.reIds = project.reIds.filter((id) => id !== input.memberId);
    const m = store.projectMemberships.find(
      (x) => x.projectId === input.projectId && x.memberId === input.memberId
    );
    if (m) m.role = "contributor";
    return ok(null);
  });
}

/** Hand the go-to role to a different PL. */
export async function setPrimaryRE(input: {
  projectId: string;
  memberId: string;
}): Promise<Result<null>> {
  return guarded((store) => {
    const project = store.projects.find((p) => p.id === input.projectId);
    if (!project) return fail<null>("That project no longer exists.");

    if (!project.reIds.includes(input.memberId)) {
      project.reIds.push(input.memberId);
    }
    project.primaryReId = input.memberId;
    return ok(null);
  });
}

/**
 * Why `newTarget` can't be this project's date, or null if it can.
 *
 * Extracted from `updateProject` so `changeProjectDeadline` enforces the SAME
 * rule rather than a second copy of it. Two copies of a date constraint is how
 * one path ends up permitting a schedule the other refuses, and the symptom is a
 * project whose dates are illegal but which saves fine through one form.
 *
 * Checked in BOTH directions, because the same mistake arrives two ways —
 * moving a child later, or pulling a parent in over children already dated.
 * Refused rather than cascaded, for the same reason completion is: quietly
 * rewriting dates on projects other PLs own is how a schedule stops being
 * believed.
 *
 * Callers must only invoke this when the date actually moves. See the note in
 * `updateProject`: validating unconditionally lets one pre-existing violation
 * freeze every other edit on the project.
 */
function targetDateClash(
  store: StoreShape,
  project: Project,
  newTarget: string
): string | null {
  if (project.parentId) {
    const parent = store.projects.find((p) => p.id === project.parentId);
    if (parent?.targetDate && newTarget > parent.targetDate) {
      return `${parent.name} is due ${parent.targetDate}, so this can't be due ${newTarget}. Move the parent's date first, or bring this one in.`;
    }
  }

  /*
    …and against this project's own deliverables.

    The descendant loop below catches nested PROJECTS. Without this, pulling a
    target in would leave the project's own deliverables dated past it — the
    exact state `createDeliverable` refuses, arriving from the other direction.
  */
  const lateWork = store.deliverables.filter(
    (d) =>
      d.projectId === project.id &&
      d.status !== "done" &&
      d.dueDate &&
      d.dueDate > newTarget
  );
  if (lateWork.length > 0) {
    const names = lateWork
      .slice(0, 3)
      .map((d) => `${d.title} (${d.dueDate})`)
      .join(", ");
    const rest = lateWork.length > 3 ? ` and ${lateWork.length - 3} more` : "";
    return `${lateWork.length} deliverable${lateWork.length === 1 ? " is" : "s are"} due after ${newTarget}: ${names}${rest}. Bring ${lateWork.length === 1 ? "it" : "them"} in first.`;
  }

  const late = descendantProjects(store, project.id).filter(
    (p) => p.targetDate && p.targetDate > newTarget
  );
  if (late.length > 0) {
    const names = late
      .slice(0, 3)
      .map((p) => `${p.name} (${p.targetDate})`)
      .join(", ");
    const rest = late.length > 3 ? ` and ${late.length - 3} more` : "";
    return `${late.length} sub-project${late.length === 1 ? " is" : "s are"} due after ${newTarget}: ${names}${rest}. Bring ${late.length === 1 ? "it" : "them"} in first — work inside this can't land after it does.`;
  }

  return null;
}

/** Ceiling on a slip reason. Matches the CHECK in migration 0040. */
const MAX_DEADLINE_REASON_CHARS = 400;

/**
 * Move a project's target date, keeping the old one.
 *
 * The dedicated path for a slip, as opposed to `updateProject`, which changes
 * everything about a project at once. Three things make it worth its own
 * operation rather than a flag on that one:
 *
 *   1. **The reason is required.** Same asymmetry as declining a member request
 *      or rejecting a signed-off deliverable — the action that makes the record
 *      worse has to be explained. A date that moved for no recorded reason is
 *      the thing `project_deadline_changes` exists to prevent.
 *   2. **It needs no other field.** Reusing `updateProject` would mean the
 *      caller resending name, phase, health and open roles to move one date,
 *      and every one of those is a chance to overwrite something with a stale
 *      value from a form somebody opened ten minutes ago.
 *   3. **It announces itself.** A slipped deadline changes what everybody else
 *      can plan against, so it goes up the project tree like a completion does.
 *
 * Deliberately allows moving the date EARLIER as well as later. The UI control
 * is "push", and its date picker starts the day after the current target — but
 * pulling a date in is also a change worth recording, and refusing it here
 * would push somebody back to the editor, which is the path with no reason
 * attached.
 */
export async function changeProjectDeadline(input: {
  projectId: string;
  /** The new target. `YYYY-MM-DD`. */
  targetDate: string;
  reason: string;
  actorId: string;
  /** Today, passed in so this stays testable and render-stable. */
  today: string;
}): Promise<Result<Project>> {
  const newTarget = input.targetDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newTarget)) {
    return fail<Project>("Pick a date for the new target.");
  }

  const reason = input.reason.trim();
  if (!reason) {
    return fail<Project>(
      "Say why the date is moving — everyone planning around this project will read it."
    );
  }
  if (reason.length > MAX_DEADLINE_REASON_CHARS) {
    return fail<Project>(
      `That's ${reason.length} characters. Keep it under ${MAX_DEADLINE_REASON_CHARS} — it goes into the project's history and up the chain.`
    );
  }

  return guarded((store) => {
    const project = store.projects.find((p) => p.id === input.projectId);
    if (!project) return fail<Project>("That project no longer exists.");

    /*
      No existing target means this isn't a slip, it's the first schedule.

      Setting a first date belongs in the project editor: there is no old date to
      keep, nothing has moved, and recording it as a change would put a project
      into the "has slipped" list on the day somebody first dated it.
    */
    if (!project.targetDate) {
      return fail<Project>(
        `${project.name} has no target date yet, so there's nothing to move. Set one in Edit project.`
      );
    }

    if (project.targetDate === newTarget) {
      return fail<Project>(`${project.name} is already due ${newTarget}.`);
    }

    /*
      A finished project's schedule is history, not a plan.

      Completing freezes the record (see `attachArtifact`), and moving the target
      of something already delivered would rewrite what it looks like it
      achieved. Reopen it first if the work genuinely restarted.
    */
    if (project.phase === "complete") {
      return fail<Project>(
        `${project.name} is complete, so its dates are part of the record. Reopen it first if the work has actually restarted.`
      );
    }

    const clash = targetDateClash(store, project, newTarget);
    if (clash) return fail<Project>(clash);

    const fromDate = project.targetDate;
    project.targetDate = newTarget;

    store.projectDeadlineChanges.push({
      id: newId("pdc"),
      projectId: project.id,
      fromDate,
      toDate: newTarget,
      reason,
      changedById: input.actorId,
      changedAt: new Date().toISOString(),
    });

    /*
      Announced up the project tree, the same audience a completion reaches.

      Only when the date moves LATER. Pulling a deadline in is good news and
      needs no announcement — and notifying on it would train people to ignore
      the notice, which is the one thing that must not happen to the one that
      says a project is late.
    */
    if (newTarget > fromDate) {
      const actor = store.members.find((m) => m.id === input.actorId);
      const who = actor?.preferredName || actor?.fullName || "Someone";
      const days = daysBetween(fromDate, newTarget);
      const audience = completionAudience(store, project, input.actorId);

      store.projectNotices.push({
        id: newId("pn"),
        projectId: project.id,
        kind: "deadline_pushed",
        body: `${who} moved ${project.name}'s target from ${fromDate} to ${newTarget} — ${days} day${days === 1 ? "" : "s"} later. Reason: ${reason}`,
        createdById: input.actorId,
        createdAt: `${input.today}T12:00:00.000Z`,
        notifiedMemberIds: audience,
      });
    }

    return ok(project);
  });
}

/**
 * Push back a deliverable's due date, keeping the old one.
 *
 * The deliverable-level twin of `changeProjectDeadline`, and deliberately the same
 * shape: a required reason, an append-only history row, and the constraint checked
 * rather than cascaded.
 *
 * Two differences from the project version, both following from what a deliverable
 * is:
 *
 *   - **It is bounded by the project, and by nothing below it.** A deliverable has
 *     no children — that is the whole task model — so the only constraint is
 *     `dueAfterProject`, the same helper `createDeliverable` and `updateDeliverable`
 *     already use. Work inside a project cannot land after the project does, and
 *     the error names the project and its date.
 *   - **No notice is sent.** A project slipping changes what a division plans
 *     against; one deliverable moving inside its project does not, and notifying
 *     up the chain for each would train people to ignore the notice that matters.
 *     It is still recorded, and it still shows in the project's history.
 *
 * `updateDeliverable` remains the way to change a title or an owner, and it can
 * still move a date without a reason. Same asymmetry as the project editor: this
 * is the path that produces good history, and the other one is labelled in the UI
 * as having none.
 */
export async function changeDeliverableDeadline(input: {
  deliverableId: string;
  dueDate: string;
  reason: string;
  actorId: string;
  today: string;
}): Promise<Result<Deliverable>> {
  const newDue = input.dueDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDue)) {
    return fail<Deliverable>("Pick a date for the new deadline.");
  }

  const reason = input.reason.trim();
  if (!reason) {
    return fail<Deliverable>(
      "Say why it's moving — whoever is waiting on this will read it."
    );
  }
  if (reason.length > MAX_DEADLINE_REASON_CHARS) {
    return fail<Deliverable>(
      `That's ${reason.length} characters. Keep it under ${MAX_DEADLINE_REASON_CHARS} — it goes into the project's history.`
    );
  }

  return guarded((store) => {
    const deliverable = store.deliverables.find(
      (d) => d.id === input.deliverableId
    );
    if (!deliverable) {
      return fail<Deliverable>("That deliverable no longer exists.");
    }

    /*
      Nothing to push back if it never had a date.

      Same reasoning as the project version: setting a FIRST deadline is not a
      slip, and recording it as one would put the deliverable into the "has
      slipped" history on the day somebody first dated it. Edit sets a first date.
    */
    if (!deliverable.dueDate) {
      return fail<Deliverable>(
        "This has no deadline yet, so there's nothing to push back. Set one with Edit."
      );
    }

    if (deliverable.dueDate.slice(0, 10) === newDue) {
      return fail<Deliverable>(`It's already due ${newDue}.`);
    }

    /*
      Signed-off work keeps its dates.

      `done` means a PL confirmed it, and moving the deadline afterwards would
      rewrite whether it was delivered on time — which feeds the Delivered signal.
      Reopening is the honest route if the work genuinely restarted.
    */
    if (deliverable.status === "done") {
      return fail<Deliverable>(
        "This is signed off, so its dates are part of the record. Reopen it first if the work has actually restarted."
      );
    }

    // The one constraint: work inside a project can't land after the project.
    const clash = dueAfterProject(store, deliverable.projectId, newDue);
    if (clash) return fail<Deliverable>(clash);

    const fromDate = deliverable.dueDate.slice(0, 10);
    deliverable.dueDate = newDue;

    store.projectDeadlineChanges.push({
      id: newId("pdc"),
      projectId: deliverable.projectId,
      deliverableId: deliverable.id,
      fromDate,
      toDate: newDue,
      reason,
      changedById: input.actorId,
      changedAt: new Date().toISOString(),
    });

    /*
      It goes in the project's activity feed, with an EMPTY audience.

      This is the fix to a real complaint: the first version wrote no notice at
      all, on the grounds that one deliverable moving inside its project is not
      worth telling a Lead about. That reasoning was right about NOTIFYING and
      wrong about RECORDING — it meant the reason somebody typed appeared only in
      a sidebar panel, and Anish went looking for it in "Recent Updates On This
      Project", which is exactly where a change to the project's schedule belongs.

      `notifiedMemberIds: []` is what separates the two. The notice renders in the
      feed like every other one, and reaches nobody's dashboard — the dashboard
      blocks filter on `notifiedMemberIds.includes(actor.id)`, so an empty list is
      genuinely invisible there rather than merely quiet.

      The PROJECT-level version still notifies up the chain, because a project
      slipping does change what other people plan against.
    */
    const actor = store.members.find((m) => m.id === input.actorId);
    const who = actor?.preferredName || actor?.fullName || "Someone";
    const days = daysBetween(fromDate, newDue);
    const later = newDue > fromDate;

    store.projectNotices.push({
      id: newId("pn"),
      projectId: deliverable.projectId,
      kind: "deadline_pushed",
      body: `${who} moved "${deliverable.title}" from ${fromDate} to ${newDue} — ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${later ? "later" : "earlier"}. Reason: ${reason}`,
      createdById: input.actorId,
      createdAt: `${input.today}T12:00:00.000Z`,
      notifiedMemberIds: [],
    });

    return ok(deliverable);
  });
}

// ---------------------------------------------------------------------------
// Writing a check-in
// ---------------------------------------------------------------------------

export interface CheckInEntryInput {
  projectId: string;
  progress: string;
  blockers?: string;
  nextSteps?: string;
}

// ---------------------------------------------------------------------------
// Academic pause
// ---------------------------------------------------------------------------

/**
 * Pause or resume someone's check-in obligation.
 *
 * A pause generates no `missed` rows and no nudges — a lapse is a pause, never
 * a debt. Someone who drifts during midterms has to be able to come back
 * without facing a record of failure, which is the single most important
 * retention behaviour in the app.
 */
/**
 * Which weekdays a member submits their check-ins on.
 *
 * Members pick their own days — the obligation is the cadence, not a schedule
 * somebody imposed. Spacing is nudged in the UI rather than enforced here: two
 * on consecutive days is a worse check-in, not an invalid one.
 */
/**
 * Remove a deliverable outright.
 *
 * A real delete, not a status. CLAUDE.md's "never hard-delete" rule is about
 * PEOPLE and PROJECTS, whose history has to survive graduations. A deliverable
 * typed by mistake has no history worth keeping, and leaving wrong rows around
 * to preserve a principle makes the progress bar lie.
 *
 * Anything already delivered is kept: it's counted in someone's record, and
 * removing it would silently reduce work they actually did.
 */
export async function deleteDeliverable(
  deliverableId: string
): Promise<Result<null>> {
  return guarded((store) => {
    const deliverable = store.deliverables.find((d) => d.id === deliverableId);
    if (!deliverable) return fail<null>("That deliverable no longer exists.");

    if (deliverable.status === "done") {
      return fail<null>(
        "That one is signed off and counts towards its owner's record. Reopen it first if it shouldn't."
      );
    }

    store.deliverables = store.deliverables.filter(
      (d) => d.id !== deliverableId
    );
    cascadeTodos(store);
    /*
      Its deadline history goes with it, matching the `on delete cascade` in
      migration 0042.

      The project's OWN history rows are untouched — they have a null
      `deliverableId` — so deleting one piece of work never erases the record of
      the project's target moving.
    */
    store.projectDeadlineChanges = store.projectDeadlineChanges.filter(
      (c) => c.deliverableId !== deliverableId
    );
    return ok(null);
  });
}

/**
 * Drop checklist items whose deliverable is gone.
 *
 * Postgres does this itself — `deliverable_id` is `on delete cascade` in
 * migration 0028 — so this exists to keep demo mode telling the same story.
 * Without it the store fills with todos no page can reach and no delete can
 * ever remove, and the two backends disagree about what's in it.
 *
 * A sweep rather than a targeted filter, because deliverables disappear from
 * three different places: deleting one, deleting its project, and hard-deleting
 * the member who owned it. A sweep is correct in all three and stays correct
 * when a fourth appears.
 */
function cascadeTodos(store: StoreShape): void {
  const alive = new Set(store.deliverables.map((d) => d.id));
  store.deliverableTodos = store.deliverableTodos.filter((t) =>
    alive.has(t.deliverableId)
  );
}

/**
 * Point a project at the team that owns it.
 *
 * Without this a project belongs to no division, and `/find-work` — the page
 * the whole app exists for — groups by division, so it silently doesn't appear.
 * That's the "1 project not linked to a division" warning, previously with no
 * way to act on it.
 */
/**
 * Edit a deliverable: its title and its due date.
 *
 * The PL's list, so the PL's edit. Retitling and re-dating is the ordinary
 * upkeep the whole model costs them — five minutes a week — and without it the
 * only correction available was delete-and-retype.
 */
export async function updateDeliverable(input: {
  deliverableId: string;
  title: string;
  ownerId?: string;
  dueDate?: string;
  today?: string;
}): Promise<Result<Deliverable>> {
  const title = input.title.trim();
  if (!title) return fail<Deliverable>("Give the deliverable a title.");

  return guarded((store) => {
    const deliverable = store.deliverables.find(
      (d) => d.id === input.deliverableId
    );
    if (!deliverable)
      return fail<Deliverable>("That deliverable no longer exists.");

    /*
      Checked only when the date MOVES, like the project rule it mirrors.

      Every save resends the existing date, so validating unconditionally would
      let one pre-existing violation freeze the row: renaming a deliverable
      would fail on a date the person never touched and can't see.
    */
    const newDue = input.dueDate || undefined;
    if (newDue !== deliverable.dueDate) {
      const tooLate = dueAfterProject(store, deliverable.projectId, newDue);
      if (tooLate) return fail<Deliverable>(tooLate);
    }

    deliverable.title = title;
    deliverable.dueDate = newDue;

    if (input.ownerId && input.ownerId !== deliverable.ownerId) {
      deliverable.ownerId = input.ownerId;

      // Reassigning is the fix for "owner left the project", so clear that
      // state rather than leaving a blocked item with a note that's no longer
      // true. Any other blocker is somebody's real note and stays put.
      if (
        deliverable.status === "blocked" &&
        deliverable.blockerNote === OWNER_LEFT_NOTE
      ) {
        deliverable.status = "open";
        deliverable.blockerNote = undefined;
      }

      // Put the new owner on the project if they aren't already — same rule as
      // creating a deliverable, and for the same reason: assigning work IS how
      // someone joins, and a roster that omits the person doing the work lies.
      const alreadyOn = store.projectMemberships.some(
        (m) =>
          m.projectId === deliverable.projectId && m.memberId === input.ownerId
      );
      if (!alreadyOn) {
        store.projectMemberships.push({
          projectId: deliverable.projectId,
          memberId: input.ownerId,
          role: "contributor",
          joinedAt: input.today ?? deliverable.dueDate ?? "",
          commitment: "committed",
        });
      }
    }

    return ok(deliverable);
  });
}

/**
 * Every project beneath this one, at any depth.
 *
 * Iterative rather than recursive, and cycle-guarded: `parentId` is a plain
 * column with nothing stopping a project being reparented under its own child,
 * and a naive walk would hang the request rather than fail it.
 */
function descendantProjects(store: StoreShape, projectId: string): Project[] {
  const found: Project[] = [];
  const seen = new Set<string>([projectId]);
  let frontier = [projectId];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const parentId of frontier) {
      for (const child of store.projects) {
        if (child.parentId !== parentId || seen.has(child.id)) continue;
        seen.add(child.id);
        found.push(child);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return found;
}

/** Every project above this one, nearest parent first. Cycle-guarded. */
function ancestorProjects(store: StoreShape, projectId: string): Project[] {
  const trail: Project[] = [];
  const seen = new Set<string>([projectId]);
  let currentId = store.projects.find((p) => p.id === projectId)?.parentId;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const parent = store.projects.find((p) => p.id === currentId);
    if (!parent) break;
    trail.push(parent);
    currentId = parent.parentId;
  }
  return trail;
}

/**
 * Who hears that a project finished, nearest first — and it **stops at the
 * Division Lead**.
 *
 * "Up the chain of command" for a project means the project tree, not the
 * reporting tree: the people accountable for the work above this are the PLs of
 * its ancestors, then the leads of the teams that own it, ending with whoever
 * leads the division. A member's own Lead is the right audience for a check-in
 * and the wrong one here — they may have nothing to do with this project.
 *
 * **Co-Leads are deliberately not on this list.** A Co-Lead is a manager of the
 * organisation, not of the work: they configure divisions and appoint people,
 * and a ping for every deliverable-set that finishes anywhere in the club is
 * exactly the traffic that teaches somebody to stop reading their dashboard.
 * The Division Lead is the last stop, because the division is the unit that
 * owns delivery.
 *
 * The one exception is a division with no lead — then the announcement would go
 * nowhere, so it falls through to the Co-Leads. That's a gap in the org chart
 * showing up as the notice landing one level higher than it should, which is
 * the right way for it to be visible.
 *
 * The person who pressed the button is dropped: telling somebody what they just
 * did is noise, and it's the fastest way to make an announcement feel automatic
 * in the bad sense.
 */
function completionAudience(
  store: StoreShape,
  project: Project,
  actorId: string
): string[] {
  const ordered: string[] = [];

  for (const ancestor of ancestorProjects(store, project.id)) {
    // Primary first — they're the go-to contact, and array order in `reIds`
    // is explicitly not meaningful.
    ordered.push(ancestor.primaryReId, ...ancestor.reIds);
  }

  // Up the org tree from whichever team owns this, nearest sub-team first.
  //
  // The Division Lead is held back rather than pushed in sequence, because
  // they are very often also a PL of a parent project — and a plain dedup
  // would then keep their FIRST appearance and leave somebody else at the end
  // of the list. They're the last stop by role, not by where they happen to
  // turn up first.
  let divisionLeadId: string | undefined;
  const seenTeams = new Set<string>();
  let teamId = project.teamId;
  while (teamId && !seenTeams.has(teamId)) {
    seenTeams.add(teamId);
    const team: Team | undefined = store.teams.find((t) => t.id === teamId);
    if (!team) break;
    // `parentId === null` is what makes a team a division.
    if (team.leadId) {
      if (team.parentId === null) divisionLeadId = team.leadId;
      else ordered.push(team.leadId);
    }
    teamId = team.parentId ?? undefined;
  }

  const audience = [...new Set(ordered)].filter(
    (id) => id && id !== actorId && id !== divisionLeadId
  );

  if (divisionLeadId && divisionLeadId !== actorId) {
    audience.push(divisionLeadId);
    return audience;
  }

  // No division lead to end on — either the division has none, or the division
  // lead is the person who just pressed the button. Rather than let the
  // announcement evaporate, hand it to the Co-Leads, who are also the people
  // who can fill a vacant division lead.
  for (const member of store.members) {
    if (
      member.globalRole === "co_lead" &&
      member.status === "active" &&
      member.id !== actorId &&
      !audience.includes(member.id)
    ) {
      audience.push(member.id);
    }
  }

  return audience;
}

/**
 * Edit a project's headline fields — name, what it is, and what stage it's at.
 *
 * `phase` is where in the lifecycle it sits (concept to flight test); `health`
 * is how it's going. Two different questions, deliberately two fields.
 *
 * Two rules attach to the one phase that means something different from the
 * rest — see `assertCompletable` and the notice below.
 */
export async function updateProject(input: {
  projectId: string;
  name: string;
  description?: string;
  phase: Project["phase"];
  health: Project["health"];
  targetDate?: string;
  openRoles?: string;
  /** Who is making the change. Needed to attribute the completion notice. */
  actorId?: string;
  today?: string;
}): Promise<Result<Project>> {
  const name = input.name.trim();
  if (!name) return fail<Project>("Give the project a name.");

  return guarded((store) => {
    const project = store.projects.find((p) => p.id === input.projectId);
    if (!project) return fail<Project>("That project no longer exists.");

    const wasComplete = project.phase === "complete";
    const nowComplete = input.phase === "complete";

    if (nowComplete && !wasComplete) {
      /*
        A parent cannot finish ahead of its children.

        "Complete" is not just a label — it moves the project into the finished
        section on /projects, out of /find-work, and into the club's record of
        what got built. A parent marked complete over a sub-project still at
        concept quietly retires work that nobody has done, and the sub-project
        goes with it: it's nested under a card people have stopped reading.

        Refused rather than cascaded. Marking the children complete on the
        parent's behalf would sign off work their own PLs never agreed was
        finished, which is the same self-certification the two-step deliverable
        sign-off exists to prevent.
      */
      const unfinished = descendantProjects(store, project.id).filter(
        (p) => p.phase !== "complete"
      );

      if (unfinished.length > 0) {
        const names = unfinished
          .slice(0, 3)
          .map((p) => p.name)
          .join(", ");
        const rest =
          unfinished.length > 3 ? ` and ${unfinished.length - 3} more` : "";
        return fail<Project>(
          `${unfinished.length} sub-project${unfinished.length === 1 ? "" : "s"} ${unfinished.length === 1 ? "isn't" : "aren't"} complete yet: ${names}${rest}. Finish or move ${unfinished.length === 1 ? "it" : "those"} first — a parent marked complete hides them.`
        );
      }
    }

    /*
      A sub-project cannot be due after the thing it's part of.

      The parent's date is a promise to whoever is above IT, and that promise is
      only worth anything if the work underneath lands first. A child dated past
      its parent isn't ambitious, it's arithmetic that doesn't close — and the
      failure is silent, because both dates look reasonable on their own card.
      You only notice at the parent's deadline, which is far too late.

      No parent date means no constraint. An undated parent is deliberately
      common: plenty of long-running projects have no end, and inventing one to
      satisfy a rule would put a fake deadline in front of everybody.

      Checked in BOTH directions, because the same mistake arrives two ways —
      moving a child later, or pulling a parent earlier over children already
      dated. Refused rather than cascaded, for the same reason completion is:
      quietly rewriting dates on projects other PLs own is how a schedule stops
      being believed.
    */
    const newTarget = input.targetDate || undefined;

    /*
      Only when the date actually MOVES.

      Every save posts the whole form, so a PL renaming a project resends its
      existing date. Validating unconditionally would let one pre-existing
      violation — a pair of dates entered before this rule, or seeded — freeze
      the project: no edit to any field would ever save again, and the error
      would name a date the person hadn't touched. Rules that block unrelated
      work get worked around.
    */
    const targetMoved = newTarget !== project.targetDate;

    if (targetMoved && newTarget) {
      const clash = targetDateClash(store, project, newTarget);
      if (clash) return fail<Project>(clash);
    }

    /*
      A move through the full editor is recorded too, with no reason attached.

      `changeProjectDeadline` is the intended path and requires one. But if only
      that path recorded history, a PL could move the date through this form
      instead and the slip would leave no trace — a hole of exactly the shape
      this repo keeps finding (see the `for update` RLS policy, and the dead
      controls sweep). A row with an empty reason is worse history than a row
      with a good one and far better than none, and the UI labels it as such.
    */
    if (targetMoved && newTarget && project.targetDate && input.actorId) {
      store.projectDeadlineChanges.push({
        id: newId("pdc"),
        projectId: project.id,
        fromDate: project.targetDate,
        toDate: newTarget,
        reason: "",
        changedById: input.actorId,
        changedAt: new Date().toISOString(),
      });
    }

    project.name = name;
    project.description = input.description?.trim() || undefined;
    project.phase = input.phase;
    project.health = input.health;
    project.targetDate = newTarget;
    project.openRoles = input.openRoles?.trim() || undefined;

    // Crossing into or out of `complete` is the only edit worth announcing.
    // Saving the same phase again must not produce a second notice, which is
    // why this compares before and after rather than reading the new value.
    if (nowComplete !== wasComplete && input.actorId) {
      const actor = store.members.find((m) => m.id === input.actorId);
      const audience = completionAudience(store, project, input.actorId);
      const when = input.today ?? todayInClubTime();
      const who = actor?.preferredName || actor?.fullName || "Someone";
      const doneCount = store.deliverables.filter(
        (d) => d.projectId === project.id && d.status === "done"
      ).length;

      store.projectNotices.push({
        id: newId("notice"),
        projectId: project.id,
        kind: nowComplete ? "completed" : "reopened",
        body: nowComplete
          ? `${project.name} is complete. ${who} marked it finished${
              doneCount > 0
                ? ` with ${doneCount} deliverable${doneCount === 1 ? "" : "s"} signed off`
                : ""
            }.`
          : `${project.name} was reopened by ${who} — it's back in the active list.`,
        createdById: input.actorId,
        createdAt: when,
        notifiedMemberIds: audience,
      });
    }

    return ok(project);
  });
}

/**
 * Delete a project, and everything that only existed because of it.
 *
 * CLAUDE.md says never hard-delete a project, and that rule is about a REAL
 * project whose history has to survive graduations. It is not about the ones
 * created while setting the club up, which is the situation the club is
 * actually in — and a rule that leaves permanent junk on the roster stops
 * protecting anything.
 *
 * The guard that matters instead: anything with delivered work or a child
 * project is refused, because that history IS worth keeping. Archive those by
 * setting the phase to complete.
 */
// ---------------------------------------------------------------------------
// Cleaning up after a bulk write
// ---------------------------------------------------------------------------

/** One project the purge would remove. Enough to show a list before pressing. */
export interface PurgeCandidate {
  id: string;
  name: string;
  slug: string;
}

/**
 * Projects attributable to one person that carry NO trace of work.
 *
 * ---------------------------------------------------------------------------
 * Why this is defined by emptiness and not by name, date or count
 * ---------------------------------------------------------------------------
 *
 * An assistant connected to the MCP server created ~4,000 projects called
 * "Project ABCX", "Project ABDG" and so on. The obvious cleanup — match the
 * name, or delete everything created in that hour — is the dangerous one: it
 * decides what to destroy from a pattern in a string, and the club's real
 * projects were created in exactly the same way through the same code path.
 *
 * So the test is **has anything happened here**. A project a person actually
 * meant has a deliverable, a document, a log entry, a session, a join request or
 * a second member. One that has none of those things, and whose only membership
 * rows were created by the same actor, is a shell — and deleting a shell removes
 * no history, which is what makes this compatible with the rule in CLAUDE.md
 * that history must survive.
 *
 * Every collection carrying a `projectId` is checked, deliberately including the
 * ones a bulk writer would never touch. The cost of an extra check is nothing;
 * the cost of a missed one is somebody's work.
 *
 * Attribution accepts either source, because the two eras differ:
 *   - `project.createdBy` for rows created after it started being written;
 *   - the primary PL's `project_members.added_by` for everything before, which
 *     is all 4,000 of them.
 */
type PurgeStore = Pick<
  StoreShape,
  | "projects"
  | "projectMemberships"
  | "deliverables"
  | "projectArtifacts"
  | "workLogs"
  | "joinRequests"
  | "events"
  | "projectNotices"
  | "projectDeadlineChanges"
  | "projectAdvisors"
  | "helpRequests"
  | "progressUpdates"
>;

/**
 * Every shell in the club, bucketed by who made it. ONE pass.
 *
 * ---------------------------------------------------------------------------
 * Why this is grouped rather than filtered per member
 * ---------------------------------------------------------------------------
 *
 * The first version answered for one creator and the Settings report called it
 * once per member. That is O(members x projects) with a dozen linear scans
 * inside, and measured at the incident's real scale — 40 members, 4,000
 * projects — it took **4.7 seconds**. On the very page a Co-Lead opens to clean
 * up 4,000 projects, which is the one moment it must not fall over.
 *
 * Indexing first makes it one pass over each collection plus one over projects.
 * The same measurement drops to single-digit milliseconds. Nothing about the
 * RULE changed — see the note on `emptyProjectsCreatedBy` for that — only how
 * many times the store is walked.
 */
export interface EmptyProjectGroups {
  /** Shells nobody but the creator was ever added to. The safe group. */
  alone: Map<string, PurgeCandidate[]>;
  /**
   * Shells that other people were added to.
   *
   * Still no work on them — same emptiness test — but somebody else is on the
   * list, so these are offered separately and never merged into the count above.
   */
  withOthers: Map<string, PurgeCandidate[]>;
}

export function emptyProjectsByCreator(store: PurgeStore): EmptyProjectGroups {
  /*
    Project ids that show any trace of work, from one sweep per collection.

    Membership rows are NOT in here: every project has at least one, so they
    can't disqualify anything on their own — who added them is what matters, and
    that's handled below.
  */
  const touched = new Set<string>();
  const mark = (id: string | undefined | null) => {
    if (id) touched.add(id);
  };

  for (const p of store.projects) mark(p.parentId);
  for (const d of store.deliverables) mark(d.projectId);
  for (const a of store.projectArtifacts) mark(a.projectId);
  for (const w of store.workLogs) mark(w.projectId);
  for (const r of store.joinRequests) mark(r.projectId);
  for (const e of store.events) mark(e.projectId);
  for (const n of store.projectNotices) mark(n.projectId);
  for (const c of store.projectDeadlineChanges) mark(c.projectId);
  for (const a of store.projectAdvisors) mark(a.projectId);
  for (const h of store.helpRequests) mark(h.projectId);
  for (const u of store.progressUpdates) {
    for (const entry of u.entries) mark(entry.projectId);
  }

  /*
    Per project: who its members were added by, and who its primary PL's row was
    added by. Both come from the same single sweep.
  */
  const adders = new Map<string, Set<string>>();
  const primaryAddedBy = new Map<string, string>();
  const projectById = new Map(store.projects.map((p) => [p.id, p]));

  for (const m of store.projectMemberships) {
    if (m.addedBy) {
      const set = adders.get(m.projectId);
      if (set) set.add(m.addedBy);
      else adders.set(m.projectId, new Set([m.addedBy]));
    }
    if (projectById.get(m.projectId)?.primaryReId === m.memberId && m.addedBy) {
      primaryAddedBy.set(m.projectId, m.addedBy);
    }
  }

  const byCreator = new Map<string, PurgeCandidate[]>();
  const withOthers = new Map<string, PurgeCandidate[]>();

  for (const project of store.projects) {
    if (touched.has(project.id)) continue;

    /*
      Attribution: the recorded creator, or whoever added the primary PL for the
      rows written before `created_by` was mapped.
    */
    const creator = project.createdBy ?? primaryAddedBy.get(project.id);
    if (!creator) continue;

    const othersAdded = [...(adders.get(project.id) ?? [])].some(
      (id) => id !== creator
    );

    /*
      Somebody else on the membership list is a WEAKER signal than work, and it
      is reported separately rather than treated as a veto.

      It was a veto at first, on the reasoning that a second person means a human
      has been here. Anish's data disproved that: the bulk run added other members
      to some of its projects, so "has other members" caught a pile of shells and
      the strict rule left them behind. Membership is not work — somebody standing
      in an empty room has not built anything.

      But it is not nothing either, and a real project with three people on it and
      no deliverable filed yet looks identical from here. So the two groups are
      kept apart and counted apart, and removing the second is a separate,
      separately-labelled press. The UI never merges them.
    */
    if (othersAdded) {
      const list = withOthers.get(creator);
      const candidate = {
        id: project.id,
        name: project.name,
        slug: project.slug,
      };
      if (list) list.push(candidate);
      else withOthers.set(creator, [candidate]);
      continue;
    }

    const list = byCreator.get(creator);
    const candidate = {
      id: project.id,
      name: project.name,
      slug: project.slug,
    };
    if (list) list.push(candidate);
    else byCreator.set(creator, [candidate]);
  }

  return { alone: byCreator, withOthers };
}

/**
 * Projects attributable to one person that carry NO trace of work.
 *
 * ---------------------------------------------------------------------------
 * Why this is defined by emptiness and not by name, date or count
 * ---------------------------------------------------------------------------
 *
 * An assistant connected to the MCP server created ~4,000 projects called
 * "Project ABCX", "Project ABDG" and so on. The obvious cleanup — match the
 * name, or delete everything created in that hour — is the dangerous one: it
 * decides what to destroy from a pattern in a string, and the club's real
 * projects were created in exactly the same way through the same code path.
 *
 * So the test is **has anything happened here**. A project a person actually
 * meant has a deliverable, a document, a log entry, a session, a join request, an
 * update, a session or a sub-project. One with none of those is a shell — and
 * deleting a shell removes no history, which is what makes this compatible with
 * the rule in CLAUDE.md that history must survive.
 *
 * Every collection carrying a `projectId` is checked, deliberately including the
 * ones a bulk writer would never touch. The cost of an extra check is nothing;
 * the cost of a missed one is somebody's work.
 *
 * @param withOthers Include the shells other people were added to. Off by
 *        default: those are a weaker case and the caller has to ask for them, so
 *        no code path can quietly widen what a press removes.
 */
export function emptyProjectsCreatedBy(
  store: PurgeStore,
  creatorId: string,
  { withOthers = false }: { withOthers?: boolean } = {}
): PurgeCandidate[] {
  if (!creatorId) return [];
  const groups = emptyProjectsByCreator(store);
  const alone = groups.alone.get(creatorId) ?? [];
  if (!withOthers) return alone;
  return [...alone, ...(groups.withOthers.get(creatorId) ?? [])];
}

/**
 * Delete a batch of those shells.
 *
 * ---------------------------------------------------------------------------
 * Batched on purpose, and the batch size is not a style choice
 * ---------------------------------------------------------------------------
 *
 * `deleteProject` is one `mutate()` per project, which is one Postgres round
 * trip: four thousand of those would take far longer than a serverless function
 * is allowed to live, and a timeout half way through leaves the caller with no
 * idea how far it got. This does ONE mutation for the whole batch, and returns
 * how many are left so the caller can press again and watch the number fall.
 *
 * The re-derivation inside `guarded` matters: the candidate list is computed
 * against the snapshot being written, not against whatever the page rendered
 * from, so a project that gained a deliverable in between is not deleted.
 */
export async function purgeEmptyProjectsCreatedBy(input: {
  creatorId: string;
  /** How many to remove this press. */
  limit: number;
  /**
   * Also remove the shells other people were added to.
   *
   * Defaults to false so the wider set is never reached by accident — the caller
   * has to pass it, and the UI asks for it on a separate button with its own
   * count. See the note in `emptyProjectsByCreator`.
   */
  withOthers?: boolean;
}): Promise<Result<{ deleted: number; remaining: number; names: string[] }>> {
  return guarded((store) => {
    const all = emptyProjectsCreatedBy(store, input.creatorId, {
      withOthers: input.withOthers === true,
    });
    const batch = all.slice(0, Math.max(1, Math.min(input.limit, 500)));
    const ids = new Set(batch.map((p) => p.id));

    if (ids.size === 0) {
      return ok({ deleted: 0, remaining: 0, names: [] });
    }

    /*
      Only the collections that can point at a project WITHOUT disqualifying it
      from the candidate list — which is memberships and nothing else, since
      every other one is a reason to keep the project. Written out anyway rather
      than trusted: if the emptiness test above is ever loosened, this must not
      silently start orphaning rows.
    */
    store.projectMemberships = store.projectMemberships.filter(
      (m) => !ids.has(m.projectId)
    );
    store.projects = store.projects.filter((p) => !ids.has(p.id));

    return ok({
      deleted: batch.length,
      remaining: all.length - batch.length,
      names: batch.slice(0, 5).map((p) => p.name),
    });
  });
}

export async function deleteProject(
  projectId: string,
  /**
   * Co-Lead override.
   *
   * The signed-off-work guard exists so nobody quietly erases delivered work
   * from someone's record. A Co-Lead clearing up test projects is the case it
   * gets in the way of, and they're the people trusted with the org's shape
   * anyway — so they can proceed, and the UI says what will be lost.
   */
  force = false
): Promise<Result<null>> {
  return guarded((store) => {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return fail<null>("That project no longer exists.");

    if (store.projects.some((p) => p.parentId === projectId)) {
      return fail<null>(
        "This has sub-projects. Delete or move those first, so nothing is orphaned."
      );
    }

    const delivered = store.deliverables.filter(
      (d) => d.projectId === projectId && d.status === "done"
    );
    if (delivered.length > 0 && !force) {
      return fail<null>(
        `${delivered.length} deliverable${delivered.length === 1 ? " has" : "s have"} been signed off here and count towards people's records. Mark the project complete instead — or ask a Co-Lead if this was a test project.`
      );
    }

    store.deliverables = store.deliverables.filter(
      (d) => d.projectId !== projectId
    );
    cascadeTodos(store);
    store.projectMemberships = store.projectMemberships.filter(
      (m) => m.projectId !== projectId
    );
    store.joinRequests = store.joinRequests.filter(
      (r) => r.projectId !== projectId
    );
    store.workLogs = store.workLogs.filter((w) => w.projectId !== projectId);
    store.projectArtifacts = store.projectArtifacts.filter(
      (a) => a.projectId !== projectId
    );
    /*
      The deadline history goes with the project.

      It is append-only while the project lives — nothing in the app edits or
      removes a single row, because a slip its author can tidy away is worth
      nothing — but there is no project left to hold a schedule for. Matches the
      `on delete cascade` in migration 0040, and `lib/data/rls.test.ts` checks
      the DELETE policy exists to make the cascade reachable.
    */
    store.projectDeadlineChanges = store.projectDeadlineChanges.filter(
      (c) => c.projectId !== projectId
    );
    store.projectNotices = store.projectNotices.filter(
      (n) => n.projectId !== projectId
    );
    store.projects = store.projects.filter((p) => p.id !== projectId);
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Guide pages — club-written material
//
// Permission is the caller's job (`can.manageGuides`, Co-Lead only). What lives
// here is the shape rule: a link with no URL is a dead row on a page new
// members are told to trust, and the database says the same thing.
// ---------------------------------------------------------------------------

export async function saveGuideBlock(input: {
  /** Absent to create, present to edit. */
  blockId?: string;
  page: GuideBlock["page"];
  kind: GuideBlock["kind"];
  title: string;
  body?: string;
  url?: string;
  category?: string;
  actorId: string;
  today: string;
}): Promise<Result<GuideBlock>> {
  const title = input.title.trim();
  if (!title) return fail<GuideBlock>("Give it a title.");

  const url = input.url?.trim() || undefined;
  const body = input.body?.trim() || undefined;

  if (input.kind === "link") {
    if (!url) return fail<GuideBlock>("A link needs a URL.");
    /*
      Same validator the engineering record uses. A guide is read by somebody
      in their first week, and a link that has already expired teaches them the
      app is unreliable before they have used any of it.
    */
    const problem = checkLinkPermanence(url);
    if (problem) return fail<GuideBlock>(problem.reason);
  } else if (!body) {
    return fail<GuideBlock>("A note needs something written in it.");
  }

  return guarded((store) => {
    if (input.blockId) {
      const existing = store.guideBlocks.find((b) => b.id === input.blockId);
      if (!existing) return fail<GuideBlock>("That section no longer exists.");

      existing.kind = input.kind;
      existing.title = title;
      existing.body = body;
      existing.url = input.kind === "link" ? url : undefined;
      existing.category = input.category?.trim() || undefined;
      existing.updatedAt = input.today;
      existing.updatedById = input.actorId;
      return ok(existing);
    }

    // New rows go to the end of their page rather than the top, so adding one
    // never reshuffles what a member read yesterday.
    const last = store.guideBlocks
      .filter((b) => b.page === input.page)
      .reduce((max, b) => Math.max(max, b.sortOrder), 0);

    const block: GuideBlock = {
      id: newId("guide"),
      page: input.page,
      kind: input.kind,
      title,
      body,
      url: input.kind === "link" ? url : undefined,
      category: input.category?.trim() || undefined,
      sortOrder: last + 10,
      updatedAt: input.today,
      updatedById: input.actorId,
    };

    store.guideBlocks.push(block);
    return ok(block);
  });
}

export async function removeGuideBlock(input: {
  blockId: string;
}): Promise<Result<null>> {
  return guarded((store) => {
    const index = store.guideBlocks.findIndex((b) => b.id === input.blockId);
    if (index === -1) return fail<null>("That section is already gone.");
    store.guideBlocks.splice(index, 1);
    return ok(null);
  });
}

/**
 * Nudge one block up or down its page.
 *
 * Swaps sort orders with its neighbour rather than renumbering everything — a
 * full renumber would rewrite every row on the page for a one-place move, and
 * `persistDiff` would send all of them.
 */
export async function moveGuideBlock(input: {
  blockId: string;
  direction: "up" | "down";
}): Promise<Result<GuideBlock>> {
  return guarded((store) => {
    const block = store.guideBlocks.find((b) => b.id === input.blockId);
    if (!block) return fail<GuideBlock>("That section no longer exists.");

    const siblings = store.guideBlocks
      .filter((b) => b.page === block.page)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const at = siblings.findIndex((b) => b.id === block.id);
    const swapWith = siblings[input.direction === "up" ? at - 1 : at + 1];
    if (!swapWith) {
      return fail<GuideBlock>(
        `It's already ${input.direction === "up" ? "first" : "last"}.`
      );
    }

    const mine = block.sortOrder;
    block.sortOrder = swapWith.sortOrder;
    swapWith.sortOrder = mine;
    return ok(block);
  });
}

/**
 * Turn the daily Discord digest on or off for yourself.
 *
 * Its own operation rather than a field on `ProfileEdits`, because the profile
 * form posts every field it knows about — a preference living there would be
 * silently reset to the form's default by anyone editing their major.
 */
export async function setDailyDigest(input: {
  memberId: string;
  optOut: boolean;
}): Promise<Result<Member>> {
  return guarded((store) => {
    const member = store.members.find((m) => m.id === input.memberId);
    if (!member) return fail<Member>("That member no longer exists.");

    member.dailyDigestOptOut = input.optOut;
    return ok(member);
  });
}

// ---------------------------------------------------------------------------
// The engineering record
//
// Links, overwhelmingly, rather than uploads: the club's CAD lives in Onshape
// and its code on GitHub, and a copy here is a copy that goes stale. The app is
// the index.
//
// Which makes link rot the failure mode worth designing against, so both halves
// of that run here — `checkLinkPermanence` refuses what a machine can prove is
// temporary, and `confirmedPermanent` records that a human vouched for the
// rest. Neither is optional.
// ---------------------------------------------------------------------------

/**
 * Attach a document to a project's engineering record.
 *
 * Permission is the caller's job as always (`can.attachArtifact`), including
 * the "committed to this project" half. What lives here is what needs the row:
 * the project must exist, and the link must be one that will still resolve
 * after everyone who could fix it has graduated.
 */
export async function addProjectArtifact(input: {
  projectId: string;
  uploadedById: string;
  kind: ArtifactKind;
  title: string;
  /** A permanent link. Exactly one of this or `storagePath`. */
  url?: string;
  /**
   * Object key of an already-uploaded file in the private bucket.
   *
   * The caller uploads first and passes the key. Doing it that way round means
   * a failed upload never leaves a row pointing at nothing — the row is the
   * last thing written, not the first.
   */
  storagePath?: string;
  description?: string;
  version?: string;
  /**
   * The uploader ticked the box saying this link doesn't expire.
   *
   * Only meaningful for links. An uploaded file cannot rot: this app is
   * holding it, so there is nothing for a human to vouch for.
   */
  confirmedPermanent?: boolean;
  today: string;
}): Promise<Result<ProjectArtifact>> {
  const title = input.title.trim();
  if (!title) return fail<ProjectArtifact>("Give the document a title.");
  if (title.length > 160) {
    // Titles are what people scan when they arrive asking "where are the
    // requirements?". Past a line it stops being scannable.
    return fail<ProjectArtifact>(
      "Keep the title to a line — put the rest in the description."
    );
  }

  const url = input.url?.trim() || undefined;
  const storagePath = input.storagePath?.trim() || undefined;

  // The DB constraint says the same thing (`project_artifacts_has_target`);
  // this says it in a sentence instead of a Postgres error.
  if (!url && !storagePath) {
    return fail<ProjectArtifact>("Attach a file or paste a link.");
  }
  if (url && storagePath) {
    return fail<ProjectArtifact>(
      "That's both a file and a link — pick one, so the record has a single source."
    );
  }

  /*
    Link rules apply only to links.

    Checked before the confirmation so the message is the useful one: someone
    who pasted a signed link and didn't tick the box should hear about the
    link, not the box.
  */
  if (url) {
    const problem = checkLinkPermanence(url);
    if (problem) return fail<ProjectArtifact>(problem.reason);

    if (!input.confirmedPermanent) {
      return fail<ProjectArtifact>(
        "Confirm the link won't expire before attaching it. Once this project is complete the record is frozen, and a dead link can't be fixed then."
      );
    }
  }

  return guarded((store) => {
    const project = store.projects.find((p) => p.id === input.projectId);
    if (!project) {
      return fail<ProjectArtifact>("That project no longer exists.");
    }

    const artifact: ProjectArtifact = {
      id: newId("artifact"),
      projectId: input.projectId,
      kind: input.kind,
      title,
      description: input.description?.trim() || undefined,
      /*
        Three columns, three different meanings, and only ever one of them set.
        `externalUrl` is somewhere else on the internet; `storagePath` is a key
        in our own private bucket that has to be signed before it can be
        opened; `fileUrl` is a permanent hosted URL, which nothing writes today
        and which exists because the schema predates the bucket.

        `ArtifactList` reads the difference to decide whether to open in a new
        tab and show the outbound arrow, so putting a value in the wrong one is
        a visible bug rather than an untidy one.
      */
      externalUrl: url,
      storagePath,
      version: input.version?.trim() || undefined,
      uploadedById: input.uploadedById,
      createdAt: input.today,
    };

    store.projectArtifacts.push(artifact);
    return ok(artifact);
  });
}

/**
 * Take something out of the engineering record.
 *
 * The phase check lives in `can.manageArtifact`, not here — it's a question
 * about the actor's role, and role questions belong in `permissions.ts`. This
 * only needs to find the row.
 */
export async function removeProjectArtifact(input: {
  artifactId: string;
}): Promise<Result<null>> {
  return guarded((store) => {
    const index = store.projectArtifacts.findIndex(
      (a) => a.id === input.artifactId
    );
    if (index === -1) {
      return fail<null>("That document has already been removed.");
    }

    store.projectArtifacts.splice(index, 1);
    return ok(null);
  });
}

/**
 * Rename a division or sub-team, or move it under a different parent.
 *
 * `leadId` distinguishes three states, and it has to: `undefined` means "the
 * caller didn't mention it", `null` means "clear it". This used to be
 * `leadId?: string`, and the edit form had no lead field — so every rename
 * posted an empty value and silently unset the Division Lead. The name on
 * /projects would just stop being there, with nothing connecting it to the
 * rename that caused it.
 */
export async function updateTeam(input: {
  teamId: string;
  name: string;
  parentId: string | null;
  leadId?: string | null;
}): Promise<Result<Team>> {
  const name = input.name.trim();
  if (!name) return fail<Team>("Give it a name.");

  return guarded((store) => {
    const team = store.teams.find((t) => t.id === input.teamId);
    if (!team) return fail<Team>("That team no longer exists.");

    if (input.parentId === team.id) {
      return fail<Team>("A team can't sit under itself.");
    }

    // Walking up from the proposed parent catches the longer loops a direct
    // self-check misses — A under B under A leaves both unreachable, and every
    // tree walk in the app would then depend on its own cycle guard.
    let cursor = input.parentId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (cursor === team.id) {
        return fail<Team>(
          "That would put this team inside one of its own sub-teams."
        );
      }
      seen.add(cursor);
      cursor = store.teams.find((t) => t.id === cursor)?.parentId ?? null;
    }

    team.name = name;
    team.parentId = input.parentId;
    if (input.leadId !== undefined) team.leadId = input.leadId ?? undefined;
    return ok(team);
  });
}

/**
 * Retire a division without erasing what it did.
 *
 * `deleteTeam` below is refused while any project or sub-team points at the
 * division, which sounds safe and isn't: the only way to retire one was to
 * first strip away everything recording what it built. A club that reorganises
 * every year would delete its own history to keep a page tidy.
 *
 * Archiving is the opposite trade. Everything stays attached — projects keep
 * their team, members keep their primary team, the lead stays named — and the
 * division simply stops appearing in the tree and in pickers. `/projects/archive`
 * reads it back.
 *
 * The one guard that survives: **live work cannot be archived.** Completed
 * projects come along, because they are the history. Anything still running
 * would vanish from `/projects` and `/find-work` while people are still on it,
 * which is precisely the disappearing-work problem the app exists to remove.
 *
 * Sub-teams archive with the parent. A sub-team of an archived division has
 * nowhere to be shown, so leaving it active would be a row that claims to exist
 * on a page that can't render it.
 */
export async function archiveTeam(input: {
  teamId: string;
  archivedBy: string;
  note?: string;
  today: string;
}): Promise<Result<Team>> {
  return guarded((store) => {
    const team = store.teams.find((t) => t.id === input.teamId);
    if (!team) return fail<Team>("That division no longer exists.");
    if (!team.isActive) return fail<Team>("That division is already archived.");

    // Everything that would go with it: the team plus its whole sub-tree.
    const subtree = [team.id];
    const seen = new Set(subtree);
    for (let i = 0; i < subtree.length; i++) {
      for (const child of store.teams) {
        if (child.parentId === subtree[i] && !seen.has(child.id)) {
          seen.add(child.id);
          subtree.push(child.id);
        }
      }
    }

    const live = store.projects.filter(
      (p) => p.teamId && seen.has(p.teamId) && p.phase !== "complete"
    );
    if (live.length > 0) {
      const names = live
        .slice(0, 3)
        .map((p) => p.name)
        .join(", ");
      const rest = live.length > 3 ? ` and ${live.length - 3} more` : "";
      return fail<Team>(
        `${live.length} project${live.length === 1 ? " is" : "s are"} still running here: ${names}${rest}. Move ${live.length === 1 ? "it" : "them"} to another division or mark ${live.length === 1 ? "it" : "them"} complete — archiving would hide live work.`
      );
    }

    const note = input.note?.trim() || undefined;
    for (const id of seen) {
      const t = store.teams.find((x) => x.id === id);
      if (!t || !t.isActive) continue;
      t.isActive = false;
      t.archivedAt = input.today;
      t.archivedBy = input.archivedBy;
      t.archiveNote = note;
    }

    return ok(team);
  });
}

/**
 * Bring an archived division back.
 *
 * Only the division itself, not its sub-teams: restoring a whole tree that was
 * archived in one action would resurrect sub-teams somebody had already retired
 * separately before the division went. Each is restored deliberately.
 *
 * A sub-team can't be restored while its parent is still archived — it would be
 * active with nowhere to appear.
 */
export async function restoreTeam(teamId: string): Promise<Result<Team>> {
  return guarded((store) => {
    const team = store.teams.find((t) => t.id === teamId);
    if (!team) return fail<Team>("That division no longer exists.");
    if (team.isActive) return fail<Team>("That division is already active.");

    if (team.parentId) {
      const parent = store.teams.find((t) => t.id === team.parentId);
      if (parent && !parent.isActive) {
        return fail<Team>(
          `${parent.name} is still archived. Restore it first, or this sub-team has nowhere to appear.`
        );
      }
    }

    team.isActive = true;
    team.archivedAt = undefined;
    team.archivedBy = undefined;
    team.archiveNote = undefined;
    return ok(team);
  });
}

/**
 * Delete a division outright.
 *
 * Still here, and still refused while anything points at it — that combination
 * is what makes it safe. It's the path for a division created by mistake five
 * minutes ago, which has no history worth keeping. Anything with a past gets
 * `archiveTeam` instead.
 */
export async function deleteTeam(teamId: string): Promise<Result<null>> {
  return guarded((store) => {
    const team = store.teams.find((t) => t.id === teamId);
    if (!team) return fail<null>("That team no longer exists.");

    const projects = store.projects.filter((p) => p.teamId === teamId);
    if (projects.length > 0) {
      return fail<null>(
        `${projects.length} project${projects.length === 1 ? "" : "s"} still sit${projects.length === 1 ? "s" : ""} under this. Move them to another division first.`
      );
    }

    if (store.teams.some((t) => t.parentId === teamId)) {
      return fail<null>("This has sub-teams. Move or delete those first.");
    }

    for (const m of store.members) {
      if (m.primaryTeamId === teamId) m.primaryTeamId = undefined;
    }

    store.teams = store.teams.filter((t) => t.id !== teamId);
    return ok(null);
  });
}

export async function setProjectTeam(input: {
  projectId: string;
  teamId: string | null;
}): Promise<Result<Project>> {
  return guarded((store) => {
    const project = store.projects.find((p) => p.id === input.projectId);
    if (!project) return fail<Project>("That project no longer exists.");

    if (input.teamId && !store.teams.some((t) => t.id === input.teamId)) {
      return fail<Project>("That team no longer exists.");
    }

    project.teamId = input.teamId ?? undefined;
    return ok(project);
  });
}

/**
 * Create a division, or a sub-team under one.
 *
 * Divisions are the top level of the org tree (`parentId === null`) and every
 * project hangs off one. There was no way to make one through the app, which
 * left new projects permanently unfindable.
 */
export async function createTeam(input: {
  name: string;
  parentId: string | null;
  leadId?: string;
}): Promise<Result<Team>> {
  const name = input.name.trim();
  if (!name) return fail<Team>("Give it a name.");

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return guarded((store) => {
    if (store.teams.some((t) => t.slug === slug)) {
      return fail<Team>(`There's already a team called "${name}".`);
    }

    const team: Team = {
      id: newId("t"),
      name,
      slug,
      parentId: input.parentId,
      leadId: input.leadId,
      isActive: true,
    };

    store.teams.push(team);
    return ok(team);
  });
}

/**
 * Remove somebody's record entirely.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all, given "never hard-delete people"
 * ---------------------------------------------------------------------------
 *
 * That rule is about a REAL member whose contribution history has to survive
 * graduation, and it stands. This is for the other thing: a broken profile
 * row. The commonest is a duplicate — somebody is invited as
 * `jhale@stanford.edu`, signs in as `juliahale@stanford.edu`, and the trigger
 * in 0005 finds no match and creates a second, inactive row. Now there are two
 * records for one person, one of which can never be used and clutters every
 * picker in the app.
 *
 * Deactivating is the wrong tool there: it keeps the bad row on the roster
 * forever, marked as if a real person left.
 *
 * ---------------------------------------------------------------------------
 * The guards
 * ---------------------------------------------------------------------------
 *
 * Same shape as `deleteProject`: refuse anything with real history unless a
 * Co-Lead explicitly overrides, and never allow the two lock-outs.
 */
export async function deleteMember(input: {
  memberId: string;
  /** Never yourself. Passed so the operation can check independently. */
  actorId: string;
  /**
   * Co-Lead override for the history guard.
   *
   * Deliberately does NOT bypass the lock-out guards below — those aren't
   * about caution, they're about the app remaining usable afterwards.
   */
  force?: boolean;
}): Promise<Result<null>> {
  return guarded((store) => {
    const member = store.members.find((m) => m.id === input.memberId);
    if (!member) return fail<null>("That member no longer exists.");

    if (member.id === input.actorId) {
      return fail<null>("You can't delete your own account.");
    }

    if (member.globalRole === "co_lead") {
      const others = store.members.filter(
        (m) =>
          m.globalRole === "co_lead" &&
          m.status === "active" &&
          m.id !== member.id
      );
      if (others.length === 0) {
        return fail<null>(
          "That's the last Co-Lead. Promote somebody else first, or nobody can manage the club."
        );
      }
    }

    // History that belongs to a person, not to a broken row.
    const delivered = store.deliverables.filter(
      (d) => d.ownerId === member.id && d.status === "done"
    ).length;
    const checkIns = store.progressUpdates.filter(
      (u) => u.memberId === member.id && u.submittedAt
    ).length;

    if ((delivered > 0 || checkIns > 0) && !input.force) {
      const parts: string[] = [];
      if (delivered > 0) {
        parts.push(
          `${delivered} signed-off deliverable${delivered === 1 ? "" : "s"}`
        );
      }
      if (checkIns > 0) {
        parts.push(
          `${checkIns} submitted check-in${checkIns === 1 ? "" : "s"}`
        );
      }
      return fail<null>(
        `${member.fullName} has ${parts.join(" and ")} on record. Deactivate instead — that keeps the history. A Co-Lead can force a delete if this is a duplicate profile.`
      );
    }

    /*
      Every refusal happens BEFORE the first mutation. Order matters here.

      This check used to sit after the reparenting loop below, which meant a
      delete that was then refused had already rewritten everybody's reporting
      line — a failed operation with a permanent side effect, and the worst
      kind, since the caller sees an error and reasonably assumes nothing
      changed.
    */
    const owned = store.projects.filter((p) => p.primaryReId === member.id);
    if (owned.length > 0) {
      return fail<null>(
        `${member.fullName} is the primary PL of ${owned.map((p) => p.name).join(", ")}. Hand those over first — a project with no PL is the one state the model can't hold.`
      );
    }

    /*
      Anyone reporting to them is reparented to THEIR lead, not orphaned.

      A member with `leadId` pointing at a deleted row has nobody reading their
      check-ins and no escalation path, and nothing in the app would report it
      — the exact silent failure the review chain exists to prevent.
    */
    for (const other of store.members) {
      if (other.leadId === member.id) other.leadId = member.leadId;
    }

    store.projectMemberships = store.projectMemberships.filter(
      (m) => m.memberId !== member.id
    );
    store.workLogs = store.workLogs.filter((w) => w.memberId !== member.id);
    store.joinRequests = store.joinRequests.filter(
      (r) => r.memberId !== member.id
    );
    store.progressUpdates = store.progressUpdates.filter(
      (u) => u.memberId !== member.id
    );
    store.certifications = store.certifications.filter(
      (c) => c.memberId !== member.id
    );
    store.helpRequests = store.helpRequests.filter(
      (h) => h.memberId !== member.id
    );
    store.deliverables = store.deliverables.filter(
      (d) => d.ownerId !== member.id
    );
    cascadeTodos(store);
    // Division leadership is a pointer, not a record — clear it rather than
    // leaving a division led by a row that no longer exists.
    for (const team of store.teams) {
      if (team.leadId === member.id) team.leadId = undefined;
    }

    store.members = store.members.filter((m) => m.id !== member.id);
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Phase 8 — the calendar
// ---------------------------------------------------------------------------

/**
 * Put something on the calendar.
 *
 * The permission question ("a project you're on" vs "leadership for club-wide"
 * vs "anyone can propose a 1:1") is the caller's — it needs the org graph.
 * What's enforced here is that the event is coherent: it has a title, it
 * starts before it ends, and its project exists.
 *
 * Deliberately no conflict check. Overlapping events are NORMAL — a design
 * review runs inside a general meeting — and refusing them would break the one
 * requirement the calendar has to get right.
 */
export async function createEvent(input: {
  title: string;
  kind: ClubEvent["kind"];
  startsAt: string;
  endsAt?: string;
  location?: string;
  projectId?: string;
  createdBy: string;
  attendeeIds?: string[];
  isOpen?: boolean;
  notes?: string;
  importanceWeight?: number;
  /** Last date the repeat may land on. Omit for a one-off. */
  repeatUntil?: string;
  /** 1 weekly, 2 fortnightly. Ignored without `repeatUntil`. */
  repeatEveryWeeks?: number;
}): Promise<Result<ClubEvent>> {
  const title = input.title.trim();
  if (!title) return fail<ClubEvent>("Give it a name.");
  if (!input.startsAt) return fail<ClubEvent>("When does it start?");
  if (input.endsAt && input.endsAt < input.startsAt) {
    return fail<ClubEvent>("It ends before it starts.");
  }

  /*
    Recurrence, validated by the SAME function the form uses.

    `repeatProblem` lives in `lib/calendar/recurrence.ts` so the picker and the
    server cannot drift — the same arrangement as `checkLinkPermanence` for
    artifacts and `workByProject` for check-ins. Its message names the real
    mistake ("that would repeat 5,214 times, over 100 years"), which a CHECK
    constraint could never do.
  */
  const repeatProblemMessage = repeatProblem(input.startsAt, input.repeatUntil);
  if (repeatProblemMessage) return fail<ClubEvent>(repeatProblemMessage);

  const importance =
    input.importanceWeight ?? DEFAULT_EVENT_IMPORTANCE[input.kind] ?? 3;
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    return fail<ClubEvent>("Importance runs 1 to 5.");
  }

  return guarded((store) => {
    if (
      input.projectId &&
      !store.projects.some((p) => p.id === input.projectId)
    ) {
      return fail<ClubEvent>("That project no longer exists.");
    }

    const event: ClubEvent = {
      id: newId("event"),
      title,
      kind: input.kind,
      importanceWeight: importance,
      startsAt: input.startsAt,
      endsAt: input.endsAt || undefined,
      location: input.location?.trim() || undefined,
      projectId: input.projectId || undefined,
      createdBy: input.createdBy,
      // The organiser is always on it. Nothing else in the app would add them,
      // and a session whose creator isn't listed reads as somebody else's.
      attendeeIds: [
        ...new Set([input.createdBy, ...(input.attendeeIds ?? [])]),
      ].filter(Boolean),
      isOpen: input.isOpen ?? input.kind !== "one_on_one",
      notes: input.notes?.trim() || undefined,
      repeatUntil: input.repeatUntil?.slice(0, 10) || undefined,
      /*
        The interval is only meaningful alongside an end date, and storing one
        without the other is the state migration 0043's CHECK refuses. Normalised
        here so the app never depends on the constraint to catch it.
      */
      repeatEveryWeeks: input.repeatUntil
        ? input.repeatEveryWeeks === 2
          ? 2
          : 1
        : undefined,
      skippedDates: [],
    };

    store.events.push(event);
    return ok(event);
  });
}

export async function updateEvent(input: {
  eventId: string;
  title: string;
  kind: ClubEvent["kind"];
  startsAt: string;
  endsAt?: string;
  location?: string;
  notes?: string;
  importanceWeight?: number;
  /**
   * Which project this belongs to. `null` clears it, `undefined` leaves it —
   * the two have to be distinguishable or an edit form that doesn't render the
   * field would silently unlink every event it saved.
   */
  projectId?: string | null;
  /** `false` makes it invite-only. Undefined leaves it as it is. */
  isOpen?: boolean;
  /**
   * Change the repeat range. `null` stops it repeating; `undefined` leaves it.
   *
   * The three-way distinction matters, exactly as it does for `projectId`: an
   * edit form that didn't render the field would otherwise silently turn every
   * weekly meeting it saved into a one-off. Anish asked to be able to "easily edit
   * and change" the range, so this is the field that does it.
   */
  repeatUntil?: string | null;
  /** 1 weekly, 2 fortnightly. Undefined leaves it. */
  repeatEveryWeeks?: number;
}): Promise<Result<ClubEvent>> {
  const title = input.title.trim();
  if (!title) return fail<ClubEvent>("Give it a name.");
  if (input.endsAt && input.endsAt < input.startsAt) {
    return fail<ClubEvent>("It ends before it starts.");
  }

  // Same validator as the create path and the form. See `createEvent`.
  if (input.repeatUntil) {
    const problem = repeatProblem(input.startsAt, input.repeatUntil);
    if (problem) return fail<ClubEvent>(problem);
  }

  return guarded((store) => {
    const event = store.events.find((e) => e.id === input.eventId);
    if (!event) return fail<ClubEvent>("That event no longer exists.");

    const importance =
      input.importanceWeight ?? DEFAULT_EVENT_IMPORTANCE[input.kind] ?? 3;
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
      return fail<ClubEvent>("Importance runs 1 to 5.");
    }

    event.title = title;
    event.kind = input.kind;
    event.startsAt = input.startsAt;
    event.endsAt = input.endsAt || undefined;
    event.location = input.location?.trim() || undefined;
    event.notes = input.notes?.trim() || undefined;
    event.importanceWeight = importance;

    if (input.projectId !== undefined) {
      if (
        input.projectId &&
        !store.projects.some((p) => p.id === input.projectId)
      ) {
        return fail<ClubEvent>("That project no longer exists.");
      }
      event.projectId = input.projectId || undefined;
    }

    /*
      Closing an event does NOT drop whoever already said they'd come.

      Somebody who turned up to an open session and then finds themselves
      un-invited by an edit they never saw is a worse outcome than a guest list
      with one extra name on it, and the organiser can remove them explicitly.
    */
    if (input.isOpen !== undefined) event.isOpen = input.isOpen;

    /*
      Changing the range, and what happens to cancelled weeks.

      `null` stops it repeating, which also clears `skippedDates` — those name
      occurrences that no longer exist, and leaving them would mean a one-off event
      carrying a list of cancelled dates that can never apply. Shortening a range
      leaves them alone: a week cancelled inside the new range is still cancelled,
      and one outside it is already gone from the expansion.
    */
    if (input.repeatUntil !== undefined) {
      if (input.repeatUntil === null) {
        event.repeatUntil = undefined;
        event.repeatEveryWeeks = undefined;
        event.skippedDates = [];
      } else {
        event.repeatUntil = input.repeatUntil.slice(0, 10);
        event.repeatEveryWeeks =
          (input.repeatEveryWeeks ?? event.repeatEveryWeeks) === 2 ? 2 : 1;
      }
    } else if (input.repeatEveryWeeks !== undefined && event.repeatUntil) {
      // Cadence changed without touching the range.
      event.repeatEveryWeeks = input.repeatEveryWeeks === 2 ? 2 : 1;
    }

    return ok(event);
  });
}

/**
 * Cancel or restore ONE occurrence of a repeating event.
 *
 * "No meeting during finals" without deleting the series and losing its attendee
 * list — which is the only alternative the app had, and it takes the RSVPs with it.
 *
 * Toggles, deliberately: cancelling and un-cancelling are the same decision made
 * twice, and a separate restore action would be a second button doing the inverse
 * of the first with no extra information.
 */
export async function toggleEventOccurrence(input: {
  eventId: string;
  /** The occurrence date, `YYYY-MM-DD`. */
  day: string;
}): Promise<Result<ClubEvent>> {
  const day = input.day.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return fail<ClubEvent>("Which week?");
  }

  return guarded((store) => {
    const event = store.events.find((e) => e.id === input.eventId);
    if (!event) return fail<ClubEvent>("That event no longer exists.");
    if (!event.repeatUntil) {
      return fail<ClubEvent>(
        "This isn't a repeating event, so there's no single week to cancel. Delete it instead."
      );
    }

    const skipped = new Set(event.skippedDates ?? []);
    if (skipped.has(day)) skipped.delete(day);
    else skipped.add(day);
    // Sorted so the stored list, the UI and the EXDATE line all read the same
    // way — an unordered array here would make a diff look like a change.
    event.skippedDates = [...skipped].sort();

    return ok(event);
  });
}

export async function deleteEvent(eventId: string): Promise<Result<null>> {
  return guarded((store) => {
    if (!store.events.some((e) => e.id === eventId)) {
      return fail<null>("That event no longer exists.");
    }
    store.events = store.events.filter((e) => e.id !== eventId);
    return ok(null);
  });
}

/**
 * Say you're coming, or that you're not.
 *
 * Not an RSVP in the tracked sense — nothing chases you, nothing reports on
 * who accepted. It's so the people already on a session can see who else is
 * turning up, which is the whole reason a third person joining is useful.
 *
 * Closed events (a 1:1) can't be joined: the two people in it are the event.
 */
export async function setEventAttendance(input: {
  eventId: string;
  memberId: string;
  attending: boolean;
}): Promise<Result<ClubEvent>> {
  return guarded((store) => {
    const event = store.events.find((e) => e.id === input.eventId);
    if (!event) return fail<ClubEvent>("That event no longer exists.");

    if (input.attending) {
      if (!event.isOpen) {
        return fail<ClubEvent>("That one isn't open to drop in on.");
      }
      if (!event.attendeeIds.includes(input.memberId)) {
        event.attendeeIds = [...event.attendeeIds, input.memberId];
      }
    } else {
      if (event.createdBy === input.memberId) {
        // Otherwise a session ends up with nobody running it and stays on the
        // calendar looking like it's still happening.
        return fail<ClubEvent>(
          "You organised this — cancel it instead of stepping out."
        );
      }
      event.attendeeIds = event.attendeeIds.filter(
        (id) => id !== input.memberId
      );
    }

    return ok(event);
  });
}

// ---------------------------------------------------------------------------
// Trainings and facility access
// ---------------------------------------------------------------------------

/** Add `months` to an ISO date, clamped to the end of the target month. */
function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 Jan + 1 month has no 31 Feb. Clamp rather than roll into March, which
  // would quietly hand somebody three extra days of clearance.
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/**
 * A member says they've completed a training, or need site access.
 *
 * Creates the row in `requested`. **Nobody self-verifies** — that's enforced
 * in `verifyCertification` below as well as in `can.verifyTraining`, because
 * this is a safety record and one check is not enough.
 */
export async function requestCertification(input: {
  memberId: string;
  itemId: string;
  completedAt: string;
  certificateUrl?: string;
  today: string;
}): Promise<Result<MemberCertification>> {
  if (input.completedAt > input.today) {
    return fail<MemberCertification>("That date is in the future.");
  }

  return guarded((store) => {
    const item = store.catalogueItems.find((i) => i.id === input.itemId);
    if (!item)
      return fail<MemberCertification>("That training no longer exists.");
    if (!item.isActive) {
      return fail<MemberCertification>(
        `${item.name} has been retired — you don't need it any more.`
      );
    }

    const existing = store.certifications.find(
      (c) => c.memberId === input.memberId && c.itemId === input.itemId
    );

    if (existing) {
      if (existing.status === "verified") {
        return fail<MemberCertification>(
          `You're already cleared on ${item.name}.`
        );
      }
      if (existing.status === "requested") {
        return fail<MemberCertification>(
          `You've already asked — ${item.name} is waiting on your Lead.`
        );
      }

      // Expired or rejected: reuse the row rather than adding a second one.
      // A unique index on (member_id, item_id) enforces the same thing in SQL,
      // and re-requesting after a rejection is the normal path — you did the
      // training properly the second time.
      existing.status = "requested";
      existing.completedAt = input.completedAt;
      existing.certificateUrl = input.certificateUrl?.trim() || undefined;
      existing.requestedAt = input.today;
      existing.verifiedById = undefined;
      existing.verifiedAt = undefined;
      existing.expiresAt = undefined;
      existing.note = undefined;
      return ok(existing);
    }

    const record: MemberCertification = {
      id: newId("cert"),
      memberId: input.memberId,
      itemId: input.itemId,
      status: "requested",
      completedAt: input.completedAt,
      certificateUrl: input.certificateUrl?.trim() || undefined,
      requestedAt: input.today,
    };

    store.certifications.push(record);
    return ok(record);
  });
}

/**
 * A Lead or Co-Lead confirms it.
 *
 * `expiresAt` is computed here from the item's `validityMonths`, not accepted
 * from the caller: the expiry of a safety clearance is a property of the
 * training, not something the verifier types in.
 */
export async function verifyCertification(input: {
  certificationId: string;
  verifierId: string;
  /**
   * Whether the verifier is a Co-Lead, and may therefore sign off their own.
   *
   * Set by the action from `isCoLead`, because operations deliberately can't
   * see the org graph. Defaults to false, so a caller that forgets it gets the
   * strict rule rather than the permissive one.
   */
  allowSelf?: boolean;
  today: string;
}): Promise<Result<MemberCertification>> {
  return guarded((store) => {
    const record = store.certifications.find(
      (c) => c.id === input.certificationId
    );
    if (!record)
      return fail<MemberCertification>("That request no longer exists.");

    /*
      The second of the two checks — `can.verifyTraining` is the first. This is
      the record that decides whether somebody is allowed near a machine, so it
      doesn't rely on one layer.

      The Co-Lead exception exists because a Co-Lead has nobody above them: a
      blanket "nobody self-verifies" meant their own record could never be
      completed, which is a dead end that quietly teaches them to stop
      recording trainings. Marked as self-verified in the UI rather than
      hidden, so the weaker guarantee is visible instead of implied.
    */
    if (record.memberId === input.verifierId && !input.allowSelf) {
      return fail<MemberCertification>(
        "You can't verify your own training — ask your Lead."
      );
    }

    const item = store.catalogueItems.find((i) => i.id === record.itemId);

    record.status = "verified";
    record.verifiedById = input.verifierId;
    record.verifiedAt = input.today;
    record.note = undefined;
    record.expiresAt = item?.validityMonths
      ? addMonths(record.completedAt, item.validityMonths)
      : undefined;

    return ok(record);
  });
}

/** Turn one down, with a reason. */
export async function rejectCertification(input: {
  certificationId: string;
  verifierId: string;
  note?: string;
}): Promise<Result<MemberCertification>> {
  return guarded((store) => {
    const record = store.certifications.find(
      (c) => c.id === input.certificationId
    );
    if (!record)
      return fail<MemberCertification>("That request no longer exists.");
    if (record.memberId === input.verifierId) {
      return fail<MemberCertification>("You can't decide your own request.");
    }

    record.status = "rejected";
    record.verifiedById = input.verifierId;
    record.note = input.note?.trim() || undefined;
    record.expiresAt = undefined;
    return ok(record);
  });
}

/**
 * Withdraw a clearance somebody shouldn't have any more.
 *
 * Separate from rejecting: this is for a verified record going away — the
 * machine changed, the training lapsed in practice, somebody was cleared in
 * error. It becomes `expired` rather than being deleted, so the history of who
 * was cleared when survives.
 */
export async function revokeCertification(input: {
  certificationId: string;
  verifierId: string;
  note?: string;
  today: string;
}): Promise<Result<MemberCertification>> {
  return guarded((store) => {
    const record = store.certifications.find(
      (c) => c.id === input.certificationId
    );
    if (!record)
      return fail<MemberCertification>("That record no longer exists.");

    record.status = "expired";
    record.expiresAt = input.today;
    record.note = input.note?.trim() || undefined;
    record.verifiedById = input.verifierId;
    return ok(record);
  });
}

/**
 * Expire everything past its date.
 *
 * Anish's rule: *"no trainings have an expiration yet, but if there is, the
 * training should be cancelled and the lead notified."* So expiry isn't a
 * display filter — the record is genuinely cancelled, because a lapsed
 * clearance that still reads as valid is the one failure here that gets
 * somebody hurt.
 *
 * The "lead notified" half is in-app, per the standing decision that only join
 * requests and escalations send email: an expired clearance surfaces in the
 * Lead's dashboard exception feed. Returns the affected records so a caller
 * can say what changed.
 *
 * Idempotent — safe to run on every page load, which is how it runs today
 * rather than on a cron nobody has set up yet.
 */
export async function expireLapsedCertifications(
  today: string
): Promise<Result<MemberCertification[]>> {
  return guarded((store) => {
    const lapsed = store.certifications.filter(
      (c) => c.status === "verified" && c.expiresAt && c.expiresAt < today
    );
    for (const record of lapsed) record.status = "expired";
    return ok(lapsed);
  });
}

// --- the catalogue itself, Co-Lead editable --------------------------------

export async function createTrainingSection(input: {
  name: string;
}): Promise<Result<TrainingSection>> {
  const name = input.name.trim();
  if (!name) return fail<TrainingSection>("Give the site a name.");

  return guarded((store) => {
    if (
      store.trainingSections.some(
        (s) => s.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      return fail<TrainingSection>(
        `There's already a section called "${name}".`
      );
    }

    const section: TrainingSection = {
      id: newId("section"),
      name,
      // Before "Misc", which sits at 99 and should stay last.
      sortOrder:
        Math.max(
          0,
          ...store.trainingSections
            .filter((s) => s.sortOrder < 99)
            .map((s) => s.sortOrder)
        ) + 1,
    };

    store.trainingSections.push(section);
    return ok(section);
  });
}

export async function createCatalogueItem(input: {
  sectionId: string;
  name: string;
  kind: CatalogueItemKind;
  validityMonths?: number;
}): Promise<Result<CatalogueItem>> {
  const name = input.name.trim();
  if (!name) return fail<CatalogueItem>("Give it a name.");
  if (
    input.validityMonths !== undefined &&
    (!Number.isInteger(input.validityMonths) || input.validityMonths < 1)
  ) {
    return fail<CatalogueItem>("Validity has to be a whole number of months.");
  }

  return guarded((store) => {
    const section = store.trainingSections.find(
      (s) => s.id === input.sectionId
    );
    if (!section) return fail<CatalogueItem>("That section no longer exists.");

    if (
      store.catalogueItems.some(
        (i) =>
          i.sectionId === input.sectionId &&
          i.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      return fail<CatalogueItem>(`${section.name} already has "${name}".`);
    }

    const siblings = store.catalogueItems.filter(
      (i) => i.sectionId === input.sectionId && i.kind === input.kind
    );

    const created: CatalogueItem = {
      id: newId("item"),
      sectionId: input.sectionId,
      name,
      kind: input.kind,
      validityMonths: input.validityMonths,
      // Machines start at 10 so site access always sorts above them.
      sortOrder:
        Math.max(
          input.kind === "machine" ? 9 : -1,
          ...siblings.map((i) => i.sortOrder)
        ) + 1,
      isActive: true,
    };

    store.catalogueItems.push(created);
    return ok(created);
  });
}

export async function updateCatalogueItem(input: {
  itemId: string;
  name: string;
  validityMonths?: number;
}): Promise<Result<CatalogueItem>> {
  const name = input.name.trim();
  if (!name) return fail<CatalogueItem>("Give it a name.");

  return guarded((store) => {
    const item = store.catalogueItems.find((i) => i.id === input.itemId);
    if (!item) return fail<CatalogueItem>("That entry no longer exists.");

    item.name = name;
    item.validityMonths = input.validityMonths;
    return ok(item);
  });
}

/**
 * Retire a catalogue entry rather than deleting it.
 *
 * A machine that leaves the shop still has people who were cleared on it, and
 * deleting the row would erase the record of who those were. Retired entries
 * stop being requestable and drop off the list; existing certifications keep
 * pointing at something with a name.
 */
export async function setCatalogueItemActive(input: {
  itemId: string;
  isActive: boolean;
}): Promise<Result<CatalogueItem>> {
  return guarded((store) => {
    const item = store.catalogueItems.find((i) => i.id === input.itemId);
    if (!item) return fail<CatalogueItem>("That entry no longer exists.");
    item.isActive = input.isActive;
    return ok(item);
  });
}

// ---------------------------------------------------------------------------
// Phase 7 — the PL answers a check-in, section by section
// ---------------------------------------------------------------------------

/**
 * Reply to one project's section of somebody's check-in.
 *
 * **The PL answers, not the Lead.** A Lead marking a check-in read is an
 * obligation about a person; the useful reply to "the vacuum pump seal is
 * leaking" comes from whoever is accountable for that project. A member on
 * three projects needs three different people, not one person guessing at
 * three contexts — which is the whole reason `update_entries` is per-project
 * in the first place.
 *
 * The caller checks `can.manageDeliverables` on the entry's project, so PL
 * authority inherits down the tree and a Division Lead counts too.
 */
export async function respondToUpdateEntry(input: {
  entryId: string;
  responderId: string;
  response: string;
  today: string;
}): Promise<Result<UpdateEntry>> {
  const response = input.response.trim();

  return guarded((store) => {
    for (const update of store.progressUpdates) {
      const entry = update.entries.find((e) => e.id === input.entryId);
      if (!entry) continue;

      if (!update.submittedAt) {
        // Answering a draft would mean replying to something the member hasn't
        // said yet, and the text can still change under the reply.
        return fail<UpdateEntry>("That check-in hasn't been submitted yet.");
      }

      // An empty body clears the response rather than storing "". Lets a PL
      // undo a reply they posted to the wrong section.
      entry.response = response || undefined;
      entry.respondedBy = response ? input.responderId : undefined;
      entry.respondedAt = response ? input.today : undefined;
      return ok(entry);
    }

    return fail<UpdateEntry>("That check-in section no longer exists.");
  });
}

// ---------------------------------------------------------------------------
// Phase 6 — the blocker board
// ---------------------------------------------------------------------------

/**
 * Post an ask.
 *
 * No permission check beyond being signed in, and that's the design: the board
 * exists because membership is PL-controlled, so a member waiting on a join
 * request needs a route to being useful that doesn't depend on one person
 * answering their inbox.
 */
export async function postHelpRequest(input: {
  memberId: string;
  title: string;
  detail?: string;
  projectId?: string;
  today: string;
}): Promise<Result<HelpRequest>> {
  const title = input.title.trim();
  if (!title) return fail<HelpRequest>("Say what you're stuck on.");
  if (title.length > 160) {
    // A title is what people scan on the board. Past a line it stops being
    // scannable, and the detail field is right there.
    return fail<HelpRequest>(
      "Keep the headline to a line — put the rest in the detail."
    );
  }

  return guarded((store) => {
    if (
      input.projectId &&
      !store.projects.some((p) => p.id === input.projectId)
    ) {
      return fail<HelpRequest>("That project no longer exists.");
    }

    const request: HelpRequest = {
      id: newId("help"),
      memberId: input.memberId,
      title,
      detail: input.detail?.trim() || undefined,
      projectId: input.projectId || undefined,
      createdAt: input.today,
      replies: [],
    };

    store.helpRequests.push(request);
    return ok(request);
  });
}

/** Answer somebody's ask. Anyone can — that's the point of the board. */
export async function replyToHelpRequest(input: {
  requestId: string;
  memberId: string;
  body: string;
  today: string;
}): Promise<Result<HelpReply>> {
  const body = input.body.trim();
  if (!body) return fail<HelpReply>("Write something first.");

  return guarded((store) => {
    const request = store.helpRequests.find((h) => h.id === input.requestId);
    if (!request) return fail<HelpReply>("That request no longer exists.");
    if (request.resolvedAt) {
      return fail<HelpReply>("That one's already been sorted out.");
    }

    const reply: HelpReply = {
      id: newId("reply"),
      requestId: request.id,
      memberId: input.memberId,
      body,
      createdAt: input.today,
    };

    request.replies.push(reply);
    return ok(reply);
  });
}

/**
 * Mark an ask sorted.
 *
 * Open to whoever unblocked it, not just the asker: often the person who
 * answered knows it's done before the asker comes back to say so. Kept rather
 * than deleted — a resolved ask with a note is the useful half, and it's how
 * the next person with the same problem finds the answer.
 */
export async function resolveHelpRequest(input: {
  requestId: string;
  resolvedById: string;
  note?: string;
  today: string;
}): Promise<Result<HelpRequest>> {
  return guarded((store) => {
    const request = store.helpRequests.find((h) => h.id === input.requestId);
    if (!request) return fail<HelpRequest>("That request no longer exists.");
    if (request.resolvedAt) {
      return fail<HelpRequest>("That one's already marked sorted.");
    }

    request.resolvedAt = input.today;
    request.resolvedById = input.resolvedById;
    request.resolutionNote = input.note?.trim() || undefined;
    return ok(request);
  });
}

/** Reopen one that wasn't actually sorted. */
export async function reopenHelpRequest(
  requestId: string
): Promise<Result<HelpRequest>> {
  return guarded((store) => {
    const request = store.helpRequests.find((h) => h.id === requestId);
    if (!request) return fail<HelpRequest>("That request no longer exists.");

    request.resolvedAt = undefined;
    request.resolvedById = undefined;
    request.resolutionNote = undefined;
    return ok(request);
  });
}

/** Delete your own ask. The caller checks who's allowed. */
export async function deleteHelpRequest(
  requestId: string
): Promise<Result<null>> {
  return guarded((store) => {
    if (!store.helpRequests.some((h) => h.id === requestId)) {
      return fail<null>("That request no longer exists.");
    }
    // Replies go with it — they're `on delete cascade` in SQL, and the store
    // carries them inline, so removing the request removes them either way.
    store.helpRequests = store.helpRequests.filter((h) => h.id !== requestId);
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Phase 5 — the academic calendar
// ---------------------------------------------------------------------------

/**
 * A term, a finals week, a break or summer.
 *
 * This table is the reason the club's contribution data means anything past one
 * quarter. Without it every finals week and winter break silently generates
 * weeks of `missed` check-ins for all 35 members — by autumn the record is
 * noise, and nudges land on students mid-finals, which is the worst possible
 * message at the worst possible moment.
 *
 * `generatesObligations` defaults from `kind` rather than being a free checkbox,
 * because the one that matters is the one a tired Co-Lead would get wrong at
 * 1am: a finals week that still generates check-ins.
 */
function defaultGeneratesObligations(kind: Term["kind"]): boolean {
  return kind === "quarter";
}

/** Overlap is what makes `termFor` ambiguous, so it's refused, not merged. */
function overlappingTerm(
  store: StoreShape,
  startsOn: string,
  endsOn: string,
  ignoreId?: string
): Term | undefined {
  return store.terms.find(
    (t) => t.id !== ignoreId && t.startsOn <= endsOn && startsOn <= t.endsOn
  );
}

function validateTermDates(startsOn: string, endsOn: string): string | null {
  if (!startsOn || !endsOn) return "A term needs a start and an end date.";
  if (endsOn < startsOn) return "The end date is before the start date.";
  return null;
}

export async function createTerm(input: {
  name: string;
  kind: Term["kind"];
  startsOn: string;
  endsOn: string;
  /** Omit to take the sensible default for the kind. */
  generatesObligations?: boolean;
}): Promise<Result<Term>> {
  const name = input.name.trim();
  if (!name) return fail<Term>("Give the term a name.");

  const dateError = validateTermDates(input.startsOn, input.endsOn);
  if (dateError) return fail<Term>(dateError);

  return guarded((store) => {
    const clash = overlappingTerm(store, input.startsOn, input.endsOn);
    if (clash) {
      // `termFor(date)` returns the FIRST match, so two terms covering one day
      // would make "are check-ins due today" depend on array order.
      return fail<Term>(
        `That overlaps ${clash.name} (${clash.startsOn} to ${clash.endsOn}). Terms can't cover the same day.`
      );
    }

    const term: Term = {
      id: newId("term"),
      name,
      kind: input.kind,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      generatesObligations:
        input.generatesObligations ?? defaultGeneratesObligations(input.kind),
    };

    store.terms.push(term);
    return ok(term);
  });
}

export async function updateTerm(input: {
  termId: string;
  name: string;
  kind: Term["kind"];
  startsOn: string;
  endsOn: string;
  generatesObligations?: boolean;
}): Promise<Result<Term>> {
  const name = input.name.trim();
  if (!name) return fail<Term>("Give the term a name.");

  const dateError = validateTermDates(input.startsOn, input.endsOn);
  if (dateError) return fail<Term>(dateError);

  return guarded((store) => {
    const term = store.terms.find((t) => t.id === input.termId);
    if (!term) return fail<Term>("That term no longer exists.");

    const clash = overlappingTerm(store, input.startsOn, input.endsOn, term.id);
    if (clash) {
      return fail<Term>(
        `That overlaps ${clash.name} (${clash.startsOn} to ${clash.endsOn}). Terms can't cover the same day.`
      );
    }

    term.name = name;
    term.kind = input.kind;
    term.startsOn = input.startsOn;
    term.endsOn = input.endsOn;
    term.generatesObligations =
      input.generatesObligations ?? defaultGeneratesObligations(input.kind);
    return ok(term);
  });
}

/**
 * Remove a term.
 *
 * Hard delete, unlike people and projects, and that's deliberate: a term is a
 * date range, not a record of anything anyone did. Nothing references it by id
 * — `termFor` matches on dates — so removing one changes which days count as
 * in-session and destroys no history.
 *
 * Refused for a term covering today, because the immediate effect would be
 * every member's check-in obligation appearing or vanishing under them with no
 * obvious cause.
 */
export async function deleteTerm(
  termId: string,
  today: string
): Promise<Result<null>> {
  return guarded((store) => {
    const term = store.terms.find((t) => t.id === termId);
    if (!term) return fail<null>("That term no longer exists.");

    if (term.startsOn <= today && today <= term.endsOn) {
      return fail<null>(
        `${term.name} covers today. Change its dates instead — deleting it would move everyone's check-in obligations without warning.`
      );
    }

    store.terms = store.terms.filter((t) => t.id !== termId);
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// Check-in review
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 2 — membership
// ---------------------------------------------------------------------------

/**
 * Ask a PL to be added to a project.
 *
 * This is the operation that makes `/find-work` mean anything. "Email the PL"
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
  // puts two identical rows in the PL's queue, and the PL has to work out
  // whether they're the same person asking twice or a bug.
  const openAsk = joinRequests.find(
    (r) =>
      r.projectId === input.projectId &&
      r.memberId === input.memberId &&
      r.status === "pending"
  );
  if (openAsk) return fail("You've already asked — it's still with the PL.");

  const request: JoinRequest = {
    id: newId("jr"),
    projectId: input.projectId,
    memberId: input.memberId,
    note: input.note?.trim() || undefined,
    status: "pending",
    requestedAt: input.today,
  };

  return guarded((store) => {
    store.joinRequests.push(request);
    return ok(request);
  });
}

/** The PL decides. Accepting adds them; declining must say something. */
export async function decideJoinRequest(input: {
  requestId: string;
  decidedById: string;
  accept: boolean;
  responseNote?: string;
  today: string;
}): Promise<Result<JoinRequest>> {
  return guarded((store) => {
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
  return guarded((store) => {
    const request = store.joinRequests.find((r) => r.id === requestId);
    if (!request) return fail<null>("That request no longer exists.");
    if (request.memberId !== memberId)
      return fail<null>("That isn't your request.");
    request.status = "withdrawn";
    return ok(null);
  });
}

/**
 * Follow / unfollow — self-service, unlimited, no obligations.
 *
 * The counterpart to PL-controlled membership: you can't add yourself to the
 * work, but nobody needs permission to pay attention. Following is what stops
 * "membership is controlled" from feeling like "you're shut out".
 */
export async function setFollowing(input: {
  projectId: string;
  memberId: string;
  following: boolean;
  today: string;
}): Promise<Result<null>> {
  return guarded((store) => {
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

    // Never silently drop a committed membership — that's a PL decision, and
    // losing it here would quietly strip someone of their deliverables.
    if (existing && existing.commitment === "committed") {
      return fail<null>(
        "You're a committed member here. Ask the PL to take you off."
      );
    }
    store.projectMemberships = store.projectMemberships.filter(
      (m) => !(m.projectId === input.projectId && m.memberId === input.memberId)
    );
    return ok(null);
  });
}

/** PL removes someone from their project. */
export async function removeProjectMember(input: {
  projectId: string;
  memberId: string;
}): Promise<Result<{ reassigned: number }>> {
  return guarded((store) => {
    // Leaving the project takes the PL role with it, so the same guard applies
    // — otherwise the rule would be trivially bypassable by removing the
    // person rather than the role.
    const stranded = wouldStrandSubProjects(
      store,
      input.projectId,
      input.memberId
    );
    if (stranded) {
      return fail<{ reassigned: number }>(stranded);
    }

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
    // work that nobody knows is unowned. Park them as blocked so the PL has to
    // deal with them, which is exactly who should.
    for (const d of openWork) {
      d.status = "blocked";
      d.blockerNote = OWNER_LEFT_NOTE;
      d.submittedAt = undefined;
    }

    return ok({ reassigned: openWork.length });
  });
}

/**
 * Record that the bot reached this member's Discord.
 *
 * Called only after a real message went through — see `verifyDiscordAction`.
 * There is deliberately no way to set this without a delivery having happened,
 * because a tick that can be granted by asking for it is worth nothing.
 */
export async function markDiscordVerified(input: {
  memberId: string;
  at: string;
}): Promise<Result<Member>> {
  return guarded((store) => {
    const member = store.members.find((m) => m.id === input.memberId);
    if (!member) return fail<Member>("That member no longer exists.");
    if (!member.discordUserId) {
      return fail<Member>("There's no Discord ID saved to verify.");
    }
    member.discordVerifiedAt = input.at;
    return ok(member);
  });
}

// ---------------------------------------------------------------------------
// Club-wide configuration
// ---------------------------------------------------------------------------

/*
  `updateClubTiers` lived here — it moved the four commitment-tier floors on
  `club_settings` and validated their order, because `commitmentTier` walked the
  rungs highest-first and an out-of-order ladder silently put every member in
  whichever tier sat at the top.

  Deleted with the tiers on 2026-08-14. Worth recording one latent bug it had, in
  case anything like it is ever written against this row again: it built the
  replacement `ClubSettings` from the four numbers and `id` ALONE, so saving the
  tiers wiped `clubName`, `clubDescription` and `discordInviteUrl`. Exactly the
  shape of the `updateTeam` bug in docs/HANDOFF.md section 8. `updateClubIdentity`
  below spreads the existing row; anything new touching `club_settings` must too.
*/

/**
 * Set exactly who is on an event. The organiser's call, not the attendee's.
 *
 * `setEventAttendance` is the OTHER direction — a member adding or removing
 * themselves from something open. This one is for a closed event, where the
 * whole point is that the list is fixed and nobody can put themselves on it:
 * a leadership meeting, a sponsor visit with a headcount, an interview panel.
 *
 * Without it, `isOpen: false` was a dead end. `setEventAttendance` refuses a
 * closed event by design, so once one existed there was no way to change who
 * was on it — the organiser had to cancel and recreate, losing the event.
 *
 * The organiser stays on regardless, same as at creation: an event whose
 * creator isn't on it reads as somebody else's, and nothing else would put
 * them back.
 */
export async function setEventGuestList(input: {
  eventId: string;
  memberIds: string[];
}): Promise<Result<ClubEvent>> {
  return guarded((store) => {
    const event = store.events.find((e) => e.id === input.eventId);
    if (!event) return fail<ClubEvent>("That event no longer exists.");

    const known = new Set(store.members.map((m) => m.id));
    const unknown = input.memberIds.filter((id) => id && !known.has(id));
    if (unknown.length > 0) {
      return fail<ClubEvent>("One of those people is no longer on the roster.");
    }

    event.attendeeIds = [
      ...new Set(
        [event.createdBy, ...input.memberIds].filter((id): id is string =>
          Boolean(id)
        )
      ),
    ];
    return ok(event);
  });
}

/**
 * Rename the club, or reword what it says it does.
 *
 * It used to share this row with `updateClubTiers`, kept separate because
 * renaming is cosmetic and reversible while moving the tier floors changed how
 * every member was described. The tiers are gone; this is now the only writer.
 */
export async function updateClubIdentity(input: {
  name: string;
  description: string;
  discordInviteUrl: string;
  actorId: string;
}): Promise<Result<ClubSettings>> {
  const name = input.name.trim();
  if (!name) return fail<ClubSettings>("The club needs a name.");
  if (name.length > 80) {
    return fail<ClubSettings>("That name is too long for the header.");
  }

  /*
    The invite renders as a link in a banner shown to every member, aimed
    squarely at the newest people — the ones most likely to click whatever
    they're told to. So it is restricted to Discord's own two invite hosts:
    a typo is then harmless, and the worst a mistake can do is point at the
    wrong server. Migration 0030 has the same rule as a CHECK, because a
    validation that lives only in the app is one `psql` away from not existing.
  */
  const invite = input.discordInviteUrl.trim();
  if (
    invite &&
    !/^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]+$/.test(
      invite
    )
  ) {
    return fail<ClubSettings>(
      "That doesn't look like a Discord invite. It should start https://discord.gg/ — in Discord, right-click the channel, Invite People, then Edit invite link and set it to never expire."
    );
  }

  return guarded((store) => {
    const row = store.clubSettings[0];
    if (!row) {
      return fail<ClubSettings>(
        "Club settings are missing. Apply migration 0020 before editing them."
      );
    }

    row.clubName = name;
    row.clubDescription = input.description.trim() || undefined;
    row.discordInviteUrl = invite || undefined;
    row.updatedAt = new Date().toISOString();
    row.updatedBy = input.actorId;
    return ok(row);
  });
}
