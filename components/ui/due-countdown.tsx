import { CalendarClock } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * "12 days left" on a project a person is on.
 *
 * ---------------------------------------------------------------------------
 * Why a countdown and not just the date
 * ---------------------------------------------------------------------------
 *
 * A project card already carried its target date, and a date is something you
 * have to do arithmetic on before it means anything. "Sep 30" reads as
 * comfortably far away in August and as an emergency in late September, and
 * the card looks identical either way — so the card stops being the thing that
 * tells you.
 *
 * A number of days needs no arithmetic. That's the whole point of adding it
 * next to the hours: the two numbers together answer "how much have I put in,
 * and how long have I got".
 *
 * ---------------------------------------------------------------------------
 * Why the thresholds are what they are
 * ---------------------------------------------------------------------------
 *
 * Colour only past a week, because a countdown that is red for two months is a
 * countdown people stop seeing. Under 7 days is a week of real evenings and is
 * worth a warning; overdue is red and states the overrun rather than counting
 * down from a date that has already gone.
 */
export function DueCountdown({
  /** Whole days until the target. Negative means it has passed. */
  daysLeft,
  /** A finished project has no countdown, whatever its date said. */
  done = false,
  className,
}: {
  daysLeft?: number;
  done?: boolean;
  className?: string;
}) {
  // No target date set. Deliberately silent rather than "—": plenty of work
  // starts undated, and a placeholder on every card would be noise. The
  // projects page flags genuinely undated projects in one place instead.
  if (daysLeft === undefined || done) return null;

  const overdue = daysLeft < 0;
  const soon = daysLeft >= 0 && daysLeft <= 7;

  return (
    <span
      className={cn(
        "flex items-center gap-1.5",
        overdue
          ? "font-semibold text-risk-fg"
          : soon
            ? "font-semibold text-warn-fg"
            : "text-ink-muted",
        className
      )}
    >
      <CalendarClock className="size-3.5 shrink-0" />
      {overdue
        ? `${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? "day" : "days"} overdue`
        : daysLeft === 0
          ? "due today"
          : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}
    </span>
  );
}
