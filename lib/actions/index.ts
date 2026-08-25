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
  catalogueVerifiers,
  mayVerifyItem,
  saveCatalogueVerifier,
} from "@/lib/trainings/verifiers";
import {
  today,
  blockerAudience,
  projectEscalationAudience,
  getEvent,
  getMember,
  getProject,
  helpRequestById,
  memberProjects,
  projectDeliverables,
} from "@/lib/mock-data";
import * as ops from "@/lib/store/operations";
import { ARTIFACT_KIND_ORDER, eventKindOrDefault } from "@/lib/labels";
import { saveMyAdvisorProfile } from "@/lib/advisors/store";
import { saveWorkLogReply } from "@/lib/worklog/replies";
import { normaliseAdvisorProfile } from "@/lib/advisors/profile";
import { checkUpload } from "@/lib/storage";
import { createMyToken, revokeMyToken } from "@/lib/mcp/store";
import { revokeMyFeed, rotateMyFeed } from "@/lib/calendar/store";
import { appUrl } from "@/lib/urls";
import { formatClock, formatDay } from "@/lib/dates";
import {
  removeDocument,
  uploadDocument,
  uploadPhoto,
  type UploadableFile,
} from "@/lib/supabase/storage";
import { GUIDE_PAGES } from "@/lib/types";
import type {
  ArtifactKind,
  Deliverable,
  EventKind,
  GuidePage,
  Project,
} from "@/lib/types";
import { withRequestStore } from "@/lib/store/request";
import { readStore } from "@/lib/store/disk";
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

async function logWorkAction$impl(formData: FormData): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const workDate = String(formData.get("workDate") ?? today());
  const description = String(formData.get("description") ?? "");

  if (!can.logOwnWork(viewer.actor, viewer.member.id)) {
    return denied("log work");
  }

  /*
    An empty project is "misc", and that's now a real option rather than a
    validation failure.

    It follows directly from the calendar: somebody sees an open build session,
    turns up, and helps on a project they aren't committed to. They did that
    work. Refusing the log because they're not on the roster made the honest
    answer impossible and the dishonest one — logging it against a project they
    ARE on — the only way through.

    The per-project guard below still stands for work claimed AGAINST a project,
    which is what keeps a project's diary trustworthy.
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

  const result = await ops.logWork({
    memberId: viewer.member.id,
    projectId: projectId || undefined,
    workDate,
    description,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Logged.");
}

async function deleteWorkAction$impl(
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

/** The owner says it's finished. Does not complete it — a PL must confirm. */
async function submitDeliverableAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const id = String(formData.get("deliverableId") ?? "");

  const result = await ops.submitDeliverable(id, viewer.member.id, today());
  if (result.ok) refresh();
  return toResult(result, "Sent to your PL for sign-off.");
}

async function confirmDeliverableAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const id = String(formData.get("deliverableId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");

  // Sign-off is what makes work count, so this is the check that keeps the
  // Delivered signal honest. Inherits down the tree: a PL of a parent project
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
      "reject work that's already been signed off here — that needs a PL above this project, or its Division Lead"
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

  // The owner can move their own work along; so can a PL. Anyone else can't —
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

  /*
    A blocker is the one thing in the app that stops work and stays invisible
    until somebody happens to look. It went onto the board and the project page
    and nowhere else — `discordMessages.blockerRaised` was written for exactly
    this and called from nothing, so the message existed and reached nobody.

    `blockerAudience` decides who: the project's PLs, minus whoever raised it,
    climbing one level if that empties the list. That last part is the rule that
    matters — a PL blocked on their own deliverable would otherwise be DMed
    about their own blocker, and the case that most needs escalating would be
    the only one nobody heard about.
  */
  if (result.ok && status === "blocked" && deliverable) {
    notifyBlocked({
      projectId,
      raiserId: viewer.member.id,
      raiserName: viewer.member.preferredName ?? viewer.member.fullName,
      what: deliverable.title,
      note: blockerNote,
    });
  }

  return toResult(result, "Updated.");
}

/**
 * DM everyone a blocker concerns. Fire-and-forget, like every other notify.
 *
 * `what` names the deliverable, or the project itself when the whole thing is
 * blocked. The message carries the project name either way, because a DM
 * arrives with no context around it.
 *
 * ---------------------------------------------------------------------------
 * Three audiences, three different messages, nobody gets two
 * ---------------------------------------------------------------------------
 *
 *   1. WHO CLEARS IT — `blockerAudience`. The project's PLs, minus the raiser,
 *      climbing one level if that empties the list. Unchanged, and still the
 *      only group asked to *do* something. Telling five people to fix one
 *      thing produces the bystander effect, which is why this list stays short.
 *
 *   2. WHO OWNS THE WORK ABOVE — `projectEscalationAudience`, and only when a
 *      whole PROJECT is blocked. A stopped project changes what the person
 *      above promised, so they hear about it even if the project still has
 *      other PLs who could clear it. A single blocked deliverable does not
 *      earn this.
 *
 * There was a third — WHO LOOKS AFTER THE PERSON, one step up the reporting
 * tree, told as awareness rather than a task. It went on 2026-08-25, later than
 * the rest of the reporting removal because the notification layer was never
 * audited: it read `profiles.lead_id`, which nothing writes any more, so it
 * either sent nothing or DMed somebody holding a stale pointer and no role in
 * the blocker.
 *
 * Nothing replaced it, deliberately. Both groups above are "you can act on
 * this". A recipient told purely for awareness is how a bot starts producing
 * messages people skim — and once they skim one, they skim the blocker alerts
 * too.
 *
 * The `sent` set keeps the remaining two exclusive: somebody who is both a PL of
 * the project and a PL above it gets the more actionable message once, not two
 * DMs about the same event.
 */
