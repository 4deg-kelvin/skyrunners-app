/**
 * The two comparators that decide reading order.
 *
 * Run with:  npm test
 *
 * Worth their own file because ordering fails SILENTLY. Nothing throws, nothing
 * looks broken, and the only person who notices is the one hunting for a name
 * on a page that listed it somewhere else last time. Both of these have already
 * been got wrong once in production: the roster returned whatever the store
 * handed back, and a project's deliverables came out in the order somebody
 * happened to add them.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  compareDeliverableDueDates,
  compareProjectDueDates,
} from "./project-order.ts";

describe("projects order by target date", () => {
  const p = (id: string, name: string, targetDate?: string) => ({
    id,
    name,
    targetDate,
  });

  test("earliest first", () => {
    assert.ok(
      compareProjectDueDates(
        p("a", "A", "2026-08-01"),
        p("b", "B", "2026-09-01")
      ) < 0
    );
  });

  test("undated last, never first", () => {
    // The sentinel is a far-future date rather than a special case, so an
    // undated project sorts after every real one without a branch.
    assert.ok(
      compareProjectDueDates(
        p("a", "A", undefined),
        p("b", "B", "2026-09-01")
      ) > 0
    );
  });

  test("ties fall back to name, then id", () => {
    const same = "2026-09-01";
    assert.ok(
      compareProjectDueDates(p("z", "Alpha", same), p("a", "Beta", same)) < 0
    );
    assert.ok(
      compareProjectDueDates(p("a", "Same", same), p("b", "Same", same)) < 0
    );
  });
});

describe("deliverables and milestones order by due date", () => {
  const d = (id: string, sortOrder: number, dueDate?: string) => ({
    id,
    sortOrder,
    dueDate,
  });

  /*
    THE CHANGE. `projectDeliverables` sorted on `sortOrder` alone, which is the
    order somebody happened to add them in — so a project page listed an item
    due the 20th above one due the 19th, in the card AND on the timeline,
    because both read that one function.
  */
  test("the date beats the order they were added in", () => {
    assert.ok(
      compareDeliverableDueDates(
        d("late", 0, "2026-09-20"),
        d("early", 1, "2026-09-19")
      ) > 0,
      "added first but due later, so it sorts later"
    );
  });

  test("undated last", () => {
    assert.ok(
      compareDeliverableDueDates(
        d("none", 0, undefined),
        d("d", 9, "2026-09-19")
      ) > 0
    );
  });

  /*
    Same-day ties keep the PL's arrangement rather than going alphabetical.
    Two things due the same day is common, `sortOrder` is a deliberate signal
    even if a weak one, and alphabetical is not a signal at all.
  */
  test("a same-day tie keeps sortOrder", () => {
    const day = "2026-09-19";
    assert.ok(compareDeliverableDueDates(d("b", 0, day), d("a", 1, day)) < 0);
  });

  test("id is the final tiebreak, so the order is stable", () => {
    // Postgres does not promise the same row order twice. Without a total
    // order, two loads of the same page can disagree.
    const day = "2026-09-19";
    assert.ok(compareDeliverableDueDates(d("a", 0, day), d("b", 0, day)) < 0);
    assert.equal(compareDeliverableDueDates(d("a", 0, day), d("a", 0, day)), 0);
  });

  test("sorting a list is a total order with no equal pairs", () => {
    const rows = [
      d("x", 3, "2026-09-20"),
      d("y", 1, undefined),
      d("z", 2, "2026-09-19"),
      d("w", 0, "2026-09-19"),
    ];
    const sorted = [...rows].sort(compareDeliverableDueDates).map((r) => r.id);
    assert.deepEqual(sorted, ["w", "z", "x", "y"]);

    // Reversing the input must not change the result. A comparator that is not
    // a total order gives a different answer per input order, and the symptom
    // is a list that reshuffles when a row is added somewhere unrelated.
    const reversed = [...rows]
      .reverse()
      .sort(compareDeliverableDueDates)
      .map((r) => r.id);
    assert.deepEqual(reversed, sorted);
  });
});
