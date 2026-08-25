/**
 * The cron schedules in `vercel.json`.
 *
 * Run with:  npm test
 *
 * ===========================================================================
 * Why a test reads a config file
 * ===========================================================================
 *
 * Two things about `vercel.json` fail in ways that point nowhere near it, and
 * both have already happened or nearly happened here:
 *
 *   1. **Frequency.** On the Hobby plan a cron may run at most once a day. An
 *      hourly schedule failed EVERY deployment for four commits, and the symptom
 *      was "my change isn't live" — nobody suspects a two-line JSON file. See the
 *      header of `app/api/cron/daily-digest/route.ts`.
 *   2. **Timezone.** Vercel schedules in UTC with no notion of daylight saving,
 *      so a schedule that reads like an evening job is an afternoon job for half
 *      the year, and nothing anywhere reports it. The club runs on Pacific time
 *      and this is the one place in the codebase where a time is written in UTC.
 *
 * So this asserts the intent — "the digest lands in the evening in California,
 * and every job is inside the plan's limit" — rather than pinning the literal
 * strings, which would just be a second copy of the file.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")
) as { crons: { path: string; schedule: string }[] };

/** The hour a `m h * * *` expression fires, in Pacific, on a given UTC date. */
function pacificHour(schedule: string, utcDate: string): number {
  const [minute, hour] = schedule.split(" ");
  const at = new Date(
    `${utcDate}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00Z`
  );
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    })
      .format(at)
      .replace("24", "0")
  );
}

/** A summer date (PDT, UTC-7) and a winter one (PST, UTC-8). */
const PDT_DAY = "2026-08-16";
const PST_DAY = "2026-12-16";

describe("every scheduled job is inside the Hobby frequency limit", () => {
  test("there is at least one cron, so this test can't pass vacuously", () => {
    assert.ok(config.crons.length > 0);
  });

  for (const cron of config.crons) {
    test(`${cron.path} runs at most once a day`, () => {
      /*
        `m h * * *` with literal numbers for minute and hour. Anything else —
        `*`, a list, a step like `0 *\/2` — runs more than daily and breaks the
        deploy rather than the app.
      */
      const [minute, hour, dom, month, dow] = cron.schedule.split(" ");
      assert.match(minute, /^\d{1,2}$/, `minute must be fixed: ${minute}`);
      assert.match(hour, /^\d{1,2}$/, `hour must be fixed: ${hour}`);
      assert.equal(dom, "*");
      assert.equal(month, "*");
      assert.equal(dow, "*");
    });
  }
});

describe("the daily digest lands in the California evening", () => {
  const digest = config.crons.find((c) => c.path.includes("daily-digest"));

  test("the entry exists", () => {
    assert.ok(digest, "no daily-digest cron in vercel.json");
  });

  test("it fires in the evening under BOTH offsets, never the afternoon", () => {
    /*
      Anish asked for 7pm Pacific. One UTC expression cannot be 7pm all year, so
      the requirement is a WINDOW: late enough that the day is essentially over,
      early enough that people still look at their phones. 6pm–8pm.

      A bare `0 5 * * *` (the old value) would fail this at 10pm/9pm, and so
      would any schedule somebody sets by thinking in local time and forgetting
      the conversion — which is the mistake this exists to catch.
    */
    for (const [label, day] of [
      ["PDT", PDT_DAY],
      ["PST", PST_DAY],
    ] as const) {
      const hour = pacificHour(digest!.schedule, day);
      assert.ok(
        hour >= 18 && hour <= 20,
        `${label}: fires at ${hour}:00 Pacific, outside 18:00–20:00`
      );
    }
  });

  test("it is 7pm in at least one half of the year", () => {
    // The window above would accept 6pm/8pm — neither of which is what was
    // asked for. At least one offset has to hit the request exactly.
    const hours = [PDT_DAY, PST_DAY].map((d) =>
      pacificHour(digest!.schedule, d)
    );
    assert.ok(
      hours.includes(19),
      `neither offset lands on 19:00 Pacific: ${hours.join(", ")}`
    );
  });
});

describe("the crons fit what the plan allows", () => {
  /*
    There was a "check-in nudge lands before the deadline" suite here. The nudge
    cron went when the club stopped asking for check-ins on 2026-08-24.

    This is what is worth keeping from it. Vercel's Hobby plan limits cron
    FREQUENCY, not just count — once a day each — and getting that wrong is not
    a warning, it is a rejected deployment. It cost four in a row once, and the
    error names the plan rather than the schedule that broke it.
  */
  test("every cron runs at most once a day", () => {
    for (const cron of config.crons) {
      const [minute, hour] = cron.schedule.split(" ");
      assert.ok(
        !minute.includes("*") && !minute.includes("/"),
        `${cron.path}: minute field "${minute}" fires more than once a day`
      );
      assert.ok(
        !hour.includes("*") && !hour.includes("/"),
        `${cron.path}: hour field "${hour}" fires more than once a day`
      );
    }
  });
});
