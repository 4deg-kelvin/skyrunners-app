"use client";

import { useState } from "react";

import { ActionButton, ActionForm } from "./action-form";
import { answerMemberRequestAction } from "@/lib/actions";

/**
 * Grant or decline one request, from the Lead's dashboard.
 *
 * ---------------------------------------------------------------------------
 * Granting is one press; declining costs a sentence
 * ---------------------------------------------------------------------------
 *
 * Deliberately asymmetric, and the same shape as rejecting a deliverable or a
 * training. A grant needs no explanation — the grant IS the answer, and making
 * somebody type "yes, done" to hand over a drive link is the friction that
 * turns a queue into a backlog.
 *
 * A decline without a reason is the thing that stops people asking next time,
 * and quite often the honest answer is "not yet, do the training first", which
 * is useful and completely invisible if the button just says no. So the reason
 * is required, and the operation refuses a blank one rather than trusting the
 * form.
 */
export function RequestDecision({
  requestId,
  askerName,
}: {
  requestId: string;
  /** Used in the copy, so the box names a person rather than "them". */
  askerName: string;
}) {
  const [declining, setDeclining] = useState(false);
  const firstName = askerName.split(" ")[0];

  if (declining) {
    return (
      <ActionForm
        action={answerMemberRequestAction}
        submitLabel="Send the decline"
        submittingLabel="Sending…"
        className="rounded-tile border-line bg-surface mt-2.5 border p-3"
      >
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="status" value="declined" />
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What should {firstName} know?
          </span>
          <textarea
            name="response"
            rows={2}
            required
            placeholder="Not until you're signed off on the mill — book a session with Kelvin and I'll sort it straight after."
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
        </label>
        <p className="text-ink-muted mt-1 mb-2.5 text-xs">
          Required. A bare no is what stops somebody asking next time — and
          &ldquo;not yet, because X&rdquo; is usually the real answer.
        </p>
        <button
          type="button"
          onClick={() => setDeclining(false)}
          className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
        >
          Cancel
        </button>
      </ActionForm>
    );
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <ActionButton
        action={answerMemberRequestAction}
        fields={{ requestId, status: "granted", response: "" }}
        label="Granted"
        pendingLabel="Saving…"
        tone="primary"
      />
      <button
        type="button"
        onClick={() => setDeclining(true)}
        className="rounded-tile border-line text-ink hover:bg-surface border px-3 py-1.5 text-sm font-semibold"
      >
        Decline
      </button>
    </div>
  );
}
