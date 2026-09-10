import Link from "next/link";
import { GanttDependency } from "@/components/ui/gantt-dependency";
import { markAnchor, type GanttChart, type GanttTone } from "@/lib/gantt";
import { formatDay } from "@/lib/dates";

const ANCHOR_CLASSES = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
};
const TONES: Record<
  GanttTone,
  { bar: string; fill: string; dot: string; label: string }
> = {
  ok: {
    bar: "border-info-fg/50 bg-info-fg/15",
    fill: "bg-info-fg/50",
    dot: "bg-info-fg",
    label: "On track",
  },
  warn: {
    bar: "border-warn-fg/50 bg-warn-fg/15",
    fill: "bg-warn-fg/50",
    dot: "bg-warn-fg",
    label: "At risk",
  },
  risk: {
    bar: "border-risk-fg/50 bg-risk-fg/15",
    fill: "bg-risk-fg/50",
    dot: "bg-risk-fg",
    label: "Blocked / overdue",
  },
  done: {
    bar: "border-ok-fg/50 bg-ok-fg/20",
    fill: "bg-ok-fg/55",
    dot: "bg-ok-fg",
    label: "Complete",
  },
  neutral: {
    bar: "border-ink-muted/40 bg-ink-muted/10",
    fill: "bg-ink-muted/35",
    dot: "bg-ink-muted",
    label: "Scheduled",
  },
};
const day = (date: string) =>
  formatDay(date, { month: "short", day: "numeric" });

/**
 * One shape per kind of row, and they have to differ by SILHOUETTE.
 *
 * A milestone used to be a bigger, outlined version of the deliverable's
 * diamond. At the size these render — 10 to 14 pixels — "same shape, slightly
 * larger, thin ring" is not a distinction anybody makes without two of them
 * side by side to compare, and the legend said "Deliverable / milestone" as a
 * single entry, so there was nothing to compare against either.
 *
 * A triangle reads as different at a glance and at any size, which a square
 * would not: rotated 45 degrees a square IS the diamond, and unrotated it is a
 * diamond that looks misaligned rather than deliberate.
 *
 * `clip-path` rather than a border trick, because a CSS triangle built from
 * borders cannot take a background colour — and the background is what carries
 * health on this chart. The clip keeps `tone.dot` doing its job.
 */
const TRIANGLE = "[clip-path:polygon(50%_0%,100%_100%,0%_100%)]";

/**
 * The marker for a point row, sized for the track.
 *
 * Sizes are in PIXELS rather than Tailwind's scale, because a rotated square is
 * not as wide as its box: at 45 degrees a 13px square measures 13 × √2 ≈ 18px
 * corner to corner. Sizing the diamond and the triangle from the same number
 * would make the diamond look half again bigger than the milestone it is
 * supposed to rank below, so the box sizes are set to make the DRAWN widths
 * match instead — 18px each.
 *
 * All three grew on 2026-09-09. At 10px the diamond was a speck on a 64px row,
 * which is what made the whole chart read as small.
 */
function pointShape(kind: string): string {
  if (kind === "event") return "size-3 rounded-full";
  if (kind === "milestone") return `size-[18px] ${TRIANGLE}`;
  return "size-[13px] rotate-45";
}

/** The same vocabulary at dot size, beside the row's name. */
function dotShape(kind: string): string {
  if (kind === "project" || kind === "event") return "rounded-full";
  if (kind === "milestone") return TRIANGLE;
  return "rotate-45";
}

/** Presentation only. All dates, bounds, progress and dependency marks come from
 * buildGantt unchanged. The axis, grid and today line share the exact track inset.
 * Fixed columns keep that coordinate system intact when the chart scrolls. */
