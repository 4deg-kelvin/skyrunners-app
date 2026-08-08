"use client";

import { ActionButton } from "./action-form";
import { markUpdateReviewedAction } from "@/lib/actions";

/**
 * "Mark as read" on a check-in.
 *
 * Deliberately one click with no confirmation and no form. The design target is
 * a Lead's whole weekly obligation fitting in fifteen minutes; anything that
 * turns clearing the queue into a chore gets skipped, and a skipped queue is
 * exactly the failure this whole mechanism exists to prevent.
 *
 * `authorId` is passed so the action can check the viewer is actually in that
 * person's Lead chain. It's re-derived server-side against the org graph, so a
 * forged value buys nothing.
 */
export function MarkReviewedButton({
  updateId,
  authorId,
}: {
  updateId: string;
  authorId: string;
}) {
  return (
    <ActionButton
      action={markUpdateReviewedAction}
      fields={{ updateId, authorId }}
      label="Mark as read"
      pendingLabel="Saving…"
      tone="primary"
    />
  );
}
