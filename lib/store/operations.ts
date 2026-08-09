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
import type {
  Deliverable,
  DeliverableStatus,
  GlobalRole,
  JoinRequest,
  Member,
  MemberStatus,
  ProgressUpdate,
  Project,
  Team,
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
        (m) => m.globalRole === "co_lead" && m.id !== member.id && m.status === "active"
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
        (m) => m.globalRole === "co_lead" && m.id !== member.id && m.status === "active"
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

export async function createProject(input: {
  name: string;
  description?: string;
  parentId: string | null;
  teamId?: string;
  primaryReId: string;
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
  let slug = slugify(name);
  if (projects.some((p) => p.slug === slug) || RESERVED_PROJECT_SLUGS.has(slug)) {
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
    targetDate: input.targetDate || undefined,
    datesOverridden: false,
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
      if (input.responsibility) existing.responsibility = input.responsibility.trim();
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
    if (!deliverable) return fail<Deliverable>("That deliverable no longer exists.");

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

    project.name = name;
    project.description = input.description?.trim() || undefined;
    project.phase = input.phase;
    project.health = input.health;
    project.targetDate = input.targetDate || undefined;
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

export async function setUpdateSchedule(input: {
  memberId: string;
  weekdays: number[];
}): Promise<Result<number[]>> {
  const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);

  if (weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 5)) {
    return fail("Check-in days have to be weekdays.");
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
