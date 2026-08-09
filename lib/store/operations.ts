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

import { mutate, readStore, type StoreShape } from "./disk.ts";
import { DEFAULT_EVENT_IMPORTANCE } from "../types.ts";
import type {
  CatalogueItem,
  CatalogueItemKind,
  ClubEvent,
  Deliverable,
  DeliverableStatus,
  GlobalRole,
  HelpReply,
  HelpRequest,
  JoinRequest,
  Member,
  ClubSettings,
  MemberCertification,
  MemberStatus,
  ProgressUpdate,
  Project,
  Team,
  Term,
  TrainingSection,
  UpdateEntry,
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

/**
 * Set when someone is removed from a project while still owning open work.
 *
 * A sentinel rather than free text, because reassigning has to recognise it and
 * clear it — and must NOT clear a blocker somebody actually wrote.
 */
export const OWNER_LEFT_NOTE = "Owner left the project — needs reassigning.";

/** Sanity ceiling on a single entry. Catches 80 meaning 8.0. */
const MAX_HOURS_PER_ENTRY = 16;

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
      // STRICTLY before. Hours dated the same day as the check-in stay
      // editable: you submit in the afternoon and then do three more hours in
      // the evening, and refusing to record them means the total is wrong in
      // the direction that discourages people. Only days already closed out by
      // a submitted check-in are locked.
      workDate.slice(0, 10) < u.submittedAt.slice(0, 10)
  );
}

export async function logHours(input: {
  memberId: string;
  /**
   * Omit for "misc" — helping on something you aren't committed to.
   *
   * Follows directly from the calendar: somebody sees an open build session,
   * turns up, and works three hours on a project they're not on the roster
   * for. Those hours are real. Refusing them made the honest answer impossible
   * and left logging against the wrong project as the only way through.
   */
  projectId?: string;
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
    return fail(
      `That's over ${MAX_HOURS_PER_ENTRY} hours in one go — is it a typo?`
    );
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
  // of getting it wrong is someone deleting another member's hours.
  if (log.memberId !== memberId) return fail("That isn't your entry.");
  if (hoursAreLocked(memberId, log.workDate)) {
    return fail("Those hours are part of a check-in you've already submitted.");
  }
  void today;

  return guarded((store) => {
    store.workLogs = store.workLogs.filter((w) => w.id !== logId);
    return ok(null);
  });
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

  return guarded((store) => {
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
    return ok(deliverable);
  });
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

/**
 * An RE above says a signed-off deliverable wasn't actually done.
 *
 * ---------------------------------------------------------------------------
 * Why this isn't just `reopenDeliverable`
 * ---------------------------------------------------------------------------
 *
 * `reopenDeliverable` handles a CLAIM being rejected — the owner said done, the
 * RE disagrees, nothing ever counted. This handles an APPROVAL being withdrawn,
 * which is a different and heavier thing:
 *
 *   - It takes a completed deliverable back off somebody's record. Delivered is
 *     the primary contribution signal precisely because it can't be inflated,
 *     so removing one is not a status edit — it's a correction to the club's
 *     history, and it needs a reason attached in writing.
 *   - It contradicts a named person's judgement, not the owner's. That's why
 *     `can.withdrawSignOff` requires authority from ABOVE the project: the RE
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
      authoritative. The RE corrects it in one edit.

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

/** The RE disagrees — send it back with a reason. */
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
   * app shows instead of an email — an RE's contact line, a Lead chasing a
   * check-in. Left to the member's own profile edit, it stayed empty and every
   * contact link silently fell back to email.
   */
  phone?: string;
  globalRole: GlobalRole;
  leadId: string | null;
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
    leadId: input.leadId,
    primaryTeamId: input.primaryTeamId || undefined,
    joinedAt: input.today,
    skills: [],
  };

  return guarded((store) => {
    store.members.push(member);
    // Everyone gets a check-in schedule, or they'd have no obligation and no
    // way to create one from Settings.
    store.updateSchedules.push({
      memberId: member.id,
      weekdays: [2, 5],
      updatesPerWeek: 2,
      dueTime: "23:59",
    });
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
  major?: string;
  classYear?: number;
  photoUrl?: string;
  skills?: string[];
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

    // Demoting a Lead leaves their reports pointing at someone who no longer
    // has authority over them — the reporting chain would still route reviews
    // and escalations to a plain member. Re-point them upward.
    if (member.globalRole !== "member" && input.role === "member") {
      for (const m of store.members) {
        if (m.leadId === member.id) m.leadId = member.leadId;
      }
    }

    member.globalRole = input.role;
    return ok(member);
  });
}

