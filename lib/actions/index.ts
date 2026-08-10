"use server";

/**
 * ============================================================================
 * Server Actions — the ONLY place permissions are enforced on writes
 * ============================================================================
 *
 * `lib/store/operations.ts` validates data but deliberately checks no
 * permissions: it has no access to the request-scoped org graph. These actions
 * are the layer that does, and they are the only callers.
 *
 * Every action follows the same four steps, in this order:
 *
 *   1. resolve the viewer (never trust an id from the client)
 *   2. check `can.*`
 *   3. call the operation
 *   4. revalidate
 *
 * Step 1 matters more than it looks. A Server Action is a POST endpoint the
 * moment it exists — anyone can call it with any arguments. So no action takes
 * an "actor id" parameter; it always derives identity from the session. The only
 * ids accepted from the caller are the *objects* being acted on, and those are
 * then checked against the viewer's authority.
 *
 * Actions return `ActionResult` rather than throwing. A thrown error in a Server
 * Action surfaces to the user as a generic "something went wrong" — useless when
 * the real answer is "those hours are locked because you already submitted a
 * check-in covering that day".
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/data/viewer";
import { can, isCoLead } from "@/lib/permissions";
import {
  today,
  getEvent,
  getMember,
  getProject,
  helpRequestById,
  hoursOnProjectThisWeek,
  memberProjects,
  projectDeliverables,
} from "@/lib/mock-data";
import * as ops from "@/lib/store/operations";
import type { Project } from "@/lib/types";
import { withRequestStore } from "@/lib/store/request";
import { isThemeChoice, THEME_COOKIE, THEME_COOKIE_MAX_AGE } from "@/lib/theme";
import { after } from "next/server";
import {
  sendDiscordDM,
  discordMessages,
  verifyDiscordDM,
  DISCORD_PROBLEM_MESSAGE,
  DISCORD_TEST_MESSAGE,
} from "@/lib/notify/discord";

/**
 * Fire a Discord DM without making the caller wait for it, or care if it fails.
 *
 * `after()` runs the callback once the response has been sent, which is exactly
 * right here: the database write already committed, so the member's action has
 * succeeded whatever Discord does next. A bare floating promise would be the
 * obvious alternative and is wrong — serverless can freeze the process the
 * moment the response returns, so the fetch would sometimes just never happen.
 *
 * Nothing here can throw into the action. `sendDiscordDM` swallows its own
 * failures, and the try/catch covers the case where `after` itself is
 * unavailable (it isn't, in Next 15, but a notification must never be able to
 * break a save).
 */
function notify(discordUserId: string | undefined, message: string): void {
  if (!discordUserId) return;
  try {
    after(async () => {
      await sendDiscordDM(discordUserId, message);
    });
  } catch {
    // Not worth a log line: the write succeeded and the courtesy didn't.
  }
}

/**
 * Absolute links for those messages.
 *
 * A DM is read on a lock screen with no browser context, so a relative path is
 * useless. `NEXT_PUBLIC_SITE_URL` when set, Vercel's own host otherwise, and
 * localhost in development.
 */
function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");
  return `${base}${path}`;
}

export interface ActionResult {
  ok: boolean;
  /** Shown to the user verbatim, so it has to be a sentence they can act on. */
  error?: string;
  message?: string;
}

function denied(what: string): ActionResult {
  return { ok: false, error: `You don't have permission to ${what}.` };
}

function toResult(
  result: ops.Result<unknown>,
  successMessage: string
): ActionResult {
  return result.ok
    ? { ok: true, message: successMessage }
    : { ok: false, error: result.error };
}

/**
 * Refresh everything.
 *
 * Coarse on purpose: a single hour logged changes My Work, the project page, the
 * member profile, and the dashboard's rollups. Enumerating those paths would be
 * a list that silently goes stale as pages are added, and the cost of
 * over-revalidating a 34-person app is nil.
 */
function refresh() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Phase 3 — hours
// ---------------------------------------------------------------------------

async function logHoursAction$impl(formData: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const workDate = String(formData.get("workDate") ?? today());
  const hours = Number(formData.get("hours"));
  const description = String(formData.get("description") ?? "");

  if (!can.logOwnHours(viewer.actor, viewer.member.id)) {
    return denied("log hours");
  }

  /*
    An empty project is "misc", and that's now a real option rather than a
    validation failure.

    It follows directly from the calendar: somebody sees an open build session,
    turns up, and helps on a project they aren't committed to. They worked
    those hours. Refusing the log because they're not on the roster made the
    honest answer impossible and the dishonest one — logging it against a
    project they ARE on — the only way through.

    The per-project guard below still stands for hours claimed AGAINST a
    project, which is what keeps those totals meaningful.
  */
  if (projectId) {
    const mine = memberProjects(viewer.member.id);
    if (!mine.some((m) => m.projectId === projectId)) {
      return {
        ok: false,
        error:
          "You're not on that project. Log it as misc, or ask to join first.",
      };
    }
  }

  const result = await ops.logHours({
    memberId: viewer.member.id,
    projectId: projectId || undefined,
    workDate,
    hours,
    description,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, `Logged ${hours} hrs.`);
}

async function deleteHoursAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const logId = String(formData.get("logId") ?? "");

  const result = await ops.deleteWorkLog(logId, viewer.member.id, today());
  if (result.ok) refresh();
  return toResult(result, "Entry removed.");
}

// ---------------------------------------------------------------------------
// Phase 4 — deliverables
// ---------------------------------------------------------------------------

async function createDeliverableAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "");

  if (!can.manageDeliverables(viewer.actor, viewer.graph, projectId)) {
    return denied("add deliverables to this project");
  }

  const result = await ops.createDeliverable({
    projectId,
    title,
    ownerId,
    dueDate: dueDate || undefined,
  });

  if (result.ok) refresh();
  return toResult(result, "Deliverable added.");
}

/** The owner says it's finished. Does not complete it — an RE must confirm. */
async function submitDeliverableAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const id = String(formData.get("deliverableId") ?? "");

  const result = await ops.submitDeliverable(id, viewer.member.id, today());
  if (result.ok) refresh();
  return toResult(result, "Sent to your RE for sign-off.");
}

async function confirmDeliverableAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const id = String(formData.get("deliverableId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");

  // Sign-off is what makes work count, so this is the check that keeps the
  // Delivered signal honest. Inherits down the tree: an RE of a parent project
  // can sign off on its children.
  if (!can.manageDeliverables(viewer.actor, viewer.graph, projectId)) {
    return denied("sign off on this project's work");
  }

  const result = await ops.confirmDeliverable(id, viewer.member.id, today());
  if (result.ok) refresh();
  return toResult(result, "Signed off.");
}

