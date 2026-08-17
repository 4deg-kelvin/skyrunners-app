/**
 * Whether a calendar subscription is still alive.
 *
 * Run with:  npm test
 *
 * The case this exists for: Anish RSVP'd on a Friday to a Saturday event, and by
 * Sunday his phone had nothing — while Settings said "Your calendar is
 * connected", because the badge was reporting a fetch from before the link had
 * been rotated. Silence is this feature's only failure mode, so the thing worth
 * testing is that silence gets NOTICED, and that it isn't cried wolf about.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { STALE_AFTER_HOURS, feedHealth } from "./health.ts";

const NOW = new Date("2026-08-16T12:00:00.000Z");
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("never fetched", () => {
  test("no timestamp is 'never', not 'stale'", () => {
    /*
      Different message and different fix: "never" means the link was probably
      not pasted in full, "stale" means it worked and stopped. Collapsing them
      would send somebody re-pasting a link that is fine.
    */
    assert.equal(feedHealth(undefined, NOW), "never");
  });

  test("an unparseable timestamp is 'never' rather than a crash", () => {
    // A bad value must not take down the Settings page, and "never" prompts the
    // same fix anyway.
    assert.equal(feedHealth("not a date", NOW), "never");
  });
});

describe("recently fetched", () => {
  test("minutes ago is fresh", () => {
    assert.equal(feedHealth(hoursAgo(0.1), NOW), "fresh");
  });

  test("a slow client's normal gap is still fresh", () => {
    // Google is slow and unpredictable. A day of silence there is routine, and
    // warning about it would make the warning meaningless.
    assert.equal(feedHealth(hoursAgo(24), NOW), "fresh");
    assert.equal(feedHealth(hoursAgo(STALE_AFTER_HOURS - 1), NOW), "fresh");
  });

  test("a timestamp slightly in the FUTURE is fresh, not stale", () => {
    /*
      Clock skew between Postgres and the rendering server makes a few seconds of
      negative age routine. "Last picked up in 4 seconds' time" must not render as
      a broken subscription.
    */
    assert.equal(feedHealth(hoursAgo(-0.01), NOW), "fresh");
  });
});

describe("gone quiet", () => {
  test(`past ${STALE_AFTER_HOURS} hours it is stale`, () => {
    assert.equal(feedHealth(hoursAgo(STALE_AFTER_HOURS + 1), NOW), "stale");
  });

  test("Anish's case: RSVP Friday, event Saturday, nothing by Sunday", () => {
    // The report that produced this file. Last collected Friday morning, read on
    // Sunday midday — 51 hours, so the page now says so instead of "connected".
    assert.equal(feedHealth("2026-08-14T09:00:00.000Z", NOW), "stale");
  });

  test("the boundary is exclusive, so exactly the threshold is still fresh", () => {
    // Arbitrary either way, but pinned: an off-by-one here flips the warning on
    // and off for everybody sitting near the line.
    assert.equal(feedHealth(hoursAgo(STALE_AFTER_HOURS), NOW), "fresh");
  });
});