function notifyBlocked(input: {
  projectId: string;
  raiserId: string;
  raiserName: string;
  what: string;
  note: string;
  /** True when the project itself is blocked, not one deliverable on it. */
  wholeProject?: boolean;
}): void {
  const project = getProject(input.projectId);
  if (!project) return;

  const url = appUrl(`/projects/${project.slug}`);
  const sent = new Set<string>([input.raiserId]);

  const send = (recipientId: string, content: string) => {
    if (sent.has(recipientId)) return;
    sent.add(recipientId);
    notify(getMember(recipientId)?.discordUserId, content);
  };

  // 1. The people who can actually clear it.
  for (const id of blockerAudience(input.projectId, input.raiserId)) {
    send(
      id,
      discordMessages.blockerRaised({
        memberName: input.raiserName,
        projectName:
          input.what === project.name
            ? project.name
            : `${input.what} (${project.name})`,
        note: input.note,
        url,
      })
    );
  }

  // 2. Accountable for the work this sits inside — projects only.
  if (input.wholeProject) {
    const parent = project.parentId ? getProject(project.parentId) : undefined;
    for (const id of projectEscalationAudience(
      input.projectId,
      input.raiserId
    )) {
      send(
        id,
        discordMessages.projectBlockedAbove({
          memberName: input.raiserName,
          projectName: project.name,
          parentName: parent?.name,
          url,
        })
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Checklists under a deliverable
//
// All four share one permission question, asked by `todoGate` below: are you
// the deliverable's owner, a PL of or above its project, or a Co-Lead? Wider
// than the deliverable itself, and `can.manageDeliverableTodos` explains why.
// ---------------------------------------------------------------------------

/**
 * Resolve the parent deliverable and check the caller may touch its checklist.
 *
 * Returns the deliverable on success and an `ActionResult` on refusal, so each
 * action is three lines instead of ten copies of the same lookup. The project
 * id comes off the form, but the OWNER is read from the stored row rather than
 * trusted from the client — the whole point of the wider rule is that being the
 * owner grants a right, so accepting the caller's word for it would hand that
 * right to anybody who can edit a hidden input.
 */
async function todoGate(
  formData: FormData,
  what: string
): Promise<{ deliverable: Deliverable } | { refusal: ActionResult }> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");
  const deliverableId = String(formData.get("deliverableId") ?? "");

  const deliverable = projectDeliverables(projectId).find(
    (d) => d.id === deliverableId
  );
  if (!deliverable) {
    return {
      refusal: { ok: false, error: "That deliverable no longer exists." },
    };
  }

  if (
    !can.manageDeliverableTodos(
      viewer.actor,
      viewer.graph,
      projectId,
      deliverable.ownerId
    )
  ) {
    return { refusal: denied(what) };
  }

  return { deliverable };
}

async function addDeliverableTodoAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const gate = await todoGate(formData, "add to this checklist");
  if ("refusal" in gate) return gate.refusal;

  const viewer = await getViewer();
  const result = await ops.addDeliverableTodo({
    deliverableId: gate.deliverable.id,
    title: String(formData.get("title") ?? ""),
    actorId: viewer.member.id,
  });

  if (result.ok) refresh();
  return toResult(result, "Added.");
}

async function setDeliverableTodoDoneAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const gate = await todoGate(formData, "tick items off this checklist");
  if ("refusal" in gate) return gate.refusal;

  const viewer = await getViewer();
  const result = await ops.setDeliverableTodoDone({
    todoId: String(formData.get("todoId") ?? ""),
    done: String(formData.get("done") ?? "") === "true",
    actorId: viewer.member.id,
    now: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Updated.");
}

async function renameDeliverableTodoAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const gate = await todoGate(formData, "edit this checklist");
  if ("refusal" in gate) return gate.refusal;

  const result = await ops.renameDeliverableTodo({
    todoId: String(formData.get("todoId") ?? ""),
    title: String(formData.get("title") ?? ""),
  });

  if (result.ok) refresh();
  return toResult(result, "Renamed.");
}

async function deleteDeliverableTodoAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const gate = await todoGate(formData, "remove items from this checklist");
  if ("refusal" in gate) return gate.refusal;

  const result = await ops.deleteDeliverableTodo(
    String(formData.get("todoId") ?? "")
  );

  if (result.ok) refresh();
  return toResult(result, "Removed.");
}

// ---------------------------------------------------------------------------
// Asking a Lead for something
// ---------------------------------------------------------------------------

async function createMemberRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const leadId = String(formData.get("leadId") ?? "");

  /*
    The recipient must be leadership, checked here and not only in the UI.

    The button only renders on a Lead's profile, but a profile id is trivially
    guessable — "the button isn't there" is a convention, not a rule. An
    advisor in particular must be excluded: they hold no authority, so a
    request addressed to one could never be answered and would sit in a queue
    on a dashboard they cannot reach.
  */
  const recipient = viewer.graph.getMember(leadId);
  if (!recipient) return { ok: false, error: "That person no longer exists." };
  if (
    !can.requestFromLead(viewer.actor, {
      id: recipient.id,
      globalRole: recipient.globalRole,
    })
  ) {
    return {
      ok: false,
      error:
        "You can only send a request to a Lead or a Co-Lead — and not to yourself.",
    };
  }

  const result = await ops.createMemberRequest({
    memberId: viewer.member.id,
    leadId,
    body: String(formData.get("body") ?? ""),
    now: new Date().toISOString(),
  });

  if (result.ok) {
    refresh();
    // Straight to the one person who has to act. This is the whole reason the
    // request names somebody instead of going to a shared queue.
    notify(
      recipient.discordUserId,
      discordMessages.requestReceived({
        memberName: viewer.member.preferredName ?? viewer.member.fullName,
        body: result.value.body,
        url: appUrl("/dashboard"),
      })
    );
  }
  return toResult(
    result,
    `Sent to ${recipient.preferredName ?? recipient.fullName}.`
  );
}

