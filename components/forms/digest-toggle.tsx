"use client";

import { useState } from "react";

import { ActionForm } from "./action-form";
import { setDailyDigestAction } from "@/lib/actions";

/**
 * The off switch for the daily digest.
 *
 * Exists because a daily DM with no way to stop it is how a club mutes a bot —
 * and muting takes the blocker alerts and check-in reminders with it, which are
 * the messages that actually matter. Cheaper to offer the switch than to lose
 * the channel.
 *
 * Only rendered for people who would actually receive one. Showing a plain
 * member a toggle for a message they never get is a setting that does nothing,
 * which is its own small lie.
 */
export function DigestToggle({
  optedOut,
  reasons,
}: {
  optedOut: boolean;
  /** Why they get one — "PL of 3 projects", "Lead to 4 people". */
  reasons: string[];
}) {
  const [off, setOff] = useState(optedOut);

  return (
    <ActionForm
      action={setDailyDigestAction}
      submitLabel="Save"
      submittingLabel="Saving…"
    >
      <label className="rounded-tile border-line bg-surface flex items-start gap-2.5 border p-3">
        <input
          type="checkbox"
          name="optOut"
          checked={off}
          onChange={(e) => setOff(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span className="text-ink-soft text-sm">
          <span className="text-ink font-semibold">
            Don&apos;t send me the daily digest.
          </span>{" "}
          You&apos;d otherwise get one Discord message each evening
          {reasons.length ? ` — you're ${reasons.join(" and ")}` : ""}: what
          moved today, what&apos;s gone quiet and for how long, and anything due
          inside a week.
          <span className="text-ink-muted mt-1 block">
            Turning it off doesn&apos;t affect blocker alerts or check-in
            reminders.
          </span>
        </span>
      </label>
    </ActionForm>
  );
}
