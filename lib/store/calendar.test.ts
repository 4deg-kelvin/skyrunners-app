/**
 * The calendar, and hours logged to misc.
 *
 * Run with:  npm test
 *
 * The rules worth pinning:
 *
 *   1. Overlapping events are ACCEPTED. Refusing them would break the one
 *      requirement the calendar has to get right.
 *   2. The organiser is always an attendee, and can't step out of their own.
 *   3. A closed event (a 1:1) can't be dropped in on.
 *   4. Hours with no project are valid — that's misc.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-calendar-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let ops: typeof import("./operations.ts");
let disk: typeof import("./disk.ts");

const TODAY = "2026-08-10";
const ORGANISER = "m-sofia";
const OTHER = "m-tyler";

before(async () => {
  ops = await import("./operations.ts");
  disk = await import("./disk.ts");
});

beforeEach(() => {
  disk.resetStore();
});

process.on("exit", () => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
});

function eventById(id: string) {
  return disk.readStore().events.find((e) => e.id === id);
}

async function session(over: Record<string, unknown> = {}) {
  const result = await ops.createEvent({
    title: "Spar layup",
    kind: "build_session",
    startsAt: "2026-08-13T19:00",
    endsAt: "2026-08-13T22:00",
    createdBy: ORGANISER,
    ...over,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

// ---------------------------------------------------------------------------

describe("putting something on the calendar", () => {
  test("a session is created with sensible defaults", async () => {
    const event = await session();
    assert.equal(eventById(event.id)?.title, "Spar layup");
    // A build session is open — the whole point is somebody else turning up.
    assert.equal(event.isOpen, true);
  });

  test("the organiser is always on the attendee list", async () => {
    // Nothing else would add them, and a session whose creator isn't listed
    // reads as somebody else's.
    const event = await session();
    assert.ok(event.attendeeIds.includes(ORGANISER));
  });

  test("named attendees are kept, and not duplicated", async () => {
    const event = await session({ attendeeIds: [OTHER, ORGANISER] });
    assert.deepEqual([...event.attendeeIds].sort(), [ORGANISER, OTHER].sort());
  });

  test("a 1:1 is closed by default", async () => {
    // Two engineers sitting down to engineer. Visible as a busy block, but
    // there's nothing to drop in on.
    const event = await session({ kind: "one_on_one", title: "Tyler / Sofia" });
    assert.equal(event.isOpen, false);
  });

  test("importance defaults by kind, not to a magic number", async () => {
    const tour = await session({ kind: "company_tour", title: "Skydio" });
    const oneOnOne = await session({ kind: "one_on_one", title: "1:1" });

    // A social event CAN outrank routine work — importance is not a proxy for
    // "is this official".
    assert.equal(tour.importanceWeight, 5);
    assert.equal(oneOnOne.importanceWeight, 1);
  });

  test("importance outside 1–5 is refused", async () => {
    const result = await ops.createEvent({
      title: "Nope",
      kind: "build_session",
      startsAt: "2026-08-13T19:00",
      createdBy: ORGANISER,
      importanceWeight: 9,
    });
    assert.equal(result.ok, false);
  });

  test("ending before starting is refused", async () => {
    const result = await ops.createEvent({
      title: "Backwards",
      kind: "build_session",
      startsAt: "2026-08-13T19:00",
      endsAt: "2026-08-13T17:00",
      createdBy: ORGANISER,
    });
    assert.equal(result.ok, false);
  });

  test("a nameless event is refused", async () => {
    const result = await ops.createEvent({
      title: "   ",
      kind: "build_session",
      startsAt: "2026-08-13T19:00",
      createdBy: ORGANISER,
    });
    assert.equal(result.ok, false);
  });

  test("a project that doesn't exist is refused", async () => {
    const result = await ops.createEvent({
      title: "Session",
      kind: "build_session",
      startsAt: "2026-08-13T19:00",
      createdBy: ORGANISER,
      projectId: "not-a-project",
    });
    assert.equal(result.ok, false);
  });

  test("OVERLAPPING EVENTS ARE ALLOWED", async () => {
    /*
      The requirement this whole feature is shaped around. A design review runs
      inside a general meeting; two build sessions run in different labs at
      once. Refusing the second — or hiding it — is the failure mode, not the
      safeguard.
    */
    const first = await session({ title: "All-hands" });
    const second = await session({ title: "Design review" });

    assert.ok(eventById(first.id));
    assert.ok(eventById(second.id));
    assert.equal(eventById(first.id)?.startsAt, eventById(second.id)?.startsAt);
  });
});