async function answerMemberRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const requestId = String(formData.get("requestId") ?? "");
  const status = String(formData.get("status") ?? "") as "granted" | "declined";

  const existing = readStore().memberRequests.find((r) => r.id === requestId);
  if (!existing) return { ok: false, error: "That request no longer exists." };

  if (!can.answerMemberRequest(viewer.actor, existing.leadId)) {
    return denied("answer this request — it was addressed to somebody else");
  }

  const result = await ops.answerMemberRequest({
    requestId,
    status,
    response: String(formData.get("response") ?? ""),
    responderId: viewer.member.id,
    now: new Date().toISOString(),
  });

  if (result.ok) {
    refresh();
    notify(
      getMember(existing.memberId)?.discordUserId,
      discordMessages.requestAnswered({
        granted: status === "granted",
        answeredBy: viewer.member.preferredName ?? viewer.member.fullName,
        body: existing.body,
        response: result.value.response,
      })
    );
  }
  return toResult(result, status === "granted" ? "Granted." : "Declined.");
}

async function withdrawMemberRequestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  // Ownership lives in the operation, which is the layer holding the row.
  const result = await ops.withdrawMemberRequest({
    requestId: String(formData.get("requestId") ?? ""),
    memberId: viewer.member.id,
  });

  if (result.ok) refresh();
  return toResult(result, "Withdrawn.");
}

// ---------------------------------------------------------------------------
// Advisors named on a project
// ---------------------------------------------------------------------------

