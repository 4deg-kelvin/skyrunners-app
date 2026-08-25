/**
 * ============================================================================
 * Timeline geometry — dates in, percentages out
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * What this is NOT
 * ---------------------------------------------------------------------------
 *
 * `docs/DECISIONS.md` rejects a critical-path Gantt, and this is not one. There
 * are **no dependencies, no slack, no critical path, and nothing new for a PL
 * to maintain.** A dependency graph costs a PL an hour a week and is wrong the
 * day after it's entered, which on a volunteer team whose availability swings
 * with midterms makes it worse than nothing.
 *
 * This draws dates that already exist — a project's start and target, a
 * deliverable's due date — so you can see at a glance that three things land in
 * the same week. If it ever needs its own upkeep, it has become the thing that
 * was rejected. Read that paragraph again before adding a field.
 *
 * ---------------------------------------------------------------------------
 * Why the maths lives here and not in the component
 * ---------------------------------------------------------------------------
 *
 * Every value below is a percentage of a window computed from the data, and
 * off-by-one-day errors in date arithmetic are invisible in a rendered bar —
 * it just looks slightly wrong, and nobody can tell whether the schedule or the
 * chart is lying. Pure functions, so they can be tested.
 *
 * **All parsing is UTC.** `lib/mock-data.ts` warns about this and it bites here
 * hardest: `"2026-09-30"` parses as UTC midnight while `"2026-09-30T18:00"`
 * parses as LOCAL, so mixing them silently shifts a bar by a day, and west of
 * Greenwich a bare UTC midnight formats as the day before.
 */

const DAY_MS = 86_400_000;

