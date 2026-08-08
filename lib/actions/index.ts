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

import { getViewer } from "@/lib/data/viewer";
import { can, isCoLead } from "@/lib/permissions";
import {
  today,
  getProject,
  hoursOnProjectThisWeek,
  memberProjects,
  projectDeliverables,
} from "@/lib/mock-data";
import * as ops from "@/lib/store/operations";

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

export async function logHoursAction(formData: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const workDate = String(formData.get("workDate") ?? today());
  const hours = Number(formData.get("hours"));
  const description = String(formData.get("description") ?? "");

  if (!can.logOwnHours(viewer.actor, viewer.member.id)) {
    return denied("log hours");
  }
  if (!projectId) return { ok: false, error: "Pick a project." };

  // You can only log against projects you're actually on. Otherwise the hours
  // would appear on an RE's project from someone they've never added, which
  // makes the per-project totals meaningless.
  const mine = memberProjects(viewer.member.id);
  if (!mine.some((m) => m.projectId === projectId)) {
    return {
      ok: false,
      error: "You're not on that project. Ask to join it first.",
    };
  }

  const result = await ops.logHours({
    memberId: viewer.member.id,
    projectId,
    workDate,
    hours,
    description,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, `Logged ${hours} hrs.`);
}

export async function deleteHoursAction(formData: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  const logId = String(formData.get("logId") ?? "");

  const result = await ops.deleteWorkLog(logId, viewer.member.id, today());
  if (result.ok) refresh();
  return toResult(result, "Entry removed.");
}

// ---------------------------------------------------------------------------
// Phase 4 — deliverables
// ---------------------------------------------------------------------------

export async function createDeliverableAction(
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
export async function submitDeliverableAction(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const id = String(formData.get("deliverableId") ?? "");

  const result = await ops.submitDeliverable(id, viewer.member.id, today());
  if (result.ok) refresh();
  return toResult(result, "Sent to your RE for sign-off.");
}

export async function confirmDeliverableAction(
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

export async function reopenDeliverableAction(
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

export async function setDeliverableStatusAction(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const id = String(formData.get("deliverableId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const status = String(formData.get("status") ?? "") as
    | "open"
    | "in_progress"
    | "blocked";
  const blockerNote = String(formData.get("blockerNote") ?? "");

  // The owner can move their own work along; so can an RE. Anyone else can't —
  // otherwise a passer-by could mark someone's work blocked.
  const deliverable = projectDeliverables(projectId).find((d) => d.id === id);
  const isOwner = deliverable?.ownerId === viewer.member.id;
  if (!isOwner && !can.manageDeliverables(viewer.actor, viewer.graph, projectId)) {
    return denied("change this deliverable");
  }

  const result = await ops.setDeliverableStatus(id, status, blockerNote);
  if (result.ok) refresh();
  return toResult(result, "Updated.");
}

// ---------------------------------------------------------------------------
// People — the leadership controls
// ---------------------------------------------------------------------------

export async function inviteMemberAction(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.inviteMember(viewer.actor)) return denied("invite members");

  const globalRole = String(formData.get("globalRole") ?? "member") as
    | "member"
    | "lead"
    | "co_lead";

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
export async function updateProfileAction(
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
      major: String(formData.get("major") ?? ""),
      photoUrl: String(formData.get("photoUrl") ?? ""),
      classYear: yearRaw ? Number(yearRaw) : 0,
      // Comma-separated, because a tag widget is a lot of machinery for a
      // field people touch once. Splitting happens here so the operation takes
      // real data rather than a string it has to parse.
      skills: skillsRaw.split(",").map((s) => s.trim()).filter(Boolean),
    },
  });

  if (result.ok) refresh();
  return toResult(result, "Profile updated.");
}

export async function setGlobalRoleAction(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "") as
    | "member"
    | "lead"
    | "co_lead";

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

export async function setMemberLeadAction(
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

export async function setMemberStatusAction(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");
  const status = String(formData.get("status") ?? "") as
    | "active"
    | "inactive"
    | "alumni";

  if (!can.setMemberStatus(viewer.actor, viewer.graph, memberId)) {
    return denied("change their status");
  }

  const result = await ops.setMemberStatus({ memberId, status });
  if (result.ok) refresh();
  return toResult(result, status === "active" ? "Reactivated." : "Deactivated.");
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProjectAction(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const parentId = String(formData.get("parentId") ?? "") || null;

  if (!can.createProject(viewer.actor, viewer.graph, parentId ?? undefined)) {
    return denied("create projects here");
  }

  const result = await ops.createProject({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    parentId,
    teamId: String(formData.get("teamId") ?? "") || undefined,
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

export async function addProjectMemberAction(
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

  if (result.ok) refresh();
  return toResult(result, asRE ? "Added as an RE." : "Added to the project.");
}

export async function setProjectREAction(
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
export async function submitCheckInAction(
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

  if (result.ok) refresh();
  return toResult(result, "Check-in sent to your Lead.");
}

export async function setPauseAction(formData: FormData): Promise<ActionResult> {
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
    until ? `Paused until ${until}. No missed check-ins will build up.` : "Resumed."
  );
}

// ---------------------------------------------------------------------------
// Check-in review
// ---------------------------------------------------------------------------

export async function markUpdateReviewedAction(
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

export async function requestToJoinAction(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const note = String(formData.get("note") ?? "");

  const project = getProject(projectId);
  if (!project) return { ok: false, error: "That project no longer exists." };
  if (!can.requestToJoin(viewer.actor, project)) {
    return { ok: false, error: "This project isn't taking new people right now." };
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

export async function decideJoinRequestAction(
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

  if (result.ok) refresh();
  return toResult(result, accept ? "Added to the project." : "Declined.");
}

export async function setFollowingAction(
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

export async function removeProjectMemberAction(
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
