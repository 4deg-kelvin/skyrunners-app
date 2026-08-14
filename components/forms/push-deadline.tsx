"use client";

import { useState } from "react";
import { CalendarClock, X } from "lucide-react";

import { ActionForm } from "./action-form";
import {
  pushDeadlineAction,
  pushDeliverableDeadlineAction,
} from "@/lib/actions";
import { addDays, formatDay } from "@/lib/dates";

/**
 * Move a project's target date, with a reason, keeping the old one.
 *
 * ---------------------------------------------------------------------------
 * Why this sits ON the Target tile
 * ---------------------------------------------------------------------------
 *
 * It renders into `StatTile`'s `action` slot, beside the label of the very
 * number it changes — not as a button in the row of controls at the top of the
 * page. Three tiles sit side by side (Target, Deliverables done, Committed
 * members) and a floating "Push the deadline" button says nothing about which
 * one it moves. Same reasoning that put Discord verification on the Discord ID
 * field instead of in its own card.
 *
 * The trigger is a quiet text button rather than a filled one, deliberately.
 * Slipping a deadline is a legitimate, honest act the app should make easy — but
 * it is not the primary thing to do on a project page, and a cardinal button
 * there would compete with "Add a deliverable" and read as encouragement.
 */
export function PushDeadlineForm({
  projectId,
  projectName,
  currentTarget,
  parentTargetDate,
  deliverableId,
}: {
  projectId: string;
  /** What is being pushed back — a project name, or a deliverable title. */
  projectName: string;
  /** The date being moved. The control only renders when one exists. */
  currentTarget: string;
  /**
   * The date this one cannot go past, when there is one.
   *
   * For a PROJECT that is its parent project's target; for a DELIVERABLE it is
   * its own project's. Both are the same rule — work inside a thing cannot land
   * after the thing does — and both are enforced on the server regardless. This
   * only sets the picker's `max`, so the constraint is visible in the widget
   * instead of arriving as a rejection after somebody has typed a reason.
   */
  parentTargetDate?: string;
  /**
   * Set to push back a DELIVERABLE instead of the project's own target.
   *
   * One component for both, because they are the same interaction with the same
   * rules and the same history. A second copy would drift, and the drift would be
   * in the validation — the half that matters.
   */
  deliverableId?: string;
}) {
  const [open, setOpen] = useState(false);
  const isDeliverable = Boolean(deliverableId);

  if (!open) {
    /*
      Quiet grey text, and the label is the thing that had to change.

      This went through all three states, which is worth recording so it does not
      go round again:

        1. Grey text reading "Move" — Anish could not find it and reported the
           feature as missing.
        2. A bordered button reading "Move date" — findable, but it read as
           another action competing with "Edit project".
        3. Grey text reading "Push back deadline" — this one.

      The diagnosis in (1) was wrong. The styling was never the problem; **"Move"
      next to the word "Target" was**, because it says nothing about what moves or
      why you would. A label that names the action needs no border to be found,
      and Anish explicitly preferred the blended-in text once it said what it did.

      Which is the general lesson: when a control is hard to find, try naming it
      properly before making it louder.
    */
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-ink-muted hover:text-cardinal-600 inline-flex items-center gap-1 text-xs font-semibold transition-colors"
      >
        <CalendarClock className="size-3.5" />
        Push back deadline
      </button>
    );
  }

  /*
    The earliest date the picker offers is the day AFTER the current target.

    The operation accepts an earlier date too — pulling a deadline in is also a
    change worth recording, and refusing it here would push somebody into the
    full project editor, which is the path with no reason attached. But this
    control is for slipping, and offering the current date as a valid choice
    invites a "change" that changes nothing, which the CHECK in migration 0040
    rejects anyway.
  */
  const earliest = addDays(currentTarget, 1);

  return (
    /*
      Anchored LEFT, and capped to the viewport.

      `right-0` was wrong and looked fine until it was measured: the panel is
      19rem but the Target tile is about 200px, and it is the LEFTMOST of three
      tiles — so aligning the panel's right edge to the tile's pushed it clean off
      the left of the screen at 800px, never mind on a phone. Opening rightward
      from the tile's left edge keeps it over the two tiles beside it, which are
      exactly the space available.

      `max-w-` because 19rem still exceeds a 375px phone once the page padding is
      taken off, and a form you cannot reach the buttons of is not a form.
    */
    <div className="rounded-tile border-line bg-card absolute left-0 z-10 mt-2 w-[19rem] max-w-[calc(100vw-3rem)] border p-3.5 shadow-lg">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-ink text-sm font-bold">
          {isDeliverable ? "Push back this deadline" : "Push back the target"}
        </p>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-tile text-ink-muted hover:bg-surface -mt-1 p-1"
        >
          <X className="size-4" />
        </button>
      </div>

      <p className="text-ink-muted mb-3 text-xs">
        {projectName} is due {formatDay(currentTarget)}. The old date stays on
        the record and shows on the timeline, so the schedule keeps its history.
      </p>

      <ActionForm
        action={
          isDeliverable ? pushDeliverableDeadlineAction : pushDeadlineAction
        }
        submitLabel="Move it"
        submittingLabel="Moving…"
        className="space-y-3"
        /*
          Close on success only. A failed submit keeps the panel open with the
          reason still typed in it — the refusals here are all fixable (a date
          past the parent's, a sub-project dated later), and throwing away
          somebody's sentence to make them retype it is how a rule that exists
          to be helpful starts feeling adversarial.
        */
        onSuccess={() => setOpen(false)}
      >
        {/* `ActionForm` posts the form's own FormData, so the id rides along
            as a hidden field rather than a prop. */}
        <input type="hidden" name="projectId" value={projectId} />
        {deliverableId ? (
          <input type="hidden" name="deliverableId" value={deliverableId} />
        ) : null}

        <label className="block">
          <span className="text-ink mb-1 block text-xs font-semibold">
            New target
          </span>
          <input
            type="date"
            name={isDeliverable ? "dueDate" : "targetDate"}
            required
            defaultValue={earliest}
            min={earliest}
            max={parentTargetDate}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
          {parentTargetDate ? (
            <span className="text-ink-muted mt-1 block text-xs">
              No later than {formatDay(parentTargetDate)} — work inside a
              project can&apos;t land after it does.
            </span>
          ) : null}
        </label>

        {/*
          Required, and the label says so plainly rather than with an asterisk.

          Same asymmetry as declining a member request or rejecting a signed-off
          deliverable: the action that makes the record worse has to be
          explained. This one is read by everybody planning around the project
          and is sent up the chain, which is exactly why it's worth typing.
        */}
        <label className="block">
          <span className="text-ink mb-1 block text-xs font-semibold">
            Why is it moving?
          </span>
          <textarea
            name="reason"
            rows={2}
            required
            maxLength={400}
            placeholder="Waiting on the laser cutter — the shop is booked until the 20th."
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
          <span className="text-ink-muted mt-1 block text-xs">
            Everyone planning around this project reads this, and the REs above
            you are told.
          </span>
        </label>
      </ActionForm>
    </div>
  );
}
