"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { ActionForm } from "./action-form";
import { logHoursAction } from "@/lib/actions";

/**
 * Quick-add for hours. Phase 3's whole point.
 *
 * This is the highest-frequency action in the app, and it happens in the lab, on
 * a phone, at the end of a session when nobody wants to fill in a form. So every
 * field that can be pre-filled is:
 *
 *   - the date defaults to today
 *   - the project defaults to whichever you logged against last
 *   - "what you did" is optional
 *
 * Which makes the common case two taps and a number. If logging hours takes
 * longer than that, people stop, and every downstream signal — the contribution
 * record, update auto-drafts, the RE's view of who's actually working — degrades
 * with it.
 *
 * Collapsed by default so it never competes with the page it sits on.
 */
export function LogHoursForm({
  projects,
  defaultProjectId,
  today,
  maxBackdateDays,
}: {
  projects: { id: string; name: string }[];
  defaultProjectId?: string;
  today: string;
  maxBackdateDays: number;
}) {
  const [open, setOpen] = useState(false);

  if (projects.length === 0) {
    // Nothing to log against. Say so plainly rather than showing a form whose
    // only dropdown is empty.
    return (
      <p className="text-sm text-ink-muted">
        You&apos;re not on any projects yet, so there&apos;s nothing to log hours
        against.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-tile bg-cardinal-600 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-cardinal-700"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        Log hours
      </button>
    );
  }

  // The earliest date the server will accept. Set as `min` so the picker itself
  // prevents the mistake, rather than letting someone fill the form and get
  // rejected — same rule as the server, enforced twice.
  const earliest = new Date(`${today}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - maxBackdateDays);

  return (
    <div className="rounded-card border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[15px] font-bold text-ink">Log hours</p>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-tile p-1 text-ink-muted hover:bg-surface"
        >
          <X className="size-4" />
        </button>
      </div>

      <ActionForm
        action={logHoursAction}
        submitLabel="Log it"
        submittingLabel="Logging…"
        resetOnSuccess
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Project
            </span>
            <select
              name="projectId"
              defaultValue={defaultProjectId ?? projects[0]?.id}
              required
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Hours
            </span>
            <input
              type="number"
              name="hours"
              step="0.5"
              min="0.5"
              max="16"
              required
              inputMode="decimal"
              placeholder="2.5"
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Date</span>
          <input
            type="date"
            name="workDate"
            defaultValue={today}
            min={earliest.toISOString().slice(0, 10)}
            max={today}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink sm:w-auto"
          />
          <span className="mt-1 block text-xs text-ink-muted">
            Up to {maxBackdateDays} days back.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            What you did{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="text"
            name="description"
            placeholder="Mesh refinement on the spar model"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </label>
      </ActionForm>
    </div>
  );
}
