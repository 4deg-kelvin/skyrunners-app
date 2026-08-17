/**
 * Is a calendar subscription still actually working?
 *
 * ===========================================================================
 * Why a member needs this spelled out
 * ===========================================================================
 *
 * A calendar subscription has no handshake and no error channel. If it breaks —
 * the URL was rotated, the device forgot it, the app stopped refreshing — nothing
 * anywhere says so. The calendar simply stops changing, which looks identical to
 * "the club has nothing scheduled".
 *
 * Anish hit the worst version of that: he RSVP'd on the Friday, the event was on
 * the Saturday, and by Sunday his phone still had nothing — while Settings said
 * "Your calendar is connected". The badge was reporting a fetch from before the
 * link had been rotated, so every signal he had said it was fine.
 *
 * Rotating now clears that record (see `forgetObservedClients`), which fixes the
 * lie. This is the other half: saying out loud when a connected feed has gone
 * quiet for long enough that something is probably wrong.
 *
 * Pure and time-injected so it can be tested and used from a client component.
 */

/**
 * How long silence is allowed before it's worth mentioning.
 *
 * Two days, and the number is set by the SLOWEST client rather than the fastest.
 * Apple usually polls within minutes and Outlook within hours, but Google
 * Calendar is slow and unpredictable — long gaps are normal there. A threshold
 * tuned to Apple would cry wolf at every Google user, and a warning that is
 * usually wrong is worse than none, because people learn to scroll past it.
 */
export const STALE_AFTER_HOURS = 48;

export type FeedHealth =
  /** Nothing has ever collected it — a fresh subscription, or one never added. */
  | "never"
  /** Collected recently enough that silence means nothing is scheduled. */
  | "fresh"
  /** Connected once, then quiet for longer than any client should be. */
  | "stale";

export function feedHealth(
  syncedAt: string | undefined,
  now: Date = new Date()
): FeedHealth {
  if (!syncedAt) return "never";

  const last = Date.parse(syncedAt);
  // An unparseable timestamp is treated as "never" rather than thrown on: a bad
  // value must not take down the Settings page, and "never" prompts the same fix.
  if (Number.isNaN(last)) return "never";

  const hours = (now.getTime() - last) / 3_600_000;
  /*
    A timestamp in the FUTURE counts as fresh, not stale.

    Clock skew between the database and the rendering server makes a few seconds
    of negative age routine, and "last picked up in 4 seconds' time" must not read
    as a broken subscription.
  */
  return hours > STALE_AFTER_HOURS ? "stale" : "fresh";
}