async function addProjectAdvisorAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.manageProjectAdvisors(viewer.actor, viewer.graph, projectId)) {
    return denied("name an advisor on this project");
  }

  const result = await ops.addProjectAdvisor({
    projectId,
    memberId: String(formData.get("memberId") ?? ""),
    actorId: viewer.member.id,
    now: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Advisor added.");
}

async function removeProjectAdvisorAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.manageProjectAdvisors(viewer.actor, viewer.graph, projectId)) {
    return denied("change this project's advisors");
  }

  const result = await ops.removeProjectAdvisor({
    projectId,
    memberId: String(formData.get("memberId") ?? ""),
  });

  if (result.ok) refresh();
  return toResult(result, "Removed.");
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

  /*
    Inviting somebody straight in as anything other than a member is the same
    act as promoting them, so it needs the same authority — otherwise a Team
    Lead could mint a Co-Lead by using the invite form instead of the role
    dropdown.

    `!== "member"` is right here and stays: it covers `advisor` too, which is
    what we want. An advisor holds no authority but does get a standing seat at
    the club's entire record, and that is a Co-Lead's call.
  */
  if (globalRole !== "member" && !isCoLead(viewer.actor)) {
    return {
      ok: false,
      error:
        "Only a Co-Lead can invite someone as an Advisor, a Lead or a Co-Lead.",
    };
  }

  const result = await ops.inviteMember({
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? "") || undefined,
    fullName: String(formData.get("fullName") ?? ""),
    globalRole,
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

  /*
    A photo is either uploaded or linked, and an upload wins if both arrive.

    Only for your OWN profile. The `avatars` storage policies compare the
    folder to `auth.uid()`, so a Co-Lead editing someone else's profile would
    be refused by Postgres anyway — this just says why, instead of surfacing
    "new row violates row-level security policy". Changing another member's
    photo isn't an administrative need; it's an impersonation vector.
  */
  let photoUrl = String(formData.get("photoUrl") ?? "");
  const photo = formData.get("photo");

  if (isUploadableFile(photo) && photo.size > 0) {
    if (memberId !== viewer.member.id) {
      return {
        ok: false,
        error: "You can only upload a photo to your own profile.",
      };
    }

    const problem = checkUpload(photo, "photo");
    if (problem) return { ok: false, error: problem.reason };

    const upload = await uploadPhoto(viewer.member.id, photo);
    if (!upload.ok) return { ok: false, error: upload.error };
    photoUrl = upload.value;
  }

  const result = await ops.updateProfile({
    memberId,
    edits: {
      preferredName: String(formData.get("preferredName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      discordUserId: String(formData.get("discordUserId") ?? ""),
      major: String(formData.get("major") ?? ""),
      photoUrl,
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

/*
  Letting somebody into the club for the first time. Its own action, and that
  split is the point.

  This used to be one action with `setMemberStatus`, which guessed which act it
  was from the row: "no Lead yet and they have signed in" meant admission, and
  admission was open to every Lead while a status change was not. The chain went
  on 2026-08-24, so `leadId` is no longer written and the heuristic no longer
  has anything to read.

  Guessing intent from data shape was the fragile part, not the field it read.
  The two acts arrive from two different controls — the roster's Access panel
  and the member admin card — so each gets its own action and its own rule.
  Admitting is open to any Lead (`can.admitMember`); deactivating is Co-Lead
  only (`can.setMemberStatus`).
*/
async function admitMemberAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");

  if (!can.admitMember(viewer.actor, memberId)) {
    return denied("admit members");
  }

  const result = await ops.setMemberStatus({ memberId, status: "active" });
  if (result.ok) refresh();
  return toResult(result, "They're in.");
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
    project it's PL authority, into a division it's leading that division. The
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
    // Default the PL to the creator. Leadership creating a project almost
    // always owns it initially, and a project with no PL is the one state the
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

  // Making someone a PL hands them authority over the whole subtree, so it's
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
  return toResult(result, asRE ? "Added as a PL." : "Added to the project.");
}

async function setProjectREAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.assignRE(viewer.actor, viewer.graph, projectId)) {
    return denied("change who the PLs are");
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
      ? "Now the primary PL."
      : mode === "add"
        ? "Added as a PL."
        : "No longer a PL."
  );
}

// ---------------------------------------------------------------------------
// Writing a check-in
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Check-in review
// ---------------------------------------------------------------------------

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
  if (!can.requestToJoin(viewer.actor)) {
    return {
      ok: false,
      error:
        "Advisors are named on a project by its PL rather than joining it — joining is how somebody takes on deliverables, and an advisor deliberately holds none.",
    };
  }

  const result = await ops.requestToJoin({
    projectId,
    memberId: viewer.member.id,
    note,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Asked to join — the PL will see it.");
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
      open My Work. Told either way: a decline with the PL's note is far better
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

/**
 * Move a project's target date, with a reason, keeping the old one.
 *
 * `manageProject` — the same right as editing the project, which this is a
 * narrower version of. Deliberately NOT `completeProject`: moving a date is
 * running the project, not reviewing it, and the assigned PL is exactly who
 * should be able to say "this is going to take longer". Making them ask the PL
 * above would mean the honest answer needs somebody else's diary, and the
 * dishonest one — leaving a date everyone knows is wrong — stays free.
 */
async function pushDeadlineAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.manageProject(viewer.actor, viewer.graph, projectId)) {
    return denied("move this project's target date");
  }

  const result = await ops.changeProjectDeadline({
    projectId,
    targetDate: String(formData.get("targetDate") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    actorId: viewer.member.id,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(
    result,
    result.ok
      ? `Target moved to ${result.value.targetDate}. The old date stays on the record.`
      : ""
  );
}

/**
 * Push back one deliverable's deadline, with a reason.
 *
 * `manageDeliverables` — Co-Lead or PL of this project or above. Deliberately NOT
 * the owner: `updateDeliverable` already lets the person doing the work change
 * their own date, and that is right for the ordinary case. This path writes a
 * permanent line in the project's history saying the schedule slipped and why, and
 * that is the PL's call, not something somebody should be able to enter about
 * their own work unreviewed.
 */
async function pushDeliverableDeadlineAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.manageDeliverables(viewer.actor, viewer.graph, projectId)) {
    return denied("push back this deadline");
  }

  const result = await ops.changeDeliverableDeadline({
    deliverableId: String(formData.get("deliverableId") ?? ""),
    dueDate: String(formData.get("dueDate") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    actorId: viewer.member.id,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(
    result,
    result.ok
      ? `Moved to ${result.value.dueDate}. The old date stays on the record.`
      : ""
  );
}

/**
 * Delete a batch of one person's empty projects.
 *
 * ---------------------------------------------------------------------------
 * The recovery path for a bulk write, and why it's shaped like this
 * ---------------------------------------------------------------------------
 *
 * An assistant on the MCP server created ~4,000 empty projects. There was no way
 * to undo that from the UI, and there is no realistic number of times somebody
 * will press a per-project delete button.
 *
 * Three deliberate constraints:
 *
 *   - **Co-Lead only** (`purgeEmptyProjects`), not `deleteProject`'s per-project
 *     rule, which would let a PL reach across divisions.
 *   - **It names the person whose projects go**, so it can never be a
 *     "delete all empty projects" button that catches somebody else's.
 *   - **It confirms by typed count.** The client sends the number it displayed;
 *     if the real number has changed since the page rendered, the action refuses
 *     rather than deleting a set the Co-Lead never saw. That is the check that
 *     makes a stale tab harmless.
 */

/**
 * Save the signed-in advisor's own background, and their bio.
 *
 * No permission check beyond being signed in, deliberately: `saveMyAdvisorProfile`
 * writes through RLS scoped to `auth.uid()`, so it can only ever reach the
 * caller's own row — the same reasoning as `revokeMcpTokenAction`. Role is not
 * checked either. A Lead who also advises a project is not worth a rule, and the
 * fields simply go unused by anybody who leaves them blank.
 */
async function saveAdvisorProfileAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();

  /*
    The bio lives on `profiles` and the rest on `advisor_profiles`, so this writes
    two places. The bio goes first: it needs no migration, so if 0044 has not been
    applied yet the advisor still gets the half that works rather than losing both.
  */
  const bioResult = await ops.updateProfile({
    memberId: viewer.member.id,
    edits: { bio: String(formData.get("bio") ?? "") },
  });
  if (!bioResult.ok) return { ok: false, error: bioResult.error };

  const degrees = [0, 1, 2, 3, 4, 5].map((i) => ({
    degree: String(formData.get(`degree_${i}`) ?? ""),
    school: String(formData.get(`school_${i}`) ?? ""),
    year: String(formData.get(`year_${i}`) ?? ""),
  }));

  const saved = await saveMyAdvisorProfile(
    normaliseAdvisorProfile({
      degrees,
      jobTitle: String(formData.get("jobTitle") ?? ""),
      employer: String(formData.get("employer") ?? ""),
    })
  );

  if (!saved.ok) return { ok: false, error: saved.error };

  refresh();
  return { ok: true, message: "Saved." };
}

async function purgeEmptyProjectsAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.purgeEmptyProjects(viewer.actor)) {
    return denied("bulk-delete projects");
  }

  const creatorId = String(formData.get("creatorId") ?? "");
  if (!creatorId) return { ok: false, error: "Say whose projects to remove." };

  /*
    What the page showed, compared with what is there now.

    Not paranoia: the incident that produced this feature was still adding rows
    while it was being looked at, so "the number moved" is the expected case, not
    the exotic one.
  */
  const withOthers = String(formData.get("withOthers") ?? "") === "yes";
  const expected = Number(String(formData.get("expected") ?? ""));
  const actual = ops.emptyProjectsCreatedBy(readStore(), creatorId, {
    withOthers,
  }).length;
  if (!Number.isFinite(expected) || expected !== actual) {
    return {
      ok: false,
      error: `The count changed — it was ${Number.isFinite(expected) ? expected : "unknown"} and is now ${actual}. Reload and check before deleting.`,
    };
  }

  const result = await ops.purgeEmptyProjectsCreatedBy({
    creatorId,
    limit: Number(String(formData.get("limit") ?? "")) || 250,
    withOthers,
  });

  if (!result.ok) return { ok: false, error: result.error };
  refresh();

  const { deleted, remaining } = result.value;
  return {
    ok: true,
    message: remaining
      ? `Deleted ${deleted}. ${remaining} still to go — press again.`
      : `Deleted ${deleted}. Nothing empty left for them.`,
  };
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

    The assigned PL runs the project and may change anything else about it —
    name, dates, health, phase — but declaring it FINISHED is the review step,
    and reviewing your own work isn't reviewing. Checked here rather than in
    `ops.updateProject` because permissions live in `lib/permissions.ts` and the
    store layer deliberately knows nothing about actors.

    Only the crossing INTO complete. A PL reopening their own project needs no
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
          "Only a PL above this project, or its Division Lead, can mark it complete. You're accountable for finishing it; they're accountable for agreeing it's done. Tell them it's ready.",
      };
    }
  }

  /*
    Whether THIS edit is what blocks the project, as opposed to an edit to a
    project that was already blocked. Without the before-state, every save on a
    blocked project re-DMs the same person, and repeating yourself is the
    fastest way to get a bot muted.
  */
  const healthBefore = viewer.graph.getProject(projectId)?.health;
  const health = String(
    formData.get("health") ?? "on_track"
  ) as Project["health"];

  const result = await ops.updateProject({
    projectId,
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? "") || undefined,
    phase,
    health,
    targetDate: String(formData.get("targetDate") ?? "") || undefined,
    openRoles: String(formData.get("openRoles") ?? "") || undefined,
    // From the session, never the form: the notice names who completed the
    // project, and that attribution has to be unforgeable.
    actorId: viewer.member.id,
    today: today(),
  });

  if (result.ok) refresh();

  // Same routing as a blocked deliverable — see `notifyBlocked`. A PL marking
  // their OWN project blocked is exactly the case that has to reach one level
  // up, because there is nobody left at this level to tell.
  if (result.ok && health === "blocked" && healthBefore !== "blocked") {
    notifyBlocked({
      projectId,
      raiserId: viewer.member.id,
      raiserName: viewer.member.preferredName ?? viewer.member.fullName,
      what: result.value.name,
      note: "The whole project is marked blocked — see the project page.",
      wholeProject: true,
    });
  }

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

/*
  The list lives in `lib/labels.ts`, derived from the labels map.

  It was written out by hand here, which made three copies of the same union — and
  the MCP server later invented a fourth that was simply wrong. One derived list
  cannot drift from the type.
*/
function eventKindFrom(formData: FormData): EventKind {
  return eventKindOrDefault(String(formData.get("kind") ?? ""));
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
    // Empty means it doesn't repeat. `createEvent` normalises the cadence and
    // `repeatProblem` validates the range with the same function the form uses.
    repeatUntil: String(formData.get("repeatUntil") ?? "") || undefined,
    repeatEveryWeeks:
      String(formData.get("repeatEveryWeeks") ?? "") === "2" ? 2 : 1,
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
    /*
      Three-way, exactly like `projectId` above.

      The form always sends the field — empty when the "it repeats" box is
      unticked — so "" is a deliberate STOP repeating, and absent means leave it
      alone. Without the empty-string hidden input in `RepeatFields`, unticking the
      box would silently fail to stop a weekly meeting.
    */
    repeatUntil: formData.has("repeatUntil")
      ? String(formData.get("repeatUntil") ?? "") || null
      : undefined,
    repeatEveryWeeks:
      String(formData.get("repeatEveryWeeks") ?? "") === "2" ? 2 : 1,
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

/**
 * May this viewer act on this certification request?
 *
 * Two questions, and both have to be asked. `can.verifyTraining` is the role
 * question -- the interim "any Lead, not yourself" rule. `mayVerifyItem` is the
 * per-ITEM question the club asked for on 2026-08-24: a named verifier signs off
 * that machine, or the item is self-verify and the member ticks it themselves.
 *
 * Shared by all three actions below rather than inlined three times. They are
 * verify, reject and revoke -- the same authority in three directions, and three
 * copies of a two-part check is how one of them ends up with only half of it.
 *
 * Returns the item id too, because the caller needs it to decide `allowSelf`:
 * a self-verify item is the one case where somebody signing off their own record
 * is the intended behaviour rather than the thing being prevented.
 */
async function mayActOnCertification(
  viewer: Awaited<ReturnType<typeof getViewer>>,
  certificationId: string,
  memberId: string
): Promise<{ allowed: boolean; selfVerify: boolean }> {
  const record = readStore().certifications.find(
    (c) => c.id === certificationId
  );
  const config = record
    ? (await catalogueVerifiers()).get(record.itemId)
    : undefined;

  return {
    allowed: mayVerifyItem({
      actorId: viewer.member.id,
      isCoLead: isCoLead(viewer.actor),
      subjectId: memberId,
      config,
      fallbackAllowed: can.verifyTraining(viewer.actor, viewer.graph, memberId),
    }),
    selfVerify: !!config?.selfVerify,
  };
}

async function verifyCertificationAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const certificationId = String(formData.get("certificationId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");

  const gate = await mayActOnCertification(viewer, certificationId, memberId);
  if (!gate.allowed) return denied("verify this");

  const result = await ops.verifyCertification({
    certificationId,
    verifierId: viewer.member.id,
    /*
      Two cases where signing off your own is intended rather than prevented.

      A Co-Lead, because nobody is above them and the alternative is a record
      they can never complete -- see the note on `can.verifyTraining`.

      A self-verify item, because that is the entire feature: "did you read the
      shop induction" is a question only the member can answer, and routing it
      through somebody else makes the answer worse rather than more trustworthy.
    */
    allowSelf: isCoLead(viewer.actor) || gate.selfVerify,
    today: today(),
  });

  if (result.ok) refresh();
  if (!result.ok || memberId !== viewer.member.id) {
    return toResult(result, "Verified.");
  }
  return toResult(
    result,
    gate.selfVerify
      ? "Recorded. This one is self-verify — you're attesting to it yourself."
      : "Verified — recorded as self-verified, since nobody sits above a Co-Lead."
  );
}

async function rejectCertificationAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const memberId = String(formData.get("memberId") ?? "");
  const certificationId = String(formData.get("certificationId") ?? "");

  const gate = await mayActOnCertification(viewer, certificationId, memberId);
  if (!gate.allowed) return denied("decide this");

  const result = await ops.rejectCertification({
    certificationId,
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
  const certificationId = String(formData.get("certificationId") ?? "");

  /*
    Withdrawing is gated the same way as granting, deliberately. It is the
    heavier act -- it takes a clearance OFF somebody's record -- so anything
    wider would let a Lead with no stake in that machine undo the named
    verifier's decision.

    Note that a self-verify item lets the MEMBER withdraw their own, which is
    right: they attested to it, so they can say it is no longer true.
  */
  const gate = await mayActOnCertification(viewer, certificationId, memberId);
  if (!gate.allowed) return denied("withdraw this clearance");

  const result = await ops.revokeCertification({
    certificationId,
    verifierId: viewer.member.id,
    note: String(formData.get("note") ?? ""),
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Clearance withdrawn.");
}

/**
 * Configure who verifies one catalogue item.
 *
 * Co-Lead only, same as everything else that edits the catalogue -- this is the
 * shape the shop's sign-offs hang off, and it is the guard whose absence would
 * let a Lead quietly make themselves the verifier for every machine.
 */
async function setCatalogueVerifierAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageTrainingCatalogue(viewer.actor)) {
    return denied("configure who verifies trainings");
  }

  const selfVerify = String(formData.get("selfVerify") ?? "") === "yes";
  const verifierId = String(formData.get("verifierId") ?? "") || undefined;

  const result = await saveCatalogueVerifier({
    itemId: String(formData.get("itemId") ?? ""),
    verifierId,
    selfVerify,
  });

  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return {
    ok: true,
    message: selfVerify
      ? "Members can now tick this one themselves."
      : verifierId
        ? "Saved. They'll see requests for it on their dashboard."
        : "Cleared — any Lead can verify this one.",
  };
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
// Phase 7 — the PL answers a check-in section
// ---------------------------------------------------------------------------

/**
 * A PL's reply to one work-log line.
 *
 * The twin of `respondToUpdateEntryAction`, and gated on the SAME rule
 * (`manageDeliverables` — PL of this project or above, or a Co-Lead) so the two
 * rows in the merged feed cannot end up answerable by different people. A reader
 * seeing a reply box on one row and not the next would reasonably conclude the
 * app was broken.
 *
 * The write goes to its own table via `lib/worklog/replies.ts` rather than to
 * columns on `work_logs`; migration 0045 explains why, and it is the reason this
 * degrades to a clear message instead of a 500 before the SQL is applied.
 */
async function replyToWorkLogAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const workLogId = String(formData.get("workLogId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");

  if (!workLogId || !projectId) {
    return { ok: false, error: "That entry no longer exists." };
  }
  if (!can.manageDeliverables(viewer.actor, viewer.graph, projectId)) {
    return denied("answer work logged on this project");
  }

  const response = String(formData.get("response") ?? "");
  const saved = await saveWorkLogReply({
    workLogId,
    projectId,
    response,
    responderId: viewer.member.id,
  });
  if (!saved.ok) return { ok: false, error: saved.error };

  refresh();
  return {
    ok: true,
    message: response.trim() ? "Reply sent." : "Reply removed.",
  };
}

async function respondToUpdateEntryAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const entryId = String(formData.get("entryId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");

  // `manageDeliverables`, so PL authority inherits down the project tree and a
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

/**
 * Turn your own daily digest on or off.
 *
 * Only ever your own — the member id comes from the session and the form has
 * no say in it. Somebody else's notification preferences are not an
 * administrative concern.
 */
async function setDailyDigestAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();

  const result = await ops.setDailyDigest({
    memberId: viewer.member.id,
    // An unchecked box posts nothing, so absence is off.
    optOut: formData.get("optOut") === "on",
  });

  if (result.ok) refresh();
  return toResult(
    result,
    result.ok && result.value.dailyDigestOptOut
      ? "Daily digest off. Blocker alerts and check-in reminders still come through."
      : "Daily digest on — one message each evening."
  );
}

// ---------------------------------------------------------------------------
// Guide pages — the club's own material
// ---------------------------------------------------------------------------

async function saveGuideBlockAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageGuides(viewer.actor)) {
    return denied("edit the guide pages");
  }

  const page = String(formData.get("page") ?? "");
  if (!GUIDE_PAGES.includes(page as GuidePage)) {
    return { ok: false, error: "Pick which page this belongs on." };
  }

  const kind = String(formData.get("kind") ?? "link");

  const result = await ops.saveGuideBlock({
    blockId: String(formData.get("blockId") ?? "") || undefined,
    page: page as GuidePage,
    kind: kind === "note" ? "note" : "link",
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? "") || undefined,
    url: String(formData.get("url") ?? "") || undefined,
    category: String(formData.get("category") ?? "") || undefined,
    actorId: viewer.member.id,
    today: today(),
  });

  if (result.ok) refresh();
  return toResult(result, "Saved. Members see it immediately.");
}

async function removeGuideBlockAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageGuides(viewer.actor)) {
    return denied("edit the guide pages");
  }

  const result = await ops.removeGuideBlock({
    blockId: String(formData.get("blockId") ?? ""),
  });

  if (result.ok) refresh();
  return toResult(result, "Removed.");
}

