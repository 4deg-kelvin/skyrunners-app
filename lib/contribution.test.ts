/**
 * Tests for the contribution record.
 *
 * Written as PERSONAS rather than properties. The previous scoring system passed
 * every property test it had while ranking an absent member (45) almost as high
 * as a reliable contributor (50). Property tests confirm arithmetic; personas
 * catch a model that's describing real people absurdly.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  buildContributionRecord,
  commitmentTier,
  LEADERSHIP_RUBRIC,
  TIER_LABELS,
  WEEKLY_HOURS_EXPECTATION,
  WEEKLY_HOURS_MINIMUM,
  DEFAULT_TIERS,
  nextTierGap,
  tierDescriptions,
  type ContributionInputs,
} from "./contribution.ts";

const blank: ContributionInputs = {
  tiers: DEFAULT_TIERS,
  activeWeeks: 10,
  isPaused: false,
  deliverablesCompleted: 0,
  deliverablesOpen: 0,
  deliverablesOverdue: 0,
  projectsCompleted: 0,
  hoursTotal: 0,
  updatesDue: 0,
  updatesOnTime: 0,
  updatesLate: 0,
  reRoleCount: 0,
  projectsCommitted: 0,
};

const persona = (o: Partial<ContributionInputs>): ContributionInputs => ({
  ...blank,
  ...o,
});

describe("commitment tiers", () => {
  /*
    The club's stated expectation as of 2026-08-10: 10–12 a week is committed,
    16+ is core. `committed` is the LOW end of the published range, so somebody
    doing exactly 10 has met the bar the club actually states.
  */
  test("tiers follow the club's stated expectation", () => {
    assert.equal(commitmentTier(20), "core");
    assert.equal(commitmentTier(16), "core");
    assert.equal(commitmentTier(15), "committed");
    assert.equal(commitmentTier(10), "committed");
    assert.equal(commitmentTier(9), "contributing");
    assert.equal(commitmentTier(5), "contributing");
    assert.equal(commitmentTier(1), "light");
  });

  test("a paused member is paused regardless of hours", () => {
    assert.equal(commitmentTier(0, true), "paused");
    assert.equal(commitmentTier(20, true), "paused");
  });

  test("every tier has a human-readable label", () => {
    for (const tier of Object.keys(TIER_LABELS)) {
      assert.ok(TIER_LABELS[tier as keyof typeof TIER_LABELS].length > 0);
    }
  });

  test("the minimum is at or below the full expectation", () => {
    assert.ok(WEEKLY_HOURS_MINIMUM <= WEEKLY_HOURS_EXPECTATION);
  });
});

describe("the gap shown is to the NEXT rung, not the top one", () => {
  test("somebody at 7/wk is measured against Committed, not Core", () => {
    const r = buildContributionRecord(persona({ hoursTotal: 70 })); // 7/wk
    assert.equal(r.commitment.hoursPerWeek, 7);
    assert.equal(r.commitment.nextTier?.tier, "committed");
    // The next rung is 10, not the 16 at the top. Showing the top would tell
    // somebody three hours short that they're nine hours short.
    assert.equal(r.commitment.nextTier?.hoursAway, 3);
    assert.equal(r.commitment.meetsMinimum, false);
  });

  test("somebody far below the bar gets a reachable rung", () => {
    /*
      The bug this replaced. At 1.6 hrs/week the panel said "10.5 more to reach
      Core", which is a verdict dressed as encouragement — and the whole point
      of naming tiers instead of scoring people is that a below-bar member sees
      a rung rather than a failure.
    */
    const r = buildContributionRecord(persona({ hoursTotal: 16 })); // 1.6/wk
    assert.equal(r.commitment.nextTier?.tier, "contributing");
    assert.equal(r.commitment.nextTier?.hoursAway, 2.4);
  });

  test("null once at the top", () => {
    // 18/wk — past Core's 16. There is no rung above, so there is no gap to
    // show, and inventing one would mean the top tier still reads as falling
    // short of something.
    const r = buildContributionRecord(persona({ hoursTotal: 180 }));
    assert.equal(r.commitment.tier, "core");
    assert.equal(r.commitment.nextTier, null);
    assert.equal(r.commitment.meetsMinimum, true);
  });

  test("a paused member is shown no gap at all", () => {
    // Nothing is owed during a pause, so a "you need N more hours" line would
    // be the app contradicting its own promise.
    const r = buildContributionRecord(
      persona({ hoursTotal: 16, isPaused: true })
    );
    assert.equal(r.commitment.tier, "paused");
    assert.equal(r.commitment.nextTier, null);
  });
});

describe("the tiers are configuration, not constants", () => {
  const lowered = { core: 8, committed: 6, contributing: 3, minimum: 6 };

  test("a lowered bar changes which tier somebody lands in", () => {
    const at7 = persona({ hoursTotal: 70 }); // 7/wk
    assert.equal(buildContributionRecord(at7).commitment.tier, "contributing");
    assert.equal(
      buildContributionRecord({ ...at7, tiers: lowered }).commitment.tier,
      "committed"
    );
  });

  test("the published descriptions follow the numbers", () => {
    // /how-we-lead prints these. If they were still hard-coded strings, the
    // rubric would state a bar nobody is actually measured against.
    assert.match(tierDescriptions(DEFAULT_TIERS).core, /16\+ hrs\/week/);
    assert.match(tierDescriptions(lowered).core, /8\+ hrs\/week/);
    assert.match(tierDescriptions(lowered).contributing, /3–6 hrs\/week/);
  });

  test("the gap is measured against the configured rungs", () => {
    assert.equal(nextTierGap(4, DEFAULT_TIERS)?.tier, "committed");
    assert.equal(nextTierGap(4, lowered)?.tier, "committed");
    assert.equal(nextTierGap(7, lowered)?.tier, "core");
  });
});

