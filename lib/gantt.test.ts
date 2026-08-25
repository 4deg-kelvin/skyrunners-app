/**
 * Timeline geometry.
 *
 * Run with:  npm test
 *
 * Worth testing precisely because the failure mode is silent. An off-by-one-day
 * bar looks slightly wrong and nobody can tell whether the chart or the
 * schedule is lying — which makes the chart useless in exactly the situation it
 * exists for.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { buildGantt, projectTone, type GanttRow } from "./gantt.ts";

const TODAY = "2026-09-01";

function row(over: Partial<GanttRow> = {}): GanttRow {
  return {
    id: "p1",
    name: "P1",
    depth: 0,
    tone: "ok",
    kind: "project",
    ...over,
  };
}

describe("the window fits the dates present", () => {
  test("spans from the earliest start to the latest end", () => {
    const c = buildGantt(
      [
        row({ id: "a", start: "2026-08-01", end: "2026-10-01" }),
        row({ id: "b", start: "2026-09-01", end: "2026-12-01" }),
      ],
      TODAY
    );
    assert.equal(c.windowStart, "2026-08-01");
    assert.equal(c.windowEnd, "2026-12-01");
  });

  test("a bar spanning the whole window runs edge to edge", () => {
    const c = buildGantt(
      [row({ start: "2026-08-01", end: "2026-12-01" })],
      TODAY
    );
    assert.equal(c.bars[0].leftPct, 0);
    assert.equal(c.bars[0].widthPct, 100);
  });

  test("a bar covering the second half starts at 50%", () => {
    const c = buildGantt(
      [
        row({ id: "a", start: "2026-01-01", end: "2026-03-02" }), // 60 days
        row({ id: "b", start: "2026-01-31", end: "2026-03-02" }), // last 30
      ],
      "2026-02-01"
    );
    assert.equal(Math.round(c.bars[1].leftPct), 50);
    assert.equal(Math.round(c.bars[1].widthPct), 50);
  });

  test("today is always inside the window, even with no dates near it", () => {
    // A chart of last spring's deadlines with no "now" on it can't answer the
    // only question anybody brings to it.
    const c = buildGantt(
      [row({ start: "2026-01-01", end: "2026-02-01" })],
      TODAY
    );
    assert.equal(c.windowEnd, TODAY);
    assert.equal(c.todayPct, 100);
  });

  test("everything on one day still gets a window with width", () => {
    // (x - min) / 0 is NaN, which renders as an unstyled bar and no error.
    const c = buildGantt([row({ start: TODAY, end: TODAY })], TODAY);
    assert.ok(c.windowEnd > c.windowStart);
    assert.ok(Number.isFinite(c.bars[0].leftPct));
    assert.ok(Number.isFinite(c.bars[0].widthPct));
  });
});

describe("missing dates are shown as missing, not invented", () => {
  test("no start means the bar opens at the window edge, flagged", () => {
    const c = buildGantt(
      [
        row({ id: "a", start: "2026-08-01", end: "2026-10-01" }),
        row({ id: "b", end: "2026-09-15" }),
      ],
      TODAY
    );
    const b = c.bars[1];
    assert.equal(b.hasStart, false);
    assert.equal(b.hasEnd, true);
    assert.equal(b.leftPct, 0);
  });

  test("no end means it runs to the window edge, flagged", () => {
    const c = buildGantt(
      [
        row({ id: "a", start: "2026-08-01", end: "2026-12-01" }),
        row({ id: "b", start: "2026-09-01" }),
      ],
      TODAY
    );
    assert.equal(c.bars[1].hasEnd, false);
    assert.equal(Math.round(c.bars[1].leftPct + c.bars[1].widthPct), 100);
  });

  test("a deliverable with only a due date is a zero-width marker", () => {
    const c = buildGantt(
      [
        row({ id: "a", start: "2026-08-01", end: "2026-12-01" }),
        row({ id: "d", kind: "deliverable", end: "2026-10-01" }),
      ],
      TODAY
    );
    // No start, so it collapses onto its due date rather than sweeping the
    // window — a deliverable is a date, not a span.
    assert.equal(c.bars[1].widthPct, 0);
    assert.ok(c.bars[1].leftPct > 0);
  });
});

describe("the today marker", () => {
  test("sits proportionally inside the window", () => {
    const c = buildGantt(
      [row({ start: "2026-01-01", end: "2026-03-02" })],
      "2026-01-31"
    );
    assert.equal(Math.round(c.todayPct!), 50);
  });
});

describe("the depth cap is reported, never silent", () => {
  test("rows deeper than the cap are dropped and counted", () => {
    const rows = [
      row({ id: "a", depth: 0, end: "2026-10-01" }),
      row({ id: "b", depth: 1, end: "2026-10-01" }),
      row({ id: "c", depth: 2, end: "2026-10-01" }),
      row({ id: "d", depth: 3, end: "2026-10-01" }),
      row({ id: "e", depth: 4, end: "2026-10-01" }),
    ];
    const c = buildGantt(rows, TODAY);
    assert.deepEqual(
      c.bars.map((b) => b.id),
      ["a", "b", "c"]
    );
    assert.equal(c.hiddenCount, 2);
  });

  test("a deeper row's dates don't stretch the window either", () => {
    // If a hidden row widened the window, every visible bar would be squashed
    // to make room for something not on the chart.
    const c = buildGantt(
      [
        row({ id: "a", depth: 0, start: "2026-08-01", end: "2026-10-01" }),
        row({ id: "z", depth: 5, start: "2020-01-01", end: "2030-01-01" }),
      ],
      TODAY
    );
    assert.equal(c.windowStart, "2026-08-01");
    assert.equal(c.windowEnd, "2026-10-01");
  });
});

describe("bar tone", () => {
  test("complete beats everything, including a stale at-risk flag", () => {
    // Otherwise the chart argues with the Complete badge sitting next to it.
    assert.equal(projectTone("complete", "at_risk", true), "done");
  });

  test("blocked reads worse than at risk", () => {
    assert.equal(projectTone("testing", "blocked", false), "risk");
    assert.equal(projectTone("testing", "at_risk", false), "warn");
  });

  test("past its target warns even when the PL hasn't said so", () => {
    assert.equal(projectTone("testing", "on_track", true), "warn");
  });

  test("otherwise on track", () => {
    assert.equal(projectTone("testing", "on_track", false), "ok");
  });
});

/**
 * The division chart clips the past away — unless something has slipped.
 *
 * The exception is the whole feature. Clipping unconditionally would hide a
 * deadline that has already gone, which is the one thing on this chart nobody
 * may miss.
 */