async function moveGuideBlockAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!can.manageGuides(viewer.actor)) {
    return denied("reorder the guide pages");
  }

  const result = await ops.moveGuideBlock({
    blockId: String(formData.get("blockId") ?? ""),
    direction:
      String(formData.get("direction") ?? "up") === "down" ? "down" : "up",
  });

  if (result.ok) refresh();
  return toResult(result, "Moved.");
}

// ---------------------------------------------------------------------------
// MCP tokens — connecting your own AI
// ---------------------------------------------------------------------------

/**
 * Mint a token. The plaintext comes back in the success MESSAGE, once.
 *
 * That's unusual — every other action returns a short confirmation — but only
 * the hash is stored, so this really is the only moment the token exists
 * anywhere readable. `ActionForm` renders `result.message`, and the form keeps
 * it on screen until dismissed.
 */
/**
 * Mint (or replace) the member's calendar subscription URL.
 *
 * No permission check beyond being signed in: RLS scopes every policy on
 * `calendar_feeds` to `auth.uid()`, so this can only ever reach your own row —
 * the same reasoning as the MCP token actions below.
 *
 * The URL is returned in the success message rather than being stored anywhere
 * readable. Unlike an MCP token it is deliberately re-showable by pressing the
 * button again, because a calendar URL has to be pasted into every device a
 * member owns, possibly weeks apart. Doing that replaces the token, which
 * disconnects the other devices — so the copy says so.
 */