export function Gantt({
  chart,
  caption,
  compact = false,
}: {
  chart: GanttChart;
  caption?: string;
  compact?: boolean;
}) {
  if (!chart.bars.length) return null;
  const nameWidth = compact ? "12rem" : "var(--gantt-name)";
  /*
    A floor on the track's width, on SMALL SCREENS ONLY.
    ---------------------------------------------------------------------------

    This was a flat `min-width` at every size, and on desktop it produced a
    horizontal scrollbar for nothing. The mechanism is worth knowing because it
    catches every scroll container with `overflow-auto` on both axes:

      1. The chart is laid out at the container's full width.
      2. Rows overflow vertically, so a vertical scrollbar appears — and on
         Windows that is a real ~17px of reserved width, not an overlay.
      3. The client width is now 17px smaller, but the inner div cannot shrink
         below its `min-width`, so it overflows by 17px.
      4. A horizontal scrollbar appears to scroll those 17px.

    Measured at a 934px card: 918px of content in 918px of client, `overflowsBy`
    zero — the bar was scrolling almost nothing, which is exactly why it looked
    like a bug rather than a feature.

    Below `sm` the floor is real and stays: 15rem of names plus a 40-day window
    in ~180px of track is four pixels a day, and the markers are 18px wide. That
    is what the "swipe across" hint underneath is for. Above `sm` the chart
    sizes itself to the container and the whole window is always visible, which
    is what a timeline is for.
  */
  const minWidthClass = compact
    ? "min-w-[36rem] sm:min-w-0"
    : "min-w-[43rem] sm:min-w-0";
  const ticks =
    chart.ticks[0]?.leftPct > 3
      ? [
          {
            label: formatDay(chart.windowStart, { month: "short" }),
            leftPct: 0,
          },
          ...chart.ticks,
        ]
      : chart.ticks;
  const hasBaseline = chart.bars.some((b) => b.baselineEndPct !== undefined);
  const hasWaiting = chart.bars.some((b) => b.waitingOnMarks?.length);

  return (
    <figure
      className="w-full min-w-0 [--gantt-name:8.5rem] sm:[--gantt-name:15rem]"
      aria-label={caption ?? "Project timeline"}
    >
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink-soft text-xs">
          {caption ?? "Project dates, deliverables and milestones"}
        </span>
        <span className="text-ink-muted text-xs tabular-nums">
          {day(chart.windowStart)} – {day(chart.windowEnd)} ·{" "}
          {chart.windowEnd.slice(0, 4)}
        </span>
      </figcaption>
      {/*
        Vertical scrolls; horizontal is CLIPPED above `sm`.

        A point marker is positioned `left: X%` and pulled back by half its own
        width with a transform. At `left: 100%` — which is every chart whose
        last date belongs to a deliverable rather than a project span — the
        transform makes it VISIBLE but its untransformed box still extends 9px
        past the container, so `scrollWidth` grows by 9 and a horizontal
        scrollbar appears to scroll nine pixels of nothing. Measured: 927 of
        content in 918 of client, with the marker s visible edge already 7px
        inside.

        `clip` rather than `hidden` because it does not create a scroll
        container at all, and rather than insetting the whole coordinate space
        because that would have to be done identically to the axis, the grid,
        the today line and every row or they stop lining up. Nothing is lost:
        the pixels being clipped are the phantom half of a marker that is
        already fully drawn.

        Below `sm` the horizontal scroll is real and stays — see the
        `min-w` note above, and the swipe hint underneath.
      */}
      <div
        className="border-line rounded-tile isolate max-h-[32rem] overflow-x-auto overflow-y-auto border sm:overflow-x-clip"
        tabIndex={0}
        role="region"
        aria-label="Timeline chart"
      >
        <div className={minWidthClass}>
          <div className="border-line bg-surface sticky top-0 z-40 flex h-12 border-b">
            <div
              className="bg-surface border-line text-ink-muted sticky left-0 z-30 flex shrink-0 items-center border-r px-3 text-xs font-semibold tracking-wide uppercase"
              style={{ width: nameWidth }}
            >
              Project / checkpoint
            </div>
            <div className="relative flex-1">
              {ticks.map((t) => (
                <span
                  key={`${t.label}-${t.leftPct}`}
                  className="border-line text-ink-soft absolute inset-y-0 border-l pt-2 pl-2 text-xs font-semibold"
                  style={{ left: `${t.leftPct}%` }}
                >
                  {t.label}
                </span>
              ))}
              {chart.todayPct !== null ? (
                <span
                  className="text-cardinal-600 absolute bottom-1 text-[10px] font-bold"
                  style={{ left: `${chart.todayPct}%` }}
                >
                  <span
                    className={`absolute bottom-0 ${ANCHOR_CLASSES[markAnchor(chart.todayPct)]}`}
                  >
                    Today
                  </span>
                </span>
              ) : null}
            </div>
          </div>
          <div className="relative">
            <div
              className="pointer-events-none absolute inset-y-0 right-0"
              style={{ left: nameWidth }}
              aria-hidden
            >
              {ticks.map((t, i) => (
                <span
                  key={`${t.label}-${t.leftPct}`}
                  className={`border-line absolute inset-y-0 border-l ${i % 2 === 0 ? "bg-surface/60" : ""}`}
                  style={{
                    left: `${t.leftPct}%`,
                    width: `${(ticks[i + 1]?.leftPct ?? 100) - t.leftPct}%`,
                  }}
                />
              ))}
              {chart.todayPct !== null ? (
                <span
                  className="border-cardinal-600/80 absolute inset-y-0 z-10 border-l border-dashed"
                  style={{ left: `${chart.todayPct}%` }}
                />
              ) : null}
            </div>
            {chart.bars.map((bar) => {
              const tone = TONES[bar.tone];
              const point = bar.kind !== "project" || bar.widthPct === 0;
              const progress =
                bar.progress !== undefined
                  ? Math.round(bar.progress * 100)
                  : undefined;
              const dates =
                bar.kind === "project"
                  ? `${bar.start ? day(bar.start) : "No start"} – ${bar.end ? day(bar.end) : "No target"}`
                  : bar.end
                    ? day(bar.end)
                    : "No date";
              const label = `${bar.name}. ${dates}. ${tone.label}${progress !== undefined ? `. ${progress}% complete` : ""}`;
              return (
                <div
                  key={bar.id}
                  className="border-line/70 hover:bg-info-fg/5 relative flex border-b last:border-b-0"
                >
                  <div
                    className="bg-card border-line sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r py-2 pr-3"
                    style={{
                      width: nameWidth,
                      paddingLeft: `${12 + Math.min(bar.depth, 5) * 10}px`,
                    }}
                  >
                    <div className="flex items-start gap-1.5">
                      <span
                        aria-hidden
                        className={`mt-1.5 shrink-0 ${tone.dot} ${dotShape(bar.kind)} ${bar.kind === "milestone" ? "size-2.5" : "size-2"}`}
                      />
                      {bar.href ? (
                        <Link
                          href={bar.href}
                          title={bar.name}
                          className="text-ink hover:text-cardinal-600 line-clamp-2 text-[13px] leading-snug font-semibold"
                        >
                          {bar.name}
                        </Link>
                      ) : (
                        <span
                          title={bar.name}
                          className="text-ink-soft line-clamp-2 text-[13px] leading-snug"
                        >
                          {bar.name}
                        </span>
                      )}
                    </div>
                    <span className="text-ink-muted mt-1 pl-3 text-[11px] tabular-nums">
                      {bar.kind === "milestone" ? "Milestone · " : ""}
                      {dates}
                      {progress !== undefined ? ` · ${progress}%` : ""}
                    </span>
                  </div>
                  <div
                    className={`relative min-w-0 flex-1 ${compact ? "min-h-14" : "min-h-16"}`}
                  >
                    <div
                      role="img"
                      aria-label={label}
                      className="absolute inset-0"
                    >
                      {point ? (
                        <span
                          title={label}
                          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${tone.dot} ${pointShape(bar.kind)}`}
                          style={{ left: `${bar.leftPct}%` }}
                        />
                      ) : (
                        <div
                          title={label}
                          className={`absolute top-1/2 h-6 -translate-y-1/2 overflow-hidden border shadow-sm ${tone.bar} ${bar.hasStart ? "rounded-l-sm" : "border-l-0"} ${bar.hasEnd ? "rounded-r-sm" : "border-r-0"}`}
                          style={{
                            left: `${bar.leftPct}%`,
                            width: `${bar.widthPct}%`,
                          }}
                        >
                          {progress !== undefined && progress > 0 ? (
                            <span
                              className={`absolute inset-y-0 left-0 ${tone.fill}`}
                              style={{ width: `${progress}%` }}
                            />
                          ) : null}
                        </div>
                      )}
                      {bar.baselineEndPct !== undefined ? (
                        <span
                          className="border-ink-soft absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-[1.5px]"
                          style={{ left: `${bar.baselineEndPct}%` }}
                          title={`Originally due ${bar.baselineEnd} — pushed back since`}
                        />
                      ) : null}
                    </div>
                    {(bar.waitingOnMarks ?? []).map((mark, index) => (
                      <GanttDependency
                        key={mark.name + "-" + mark.pct + "-" + index}
                        item={bar.name}
                        name={mark.name}
                        date={mark.date}
                        pct={mark.pct}
                        conflict={mark.conflict}
                        /*
                          The palette lives here, so the class is resolved here
                          and handed over. The mark and the row it points at
                          therefore read from one table.
                        */
                        toneClass={TONES[mark.tone].dot}
                        toneLabel={TONES[mark.tone].label}
                      />
                    ))}{" "}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="text-ink-muted mt-2 text-xs sm:hidden">
        Swipe across for dates; scroll down for more items.
      </p>
      <div className="text-ink-muted mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {(["ok", "warn", "risk", "done"] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-3.5 rounded-sm ${TONES[t].dot}`} />
            {TONES[t].label}
          </span>
        ))}
        {/*
          Two entries, and DRAWN rather than typed as "◆".

          A literal glyph in the legend is a promise the chart cannot keep: it
          is the reader's font at the reader's size, next to a shape this file
          renders in CSS, and there is no triangle character that matches
          `pointShape` at all. Building both from the same functions the rows
          use means the key cannot drift from the thing it explains.
        */}
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`bg-ink-muted size-3.5 ${dotShape("deliverable")}`}
          />
          Deliverable
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`bg-ink-muted size-4 ${dotShape("milestone")}`} />
          Milestone
        </span>
        <span>Darker fill = progress</span>
        {hasBaseline ? <span>◇ Original target</span> : null}
        {hasWaiting ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-ink-muted inline-block h-3 w-0.5" />
            Waiting on — colour is its status
          </span>
        ) : null}
        {chart.bars.some((b) => b.waitingOnMarks?.some((m) => m.conflict)) ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-ink-muted inline-block h-3 w-1" />
            Thicker = lands after this item is due
          </span>
        ) : null}
      </div>
      {chart.hiddenCount > 0 ? (
        <p className="text-ink-muted mt-2 text-xs">
          {chart.hiddenCount}{" "}
          {chart.hiddenCount === 1 ? "item has" : "items have"} no date or{" "}
          {chart.hiddenCount === 1 ? "falls" : "fall"} outside this window.
        </p>
      ) : null}
    </figure>
  );
}
