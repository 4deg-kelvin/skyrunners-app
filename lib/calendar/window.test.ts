/**
 * The feed's window.
 *
 * Run with:  npm test
 *
 * This predicate decides whether an event a member said they would attend reaches
 * their phone at all, and it had no tests because it lived inline in the route.
 * Anish's report — RSVP'd Friday, event Saturday, nothing on the phone by Sunday —
 * is the first case here: the event must still be in the feed the day after it
 * happened, or the calendar has no way to show it late.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { TAIL_DAYS, withinFeedWindow } from "./window.ts";

/** Sunday. Aug 15 2026 was a Saturday. */
const SUNDAY = Date.parse("2026-08-16T19:00:00.000Z");
const daysFromSunday = (d: number) =>
  new Date(SUNDAY + d * 86_400_000).toISOString();

describe("Anish's case — the event was yesterday", () => {
  test("a one-off from yesterday is still in the feed", () => {
    /*
      If it were dropped the moment it passed, a client that had not polled during
      the event's own lifetime would never show it — which is exactly what a
      Friday RSVP to a Saturday event needs, read on Sunday.
    */
    assert.equal(
      withinFeedWindow({ startsAt: daysFromSunday(-1) }, SUNDAY),
      true
    );
  });

  test("and so is one from three weeks ago", () => {
    // The tail exists so a CANCELLED event stays present long enough to actually
    // clear from a client that stored it. See `TAIL_DAYS`.
    assert.equal(
      withinFeedWindow({ startsAt: daysFromSunday(-(TAIL_DAYS - 2)) }, SUNDAY),
      true
    );
  });

  test("but not one from last term", () => {
    assert.equal(
      withinFeedWindow({ startsAt: daysFromSunday(-90) }, SUNDAY),
      false
    );
  });
});

describe("ahead", () => {
  test("tomorrow and next term are both in", () => {
    assert.equal(
      withinFeedWindow({ startsAt: daysFromSunday(1) }, SUNDAY),
      true
    );
    assert.equal(
      withinFeedWindow({ startsAt: daysFromSunday(120) }, SUNDAY),
      true
    );
  });

  test("beyond the horizon is out", () => {
    assert.equal(
      withinFeedWindow({ startsAt: daysFromSunday(400) }, SUNDAY),
      false
    );
  });
});

describe("a repeating series is judged on where it ENDS", () => {
  test("a series that began months ago but still runs is kept", () => {
    /*
      The trap this rule exists for: every occurrence lives on one row whose
      `startsAt` is the first one. Windowing on that alone would delete the club's
      weekly meeting from everybody's calendar a month after it started.
    */
    assert.equal(
      withinFeedWindow(
        { startsAt: daysFromSunday(-120), repeatUntil: "2026-12-08" },
        SUNDAY
      ),
      true
    );
  });

  test("a series that finished long ago is dropped", () => {
    assert.equal(
      withinFeedWindow(
        { startsAt: daysFromSunday(-200), repeatUntil: "2026-05-01" },
        SUNDAY
      ),
      false
    );
  });
});

describe("bad data", () => {
  test("an unparseable start is dropped, not published", () => {
    // `Invalid Date` in a DTSTART makes some clients discard the WHOLE calendar,
    // so one bad row would take every other event with it.
    assert.equal(withinFeedWindow({ startsAt: "nonsense" }, SUNDAY), false);
  });
});