/** Change who someone reports to. */
export async function setMemberLead(input: {
  memberId: string;
  leadId: string | null;
}): Promise<Result<Member>> {
  if (input.memberId === input.leadId) {
    return fail("Nobody reports to themselves.");
  }

  return guarded((store) => {
    const member = store.members.find((m) => m.id === input.memberId);
    if (!member) return fail<Member>("That member no longer exists.");

    if (input.leadId) {
      const lead = store.members.find((m) => m.id === input.leadId);
      if (!lead) return fail<Member>("That lead no longer exists.");

      // Walk up from the proposed lead. If we reach `memberId`, this would
      // close a loop — and every chain walk in the app (leadChain,
      // reportsBelow, auth_is_lead_of) would spin or silently truncate.
      let cursor: string | null = input.leadId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === input.memberId) {
          return fail<Member>(
            "That would create a loop — they already lead that person, directly or further up."
          );
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        cursor = store.members.find((m) => m.id === cursor)?.leadId ?? null;
      }
    }

    member.leadId = input.leadId;
    return ok(member);
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

    member.status = input.status;

    if (input.status !== "active") {
      // Their people would otherwise keep reporting to someone who has left,
      // and their check-ins would pile up unread with nobody accountable.
      for (const m of store.members) {
        if (m.leadId === member.id) m.leadId = member.leadId;
      }
      // Drop obligations rather than leaving them to accrue as missed.
      store.progressUpdates = store.progressUpdates.filter(
        (u) =>
          !(
            u.memberId === member.id &&
            (u.status === "pending" || u.status === "late")
          )
      );
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
    // A project with no accountable person is how work goes quiet. The RE is
    // the whole point of the model.
    return fail("Every project needs a Responsible Engineer.");
  }

  const { projects } = readStore();

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

/** Add someone to a project, as a contributor or an RE. */
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

/** Add or remove RE status on a project. */
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
        "They're the primary RE. Make someone else primary first."
      );
    }

    project.reIds = project.reIds.filter((id) => id !== input.memberId);
    const m = store.projectMemberships.find(
      (x) => x.projectId === input.projectId && x.memberId === input.memberId
    );
    if (m) m.role = "contributor";
    return ok(null);
  });
}

/** Hand the go-to role to a different RE. */
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

// ---------------------------------------------------------------------------
// Writing a check-in
// ---------------------------------------------------------------------------

export interface CheckInEntryInput {
  projectId: string;
  progress: string;
  blockers?: string;
  nextSteps?: string;
  /** Hours on this project for the period, pre-computed from work logs. */
  hours: number;
}

/**
 * The member's own twice-weekly check-in.
 *
 * Finds their open obligation and fills it, rather than always inserting: an
 * update row is generated when it becomes due, and writing a second one would
 * both double-count their reliability and leave the original showing as missed.
 *
 * Empty sections are dropped. Somebody who worked on three projects and has
 * something to say about one shouldn't be forced to type "n/a" twice — and a
 * blank section is worse than no section, because it reads to their Lead as "no
 * progress" rather than "not touched this week".
 */
export async function submitCheckIn(input: {
  memberId: string;
  entries: CheckInEntryInput[];
  generalNote?: string;
  /** Snapshotted onto the row — see `lead_id_at_submission` in 0007. */
  leadId: string | null;
  today: string;
}): Promise<Result<ProgressUpdate>> {
  const written = input.entries.filter((e) => e.progress.trim().length > 0);

  if (written.length === 0 && !input.generalNote?.trim()) {
    return fail(
      "Write at least one line about one project — an empty check-in tells your Lead nothing."
    );
  }

  return guarded((store) => {
    // Their open obligation, oldest first: pending or late, never one already
    // submitted.
    const open = store.progressUpdates
      .filter(
        (u) =>
          u.memberId === input.memberId &&
          (u.status === "pending" || u.status === "late")
      )
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];

    const update: ProgressUpdate = open ?? {
      // No obligation on record — someone checking in ahead of schedule, or
      // mock data without a generated row. Accept it rather than refuse: the
      // whole point is to make writing one easy.
      id: newId("u"),
      memberId: input.memberId,
      dueAt: `${input.today}T23:59`,
      status: "pending",
      entries: [],
      hoursThisPeriod: 0,
    };

    update.entries = written.map((e, i) => ({
      id: newId(`ue${i}`),
      updateId: update.id,
      projectId: e.projectId,
      progress: e.progress.trim(),
      blockers: e.blockers?.trim() || undefined,
      nextSteps: e.nextSteps?.trim() || undefined,
      hours: e.hours,
    }));

    update.generalNote = input.generalNote?.trim() || undefined;
    update.hoursThisPeriod = written.reduce((sum, e) => sum + e.hours, 0);
    update.submittedAt = input.today;
    update.leadIdAtSubmission = input.leadId ?? undefined;

    // On time vs late is decided against the DUE DATE, not against whether the
    // member feels late. Compared as dates so a submission at 23:00 on the due
    // day counts as on time.
    update.status =
      input.today.slice(0, 10) <= update.dueAt.slice(0, 10)
        ? "submitted"
        : "late";

    if (!open) store.progressUpdates.push(update);
    return ok(update);
  });
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
    return ok(null);
  });
}

