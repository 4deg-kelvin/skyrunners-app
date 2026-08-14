/**
 * The ICS feed format.
 *
 * Run with:  npm test
 *
 * Worth testing precisely because **every failure here is silent.** A calendar
 * client that dislikes the output does not report anything to the server; it
 * shows an empty calendar, or quietly drops the events it could not parse. There
 * is no feedback channel at all, and the member's symptom is "the SkyRunners
 * calendar doesn't work", which is unfalsifiable from this end.
 *
 * So the rules that clients enforce invisibly are pinned here instead.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  buildIcs,
  escapeText,
  foldLine,
  sequenceFor,
  toIcsUtc,
  uidFor,
  type IcsEvent,
} from "./ics.ts";

const STAMP = new Date("2026-08-14T12:00:00.000Z");

function event(over: Partial<IcsEvent> = {}): IcsEvent {
  return {
    id: "e1",
    title: "Build session",
    startsAt: "2026-08-20T18:00:00.000Z",
    ...over,
  };
}

const build = (events: IcsEvent[]) =>
  buildIcs(events, { name: "SkyRunners", stampAt: STAMP });

describe("timezones — the seven-hour bug", () => {
  /*
    The two shapes `startsAt` arrives in. Live data is `timestamptz` and reads
    back as an instant; the demo seed writes zoneless strings. Reading a zoneless
    one as UTC on Vercel would publish a 6pm session as 11am.
  */
  test("an instant is taken at its word", () => {
    assert.equal(toIcsUtc("2026-08-20T18:00:00.000Z"), "20260820T180000Z");
  });

  test("an offset is honoured", () => {
    // 11:00 at -07:00 is 18:00 UTC.
    assert.equal(toIcsUtc("2026-08-20T11:00:00-07:00"), "20260820T180000Z");
  });

  test("a zoneless value is read as CLUB time, not UTC", () => {
    // 18:00 Pacific in August (PDT, -07:00) is 01:00 UTC the next day. Reading
    // it as UTC would have produced 20260820T180000Z — seven hours out.
    assert.equal(toIcsUtc("2026-08-20T18:00"), "20260821T010000Z");
  });

  test("…and follows DST rather than assuming an offset", () => {
    // January is PST (-08:00), so the same wall clock is an hour further from
    // UTC. A hard-coded -7 or -8 is wrong for half the year.
    assert.equal(toIcsUtc("2026-01-20T18:00"), "20260121T020000Z");
  });

  test("garbage produces an empty value rather than Invalid Date", () => {
    // "NaN" inside a DTSTART makes a client drop the whole event, and possibly
    // the whole calendar. An empty string is at least inert.
    assert.equal(toIcsUtc("not a date"), "");
  });
});

describe("escaping — an unescaped comma truncates a field", () => {
  test("the four TEXT escapes", () => {
    assert.equal(escapeText("a,b"), "a\\,b");
    assert.equal(escapeText("a;b"), "a\\;b");
    assert.equal(escapeText("a\nb"), "a\\nb");
    assert.equal(escapeText("a\\b"), "a\\\\b");
  });

  test("backslash is escaped FIRST", () => {
    // Otherwise the escape inserted for the comma gets escaped in turn and the
    // reader sees a literal backslash-comma.
    assert.equal(escapeText("a\\,b"), "a\\\\\\,b");
  });

  test("a realistic location survives", () => {
    const ics = build([event({ location: "Lab 64, Durand; bay 2" })]);
    assert.match(ics, /LOCATION:Lab 64\\, Durand\\; bay 2/);
  });

  test("CRLF in a note becomes an escaped newline, not a real one", () => {
    // A raw newline inside a value ends the content line and the rest is read as
    // a new (invalid) property.
    const ics = build([event({ notes: "line one\r\nline two" })]);
    assert.ok(!/DESCRIPTION:line one\r\nline two/.test(ics));
    assert.match(ics, /DESCRIPTION:line one\\nline two/);
  });
});