async function reopenDeliverableAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const id = String(formData.get("deliverableId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (!can.manageDeliverables(viewer.actor, viewer.graph, projectId)) {
    return denied("send work back on this project");
  }

  const result = await ops.reopenDeliverable(id, reason, today());
  if (result.ok) refresh();
  return toResult(result, "Sent back with your note.");
}

/**
 * Take a sign-off back. Only from ABOVE the project.
 *
 * Separate action from `reopenDeliverableAction` because it is a separate act:
 * that one rejects a claim, this one overturns a colleague's approval and
 * removes completed work from somebody's record. Different permission,
 * different message, and the reason is not optional.
 */
async function withdrawSignOffAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const id = String(formData.get("deliverableId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (!can.withdrawSignOff(viewer.actor, viewer.graph, projectId)) {
    return denied(
      "reject work that's already been signed off here — that needs an RE above this project, or its Division Lead"
    );
  }

  const result = await ops.withdrawSignOff({
    deliverableId: id,
    reason,
    actorId: viewer.member.id,
    today: today(),
  });
  if (result.ok) refresh();
  return toResult(
    result,
    "Sign-off withdrawn. The owner and everyone above the project were told."
  );
}

async function setDeliverableStatusAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const id = String(formData.get("deliverableId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const status = String(formData.get("status") ?? "") as
    "open" | "in_progress" | "blocked";
  const blockerNote = String(formData.get("blockerNote") ?? "");

  // The owner can move their own work along; so can an RE. Anyone else can't —
  // otherwise a passer-by could mark someone's work blocked.
  const deliverable = projectDeliverables(projectId).find((d) => d.id === id);
  const isOwner = deliverable?.ownerId === viewer.member.id;
  if (
    !isOwner &&
    !can.manageDeliverables(viewer.actor, viewer.graph, projectId)
  ) {
    return denied("change this deliverable");
  }

  const result = await ops.setDeliverableStatus(id, status, blockerNote);
  if (result.ok) refresh();
  return toResult(result, "Updated.");
}

// ---------------------------------------------------------------------------
// People — the leadership controls
// ---------------------------------------------------------------------------

async function inviteMemberAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.inviteMember(viewer.actor)) return denied("invite members");

  const globalRole = String(formData.get("globalRole") ?? "member") as
    "member" | "lead" | "co_lead";

  // Inviting somebody straight in as leadership is the same act as promoting
  // them, so it needs the same authority — otherwise a Team Lead could mint a
  // Co-Lead just by using the invite form instead of the role dropdown.
  if (globalRole !== "member" && !isCoLead(viewer.actor)) {
    return {
      ok: false,
      error: "Only a Co-Lead can invite someone as a Lead or Co-Lead.",
    };
  }

  const leadIdRaw = String(formData.get("leadId") ?? "");
  const result = await ops.inviteMember({
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? "") || undefined,
    fullName: String(formData.get("fullName") ?? ""),
    globalRole,
    // Default to the inviter: somebody with no Lead has nobody reading their
    // check-ins, which is the quiet failure this whole model exists to avoid.
    leadId: leadIdRaw || viewer.member.id,
    primaryTeamId: String(formData.get("primaryTeamId") ?? "") || undefined,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, `Invited ${result.ok ? result.value.fullName : ""}.`);
}

/**
 * Update a profile — your own, or anyone's if you're a Co-Lead.
 *
 * `memberId` is accepted from the form but checked against the viewer's
 * authority, never trusted. The narrow `ProfileEdits` shape is what keeps this
 * safe: role, status, reporting line and email simply aren't reachable, so a
 * crafted POST can't promote anybody.
 */
async function updateProfileAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "") || viewer.member.id;

  if (!can.editProfile(viewer.actor, memberId)) {
    return denied("edit this profile");
  }

  const yearRaw = String(formData.get("classYear") ?? "").trim();
  const skillsRaw = String(formData.get("skills") ?? "");

  const result = await ops.updateProfile({
    memberId,
    edits: {
      preferredName: String(formData.get("preferredName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      discordUserId: String(formData.get("discordUserId") ?? ""),
      major: String(formData.get("major") ?? ""),
      photoUrl: String(formData.get("photoUrl") ?? ""),
      classYear: yearRaw ? Number(yearRaw) : 0,
      // Comma-separated, because a tag widget is a lot of machinery for a
      // field people touch once. Splitting happens here so the operation takes
      // real data rather than a string it has to parse.
      skills: skillsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  });

  if (result.ok) refresh();
  return toResult(result, "Profile updated.");
}

async function setGlobalRoleAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "") as
    "member" | "lead" | "co_lead";

  if (!can.setGlobalRole(viewer.actor, memberId)) {
    return denied("change roles");
  }

  const result = await ops.setGlobalRole({ memberId, role });
  if (result.ok) refresh();
  return toResult(result, `Now a ${ROLE_WORD[role]}.`);
}

const ROLE_WORD: Record<string, string> = {
  member: "Member",
  lead: "Team Lead",
  co_lead: "Co-Lead",
};

async function setMemberLeadAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");
  const leadId = String(formData.get("leadId") ?? "") || null;

  if (!can.reassignLead(viewer.actor, viewer.graph, memberId)) {
    return denied("change who they report to");
  }

  const result = await ops.setMemberLead({ memberId, leadId });
  if (result.ok) refresh();
  return toResult(result, "Reporting line updated.");
}

async function deleteMemberAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");

  if (!can.deleteMember(viewer.actor, memberId)) {
    return denied("delete member records");
  }

  const result = await ops.deleteMember({
    memberId,
    // From the session. The operation refuses self-deletion independently, but
    // it can only do that if it's told who is asking.
    actorId: viewer.member.id,
    // Only a Co-Lead reaches here at all, and the history guard is the one
    // they're allowed to override — it exists to stop an accident, not to stop
    // them.
    force: String(formData.get("force") ?? "") === "yes",
  });

  if (result.ok) refresh();
  return toResult(result, "Record deleted.");
}