/**
 * Delete a check-in, and the per-project entries hanging off it.
 *
 * Needed because the club is being set up by hand and test check-ins would
 * otherwise be permanent. Reviewed ones are kept: a Lead acted on it, and the
 * reliability record refers to it.
 */
export async function deleteCheckIn(updateId: string): Promise<Result<null>> {
  return guarded((store) => {
    const update = store.progressUpdates.find((u) => u.id === updateId);
    if (!update) return fail<null>("That check-in no longer exists.");

    if (update.reviewedAt) {
      return fail<null>(
        "Your Lead has already read that one, so it stays on the record."
      );
    }

    store.progressUpdates = store.progressUpdates.filter(
      (u) => u.id !== updateId
    );
    return ok(null);
  });
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
 * The RE's list, so the RE's edit. Retitling and re-dating is the ordinary
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

    deliverable.title = title;
    deliverable.dueDate = input.dueDate || undefined;

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
 * reporting tree: the people accountable for the work above this are the REs of
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
  // they are very often also an RE of a parent project — and a plain dedup
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
        parent's behalf would sign off work their own REs never agreed was
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
      quietly rewriting dates on projects other REs own is how a schedule stops
      being believed.
    */
    const newTarget = input.targetDate || undefined;

    /*
      Only when the date actually MOVES.

      Every save posts the whole form, so an RE renaming a project resends its
      existing date. Validating unconditionally would let one pre-existing
      violation — a pair of dates entered before this rule, or seeded — freeze
      the project: no edit to any field would ever save again, and the error
      would name a date the person hadn't touched. Rules that block unrelated
      work get worked around.
    */
    const targetMoved = newTarget !== project.targetDate;

    if (targetMoved && newTarget && project.parentId) {
      const parent = store.projects.find((p) => p.id === project.parentId);
      if (parent?.targetDate && newTarget > parent.targetDate) {
        return fail<Project>(
          `${parent.name} is due ${parent.targetDate}, so this can't be due ${newTarget}. Move the parent's date first, or bring this one in.`
        );
      }
    }

    if (targetMoved && newTarget) {
      const late = descendantProjects(store, project.id).filter(
        (p) => p.targetDate && p.targetDate > newTarget
      );
      if (late.length > 0) {
        const names = late
          .slice(0, 3)
          .map((p) => `${p.name} (${p.targetDate})`)
          .join(", ");
        const rest = late.length > 3 ? ` and ${late.length - 3} more` : "";
        return fail<Project>(
          `${late.length} sub-project${late.length === 1 ? " is" : "s are"} due after ${newTarget}: ${names}${rest}. Bring ${late.length === 1 ? "it" : "them"} in first — work inside this can't land after it does.`
        );
      }
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
      const when = input.today ?? new Date().toISOString().slice(0, 10);
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
    store.projectNotices = store.projectNotices.filter(
      (n) => n.projectId !== projectId
    );
    store.projects = store.projects.filter((p) => p.id !== projectId);
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
        `${member.fullName} is the primary RE of ${owned.map((p) => p.name).join(", ")}. Hand those over first — a project with no RE is the one state the model can't hold.`
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
    store.updateSchedules = store.updateSchedules.filter(
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
}): Promise<Result<ClubEvent>> {
  const title = input.title.trim();
  if (!title) return fail<ClubEvent>("Give it a name.");
  if (!input.startsAt) return fail<ClubEvent>("When does it start?");
  if (input.endsAt && input.endsAt < input.startsAt) {
    return fail<ClubEvent>("It ends before it starts.");
  }

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
}): Promise<Result<ClubEvent>> {
  const title = input.title.trim();
  if (!title) return fail<ClubEvent>("Give it a name.");
  if (input.endsAt && input.endsAt < input.startsAt) {
    return fail<ClubEvent>("It ends before it starts.");
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
// Phase 7 — the RE answers a check-in, section by section
// ---------------------------------------------------------------------------

/**
 * Reply to one project's section of somebody's check-in.
 *
 * **The RE answers, not the Lead.** A Lead marking a check-in read is an
 * obligation about a person; the useful reply to "the vacuum pump seal is
 * leaking" comes from whoever is accountable for that project. A member on
 * three projects needs three different people, not one person guessing at
 * three contexts — which is the whole reason `update_entries` is per-project
 * in the first place.
 *
 * The caller checks `can.manageDeliverables` on the entry's project, so RE
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

      // An empty body clears the response rather than storing "". Lets an RE
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
 * exists because membership is RE-controlled, so a member waiting on a join
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

export async function setUpdateSchedule(input: {
  memberId: string;
  weekdays: number[];
}): Promise<Result<number[]>> {
  const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);

  // 0 = Sunday through 6 = Saturday, matching `Date.getDay()` and the DB.
  // All seven are allowed: the deadline follows when somebody actually works,
  // and for a student with a full class week that's often the weekend.
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return fail("Pick a real day of the week.");
  }

  return guarded((store) => {
    const existing = store.updateSchedules.find(
      (u) => u.memberId === input.memberId
    );

    if (!existing) {
      store.updateSchedules.push({
        memberId: input.memberId,
        weekdays,
        updatesPerWeek: weekdays.length || 2,
        dueTime: "23:59",
      });
      return ok(weekdays);
    }

    if (weekdays.length !== existing.updatesPerWeek) {
      return fail<number[]>(
        `Pick exactly ${existing.updatesPerWeek} day${existing.updatesPerWeek === 1 ? "" : "s"}.`
      );
    }

    existing.weekdays = weekdays;
    return ok(weekdays);
  });
}

export async function setCheckInPause(input: {
  memberId: string;
  /** ISO date to pause until, or null to resume now. */
  until: string | null;
  today: string;
}): Promise<Result<null>> {
  if (input.until && input.until <= input.today) {
    return fail("Pick a date in the future.");
  }

  return guarded((store) => {
    const schedule = store.updateSchedules.find(
      (s) => s.memberId === input.memberId
    );
    if (!schedule) return fail<null>("You don't have a check-in schedule yet.");

    schedule.pausedUntil = input.until ?? undefined;

    if (input.until) {
      // Clear obligations already sitting open. Leaving them would mean coming
      // back from a pause to a wall of missed check-ins, which is exactly the
      // "record of failure" this is meant to prevent.
      store.progressUpdates = store.progressUpdates.filter(
        (u) =>
          !(
            u.memberId === input.memberId &&
            (u.status === "pending" || u.status === "late")
          )
      );
    }

    return ok(null);
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
  return guarded((store) => {
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

  return guarded((store) => {
    store.joinRequests.push(request);
    return ok(request);
  });
}

/** The RE decides. Accepting adds them; declining must say something. */
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
  return guarded((store) => {
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
      d.blockerNote = OWNER_LEFT_NOTE;
      d.submittedAt = undefined;
    }

    return ok({ reassigned: openWork.length });
  });
}

// ---------------------------------------------------------------------------
// Club-wide configuration
// ---------------------------------------------------------------------------

/**
 * Move the commitment tier floors.
 *
 * Guarded here rather than only by the DB constraint, because the constraint's
 * error message is `violates check constraint "tiers_in_order"` and the person
 * reading it is a Co-Lead who typed 8 into the wrong box.
 *
 * The ordering rule isn't fussiness: `commitmentTier` walks the rungs highest
 * first and returns the first one you clear. Out of order, everybody lands in
 * whichever tier happens to sit at the top of the list, silently, and the
 * published rubric prints a ladder that goes downwards.
 */
export async function updateClubTiers(input: {
  core: number;
  committed: number;
  contributing: number;
  minimum: number;
  actorId: string;
}): Promise<Result<ClubSettings>> {
  const { core, committed, contributing, minimum } = input;

  for (const [name, value] of Object.entries({
    core,
    committed,
    contributing,
    minimum,
  })) {
    if (!Number.isFinite(value) || value < 0 || value > 168) {
      return fail<ClubSettings>(
        `${name} has to be a number of hours between 0 and 168.`
      );
    }
  }

  if (!(core > committed && committed > contributing)) {
    return fail<ClubSettings>(
      "The tiers have to go up: Core above Committed above Contributing. As written, everybody would land in whichever one sits highest."
    );
  }
  if (minimum > core || minimum < contributing) {
    return fail<ClubSettings>(
      "The minimum has to sit inside the range — between Contributing and Core."
    );
  }

  return guarded((store) => {
    const row = store.clubSettings[0];
    const next: ClubSettings = {
      id: row?.id ?? "1",
      coreHours: core,
      committedHours: committed,
      contributingHours: contributing,
      minimumHours: minimum,
      updatedAt: new Date().toISOString(),
      updatedBy: input.actorId,
    };
    store.clubSettings = [next];
    return ok(next);
  });
}
