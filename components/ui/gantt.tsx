import Link from "next/link";

import { markAnchor, type GanttChart, type GanttTone } from "@/lib/gantt";

/**
 * Where a mark's hover panel hangs from. `markAnchor` decides which; this only
 * spells it in Tailwind, so the threshold stays in one testable place.
 */
const ANCHOR_CLASSES: Record<ReturnType<typeof markAnchor>, string> = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
};

/**
 * A read-only picture of dates that already exist.
 *
 * Not a critical-path Gantt — see the header of `lib/gantt.ts`. No
 * dependencies, no slack, nothing for a PL to maintain. It answers one
 * question the deadline list underneath can't: **do these land on top of each
 * other?** A list of six dates in date order does not show you that four of
 * them are the same fortnight in November.
 *
 * Pure CSS on a percentage grid, and a Server Component: there's no
 * interaction, so shipping a charting library — or any JavaScript — for
 * coloured rectangles would be paying a bundle for nothing.
 *
 * ---------------------------------------------------------------------------
 * One coordinate space, and it is NOT the row
 * ---------------------------------------------------------------------------
 *
 * Every percentage from `lib/gantt.ts` is a fraction of the **track** — the
 * area the bars are drawn in, which begins after the name column. Anything
 * that has to line up with a bar must be measured from the same origin.
 *
 * The today line and the month axis weren't, first time round. Both sat in a
 * full-width container, so a bar at 50% and the today line at 50% landed in
 * different places and the line drifted left by the whole width of the name
 * column. It read as "today is wrong" rather than "the chart is misaligned" —
 * and no test could catch it, because the numbers were right and the CSS was
 * wrong.
 *
 * So the name column's width is declared once, as a variable, and everything
 * aligned to a bar is inset by it plus the column gap. **Nothing here may use
 * a responsive width:** a name column that is one size on mobile and another
 * on desktop needs two different insets, and one of them is always wrong.
 */

/*
  ---------------------------------------------------------------------------
  Colour means ONE thing: how the project is going.
  ---------------------------------------------------------------------------

  Green was previously both "on track" and "complete", and the darker section
  inside each bar was progress — so a running project rendered as two shades of
  green, meaning two different things, with nothing on screen saying so. The
  honest reading of that chart was "why is half of it dark?".

  Now:

    complete      green    — finished, and the bar is solid
    on track      blue     — running, nothing wrong
    at risk       amber    — the PL flagged it, or it's past its target
    blocked       red      — stopped
    (a date)      grey     — deliverables and sessions, which have no health

  Blue for in-progress rather than green is the whole fix: it frees green to
  mean exactly one thing. There's a legend under every chart, because a colour
  key nobody is shown is a colour key nobody reads correctly.
*/
const BAR_TONES: Record<GanttTone, string> = {
  ok: "bg-info-fg/20 border-info-fg/45",
  warn: "bg-warn-fg/25 border-warn-fg/50",
  risk: "bg-risk-fg/25 border-risk-fg/55",
  done: "bg-ok-fg/30 border-ok-fg/55",
  neutral: "bg-ink-muted/15 border-ink-muted/30",
};

/**
 * The signed-off portion, drawn inside the bar.
 *
 * A darker shade of the SAME hue, with a hard edge on its right so it reads as
 * a fill level rather than as a second bar. Never a different colour: colour
 * is health here and nothing else, and a progress fill in another hue was
 * exactly what made this unreadable.
 */
const FILL_TONES: Record<GanttTone, string> = {
  ok: "bg-info-fg/45 border-info-fg/60",
  warn: "bg-warn-fg/45 border-warn-fg/60",
  risk: "bg-risk-fg/45 border-risk-fg/60",
  done: "bg-ok-fg/55 border-ok-fg/70",
  neutral: "bg-ink-muted/30 border-ink-muted/40",
};

const MARKER_TONES: Record<GanttTone, string> = {
  ok: "bg-info-fg",
  warn: "bg-warn-fg",
  risk: "bg-risk-fg",
  done: "bg-ok-fg",
  neutral: "bg-ink-muted",
};

/** The key, in the order somebody scanning for trouble wants it. */
const LEGEND: { tone: GanttTone; label: string }[] = [
  { tone: "risk", label: "Blocked" },
  { tone: "warn", label: "At risk" },
  { tone: "ok", label: "On track" },
  { tone: "done", label: "Complete" },
];

