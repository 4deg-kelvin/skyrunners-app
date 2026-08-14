/**
 * Tests for the contribution record.
 *
 * Written as PERSONAS rather than properties. The previous scoring system passed
 * every property test it had while ranking an absent member (45) almost as high
 * as a reliable contributor (50). Property tests confirm arithmetic; personas
 * catch a model that's describing real people absurdly.
 *
 * Roughly half of this file used to test the commitment tiers — the ladder, the
 * configurable floors, the "next rung" gap. All of that is gone with the tiers
 * (2026-08-14). What replaces it is one small suite at the bottom asserting the
 * tier CANNOT come back by accident, because the failure mode being guarded
 * against is somebody re-adding a volume signal in a new unit rather than
 * literally restoring `commitmentTier`.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  buildContributionRecord,
  LEADERSHIP_RUBRIC,
  type ContributionInputs,
} from "./contribution.ts";

const blank: ContributionInputs = {
  deliverablesCompleted: 0,
  deliverablesOpen: 0,
  deliverablesOverdue: 0,
  projectsCompleted: 0,
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

describe("no data is never scored as failure", () => {
  test("a brand new member with nothing assigned has null rates, not zeros", () => {
    const r = buildContributionRecord(blank);
    assert.equal(r.delivered.completionRate, null);
    assert.equal(r.reliability.onTimeRate, null);
  });

  /*
    A paused member no longer needs an `isPaused` input to be described fairly.

    That flag existed for the tier ("On academic pause" was a tier value). What
    actually protects a paused member is upstream: a pause generates no check-in
    obligations, so `updatesDue` is 0 and Reliability reports null — "nothing
    due" — on its own. This test pins that, because the temptation when reading
    the record code is to think the pause was forgotten.
  */
  test("a paused member owes nothing and is not marked missed", () => {
    const r = buildContributionRecord(persona({ updatesDue: 0 }));
    assert.equal(r.reliability.missed, 0);
    assert.equal(r.reliability.onTimeRate, null);
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
  /** Ships work, reliable. Not an RE. */
  const workhorse = persona({
    deliverablesCompleted: 9,
    deliverablesOpen: 2,
    projectsCompleted: 2,
    updatesDue: 20,
    updatesOnTime: 19,
    updatesLate: 1,
    projectsCommitted: 2,
  });

  /**
   * Around constantly, nothing finished.
   *
   * This persona used to be defined by `hoursTotal: 200` — the whole point was
   * that hours made him look like the top tier while he delivered nothing. With
   * hours gone he is defined by what remains true: plenty assigned, none
   * finished, several overdue. The assertion below is what always mattered.
   */
  const grinder = persona({
    deliverablesCompleted: 0,
    deliverablesOpen: 8,
    deliverablesOverdue: 5,
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
    updatesDue: 20,
    updatesOnTime: 10,
    updatesLate: 2,
    reRoleCount: 3,
    projectsCommitted: 2,
  });

  test("the workhorse reads as clearly productive", () => {
    const r = buildContributionRecord(workhorse);
    assert.equal(r.delivered.projectsCompleted, 2);
    assert.ok(r.delivered.completionRate !== null);
    assert.ok(r.delivered.completionRate > 0.8);
    assert.ok(r.reliability.onTimeRate !== null);
    assert.ok(r.reliability.onTimeRate > 0.9);
  });

  /*
    The assertion this file exists for, and the one the removal makes stronger.

    Being present and being productive used to be two signals sitting side by
    side, and the panel showed the grinder at the TOP tier on hours next to a
    zero delivery count. Now nothing in the record can make him look productive
    at all, because nothing in the record measures presence.
  */
  test("turning up cannot make someone look productive", () => {
    const g = buildContributionRecord(grinder);
    assert.equal(g.delivered.deliverablesCompleted, 0);
    assert.equal(g.delivered.completionRate, 0);
    assert.equal(g.delivered.overdue, 5);

    // Being reliable about check-ins does NOT bleed into delivery. He files
    // them faithfully and still reads as delivering nothing, which is correct.
    assert.ok(g.reliability.onTimeRate !== null);
    assert.ok(g.reliability.onTimeRate > 0.8);

    const w = buildContributionRecord(workhorse);
    assert.ok(
      w.delivered.deliverablesCompleted > g.delivered.deliverablesCompleted,
      "the person who ships must be distinguishable from the person who is merely present"
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
  });

  test("there is no composite score anywhere in the record", () => {
    const r = buildContributionRecord(workhorse);
    const flat = JSON.stringify(r);
    assert.ok(!("score" in (r as unknown as Record<string, unknown>)));
    assert.ok(
      !flat.includes('"score"'),
      "a single number invites optimization; keep the signals separate"
    );
  });
});

/**
 * The regression guard for the whole change.
 *
 * These tests would all have passed before the removal too — that's deliberate.
 * They don't check that the tier is absent by name; they check the SHAPE that
 * made it wrong, so they also fail if somebody adds `daysLogged`,
 * `sessionsAttended` or `entriesWritten` as a fourth signal. Re-read the header
 * of `lib/contribution.ts` before deleting any of them.
 */
describe("the record measures outcomes, not volume of time", () => {
  test("no field in the record counts time or presence", () => {
    const r = buildContributionRecord(
      persona({ deliverablesCompleted: 3, updatesDue: 4, updatesOnTime: 4 })
    );

    const banned = [
      "hours",
      "hoursTotal",
      "hoursPerWeek",
      "tier",
      "commitment",
      "daysWorked",
      "daysLogged",
      "sessions",
      "entriesWritten",
      "activeWeeks",
    ];
    const flat = JSON.stringify(r);
    for (const key of banned) {
      assert.ok(
        !flat.includes(`"${key}"`),
        `"${key}" is back in the contribution record — it measures presence, not outcomes. See docs/HOURS_REMOVAL_PLAN.md.`
      );
    }
  });

  test("exactly three signals, and Delivered is one of them", () => {
    const r = buildContributionRecord(blank);
    assert.deepEqual(Object.keys(r).sort(), [
      "delivered",
      "reliability",
      "scope",
    ]);
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

  /*
    The rubric is PUBLISHED at /how-we-lead, so a criterion referring to
    something the app no longer measures is worse than a missing criterion: it
    tells a member they're being judged on a scale that doesn't exist.

    The "Sustained commitment" row said "Core or Committed tier held across a
    full quarter". This is the test that would have caught it being left behind.
  */
  test("no criterion refers to hours or to a tier", () => {
    const flat = JSON.stringify(LEADERSHIP_RUBRIC).toLowerCase();
    for (const word of ["hour", "hrs", "tier", "core or committed"]) {
      assert.ok(
        !flat.includes(word),
        `the published rubric mentions "${word}", which the club no longer measures`
      );
    }
  });
});
