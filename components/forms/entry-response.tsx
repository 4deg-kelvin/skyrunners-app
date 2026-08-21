"use client";

import { useState } from "react";
import { CornerDownRight } from "lucide-react";

import { ActionForm } from "./action-form";
import {
  replyToWorkLogAction,
  respondToUpdateEntryAction,
} from "@/lib/actions";

/**
 * The RE's answer to one project section of a check-in.
 *
 * Rendered wherever the section is: on the project's own feed, and in the RE's
 * unanswered queue. Both write the same field, so an RE who answers in one
 * place sees it gone from the other.
 *
 * Deliberately a single answer rather than a thread — see `UpdateEntry`. If it
 * needs a back-and-forth it belongs on the blocker board, which is built for
 * exactly that and doesn't sit inside anyone's weekly obligation.
 */
export function EntryResponse({
  entryId,
  workLogId,
  projectId,
  authorName,
  existing,
  responderName,
  canRespond,
}: {
  /**
   * The check-in entry being answered. Mutually exclusive with `workLogId`.
   *
   * One component for both because they are the same act on the same feed — the
   * project page merged the work log and the check-in entries into one list, and
   * Anish's note was that every row should be answerable. A second copy of this
   * box for the other row type would be 120 lines that drift: the two would stop
   * agreeing about who may reply, or what clearing the box does.
   */
  entryId?: string;
  /** The logged line being answered. Mutually exclusive with `entryId`. */
  workLogId?: string;
  projectId: string;
  authorName: string;
  existing?: string;
  responderName?: string;
  /** False for everyone who isn't an RE of this project or above it. */
  canRespond: boolean;
}) {
  const [editing, setEditing] = useState(false);

  // Everyone sees the answer — a check-in's per-project half is public, and so
  // is the reply to it. Only an RE sees a way to change it.
  if (existing && !editing) {
    return (
      <div className="rounded-tile border-cardinal-600 bg-surface mt-2.5 border-l-2 px-3 py-2">
        <p className="text-ink-soft flex items-center gap-1.5 text-xs font-semibold">
          <CornerDownRight className="size-3" />
          {responderName ?? "The RE"} replied
        </p>
        <p className="text-ink-soft mt-1 text-sm">{existing}</p>
        {canRespond ? (
          <button
            onClick={() => setEditing(true)}
            className="text-cardinal-600 hover:text-cardinal-700 mt-1.5 text-xs font-semibold"
          >
            Edit
          </button>
        ) : null}
      </div>
    );
  }

  if (!canRespond) return null;

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="rounded-tile border-line text-ink hover:bg-surface mt-2.5 border px-3 py-1.5 text-sm font-semibold"
      >
        Reply to this
      </button>
    );
  }

  return (
    <ActionForm
      /*
        Two actions rather than one taking a discriminator, because they write
        different tables with different permission checks. The FORM is what is
        shared; the write is not.
      */
      action={workLogId ? replyToWorkLogAction : respondToUpdateEntryAction}
      submitLabel={existing ? "Save reply" : "Send reply"}
      submittingLabel="Sending…"
      onSuccess={() => setEditing(false)}
      className="rounded-tile border-line bg-surface mt-2.5 border p-3"
    >
      {workLogId ? (
        <input type="hidden" name="workLogId" value={workLogId} />
      ) : (
        <input type="hidden" name="entryId" value={entryId} />
      )}
      <input type="hidden" name="projectId" value={projectId} />
      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          Your answer to {authorName}
        </span>
        <textarea
          name="response"
          rows={2}
          defaultValue={existing}
          placeholder="I'll order a replacement seal — carry on with the dry layups meanwhile."
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
      </label>
      <p className="text-ink-muted mt-1 mb-2.5 text-xs">
        You&apos;re answering as the RE of this project, not as their Lead.
        Everyone can see it — it&apos;s part of the project&apos;s history.
        {existing ? " Clearing the box removes the reply." : ""}
      </p>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-ink-muted hover:text-ink ml-3 text-sm font-semibold"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