describe("clipToToday", () => {
  const clip = { clipToToday: true } as const;

  test("without it, the window still opens at the earliest date", () => {
    const c = buildGantt(
      [row({ start: "2026-06-01", end: "2026-12-01" })],
      TODAY
    );
    assert.equal(c.windowStart, "2026-06-01");
  });

  test("with it, the window opens today", () => {
    const c = buildGantt(
      [row({ start: "2026-06-01", end: "2026-12-01" })],
      TODAY,
      clip
    );
    assert.equal(c.windowStart, TODAY);
  });

  test("a project that began earlier reads as open on the left", () => {
    const c = buildGantt(
      [row({ start: "2026-06-01", end: "2026-12-01" })],
      TODAY,
      clip
    );
    // Closing the edge would claim the work began today.
    assert.equal(c.bars[0].hasStart, false);
    assert.equal(c.bars[0].leftPct, 0);
  });

  test("something overdue drags the window back to show itself", () => {
    const c = buildGantt(
      [
        row({ id: "late", tone: "risk", end: "2026-08-10" }),
        row({ id: "ahead", start: TODAY, end: "2026-12-01" }),
      ],
      TODAY,
      clip
    );
    assert.equal(c.windowStart, "2026-08-10");
    assert.ok(
      c.bars.some((b) => b.id === "late"),
      "the overdue row has to be on the chart"
    );
  });

  test("the EARLIEST slip sets the edge, not the latest", () => {
    const c = buildGantt(
      [
        row({ id: "older", tone: "risk", end: "2026-07-01" }),
        row({ id: "newer", tone: "warn", end: "2026-08-20" }),
      ],
      TODAY,
      clip
    );
    assert.equal(c.windowStart, "2026-07-01");
  });

  /*
    Finished work in the past is history. A completed deliverable clamped to the
    left edge renders as a diamond pointing at a date that isn't on the chart,
    which reads as due-now rather than long done.
  */
  test("work completed in the past is dropped, not squashed onto the edge", () => {
    const c = buildGantt(
      [
        row({
          id: "done",
          tone: "done",
          kind: "deliverable",
          end: "2026-07-01",
        }),
        row({ id: "live", start: TODAY, end: "2026-12-01" }),
      ],
      TODAY,
      clip
    );
    assert.deepEqual(
      c.bars.map((b) => b.id),
      ["live"]
    );
  });

  test("a completed row is never treated as overdue", () => {
    // Same date as the slipped case above, but done — so it must not pull the
    // window back.
    const c = buildGantt(
      [
        row({ id: "done", tone: "done", end: "2026-08-10" }),
        row({ id: "live", start: TODAY, end: "2026-12-01" }),
      ],
      TODAY,
      clip
    );
    assert.equal(c.windowStart, TODAY);
  });

  test("everything in the past leaves a window, not an empty strip", () => {
    // The edge must never move forward past all the content.
    const c = buildGantt(
      [
        row({
          id: "old",
          tone: "done",
          start: "2026-06-01",
          end: "2026-07-01",
        }),
      ],
      TODAY,
      clip
    );
    assert.ok(c.windowStart <= c.windowEnd, "window must not invert");
    assert.ok(Number.isFinite(c.bars.length));
  });

  test("today is still marked when the window starts on it", () => {
    const c = buildGantt(
      [row({ start: "2026-06-01", end: "2026-12-01" })],
      TODAY,
      clip
    );
    assert.equal(c.todayPct, 0);
  });
  /*
    Regression. `projectTone` returns "done" for a complete project and "ok" for
    one that is merely on track, and the first version of this filter excluded
    "ok" — so every division with finished work treated its own history as
    overdue and opened the window at the beginning of time, which is exactly
    what the clipping exists to prevent.
  */
  test("the tone that means COMPLETE is the one that gets clipped", () => {
    const c = buildGantt(
      [
        row({ id: "shipped", tone: "done", end: "2026-03-01" }),
        row({ id: "live", start: TODAY, end: "2026-12-01" }),
      ],
      TODAY,
      clip
    );
    assert.equal(c.windowStart, TODAY, "finished work must not drag it back");
  });

  test("every not-done tone in the past does drag it back", () => {
    for (const tone of ["warn", "risk", "neutral"] as const) {
      const c = buildGantt(
        [row({ id: tone, tone, end: "2026-07-15" })],
        TODAY,
        clip
      );
      assert.equal(c.windowStart, "2026-07-15", `${tone} should count`);
    }
  });
});