async function createCalendarFeedAction$impl(
  _formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();

  const result = await rotateMyFeed({
    memberId: viewer.member.id,
    origin: appUrl(""),
  });

  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true, message: result.url };
}

async function revokeCalendarFeedAction$impl(
  _formData: FormData
): Promise<ActionResult> {
  await getViewer();

  const result = await revokeMyFeed();
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Couldn't turn that off." };
  }

  refresh();
  return {
    ok: true,
    message:
      "Subscription turned off. The old link stops working immediately — remove it from your calendar app too, or it will sit there empty.",
  };
}

async function createMcpTokenAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();

  const scope = String(formData.get("scope") ?? "read");
  const result = await createMyToken({
    memberId: viewer.member.id,
    name: String(formData.get("name") ?? ""),
    scope: scope === "write" ? "write" : "read",
  });

  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return {
    ok: true,
    message: `${result.token}

Copy it now — this is the only time it is shown. Paste it into your AI client alongside the server URL.`,
  };
}

async function revokeMcpTokenAction$impl(
  formData: FormData
): Promise<ActionResult> {
  // No permission check beyond being signed in: RLS scopes every policy on
  // `mcp_tokens` to `auth.uid()`, so this can only ever reach your own rows.
  await getViewer();

  const error = await revokeMyToken(String(formData.get("tokenId") ?? ""));
  if (error) return { ok: false, error };

  refresh();
  return { ok: true, message: "Revoked. Anything using it stops working now." };
}

