import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { Badge } from "./badge";
import type { MilestoneStage } from "@/lib/milestones";
import {
  MILESTONE_STAGE_LABELS,
  MILESTONE_STAGE_TONES,
  DELIVERABLE_STATUS_LABELS,
  DELIVERABLE_STATUS_TONES,
} from "@/lib/labels";
import type { Deliverable, Member } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/dates";

/**
 * One line of a project's deliverable list.
 *
 * Deliberately plain: title, owner, date, status. No drag handles, no nesting,
 * no dependency arrows. A PL has to be able to keep this list honest in five
 * minutes a week, and every extra field is a reason not to.
 */
export function DeliverableRow({
  deliverable,
  owner,
  overdue,
  showOwner = true,
  className,
  milestoneStage,
}: {
  deliverable: Deliverable;
  owner?: Member;
  overdue?: boolean;
  showOwner?: boolean;
  className?: string;
  /**
   * A milestone s derived stage, from the view model.
   *
   * Absent on a deliverable, and absent on callers that have not been given
   * it — those fall back to the stored status, which is right for a
   * deliverable and merely uninformative for a milestone.
   */
  milestoneStage?: MilestoneStage;
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
          {/*
            A TRIANGLE, matching the timeline.

            This was "◆", the same glyph the chart uses for a DELIVERABLE, so
            the two surfaces disagreed about which shape meant which thing the
            moment the chart gave milestones their own silhouette.
          */}
          {deliverable.kind === "milestone" ? (
            <span className="text-info-fg mr-2" aria-hidden>
              ▲
            </span>
          ) : null}
          {deliverable.title}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {/*
            A milestone's badge comes from its DERIVED stage, a deliverable's
            from its stored status. The stage already folds "overdue" in, so
            the separate Overdue badge would be a duplicate on those rows.
          */}
          {overdue && !milestoneStage ? (
            <Badge tone="risk">Overdue</Badge>
          ) : null}
          {milestoneStage ? (
            <Badge tone={MILESTONE_STAGE_TONES[milestoneStage]}>
              {MILESTONE_STAGE_LABELS[milestoneStage]}
            </Badge>
          ) : (
            <Badge tone={DELIVERABLE_STATUS_TONES[deliverable.status]}>
              {DELIVERABLE_STATUS_LABELS[deliverable.status]}
            </Badge>
          )}
        </div>
      </div>

      <div className="text-ink-muted mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {deliverable.kind === "milestone" ? (
          <span className="text-info-fg font-medium">Milestone</span>
        ) : null}
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
            {done ? "Was due" : "Due"} {formatDay(deliverable.dueDate)}
          </span>
        ) : (
          <span>No date set</span>
        )}
        {deliverable.completedAt ? (
          <span className="text-ok-fg">
            Done {formatDay(deliverable.completedAt)}
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