/**
 * The baseline marker — where a project was ORIGINALLY due.
 *
 * The point of drawing it is that a Gantt which silently redraws itself every
 * time a date is pushed cannot show that a project keeps slipping. These tests
 * pin the two ways that could go wrong quietly: a marker on a date the chart
 * doesn't cover, and a marker that appears when nothing moved.
 */
describe("the baseline marker for a pushed deadline", () => {
  test("sits at the original date, left of the current end", () => {
    const c = buildGantt(
      [
        row({
          start: "2026-08-01",
          end: "2026-10-01",
          baselineEnd: "2026-09-01",
        }),
      ],
      TODAY
    );
    const bar = c.bars[0];
    assert.ok(bar.baselineEndPct !== undefined, "a slip must draw a marker");
    // Strictly inside the bar, and before its right edge — a baseline that
    // rendered at or past the end would say the project hadn't slipped.
    assert.ok(bar.baselineEndPct > bar.leftPct);
    assert.ok(bar.baselineEndPct < bar.leftPct + bar.widthPct);
  });

  test("the window widens to cover the original date", () => {
    // The baseline is earlier than everything else present. If it weren't
    // counted as content it would clamp to 0 and point off-chart.
    const c = buildGantt(
      [
        row({
          start: "2026-09-10",
          end: "2026-10-01",
          baselineEnd: "2026-09-05",
        }),
      ],
      TODAY
    );
    assert.ok(c.windowStart <= "2026-09-05");
    assert.ok(c.bars[0].baselineEndPct !== undefined);
    assert.ok(c.bars[0].baselineEndPct > 0, "not glued to the left edge");
  });

  test("no baseline means no marker", () => {
    const c = buildGantt(
      [row({ start: "2026-08-01", end: "2026-10-01" })],
      TODAY
    );
    assert.equal(c.bars[0].baselineEndPct, undefined);
  });

  test("a date pushed out and pulled back draws nothing", () => {
    /*
      The history still records both moves — that's the table's job. But the
      chart has nothing to show, because nothing net-moved, and a marker sitting
      exactly under the bar's right edge would read as a slip that didn't happen.
    */
    const c = buildGantt(
      [
        row({
          start: "2026-08-01",
          end: "2026-10-01",
          baselineEnd: "2026-10-01",
        }),
      ],
      TODAY
    );
    assert.equal(c.bars[0].baselineEndPct, undefined);
  });

  test("deliverables get one too, since they became pushable", () => {
    /*
      This test asserted the OPPOSITE until migration 0042 made deliverable due
      dates pushable with recorded history. The old rule — "nothing records moves
      of a deliverable's due date, so a baseline could only be a caller mistake" —
      simply stopped being true, and the symptom was pushing one back and seeing no
      change on the chart at all.

      Kept as a test rather than deleted, because the interesting assertion is
      still there: a row gets a baseline if and only if the caller supplies one.
    */
    const c = buildGantt(
      [
        row({
          kind: "deliverable",
          end: "2026-10-01",
          baselineEnd: "2026-09-01",
        }),
      ],
      TODAY
    );
    assert.ok(
      c.bars[0].baselineEndPct !== undefined,
      "a pushed deliverable must show its original date"
    );
  });

  test("a deliverable with no baseline still gets no marker", () => {
    // The overwhelmingly common case: most deliverables have never moved.
    const c = buildGantt(
      [row({ kind: "deliverable", end: "2026-10-01" })],
      TODAY
    );
    assert.equal(c.bars[0].baselineEndPct, undefined);
  });

  test("a baseline outside a narrowed window is omitted, not clamped", () => {
    /*
      The trap this exists to avoid. On the division chart the window opens at
      today; a project originally due months ago would clamp to leftPct 0 and
      render a marker on a date the chart does not cover — indistinguishable to
      the reader from "due right now".
    */
    const c = buildGantt(
      [
        row({
          start: "2026-08-25",
          end: "2026-12-01",
          baselineEnd: "2026-06-01",
          tone: "ok",
        }),
      ],
      TODAY,
      { clipToToday: true }
    );
    assert.ok(c.windowStart >= TODAY, "the window should have been clipped");
    assert.equal(
      c.bars[0].baselineEndPct,
      undefined,
      "a baseline before the window must be dropped, never clamped to 0"
    );
  });

  test("every drawn marker is inside the chart", () => {
    // The invariant that makes the marker safe to render without the component
    // re-checking it.
    for (const baselineEnd of ["2026-08-02", "2026-09-15", "2026-11-30"]) {
      const c = buildGantt(
        [row({ start: "2026-08-01", end: "2026-12-01", baselineEnd })],
        TODAY
      );
      const p = c.bars[0].baselineEndPct;
      assert.ok(
        p !== undefined && p >= 0 && p <= 100,
        `${baselineEnd} -> ${p}`
      );
    }
  });
});
