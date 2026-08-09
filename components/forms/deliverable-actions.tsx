"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  confirmDeliverableAction,
  deleteDeliverableAction,
  createDeliverableAction,
  reopenDeliverableAction,
  setDeliverableStatusAction,
  submitDeliverableAction,
} from "@/lib/actions";
import type { Deliverable } from "@/lib/types";

/**
 * The controls on one deliverable.
 *
 * Two audiences with different jobs, and the component shows only the one that
 * applies:
 *
 *   OWNER — move it along, flag a blocker, say when it's finished.
 *   RE    — sign off, or send it back with a reason.
 *
 * Showing both to everyone would put a "Sign off" button in front of the person
 * whose work it is, which is precisely what the two-step exists to prevent.
 */
export function DeliverableActions({
  deliverable,
  isOwner,
  canSignOff,
}: {
  deliverable: Deliverable;
  isOwner: boolean;
  canSignOff: boolean;
}) {
  const [blocking, setBlocking] = useState(false);
  const [reopening, setReopening] = useState(false);

  const { id, projectId, status } = deliverable;
  const fields = { deliverableId: id, projectId };

  if (status === "done") {
    return (
      <p className="text-sm text-ok-fg">
        Signed off
        {deliverable.completedAt
          ? ` ${new Date(deliverable.completedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}`
          : ""}
        .
      </p>
    );
  }

  // Waiting on an RE. The owner sees that it's out of their hands — which is the
  // information they actually need, and stops them chasing it as their problem.
  if (status === "submitted") {
    if (!canSignOff) {
      return (
        <p className="text-sm text-ink-muted">
          Waiting on an RE to sign off. Nothing more for you to do.
        </p>
      );
    }

    if (reopening) {
      return (
        <ActionForm
          action={reopenDeliverableAction}
          submitLabel="Send back"
          submittingLabel="Sending…"
          className="rounded-tile border border-line bg-surface p-3"
        >
          <input type="hidden" name="deliverableId" value={id} />
          <input type="hidden" name="projectId" value={projectId} />
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              What still needs doing?
            </span>
            <textarea
              name="reason"
              rows={2}
              required
              placeholder="Load case 3 isn't covered — add it and resubmit."
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
            />
          </label>
          <p className="mb-2.5 mt-1 text-xs text-ink-muted">
            Required. A rejection with no reason reads as a brush-off.
          </p>
          <button
            type="button"
            onClick={() => setReopening(false)}
            className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </ActionForm>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          action={confirmDeliverableAction}
          fields={fields}
          label="Sign off"
          pendingLabel="Signing…"
          tone="primary"
        />
        <button
          onClick={() => setReopening(true)}
          className="rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
        >
          Send back
        </button>
      </div>
    );
  }

  if (!isOwner && !canSignOff) return null;

  if (blocking) {
    return (
      <ActionForm
        action={setDeliverableStatusAction}
        submitLabel="Mark blocked"
        submittingLabel="Saving…"
        className="rounded-tile border border-line bg-surface p-3"
      >
        <input type="hidden" name="deliverableId" value={id} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="status" value="blocked" />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            What&apos;s blocking it?
          </span>
          <input
            type="text"
            name="blockerNote"
            required
            placeholder="Waiting on the load cell to arrive"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </label>
        <p className="mb-2.5 mt-1 text-xs text-ink-muted">
          This goes to the project&apos;s REs, and onto the blocker board where
          anyone can pick it up.
        </p>
        <button
          type="button"
          onClick={() => setBlocking(false)}
          className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </ActionForm>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isOwner ? (
        <ActionButton
          action={submitDeliverableAction}
          fields={{ deliverableId: id }}
          label="Mark done"
          pendingLabel="Sending…"
          tone="primary"
        />
      ) : null}

      {status === "open" ? (
        <ActionButton
          action={setDeliverableStatusAction}
          fields={{ ...fields, status: "in_progress" }}
          label="Start"
        />
      ) : null}

      {status === "blocked" ? (
        <ActionButton
          action={setDeliverableStatusAction}
          fields={{ ...fields, status: "in_progress" }}
          label="Unblock"
        />
      ) : (
        <button
          onClick={() => setBlocking(true)}
          className="rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
        >
          I&apos;m blocked
        </button>
      )}

      {/*
        Deleting is the RE's call, and only before sign-off — once something is
        done it counts towards its owner's record, and removing it would quietly
        take away work they actually did. The operation refuses that too.
      */}
      {canSignOff ? (
        <ActionButton
          action={deleteDeliverableAction}
          fields={fields}
          label="Delete"
          pendingLabel="Deleting…"
          tone="danger"
        />
      ) : null}
    </div>
  );
}

/**
 * RE adds a deliverable.
 *
 * The owner dropdown lists everyone in the club, not just current project
 * members — assigning work to someone new is how they get added, and forcing the
 * RE to add them first is friction with no safety value. The action auto-adds
 * them as committed.
 */
export function AddDeliverableForm({
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: { id: string; fullName: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        <Plus className="size-3.5" strokeWidth={2.5} />
        Add deliverable
      </button>
    );
  }

  return (
    <ActionForm
      action={createDeliverableAction}
      submitLabel="Add it"
      submittingLabel="Adding…"
      resetOnSuccess
      className="rounded-tile border border-line bg-surface p-3.5"
    >
      <input type="hidden" name="projectId" value={projectId} />

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          What needs doing?
        </span>
        <input
          type="text"
          name="title"
          required
          placeholder="Spar load case 3 analysed and written up"
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Owner
          </span>
          <select
            name="ownerId"
            required
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-muted">
            Exactly one. Anyone not on the project gets added.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Due{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="date"
            name="dueDate"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="ml-3 mt-3 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
