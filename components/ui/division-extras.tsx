"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, TriangleAlert } from "lucide-react";

import { Badge } from "./badge";
import type { DeadlineItem } from "@/lib/data/deadlines";
import { buildGantt, type GanttRow } from "@/lib/gantt";
import { Gantt } from "./gantt";
import { useHideCompleted } from "./completed-filter";

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
  timelineRows,
  timelineLiveRows,
  blocked,
  today,
}: {
  deadlines: DeadlineItem[];
  /**
   * The same dates as a picture, drawn above the list under the same toggle.
   *
   * One control rather than two: the chart and the list answer the same
   * question at different resolutions, so splitting them would put a second
   * toggle on every division card of an already dense page. The chart shows
   * that four things land in the same fortnight; the list says which days.
   */
  timelineRows: GanttRow[] | null;
  /** The same rows without finished work, for when the page toggle is on. */
  timelineLiveRows: GanttRow[] | null;
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
  const hideCompleted = useHideCompleted();

  /*
    Finished projects are off the chart by DEFAULT, not just when the page-wide
    switch is on.

    The chart's question is "what is this division about to have to deliver",
    and a completed bar cannot answer it — it's a green rectangle taking a full
    row to say something already true. A division with three years behind it
    would open as mostly history with the two live bars squeezed at the bottom,
    which is the same "buries the work you came for" problem the history window
    already solves in the other axis.

    Local rather than folded into `useHideCompleted`, because they are different
    questions: the page-wide switch is about the project LISTS, and somebody can
    reasonably want the completed list visible while still wanting a chart of
    live work only. Turning the page switch on still forces this off, so the
    stronger preference always wins.
  */
  const [showCompletedBars, setShowCompletedBars] = useState(false);
  const liveOnly = hideCompleted || !showCompletedBars;
  const rows = liveOnly ? timelineLiveRows : timelineRows;

  /** How many bars the default is holding back, so the toggle can say. */
  const completedCount =
    (timelineRows?.length ?? 0) - (timelineLiveRows?.length ?? 0);

  const [showDeadlines, setShowDeadlines] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  /*
    How far back the reader wants to look. `null` is the default view — today
    forward, dragged back only far enough to show anything overdue.

    Laid out here rather than on the server because the window auto-fits the
    dates present, so moving the left edge re-lays-out every bar. `buildGantt`
    is pure maths over a handful of rows; recomputing it on a keystroke is
    cheaper than a round trip, and the control stays instant.
  */
  const [historyFrom, setHistoryFrom] = useState<string | null>(null);
  const [pickingHistory, setPickingHistory] = useState(false);

  const shownTimeline = rows
    ? buildGantt(
        rows,
        today,
        historyFrom ? { from: historyFrom } : { clipToToday: true }
      )
    : null;

  /** The earliest date anywhere in this division — the floor for "all time". */
  const earliest = rows
    ?.flatMap((r) => [r.start, r.end])
    .filter((d): d is string => Boolean(d))
    .sort()[0];

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
              {/*
                Follows the page's own Hide-completed switch rather than
                inventing a second control. A division with three years of
                finished work behind it otherwise renders a chart that is
                mostly history, which buries the two bars somebody came to
                look at.
              */}
              {shownTimeline ? (
                <div className="rounded-tile border-line mb-3 border px-3 py-3">
                  <Gantt
                    chart={shownTimeline}
                    caption={
                      historyFrom
                        ? `${liveOnly ? "Live projects" : "Every project"} in this division from ${historyFrom}. The red line is today.`
                        : liveOnly
                          ? "Live projects in this division, from today on. The red line is today."
                          : "Every project in this division, from today on. The red line is today."
                    }
                  />

                  {/*
                    History is opt-in, and the default is deliberate.

                    The chart's question is "what is this division about to have
                    to deliver", so it opens at today and gives the whole width
                    to work somebody can still act on. But a Lead writing a
                    roll-up needs the other view, and a slipped date needs
                    context — so the window is theirs to move, from a control
                    that stays out of the way until asked for.
                  */}
                  <div className="border-line mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-2.5">
                    {pickingHistory ? (
                      <>
                        <label className="flex items-center gap-2">
                          <span className="text-ink-muted text-xs font-semibold">
                            Show from
                          </span>
                          <input
                            type="date"
                            value={historyFrom ?? today}
                            max={today}
                            min={earliest}
                            onChange={(e) =>
                              setHistoryFrom(e.target.value || null)
                            }
                            className="rounded-tile border-line bg-card text-ink border px-2 py-1 text-xs"
                          />
                        </label>
                        {earliest && earliest < today ? (
                          <button
                            type="button"
                            onClick={() => setHistoryFrom(earliest)}
                            className="text-cardinal-600 hover:text-cardinal-700 text-xs font-semibold"
                          >
                            All time
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setHistoryFrom(null);
                            setPickingHistory(false);
                          }}
                          className="text-ink-muted hover:text-ink text-xs font-semibold"
                        >
                          Back to today
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPickingHistory(true)}
                        className="text-ink-soft hover:text-ink text-xs font-semibold"
                      >
                        Show history →
                      </button>
                    )}

                    {/*
                      Only offered when it would change something, and hidden
                      entirely while the page-wide switch is on — that one is a
                      stronger statement, and a control that visibly does
                      nothing is worse than no control.
                    */}
                    {completedCount > 0 && !hideCompleted ? (
                      <button
                        type="button"
                        onClick={() => setShowCompletedBars((v) => !v)}
                        aria-pressed={showCompletedBars}
                        className="text-ink-soft hover:text-ink text-xs font-semibold"
                      >
                        {showCompletedBars ? "Hide" : "Show"} {completedCount}{" "}
                        completed
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
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
