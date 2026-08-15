/**
 * Weekly repeating events.
 *
 * Run with:  npm test
 *
 * Recurrence is where calendars go wrong, and the failures are quiet: a meeting
 * lands on the wrong weekday twice a year, or the last week silently vanishes, and
 * the people who notice are the ones who turned up to an empty room.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  MAX_OCCURRENCES,
  occurrenceDates,
  occurrenceEnd,
  occurrenceStart,
  exdatesFor,
  repeatProblem,
  rruleFor,
  type RepeatingEvent,
} from "./recurrence.ts";
/*
  The REAL club-time converter, not a hand-rolled one.

  `rruleFor` and `exdatesFor` both take it injected so this module stays free of
  ICS rules. The tests below used a local fake that treated its input as UTC,
  and that is precisely why they could not catch the UNTIL bug: a fake with no
  concept of Pacific time agrees with any timezone mistake the real one makes.
*/
import { toIcsUtc } from "./ics.ts";

/**
 * A Tuesday meeting stored as an INSTANT, like live `timestamptz` data.
 *
 * 18:00 **UTC**, which is 11am Pacific — not 6pm Pacific, as this said for a
 * while. That mislabelling mattered: a late-morning meeting never crosses a UTC
 * date boundary, so every assertion built on this fixture passed while evening
 * meetings — i.e. all of them, in a student club — were broken. `evening()`
 * below is the fixture that actually exercises the boundary.
 */
function weekly(over: Partial<RepeatingEvent> = {}): RepeatingEvent {
  return {
    startsAt: "2026-09-01T18:00:00.000Z",
    repeatWeeklyUntil: "2026-09-29",
    ...over,
  };
}

/**
 * A 6pm PACIFIC meeting — what this club actually runs, and the case that broke.
 *
 * Zoneless, so `instantFrom` reads it in club time. That is the shape the demo
 * seed writes and the shape a `<input type="datetime-local">` posts, and it is
 * the one where the UTC date is a day ahead of the club date: 6pm Pacific in
 * December is 02:00Z tomorrow. Any window or cutoff expressed as `T235959Z` on
 * the club's date therefore lands BEFORE the meeting it was meant to include.
 *
 * December on purpose — PST is UTC-8, an hour further from UTC than PDT, so the
 * boundary is crossed by two hours rather than one.
 */
function evening(over: Partial<RepeatingEvent> = {}): RepeatingEvent {
  return {
    startsAt: "2026-12-01T18:00",
    repeatWeeklyUntil: "2026-12-08",
    ...over,
  };
}

const WIDE = ["2020-01-01", "2030-01-01"] as const;

describe("a one-off event", () => {
  test("produces exactly its own date", () => {
    const e: RepeatingEvent = { startsAt: "2026-09-01T18:00:00.000Z" };
    assert.deepEqual(occurrenceDates(e, ...WIDE), ["2026-09-01"]);
  });

  test("is absent outside the window", () => {
    const e: RepeatingEvent = { startsAt: "2026-09-01T18:00:00.000Z" };
    assert.deepEqual(occurrenceDates(e, "2026-10-01", "2026-12-01"), []);
    assert.deepEqual(occurrenceDates(e, "2026-01-01", "2026-08-01"), []);
  });

  test("a cancelled one-off produces nothing", () => {
    const e: RepeatingEvent = {
      startsAt: "2026-09-01T18:00:00.000Z",
      skippedDates: ["2026-09-01"],
    };
    assert.deepEqual(occurrenceDates(e, ...WIDE), []);
  });
});