describe("no data is never scored as failure", () => {
  test("a brand new member with nothing assigned has null rates, not zeros", () => {
    const r = buildContributionRecord(blank);
    assert.equal(r.delivered.completionRate, null);
    assert.equal(r.reliability.onTimeRate, null);
  });

  test("a paused member owes nothing and is not marked missed", () => {
    const r = buildContributionRecord(
      persona({ isPaused: true, updatesDue: 0 })
    );
    assert.equal(r.commitment.tier, "paused");
    assert.equal(r.reliability.missed, 0);
    assert.equal(r.reliability.onTimeRate, null);
  });

  test("activeWeeks of zero does not produce NaN or Infinity", () => {
    const r = buildContributionRecord(
      persona({ activeWeeks: 0, hoursTotal: 20 })
    );
    assert.ok(Number.isFinite(r.commitment.hoursPerWeek));
    assert.equal(r.commitment.hoursPerWeek, 0);
  });
});

describe("missed updates are derived, never negative", () => {
  test("counts what was due but neither on time nor late", () => {
    const r = buildContributionRecord(
      persona({ updatesDue: 10, updatesOnTime: 6, updatesLate: 2 })
    );
    assert.equal(r.reliability.missed, 2);
  });

  test("inconsistent input cannot produce a negative count", () => {
    const r = buildContributionRecord(
      persona({ updatesDue: 2, updatesOnTime: 5, updatesLate: 3 })
    );
    assert.equal(r.reliability.missed, 0);
  });
});

describe("personas — the record must describe real people sensibly", () => {
  /** Ships work, hits the bar, reliable. Not an RE. */
  const workhorse = persona({
    deliverablesCompleted: 9,
    deliverablesOpen: 2,
    projectsCompleted: 2,
    hoursTotal: 130, // 13/wk
    updatesDue: 20,
    updatesOnTime: 19,
    updatesLate: 1,
    projectsCommitted: 2,
  });

  /** Lots of hours, nothing finished. The pattern the model must expose. */
  const grinder = persona({
    deliverablesCompleted: 0,
    deliverablesOpen: 8,
    deliverablesOverdue: 5,
    hoursTotal: 200, // 20/wk
    updatesDue: 20,
    updatesOnTime: 18,
    updatesLate: 2,
    projectsCommitted: 2,
  });

  /** Holds three RE titles, delivers little. */
  const titleHolder = persona({
    deliverablesCompleted: 1,
    deliverablesOpen: 6,
    deliverablesOverdue: 4,
    hoursTotal: 40, // 4/wk
    updatesDue: 20,
    updatesOnTime: 10,
    updatesLate: 2,
    reRoleCount: 3,
    projectsCommitted: 2,
  });

  /** Absent all term, correctly paused. */
  const paused = persona({ isPaused: true });

  /*
    13/wk. Under the club's stated expectation — 10–12 committed, 16+ core —
    that is comfortably Committed and not Core, which is the honest reading:
    they meet the bar the club publishes without living in the lab.
  */
  test("the workhorse meets the club's bar and is clearly productive", () => {
    const r = buildContributionRecord(workhorse);
    assert.equal(r.commitment.tier, "committed");
    assert.equal(r.commitment.meetsMinimum, true);
    assert.equal(r.delivered.projectsCompleted, 2);
    assert.ok(r.delivered.completionRate !== null);
    assert.ok(r.delivered.completionRate > 0.8);
  });

  test("hours alone cannot make someone look productive", () => {
    const g = buildContributionRecord(grinder);
    // Top tier on hours...
    assert.equal(g.commitment.tier, "core");
    // ...but delivery tells the truth, which is what leadership reads first.
    assert.equal(g.delivered.deliverablesCompleted, 0);
    assert.equal(g.delivered.completionRate, 0);
    assert.equal(g.delivered.overdue, 5);

    const w = buildContributionRecord(workhorse);
    assert.ok(
      w.delivered.deliverablesCompleted > g.delivered.deliverablesCompleted,
      "the person who ships must be distinguishable from the person who only logs hours"
    );
  });

  test("holding RE titles does not disguise weak delivery", () => {
    const t = buildContributionRecord(titleHolder);
    assert.equal(t.scope.reRoleCount, 3);
    assert.ok(t.delivered.completionRate !== null);
    assert.ok(
      t.delivered.completionRate < 0.2,
      "scope is reported, but delivery is reported separately and honestly"
    );
    assert.equal(t.commitment.tier, "contributing");
  });

  test("a paused member is not portrayed as failing", () => {
    const p = buildContributionRecord(paused);
    assert.equal(p.reliability.missed, 0);
    assert.equal(p.delivered.completionRate, null);
    assert.equal(p.commitment.tier, "paused");
  });

  test("there is no composite score anywhere in the record", () => {
    const r = buildContributionRecord(workhorse);
    const flat = JSON.stringify(r);
    assert.ok(!("score" in (r as unknown as Record<string, unknown>)));
    assert.ok(
      !flat.includes('"score"'),
      "a single number invites optimization; keep the four signals separate"
    );
  });
});

describe("leadership rubric is published, ordered, and led by delivery", () => {
  test("delivery comes first", () => {
    assert.equal(LEADERSHIP_RUBRIC[0].signal, "Delivered");
  });

  test("every criterion explains itself to a member reading it", () => {
    for (const row of LEADERSHIP_RUBRIC) {
      assert.ok(row.what.length > 10);
      assert.ok(row.why.length > 10);
    }
  });
});
