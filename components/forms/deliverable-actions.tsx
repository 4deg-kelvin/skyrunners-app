"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  confirmDeliverableAction,
  deleteDeliverableAction,
  updateDeliverableAction,
  createDeliverableAction,
  reopenDeliverableAction,
  withdrawSignOffAction,
  setDeliverableStatusAction,
  submitDeliverableAction,
} from "@/lib/actions";
import type { Deliverable } from "@/lib/types";
import { formatDay } from "@/lib/dates";
import { PushDeadlineForm } from "./push-deadline";

/**
 * The controls on one deliverable.
 *
 * Two audiences with different jobs, and the component shows only the one that
 * applies:
 *
 *   OWNER — move it along, flag a blocker, say when it's finished.
 *   PL    — sign off, or send it back with a reason.
 *
 * Showing both to everyone would put a "Sign off" button in front of the person
 * whose work it is, which is precisely what the two-step exists to prevent.
 */
export function DeliverableActions({
  deliverable,
  isOwner,
  canSignOff,
  canWithdrawSignOff = false,
  candidates = [],
  projectTargetDate,
  openTodos = 0,
}: {
  deliverable: Deliverable;
  isOwner: boolean;
  canSignOff: boolean;
  /**
   * Unticked checklist items. Zero unless somebody wrote a list.
   *
   * `submitDeliverable` and `confirmDeliverable` both refuse while any are
   * open, so this is here to say so BEFORE the click rather than after. A
   * button that always fails is worse than one that explains itself — and the
   * fix is one chevron away, in the checklist directly above these controls.
   */
  openTodos?: number;
  /**
   * May overturn a sign-off that already happened.
   *
   * Deliberately a SECOND flag rather than a stronger reading of `canSignOff`.
   * They answer different questions — "may you approve work here" versus "may
   * you overrule somebody who already did" — and the whole point of the split
   * is that the project's own PL has the first and not the second. Defaulting
   * to false means a caller who forgets it loses the button, not the rule.
   */
  canWithdrawSignOff?: boolean;
  /**
   * The project's target, if it has one. Work inside a project can't be due
   * after it — `updateDeliverable` refuses that, and this caps the picker so
   * you find out before pressing the button rather than after.
   */
  projectTargetDate?: string;
  /**
   * Who this can be handed to. Everyone active, not just current project
   * members — reassigning is how somebody joins, same as being given a new
   * deliverable. Without this there was no way to act on "Owner left the
   * project — needs reassigning", which is the one state that demands it.
   */
  candidates?: { id: string; name: string }[];
}) {
  const [blocking, setBlocking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const { id, projectId, status } = deliverable;
  const fields = { deliverableId: id, projectId };

  if (status === "done") {
    const signedOn = deliverable.completedAt
      ? ` ${formatDay(deliverable.completedAt)}`
      : "";

    /*
      Overturning a sign-off, and ONLY from above the project.

      This state used to be a dead end — "Signed off." and nothing else — so a
      deliverable approved in error was permanent, and the only route back was
      deleting it, which the operation refuses precisely because it counts
      towards somebody's record.

      The PL at the project's own level signs work off; that's their job. Saying
      the sign-off was WRONG is a different act, and it comes from the PL above
      them or the Division Lead. `canWithdrawSignOff` carries that answer down —
      it is NOT the same flag as `canSignOff`.
    */
    if (!canWithdrawSignOff) {
      return <p className="text-ok-fg text-sm">Signed off{signedOn}.</p>;
    }

    if (rejecting) {
      return (
        <ActionForm
          action={withdrawSignOffAction}
          submitLabel="Reject it"
          submittingLabel="Rejecting…"
          onSuccess={() => setRejecting(false)}
          className="rounded-tile border-risk-fg/30 bg-risk-bg/40 border p-3"
        >
          <input type="hidden" name="deliverableId" value={id} />
          <input type="hidden" name="projectId" value={projectId} />
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              What doesn&apos;t meet the requirement?
            </span>
            <textarea
              name="reason"
              rows={2}
              required
              placeholder="Spar failed at 1.3g on the bench — the layup schedule doesn't match the drawing."
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
            />
          </label>
          <p className="text-ink-muted mt-1 mb-2.5 text-xs">
            This takes a completed deliverable back off the owner&apos;s record,
            so the reason is required. If the project was marked complete,
            it&apos;ll go back to active and everyone above it will be told.
          </p>
          <button
            type="button"
            onClick={() => setRejecting(false)}
            className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
          >
            Cancel
          </button>
        </ActionForm>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-ok-fg text-sm">Signed off{signedOn}.</p>
        <button
          onClick={() => setRejecting(true)}
          className="text-ink-muted hover:text-risk-fg text-sm font-semibold"
        >
          Reject this
        </button>
      </div>
    );
  }

  // Waiting on a PL. The owner sees that it's out of their hands — which is the
  // information they actually need, and stops them chasing it as their problem.
  if (status === "submitted") {
    if (!canSignOff) {
      return (
        <p className="text-ink-muted text-sm">
          Waiting on a PL to sign off. Nothing more for you to do.
        </p>
      );
    }

    if (reopening) {
      return (
        <ActionForm
          action={reopenDeliverableAction}
          submitLabel="Send back"
          submittingLabel="Sending…"
          className="rounded-tile border-line bg-surface border p-3"
        >
          <input type="hidden" name="deliverableId" value={id} />
          <input type="hidden" name="projectId" value={projectId} />
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              What still needs doing?
            </span>
            <textarea
              name="reason"
              rows={2}
              required
              placeholder="Load case 3 isn't covered — add it and resubmit."
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
            />
          </label>
          <p className="text-ink-muted mt-1 mb-2.5 text-xs">
            Required. A rejection with no reason reads as a brush-off.
          </p>
          <button
            type="button"
            onClick={() => setReopening(false)}
            className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
          >
            Cancel
          </button>
        </ActionForm>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        {openTodos > 0 ? (
          <BlockedByChecklist
            count={openTodos}
            what="Sign off"
            why="Tick them off above — you can, or send it back."
          />
        ) : (
          <ActionButton
            action={confirmDeliverableAction}
            fields={fields}
            label="Sign off"
            pendingLabel="Signing…"
            tone="primary"
          />
        )}
        <button
          onClick={() => setReopening(true)}
          className="rounded-tile border-line text-ink hover:bg-surface border px-3 py-1.5 text-sm font-semibold"
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
        className="rounded-tile border-line bg-surface border p-3"
      >
        <input type="hidden" name="deliverableId" value={id} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="status" value="blocked" />
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What&apos;s blocking it?
          </span>
          <input
            type="text"
            name="blockerNote"
            required
            placeholder="Waiting on the load cell to arrive"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
        </label>
        <p className="text-ink-muted mt-1 mb-2.5 text-xs">
          This goes to the project&apos;s PLs, and onto the blocker board where
          anyone can pick it up.
        </p>
        <button
          type="button"
          onClick={() => setBlocking(false)}
          className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
        >
          Cancel
        </button>
      </ActionForm>
    );
  }

  if (editing) {
    return (
      <div className="rounded-tile border-line bg-surface border p-3">
        <ActionForm
          action={updateDeliverableAction}
          submitLabel="Save"
          submittingLabel="Saving…"
          onSuccess={() => setEditing(false)}
        >
          <input type="hidden" name="deliverableId" value={id} />
          <input type="hidden" name="projectId" value={projectId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-ink mb-1 block text-sm font-semibold">
                Title
              </span>
              <input
                type="text"
                name="title"
                required
                defaultValue={deliverable.title}
                className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-ink mb-1 block text-sm font-semibold">
                Owner
              </span>
              <select
                name="ownerId"
                defaultValue={deliverable.ownerId}
                className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
              >
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-ink mb-1 block text-sm font-semibold">
                Due date
              </span>
              <input
                type="date"
                name="dueDate"
                defaultValue={deliverable.dueDate ?? ""}
                max={projectTargetDate}
                className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
              />
              {projectTargetDate ? (
                <span className="text-ink-muted mt-1 block text-xs">
                  The project is due {projectTargetDate}.
                </span>
              ) : null}
            </label>
          </div>

          <p className="text-ink-muted mt-2 mb-2.5 text-xs">
            Leave the date empty for no deadline. Dates drive the project&apos;s
            timeline, so a real one is worth more than a guessed one.
          </p>

          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
          >
            Cancel
          </button>
        </ActionForm>

        <div className="border-line mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
          <ActionButton
            action={deleteDeliverableAction}
            fields={fields}
            label="Delete this deliverable"
            pendingLabel="Deleting…"
            tone="danger"
          />
          <span className="text-ink-muted text-xs">
            Signed-off work can&apos;t be deleted — it counts towards its
            owner&apos;s record.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isOwner ? (
        openTodos > 0 ? (
          <BlockedByChecklist
            count={openTodos}
            what="Mark done"
            why="Tick them off above, or remove the ones that turned out not to be needed."
          />
        ) : (
          <ActionButton
            action={submitDeliverableAction}
            fields={{ deliverableId: id }}
            label="Mark done"
            pendingLabel="Sending…"
            tone="primary"
          />
        )
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
          className="rounded-tile border-line text-ink hover:bg-surface border px-3 py-1.5 text-sm font-semibold"
        >
          I&apos;m blocked
        </button>
      )}

      {/*
        Edit rather than a bare Delete. Retitling and re-dating is the ordinary
        upkeep, and deleting belongs behind it rather than one stray click away
        from the buttons everybody uses. PL only.
      */}
      {canSignOff ? (
        <button
          onClick={() => setEditing(true)}
          className="rounded-tile border-line text-ink hover:bg-surface border px-3 py-1.5 text-sm font-semibold"
        >
          Edit
        </button>
      ) : null}

      {/*
        Push the deadline back, with a reason, recorded.

        Beside Edit rather than inside it, because they are different acts: Edit
        changes the facts of the deliverable, and this one admits the schedule
        slipped and says why. Edit can still move a date silently — that is the
        ordinary case, a day either way — and this is the path that writes a line
        in the project's history.

        Only when there IS a date to push back and the work isn't signed off.
        Signed-off dates are part of the record and the operation refuses them, so
        offering a control that always fails would be a dead button.

        `relative` on the wrapper so the popover anchors here rather than to the
        row — the same reason the Target tile carries it.
      */}
      {canSignOff && deliverable.dueDate && deliverable.status !== "done" ? (
        <span className="relative inline-flex">
          <PushDeadlineForm
            projectId={projectId}
            projectName={deliverable.title}
            currentTarget={deliverable.dueDate}
            parentTargetDate={projectTargetDate}
            deliverableId={id}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * The button you would have pressed, saying why it isn't there.
 *
 * Deliberately not a disabled version of the real button. A greyed-out "Sign
 * off" invites clicking it to find out why, and the answer has to fit in a
 * tooltip nobody opens on a phone. This states the reason in the same space.
 */
function BlockedByChecklist({
  count,
  what,
  why,
}: {
  count: number;
  /** The action that's held up, so the sentence names it. */
  what: string;
  why: string;
}) {
  return (
    <p className="text-ink-soft text-sm">
      <span className="text-warn-fg font-semibold">
        {what} is held: {count} checklist {count === 1 ? "item" : "items"} still
        open.
      </span>{" "}
      {why}
    </p>
  );
}

/**
 * PL adds a deliverable.
 *
 * The owner dropdown lists everyone in the club, not just current project
 * members — assigning work to someone new is how they get added, and forcing the
 * PL to add them first is friction with no safety value. The action auto-adds
 * them as committed.
 */
export function AddDeliverableForm({
  projectTargetDate,
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: { id: string; fullName: string }[];
  /** Caps the due-date picker. Work can't be due after its project. */
  projectTargetDate?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold"
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
      className="rounded-tile border-line bg-surface border p-3.5"
    >
      <input type="hidden" name="projectId" value={projectId} />

      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          What needs doing?
        </span>
        <input
          type="text"
          name="title"
          required
          placeholder="Spar load case 3 analysed and written up"
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Owner
          </span>
          <select
            name="ownerId"
            required
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
          <span className="text-ink-muted mt-1 block text-xs">
            Exactly one. Anyone not on the project gets added.
          </span>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Due <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="date"
            name="dueDate"
            max={projectTargetDate}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
          {projectTargetDate ? (
            <span className="text-ink-muted mt-1 block text-xs">
              No later than {projectTargetDate} — when the project is due.
            </span>
          ) : null}
        </label>
      </div>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink mt-3 ml-3 text-sm font-semibold"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