// ---------------------------------------------------------------------------
// The engineering record
// ---------------------------------------------------------------------------

/**
 * Attach a document to a project.
 *
 * The one project write open to people who aren't PLs — see
 * `can.attachArtifact` for why. Committed members only; following a project
 * means you're watching it, not working on it.
 */
async function attachArtifactAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  const isOnProject = memberProjects(viewer.member.id).some(
    (m) => m.projectId === projectId && m.commitment === "committed"
  );

  if (!can.attachArtifact(viewer.actor, viewer.graph, projectId, isOnProject)) {
    return denied("attach documents to this project");
  }

  // ARTIFACT_KIND_ORDER is the full set, so it doubles as the allowlist —
  // a second constant listing the same nine would be one more thing to drift.
  const kind = String(formData.get("kind") ?? "");
  if (!ARTIFACT_KIND_ORDER.includes(kind as ArtifactKind)) {
    return { ok: false, error: "Pick what kind of document this is." };
  }

  /*
    A file or a link, never both.

    The upload runs FIRST and the row is written only if it succeeded. The
    other order leaves a row pointing at a file that isn't there, which reads
    as a broken record rather than a failed action — see `documentPath`.
  */
  const file = formData.get("file");
  const hasFile = isUploadableFile(file) && file.size > 0;

  let storagePath: string | undefined;
  if (hasFile) {
    const problem = checkUpload(file, "document");
    if (problem) return { ok: false, error: problem.reason };

    const upload = await uploadDocument(projectId, crypto.randomUUID(), file);
    if (!upload.ok) return { ok: false, error: upload.error };
    storagePath = upload.value;
  }

  const result = await ops.addProjectArtifact({
    projectId,
    uploadedById: viewer.member.id,
    kind: kind as ArtifactKind,
    title: String(formData.get("title") ?? ""),
    url: hasFile ? undefined : String(formData.get("url") ?? ""),
    storagePath,
    description: String(formData.get("description") ?? "") || undefined,
    version: String(formData.get("version") ?? "") || undefined,
    // An unchecked box posts nothing at all, so absence is the "no" case.
    confirmedPermanent: formData.get("confirmedPermanent") === "on",
    today: today(),
  });

  /*
    Clean up after ourselves if the row was refused — otherwise a rejected
    title leaves the file sitting in the bucket forever, counting against a
    1 GB quota, reachable by nothing.
  */
  if (!result.ok && storagePath) {
    await removeDocument(storagePath);
  }

  if (result.ok) refresh();
  return toResult(result, "Attached to the engineering record.");
}

/** Does this FormData value look like an uploaded file? */
function isUploadableFile(value: unknown): value is UploadableFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "size" in value &&
    "name" in value
  );
}

/**
 * Take a document back out.
 *
 * Refused on a completed project unless you're a Co-Lead — the record is the
 * club's history by then. `can.manageArtifact` holds that rule.
 */
