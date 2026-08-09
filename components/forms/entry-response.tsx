"use client";

import { useState } from "react";
import { CornerDownRight } from "lucide-react";

import { ActionForm } from "./action-form";
import { respondToUpdateEntryAction } from "@/lib/actions";

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
  projectId,
  authorName,
  existing,
  responderName,
  canRespond,
}: {
  entryId: string;
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
      <div className="mt-2.5 rounded-tile border-l-2 border-cardinal-600 bg-surface px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
          <CornerDownRight className="size-3" />
          {responderName ?? "The RE"} replied
        </p>
        <p className="mt-1 text-sm text-ink-soft">{existing}</p>
        {canRespond ? (
          <button
            onClick={() => setEditing(true)}
            className="mt-1.5 text-xs font-semibold text-cardinal-600 hover:text-cardinal-700"
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
        className="mt-2.5 rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        Reply to this
      </button>
    );
  }

  return (
    <ActionForm
      action={respondToUpdateEntryAction}
      submitLabel={existing ? "Save reply" : "Send reply"}
      submittingLabel="Sending…"
      onSuccess={() => setEditing(false)}
      className="mt-2.5 rounded-tile border border-line bg-surface p-3"
    >
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="projectId" value={projectId} />
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          Your answer to {authorName}
        </span>
        <textarea
          name="response"
          rows={2}
          defaultValue={existing}
          placeholder="I'll order a replacement seal — carry on with the dry layups meanwhile."
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        />
      </label>
      <p className="mb-2.5 mt-1 text-xs text-ink-muted">
        You&apos;re answering as the RE of this project, not as their Lead.
        Everyone can see it — it&apos;s part of the project&apos;s history.
        {existing ? " Clearing the box removes the reply." : ""}
      </p>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
