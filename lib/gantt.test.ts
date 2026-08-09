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

  test("past its target warns even when the RE hasn't said so", () => {
    assert.equal(projectTone("testing", "on_track", true), "warn");
  });

  test("otherwise on track", () => {
    assert.equal(projectTone("testing", "on_track", false), "ok");
  });
});