/** Must match the `gap-2` on each row. */
const COLUMN_GAP = "0.5rem";

export function Gantt({
  chart,
  /** Shown above the chart. Omit where the surrounding card already says it. */
  caption,
  compact = false,
}: {
  chart: GanttChart;
  caption?: string;
  /**
   * Narrower name column, for the 320px sidebar on a project page.
   *
   * Not a different chart — the same geometry with less room for names. The
   * division chart gets the full page width and can afford to spell them out.
   */
  compact?: boolean;
}) {
  if (chart.bars.length === 0) return null;

  /*
    Compact STACKS the name above its bar; wide puts it in a column beside it.

    Not a style preference. In the 320px project sidebar a side-by-side name
    column has to be about 96px, which truncates "Layup Process Qualification"
    to "Layup Proces..." — every row reads the same and the chart stops being
    scannable, which is the only thing it was for. Stacking gives the name the
    full width and the bar the full width, at the cost of one line per row.

    Stacked means the track starts at 0, so the axis and today line need no
    inset. That single value drives both layouts.
  */
  const nameWidth = compact ? "0rem" : "10rem";
  /** Where the track starts. Everything aligned to a bar uses this. */
  const trackInset = compact ? "0px" : `calc(${nameWidth} + ${COLUMN_GAP})`;

  return (
    <div className="w-full">
      {caption ? (
        <p className="text-ink-muted mb-2 text-xs">{caption}</p>
      ) : null}

      {/* Month axis, inset to the track. Months, because people schedule by
          month — a tick reading "Oct 3" invites measuring rather than
          glancing. */}
      <div className="relative mb-1 h-4" style={{ marginLeft: trackInset }}>
        {chart.ticks.map((t) => (
          <span
            key={`${t.label}-${t.leftPct}`}
            className="text-ink-muted absolute -translate-x-1/2 text-[11px]"
            style={{ left: `${t.leftPct}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>

      <div className="relative">
        {/*
          Today, drawn once behind every row rather than per bar, and inset to
          the track so it shares an origin with the bars.

          Null when now falls outside the window, and then no line is drawn at
          all: a marker pinned to the edge would claim today is the start or
          end of the chart.
        */}
        {chart.todayPct !== null ? (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-10"
            style={{ left: trackInset }}
            aria-hidden
          >
            <div
              className="bg-cardinal-600/70 absolute inset-y-0 w-px"
              style={{ left: `${chart.todayPct}%` }}
            />
          </div>
        ) : null}

        <div className={compact ? "space-y-2" : "space-y-1"}>
          {chart.bars.map((bar) => (
            <div
              key={bar.id}
              className={compact ? "" : "flex items-center gap-2"}
            >
              {/* Fixed width when beside the bar, never responsive — the axis
                  and the today line are inset by exactly this value. */}
              <div
                className={`truncate ${
                  compact ? "mb-0.5 text-[11px]" : "shrink-0 text-[13px]"
                }`}
                style={{
                  width: compact ? undefined : nameWidth,
                  paddingLeft: `${bar.depth * 10}px`,
                }}
                title={bar.name}
              >
                {bar.href ? (
                  <Link
                    href={bar.href}
                    className="text-ink hover:text-cardinal-600 font-semibold"
                  >
                    {bar.name}
                  </Link>
                ) : (
                  <span className="text-ink-soft">{bar.name}</span>
                )}
              </div>

              <div
                className={`bg-surface relative rounded-full ${
                  compact ? "h-3.5 w-full" : "h-5 min-w-0 flex-1"
                }`}
              >
                {bar.kind !== "project" || bar.widthPct === 0 ? (
                  /*
                    A point, not a span. Deliverables are a diamond (one owner,
                    one due date, no duration); events are a round dot (a thing
                    that happens at a time). Two shapes rather than two colours,
                    because the tones already carry health and overloading them
                    would make neither readable.
                  */
                  <span
                    className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 ${MARKER_TONES[bar.tone]} ${
                      bar.kind === "event" ? "rounded-full" : "rotate-45"
                    }`}
                    style={{ left: `${bar.leftPct}%` }}
                    title={
                      bar.end
                        ? `${bar.kind === "event" ? "" : "Due "}${bar.end}`
                        : bar.name
                    }
                  />
                ) : (
                  <div
                    className={`absolute inset-y-0 overflow-hidden border ${BAR_TONES[bar.tone]} ${
                      // Open edges where the date is unknown, so an undated
                      // project doesn't draw a confident boundary nobody set.
                      bar.hasStart ? "rounded-l-full" : ""
                    } ${bar.hasEnd ? "rounded-r-full" : ""}`}
                    style={{
                      left: `${bar.leftPct}%`,
                      width: `${Math.max(bar.widthPct, 1.5)}%`,
                    }}
                    title={`${bar.start ?? "no start"} → ${bar.end ?? "no target"}`}
                  >
                    {bar.progress !== undefined && bar.progress > 0 ? (
                      /* Border-r so the fill level has a visible edge rather
                         than fading into the rest of the bar. */
                      <div
                        className={`absolute inset-y-0 left-0 border-r ${FILL_TONES[bar.tone]}`}
                        style={{ width: `${Math.round(bar.progress * 100)}%` }}
                        title={`${Math.round(bar.progress * 100)}% of deliverables signed off`}
                      />
                    ) : null}
                  </div>
                )}

                {/*
                  Where this originally landed, before it was pushed back.

                  ---------------------------------------------------------------
                  LAST in source order, and that is the bug fix
                  ---------------------------------------------------------------

                  This used to be rendered FIRST, with a comment claiming it sat
                  "under the bar so the bar paints over it". That was exactly
                  wrong: a project's baseline is by construction earlier than its
                  current end and later than its start, so it falls INSIDE the
                  bar's span — and the bar is an opaque later sibling, so it
                  covered the marker completely. The feature looked broken because
                  it was invisible.

                  Absolutely-positioned siblings paint in source order, so being
                  last is what puts it on top. No z-index needed, and none wanted:
                  a z-index here would create a stacking context that the today
                  line would then have to compete with.

                  A hollow outline rather than a filled shape, because it is a date
                  that no longer applies — an open diamond reads as "this used to
                  be here" without competing with the real marker.

                  `buildGantt` only returns a percentage when the date is genuinely
                  inside the window, so there is nothing to clamp here: a marker on
                  a date the chart doesn't cover would read as "due now", which is
                  the one wrong thing it could say.
                */}
                {bar.baselineEndPct !== undefined ? (
                  <span
                    className="border-ink-soft absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-[1.5px] bg-transparent"
                    style={{ left: `${bar.baselineEndPct}%` }}
                    title={`Originally due ${bar.baselineEnd} — pushed back since`}
                  />
                ) : null}

                {/*
                  What this row is WAITING ON — a declared dependency's date.

                  ---------------------------------------------------------------
                  Shape
                  ---------------------------------------------------------------

                  A vertical tick rather than a diamond, so it cannot be
                  mistaken for a deliverable of this project's own, and an
                  arrow is deliberately not drawn: a line between two distant
                  rows is hard to follow, while a tick on your own bar is
                  readable at a glance. When it sits to the RIGHT of the bar's
                  end, that IS the date conflict, with no annotation needed.

                  `buildGantt` drops marks outside the window rather than
                  clamping them, for the same reason as the baseline above.

                  ---------------------------------------------------------------
                  The hover panel, and why it is CSS rather than JavaScript
                  ---------------------------------------------------------------

                  This started as a `title` attribute, and a native tooltip was
                  not good enough for the one thing it had to do. It waits about
                  a second before appearing, it cannot be styled, it is capped
                  in width by the browser, and on a chart where the answer is
                  "which of these twelve rows is late" a delay that long means
                  people conclude there is no tooltip at all.

                  So: a real panel, on `group-hover`, with **no JavaScript**.
                  This file is a Server Component on purpose — see its header —
                  and a hover panel is the one interaction CSS does completely.
                  Making it a Client Component would ship a bundle for a chart
                  of coloured rectangles, and it would stop working before
                  hydration, which is exactly when somebody looking at a
                  freshly-loaded page hovers.

                  Three details that are load-bearing:

                  1. **`z-20` sits on the WRAPPER, not the panel.** The wrapper
                     carries `-translate-x-1/2`, and a transform creates a
                     stacking context — so a `z-20` on the panel inside would be
                     trapped in a context whose own z-index is `auto`, and the
                     `z-10` today line would paint straight over it. The z-index
                     has to be on whatever creates the context.
                  2. **The panel's horizontal anchor depends on the mark's
                     position.** Centred is right in the middle of the chart and
                     wrong at the edges, where a centred panel hangs off the side
                     of the card. Near 0% it aligns its left edge to the tick,
                     near 100% its right edge — computed here from `pct`, which
                     is free because this renders on the server.
                  3. **`role="img"` + `aria-label` on the wrapper**, with the
                     panel `aria-hidden`. The panel is `display: none` until
                     hover, so a screen reader would never reach its text, and
                     duplicating the sentence into an `sr-only` node would mean
                     two copies to keep in step. `title` is gone precisely so
                     the browser does not draw its own tooltip on top of ours.

                  Touch has no hover, and that is fine rather than unhandled:
                  every one of these links is also listed as text under
                  "Waiting on" on the project page and in the edit panel, so the
                  chart is the fast path and not the only one.
                */}
                {(bar.waitingOnMarks ?? []).map((mark) => {
                  const label = mark.conflict
                    ? `${bar.name} is waiting on ${mark.name}, which lands ${mark.date} — after ${bar.name} is itself due`
                    : `${bar.name} is waiting on ${mark.name}, due ${mark.date}`;

                  const anchor = ANCHOR_CLASSES[markAnchor(mark.pct)];

                  return (
                    <span
                      key={`${mark.name}-${mark.pct}`}
                      role="img"
                      aria-label={label}
                      className="group absolute top-1/2 z-20 flex h-5 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                      style={{ left: `${mark.pct}%` }}
                    >
                      <span
                        aria-hidden="true"
                        className={
                          mark.conflict
                            ? "bg-risk-fg h-4 w-[2px]"
                            : "bg-ink-muted/70 h-3 w-[2px]"
                        }
                      />

                      <span
                        aria-hidden="true"
                        className={`rounded-tile border-line bg-card text-ink pointer-events-none absolute bottom-full mb-1.5 hidden w-max max-w-48 border px-2 py-1.5 text-left text-[11px] leading-snug font-medium shadow-lg group-hover:block ${anchor}`}
                      >
                        <span className="text-ink-muted font-semibold">
                          Waiting on
                        </span>{" "}
                        {mark.name}
                        <span className="mt-0.5 block">
                          {mark.conflict ? (
                            <span className="text-risk-fg font-semibold">
                              Lands {mark.date} — after {bar.name} is due
                            </span>
                          ) : (
                            <span className="text-ink-muted">
                              Due {mark.date}
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/*
        The key.

        Four colours and a fill level is more than anybody decodes by staring,
        and the previous version shipped without one — which is most of why the
        chart was confusing rather than merely dense.
      */}
      <div className="text-ink-muted mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11px]">
        {LEGEND.map(({ tone, label }) => (
          <span key={tone} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-block size-2.5 rounded-full border ${BAR_TONES[tone]}`}
            />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block h-2.5 w-4 overflow-hidden rounded-full border ${BAR_TONES.ok}`}
          >
            <span className={`block h-full w-1/2 border-r ${FILL_TONES.ok}`} />
          </span>
          Darker = work signed off
        </span>
        {/*
          Only when something on this chart actually slipped.

          A standing legend entry for a marker that isn't drawn teaches people to
          ignore the key — the same reason the completions card on the dashboard
          renders nothing rather than "0 completed".
        */}
        {chart.bars.some((b) => b.baselineEndPct !== undefined) ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="border-ink-muted/70 inline-block size-2 rotate-45 border" />
            Original target
          </span>
        ) : null}

        {/* Same rule: only keyed when at least one row actually has one. */}
        {chart.bars.some((b) => b.waitingOnMarks?.length) ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-ink-muted/70 inline-block h-3 w-[2px]" />
            Waiting on
          </span>
        ) : null}
        {chart.bars.some((b) => b.waitingOnMarks?.some((m) => m.conflict)) ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-risk-fg inline-block h-4 w-[2px]" />
            Waiting past its own date
          </span>
        ) : null}
      </div>

      {/*
        Say what was left out.

        The project tree has no depth limit, so a division three levels deep
        would quietly lose its bottom rows. A chart that looks complete and
        isn't is worse than one that admits its limit.
      */}
      {chart.hiddenCount > 0 ? (
        <p className="text-ink-muted mt-2 text-xs">
          {chart.hiddenCount} deeper sub-project
          {chart.hiddenCount === 1 ? "" : "s"} not shown — open the project to
          see {chart.hiddenCount === 1 ? "it" : "them"}.
        </p>
      ) : null}
    </div>
  );
}