async function setMemberStatusAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");
  const status = String(formData.get("status") ?? "") as
    "active" | "inactive" | "alumni";

  if (!can.setMemberStatus(viewer.actor, viewer.graph, memberId)) {
    return denied("change their status");
  }

  const result = await ops.setMemberStatus({ memberId, status });
  if (result.ok) refresh();
  return toResult(
    result,
    status === "active" ? "Reactivated." : "Deactivated."
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

async function createProjectAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const parentId = String(formData.get("parentId") ?? "") || null;
  const teamId = String(formData.get("teamId") ?? "") || undefined;

  /*
    Both halves of the target, because they gate differently: under a parent
    project it's RE authority, into a division it's leading that division. The
    form sends exactly one of them.
  */
  if (
    !can.createProject(viewer.actor, viewer.graph, {
      parentProjectId: parentId ?? undefined,
      teamId,
    })
  ) {
    return denied(
      "create projects there — a Lead can only start work in a division they lead"
    );
  }

  const result = await ops.createProject({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    parentId,
    teamId,
    // Default the RE to the creator. Leadership creating a project almost
    // always owns it initially, and a project with no RE is the one state the
    // model can't represent.
    primaryReId: String(formData.get("primaryReId") ?? "") || viewer.member.id,
    targetDate: String(formData.get("targetDate") ?? "") || undefined,
    createdBy: viewer.member.id,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Project created.");
}

async function addProjectMemberAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const asRE = String(formData.get("asRE") ?? "") === "yes";

  // Making someone an RE hands them authority over the whole subtree, so it's
  // gated on `assignRE` rather than the looser `addProjectMember`.
  const allowed = asRE
    ? can.assignRE(viewer.actor, viewer.graph, projectId)
    : can.addProjectMember(viewer.actor, viewer.graph, projectId);
  if (!allowed) return denied("add people to this project");

  const result = await ops.addProjectMember({
    projectId,
    memberId: String(formData.get("memberId") ?? ""),
    asRE,
    responsibility: String(formData.get("responsibility") ?? ""),
    addedBy: viewer.member.id,
    today: today(),
  });

  if (result.ok) {
    refresh();

    // They didn't ask for this and have no reason to be looking, which is
    // exactly the test for whether something is worth pushing out.
    const added = getMember(String(formData.get("memberId") ?? ""));
    const project = getProject(projectId);
    if (added && project) {
      notify(
        added.discordUserId,
        discordMessages.addedToProject({
          projectName: project.name,
          addedBy: viewer.member.preferredName ?? viewer.member.fullName,
          url: appUrl(`/projects/${project.slug}`),
        })
      );
    }
  }
  return toResult(result, asRE ? "Added as an RE." : "Added to the project.");
}

async function setProjectREAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.assignRE(viewer.actor, viewer.graph, projectId)) {
    return denied("change who the REs are");
  }

  const memberId = String(formData.get("memberId") ?? "");
  const mode = String(formData.get("mode") ?? "");

  const result =
    mode === "primary"
      ? await ops.setPrimaryRE({ projectId, memberId })
      : await ops.setProjectRE({
          projectId,
          memberId,
          isRE: mode === "add",
        });

  if (result.ok) refresh();
  return toResult(
    result,
    mode === "primary"
      ? "Now the primary RE."
      : mode === "add"
        ? "Added as an RE."
        : "No longer an RE."
  );
}

// ---------------------------------------------------------------------------
// Writing a check-in
// ---------------------------------------------------------------------------

/**
 * Submit your own twice-weekly check-in.
 *
 * Fields arrive as `progress:<projectId>` etc. so one form can carry a variable
 * number of project sections without the client having to serialise anything.
 *
 * Hours are recomputed HERE from work logs rather than accepted from the form.
 * They're a factual record, not a claim — letting the client post them would
 * make the number editable in a way logging hours deliberately isn't.
 */
async function submitCheckInAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();

  if (!can.submitOwnUpdate(viewer.actor, viewer.member.id)) {
    return denied("submit this check-in");
  }

  const projectIds = formData.getAll("projectId").map(String);
  const entries = projectIds.map((projectId) => ({
    projectId,
    progress: String(formData.get(`progress:${projectId}`) ?? ""),
    blockers: String(formData.get(`blockers:${projectId}`) ?? ""),
    nextSteps: String(formData.get(`nextSteps:${projectId}`) ?? ""),
    hours: hoursOnProjectThisWeek(viewer.member.id, projectId),
  }));

  const result = await ops.submitCheckIn({
    memberId: viewer.member.id,
    entries,
    generalNote: String(formData.get("generalNote") ?? ""),
    leadId: viewer.member.leadId,
    today: today(),
  });

  if (result.ok) {
    refresh();

    /*
      The Lead, not the member.

      This is the one notification with a real deadline attached: an unread
      check-in escalates after three days, and the whole review model rests on
      one named person actually reading it. Everything else the app surfaces
      can wait until somebody opens the site; this can't.
    */
    const lead = viewer.member.leadId
      ? getMember(viewer.member.leadId)
      : undefined;
    if (lead) {
      notify(
        lead.discordUserId,
        discordMessages.checkInSubmitted({
          memberName: viewer.member.preferredName ?? viewer.member.fullName,
          projectCount: entries.filter((e) => e.progress.trim()).length,
          url: appUrl("/dashboard"),
        })
      );
    }
  }
  return toResult(result, "Check-in sent to your Lead.");
}

async function setUpdateScheduleAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();

  if (!can.setOwnSchedule(viewer.actor, viewer.member.id)) {
    return denied("change this schedule");
  }

  const weekdays = String(formData.get("weekdays") ?? "")
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isFinite(d));

  const result = await ops.setUpdateSchedule({
    memberId: viewer.member.id,
    weekdays,
  });

  if (result.ok) refresh();
  return toResult(result, "Check-in days saved.");
}