describe("folding at 75 octets", () => {
  test("a short line is untouched", () => {
    assert.equal(foldLine("SUMMARY:Build session"), "SUMMARY:Build session");
  });

  test("a long line is split with a leading space", () => {
    const folded = foldLine(`SUMMARY:${"x".repeat(200)}`);
    const lines = folded.split("\r\n");
    assert.ok(lines.length > 1, "should have folded");
    for (const line of lines.slice(1)) {
      assert.ok(line.startsWith(" "), "continuations must start with a space");
    }
  });

  test("no line exceeds 75 octets", () => {
    const enc = new TextEncoder();
    const folded = foldLine(`SUMMARY:${"x".repeat(400)}`);
    for (const line of folded.split("\r\n")) {
      assert.ok(enc.encode(line).length <= 75, `too long: ${line.length}`);
    }
  });

  test("a multi-byte character is never split in half", () => {
    /*
      The reason folding counts OCTETS rather than characters. Splitting a UTF-8
      sequence produces a line some clients reject and others render as a
      replacement character — and a name with an accent in it is not exotic.
    */
    const folded = foldLine(`SUMMARY:${"é".repeat(80)}`);
    assert.ok(!folded.includes("�"), "no replacement characters");
    // Round-trips: strip the folding and the content is intact.
    assert.equal(folded.split("\r\n ").join("").length, "SUMMARY:".length + 80);
  });

  test("unfolding a built calendar recovers the original title", () => {
    const title = `Spar layup ${"very ".repeat(30)}long`;
    const ics = build([event({ title })]);
    const unfolded = ics.replace(/\r\n /g, "");
    assert.ok(unfolded.includes(`SUMMARY:${title}`));
  });
});

describe("the UID is what makes an update an update", () => {
  test("it is stable across content changes", () => {
    // The one that matters most: if the UID moved when a time changed,
    // rescheduling would leave the OLD time in everyone's calendar beside the
    // new one, and nobody would know which to turn up to.
    const a = uidFor("e1");
    const b = uidFor("e1");
    assert.equal(a, b);
  });

  test("different events get different UIDs", () => {
    assert.notEqual(uidFor("e1"), uidFor("e2"));
  });

  test("it is domain-qualified, per the RFC", () => {
    assert.match(uidFor("e1"), /^e1@.+\..+$/);
  });
});

describe("SEQUENCE rises when the event changes", () => {
  test("an unchanged event keeps its sequence", () => {
    assert.equal(sequenceFor(event()), sequenceFor(event()));
  });

  test("every field that a member would notice changes it", () => {
    const base = sequenceFor(event());
    const changes: Partial<IcsEvent>[] = [
      { startsAt: "2026-08-21T18:00:00.000Z" },
      { endsAt: "2026-08-20T20:00:00.000Z" },
      { title: "Build session (moved)" },
      { location: "Lab 64" },
      { notes: "bring the jig" },
      { cancelled: true },
    ];
    for (const over of changes) {
      assert.notEqual(
        sequenceFor(event(over)),
        base,
        `${JSON.stringify(over)} should change the sequence`
      );
    }
  });
});

describe("the document a client actually parses", () => {
  test("every line ends CRLF, including the last", () => {
    const ics = build([event()]);
    // No bare LF anywhere: split on CRLF and nothing should still contain \n.
    for (const line of ics.split("\r\n")) {
      assert.ok(!line.includes("\n"), `bare LF in: ${JSON.stringify(line)}`);
    }
    assert.ok(ics.endsWith("\r\n"), "must end with CRLF");
  });

  test("the required calendar properties are present", () => {
    const ics = build([event()]);
    for (const prop of [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:SkyRunners",
      "END:VCALENDAR",
    ]) {
      assert.ok(ics.includes(prop), `missing ${prop}`);
    }
  });

  test("PUBLISH, never REQUEST", () => {
    /*
      REQUEST is an invitation the client offers to reply to, and the reply would
      go nowhere — RSVP lives on the website, which is where the attendee list
      is. A feed of REQUESTs puts an Accept/Decline button in front of members
      whose answer is silently discarded.
    */
    const ics = build([event()]);
    assert.ok(!ics.includes("METHOD:REQUEST"));
  });

  test("BEGIN and END are balanced for every event", () => {
    const ics = build([event({ id: "a" }), event({ id: "b" })]);
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
    assert.equal((ics.match(/END:VEVENT/g) ?? []).length, 2);
  });

  test("a calendar with no events of its own is still a valid document", () => {
    /*
      A brand-new member is on no events. This must be a parseable calendar, not
      an error page — a client that gets HTML here may unsubscribe itself, and
      the member would never know why.

      This test used to assert there was NO VEVENT in that case. That was the
      bug: legal per RFC 5545, and refused outright by Google's "From URL" box.
      See the "eventless calendar" block below for what replaced it.
    */
    const ics = build([]);
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
  });
});