describe("turning up", () => {
  test("anyone can join an open session", async () => {
    const event = await session();
    const result = await ops.setEventAttendance({
      eventId: event.id,
      memberId: OTHER,
      attending: true,
    });

    assert.equal(result.ok, true);
    assert.ok(eventById(event.id)?.attendeeIds.includes(OTHER));
  });

  test("joining twice doesn't duplicate you", async () => {
    const event = await session();
    await ops.setEventAttendance({
      eventId: event.id,
      memberId: OTHER,
      attending: true,
    });
    await ops.setEventAttendance({
      eventId: event.id,
      memberId: OTHER,
      attending: true,
    });

    const ids = eventById(event.id)?.attendeeIds ?? [];
    assert.equal(ids.filter((id) => id === OTHER).length, 1);
  });

  test("you can step back out", async () => {
    const event = await session({ attendeeIds: [OTHER] });
    assert.equal(
      (
        await ops.setEventAttendance({
          eventId: event.id,
          memberId: OTHER,
          attending: false,
        })
      ).ok,
      true
    );
    assert.ok(!eventById(event.id)?.attendeeIds.includes(OTHER));
  });

  test("the organiser can't step out of their own session", async () => {
    // It would leave a session on the calendar with nobody running it, still
    // looking like it's happening.
    const event = await session();
    const result = await ops.setEventAttendance({
      eventId: event.id,
      memberId: ORGANISER,
      attending: false,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /cancel it instead/i);
  });

  test("a closed event can't be dropped in on", async () => {
    const event = await session({ kind: "one_on_one", title: "1:1" });
    const result = await ops.setEventAttendance({
      eventId: event.id,
      memberId: OTHER,
      attending: true,
    });
    assert.equal(result.ok, false);
  });

  test("an unknown event fails rather than throwing", async () => {
    const result = await ops.setEventAttendance({
      eventId: "nope",
      memberId: OTHER,
      attending: true,
    });
    assert.equal(result.ok, false);
  });
});

describe("editing and cancelling", () => {
  test("an event can be edited", async () => {
    const event = await session();
    const result = await ops.updateEvent({
      eventId: event.id,
      title: "Spar layup — moved to Lab 64",
      kind: "build_session",
      startsAt: "2026-08-13T20:00",
      location: "Lab 64",
    });

    assert.equal(result.ok, true);
    assert.equal(eventById(event.id)?.location, "Lab 64");
    assert.equal(eventById(event.id)?.startsAt, "2026-08-13T20:00");
  });

  test("cancelling removes it", async () => {
    const event = await session();
    assert.equal((await ops.deleteEvent(event.id)).ok, true);
    assert.equal(eventById(event.id), undefined);
  });

  test("unknown ids fail rather than throwing", async () => {
    assert.equal((await ops.deleteEvent("nope")).ok, false);
    assert.equal(
      (
        await ops.updateEvent({
          eventId: "nope",
          title: "X",
          kind: "build_session",
          startsAt: "2026-08-13T19:00",
        })
      ).ok,
      false
    );
  });
});

describe("hours logged to misc", () => {
  test("hours with no project are accepted", async () => {
    /*
      Follows directly from the calendar: somebody sees an open build session,
      turns up, and works three hours on a project they aren't committed to.
      Those hours are real, and refusing them left "log it against the wrong
      project" as the only way through.
    */
    const result = await ops.logHours({
      memberId: OTHER,
      workDate: TODAY,
      hours: 3,
      description: "Helped with the spar layup",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.projectId, undefined);
  });

  test("misc hours still obey the backdating limit", async () => {
    // Misc is a missing project, not a way around the other rules.
    const result = await ops.logHours({
      memberId: OTHER,
      workDate: "2026-06-01",
      hours: 3,
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });

  test("misc hours still obey the per-entry ceiling", async () => {
    const result = await ops.logHours({
      memberId: OTHER,
      workDate: TODAY,
      hours: 80,
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });
});
