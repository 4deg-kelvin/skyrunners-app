/**
 * ============================================================================
 * WEEKLY REPEATING EVENTS
 * ============================================================================
 *
 * A club meets on Tuesdays. Before this, that meant creating ten separate events
 * and members RSVPing to each one — so nobody did, and the calendar was a list of
 * one-offs that didn't match how the club actually runs.
 *
 * ----------------------------------------------------------------------------
 * WEEKLY ONLY, and that is a decision rather than a first step
 * ----------------------------------------------------------------------------
 *
 * RFC 5545's RRULE can express "the last Thursday of every second month except
 * December". Supporting that means a recurrence engine, and a recurrence engine is
 * one of the classic ways a small codebase acquires a permanent maintenance
 * burden — every date bug for the next two years lands in it.
 *
 * A student club meets weekly or it meets once. So this does exactly two things:
 *
 *   - repeat every week from the start date until an end date, and
 *   - skip named dates, because "no meeting during finals" is not an edge case.
 *
 * If monthly is ever genuinely needed, `freq` is the field to add and the
 * expansion below is the only function that has to change. **Do not** add
 * arbitrary RRULE support because it seems more general; re-read this paragraph.
 *
 * ----------------------------------------------------------------------------
 * ONE row, expanded on read. Never many rows.
 * ----------------------------------------------------------------------------
 *
 * The tempting alternative is to write ten event rows when somebody creates a
 * weekly meeting. It is wrong in a way that shows up later:
 *
 *   - **RSVP fragments.** Ten rows means ten attendee lists, so "I come to the
 *     weekly meeting" becomes ten separate clicks and nobody's attendance is
 *     answerable in one place.
 *   - **Editing is ten edits.** Moving the meeting an hour later means finding
 *     every future copy, and any that were already edited individually are now
 *     inconsistent with no record of which was intended.
 *   - **The feed bloats.** One VEVENT with an RRULE is a few lines; fifty-two
 *     VEVENTs is a document every phone re-downloads.
 *
 * So: one row, one attendee list, one edit, and occurrences computed when needed.
 * `attendeeIds` on the series means "I am in for this meeting" — which is the
 * answer people actually want to give.
 *
 * ----------------------------------------------------------------------------
 * All arithmetic is in UTC, on purpose
 * ----------------------------------------------------------------------------
 *
 * Adding seven days to a Pacific-anchored instant lands on 23:00 or 01:00 twice a
 * year, which silently moves a Tuesday meeting to a Monday. A UTC day is always
 * 86,400,000 ms. Same rule as `addDays` in `lib/dates.ts`, and the same reason.
 *
 * The wall-clock TIME is preserved by construction: every occurrence is the start
 * instant plus a whole number of weeks, so a 6pm Pacific meeting stays 6pm Pacific
 * across a DST boundary as far as any calendar client is concerned — clients
 * expand the RRULE themselves against the timezone, and this module only ever has
 * to agree with them about which DAYS are involved.
 */

const WEEK_MS = 7 * 86_400_000;

/** What this module needs from a `ClubEvent`. Structural, so tests pass literals. */
export interface RepeatingEvent {
  startsAt: string;
  endsAt?: string;
  /**
   * Last date the weekly repeat can land on, inclusive. `YYYY-MM-DD`.
   *
   * Undefined means the event happens once. **An end date is required** when
   * repeating — see `MAX_OCCURRENCES` for what an open-ended weekly event would
   * do to a calendar feed.
   */
  repeatWeeklyUntil?: string;
  /**
   * Weeks between occurrences. 1 = weekly, 2 = every other week.
   *
   * Exists because the club runs both: a weekly team meeting and a fortnightly
   * townhall. Undefined or 0 reads as 1, so a row written before this field
   * existed still means weekly.
   *
   * Deliberately not an `interval` on a general `freq`. Two cadences cover what a
   * student club does, and every extra shape is one the expansion, the RRULE and
   * the form all have to agree about.
   */
  repeatEveryWeeks?: number;
  /**
   * Occurrence dates that were cancelled, as `YYYY-MM-DD`.
   *
   * "No meeting during finals" without deleting the series and losing its
   * attendee list. Maps to EXDATE in the feed, so a member's calendar actually
   * clears that week rather than showing a meeting nobody attends.
   */
  skippedDates?: string[];
}

/**
 * Hard ceiling on how many occurrences one series can produce.
 *
 * Two years of weeks. Not a business rule — a blast radius: `repeatWeeklyUntil`
 * arrives from a form, and a typo of `2126` instead of `2026` would otherwise
 * expand to five thousand occurrences inside a request that renders a page.
 */
