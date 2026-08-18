/**
 * Which events the subscription feed reaches back and forward to.
 *
 * ===========================================================================
 * Extracted because it decides what lands on somebody's phone, untested
 * ===========================================================================
 *
 * This lived inline in the feed route, where it could not be tested at all — and
 * it is the predicate that decides whether an event a member RSVP'd to appears in
 * their calendar. Everything else in `lib/calendar/` is pure and heavily tested
 * precisely because these failures are silent; this was the exception.
 *
 * Pulled out unchanged. The tests alongside it pin the two rules that are easy to
 * get wrong: a past event stays for a while, and a REPEATING event is judged on
 * where its series ends rather than where it began.
 */

/**
 * How far ahead the feed reaches.
 *
 * A subscribed calendar is not a planning horizon — the member already has one of
 * those — so this only has to cover far enough that nothing surprises them. A
 * year is generous for a club that plans a quarter at a time, and it keeps the
 * document small enough that a phone on a slow connection refreshes it in one
 * round trip.
 */
export const HORIZON_DAYS = 365;

/**
 * How far BACK it reaches.
 *
 * Not zero, and this is the subtle one. If a past event vanishes from the feed,
 * clients that have already stored it keep it — they cannot distinguish "removed"
 * from "the feed is briefly broken". Keeping a short tail means a session that was
 * cancelled yesterday is still present, still marked CANCELLED, and therefore
 * actually clears. A month is long enough for every client to have polled at least
 * once.
 */
export const TAIL_DAYS = 30;

/** Only the fields the window rule looks at. Structural, so tests pass literals. */
export interface WindowedEvent {
  startsAt: string;
  /** Last date a repeat may land on. Absent for a one-off. */
  repeatUntil?: string;
}

/**
 * Is this event inside the feed's window?
 *
 * @param now Injected so this is testable, and so one request windows every event
 *            against the same instant rather than drifting mid-loop.
 */
export function withinFeedWindow(
  event: WindowedEvent,
  now: number = Date.now()
): boolean {
  const at = Date.parse(event.startsAt);
  /*
    A malformed date is dropped rather than published. `Invalid Date` in a DTSTART
    makes some clients discard the whole calendar, not just the one event — so one
    bad row would take everything with it.
  */
  if (Number.isNaN(at)) return false;

  const from = now - TAIL_DAYS * 86_400_000;
  const until = now + HORIZON_DAYS * 86_400_000;

  /*
    A REPEATING event is judged on where its SERIES ends, not where it began.

    A weekly meeting that started in September is still running in November, and
    every occurrence lives on that single row. Windowing on `startsAt` alone would
    drop the whole series the moment its FIRST occurrence fell out of the 30-day
    tail — silently removing a recurring meeting from everybody's calendar a month
    after it started, which is the worst possible time for it to vanish.
  */
  const seriesEnd = event.repeatUntil
    ? Date.parse(`${event.repeatUntil.slice(0, 10)}T23:59:59Z`)
    : at;

  return seriesEnd >= from && at <= until;
}

/** Only what the selection needs. Structural, so callers pass their own rows. */
export interface FeedCandidate extends WindowedEvent {
  attendeeIds: string[];
}

/**
 * Exactly the events one member's feed contains, soonest first.
 *
 * ---------------------------------------------------------------------------
 * Shared so that a preview cannot lie about the feed
 * ---------------------------------------------------------------------------
 *
 * Settings shows the member what their calendar app is being served, because the
 * failure mode of this whole feature is silence: when a subscription breaks or an
 * event is missing there is no error anywhere, and "my calendar is empty" is
 * indistinguishable from "the club has nothing on". Anish lost two events to that.
 *
 * A preview built from its own query would be worse than none — it would agree
 * with the member's expectation while the real feed disagreed, which is the exact
 * shape of the bug it exists to catch. So both callers use THIS function, and the
 * only difference between them is that one renders titles and the other renders
 * ICS.
 *
 * `attendeeIds` is both "invited" and "attending": an RE names people on a
 * session, RSVPing adds yourself, and creating one adds you as the organiser. All
 * three are the same condition here, which is why creating an event puts it in
 * your own calendar without a second step.
 */
export function feedEventsFor<T extends FeedCandidate>(
  events: T[],
  memberId: string,
  now: number = Date.now()
): T[] {
  return events
    .filter((event) => event.attendeeIds.includes(memberId))
    .filter((event) => withinFeedWindow(event, now))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
