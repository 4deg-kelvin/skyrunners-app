"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { ActionForm } from "./action-form";
import { updateClubTiersAction } from "@/lib/actions";
import { TIER_LABELS, type TierThresholds } from "@/lib/contribution";

/**
 * Move the bar the whole club is measured against.
 *
 * This lives in Settings next to the academic calendar and the trainings
 * catalogue, and for the same reason all three are editable at all: the club
 * changes faster than anyone ships a deploy. These four numbers were constants
 * in `lib/contribution.ts`, printed verbatim by the published rubric at
 * `/how-we-lead` — so the first time leadership adjusted the expectation in a
 * meeting, the page telling members what the bar is would have been stating a
 * number nobody used.
 *
 * The order rule is enforced twice more, in `updateClubTiers` and in a check
 * constraint, because getting it wrong is silent: `commitmentTier` walks the
 * rungs highest first and returns the first one you clear, so an out-of-order
 * ladder puts everybody in whichever tier happens to sit at the top.
 */
export function TierAdminForm({ tiers }: { tiers: TierThresholds }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold"
      >
        <SlidersHorizontal className="size-3.5" strokeWidth={2.5} />
        Edit expectations
      </button>
    );
  }

  const field = (
    name: keyof TierThresholds,
    label: string,
    hint: string,
    value: number
  ) => (
    <label className="block">
      <span className="text-ink mb-1 block text-sm font-semibold">{label}</span>
      <input
        type="number"
        name={name}
        required
        min={0}
        max={168}
        step={0.5}
        defaultValue={value}
        className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
      />
      <span className="text-ink-muted mt-1 block text-xs">{hint}</span>
    </label>
  );

  return (
    <ActionForm
      action={updateClubTiersAction}
      submitLabel="Save expectations"
      submittingLabel="Saving…"
      onSuccess={() => setOpen(false)}
      className="rounded-tile border-line bg-surface mt-3 w-full border p-3.5 text-left"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field(
          "core",
          `${TIER_LABELS.core} at`,
          "Hours a week for the top rung.",
          tiers.core
        )}
        {field(
          "committed",
          `${TIER_LABELS.committed} at`,
          "Has to be below Core.",
          tiers.committed
        )}
        {field(
          "contributing",
          `${TIER_LABELS.contributing} at`,
          "Below this is “getting started”.",
          tiers.contributing
        )}
        {field(
          "minimum",
          "Minimum",
          "The low end of the range published on /how-we-lead.",
          tiers.minimum
        )}
      </div>

      <p className="text-ink-muted mt-3 mb-2.5 text-xs">
        These are the numbers on{" "}
        <span className="text-ink font-semibold">/how-we-lead</span>, and the
        rungs on everyone&apos;s contribution panel. They have to go up in order
        — Core above Committed above Contributing — or every member would land
        in whichever tier sits highest. Nobody&apos;s hours change; only what
        the club calls them.
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
