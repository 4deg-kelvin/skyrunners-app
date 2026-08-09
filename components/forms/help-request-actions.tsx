"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  deleteHelpRequestAction,
  postHelpRequestAction,
  reopenHelpRequestAction,
  replyToHelpRequestAction,
  resolveHelpRequestAction,
} from "@/lib/actions";

/**
 * Post an ask on the blocker board.
 *
 * The project field is optional and stays optional. Plenty of asks aren't about
 * a project a member has been added to — that's precisely the case the board
 * exists for, since membership is RE-controlled and a pending join request
 * otherwise leaves someone with nowhere to put a question.
 */
export function AskForHelpForm({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-tile bg-cardinal-600 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-cardinal-700"
      >
        <HelpCircle className="size-4" strokeWidth={2.5} />
        Ask for help
      </button>
    );
  }

  return (
    <ActionForm
      action={postHelpRequestAction}
      submitLabel="Post it"
      submittingLabel="Posting…"
      resetOnSuccess
      onSuccess={() => setOpen(false)}
      className="w-full rounded-tile border border-line bg-surface p-3.5"
    >
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          What are you stuck on?
        </span>
        <input
          type="text"
          name="title"
          required
          maxLength={160}
          placeholder="Need someone who knows Onshape assemblies"
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        />
      </label>

      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          Any detail{" "}
          <span className="font-normal text-ink-muted">(optional)</span>
        </span>
        <textarea
          name="detail"
          rows={3}
          placeholder="What you've tried, and what would unblock you."
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        />
      </label>

      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          Related project{" "}
          <span className="font-normal text-ink-muted">(optional)</span>
        </span>
        <select
          name="projectId"
          defaultValue=""
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        >
          <option value="">Not about a specific project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <p className="mb-2.5 mt-2 text-xs text-ink-muted">
        Everyone in the club sees this and anyone can answer — you don&apos;t
        need to be on the project.
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

/** Answer somebody's ask. Deliberately open to everyone. */
export function ReplyForm({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        Answer this
      </button>
    );
  }

  return (
    <ActionForm
      action={replyToHelpRequestAction}
      submitLabel="Post answer"
      submittingLabel="Posting…"
      resetOnSuccess
      onSuccess={() => setOpen(false)}
      className="mt-3 w-full rounded-tile border border-line bg-surface p-3"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <textarea
        name="body"
        rows={2}
        required
        placeholder="What they should try, or who to talk to."
        className="mb-2.5 w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
      />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

/**
 * Close an ask, with a note on how it got sorted.
 *
 * The note is what makes a resolved ask worth keeping rather than deleting —
 * it's how the next person with the same problem finds the answer.
 */
export function ResolveForm({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
      >
        Mark sorted
      </button>
    );
  }

  return (
    <ActionForm
      action={resolveHelpRequestAction}
      submitLabel="Mark sorted"
      submittingLabel="Saving…"
      onSuccess={() => setOpen(false)}
      className="mt-3 w-full rounded-tile border border-line bg-surface p-3"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          How did it get sorted?
        </span>
        <input
          type="text"
          name="note"
          placeholder="Rosa walked me through the mate constraints."
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        />
      </label>
      <p className="mb-2.5 mt-1 text-xs text-ink-muted">
        Optional, and worth the ten seconds — the next person with this problem
        finds the answer here.
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

export function ReopenButton({ requestId }: { requestId: string }) {
  return (
    <ActionButton
      action={reopenHelpRequestAction}
      fields={{ requestId }}
      label="Reopen"
      pendingLabel="Reopening…"
    />
  );
}

export function DeleteAskButton({ requestId }: { requestId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm font-semibold text-ink-muted hover:text-risk-fg"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-soft">Delete this ask?</span>
      <ActionButton
        action={deleteHelpRequestAction}
        fields={{ requestId }}
        label="Yes, delete"
        pendingLabel="Deleting…"
        tone="danger"
      />
      <button
        onClick={() => setConfirming(false)}
        className="text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Keep it
      </button>
    </span>
  );
}
