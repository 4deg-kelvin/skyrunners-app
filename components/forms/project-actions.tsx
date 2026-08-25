"use client";

import { useState } from "react";
import { Eye, EyeOff, UserPlus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  decideJoinRequestAction,
  removeProjectMemberAction,
  requestToJoinAction,
  setFollowingAction,
  withdrawJoinRequestAction,
} from "@/lib/actions";

/**
 * Ask to join a project.
 *
 * This button was rendered but wired to nothing for the whole of Phase 2 —
 * `/find-work` is the point of the app, and its primary call to action silently
 * did nothing. Everything else on that page is wasted if this step fails.
 *
 * The note field is optional but expanded on click rather than hidden behind a
 * second screen: a PL deciding between two requests wants to know what someone
 * would bring, and asking for it at the moment of intent is the only time
 * they'll write it.
 */
export function AskToJoinButton({
  projectId,
  projectName,
  isRecruiting = true,
}: {
  projectId: string;
  projectName: string;
  /**
   * Whether the PL has the project marked as looking for people.
   *
   * Only changes the WORDS. The button is always here, because a project that
   * refuses asks leaves a member no route in except knowing somebody — and
   * being told "they're not looking, but ask anyway" is a much better outcome
   * than a missing button with no explanation.
   */
  isRecruiting?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
      >
        <UserPlus className="size-4" strokeWidth={2.5} />
        {isRecruiting ? "Ask to join" : "Ask anyway"}
      </button>
    );
  }

  return (
    <ActionForm
      action={requestToJoinAction}
      submitLabel="Send request"
      submittingLabel="Sending…"
      className="rounded-tile border-line bg-surface w-full border p-3.5"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          Anything to tell the PL of {projectName}?
        </span>
        <textarea
          name="note"
          rows={2}
          placeholder="What you'd bring, or how much time you have."
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
      </label>
      <p className="text-ink-muted mt-1 mb-2.5 text-xs">
        Optional. Goes into their queue — you&apos;ll see it as pending, and it
        gets flagged for a Co-Lead if nobody answers in five days.
      </p>
    </ActionForm>
  );
}

/**
 * Take back a request you sent.
 *
 * `withdrawJoinRequest` sat in the operations layer with no action and no
 * button from Phase 2 onward, so a request sent to the wrong project was
 * permanent: it stayed in a PL's queue, escalated at five days, and showed the
 * sender a "Request pending" badge with no way out. The queue is supposed to
 * make asks visible, not un-cancellable.
 */
export function WithdrawRequestButton({
  requestId,
  projectName,
}: {
  requestId: string;
  projectName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-ink-muted hover:text-ink text-sm font-semibold"
      >
        Withdraw
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-ink-soft text-sm">
        Withdraw from {projectName}?
      </span>
      <ActionButton
        action={withdrawJoinRequestAction}
        fields={{ requestId }}
        label="Yes, withdraw"
        pendingLabel="Withdrawing…"
        tone="danger"
      />
      <button
        onClick={() => setConfirming(false)}
        className="text-ink-muted hover:text-ink text-sm font-semibold"
      >
        Keep it
      </button>
    </span>
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
          className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60"
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
 * The PL answers a join request.
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
        className="rounded-tile border-line bg-surface mt-3 border p-3"
      >
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="accept" value="no" />
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Why not, or what would change your mind?
          </span>
          <textarea
            name="responseNote"
            rows={2}
            placeholder="Full for this quarter — try Spar Load Testing, they need people."
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
        </label>
        <p className="text-ink-muted mt-1 mb-2.5 text-xs">
          {requesterName} sees this. Pointing them somewhere else is the
          difference between a no and a dead end.
        </p>
        <button
          type="button"
          onClick={() => setDeclining(false)}
          className="text-ink-muted hover:text-ink ml-3 text-sm font-semibold"
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
        className="rounded-tile border-line text-ink hover:bg-surface border px-3 py-1.5 text-sm font-semibold"
      >
        Decline
      </button>
    </div>
  );
}

/** PL takes someone off a project. */
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
        className="text-ink-muted hover:text-risk-fg text-sm font-semibold"
      >
        Remove
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-soft text-sm">Remove {memberName}?</span>
      <ActionButton
        action={removeProjectMemberAction}
        fields={{ projectId, memberId }}
        label="Yes, remove"
        pendingLabel="Removing…"
        tone="danger"
      />
      <button
        onClick={() => setConfirming(false)}
        className="text-ink-muted hover:text-ink text-sm font-semibold"
      >
        Cancel
      </button>
    </div>
  );
}
