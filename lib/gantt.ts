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
 * are **no dependencies, no slack, no critical path, and nothing new for an RE
 * to maintain.** A dependency graph costs an RE an hour a week and is wrong the
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
  /** 0 for a division's own projects, 1 for their children, and so on. */
  depth: number;
  tone: GanttTone;
  /** 0–1, drawn as a fill inside the bar. Undefined draws none. */
  progress?: number;
  kind: "project" | "deliverable";
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
  maxDepth: number = MAX_GANTT_DEPTH
): GanttChart {
  const visible = rows.filter((r) => r.depth <= maxDepth);
  const hiddenCount = rows.length - visible.length;

  const dates: number[] = [];
  for (const r of visible) {
    if (r.start) dates.push(utc(r.start));
    if (r.end) dates.push(utc(r.end));
  }
  // Today is always inside the window. A chart of past deadlines with no "now"
  // on it can't answer the only question people bring to it.
  dates.push(utc(today));

  let min = Math.min(...dates);
  let max = Math.max(...dates);

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

  const bars: GanttBar[] = visible.map((r) => {
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
    const startMs =
      r.kind === "deliverable"
        ? hasEnd
          ? utc(r.end!)
          : min
        : hasStart
          ? utc(r.start!)
          : min;
    const endMs = hasEnd ? utc(r.end!) : hasStart ? max : min;

    const left = clamp(pct(Math.min(startMs, endMs)));
    const right = clamp(pct(Math.max(startMs, endMs)));

    return {
      ...r,
      leftPct: left,
      widthPct: Math.max(0, right - left),
      hasStart,
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
