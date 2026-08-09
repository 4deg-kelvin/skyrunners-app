/**
 * The check-in due label.
 *
 * Run with:  npm test
 *
 * Two things worth pinning. The heading used to print a bare weekday — "Your
 * Sunday check-in" — which says nothing about whether Sunday has been and gone,
 * and hides the one state that matters most.
 *
 * And the date arithmetic is the exact trap `lib/mock-data.ts` warns about:
 * `dueAt` carries a time and parses as LOCAL, a bare date parses as UTC
 * midnight, and formatting a UTC midnight without `timeZone: "UTC"` names the
 * day before in every timezone this club is in.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { checkInDue } from "./labels.ts";

describe("checkInDue", () => {
  test("due today says today, not the weekday", () => {
    const due = checkInDue("2026-08-09T23:59", "2026-08-09");
    assert.equal(due.heading, "Today's check-in");
    assert.equal(due.phrase, "check-in, due today");
    assert.equal(due.isLate, false);
  });

  test("due tomorrow says tomorrow", () => {
    const due = checkInDue("2026-08-10T23:59", "2026-08-09");
    assert.equal(due.heading, "Tomorrow's check-in");
    assert.equal(due.isLate, false);
  });

  test("further out names the weekday", () => {
    // 2026-08-13 is a Thursday.
    const due = checkInDue("2026-08-13T23:59", "2026-08-09");
    assert.equal(due.heading, "Thursday's check-in");
    assert.equal(due.phrase, "check-in, due Thursday");
    assert.equal(due.isLate, false);
  });

  test("overdue says how late, in days", () => {
    // Age, not a weekday — the same rule as every other escalation here.
    const due = checkInDue("2026-08-06T23:59", "2026-08-09");
    assert.equal(due.isLate, true);
    assert.match(due.heading, /3 days late/);
    assert.equal(due.phrase, "check-in, 3 days late");
  });

  test("one day late is singular", () => {
    const due = checkInDue("2026-08-08T23:59", "2026-08-09");
    assert.equal(due.phrase, "check-in, 1 day late");
  });

  test("the weekday is the real one, not the day before", () => {
    /*
      The timezone trap. 2026-08-09 is a Sunday. Parsed as UTC midnight and
      formatted in local time west of Greenwich, it comes out as Saturday —
      which is how a check-in ends up labelled with the wrong day for everyone
      in California.
    */
    const thursday = checkInDue("2026-08-13T23:59", "2026-08-09");
    assert.match(thursday.heading, /Thursday/);

    const sundayLate = checkInDue("2026-08-09T23:59", "2026-08-12");
    assert.match(sundayLate.heading, /Sunday/);
  });

  test("a date-only dueAt works too", () => {
    // Nothing should depend on the time half being present.
    assert.equal(
      checkInDue("2026-08-09", "2026-08-09").heading,
      "Today's check-in"
    );
  });
});