async function removeArtifactAction$impl(
  formData: FormData
): Promise<ActionResult> {
  const viewer = await getViewer();
  const projectId = String(formData.get("projectId") ?? "");

  if (!can.manageArtifact(viewer.actor, viewer.graph, projectId)) {
    /*
      Two different refusals wearing one message would be confusing here: "you
      aren't a PL" and "this project is finished" need different next steps,
      and only one of them is about the person asking.
    */
    const project = viewer.graph.getProject(projectId);
    if (project?.phase === "complete") {
      return {
        ok: false,
        error:
          "This project is complete, so its engineering record is frozen. Ask a Co-Lead if something in it is wrong.",
      };
    }
    return denied("remove documents from this project");
  }

  /*
    Read the row before deleting it, so we know whether there's a file behind
    it. Afterwards the storage path is gone and the object would be orphaned.
  */
  const artifactId = String(formData.get("artifactId") ?? "");
  const stored = readStore().projectArtifacts.find((a) => a.id === artifactId);

  const result = await ops.removeProjectArtifact({ artifactId });

  // Row first, file second — best effort. An orphaned object is untidy; a
  // listed row whose file has vanished is a broken link people will report.
  if (result.ok && stored?.storagePath) {
    await removeDocument(stored.storagePath);
  }

  if (result.ok) refresh();
  return toResult(result, "Removed.");
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
 * nothing calling it, so a request sent by mistake sat in a PL's queue
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

export async function logWorkAction(formData: FormData): Promise<ActionResult> {
  return withRequestStore(() => logWorkAction$impl(formData));
}

export async function deleteWorkAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteWorkAction$impl(formData));
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

export async function attachArtifactAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => attachArtifactAction$impl(formData));
}

export async function setDailyDigestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setDailyDigestAction$impl(formData));
}

export async function saveGuideBlockAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => saveGuideBlockAction$impl(formData));
}

export async function removeGuideBlockAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => removeGuideBlockAction$impl(formData));
}

export async function moveGuideBlockAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => moveGuideBlockAction$impl(formData));
}

export async function createCalendarFeedAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createCalendarFeedAction$impl(formData));
}

export async function revokeCalendarFeedAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => revokeCalendarFeedAction$impl(formData));
}

export async function createMcpTokenAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createMcpTokenAction$impl(formData));
}

export async function revokeMcpTokenAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => revokeMcpTokenAction$impl(formData));
}

export async function removeArtifactAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => removeArtifactAction$impl(formData));
}

export async function createMemberRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => createMemberRequestAction$impl(formData));
}

export async function answerMemberRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => answerMemberRequestAction$impl(formData));
}

export async function withdrawMemberRequestAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => withdrawMemberRequestAction$impl(formData));
}

export async function addProjectAdvisorAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => addProjectAdvisorAction$impl(formData));
}

export async function removeProjectAdvisorAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => removeProjectAdvisorAction$impl(formData));
}

export async function addDeliverableTodoAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => addDeliverableTodoAction$impl(formData));
}

export async function setDeliverableTodoDoneAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setDeliverableTodoDoneAction$impl(formData));
}

export async function renameDeliverableTodoAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => renameDeliverableTodoAction$impl(formData));
}

export async function deleteDeliverableTodoAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => deleteDeliverableTodoAction$impl(formData));
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

export async function admitMemberAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => admitMemberAction$impl(formData));
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

export async function pushDeliverableDeadlineAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => pushDeliverableDeadlineAction$impl(formData));
}

export async function pushDeadlineAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => pushDeadlineAction$impl(formData));
}

export async function purgeEmptyProjectsAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => purgeEmptyProjectsAction$impl(formData));
}

export async function saveAdvisorProfileAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => saveAdvisorProfileAction$impl(formData));
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
    discordInviteUrl: String(formData.get("discordInviteUrl") ?? ""),
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

  const memberIds = formData.getAll("attendeeIds").map(String).filter(Boolean);

  /*
    Who is NEW, worked out before the write.

    Only they get a DM. Re-saving a guest list to change one name must not DM the
    five people who were already on it — that is how a useful notification becomes
    one everybody mutes.
  */
  const alreadyOn = new Set(existing.attendeeIds);
  const added = memberIds.filter((id) => !alreadyOn.has(id));

  const result = await ops.setEventGuestList({ eventId, memberIds });

  if (result.ok) {
    refresh();

    /*
      Tell them on Discord, because the CALENDAR cannot.

      A subscription is a pull: the event appears on the next fetch, silently,
      minutes later on Apple and hours later on Google. So being added to a
      session was completely silent — and for a meeting tomorrow that is the
      difference between turning up and not.

      Never the person doing the adding, even if they add themselves.
    */
    const who = viewer.member.preferredName ?? viewer.member.fullName;
    const when = `${formatDay(existing.startsAt, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })} at ${formatClock(existing.startsAt)}`;
    const repeats = existing.repeatUntil
      ? `repeats ${existing.repeatEveryWeeks === 2 ? "every other week" : "weekly"} until ${formatDay(existing.repeatUntil)}`
      : undefined;

    for (const id of added) {
      if (id === viewer.member.id) continue;
      const member = getMember(id);
      if (!member) continue;
      notify(
        member.discordUserId,
        discordMessages.addedToEvent({
          eventTitle: existing.title,
          when,
          addedBy: who,
          repeats,
          url: appUrl("/calendar"),
        })
      );
    }
  }

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

export async function setCatalogueVerifierAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => setCatalogueVerifierAction$impl(formData));
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

export async function replyToWorkLogAction(
  formData: FormData
): Promise<ActionResult> {
  return withRequestStore(() => replyToWorkLogAction$impl(formData));
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
