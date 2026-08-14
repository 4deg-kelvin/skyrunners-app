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
 * `UNTIL` is emitted as a UTC instant at the very end of the last day, so the
 * final occurrence is always included. The common bug here is emitting a DATE
 * value, which some clients read as exclusive and quietly drop the last week —
 * and nobody notices until the meeting that should have been there isn't.
 */
export function rruleFor(event: RepeatingEvent): string | null {
  if (!event.repeatWeeklyUntil) return null;
  const last = event.repeatWeeklyUntil.slice(0, 10).replace(/-/g, "");
  const every = intervalWeeks(event);
  /*
    INTERVAL is omitted when it is 1, which is the RFC's default.

    Emitting `INTERVAL=1` is legal and harmless, but leaving it out matches what
    every other calendar produces — which matters when somebody is reading a feed
    by hand to work out why a client is unhappy.
  */
  const interval = every > 1 ? `;INTERVAL=${every}` : "";
  return `RRULE:FREQ=WEEKLY${interval};UNTIL=${last}T235959Z`;
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
 * `toUtc` is injected rather than imported so this module stays free of the ICS
 * formatting rules — the same separation that lets it be tested without them.
 */
export function exdatesFor(
  event: RepeatingEvent,
  toUtc: (iso: string) => string
): string | null {
  if (!event.repeatWeeklyUntil) return null;
  const skipped = event.skippedDates ?? [];
  if (skipped.length === 0) return null;

  const stamps = skipped
    .map((day) => toUtc(occurrenceStart(event, day)))
    .filter(Boolean);
  if (stamps.length === 0) return null;

  return `EXDATE:${stamps.join(",")}`;
}
