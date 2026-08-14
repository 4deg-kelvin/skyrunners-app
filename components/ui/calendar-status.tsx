import { CalendarCheck, CalendarOff } from "lucide-react";

import { CALENDAR_CLIENT_LABELS } from "@/lib/labels";
import type { CalendarClient } from "@/lib/calendar/feed-token";
import { cn } from "@/lib/utils";

/**
 * Whether this person's own calendar is subscribed to the club's, and which one.
 *
 * Sits directly under `DiscordStatus` on the profile, and the pairing is the
 * point: those two badges answer the same question about two different channels
 * — **can we actually reach this person about a thing that is happening?**
 * Discord for the message, calendar for the time.
 *
 * ---------------------------------------------------------------------------
 * Why it names the apps
 * ---------------------------------------------------------------------------
 *
 * "Calendar connected" would be nearly useless to an organiser. "Apple" tells
 * them the session they moved this morning is probably already on that person's
 * phone; "Google" tells them it may well not be for hours yet, because Google
 * refreshes subscribed calendars slowly and unpredictably. Same badge, materially
 * different expectation, and the difference decides whether you also send a
 * message.
 *
 * ---------------------------------------------------------------------------
 * Every value here is OBSERVED, never claimed
 * ---------------------------------------------------------------------------
 *
 * A calendar subscription has no handshake — the server is never told who
 * subscribed, it only ever receives a GET — so these come from the User-Agent of
 * fetches that actually happened. See `clientFromUserAgent`.
 *
 * That is the same standard `DiscordStatus` holds itself to: it shows "verified"
 * only once a message has genuinely been delivered, because a saved ID and a
 * working one look identical from the outside. A badge a member could earn by
 * typing something is worth nothing to the person reading it.
 *
 * So there is no third state for "they pressed the button but nothing has
 * fetched". From the outside, a subscription no calendar app has ever collected
 * and no subscription at all are the same amount of reachable.
 */
export function CalendarStatus({
  clients,
  className,
}: {
  /**
   * Calendar apps observed fetching this member's feed. Empty means none has.
   *
   * `other` is a real member of this list, not a failure: an unrecognised agent
   * still proves something is subscribed, which is the fact being reported.
   */
  clients: CalendarClient[];
  className?: string;
}) {
  const base = cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
    className
  );

  if (clients.length === 0) {
    return (
      <span
        className={cn(base, "bg-surface text-ink-muted")}
        title="No calendar app has collected their SkyRunners calendar, so a session added today may not reach them at all."
      >
        <CalendarOff className="size-3.5 shrink-0" strokeWidth={2.5} />
        Calendar not connected
      </span>
    );
  }

  const names = clients.map((c) => CALENDAR_CLIENT_LABELS[c]).join(", ");

  return (
    <span
      className={cn(base, "bg-ok-bg text-ok-fg")}
      title={`Club sessions they are on appear in ${names}. Refresh timing is up to the app — Apple is quick, Google can take hours.`}
    >
      <CalendarCheck className="size-3.5 shrink-0" strokeWidth={2.5} />
      {names}
    </span>
  );
}
