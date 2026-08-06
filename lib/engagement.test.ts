/**
 * Tests for engagement scoring.
 *
 * These encode the design intent, not just the arithmetic: outcomes must
 * outweigh hours, and hours must show diminishing returns. If someone later
 * retunes the weights in a way that breaks those properties, these fail.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  computeEngagement,
  projectSizeFactor,
  RECOMMENDED_WEIGHTS,
  HOURS_FULL_CREDIT_PER_WEEK,
  type EngagementInputs,
} from "./engagement.ts";

const base: EngagementInputs = {
  weeksInPeriod: 10,
  updatesDue: 30,
  updatesOnTime: 30,
  updatesLate: 0,
  tasksAssigned: 10,
  tasksCompleted: 10,
  reProjectSizeFactors: [],
  eventsInvited: 5,
  attendedImportanceSum: 15,
  invitedImportanceSum: 15,
  hoursTotal: 80,
  divisionsContributedTo: 1,
};

describe("recommended weights", () => {
  test("sum to 1.0", () => {
    const sum = Object.values(RECOMMENDED_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
  });

  test("breadth is not rewarded — a member's own choice", () => {
    assert.equal(RECOMMENDED_WEIGHTS.breadth, 0);
  });

  test("hours is the lowest-weighted measured signal", () => {
    // breadth is deliberately 0 and therefore excluded from the comparison
    const { breadth: _breadth, hoursLogged, ...rest } = RECOMMENDED_WEIGHTS;
    for (const [name, w] of Object.entries(rest)) {
      assert.ok(w > hoursLogged, `${name} (${w}) should outweigh hours (${hoursLogged})`);
    }
  });

  test("update reliability is the single heaviest signal", () => {
    const values = Object.values(RECOMMENDED_WEIGHTS);
    assert.equal(
      RECOMMENDED_WEIGHTS.updateReliability,
      Math.max(...values)
    );
  });
});

describe("score bounds", () => {
  test("a perfect record scores 100", () => {
    const r = computeEngagement({
      ...base,
      reProjectSizeFactors: [3, 3],
      hoursTotal: HOURS_FULL_CREDIT_PER_WEEK * base.weeksInPeriod,
      divisionsContributedTo: 3,
    });
    assert.equal(r.score, 100);
  });

  test("a completely absent member scores 0", () => {
    const r = computeEngagement({
      weeksInPeriod: 10,
      updatesDue: 30,
      updatesOnTime: 0,
      updatesLate: 0,
      tasksAssigned: 5,
      tasksCompleted: 0,
      reProjectSizeFactors: [],
      eventsInvited: 5,
      attendedImportanceSum: 0,
      invitedImportanceSum: 15,
      hoursTotal: 0,
      divisionsContributedTo: 1,
    });
    assert.equal(r.score, 0);
  });

  test("score always lands in 0-100", () => {
    const absurd = computeEngagement({
      ...base,
      hoursTotal: 100000,
      reProjectSizeFactors: [3, 3, 3, 3, 3, 3, 3],
      attendedImportanceSum: 9999,
      tasksCompleted: 999,
      updatesOnTime: 999,
      divisionsContributedTo: 99,
    });
    assert.ok(absurd.score >= 0 && absurd.score <= 100, `got ${absurd.score}`);
  });
});

describe("hours have diminishing returns and a cap", () => {
  test("doubling hours does not double the hours component", () => {
    const low = computeEngagement({ ...base, hoursTotal: 20 });
    const high = computeEngagement({ ...base, hoursTotal: 40 });
    assert.ok(
      high.hoursLogged < low.hoursLogged * 2,
      "hours component should grow sublinearly"
    );
  });

  test("logging far beyond the threshold earns nothing extra", () => {
    const atCap = computeEngagement({
      ...base,
      hoursTotal: HOURS_FULL_CREDIT_PER_WEEK * base.weeksInPeriod,
    });
    const wayOver = computeEngagement({ ...base, hoursTotal: 10000 });
    assert.equal(atCap.hoursLogged, 1);
    assert.equal(wayOver.hoursLogged, 1);
  });

  test("someone who ONLY logs hours cannot score well", () => {
    const grinder = computeEngagement({
      weeksInPeriod: 10,
      updatesDue: 30,
      updatesOnTime: 0,
      updatesLate: 0,
      tasksAssigned: 10,
      tasksCompleted: 0,
      reProjectSizeFactors: [],
      eventsInvited: 5,
      attendedImportanceSum: 0,
      invitedImportanceSum: 15,
      hoursTotal: 500,
      divisionsContributedTo: 1,
    });
    assert.ok(
      grinder.score <= 10,
      `hours-only should cap near the hours weight, got ${grinder.score}`
    );
  });
});

describe("reliability beats volume", () => {
  test("reliable low-hours member outscores unreliable high-hours member", () => {
    const reliable = computeEngagement({
      ...base,
      hoursTotal: 20,
      tasksCompleted: 10,
      reProjectSizeFactors: [],
    });
    const unreliable = computeEngagement({
      ...base,
      updatesOnTime: 5,
      updatesLate: 5,
      tasksCompleted: 3,
      hoursTotal: 300,
    });
    assert.ok(
      reliable.score > unreliable.score,
      `reliable ${reliable.score} should beat unreliable ${unreliable.score}`
    );
  });

  test("late updates earn partial credit — late beats absent", () => {
    const late = computeEngagement({
      ...base,
      updatesOnTime: 0,
      updatesLate: 30,
    });
    const absent = computeEngagement({
      ...base,
      updatesOnTime: 0,
      updatesLate: 0,
    });
    assert.ok(late.updateReliability > absent.updateReliability);
    assert.equal(late.updateReliability, 0.5);
  });
});

describe("edge cases that would otherwise divide by zero", () => {
  test("no updates due yet is not penalized", () => {
    const r = computeEngagement({ ...base, updatesDue: 0, updatesOnTime: 0 });
    assert.equal(r.updateReliability, 1);
  });

  test("never invited to an event is not penalized", () => {
    const r = computeEngagement({
      ...base,
      invitedImportanceSum: 0,
      attendedImportanceSum: 0,
    });
    assert.equal(r.eventAttendance, 1);
  });

  test("zero-length period does not produce NaN", () => {
    const r = computeEngagement({ ...base, weeksInPeriod: 0 });
    assert.ok(Number.isFinite(r.score));
  });

  test("custom weights that don't sum to 1 still yield 0-100", () => {
    const r = computeEngagement(base, {
      updateReliability: 5,
      taskCompletion: 5,
      reResponsibility: 0,
      eventAttendance: 0,
      hoursLogged: 0,
      breadth: 0,
    });
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.equal(r.score, 100);
  });
});

describe("project size factor", () => {
  test("buckets by combined subtree and headcount", () => {
    assert.equal(projectSizeFactor(0, 1), 1);
    assert.equal(projectSizeFactor(1, 3), 2);
    assert.equal(projectSizeFactor(4, 8), 3);
  });
});