export const MAX_OCCURRENCES = 104;

/**
 * Weeks between occurrences, guarded.
 *
 * Guards against 0 and negatives, which would make the expansion loop produce the
 * same date `MAX_OCCURRENCES` times — a hang-shaped bug rather than a wrong answer.
 */
function intervalWeeks(event: RepeatingEvent): number {
  const raw = event.repeatEveryWeeks;
  return Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : 1;
}

/** The date part of a stored datetime, which may be zoneless or an instant. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Every date this event happens on, within `[from, until]` inclusive.
 *
 * Returns `YYYY-MM-DD` strings rather than instants, because every caller is
 * asking a calendar-day question: which day does this land on, is it in the
 * window, has it been skipped. Comparing dates as strings is the house rule —
 * see `lib/dates.ts`.
 *
 * A non-repeating event returns at most one date. An event whose start is after
 * the window, or whose repeat ended before it, returns none.
 */
export function occurrenceDates(
  event: RepeatingEvent,
  from: string,
  until: string
): string[] {
  const first = dayOf(event.startsAt);

  // Not repeating: one occurrence, if it is in the window and not cancelled.
  if (!event.repeatWeeklyUntil) {
    if (first < from || first > until) return [];
    if (event.skippedDates?.includes(first)) return [];
    return [first];
  }

  const skipped = new Set(event.skippedDates ?? []);
  const lastAllowed = event.repeatWeeklyUntil.slice(0, 10);
  const every = intervalWeeks(event);

  /*
    Walk in UTC from the first occurrence.

    Starting from the series start rather than from `from` and rounding, because
    rounding to "the next Tuesday after `from`" is where off-by-one-week bugs
    live. Walking is O(weeks) and bounded by MAX_OCCURRENCES, which for a
    two-year series is a hundred iterations — nothing.
  */
  const startMs = Date.parse(`${first}T00:00:00Z`);
  if (Number.isNaN(startMs)) return [];

  const out: string[] = [];
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const day = new Date(startMs + i * every * WEEK_MS)
      .toISOString()
      .slice(0, 10);
    if (day > lastAllowed) break;
    if (day > until) break;
    if (day < from) continue;
    if (skipped.has(day)) continue;
    out.push(day);
  }
  return out;
}

/**
 * The event's start instant moved onto a given occurrence date.
 *
 * Keeps the time-of-day and zone suffix exactly as stored and swaps only the
 * date, so a `timestamptz` instant stays an instant and a zoneless demo value
 * stays zoneless. Rebuilding it through `Date` would silently convert one into
 * the other, which is the seven-hour bug `instantFrom` exists to prevent.
 */
export function occurrenceStart(event: RepeatingEvent, day: string): string {
  return `${day}${event.startsAt.slice(10)}`;
}

/**
 * The end instant for one occurrence, if the event has one.
 *
 * Shifted by the same number of days as the start, so an event that ends the
 * following morning — a build session running past midnight — keeps its length
 * instead of collapsing to a negative duration.
 */
