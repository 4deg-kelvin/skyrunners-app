/**
 * ============================================================================
 * The club runs on Pacific time. Everything here exists to keep it that way.
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * The bug this replaces
 * ---------------------------------------------------------------------------
 *
 * `today()` was `new Date().toISOString().slice(0, 10)` — the UTC date. Vercel
 * runs in UTC, so from **5pm Pacific the production app believed it was
 * tomorrow**. Every evening in the lab, which is when this club actually
 * works, hours logged "today" landed on tomorrow's date, a check-in due today
 * read as overdue, and the Gantt's today-line stood a day to the right.
 *
 * It was invisible in development because a laptop in California IS Pacific,
 * so `toISOString()` and the local day agree until 5pm and nobody runs
 * `npm run dev` and checks the date at 6pm.
 *
 * ---------------------------------------------------------------------------
 * Two kinds of value, and mixing them is where the day gets lost
 * ---------------------------------------------------------------------------
 *
 * **Calendar dates** — `YYYY-MM-DD`. A deliverable's due date, a work log's
 * date, when somebody joined. These name a square on a calendar; they are not
 * instants and have no time. `dueDate`, `targetDate`, `workDate`, `joinedAt`,
 * `completedAt`, `startsOn`, `endsOn`, `pausedUntil`, `archivedAt`.
 *
 * **Instants** — a full ISO timestamp. When an event starts, when a message
 * was delivered. `startsAt`, `createdAt`, `discordVerifiedAt`.
 *
 * `new Date("2026-08-09")` parses as UTC **midnight**, so formatting it in any
 * negative-offset zone — which is all of the Americas — names *the day
 * before*. That single line, repeated across nine files, is why a deliverable
 * due the 9th displayed as "Aug 8". Worse, it rendered as the 9th on the
 * server (UTC) and the 8th in the browser, so React logged a hydration
 * mismatch nobody connected to it.
 *
 * `formatDay` and `formatMoment` are the fix. Both pass an explicit
 * `timeZone`, so server and browser render the same characters — never
 * `toLocaleDateString` with the zone left to the machine.
 *
 * ---------------------------------------------------------------------------
 * Why the whole club shares one timezone
 * ---------------------------------------------------------------------------
 *
 * Because it's one club, in one lab, on one campus. A per-member timezone
 * would mean two people looking at the same deadline seeing different days,
 * which is worse than wrong — it's wrong differently for each of them. If the
 * team ever runs a remote sub-team, this constant is the one place to revisit.
 */

/**
 * IANA zone, not a fixed offset.
 *
 * "PST" is -8 and "PDT" is -7, and hard-coding either is wrong for half the
 * year — including the week of the switch, when a hard-coded offset silently
 * shifts every date in the app by a day for anybody near midnight.
 * `America/Los_Angeles` carries the rules and follows the change itself.
 */
export const CLUB_TIME_ZONE = "America/Los_Angeles";

/**
 * Today's date on campus, as `YYYY-MM-DD`.
 *
 * `en-CA` because its short date format IS ISO order — the alternative is
 * assembling `formatToParts` by hand, which is three times the code for the
 * same string.
 */
export function todayInClubTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Format a CALENDAR DATE (`YYYY-MM-DD`). Never shifts the day.
 *
 * Anchored at UTC midnight and formatted in UTC, so the characters that come
 * out are the ones in the string that went in. Do not "improve" this by
 * formatting in `CLUB_TIME_ZONE`: that would re-introduce the off-by-one,
 * because a UTC midnight is 5pm the previous day in California.
 */
export function formatDay(
  date: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
): string {
  const day = date.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    ...options,
    timeZone: "UTC",
  });
}

/**
 * Format an INSTANT, in club time.
 *
 * The explicit zone is the whole point: without it the server renders in UTC
 * and the browser in whatever the reader's laptop says, so the same event
 * shows two different times and React complains about the mismatch.
 */
export function formatMoment(
  iso: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
): string {
  return new Date(iso).toLocaleDateString("en-US", {
    ...options,
    timeZone: CLUB_TIME_ZONE,
  });
}

/** Clock time of an instant, in club time. "7:30 PM". */
export function formatClock(
  iso: string,
  options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }
): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    ...options,
    timeZone: CLUB_TIME_ZONE,
  });
}

/**
 * Shift a calendar date by whole days.
 *
 * Safe against DST precisely because it works in UTC: a UTC day is always
 * exactly 86,400,000 ms, whereas adding a day to a Pacific-anchored instant
 * lands on 23:00 or 01:00 twice a year and truncates to the wrong date.
 */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetweenDays(from: string, to: string): number {
  const ms =
    Date.parse(`${to.slice(0, 10)}T00:00:00Z`) -
    Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
