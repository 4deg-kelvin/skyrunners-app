/**
 * The club's day boundary is Pacific, not UTC.
 *
 * Run with:  npm test
 *
 * These pin a bug that only existed in production. `today()` was the UTC date,
 * Vercel runs in UTC, so from 5pm Pacific the app believed it was tomorrow —
 * and 5pm onwards is exactly when this club is in the lab. It was invisible in
 * development because a laptop in California agrees with UTC until 5pm.
 *
 * Every assertion here uses a fixed instant. Nothing may depend on when the
 * suite runs, or it passes all morning and fails after lunch.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  addDays,
  daysBetweenDays,
  formatDay,
  formatMoment,
  todayInClubTime,
} from "./dates.ts";

describe("today is a Pacific day, not a UTC one", () => {
  test("6pm Pacific in summer is still the same day", () => {
    // 2026-08-09 18:00 PDT === 2026-08-10 01:00Z. UTC says the 10th.
    const evening = new Date("2026-08-10T01:00:00Z");
    assert.equal(evening.toISOString().slice(0, 10), "2026-08-10");
    assert.equal(todayInClubTime(evening), "2026-08-09");
  });

  test("5pm Pacific in winter is still the same day", () => {
    // PST is -8, so the rollover moves an hour later. A fixed -7 or -8 would
    // get one of these two tests wrong, which is why the zone is an IANA name.
    const evening = new Date("2026-12-16T01:00:00Z");
    assert.equal(evening.toISOString().slice(0, 10), "2026-12-16");
    assert.equal(todayInClubTime(evening), "2026-12-15");
  });

  test("just after Pacific midnight it is the new day", () => {
    const justAfter = new Date("2026-08-10T07:05:00Z"); // 00:05 PDT
    assert.equal(todayInClubTime(justAfter), "2026-08-10");
  });

  test("just before Pacific midnight it is still the old day", () => {
    const justBefore = new Date("2026-08-10T06:55:00Z"); // 23:55 PDT
    assert.equal(todayInClubTime(justBefore), "2026-08-09");
  });

  /*
    The switch happens at 2am local on the second Sunday in March. Both sides
    of it must name their own day — a hard-coded offset gets one wrong.
  */
  test("the day is right on both sides of the spring DST change", () => {
    assert.equal(
      todayInClubTime(new Date("2026-03-08T09:00:00Z")),
      "2026-03-08"
    );
    assert.equal(
      todayInClubTime(new Date("2026-03-08T11:00:00Z")),
      "2026-03-08"
    );
  });
});

describe("a calendar date renders as the day it says", () => {
  test("formatDay does not shift a bare date", () => {
    // `new Date("2026-08-09").toLocaleDateString()` in California says Aug 8.
    // That is the off-by-one that made deliverables display a day early.
    assert.equal(formatDay("2026-08-09"), "Aug 9");
    assert.equal(formatDay("2026-01-01"), "Jan 1");
    assert.equal(formatDay("2026-12-31"), "Dec 31");
  });

  test("it tolerates a timestamp being passed in", () => {
    // Some columns carry a time and some don't, and the caller shouldn't have
    // to know which. The date part is what's being asked for either way.
    assert.equal(formatDay("2026-08-09T23:59"), "Aug 9");
  });

  test("weekday names come from the stated day, not the previous one", () => {
    // 2026-08-09 is a Sunday.
    assert.equal(formatDay("2026-08-09", { weekday: "long" }), "Sunday");
  });
});

describe("an instant renders in club time", () => {
  /*
    These asserted "Aug 9" — the date alone — until 2026-08-16, when
    `formatMoment` started including the TIME by default.

    That was a fix, not a cosmetic change: the function formats an INSTANT, which
    is its whole difference from `formatDay`, and it was throwing the time away.
    The calendar panel said "Last picked up Aug 16" when the question was whether
    Apple's last fetch came before or after an event created that afternoon, and
    the answer was in the part not being rendered.

    Asserting the full string is also a stronger test of the thing these were
    always about: the HOUR proves the zone was applied, where a date only proves
    it within twenty-four.
  */
  test("late-evening Pacific keeps its own date, and its own hour", () => {
    // 2026-08-09 20:00 PDT === 2026-08-10 03:00Z.
    assert.equal(formatMoment("2026-08-10T03:00:00Z"), "Aug 9, 8:00 PM");
  });

  test("a caller can still ask for the bare date", () => {
    // Two callers do, and the option is how they keep doing it.
    assert.equal(
      formatMoment("2026-08-10T03:00:00Z", { month: "short", day: "numeric" }),
      "Aug 9"
    );
  });

  test("the result does not depend on the machine's timezone", () => {
    // Whatever TZ the test runner is in, the explicit zone decides. This is
    // what stops the server and the browser disagreeing.
    const original = process.env.TZ;
    try {
      process.env.TZ = "Australia/Sydney";
      assert.equal(formatMoment("2026-08-10T03:00:00Z"), "Aug 9, 8:00 PM");
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("date arithmetic stays on calendar days", () => {
  test("adding days crosses months and years", () => {
    assert.equal(addDays("2026-08-30", 3), "2026-09-02");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  });

  /*
    Done in UTC on purpose: a UTC day is always 86,400,000 ms, while a Pacific
    day is 23 or 25 hours twice a year. Anchoring the arithmetic locally is how
    "seven days from now" quietly becomes six.
  */
  test("adding a week across the DST change is still seven days", () => {
    assert.equal(addDays("2026-03-05", 7), "2026-03-12");
    assert.equal(addDays("2026-10-30", 7), "2026-11-06");
  });

  test("daysBetweenDays is signed and exact across DST", () => {
    assert.equal(daysBetweenDays("2026-08-09", "2026-08-12"), 3);
    assert.equal(daysBetweenDays("2026-08-12", "2026-08-09"), -3);
    assert.equal(daysBetweenDays("2026-03-05", "2026-03-12"), 7);
    assert.equal(daysBetweenDays("2026-08-09", "2026-08-09"), 0);
  });
});