export function occurrenceEnd(
  event: RepeatingEvent,
  day: string
): string | undefined {
  if (!event.endsAt) return undefined;

  const startDay = Date.parse(`${dayOf(event.startsAt)}T00:00:00Z`);
  const endDay = Date.parse(`${dayOf(event.endsAt)}T00:00:00Z`);
  const target = Date.parse(`${day}T00:00:00Z`);
  if ([startDay, endDay, target].some(Number.isNaN)) return event.endsAt;

  const spanDays = Math.round((endDay - startDay) / 86_400_000);
  const shifted = new Date(target + spanDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return `${shifted}${event.endsAt.slice(10)}`;
}

/**
 * Why this repeat setting can't be saved, or null if it can.
 *
 * Validation lives here rather than in the operation so the form and the server
 * enforce one rule — the same reasoning as `lib/artifacts.ts` running its checks
 * on both sides from one function.
 */
export function repeatProblem(
  startsAt: string,
  repeatWeeklyUntil?: string
): string | null {
  if (!repeatWeeklyUntil) return null;

  const first = dayOf(startsAt);
  const last = repeatWeeklyUntil.slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(last)) {
    return "Pick a date for the last week it repeats.";
  }
  if (last < first) {
    return `It starts ${first}, so it can't stop repeating on ${last}.`;
  }

  /*
    A ceiling, with a message that names the real mistake.

    The realistic way to hit this is typing the wrong year, and "104 occurrences"
    would be a baffling thing to read. Saying how long it would run is the thing
    that makes somebody spot the typo.
  */
  const weeks =
    Math.round(
      (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
        WEEK_MS
    ) + 1;
  if (weeks > MAX_OCCURRENCES) {
    return `That would repeat ${weeks} times, over ${Math.round(weeks / 52)} years. Pick an end date inside the next two years — you can always extend it later.`;
  }

  return null;
}

/**
 * The RRULE line for the feed, or null when the event doesn't repeat.
 *
 * `UNTIL` is an instant at the end of the last day, so the final occurrence is
 * always included. The obvious bug here is emitting a DATE value, which some
 * clients read as exclusive and quietly drop the last week.
 *
 * ---------------------------------------------------------------------------
 * The less obvious one, which shipped: `UNTIL` is UTC, the club is not
 * ---------------------------------------------------------------------------
 *
 * This used to emit `UNTIL=<date>T235959Z` — 23:59:59 **UTC** on the last day.
 * That looks like "the end of that day" and is not, because every occurrence is
 * stored in club time. A 5pm Pacific meeting on the final day is 01:00 UTC on the
 * day AFTER, which is past `T235959Z`, so clients dropped it.
 *
 * The result was the worst available: the website listed the last meeting, and
 * nobody's phone had it. It bites any event at or after 5pm Pacific — which is
 * when a student club meets, so in practice it bit nearly every series.
 *
 * Hence `toUtc`, injected exactly as `exdatesFor` takes it, so this module still
 * knows nothing about ICS formatting or time zones and the two lines can't drift.
 * It is a REQUIRED argument: a default would let a caller forget it and get the
 * old bug back silently, which is the same reasoning as `buildOrgGraphFromRows`
 * refusing to default `teamRows`.
 *
 * @param toUtc Renders a club-local `YYYY-MM-DDTHH:MM:SS` as a UTC ICS instant.
 */
export function rruleFor(
  event: RepeatingEvent,
  toUtc: (iso: string) => string
): string | null {
  if (!event.repeatWeeklyUntil) return null;
  /*
    End of the last day IN CLUB TIME, converted. 23:59:59 Pacific is 07:59:59Z
    the next morning, which safely covers an occurrence starting at any hour of
    that day — including the late-evening ones that broke.
  */
  const last = toUtc(`${event.repeatWeeklyUntil.slice(0, 10)}T23:59:59`);
  const every = intervalWeeks(event);
  /*
    INTERVAL is omitted when it is 1, which is the RFC's default.

    Emitting `INTERVAL=1` is legal and harmless, but leaving it out matches what
    every other calendar produces — which matters when somebody is reading a feed
    by hand to work out why a client is unhappy.
  */
  const interval = every > 1 ? `;INTERVAL=${every}` : "";
  // `last` is already a full instant from `toUtc` — no suffix to add.
  return `RRULE:FREQ=WEEKLY${interval};UNTIL=${last}`;
}

/**
 * EXDATE lines for cancelled occurrences, or null when there are none.
 *
 * The counterpart to `skippedDates`, and the reason a cancelled week actually
 * clears from somebody's phone. Without it the client expands the RRULE itself and
 * shows a meeting the club called off — and no amount of refetching fixes that,
 * because the feed never said otherwise.
 *
 * Each date carries the event's own start TIME, because an EXDATE has to match the
 * occurrence it cancels exactly. A date-only EXDATE against a timed series is the
 * classic way this silently does nothing.
 *
 * `toValue` is injected rather than imported so this module stays free of the ICS
 * formatting rules — the same separation that lets it be tested without them.
 *
 * ---------------------------------------------------------------------------
 * `tzid` is not optional decoration
 * ---------------------------------------------------------------------------
 *
 * An EXDATE only cancels an occurrence it matches EXACTLY, and a match compares
 * the value type and zone as well as the moment. Since a repeating DTSTART is
 * emitted as club wall time with a TZID — see `buildIcs` for why it must be — an
 * EXDATE sent as a UTC instant matches nothing at all, and the cancelled week
 * stays in everybody's calendar with no error anywhere.
 *
 * So the caller passes the same `tzid` and the same converter it used for
 * DTSTART. Omitting `tzid` emits the plain UTC form, which is correct only when
 * DTSTART is also absolute.
 */
export function exdatesFor(
  event: RepeatingEvent,
  toValue: (iso: string) => string,
  tzid?: string
): string | null {
  if (!event.repeatWeeklyUntil) return null;
  const skipped = event.skippedDates ?? [];
  if (skipped.length === 0) return null;

  const stamps = skipped
    .map((day) => toValue(occurrenceStart(event, day)))
    .filter(Boolean);
  if (stamps.length === 0) return null;

  return `EXDATE${tzid ? `;TZID=${tzid}` : ""}:${stamps.join(",")}`;
}
