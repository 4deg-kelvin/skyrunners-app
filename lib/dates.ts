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
 * How far `zone` is ahead of UTC at a given instant, in milliseconds.
 *
 * Derived from `Intl` rather than a table, so it follows the DST rules for the
 * actual date instead of assuming -8 (PST) or -7 (PDT) — either of which is
 * wrong for half the year. Positive east of Greenwich; negative for California.
 */
function zoneOffsetMs(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .filter((p) => p.type !== "literal");

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  // `hour` comes back as 24 for midnight under hour12: false, which Date.UTC
  // would roll into the next day.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUtc - at.getTime();
}

/**
 * Turn a stored datetime into a real instant.
 *
 * ---------------------------------------------------------------------------
 * The two shapes `startsAt` actually arrives in, and why it matters
 * ---------------------------------------------------------------------------
 *
 * `events.starts_at` is `timestamptz`, so LIVE data reads back as a proper
 * instant — `2026-08-12T15:00:00.000Z`. The demo seed in `lib/mock-data.ts`
 * writes zoneless strings instead — `2026-08-12T16:00` — and those two are
 * interpreted differently by `new Date()`: the first is absolute, the second is
 * whatever timezone the machine happens to be in.
 *
 * On a developer's laptop in California those coincide closely enough that
 * nothing looks wrong. On Vercel, which runs UTC, a zoneless string is read as
 * 16:00 UTC — 9am Pacific — so an evening build session would publish to
 * somebody's phone as a morning one. Seven hours is not a rounding error; it is
 * a member turning up on the wrong side of the day.
 *
 * So: a value carrying `Z` or an offset is taken at its word, and a zoneless one
 * is read as CLUB time, which is the convention the rest of the app already
 * follows for a bare datetime. Everything that has to emit an absolute time —
 * the ICS calendar feed above all — goes through here rather than calling
 * `new Date()` and hoping.
 */
export function instantFrom(iso: string): Date {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso.trim());
  if (hasZone) return new Date(iso);

  /*
    Read the literal as if it were UTC, then subtract the club's offset at that
    moment. One `Intl` lookup, DST-correct, no table.

    The offset is looked up at the GUESS rather than at the answer, which is
    ambiguous for exactly one hour each autumn when 1–2am happens twice. Both
    readings are the same wall-clock time and an hour apart in absolute terms;
    picking one silently is the standard trade, and the alternative (refusing the
    input) would drop a real event.
  */
  const guess = new Date(`${iso.trim().slice(0, 19)}Z`);
  if (Number.isNaN(guess.getTime())) return guess;
  return new Date(guess.getTime() - zoneOffsetMs(guess, CLUB_TIME_ZONE));
}

/**
 * The club's WALL-CLOCK reading of a stored datetime: `YYYY-MM-DDTHH:MM:SS`.
 *
 * The inverse of `instantFrom` — that turns "6pm on campus" into an instant, this
 * turns an instant back into "6pm on campus". Empty string for a malformed input,
 * matching `toIcsUtc`, because an `Invalid Date` inside a calendar property makes
 * clients drop the event or the whole document.
 *
 * ---------------------------------------------------------------------------
 * Why a repeating calendar event cannot use an absolute instant
 * ---------------------------------------------------------------------------
 *
 * This exists for `RRULE`. A repeat is a rule, not a list, so the client expands
 * it — and if `DTSTART` is an absolute UTC instant, the client repeats *that
 * instant*, holding the UTC time fixed and letting the local time drift by an
 * hour across a DST change.
 *
 * Which is exactly what shipped: a 5pm Pacific weekly meeting starting in
 * August appeared as 4pm from November onward, while the website still said 5pm.
 * A member reading their phone turns up an hour late to a meeting the site had
 * right, and nothing anywhere reports an error.
 *
 * The fix is to say what was actually meant — "17:00, in America/Los_Angeles,
 * every week" — which requires the wall time and a `TZID`. See `buildIcs`.
 */
export function clubWallTime(iso: string): string {
  const at = instantFrom(iso);
  if (Number.isNaN(at.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Midnight comes back as "24" under hour12: false in some ICU builds, which
  // would be an invalid ICS hour — the same normalisation `zoneOffsetMs` needs.
  const hour = String(Number(get("hour")) % 24).padStart(2, "0");

  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
}

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
