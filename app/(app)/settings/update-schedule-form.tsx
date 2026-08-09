"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { ActionForm } from "@/components/forms/action-form";
import { SELECTABLE_UPDATE_DAYS, WEEKDAY_NAMES, WEEKDAY_SHORT } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { setUpdateScheduleAction } from "@/lib/actions";

/**
 * Pick which weekdays you submit updates on.
 *
 * Two a week, spaced out, so there's a real gap of work between them and each
 * one has something to say. The whole point of the cadence is to prompt a
 * conversation with your Lead — a check-in with nothing in it does the opposite.
 */
export function UpdateScheduleForm({
  updatesPerWeek,
  initialWeekdays,
  disabled,
}: {
  updatesPerWeek: number;
  initialWeekdays: number[];
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<number[]>(initialWeekdays);

  function toggle(day: number) {
    setSelected((current) => {
      if (current.includes(day)) {
        return current.filter((d) => d !== day);
      }
      if (current.length >= updatesPerWeek) {
        // At the limit: replace the earliest pick rather than refusing the
        // click. Silently doing nothing feels broken.
        const [, ...rest] = [...current].sort((a, b) => a - b);
        return [...rest, day].sort((a, b) => a - b);
      }
      return [...current, day].sort((a, b) => a - b);
    });
  }

  const complete = selected.length === updatesPerWeek;

  // Flag picks with no working days between them — two updates on Mon and Tue
  // technically satisfies the rule and defeats its purpose.
  const tooClose =
    complete &&
    selected.length === 2 &&
    Math.abs(selected[1] - selected[0]) < 2;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {SELECTABLE_UPDATE_DAYS.map((day) => {
          const isOn = selected.includes(day);
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => toggle(day)}
              aria-pressed={isOn}
              aria-label={WEEKDAY_NAMES[day]}
              className={cn(
                "flex min-w-[76px] items-center justify-center gap-1.5 rounded-tile border px-4 py-3 text-sm font-semibold transition-colors",
                isOn
                  ? "border-cardinal-600 bg-cardinal-600 text-white"
                  : "border-line bg-card text-ink-soft hover:bg-surface",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {isOn ? <Check className="size-3.5" strokeWidth={3} /> : null}
              {WEEKDAY_SHORT[day]}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-sm text-ink-muted">
        {complete
          ? `You'll submit on ${selected.map((d) => WEEKDAY_NAMES[d]).join(" and ")}, due 11:59 PM.`
          : `Pick ${updatesPerWeek - selected.length} more day${updatesPerWeek - selected.length === 1 ? "" : "s"}.`}
      </p>

      {tooClose ? (
        <p className="mt-2 text-sm font-medium text-warn-fg">
          Those are back-to-back. Spreading them out gives you real progress to
          report each time — try Monday and Thursday.
        </p>
      ) : null}

      <div className="mt-5">
        <ActionForm
          action={setUpdateScheduleAction}
          submitLabel="Save schedule"
          submittingLabel="Saving…"
          disabled={disabled || !complete}
        >
          <input type="hidden" name="weekdays" value={selected.join(",")} />
        </ActionForm>
      </div>
    </div>
  );
}
