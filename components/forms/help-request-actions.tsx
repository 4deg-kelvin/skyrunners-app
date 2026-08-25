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
 * exists for, since membership is PL-controlled and a pending join request
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
        className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
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
      className="rounded-tile border-line bg-surface w-full border p-3.5"
    >
      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          What are you stuck on?
        </span>
        <input
          type="text"
          name="title"
          required
          maxLength={160}
          placeholder="Need someone who knows Onshape assemblies"
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          Any detail{" "}
          <span className="text-ink-muted font-normal">(optional)</span>
        </span>
        <textarea
          name="detail"
          rows={3}
          placeholder="What you've tried, and what would unblock you."
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          Related project{" "}
          <span className="text-ink-muted font-normal">(optional)</span>
        </span>
        <select
          name="projectId"
          defaultValue=""
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        >
          <option value="">Not about a specific project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <p className="text-ink-muted mt-2 mb-2.5 text-xs">
        Everyone in the club sees this and anyone can answer — you don&apos;t
        need to be on the project.
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink ml-3 text-sm font-semibold"
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
        className="rounded-tile border-line text-ink hover:bg-surface border px-3 py-1.5 text-sm font-semibold"
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
      className="rounded-tile border-line bg-surface mt-3 w-full border p-3"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <textarea
        name="body"
        rows={2}
        required
        placeholder="What they should try, or who to talk to."
        className="rounded-tile border-line bg-card text-ink mb-2.5 w-full border px-3 py-2 text-[15px]"
      />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink ml-3 text-sm font-semibold"
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
        className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
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
      className="rounded-tile border-line bg-surface mt-3 w-full border p-3"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          How did it get sorted?
        </span>
        <input
          type="text"
          name="note"
          placeholder="Rosa walked me through the mate constraints."
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
      </label>
      <p className="text-ink-muted mt-1 mb-2.5 text-xs">
        Optional, and worth the ten seconds — the next person with this problem
        finds the answer here.
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink ml-3 text-sm font-semibold"
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
        className="text-ink-muted hover:text-risk-fg text-sm font-semibold"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-ink-soft text-sm">Delete this ask?</span>
      <ActionButton
        action={deleteHelpRequestAction}
        fields={{ requestId }}
        label="Yes, delete"
        pendingLabel="Deleting…"
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
