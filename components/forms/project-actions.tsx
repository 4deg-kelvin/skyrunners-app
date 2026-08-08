"use client";

import { useState } from "react";
import { Eye, EyeOff, UserPlus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  decideJoinRequestAction,
  removeProjectMemberAction,
  requestToJoinAction,
  setFollowingAction,
} from "@/lib/actions";

/**
 * Ask to join a project.
 *
 * This button was rendered but wired to nothing for the whole of Phase 2 —
 * `/find-work` is the point of the app, and its primary call to action silently
 * did nothing. Everything else on that page is wasted if this step fails.
 *
 * The note field is optional but expanded on click rather than hidden behind a
 * second screen: an RE deciding between two requests wants to know what someone
 * would bring, and asking for it at the moment of intent is the only time
 * they'll write it.
 */
export function AskToJoinButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-tile bg-cardinal-600 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-cardinal-700"
      >
        <UserPlus className="size-4" strokeWidth={2.5} />
        Ask to join
      </button>
    );
  }

  return (
    <ActionForm
      action={requestToJoinAction}
      submitLabel="Send request"
      submittingLabel="Sending…"
      className="w-full rounded-tile border border-line bg-surface p-3.5"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          Anything to tell the RE of {projectName}?
        </span>
        <textarea
          name="note"
          rows={2}
          placeholder="What you'd bring, or how much time you have."
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        />
      </label>
      <p className="mb-2.5 mt-1 text-xs text-ink-muted">
        Optional. Goes into their queue — you&apos;ll see it as pending, and it
        gets flagged for a Co-Lead if nobody answers in five days.
      </p>
    </ActionForm>
  );
}

/** Watch a project without joining it. No permission needed, by design. */
export function FollowToggle({
  projectId,
  following,
}: {
  projectId: string;
  following: boolean;
}) {
  return (
    <ActionForm
      action={setFollowingAction}
      renderSubmit={(pending) => (
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60"
        >
          {following ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
          {following ? "Unfollow" : "Follow"}
        </button>
      )}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="following" value={following ? "no" : "yes"} />
    </ActionForm>
  );
}

/**
 * The RE answers a join request.
 *
 * Declining requires opening the note field first. A bare "no" from someone who
 * controls whether you can contribute is the thing that makes people leave the
 * club, which is the exact problem this app exists to fix — so the UI makes
 * saying why the path of least resistance.
 */
export function JoinRequestDecision({
  requestId,
  projectId,
  requesterName,
}: {
  requestId: string;
  projectId: string;
  requesterName: string;
}) {
  const [declining, setDeclining] = useState(false);

  if (declining) {
    return (
      <ActionForm
        action={decideJoinRequestAction}
        submitLabel="Send decline"
        submittingLabel="Sending…"
        className="mt-3 rounded-tile border border-line bg-surface p-3"
      >
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="accept" value="no" />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Why not, or what would change your mind?
          </span>
          <textarea
            name="responseNote"
            rows={2}
            placeholder="Full for this quarter — try Spar Load Testing, they need people."
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </label>
        <p className="mb-2.5 mt-1 text-xs text-ink-muted">
          {requesterName} sees this. Pointing them somewhere else is the
          difference between a no and a dead end.
        </p>
        <button
          type="button"
          onClick={() => setDeclining(false)}
          className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </ActionForm>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <ActionButton
        action={decideJoinRequestAction}
        fields={{ requestId, projectId, accept: "yes" }}
        label="Add to project"
        pendingLabel="Adding…"
        tone="primary"
      />
      <button
        onClick={() => setDeclining(true)}
        className="rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        Decline
      </button>
    </div>
  );
}

/** RE takes someone off a project. */
export function RemoveMemberButton({
  projectId,
  memberId,
  memberName,
}: {
  projectId: string;
  memberId: string;
  memberName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm font-semibold text-ink-muted hover:text-risk-fg"
      >
        Remove
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-ink-soft">Remove {memberName}?</span>
      <ActionButton
        action={removeProjectMemberAction}
        fields={{ projectId, memberId }}
        label="Yes, remove"
        pendingLabel="Removing…"
        tone="danger"
      />
      <button
        onClick={() => setConfirming(false)}
        className="text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}
