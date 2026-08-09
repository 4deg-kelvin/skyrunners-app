import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { Badge } from "./badge";
import {
  DELIVERABLE_STATUS_LABELS,
  DELIVERABLE_STATUS_TONES,
} from "@/lib/labels";
import type { Deliverable, Member } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One line of a project's deliverable list.
 *
 * Deliberately plain: title, owner, date, status. No drag handles, no nesting,
 * no dependency arrows. An RE has to be able to keep this list honest in five
 * minutes a week, and every extra field is a reason not to.
 */
export function DeliverableRow({
  deliverable,
  owner,
  overdue,
  showOwner = true,
  className,
}: {
  deliverable: Deliverable;
  owner?: Member;
  overdue?: boolean;
  showOwner?: boolean;
  className?: string;
}) {
  const done = deliverable.status === "done";

  return (
    <div
      className={cn(
        "rounded-tile border-line border px-4 py-3",
        done && "opacity-60",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p
          className={cn(
            "text-ink text-[15px] font-semibold",
            done && "line-through"
          )}
        >
          {deliverable.title}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {overdue ? <Badge tone="risk">Overdue</Badge> : null}
          <Badge tone={DELIVERABLE_STATUS_TONES[deliverable.status]}>
            {DELIVERABLE_STATUS_LABELS[deliverable.status]}
          </Badge>
        </div>
      </div>

      <div className="text-ink-muted mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {showOwner && owner ? (
          <Link
            href={`/members/${owner.id}`}
            className="text-ink-soft hover:text-cardinal-600 font-medium"
          >
            {owner.fullName}
          </Link>
        ) : null}
        {deliverable.dueDate ? (
          <span>
            {done ? "Was due" : "Due"}{" "}
            {new Date(deliverable.dueDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        ) : (
          <span>No date set</span>
        )}
        {deliverable.completedAt ? (
          <span className="text-ok-fg">
            Done{" "}
            {new Date(deliverable.completedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        ) : null}
      </div>

      {deliverable.blockerNote ? (
        <p className="text-ink-soft mt-2 flex items-start gap-1.5 text-sm">
          <TriangleAlert className="text-cardinal-600 mt-0.5 size-3.5 shrink-0" />
          <span className="font-medium">{deliverable.blockerNote}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Thin progress bar for a project's deliverable completion. */
export function ProgressBar({
  fraction,
  className,
}: {
  fraction: number;
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="bg-line h-1.5 flex-1 overflow-hidden rounded-full">
        <div
          className="bg-cardinal-600 h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-ink-muted shrink-0 text-xs font-semibold">
        {pct}%
      </span>
    </div>
  );
}
