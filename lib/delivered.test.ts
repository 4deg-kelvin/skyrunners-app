/**
 * Tests for the delivered counters.
 *
 * ---------------------------------------------------------------------------
 * Most of this file is a regression guard, and that is the point
 * ---------------------------------------------------------------------------
 *
 * `lib/contribution.test.ts` was 230 lines of personas, written because the
 * scoring system it replaced passed every property test it had while ranking an
 * absent member (45) almost as high as a reliable contributor (50). Property
 * tests confirm arithmetic; personas catch a model describing real people
 * absurdly.
 *
 * There is no model left to describe anybody. Two counts of finished work
 * cannot rank an absent member above a present one, so the personas went with
 * the record they were testing. What is left is the half of that file that was
 * never about arithmetic: the guard against a volume signal coming back.
 *
 * That guard has now survived two removals -- the commitment tiers on
 * 2026-08-14 and reliability on 2026-08-24 -- and each time the thing it
 * caught was somebody's reasonable-sounding replacement built on how much
 * somebody showed up. Re-read the header of `lib/delivered.ts` before deleting
 * any of it.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { buildDelivered, type DeliveredInputs } from "./delivered.ts";

const blank: DeliveredInputs = {
  deliverablesCompleted: 0,
  projectsCompleted: 0,
};

describe("the counters count what happened", () => {
  test("nothing finished reads as zero, not as absent", () => {
    // Deliberately different from the old record, where a component with no
    // data returned `null` rather than 0. A rate needs that distinction --
    // "0 of 0 on time" is not 0% -- and a COUNT does not. Zero deliverables
    // completed is a true and complete answer.
    const d = buildDelivered(blank);
    assert.equal(d.deliverablesCompleted, 0);
    assert.equal(d.projectsCompleted, 0);
  });

  test("both counts come through unweighted", () => {
    const d = buildDelivered({
      deliverablesCompleted: 7,
      projectsCompleted: 2,
    });
    assert.equal(d.deliverablesCompleted, 7);
    assert.equal(d.projectsCompleted, 2);
  });
});

describe("outcomes, not volume of time", () => {
  test("no field counts time, presence or attendance", () => {
    const d = buildDelivered({
      deliverablesCompleted: 3,
      projectsCompleted: 1,
    });

    const banned = [
      "hours",
      "hoursTotal",
      "hoursPerWeek",
      "tier",
      "commitment",
      "daysWorked",
      "daysLogged",
      "sessions",
      "sessionsAttended",
      "entriesWritten",
      "activeWeeks",
      "checkIns",
      "onTimeRate",
      "reliability",
    ];
    const flat = JSON.stringify(d);
    for (const key of banned) {
      assert.ok(
        !flat.includes(`"${key}"`),
        `"${key}" is back — it measures presence or filing, not finished work. See docs/HOURS_REMOVAL_PLAN.md and docs/REPORTING_REMOVAL_PLAN.md.`
      );
    }
  });

  test("exactly two counters, and no composite", () => {
    const d = buildDelivered(blank);
    assert.deepEqual(Object.keys(d).sort(), [
      "deliverablesCompleted",
      "projectsCompleted",
    ]);
  });

  test("no rate, no score, no rank", () => {
    // A percentage needs a denominator and every candidate here is a judgment:
    // deliverables assigned depends on how finely an RE splits work, projects
    // joined depends on who invited you. A number that looks comparable and
    // isn't is worse than no number.
    const d = buildDelivered({
      deliverablesCompleted: 4,
      projectsCompleted: 1,
    });
    const flat = JSON.stringify(d);
    for (const key of ["rate", "score", "rank", "percent", "overall"]) {
      assert.ok(
        !flat.toLowerCase().includes(key),
        `"${key}" is back in the delivered counters — there is no scoreboard, deliberately.`
      );
    }
  });
});
