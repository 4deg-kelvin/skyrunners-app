"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, TriangleAlert } from "lucide-react";

import { Badge } from "./badge";
import type { DeadlineItem } from "@/lib/data/deadlines";

/**
 * Two collapsed strips at the bottom of a division card: what's due, and
 * what's stuck.
 *
 * ---------------------------------------------------------------------------
 * Why these aren't pages any more
 * ---------------------------------------------------------------------------
 *
 * `/deadlines` and `/blockers` were both top-level nav items for a day, and
 * the nav hit eight entries — at which point the nav itself becomes the thing
 * you have to learn. Neither page was wrong; both were the wrong SIZE. A
 * deadline is a property of a project, and a blocker is already surfaced by
 * the "N blocked" badge on the project row. Making each a destination asked
 * people to go somewhere to find out something about a project they were
 * already looking at.
 *
 * Collapsed by default, both of them. The division card's job is still the
 * project tree; these are the two questions you ask *about* that tree once
 * you've read it, and a page that answers unasked questions in full is the
 * clutter this consolidation was for.
 */
export function DivisionExtras({
  deadlines,
  blocked,
  today,
}: {
  deadlines: DeadlineItem[];
  /** Projects in this division with blocked work or an unanswered blocker. */
  blocked: {
    projectId: string;
    projectSlug: string;
    projectName: string;
    count: number;
    /** The oldest thing waiting, in days. Age is what makes it actionable. */
    worstAgeDays: number;
  }[];
  today: string;
}) {
  const [showDeadlines, setShowDeadlines] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);

  const live = deadlines.filter((d) => !d.done);
  const overdue = live.filter((d) => d.overdue).length;
  const blockedTotal = blocked.reduce((n, b) => n + b.count, 0);

  if (live.length === 0 && blockedTotal === 0) return null;

  return (
    <div className="border-line mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t pt-4">
      {live.length > 0 ? (
        <div className="w-full">
          <button
            type="button"
            onClick={() => setShowDeadlines(!showDeadlines)}
            aria-expanded={showDeadlines}
            className="text-ink-soft hover:text-ink inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
          >
            <CalendarDays className="size-3.5" />
            {live.length} upcoming date{live.length === 1 ? "" : "s"}
            {overdue > 0 ? (
              <span className="text-risk-fg">· {overdue} overdue</span>
            ) : null}
            <span className="text-ink-muted font-normal">
              {showDeadlines ? "(hide)" : "(show)"}
            </span>
          </button>

          {showDeadlines ? (
            <div className="mt-2.5 space-y-1.5">
              {live.map((item) => (
                <div
                  key={item.key}
                  className="rounded-tile border-line flex flex-wrap items-center justify-between gap-2 border px-3 py-1.5"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {/*
                      Fixed-width date column — what makes a list of dates scan
                      as a timeline rather than as prose.
                    */}
                    <span
                      className={`w-14 shrink-0 text-sm font-bold tabular-nums ${
                        item.overdue ? "text-risk-fg" : "text-ink"
                      }`}
                    >
                      {new Date(`${item.date}T00:00:00Z`).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric", timeZone: "UTC" }
                      )}
                    </span>
                    <span className="text-ink min-w-0 text-sm">
                      {item.title}
                      {item.kind === "project" ? (
                        <Badge tone="cardinal">Target</Badge>
                      ) : (
                        <span className="text-ink-muted">
                          {" "}
                          · {item.project.name}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="text-ink-muted shrink-0 text-xs">
                    {item.overdue
                      ? `${Math.abs(item.daysAway)}d overdue`
                      : item.daysAway === 0
                        ? "today"
                        : `in ${item.daysAway}d`}
                  </span>
                </div>
              ))}
              <p className="text-ink-muted pt-1 text-xs">
                Built from project targets and deliverable due dates — nothing
                separate to keep up to date. Also on the calendar.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {blockedTotal > 0 ? (
        <div className="w-full">
          <button
            type="button"
            onClick={() => setShowBlocked(!showBlocked)}
            aria-expanded={showBlocked}
            className="text-risk-fg inline-flex items-center gap-1.5 text-sm font-semibold transition-colors hover:opacity-80"
          >
            <TriangleAlert className="size-3.5" />
            {blockedTotal} blocked
            <span className="text-ink-muted font-normal">
              {showBlocked ? "(hide)" : "(show)"}
            </span>
          </button>

          {showBlocked ? (
            <div className="mt-2.5 space-y-1.5">
              {blocked.map((row) => (
                <Link
                  key={row.projectId}
                  href={`/projects/${row.projectSlug}`}
                  className="rounded-tile border-risk-fg/25 bg-risk-bg flex flex-wrap items-center justify-between gap-2 border px-3 py-1.5 transition-opacity hover:opacity-90"
                >
                  <span className="text-ink text-sm font-semibold">
                    {row.projectName}
                  </span>
                  <span className="text-ink-muted text-xs">
                    {row.count} blocked ·{" "}
                    {row.worstAgeDays === 0
                      ? "today"
                      : `oldest ${row.worstAgeDays}d`}
                  </span>
                </Link>
              ))}
              <p className="text-ink-muted pt-1 text-xs">
                Clear these on the project — its RE is the one who can.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <span className="sr-only">Dates as of {today}</span>
    </div>
  );
}