async function setPauseAction$impl(formData: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  const weeks = Number(formData.get("weeks") ?? 0);

  if (!can.setOwnSchedule(viewer.actor, viewer.member.id)) {
    return denied("change this schedule");
  }

  let until: string | null = null;
  if (weeks > 0) {
    const d = new Date(`${today()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + weeks * 7);
    until = d.toISOString().slice(0, 10);
  }

  const result = await ops.setCheckInPause({
    memberId: viewer.member.id,
    until,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(
    result,
    until
      ? `Paused until ${until}. No missed check-ins will build up.`
      : "Resumed."
  );
}

// ---------------------------------------------------------------------------
// Check-in review
// ---------------------------------------------------------------------------

async function markUpdateReviewedAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const updateId = String(formData.get("updateId") ?? "");
  const authorId = String(formData.get("authorId") ?? "");

  // Lead chain only. REs deliberately cannot mark a personal report read —
  // that's what keeps the obligation on exactly one person and makes the
  // escalation in lib/review.ts mean something.
  if (!can.reviewUpdate(viewer.actor, viewer.graph, authorId)) {
    return denied("review this check-in");
  }

  const result = await ops.markUpdateReviewed({
    updateId,
    reviewedBy: viewer.member.id,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Marked as read.");
}

// ---------------------------------------------------------------------------
// Phase 2 — membership
// ---------------------------------------------------------------------------

async function requestToJoinAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const note = String(formData.get("note") ?? "");

  const project = getProject(projectId);
  if (!project) return { ok: false, error: "That project no longer exists." };
  if (!can.requestToJoin()) {
    return {
      ok: false,
      error: "This project isn't taking new people right now.",
    };
  }

  const result = await ops.requestToJoin({
    projectId,
    memberId: viewer.member.id,
    note,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Asked to join — the RE will see it.");
}

async function decideJoinRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const requestId = String(formData.get("requestId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const accept = String(formData.get("accept") ?? "") === "yes";
  const responseNote = String(formData.get("responseNote") ?? "");

  if (!can.reviewJoinRequest(viewer.actor, viewer.graph, projectId)) {
    return denied("answer requests for this project");
  }

  const result = await ops.decideJoinRequest({
    requestId,
    decidedById: viewer.member.id,
    accept,
    responseNote,
    today: today(),
  });

  if (result.ok) {
    refresh();

    /*
      The one somebody is definitely waiting on.

      A tracked join request exists precisely so an ask isn't an email into the
      void — but until now the answer only appeared if the member happened to
      open My Work. Told either way: a decline with the RE's note is far better
      than silence, and silence is what the whole feature was built to avoid.
    */
    // From the operation's return value, not the form — the request knows who
    // asked, and a client-supplied member id would be a way to redirect
    // somebody else's notification.
    const asker = getMember(result.value.memberId);
    const project = getProject(projectId);
    if (asker && project) {
      notify(
        asker.discordUserId,
        accept
          ? discordMessages.joinRequestApproved({
              projectName: project.name,
              url: appUrl(`/projects/${project.slug}`),
            })
          : discordMessages.joinRequestDeclined({
              projectName: project.name,
              note: responseNote.trim() || undefined,
            })
      );
    }
  }
  return toResult(result, accept ? "Added to the project." : "Declined.");
}

async function setFollowingAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const following = String(formData.get("following") ?? "") === "yes";

  // Following is unconditionally allowed — watching needs nobody's permission.
  if (!can.followProject()) return denied("follow projects");

  const result = await ops.setFollowing({
    projectId,
    memberId: viewer.member.id,
    following,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, following ? "Following." : "Unfollowed.");
}

async function removeProjectMemberAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");

  if (!can.removeProjectMember(viewer.actor, viewer.graph, projectId)) {
    return denied("remove people from this project");
  }

  const result = await ops.removeProjectMember({ projectId, memberId });
  if (result.ok) refresh();

  if (result.ok && result.value.reassigned > 0) {
    return {
      ok: true,
      message: `Removed. ${result.value.reassigned} open ${
        result.value.reassigned === 1 ? "deliverable" : "deliverables"
      } marked blocked for you to reassign.`,
    };
  }
  return toResult(result, "Removed from the project.");
}

async function deleteDeliverableAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const deliverableId = String(formData.get("deliverableId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.deleteDeliverable(viewer.actor, viewer.graph, projectId)) {
    return denied("delete deliverables on this project");
  }

  const result = await ops.deleteDeliverable(deliverableId);
  if (result.ok) refresh();
  return toResult(result, "Deliverable deleted.");
}

async function deleteCheckInAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const updateId = String(formData.get("updateId") ?? "");
  const authorId = String(formData.get("authorId") ?? "");

  if (!can.deleteCheckIn(viewer.actor, authorId)) {
    return denied("delete this check-in");
  }

  const result = await ops.deleteCheckIn(updateId);
  if (result.ok) refresh();
  return toResult(result, "Check-in deleted.");
}

async function setProjectTeamAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const teamId = String(formData.get("teamId") ?? "") || null;

  if (!can.setProjectTeam(viewer.actor, viewer.graph, projectId)) {
    return denied("change which team owns this project");
  }

  const result = await ops.setProjectTeam({ projectId, teamId });
  if (result.ok) refresh();
  return toResult(result, "Owning team set. It shows under that division now.");
}

async function createTeamAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();

  if (!can.manageTeams(viewer.actor)) {
    return denied("create divisions");
  }

  const result = await ops.createTeam({
    name: String(formData.get("name") ?? ""),
    parentId: String(formData.get("parentId") ?? "") || null,
    leadId: String(formData.get("leadId") ?? "") || undefined,
  });

  if (result.ok) refresh();
  return toResult(result, "Created.");
}

async function updateDeliverableAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.editDeliverable(viewer.actor, viewer.graph, projectId)) {
    return denied("edit deliverables on this project");
  }

  const result = await ops.updateDeliverable({
    deliverableId: String(formData.get("deliverableId") ?? ""),
    title: String(formData.get("title") ?? ""),
    ownerId: String(formData.get("ownerId") ?? "") || undefined,
    dueDate: String(formData.get("dueDate") ?? "") || undefined,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Saved.");
}

async function updateProjectAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.manageProject(viewer.actor, viewer.graph, projectId)) {
    return denied("edit this project");
  }

  /*
    Completing is a separate, narrower permission than editing.

    The assigned RE runs the project and may change anything else about it —
    name, dates, health, phase — but declaring it FINISHED is the review step,
    and reviewing your own work isn't reviewing. Checked here rather than in
    `ops.updateProject` because permissions live in `lib/permissions.ts` and the
    store layer deliberately knows nothing about actors.

    Only the crossing INTO complete. An RE reopening their own project needs no
    permission from above: saying something isn't finished is always safe.
  */
  const phase = String(formData.get("phase") ?? "concept") as Project["phase"];
  if (phase === "complete") {
    const current = viewer.graph.getProject(projectId);
    const alreadyComplete = current?.phase === "complete";
    if (
      !alreadyComplete &&
      !can.completeProject(viewer.actor, viewer.graph, projectId)
    ) {
      return {
        ok: false,
        error:
          "Only an RE above this project, or its Division Lead, can mark it complete. You're accountable for finishing it; they're accountable for agreeing it's done. Tell them it's ready.",
      };
    }
  }

  const result = await ops.updateProject({
    projectId,
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? "") || undefined,
    phase,
    health: String(formData.get("health") ?? "on_track") as Project["health"],
    targetDate: String(formData.get("targetDate") ?? "") || undefined,
    openRoles: String(formData.get("openRoles") ?? "") || undefined,
    // From the session, never the form: the notice names who completed the
    // project, and that attribution has to be unforgeable.
    actorId: viewer.member.id,
    today: today(),
  });

  if (result.ok) refresh();

  // Say what the announcement did, rather than letting it happen invisibly.
  // Someone who marks a project complete should know it went somewhere.
  if (result.ok && result.value.phase === "complete") {
    return {
      ok: true,
      message: "Marked complete. Everyone above it was told.",
    };
  }
  return toResult(result, "Project updated.");
}

async function deleteProjectAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.deleteProject(viewer.actor, viewer.graph, projectId)) {
    return denied("delete this project");
  }

  // Only a Co-Lead can override the signed-off-work guard.
  const result = await ops.deleteProject(projectId, isCoLead(viewer.actor));
  if (!result.ok) return toResult(result, "");

  refresh();
  // The page you were on no longer exists, so staying put means a 404 for the
  // thing you just deliberately deleted. Send them where the work is.
  redirect("/projects");
}

async function updateTeamAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTeams(viewer.actor)) return denied("edit divisions");

  const result = await ops.updateTeam({
    teamId: String(formData.get("teamId") ?? ""),
    name: String(formData.get("name") ?? ""),
    parentId: String(formData.get("parentId") ?? "") || null,
    // `has` rather than `get`: a form that omits the field must leave the lead
    // alone, and an empty value in a form that HAS the field must clear it.
    // Collapsing those two cases is what silently wiped Division Leads on
    // rename — the edit form never had the field at all.
    leadId: formData.has("leadId")
      ? String(formData.get("leadId") ?? "") || null
      : undefined,
  });

  if (result.ok) refresh();
  return toResult(result, "Saved.");
}

async function deleteTeamAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTeams(viewer.actor)) return denied("delete divisions");

  const result = await ops.deleteTeam(String(formData.get("teamId") ?? ""));
  if (result.ok) refresh();
  return toResult(result, "Division deleted.");
}

// ---------------------------------------------------------------------------
// Phase 8 — the calendar
// ---------------------------------------------------------------------------

const EVENT_KINDS = [
  "design_review",
  "company_tour",
  "company_visit",
  "build_session",
  "general_meeting",
  "training",
  "social",
  "competition",
  "one_on_one",
] as const;

function eventKindFrom(formData: FormData): (typeof EVENT_KINDS)[number] {
  const raw = String(formData.get("kind") ?? "");
  return (EVENT_KINDS as readonly string[]).includes(raw)
    ? (raw as (typeof EVENT_KINDS)[number])
    : "build_session";
}

async function createEventAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "") || undefined;

  /*
    A member may schedule a session for a project they're COMMITTED to. Not
    following — watching a project doesn't make you one of the people running
    a build night, and an open session that anybody could invent on any project
    turns the calendar into a noticeboard.
  */
  const isOnProject = projectId
    ? memberProjects(viewer.member.id).some(
        (m) => m.projectId === projectId && m.commitment === "committed"
      )
    : false;

  if (!can.createEvent(viewer.actor, isOnProject)) {
    return projectId
      ? {
          ok: false,
          error:
            "You're not on that project, so you can't run a session for it.",
        }
      : denied("create club-wide events");
  }

  const attendeeIds = formData
    .getAll("attendeeIds")
    .map(String)
    .filter(Boolean);
  const importanceRaw = String(formData.get("importanceWeight") ?? "").trim();

  const result = await ops.createEvent({
    title: String(formData.get("title") ?? ""),
    kind: eventKindFrom(formData),
    startsAt: String(formData.get("startsAt") ?? ""),
    endsAt: String(formData.get("endsAt") ?? "") || undefined,
    location: String(formData.get("location") ?? ""),
    projectId,
    createdBy: viewer.member.id,
    attendeeIds,
    notes: String(formData.get("notes") ?? ""),
    importanceWeight: importanceRaw ? Number(importanceRaw) : undefined,
    /*
      Invite-only, and Co-Lead only.

      Checked against the actor rather than trusted from the form: a Server
      Action is a POST endpoint the moment it exists, so a member could
      otherwise close a session and quietly remove it from the calendar
      everyone else can join. Undefined falls through to `createEvent`'s
      default, which closes 1:1s and opens everything else.
    */
    isOpen: can.createClosedEvent(viewer.actor)
      ? formData.get("inviteOnly") !== "yes"
      : undefined,
  });

  if (result.ok) refresh();
  return toResult(result, "On the calendar.");
}

async function updateEventAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const eventId = String(formData.get("eventId") ?? "");

  const existing = getEvent(eventId);
  if (!existing) return { ok: false, error: "That event no longer exists." };
  if (!can.manageEvent(viewer.actor, existing.createdBy)) {
    return denied("change this event");
  }

  const importanceRaw = String(formData.get("importanceWeight") ?? "").trim();

  /*
    Only Co-Leads may close an event, so a non-Co-Lead's submission leaves
    `isOpen` alone rather than being refused — the field isn't rendered for
    them, and a hand-crafted POST shouldn't be able to shut a session either.
    `undefined` means "don't touch it".
  */
  const isOpen = can.createClosedEvent(viewer.actor)
    ? formData.get("inviteOnly") !== "yes"
    : undefined;

  const result = await ops.updateEvent({
    eventId,
    title: String(formData.get("title") ?? ""),
    kind: eventKindFrom(formData),
    startsAt: String(formData.get("startsAt") ?? ""),
    endsAt: String(formData.get("endsAt") ?? "") || undefined,
    location: String(formData.get("location") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    importanceWeight: importanceRaw ? Number(importanceRaw) : undefined,
    // The form always sends the field, so "" is a deliberate unlink.
    projectId: formData.has("projectId")
      ? String(formData.get("projectId") ?? "") || null
      : undefined,
    isOpen,
  });

  if (result.ok) refresh();
  return toResult(result, "Saved.");
}

async function deleteEventAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const eventId = String(formData.get("eventId") ?? "");

  const existing = getEvent(eventId);
  if (!existing) return { ok: false, error: "That event no longer exists." };
  if (!can.manageEvent(viewer.actor, existing.createdBy)) {
    return denied("cancel this event");
  }

  const result = await ops.deleteEvent(eventId);
  if (result.ok) refresh();
  return toResult(result, "Cancelled.");
}

/**
 * Turn up to something, or stop.
 *
 * No permission gate beyond being signed in: joining an open session is the
 * behaviour the calendar exists to enable, and the operation refuses closed
 * events on its own.
 */
async function setEventAttendanceAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const attending = String(formData.get("attending") ?? "") === "yes";

  const result = await ops.setEventAttendance({
    eventId: String(formData.get("eventId") ?? ""),
    memberId: viewer.member.id,
    attending,
  });

  if (result.ok) refresh();
  return toResult(result, attending ? "See you there." : "Taken off the list.");
}

// ---------------------------------------------------------------------------
// Trainings and facility access
// ---------------------------------------------------------------------------

async function requestCertificationAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.requestTraining(viewer.actor, viewer.member.id)) {
    return denied("request trainings");
  }

  const result = await ops.requestCertification({
    // From the session, never the form. A safety record that could be filed
    // under somebody else's name is worse than no record.
    memberId: viewer.member.id,
    itemId: String(formData.get("itemId") ?? ""),
    completedAt: String(formData.get("completedAt") ?? today()),
    certificateUrl: String(formData.get("certificateUrl") ?? ""),
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Sent to your Lead to verify.");
}

async function verifyCertificationAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const certificationId = String(formData.get("certificationId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");

  if (!can.verifyTraining(viewer.actor, viewer.graph, memberId)) {
    return denied("verify this");
  }

  const result = await ops.verifyCertification({
    certificationId,
    verifierId: viewer.member.id,
    // Only a Co-Lead may sign off their own, because nobody is above them and
    // the alternative is a record they can never complete. See the note on
    // `can.verifyTraining`.
    allowSelf: isCoLead(viewer.actor),
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(
    result,
    result.ok && memberId === viewer.member.id
      ? "Verified — recorded as self-verified, since nobody sits above a Co-Lead."
      : "Verified."
  );
}

async function rejectCertificationAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");

  if (!can.verifyTraining(viewer.actor, viewer.graph, memberId)) {
    return denied("decide this");
  }

  const result = await ops.rejectCertification({
    certificationId: String(formData.get("certificationId") ?? ""),
    verifierId: viewer.member.id,
    note: String(formData.get("note") ?? ""),
  });

  if (result.ok) refresh();
  return toResult(result, "Sent back with your note.");
}

async function revokeCertificationAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");

  if (!can.verifyTraining(viewer.actor, viewer.graph, memberId)) {
    return denied("withdraw this clearance");
  }

  const result = await ops.revokeCertification({
    certificationId: String(formData.get("certificationId") ?? ""),
    verifierId: viewer.member.id,
    note: String(formData.get("note") ?? ""),
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Clearance withdrawn.");
}

async function createTrainingSectionAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTrainingCatalogue(viewer.actor)) {
    return denied("edit the trainings catalogue");
  }

  const result = await ops.createTrainingSection({
    name: String(formData.get("name") ?? ""),
  });

  if (result.ok) refresh();
  return toResult(result, "Section added.");
}

/** Blank means "never expires", which is every item in the club's list today. */
function validityFrom(formData: FormData): number | undefined {
  const raw = String(formData.get("validityMonths") ?? "").trim();
  return raw ? Number(raw) : undefined;
}

async function createCatalogueItemAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTrainingCatalogue(viewer.actor)) {
    return denied("edit the trainings catalogue");
  }

  const kind =
    String(formData.get("kind") ?? "") === "site_access"
      ? "site_access"
      : "machine";

  const result = await ops.createCatalogueItem({
    sectionId: String(formData.get("sectionId") ?? ""),
    name: String(formData.get("name") ?? ""),
    kind,
    validityMonths: validityFrom(formData),
  });

  if (result.ok) refresh();
  return toResult(result, "Added — it's on everyone's list now.");
}

async function updateCatalogueItemAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTrainingCatalogue(viewer.actor)) {
    return denied("edit the trainings catalogue");
  }

  const result = await ops.updateCatalogueItem({
    itemId: String(formData.get("itemId") ?? ""),
    name: String(formData.get("name") ?? ""),
    validityMonths: validityFrom(formData),
  });

  if (result.ok) refresh();
  return toResult(result, "Saved.");
}

async function setCatalogueItemActiveAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTrainingCatalogue(viewer.actor)) {
    return denied("edit the trainings catalogue");
  }

  const isActive = String(formData.get("isActive") ?? "") === "yes";
  const result = await ops.setCatalogueItemActive({
    itemId: String(formData.get("itemId") ?? ""),
    isActive,
  });

  if (result.ok) refresh();
  return toResult(result, isActive ? "Back on the list." : "Retired.");
}

// ---------------------------------------------------------------------------
// Phase 7 — the RE answers a check-in section
// ---------------------------------------------------------------------------

async function respondToUpdateEntryAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const entryId = String(formData.get("entryId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");

  // `manageDeliverables`, so RE authority inherits down the project tree and a
  // Division Lead counts. Deliberately NOT `reviewUpdate` — that's the Lead
  // chain, and this is the other obligation entirely.
  if (!can.manageDeliverables(viewer.actor, viewer.graph, projectId)) {
    return denied("answer this project's section");
  }

  const result = await ops.respondToUpdateEntry({
    entryId,
    responderId: viewer.member.id,
    response: String(formData.get("response") ?? ""),
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Answer sent.");
}

// ---------------------------------------------------------------------------
// Phase 6 — the blocker board
// ---------------------------------------------------------------------------

async function postHelpRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.postHelpRequest()) return denied("post on the blocker board");

  const result = await ops.postHelpRequest({
    memberId: viewer.member.id,
    title: String(formData.get("title") ?? ""),
    detail: String(formData.get("detail") ?? ""),
    projectId: String(formData.get("projectId") ?? "") || undefined,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Posted. Anyone in the club can answer it.");
}

async function replyToHelpRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.replyToHelpRequest()) return denied("answer on the blocker board");

  const result = await ops.replyToHelpRequest({
    requestId: String(formData.get("requestId") ?? ""),
    memberId: viewer.member.id,
    body: String(formData.get("body") ?? ""),
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Answer posted.");
}

/**
 * Resolving needs the ask's own state to decide, so it's read first.
 *
 * The rule is "the asker, whoever replied, or a Co-Lead" — which the action
 * layer can't evaluate from the form alone without trusting it.
 */
async function resolveHelpRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const requestId = String(formData.get("requestId") ?? "");

  const request = helpRequestById(requestId);
  if (!request) return { ok: false, error: "That request no longer exists." };

  if (
    !can.resolveHelpRequest(
      viewer.actor,
      request.memberId,
      request.replies.map((r) => r.memberId)
    )
  ) {
    return denied("close this one");
  }

  const result = await ops.resolveHelpRequest({
    requestId,
    resolvedById: viewer.member.id,
    note: String(formData.get("note") ?? ""),
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Marked sorted.");
}

async function reopenHelpRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const requestId = String(formData.get("requestId") ?? "");

  const request = helpRequestById(requestId);
  if (!request) return { ok: false, error: "That request no longer exists." };

  if (
    !can.resolveHelpRequest(
      viewer.actor,
      request.memberId,
      request.replies.map((r) => r.memberId)
    )
  ) {
    return denied("reopen this one");
  }

  const result = await ops.reopenHelpRequest(requestId);
  if (result.ok) refresh();
  return toResult(result, "Reopened.");
}

async function deleteHelpRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const requestId = String(formData.get("requestId") ?? "");

  const request = helpRequestById(requestId);
  if (!request) return { ok: false, error: "That request no longer exists." };

  if (!can.deleteHelpRequest(viewer.actor, request.memberId)) {
    return denied("delete this one");
  }

  const result = await ops.deleteHelpRequest(requestId);
  if (result.ok) refresh();
  return toResult(result, "Deleted.");
}

// ---------------------------------------------------------------------------
// Phase 5 — the academic calendar
// ---------------------------------------------------------------------------

/**
 * `generatesObligations` arrives as a tri-state from the form.
 *
 * Absent means "use the default for this kind", which is what the create form
 * sends. Present means the Co-Lead deliberately overrode it — a summer term
 * that does generate obligations, say, for a team running over the break.
 */
function obligationOverride(formData: FormData): boolean | undefined {
  if (!formData.has("generatesObligations")) return undefined;
  return String(formData.get("generatesObligations")) === "yes";
}

const TERM_KINDS = ["quarter", "finals", "break", "summer"] as const;

function termKindFrom(formData: FormData): (typeof TERM_KINDS)[number] {
  const raw = String(formData.get("kind") ?? "");
  return (TERM_KINDS as readonly string[]).includes(raw)
    ? (raw as (typeof TERM_KINDS)[number])
    : "quarter";
}

async function createTermAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTerms(viewer.actor))
    return denied("edit the academic calendar");

  const result = await ops.createTerm({
    name: String(formData.get("name") ?? ""),
    kind: termKindFrom(formData),
    startsOn: String(formData.get("startsOn") ?? ""),
    endsOn: String(formData.get("endsOn") ?? ""),
    generatesObligations: obligationOverride(formData),
  });

  if (result.ok) refresh();
  return toResult(result, "Added to the calendar.");
}

async function updateTermAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTerms(viewer.actor))
    return denied("edit the academic calendar");

  const result = await ops.updateTerm({
    termId: String(formData.get("termId") ?? ""),
    name: String(formData.get("name") ?? ""),
    kind: termKindFrom(formData),
    startsOn: String(formData.get("startsOn") ?? ""),
    endsOn: String(formData.get("endsOn") ?? ""),
    generatesObligations: obligationOverride(formData),
  });

  if (result.ok) refresh();
  return toResult(result, "Saved.");
}

async function deleteTermAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTerms(viewer.actor))
    return denied("edit the academic calendar");

  const result = await ops.deleteTerm(
    String(formData.get("termId") ?? ""),
    today()
  );
  if (result.ok) refresh();
  return toResult(result, "Removed from the calendar.");
}

async function archiveTeamAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTeams(viewer.actor)) return denied("archive divisions");

  const result = await ops.archiveTeam({
    teamId: String(formData.get("teamId") ?? ""),
    archivedBy: viewer.member.id,
    note: String(formData.get("note") ?? ""),
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(
    result,
    "Archived. Its projects and history are on the archive page."
  );
}

async function restoreTeamAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTeams(viewer.actor)) return denied("restore divisions");

  const result = await ops.restoreTeam(String(formData.get("teamId") ?? ""));
  if (result.ok) refresh();
  return toResult(result, "Back on the projects page.");
}

/**
 * Take back a join request you sent.
 *
 * `withdrawJoinRequest` has existed in the operations layer since Phase 2 with
 * nothing calling it, so a request sent by mistake sat in an RE's queue
 * permanently — and showed the sender a "Request pending" badge they had no way
 * to clear. Ownership is checked in the operation as well; the id comes from
 * the client, so it can't be the only check.
 */
async function withdrawJoinRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const requestId = String(formData.get("requestId") ?? "");

  const result = await ops.withdrawJoinRequest(requestId, viewer.member.id);
  if (result.ok) refresh();
  return toResult(result, "Request withdrawn.");
}

// ---------------------------------------------------------------------------
// The exported actions
// ---------------------------------------------------------------------------

/**
 * Every action above is wrapped here, and this is not optional.
 *
 * A Server Action does not run inside a React render, so `cache()` — which is
 * what holds the per-request database snapshot — hands back a fresh, empty
 * object on every call there. `getViewer()` would load the whole database into
 * one throwaway holder and the write a moment later would find nothing, which
 * is exactly what "Live store not loaded" meant. Pages were fine because pages
 * render.
 *
 * `withRequestStore` opens a real scope around the whole action, so everything
 * inside it — the viewer, the permission graph, the reads an operation does
 * before writing, and the write itself — sees one snapshot.
 *
 * Wrapping in one block rather than per-function is deliberate: a new action
 * that forgets it is visible here as a missing line, instead of being a bug
 * that only shows up when someone clicks the button in production.
 */

export async function logHoursAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => logHoursAction$impl(formData));
}

export async function deleteHoursAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteHoursAction$impl(formData));
}

export async function createDeliverableAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createDeliverableAction$impl(formData));
}

export async function submitDeliverableAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => submitDeliverableAction$impl(formData));
}

export async function confirmDeliverableAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => confirmDeliverableAction$impl(formData));
}

export async function reopenDeliverableAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => reopenDeliverableAction$impl(formData));
}

export async function withdrawSignOffAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => withdrawSignOffAction$impl(formData));
}

export async function setDeliverableStatusAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setDeliverableStatusAction$impl(formData));
}

export async function inviteMemberAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => inviteMemberAction$impl(formData));
}

export async function updateProfileAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => updateProfileAction$impl(formData));
}

export async function setGlobalRoleAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setGlobalRoleAction$impl(formData));
}

export async function setMemberLeadAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setMemberLeadAction$impl(formData));
}

export async function deleteMemberAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteMemberAction$impl(formData));
}

export async function setMemberStatusAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setMemberStatusAction$impl(formData));
}

export async function createProjectAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createProjectAction$impl(formData));
}

export async function addProjectMemberAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => addProjectMemberAction$impl(formData));
}

export async function setProjectREAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setProjectREAction$impl(formData));
}

export async function submitCheckInAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => submitCheckInAction$impl(formData));
}

export async function setPauseAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setPauseAction$impl(formData));
}

export async function setUpdateScheduleAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setUpdateScheduleAction$impl(formData));
}

export async function markUpdateReviewedAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => markUpdateReviewedAction$impl(formData));
}

export async function requestToJoinAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => requestToJoinAction$impl(formData));
}

export async function decideJoinRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => decideJoinRequestAction$impl(formData));
}

export async function setFollowingAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setFollowingAction$impl(formData));
}

export async function removeProjectMemberAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => removeProjectMemberAction$impl(formData));
}

export async function deleteDeliverableAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteDeliverableAction$impl(formData));
}

export async function deleteCheckInAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteCheckInAction$impl(formData));
}

export async function setProjectTeamAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setProjectTeamAction$impl(formData));
}

export async function createTeamAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createTeamAction$impl(formData));
}

export async function updateDeliverableAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => updateDeliverableAction$impl(formData));
}

export async function updateProjectAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => updateProjectAction$impl(formData));
}

export async function deleteProjectAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteProjectAction$impl(formData));
}

export async function updateTeamAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => updateTeamAction$impl(formData));
}

export async function deleteTeamAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteTeamAction$impl(formData));
}

export async function createEventAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createEventAction$impl(formData));
}

async function updateClubTiersAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();

  // Co-Lead only. This is the definition of the bar the entire club is
  // measured against, so it sits with the other things that reshape the org.
  if (!can.manageEngagementWeights(viewer.actor)) {
    return denied("change the club's commitment expectations");
  }

  const num = (name: string) => Number(formData.get(name));
  const result = await ops.updateClubTiers({
    core: num("core"),
    committed: num("committed"),
    contributing: num("contributing"),
    minimum: num("minimum"),
    actorId: viewer.member.id,
  });

  if (result.ok) refresh();
  return toResult(result, "Expectations updated — /how-we-lead now says so.");
}

async function updateClubIdentityAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();

  // Same gate as the tiers: this is the club's own identity, and it renders on
  // every leadership page.
  if (!can.manageEngagementWeights(viewer.actor)) {
    return denied("rename the club");
  }

  const result = await ops.updateClubIdentity({
    name: String(formData.get("clubName") ?? ""),
    description: String(formData.get("clubDescription") ?? ""),
    actorId: viewer.member.id,
  });

  if (result.ok) refresh();
  return toResult(result, "Saved.");
}

/**
 * Light or dark. Nobody's permission required — it's how one person's screen
 * looks, and it changes nothing anybody else sees.
 *
 * Doesn't go through `withRequestStore` or touch the store at all: there is no
 * data here, only a cookie. `revalidatePath` is what makes the change appear —
 * the class lives on <html>, rendered by the root layout, so the whole tree has
 * to re-render for the new value to take.
 */
/**
 * Prove the member's Discord ID actually reaches them.
 *
 * Sends a real message and only records success if Discord accepted it. There
 * is deliberately no way to get the tick by asking for it: an unverified ID
 * that LOOKS connected is worse than none, because the app and the member both
 * then believe notifications are working when they aren't.
 *
 * Unlike every other Discord call in this file, this one is NOT fire-and-forget
 * — the member is standing there waiting for an answer, so it waits, and it
 * distinguishes the three failures that need three different fixes.
 */
async function verifyDiscordAction$impl(): Promise<ActionResult> {
  const viewer = await getViewer();

  const result = await verifyDiscordDM(
    viewer.member.discordUserId,
    DISCORD_TEST_MESSAGE
  );

  if (!result.ok) {
    return { ok: false, error: DISCORD_PROBLEM_MESSAGE[result.problem] };
  }

  const saved = await ops.markDiscordVerified({
    memberId: viewer.member.id,
    at: new Date().toISOString(),
  });

  if (saved.ok) refresh();
  return toResult(saved, "Connected — check Discord for the test message.");
}

export async function verifyDiscordAction(
  // Unused — it takes no input. The parameter is here so it matches the
  // signature `ActionButton` expects, rather than the button needing a
  // special case for the one action with nothing to send.
  _formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => verifyDiscordAction$impl());
}

export async function setThemeAction(
  formData: FormData
): Promise<ActionResult> {
  const choice = String(formData.get("theme") ?? "");
  if (!isThemeChoice(choice)) {
    return { ok: false, error: "That isn't a theme." };
  }

  (await cookies()).set(THEME_COOKIE, choice, {
    maxAge: THEME_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    // Readable by the server only. Nothing client-side needs it, since the
    // class is rendered rather than applied by script.
    httpOnly: true,
  });

  refresh();
  return {
    ok: true,
    message: choice === "dark" ? "Dark mode on." : "Light mode on.",
  };
}

export async function updateClubIdentityAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => updateClubIdentityAction$impl(formData));
}

export async function updateClubTiersAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => updateClubTiersAction$impl(formData));
}

/**
 * Set who is on an event. The organiser's list, not the attendee's choice.
 *
 * Distinct from `setEventAttendanceAction`, which is a member adding
 * themselves to something open. This is the only way a CLOSED event's list can
 * ever change, since the attendance operation refuses those by design.
 */
async function setEventGuestListAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const eventId = String(formData.get("eventId") ?? "");

  const existing = getEvent(eventId);
  if (!existing) return { ok: false, error: "That event no longer exists." };
  if (!can.manageEventGuestList(viewer.actor, existing.createdBy)) {
    return denied("change who's on this event");
  }

  const result = await ops.setEventGuestList({
    eventId,
    memberIds: formData.getAll("attendeeIds").map(String).filter(Boolean),
  });

  if (result.ok) refresh();
  return toResult(result, "Guest list updated.");
}

export async function setEventGuestListAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setEventGuestListAction$impl(formData));
}

export async function updateEventAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => updateEventAction$impl(formData));
}

export async function deleteEventAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteEventAction$impl(formData));
}

export async function setEventAttendanceAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setEventAttendanceAction$impl(formData));
}

export async function requestCertificationAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => requestCertificationAction$impl(formData));
}

export async function verifyCertificationAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => verifyCertificationAction$impl(formData));
}

export async function rejectCertificationAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => rejectCertificationAction$impl(formData));
}

export async function revokeCertificationAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => revokeCertificationAction$impl(formData));
}

export async function createTrainingSectionAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createTrainingSectionAction$impl(formData));
}

export async function createCatalogueItemAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createCatalogueItemAction$impl(formData));
}

export async function updateCatalogueItemAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => updateCatalogueItemAction$impl(formData));
}

export async function setCatalogueItemActiveAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setCatalogueItemActiveAction$impl(formData));
}

export async function respondToUpdateEntryAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => respondToUpdateEntryAction$impl(formData));
}

export async function postHelpRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => postHelpRequestAction$impl(formData));
}

export async function replyToHelpRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => replyToHelpRequestAction$impl(formData));
}

export async function resolveHelpRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => resolveHelpRequestAction$impl(formData));
}

export async function reopenHelpRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => reopenHelpRequestAction$impl(formData));
}

export async function deleteHelpRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteHelpRequestAction$impl(formData));
}

export async function createTermAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createTermAction$impl(formData));
}

export async function updateTermAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => updateTermAction$impl(formData));
}

export async function deleteTermAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteTermAction$impl(formData));
}

export async function archiveTeamAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => archiveTeamAction$impl(formData));
}

export async function restoreTeamAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => restoreTeamAction$impl(formData));
}

export async function withdrawJoinRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => withdrawJoinRequestAction$impl(formData));
}