/** Midnight UTC for a date-only or datetime string. */
function utc(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type GanttTone = "ok" | "warn" | "risk" | "done" | "neutral";

export interface GanttRow {
  id: string;
  name: string;
  /** Where clicking it goes. Deliverables have nowhere to go. */
  href?: string;
  /** Missing start means "we don't know" — see `hasStart` on the output. */
  start?: string;
  end?: string;
  /**
   * The date this project was ORIGINALLY due, when that differs from `end`.
   *
   * `min(fromDate)` across the project's `project_deadline_changes` — the first
   * date anybody committed to, before any slip. Drawn as a ghost marker so the
   * chart shows the schedule moving rather than only its current state; a Gantt
   * that silently redraws itself every time a date is pushed is a chart nobody
   * can use to notice that a project keeps slipping.
   *
   * Projects only. A deliverable has no baseline because nothing records moves
   * of its due date — if that ever changes, this field generalises unchanged.
   */
  baselineEnd?: string;
  /** 0 for a division's own projects, 1 for their children, and so on. */
  depth: number;
  tone: GanttTone;
  /** 0–1, drawn as a fill inside the bar. Undefined draws none. */
  progress?: number;
  /**
   * A span or a point.
   *
   * `project` is a span. `deliverable` and `event` are both single dates — a
   * deliverable has one owner and one due date by design, and a build session
   * happens at a time. Giving either a width would invent a duration the model
   * doesn't have.
   */
  kind: "project" | "deliverable" | "event";
}

export interface GanttBar extends GanttRow {
  /** Percent of the window. Always within 0–100. */
  leftPct: number;
  widthPct: number;
  /**
   * Whether the bar's edges are real dates or the window's.
   *
   * A project with no target would otherwise draw a confident bar ending on a
   * date nobody chose. The component renders those edges open, so "undated"
   * reads as undated rather than as a decision.
   */
  hasStart: boolean;
  hasEnd: boolean;
  /**
   * Where the original due date sits, as a percent of the window.
   *
   * Undefined when the project never slipped, when it has no baseline, OR when
   * the baseline falls outside a narrowed window. That last case matters: a
   * clamped marker would sit glued to the left edge pointing at a date the chart
   * doesn't cover, which reads as "due now" — the same trap the `drawn` filter
   * below exists to avoid for finished rows.
   */
  baselineEndPct?: number;
}

export interface GanttChart {
  bars: GanttBar[];
  windowStart: string;
  windowEnd: string;
  /** Null when today falls outside the window — don't draw a line off-chart. */
  todayPct: number | null;
  /** Month boundaries inside the window, for the axis. */
  ticks: { label: string; leftPct: number }[];
  /**
   * Rows dropped by the depth cap.
   *
   * Reported rather than silently omitted. A chart that looks complete and
   * isn't is worse than one that says what it left out — same rule as every
   * other truncation in this app.
   */
  hiddenCount: number;
}

/** Deepest level of sub-project drawn. 0 = top-level only. */
export const MAX_GANTT_DEPTH = 2;

/**
 * Lay rows out across a window fitted to the dates present.
 *
 * Auto-fitting rather than using the term or a fixed horizon: a division whose
 * only project is due in December would otherwise render as an empty strip with
 * one bar off the right-hand edge, and clipping at a term boundary hides
 * exactly the long-running work worth seeing.
 */
export function buildGantt(
  rows: GanttRow[],
  today: string,
  options: {
    maxDepth?: number;
    /**
     * Start the window at today, giving the whole width to what's ahead.
     *
     * For the DIVISION chart, whose question is "what is this division about to
     * have to deliver". A division six months in spends most of its chart on
     * finished work, squeezing everything still live into the last inch — the
     * part somebody can actually act on gets the least room.
     *
     * **Unless something is behind schedule**, and that exception is the whole
     * point. Clipping unconditionally would hide the one thing nobody may miss:
     * a deadline that has already gone. So the left edge is the **furthest-back
     * overdue item**, or today when nothing has slipped — a slip drags the
     * window back far enough to show itself, and the chart says how far behind
     * it is by how much of the past it had to include.
     *
     * Behind schedule means an end date in the past and a tone that isn't
     * `done`. **`done`, not `ok`** — `projectTone` returns `"done"` for a
     * complete project and `"ok"` for one that is merely on track, and getting
     * that backwards is how this feature broke on its first day: every division
     * with finished work behind it treated that history as overdue and dragged
     * the window all the way to the beginning, which is the exact behaviour the
     * clipping exists to prevent. `"ok"` cannot be overdue anyway — `pastTarget`
     * turns it into `"warn"` — so excluding it was doing nothing at all.
     *
     * Off for the PROJECT chart, deliberately. That one answers "how has my
     * work gone", and its own history is half the answer.
     */
    clipToToday?: boolean;
    /**
     * Open the window on a date the reader chose. Overrides `clipToToday`.
     *
     * The escape hatch for the division chart: the default is "what's ahead",
     * and this is how somebody goes looking at what happened. Clamped to the
     * earliest date actually present, so asking for 2019 doesn't produce four
     * years of empty axis; and never later than the last date, so it can't
     * produce a window with nothing in it.
     */
    from?: string;
  } = {}
): GanttChart {
  const maxDepth = options.maxDepth ?? MAX_GANTT_DEPTH;
  const visible = rows.filter((r) => r.depth <= maxDepth);
  const hiddenCount = rows.length - visible.length;

  const dates: number[] = [];
  for (const r of visible) {
    if (r.start) dates.push(utc(r.start));
    if (r.end) dates.push(utc(r.end));
    /*
      A baseline counts as content, so the window always covers it.

      Without this the original date could fall left of the window and clamp to
      0, drawing a marker on a date the chart doesn't show. It cannot widen the
      window the wrong way — a baseline is by construction EARLIER than the
      current end, so `max` is untouched — and it cannot defeat the division
      chart's clipping either, because `clipToToday` derives `min` from today and
      the earliest overdue row rather than from `naturalMin`.
    */
    if (r.baselineEnd) dates.push(utc(r.baselineEnd));
  }
  // Today is always inside the window. A chart of past deadlines with no "now"
  // on it can't answer the only question people bring to it.
  dates.push(utc(today));

  let min = Math.min(...dates);
  let max = Math.max(...dates);

  /*
    The window's natural left edge, before anybody narrows it. Both narrowing
    modes clamp to this, so neither can open the chart earlier than its own
    content and leave dead space on the left.
  */
  const naturalMin = min;

  if (options.from) {
    min = Math.min(Math.max(utc(options.from), naturalMin), max);
  } else if (options.clipToToday) {
    const todayMs = utc(today);
    /*
      The furthest-back thing that has slipped, or today if nothing has.
      `Infinity` when the list is empty, so the `Math.min` below falls through
      to today.
    */
    const earliestOverdue = Math.min(
      ...visible
        .filter((r) => r.end && r.tone !== "done" && utc(r.end) < todayMs)
        .map((r) => utc(r.end!)),
      Infinity
    );
    // Never move the edge FORWARD past existing content — a window that starts
    // after everything in it is an empty chart.
    min = Math.min(Math.min(todayMs, earliestOverdue), max);
  }

  /*
    A window has to have width.

    Everything landing on one day — one project, no start date, due today — is
    a real case, and `(x - min) / 0` is NaN, which renders as a bar with no
    style and no error. Pad to a week so single-point charts still read as a
    timeline.
  */
  if (max - min < 7 * DAY_MS) {
    const pad = (7 * DAY_MS - (max - min)) / 2;
    min -= pad;
    max += pad;
  }

  const span = max - min;
  const pct = (ms: number) => ((ms - min) / span) * 100;
  const clamp = (n: number) => Math.max(0, Math.min(100, n));

  /*
    Anything that finished before the window is dropped, not squashed.

    Only reachable when the window has been narrowed, and only for work that is
    genuinely `done`: an overdue row drags the window back far enough to include
    itself, so it can't be clipped by definition. With an explicit `from` the
    reader has asked for a narrower view, and dropping what falls outside it is
    the whole point of asking. Without this a completed deliverable from
    three months ago clamps to `leftPct: 0, widthPct: 0` and renders as a
    diamond glued to the left edge — a marker pointing at a date that isn't on
    the chart, which reads as due-now rather than long finished.

    Not counted into `hiddenCount`: that number is reported to the reader as
    "N deeper sub-projects hidden", and folding a different kind of omission
    into it would make the sentence false.
  */
  const narrowed = min > naturalMin;
  const drawn = narrowed
    ? visible.filter((r) => !r.end || utc(r.end) >= min)
    : visible;

  const bars: GanttBar[] = drawn.map((r) => {
    const hasStart = Boolean(r.start);
    const hasEnd = Boolean(r.end);

    /*
      Deliverables are a DATE, projects are a SPAN.

      The deliverable model is one owner, one date, one status — deliberately
      no start, no duration, no dependencies. So a deliverable collapses to a
      zero-width marker on its due date, which the component draws as a
      diamond. Sweeping it from the window's left edge would invent a duration
      the model doesn't have and make one due date look like a month of work.

      A PROJECT with no start is different: it has a span, we just don't know
      where it began. That one opens at the window edge with `hasStart: false`,
      and the component renders the edge open so it reads as unknown.
    */
    const isPoint = r.kind !== "project";
    const startMs = isPoint
      ? hasEnd
        ? utc(r.end!)
        : min
      : hasStart
        ? utc(r.start!)
        : min;
    const endMs = hasEnd ? utc(r.end!) : hasStart ? max : min;

    const left = clamp(pct(Math.min(startMs, endMs)));
    const right = clamp(pct(Math.max(startMs, endMs)));

    /*
      The original due date, only when it is genuinely on the chart.

      NOT clamped, deliberately — omitted instead. A clamped baseline would draw
      at the window edge on a date the chart doesn't cover, and a marker pointing
      at the wrong date is worse than no marker: the reader has no way to tell
      the difference. `undefined` lets the component simply not draw it.

      Also skipped when it equals the current end, which happens if a date was
      pushed and later pulled back to where it started. The history still records
      both moves; the chart has nothing to show, because nothing net-moved.
    */
    /*
      Deliverables get one too, since migration 0042.

      This was `r.kind === "project"` and the comment on `baselineEnd` said
      deliverables have no baseline "because nothing records moves of its due
      date". That stopped being true the moment deliverables became pushable, and
      the symptom was Anish pushing one back and seeing no change on the chart —
      the whole point of drawing a baseline is that a slip is visible.

      No kind check at all now: a row has a baseline or it doesn't, and the caller
      decides. Events still never pass one.
    */
    let baselineEndPct: number | undefined;
    if (r.baselineEnd && hasEnd) {
      const baseMs = utc(r.baselineEnd);
      if (baseMs >= min && baseMs <= max && baseMs !== utc(r.end!)) {
        baselineEndPct = pct(baseMs);
      }
    }

    return {
      ...r,
      leftPct: left,
      widthPct: Math.max(0, right - left),
      baselineEndPct,
      /*
        A project that began before the window reads as open-ended on the left,
        the same way one with no recorded start does. Both mean "it didn't start
        here" — closing the edge at the window boundary would claim the work
        began today, which is the opposite of the truth for long-running work.
      */
      hasStart: hasStart && startMs >= min,
      hasEnd,
    };
  });

  const todayMs = utc(today);
  const todayPct =
    todayMs >= min && todayMs <= max ? clamp(pct(todayMs)) : null;

  return {
    bars,
    windowStart: isoOf(min),
    windowEnd: isoOf(max),
    todayPct,
    ticks: monthTicks(min, max, pct),
    hiddenCount,
  };
}

/**
 * One tick per month boundary inside the window.
 *
 * Months rather than evenly-spaced dates because people schedule by month —
 * "the spar is due in October" is how the club talks, and a tick reading
 * "Oct 3" invites the reader to measure rather than glance. The first boundary
 * is skipped when it's within 5% of the left edge, where the label would
 * collide with the row names.
 */
function monthTicks(
  min: number,
  max: number,
  pct: (ms: number) => number
): { label: string; leftPct: number }[] {
  const ticks: { label: string; leftPct: number }[] = [];
  const cursor = new Date(min);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);

  // A very wide window would otherwise produce a tick every few pixels.
  const months = (max - min) / (30 * DAY_MS);
  const step = months > 18 ? 3 : months > 9 ? 2 : 1;

  let i = 0;
  while (cursor.getTime() <= max) {
    const at = cursor.getTime();
    if (at >= min && i % step === 0) {
      const leftPct = pct(at);
      if (leftPct >= 4 && leftPct <= 98) {
        ticks.push({
          label: cursor.toLocaleDateString("en-US", {
            month: "short",
            timeZone: "UTC",
          }),
          leftPct,
        });
      }
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    i++;
  }
  return ticks;
}

/**
 * The tone a project's bar takes.
 *
 * Complete wins over everything: a finished project isn't "at risk", whatever
 * its health field still says, and leaving it red would be the chart arguing
 * with the badge next to it.
 */
export function projectTone(
  phase: string,
  health: string,
  pastTarget: boolean
): GanttTone {
  if (phase === "complete") return "done";
  if (health === "blocked") return "risk";
  if (health === "at_risk" || pastTarget) return "warn";
  return "ok";
}
