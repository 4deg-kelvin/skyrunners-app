/**
 * A milestone's derived stage.
 *
 * Run with:  npm test
 *
 * The club's rule, in its words: the earliest deadline is always in progress,
 * and a later one becomes in progress once the one before it is complete. That
 * makes the stage a function of the OTHER milestones, which is exactly the kind
 * of thing that looks right on the one row somebody checks and is wrong three
 * rows down.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { milestoneStage } from "./milestones.ts";
import type { Deliverable } from "./types.ts";

const TODAY = "2026-09-09";

function milestone(
  id: string,
  dueDate: string | undefined,
  over: Partial<Deliverable> = {}
): Deliverable {
  return {
    id,
    projectId: "p",
    title: id,
    kind: "milestone",
    status: "open",
    sortOrder: 0,
    dueDate,
    ...over,
  } as Deliverable;
}

function work(id: string, dueDate?: string): Deliverable {
  return {
    id,
    projectId: "p",
    title: id,
    kind: "deliverable",
    ownerId: "m-1",
    status: "open",
    sortOrder: 0,
    dueDate,
  } as Deliverable;
}

describe("the chain moves along on its own", () => {
  test("the earliest is in progress, the rest are waiting", () => {
    const a = milestone("a", "2026-10-01");
    const b = milestone("b", "2026-11-01");
    const c = milestone("c", "2026-12-01");
    const all = [c, a, b]; // deliberately unordered

    assert.equal(milestoneStage(a, all, TODAY), "active");
    assert.equal(milestoneStage(b, all, TODAY), "waiting");
    assert.equal(milestoneStage(c, all, TODAY), "waiting");
  });

  test("reaching one promotes the next, with no write anywhere", () => {
    const a = milestone("a", "2026-10-01", { status: "done" });
    const b = milestone("b", "2026-11-01");
    const c = milestone("c", "2026-12-01");
    const all = [a, b, c];

    assert.equal(milestoneStage(a, all, TODAY), "reached");
    assert.equal(milestoneStage(b, all, TODAY), "active");
    assert.equal(milestoneStage(c, all, TODAY), "waiting");
  });

  test("a single milestone is in progress", () => {
    const a = milestone("a", "2026-10-01");
    assert.equal(milestoneStage(a, [a], TODAY), "active");
  });

  test("all reached leaves none active", () => {
    const a = milestone("a", "2026-10-01", { status: "done" });
    const b = milestone("b", "2026-11-01", { status: "done" });
    assert.equal(milestoneStage(a, [a, b], TODAY), "reached");
    assert.equal(milestoneStage(b, [a, b], TODAY), "reached");
  });
});

describe("overdue outranks position in the chain", () => {
  /*
    A milestone three places down whose date has already gone is worth acting
    on, and calling it "waiting" would bury it behind a chain that is evidently
    not being followed.
  */
  test("a late one is overdue even when its predecessors are open", () => {
    const a = milestone("a", "2026-10-01");
    const late = milestone("late", "2026-08-01");
    const all = [a, late];

    // `late` is also the earliest, so it would be active on date order alone.
    assert.equal(milestoneStage(late, all, TODAY), "overdue");
    assert.equal(milestoneStage(a, all, TODAY), "waiting");
  });

  test("a later one that has slipped past today is overdue, not waiting", () => {
    const first = milestone("first", "2026-09-20");
    const second = milestone("second", "2026-09-01");
    const all = [first, second];
    assert.equal(milestoneStage(second, all, TODAY), "overdue");
  });

  test("reached beats overdue — a finished checkpoint is not late", () => {
    const a = milestone("a", "2026-01-01", { status: "done" });
    assert.equal(milestoneStage(a, [a], TODAY), "reached");
  });

  test("due today is not overdue", () => {
    const a = milestone("a", TODAY);
    assert.equal(milestoneStage(a, [a], TODAY), "active");
  });

  test("awaiting sign-off beats overdue", () => {
    // Somebody has done the work; the date passing is now the PL's problem,
    // not a signal about the checkpoint.
    const a = milestone("a", "2026-01-01", { status: "submitted" });
    assert.equal(milestoneStage(a, [a], TODAY), "awaiting");
  });
});

describe("deliverables are not part of the chain", () => {
  /*
    Letting a deliverable into the sequence would make "the next checkpoint"
    depend on how finely somebody split their work, which is the opposite of
    what a checkpoint is for.
  */
  test("an earlier deliverable does not steal the active slot", () => {
    const early = work("w", "2026-09-15");
    const a = milestone("a", "2026-10-01");
    const b = milestone("b", "2026-11-01");
    const all = [early, a, b];

    assert.equal(milestoneStage(a, all, TODAY), "active");
    assert.equal(milestoneStage(b, all, TODAY), "waiting");
  });

  test("an unfinished deliverable never blocks the chain", () => {
    const a = milestone("a", "2026-10-01", { status: "done" });
    const stuck = work("w", "2026-10-05");
    const b = milestone("b", "2026-11-01");
    assert.equal(milestoneStage(b, [a, stuck, b], TODAY), "active");
  });
});

describe("undated milestones", () => {
  test("an undated one sorts last and waits", () => {
    const dated = milestone("dated", "2026-10-01");
    const undated = milestone("undated", undefined);
    const all = [undated, dated];

    assert.equal(milestoneStage(dated, all, TODAY), "active");
    assert.equal(milestoneStage(undated, all, TODAY), "waiting");
  });

  test("an undated one is never overdue — there is no date to pass", () => {
    const undated = milestone("undated", undefined);
    assert.equal(milestoneStage(undated, [undated], TODAY), "active");
  });
});
