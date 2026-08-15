/**
 * The MCP write budget.
 *
 * Run with:  npm test
 *
 * Pure and time-injected, so the sliding windows can be tested without waiting an
 * hour. What matters here is not that the arithmetic is right but that the two
 * shapes of runaway are both caught: the fast loop, and the patient one pacing
 * itself just under the per-minute limit.
 */

import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";

import {
  WRITES_PER_HOUR,
  WRITES_PER_MINUTE,
  checkWriteBudget,
  resetWriteBudgets,
} from "./rate-limit.ts";

const TOKEN = "tok-1";
const T0 = 1_800_000_000_000;

beforeEach(() => {
  resetWriteBudgets();
});

describe("the per-minute window", () => {
  test("a normal burst is allowed", () => {
    for (let i = 0; i < WRITES_PER_MINUTE; i++) {
      assert.equal(checkWriteBudget(TOKEN, T0 + i).ok, true, `write ${i}`);
    }
  });

  test("one past it is refused, with something the model can relay", () => {
    for (let i = 0; i < WRITES_PER_MINUTE; i++) checkWriteBudget(TOKEN, T0 + i);
    const over = checkWriteBudget(TOKEN, T0 + WRITES_PER_MINUTE);
    assert.equal(over.ok, false);
    // The message has to tell the model what to DO, not just that it failed.
    assert.match(over.message ?? "", /Stop and tell the member/);
  });

  test("refusals keep counting, so hammering stays refused", () => {
    /*
      The alternative — not counting refused attempts — lets a client that ignores
      errors through once per window boundary, which over an afternoon is exactly
      the outcome this exists to prevent.
    */
    for (let i = 0; i < WRITES_PER_MINUTE + 20; i++) {
      checkWriteBudget(TOKEN, T0 + i);
    }
    assert.equal(checkWriteBudget(TOKEN, T0 + 500).ok, false);
  });

  test("the window slides, so a paced client recovers", () => {
    for (let i = 0; i < WRITES_PER_MINUTE; i++) checkWriteBudget(TOKEN, T0 + i);
    assert.equal(checkWriteBudget(TOKEN, T0 + 100).ok, false);
    // A minute later the early writes have aged out.
    assert.equal(checkWriteBudget(TOKEN, T0 + 61_000).ok, true);
  });
});

describe("the per-hour window", () => {
  test("catches a loop pacing itself under the per-minute limit", () => {
    /*
      THE case the short window alone would miss. Twenty-nine writes a minute is
      under the per-minute ceiling forever, and it is 41,000 rows a day.
    */
    let at = T0;
    let refusedAfter = 0;
    for (let i = 0; i < WRITES_PER_HOUR + 50; i++) {
      // Just inside the per-minute rate.
      at += Math.ceil(60_000 / (WRITES_PER_MINUTE - 1));
      const verdict = checkWriteBudget(TOKEN, at);
      if (!verdict.ok && !refusedAfter) refusedAfter = i + 1;
    }
    assert.ok(refusedAfter > 0, "a paced loop was never refused");
    assert.ok(
      refusedAfter <= WRITES_PER_HOUR + 1,
      `took ${refusedAfter} writes to notice`
    );
  });

  test("an hour later it is forgiven", () => {
    let at = T0;
    for (let i = 0; i < WRITES_PER_HOUR + 5; i++) {
      at += 1000;
      checkWriteBudget(TOKEN, at);
    }
    assert.equal(checkWriteBudget(TOKEN, at).ok, false);
    assert.equal(checkWriteBudget(TOKEN, at + 3_600_001).ok, true);
  });
});

describe("isolation between tokens", () => {
  test("one runaway token doesn't refuse anybody else", () => {
    /*
      Keyed on the token, so a member's looping laptop must not stop their phone
      — and one member's accident must not take the feature away from the club.
    */
    for (let i = 0; i < WRITES_PER_MINUTE + 10; i++) {
      checkWriteBudget("runaway", T0 + i);
    }
    assert.equal(checkWriteBudget("runaway", T0 + 200).ok, false);
    assert.equal(checkWriteBudget("innocent", T0 + 200).ok, true);
  });

  test("tracking many tokens doesn't grow without bound", () => {
    // The map is a slow leak without a cap. 600 distinct tokens, then check the
    // most recent still works — eviction must not break the live caller.
    for (let i = 0; i < 600; i++) checkWriteBudget(`t-${i}`, T0 + i);
    assert.equal(checkWriteBudget("t-599", T0 + 700).ok, true);
  });
});
