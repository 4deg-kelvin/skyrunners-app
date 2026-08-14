/**
 * Tests for the check-in auto-fill window.
 *
 * This module is small and pure, and it is load-bearing in a way that isn't
 * obvious: the composer and `submitCheckIn` both call it, and if they ever got
 * different answers the form would mark a box required that the server accepts,
 * or accept one the server refuses with a message the page never showed. So the
 * tests here are mostly about the WINDOW, not the text formatting.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  checkInPeriodStart,
  draftProgressFrom,
  workByProject,
  workInPeriod,
  FIRST_PERIOD_DAYS,
  type LoggedWork,
} from "./checkin-draft.ts";

const log = (
  workDate: string,
  description: string,
  projectId?: string
): LoggedWork => ({ workDate, description, projectId });

describe("the period starts at the last SUBMITTED check-in", () => {
  test("with no history at all, it reaches back a week", () => {
    assert.equal(checkInPeriodStart([], "2026-08-14"), "2026-08-07");
    assert.equal(FIRST_PERIOD_DAYS, 7);
  });

  test("a submitted check-in anchors the window to its submission date", () => {
    const start = checkInPeriodStart(
      [{ submittedAt: "2026-08-11", status: "submitted" }],
      "2026-08-14"
    );
    assert.equal(start, "2026-08-11");
  });

  test("the LATEST submission wins, not the first", () => {
    const start = checkInPeriodStart(
      [
        { submittedAt: "2026-08-04", status: "reviewed" },
        { submittedAt: "2026-08-11", status: "submitted" },
        { submittedAt: "2026-08-07", status: "reviewed" },
      ],
      "2026-08-14"
    );
    assert.equal(start, "2026-08-11");
  });

  /*
    The two cases the plan's original wording ("the previous check-in's DUE
    date") would have got wrong. Both are real: people submit late, and people
    miss check-ins entirely.
  */
  test("a MISSED check-in does not close its window", () => {
    // Due on the 11th, never submitted. The last thing anybody actually heard
    // about was the submission on the 4th, so the window has to reach back
    // there — otherwise the week before the missed one is silently dropped, and
    // it is the exact week nobody has heard about.
    const start = checkInPeriodStart(
      [
        { submittedAt: "2026-08-04", status: "reviewed" },
        { submittedAt: undefined, status: "missed" },
      ],
      "2026-08-14"
    );
    assert.equal(start, "2026-08-04");
  });

  test("a LATE submission anchors to when it was sent, not when it was due", () => {
    // Due the 8th, actually sent the 12th. Anchoring to the due date would
    // re-surface the entries that late check-in already reported, and the
    // member would send their Lead the same lines twice.
    const start = checkInPeriodStart(
      [{ submittedAt: "2026-08-12", status: "late" }],
      "2026-08-14"
    );
    assert.equal(start, "2026-08-12");
  });

  test("a timestamp is truncated to its day", () => {
    const start = checkInPeriodStart(
      [{ submittedAt: "2026-08-11T18:42:00.000Z", status: "submitted" }],
      "2026-08-14"
    );
    assert.equal(start, "2026-08-11");
  });
});

describe("the window agrees with the lock rule", () => {
  /*
    `workIsLocked` in lib/store/operations.ts locks days STRICTLY BEFORE a
    submission, so work done the same evening a check-in went out is still
    editable. The window is therefore INCLUSIVE of the start day, or that
    evening's work would belong to no check-in at all.
  */
  test("work on the submission day itself is still in the new period", () => {
    const logs = [log("2026-08-11", "evening layup", "p1")];
    const start = checkInPeriodStart(
      [{ submittedAt: "2026-08-11", status: "submitted" }],
      "2026-08-14"
    );
    assert.equal(workInPeriod(logs, start, "2026-08-14").length, 1);
  });

  test("work before the window is excluded", () => {
    const logs = [
      log("2026-08-10", "old work", "p1"),
      log("2026-08-12", "new work", "p1"),
    ];
    const kept = workInPeriod(logs, "2026-08-11", "2026-08-14");
    assert.deepEqual(
      kept.map((w) => w.description),
      ["new work"]
    );
  });

  test("entries are returned oldest first — reading order", () => {
    const logs = [
      log("2026-08-13", "third", "p1"),
      log("2026-08-11", "first", "p1"),
      log("2026-08-12", "second", "p1"),
    ];
    assert.deepEqual(
      workInPeriod(logs, "2026-08-11", "2026-08-14").map((w) => w.description),
      ["first", "second", "third"]
    );
  });
});

describe("grouping by project", () => {
  test("buckets entries under their project", () => {
    const byProject = workByProject(
      [
        log("2026-08-12", "spar mesh", "wing"),
        log("2026-08-13", "spar FEA", "wing"),
        log("2026-08-13", "coupon layup", "layup"),
      ],
      "2026-08-11",
      "2026-08-14"
    );

    assert.deepEqual(
      byProject.get("wing")?.map((w) => w.description),
      ["spar mesh", "spar FEA"]
    );
    assert.equal(byProject.get("layup")?.length, 1);
  });

  /*
    Misc entries belong to no project's section. Dropping them is what keeps the
    check-in per-project and readable to a Lead overseeing several projects — and
    it means a member whose only logged work was misc still gets asked to write
    about their actual projects, which is right.
  */
  test("misc entries are dropped, not collected under a key", () => {
    const byProject = workByProject(
      [log("2026-08-12", "helped at the open build session")],
      "2026-08-11",
      "2026-08-14"
    );
    assert.equal(byProject.size, 0);
  });

  test("a project with nothing logged is simply absent", () => {
    const byProject = workByProject(
      [log("2026-08-12", "spar mesh", "wing")],
      "2026-08-11",
      "2026-08-14"
    );
    // `needsWriting` and the server's refusal both key off exactly this.
    assert.equal(byProject.has("layup"), false);
  });
});

describe("the draft text", () => {
  test("one line per entry, in order", () => {
    assert.equal(
      draftProgressFrom([
        log("2026-08-12", "reran the FEA", "w"),
        log("2026-08-13", "rebuilt the seal", "w"),
      ]),
      "reran the FEA\nrebuilt the seal"
    );
  });

  /*
    Logging the same thing three days running is normal and honest. Three
    identical lines in a check-in reads as a bug in the app rather than as
    persistence, and the member would delete two of them by hand every time.
  */
  test("identical lines collapse, keeping the first position", () => {
    assert.equal(
      draftProgressFrom([
        log("2026-08-11", "spar layup", "w"),
        log("2026-08-12", "Spar Layup", "w"),
        log("2026-08-13", "trimmed the flange", "w"),
        log("2026-08-14", "spar layup ", "w"),
      ]),
      "spar layup\ntrimmed the flange"
    );
  });

  test("empty and whitespace-only notes contribute nothing", () => {
    // Historical rows predate the note being required, so this is real data.
    assert.equal(
      draftProgressFrom([
        log("2026-08-12", "", "w"),
        log("2026-08-13", "   ", "w"),
      ]),
      ""
    );
  });

  test("nothing logged produces an empty draft, never a placeholder", () => {
    // The empty string is what makes the box render blank and required. A
    // cheerful "no work logged" here would be pre-filled text the member has to
    // delete before they can answer.
    assert.equal(draftProgressFrom([]), "");
  });
});