describe("duration and status", () => {
  test("no end time means a one-hour block", () => {
    // Omitting DTEND is legal and means instantaneous, which clients draw as a
    // sliver that is easy to miss on a busy day.
    const ics = build([event({ startsAt: "2026-08-20T18:00:00.000Z" })]);
    assert.match(ics, /DTSTART:20260820T180000Z/);
    assert.match(ics, /DTEND:20260820T190000Z/);
  });

  test("an explicit end time is used", () => {
    const ics = build([
      event({
        startsAt: "2026-08-20T18:00:00.000Z",
        endsAt: "2026-08-20T21:30:00.000Z",
      }),
    ]);
    assert.match(ics, /DTEND:20260820T213000Z/);
  });

  test("a cancelled event is PUBLISHED as cancelled, not dropped", () => {
    /*
      Dropping it would leave it in everybody's calendar forever: a subscription
      client cannot tell "removed from the feed" from "the feed is having a bad
      day", so most keep what they last saw. An explicit CANCELLED is the only
      thing that reliably clears it.
    */
    const ics = build([event({ cancelled: true })]);
    assert.match(ics, /STATUS:CANCELLED/);
    assert.ok(ics.includes("BEGIN:VEVENT"), "it must still be in the feed");
  });

  test("a live event is CONFIRMED and marks the member busy", () => {
    const ics = build([event()]);
    assert.match(ics, /STATUS:CONFIRMED/);
    assert.match(ics, /TRANSP:OPAQUE/);
  });
});

describe("a repeating meeting in the feed", () => {
  const weekly = (over = {}) =>
    event({
      repeat: {
        startsAt: "2026-09-01T18:00:00.000Z",
        repeatWeeklyUntil: "2026-09-29",
        ...over,
      },
    });

  test("one VEVENT carries the whole series", () => {
    /*
      The point of RRULE over fifty-two VEVENTs: RSVPing once puts every occurrence
      in a member's calendar, because the client expands the rule itself.
    */
    const ics = build([weekly()]);
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
    assert.match(ics, /RRULE:FREQ=WEEKLY;UNTIL=20260929T235959Z/);
  });

  test("fortnightly carries INTERVAL=2", () => {
    const ics = build([weekly({ repeatEveryWeeks: 2 })]);
    assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=2/);
  });

  test("a one-off emits no RRULE at all", () => {
    assert.ok(!build([event()]).includes("RRULE"));
  });

  test("a cancelled week emits EXDATE with the event's time", () => {
    // A date-only EXDATE against a timed series matches nothing, so the cancelled
    // week would stay in everybody's calendar.
    const ics = build([weekly({ skippedDates: ["2026-09-15"] })]);
    assert.match(ics, /EXDATE:20260915T180000Z/);
  });

  test("changing the range changes SEQUENCE", () => {
    /*
      Without this a client treats the revision as a duplicate and keeps the old
      schedule — so extending a series, or cancelling next week, would never reach
      anybody's phone.
    */
    const a = sequenceFor(weekly());
    const b = sequenceFor(weekly({ repeatWeeklyUntil: "2026-10-27" }));
    const c = sequenceFor(weekly({ repeatEveryWeeks: 2 }));
    const d = sequenceFor(weekly({ skippedDates: ["2026-09-15"] }));
    assert.equal(new Set([a, b, c, d]).size, 4, "all four must differ");
  });

  test("the material is joined with a separator, so fields can't blur", () => {
    // "AB"+"C" must not hash the same as "A"+"BC".
    assert.notEqual(
      sequenceFor(event({ title: "AB", location: "C" })),
      sequenceFor(event({ title: "A", location: "BC" }))
    );
  });
});