describe("weekly expansion", () => {
  test("every seventh day, inclusive of the last", () => {
    /*
      The last-week bug: an UNTIL treated as exclusive drops 2026-09-29, and
      nobody notices until the meeting that should have happened didn't.
    */
    assert.deepEqual(occurrenceDates(weekly(), ...WIDE), [
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
  });

  test("every occurrence is the same weekday", () => {
    // The DST trap. Adding 7 days to a Pacific-anchored instant lands on 23:00
    // or 01:00 twice a year and moves a Tuesday meeting to a Monday.
    const dates = occurrenceDates(
      weekly({ repeatWeeklyUntil: "2027-03-30" }),
      ...WIDE
    );
    const weekdays = new Set(
      dates.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay())
    );
    assert.equal(weekdays.size, 1, `spread across weekdays: ${[...weekdays]}`);
  });

  test("…including across the spring DST change", () => {
    // US DST springs forward on 2027-03-14. A series spanning it must not shift.
    const dates = occurrenceDates(
      { startsAt: "2027-03-02T18:00:00.000Z", repeatWeeklyUntil: "2027-03-30" },
      ...WIDE
    );
    assert.deepEqual(dates, [
      "2027-03-02",
      "2027-03-09",
      "2027-03-16",
      "2027-03-23",
      "2027-03-30",
    ]);
  });

  test("the window clips both ends without shifting the rhythm", () => {
    // Clipping must not re-phase the series — the dates are still Tuesdays from
    // the original start, not "a week after `from`".
    assert.deepEqual(occurrenceDates(weekly(), "2026-09-09", "2026-09-23"), [
      "2026-09-15",
      "2026-09-22",
    ]);
  });

  test("an end date before the next occurrence gives just the first", () => {
    assert.deepEqual(
      occurrenceDates(weekly({ repeatWeeklyUntil: "2026-09-05" }), ...WIDE),
      ["2026-09-01"]
    );
  });

  test("skipped weeks are removed, the rest keep their dates", () => {
    // "No meeting during finals" without deleting the series and its attendees.
    assert.deepEqual(
      occurrenceDates(
        weekly({ skippedDates: ["2026-09-08", "2026-09-22"] }),
        ...WIDE
      ),
      ["2026-09-01", "2026-09-15", "2026-09-29"]
    );
  });

  test("a runaway end date is capped rather than hanging", () => {
    // A typo of 2126 for 2026 would otherwise expand to thousands inside a
    // request that renders a page.
    const dates = occurrenceDates(
      weekly({ repeatWeeklyUntil: "2126-09-29" }),
      ...WIDE
    );
    assert.equal(dates.length, MAX_OCCURRENCES);
  });

  test("a malformed start produces nothing rather than Invalid Date", () => {
    assert.deepEqual(
      occurrenceDates(
        { startsAt: "nonsense", repeatWeeklyUntil: "2026-09-29" },
        ...WIDE
      ),
      []
    );
  });
});

describe("moving the time onto an occurrence", () => {
  test("the time of day and zone are preserved exactly", () => {
    /*
      Rebuilding through `Date` would turn a stored instant into a zoneless
      string or vice versa — the seven-hour bug `instantFrom` exists to prevent.
      So only the date part is swapped.
    */
    const e = weekly();
    assert.equal(occurrenceStart(e, "2026-09-15"), "2026-09-15T18:00:00.000Z");
  });

  test("a zoneless stored value stays zoneless", () => {
    const e = weekly({ startsAt: "2026-09-01T18:00" });
    assert.equal(occurrenceStart(e, "2026-09-15"), "2026-09-15T18:00");
  });

  test("an end time on the same day follows the start", () => {
    const e = weekly({ endsAt: "2026-09-01T20:00:00.000Z" });
    assert.equal(occurrenceEnd(e, "2026-09-15"), "2026-09-15T20:00:00.000Z");
  });

  test("an overnight event keeps its length", () => {
    // A build session ending after midnight must not collapse to a negative
    // duration on later occurrences.
    const e = weekly({
      startsAt: "2026-09-01T21:00:00.000Z",
      endsAt: "2026-09-02T02:00:00.000Z",
    });
    assert.equal(occurrenceEnd(e, "2026-09-15"), "2026-09-16T02:00:00.000Z");
  });

  test("no end time stays no end time", () => {
    assert.equal(occurrenceEnd(weekly(), "2026-09-15"), undefined);
  });
});

describe("what the form and the server both refuse", () => {
  test("no repeat is always fine", () => {
    assert.equal(repeatProblem("2026-09-01T18:00", undefined), null);
  });

  test("a valid repeat passes", () => {
    assert.equal(repeatProblem("2026-09-01T18:00", "2026-12-01"), null);
  });

  test("an end before the start is refused", () => {
    const problem = repeatProblem("2026-09-01T18:00", "2026-08-01");
    assert.ok(problem);
    assert.match(problem, /can't stop repeating/);
  });

  test("a garbled date is refused", () => {
    assert.ok(repeatProblem("2026-09-01T18:00", "not-a-date"));
  });

  test("a mistyped year is refused, and the message names the real mistake", () => {
    const problem = repeatProblem("2026-09-01T18:00", "2126-09-01");
    assert.ok(problem);
    // "104 occurrences" would be baffling; "over 100 years" is what makes
    // somebody spot the typo.
    assert.match(problem, /years/);
  });

  test("the same day is allowed — a one-week series", () => {
    assert.equal(repeatProblem("2026-09-01T18:00", "2026-09-01"), null);
  });
});

describe("the RRULE the feed emits", () => {
  test("nothing for a one-off", () => {
    assert.equal(rruleFor({ startsAt: "2026-09-01T18:00" }, toIcsUtc), null);
  });

  test("weekly, with UNTIL at the end of the last day IN CLUB TIME", () => {
    /*
      An instant rather than a DATE value, because some clients read a bare DATE
      UNTIL as exclusive and drop the final occurrence.

      And 23:59:59 *Pacific*, which is 06:59:59Z the next morning in September.
      It used to be `T235959Z` — the same wall-clock reading in the wrong zone.
    */
    assert.equal(
      rruleFor(weekly(), toIcsUtc),
      "RRULE:FREQ=WEEKLY;UNTIL=20260930T065959Z"
    );
  });

  test("UNTIL is at or after the last occurrence's own start instant", () => {
    /*
      THE invariant, and the one that was violated.

      Stated as a comparison of instants rather than of dates. The test that
      stood here asserted only that the last occurrence's DATE appeared
      somewhere in the rule — which `UNTIL=20260929T235959Z` satisfied while
      excluding the 6pm meeting on 2026-09-29. A date-level check cannot see a
      time-level bug.

      Both sides are `YYYYMMDDTHHMMSSZ`, which sorts correctly as a string.
    */
    for (const e of [weekly(), evening(), evening({ repeatEveryWeeks: 2 })]) {
      const dates = occurrenceDates(e, ...WIDE);
      const lastStart = toIcsUtc(occurrenceStart(e, dates[dates.length - 1]));
      const until = rruleFor(e, toIcsUtc)!.match(/UNTIL=(\d{8}T\d{6}Z)/)![1];
      assert.ok(
        until >= lastStart,
        `UNTIL ${until} would drop the last occurrence at ${lastStart}`
      );
    }
  });

  test("an evening series keeps its final meeting", () => {
    /*
      The exact shape of the shipped bug, pinned as its own case.

      A 6pm Pacific meeting on the final day is 02:00Z the NEXT day in December.
      `UNTIL=20261208T235959Z` is earlier than that, so clients expanded the
      series without its last week — while the website listed it. The member's
      symptom is a meeting nobody's phone knows about, and there is no error
      anywhere to find.
    */
    const e = evening();
    assert.equal(
      rruleFor(e, toIcsUtc),
      "RRULE:FREQ=WEEKLY;UNTIL=20261209T075959Z"
    );
    // 20261209T020000Z — the thing the old rule cut off by five hours.
    const dates = occurrenceDates(e, ...WIDE);
    assert.equal(dates[dates.length - 1], "2026-12-08");
    assert.ok(toIcsUtc(occurrenceStart(e, "2026-12-08")) < "20261209T075959Z");
  });
});

describe("every other week, for the townhall", () => {
  test("interval 2 skips a week each time", () => {
    assert.deepEqual(
      occurrenceDates(
        weekly({ repeatEveryWeeks: 2, repeatWeeklyUntil: "2026-10-27" }),
        ...WIDE
      ),
      ["2026-09-01", "2026-09-15", "2026-09-29", "2026-10-13", "2026-10-27"]
    );
  });

  test("it stays on the same weekday", () => {
    const dates = occurrenceDates(
      weekly({ repeatEveryWeeks: 2, repeatWeeklyUntil: "2027-03-30" }),
      ...WIDE
    );
    const weekdays = new Set(
      dates.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay())
    );
    assert.equal(weekdays.size, 1);
  });

  test("0 and negatives fall back to weekly rather than hanging", () => {
    // A 0 would make the loop produce the same date MAX_OCCURRENCES times.
    for (const bad of [0, -1, 1.5, undefined]) {
      const dates = occurrenceDates(
        weekly({ repeatEveryWeeks: bad as number }),
        ...WIDE
      );
      assert.equal(dates.length, 5, `repeatEveryWeeks=${bad}`);
    }
  });

  test("the RRULE carries INTERVAL only when it is not 1", () => {
    assert.equal(
      rruleFor(weekly({ repeatEveryWeeks: 2 }), toIcsUtc),
      "RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20260930T065959Z"
    );
    assert.ok(
      !rruleFor(weekly({ repeatEveryWeeks: 1 }), toIcsUtc)!.includes("INTERVAL")
    );
  });

  test("the RRULE and the expansion agree on the cadence", () => {
    // If they disagreed, the website and the member's phone would show different
    // meeting weeks — unfalsifiable from either side.
    const e = weekly({ repeatEveryWeeks: 2, repeatWeeklyUntil: "2026-10-27" });
    const dates = occurrenceDates(e, ...WIDE);
    const gaps = dates
      .slice(1)
      .map(
        (d, i) =>
          (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${dates[i]}T00:00:00Z`)) /
          86_400_000
      );
    assert.deepEqual(new Set(gaps), new Set([14]));
    assert.match(rruleFor(e, toIcsUtc)!, /INTERVAL=2/);
  });
});

describe("EXDATE clears a cancelled week", () => {
  const toUtc = (iso: string) =>
    `${new Date(iso).toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;

  test("nothing when the event does not repeat", () => {
    assert.equal(
      exdatesFor({ startsAt: "2026-09-01T18:00:00.000Z" }, toUtc),
      null
    );
  });

  test("nothing when no week was cancelled", () => {
    assert.equal(exdatesFor(weekly(), toUtc), null);
  });

  test("one EXDATE line carrying the event's own TIME", () => {
    /*
      A date-only EXDATE against a timed series matches nothing, so the cancelled
      week stays in everybody's calendar. The time is what makes it bite.
    */
    const line = exdatesFor(weekly({ skippedDates: ["2026-09-15"] }), toUtc);
    assert.equal(line, "EXDATE:20260915T180000Z");
  });

  test("several cancelled weeks are comma-joined", () => {
    const line = exdatesFor(
      weekly({ skippedDates: ["2026-09-08", "2026-09-22"] }),
      toUtc
    );
    assert.equal(line, "EXDATE:20260908T180000Z,20260922T180000Z");
  });

  test("what EXDATE excludes matches what the expansion drops", () => {
    // The two halves of the same decision: the website hides the week and the
    // feed cancels it. If they disagreed, one of them would be lying.
    const e = weekly({ skippedDates: ["2026-09-15"] });
    assert.ok(!occurrenceDates(e, ...WIDE).includes("2026-09-15"));
    assert.match(exdatesFor(e, toUtc)!, /20260915/);
  });
});