describe("no reminder is emitted", () => {
  test("there is no VALARM", () => {
    /*
      Removed on request. The feature is only that a club event POPULATES a
      member's calendar; how they want reminding about their own diary is their
      own setting.

      Asserted rather than just deleted, because "add a helpful 30-minute
      reminder" is an obvious-looking improvement somebody will reach for again —
      and whether a SUBSCRIBED calendar honours an alarm is the client's call, so it
      would fire for Apple users and silently not for Google ones. That asymmetry
      is worse than having no reminder at all.

      If one is ever genuinely wanted, the reliable channel is a Discord DM from
      the existing daily cron.
    */
    const ics = build([event()]);
    assert.ok(!ics.includes("VALARM"), "no alarm block");
    assert.ok(!ics.includes("TRIGGER"), "no trigger line");
  });

  test("the event itself is still complete without one", () => {
    // Guards against the removal having taken a neighbouring line with it.
    const ics = build([event()]);
    assert.match(ics, /BEGIN:VEVENT/);
    assert.match(ics, /TRANSP:OPAQUE/);
    assert.match(ics, /END:VEVENT/);
  });
});

describe("an eventless calendar — the one Google would not add", () => {
  /*
    A member who connects before joining anything has no events, and an empty
    VCALENDAR is legal per RFC 5545 but Google's "From URL" box rejects it with
    "Validation failed, please edit the URL and try again". Anish hit exactly
    this and reasonably read it as a broken link.

    So the document always carries at least one VEVENT. These tests pin both
    halves: that it appears when it must, and that it disappears the moment it
    is not needed.
  */
  test("still has a VEVENT, so a client will accept it", () => {
    const ics = build([]);
    assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
    assert.match(ics, /SUMMARY:SkyRunners calendar connected/);
  });

  test("it is all-day, so it occupies no time slot", () => {
    const ics = build([]);
    assert.match(ics, /DTSTART;VALUE=DATE:20260814/);
    // DTEND on an all-day event is EXCLUSIVE — the next day, or clients draw
    // a zero-length event and some drop it.
    assert.match(ics, /DTEND;VALUE=DATE:20260815/);
  });

  test("it never marks anybody busy", () => {
    /*
      The only event in the feed that is not a commitment. OPAQUE would make a
      note about nothing collide with a lecture, which is the opposite of the
      point of putting club events in a personal calendar.
    */
    assert.match(build([]), /TRANSP:TRANSPARENT/);
  });

  test("it is dated when the feed was made, NOT today", () => {
    /*
      The subtle one, and the reason `connectedOn` is plumbed through from the
      feed row at all. A DTSTART taken from the stamp would move forward every
      time a calendar app polled — so the note would walk down the member's
      calendar a day at a time, forever. Nobody reports that; everybody sees it.
    */
    const ics = buildIcs([], {
      name: "SkyRunners",
      stampAt: STAMP,
      connectedOn: "2026-03-02",
    });
    assert.match(ics, /DTSTART;VALUE=DATE:20260302/);
    assert.match(ics, /DTEND;VALUE=DATE:20260303/);
    assert.ok(!ics.includes("VALUE=DATE:20260814"), "not the stamp day");
  });

  test("month and year roll over correctly", () => {
    // `setUTCDate` past the end of the month is the whole reason this uses Date
    // arithmetic rather than string surgery on the day component.
    const ics = buildIcs([], {
      name: "SkyRunners",
      stampAt: STAMP,
      connectedOn: "2026-12-31",
    });
    assert.match(ics, /DTEND;VALUE=DATE:20270101/);
  });

  test("one real event replaces it entirely", () => {
    const ics = build([event()]);
    assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
    assert.ok(
      !ics.includes("SkyRunners calendar connected"),
      "the placeholder exists only to answer 'did this work'"
    );
  });
});
