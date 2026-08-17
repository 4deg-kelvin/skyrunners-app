/**
 * The member's subscribable calendar. One GET, one ICS document.
 *
 * ---------------------------------------------------------------------------
 * Why the token is in the PATH and not a header
 * ---------------------------------------------------------------------------
 *
 * Because the caller is Apple Calendar. A subscription client sends a bare GET
 * to whatever URL the member pasted; there is no opportunity to attach an
 * `Authorization` header, no handshake, and no way to prompt for credentials. So
 * the URL is the credential — see the header of `lib/calendar/feed-token.ts` for
 * what that changes about the threat model, and why the answer is that this feed
 * can do nothing but read one member's own event list.
 *
 * ---------------------------------------------------------------------------
 * Why the filename is in the route
 * ---------------------------------------------------------------------------
 *
 * `/api/calendar/<token>/skyrunners.ics` rather than `/api/calendar/<token>`.
 * Several clients — Outlook desktop most stubbornly — decide whether they are
 * looking at a calendar partly from the URL, and some refuse a subscription whose
 * path has no `.ics`. It also means the file has a sensible name if somebody
 * downloads it by hand to check. Cheap insurance against a failure that would
 * present as "Outlook just won't add it".
 *
 * ---------------------------------------------------------------------------
 * Two things this route must never do
 * ---------------------------------------------------------------------------
 *
 *   1. **Never redirect.** Several clients follow redirects badly or not at all,
 *      and a 302 to a login page is the classic way a subscription silently
 *      becomes an empty calendar. `api/` is already outside the auth middleware
 *      matcher — the cron routes had exactly this bug (docs/HANDOFF.md) — but the
 *      route also authenticates itself, so it never depends on that.
 *   2. **Never return HTML.** A client that receives an error page where it
 *      expected a calendar may unsubscribe itself, and the member would never
 *      learn why. A bad token gets a 404 with a plain-text body; a working token
 *      with no events gets a valid, EMPTY calendar.
 */

import { buildIcs, type IcsEvent } from "@/lib/calendar/ics";
import { withinFeedWindow } from "@/lib/calendar/window";
import { feedByToken, recordFeedFetch } from "@/lib/calendar/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { preloadLiveStore, withSuppliedClientStore } from "@/lib/store/request";
import { readStore } from "@/lib/store/disk";
import { appUrl } from "@/lib/urls";

/** Node, not Edge: the store loader and the admin client both need it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function plainText(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Never let an error be cached as if it were the calendar.
      "cache-control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const feed = await feedByToken(token);

  if (!feed) {
    /*
      One message for every failure — unknown, revoked, or malformed.

      Distinguishing them would let somebody probe for valid tokens, and the
      member reading it has the same fix in all three cases: make a new
      subscription URL in Settings.
    */
    return plainText(
      "This calendar subscription isn't valid any more.\n\n" +
        "Make a new one: SkyRunners website -> Settings -> Your calendar.\n",
      404
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return plainText(
      "The calendar feed isn't configured on this deployment.\n",
      503
    );
  }

  /*
    Load the club's data past RLS, exactly as the MCP server does.

    Same justification, and it is worth restating because it is the one place
    this route touches anything privileged: there is no session on a feed fetch,
    so a cookie-backed client would read nothing at all. The privacy boundary is
    therefore enforced by WHAT IS SELECTED below — this member's own events —
    rather than by the database. See the header of `lib/mcp/viewer.ts`.
  */
  const built = await withSuppliedClientStore(admin, async () => {
    /*
      `withSuppliedClientStore` installs the CLIENT; it does not load the data.

      This is the trap in docs/HANDOFF.md section 6, and it shipped once here
      before an end-to-end fetch against production caught it. `readStore()`
      THROWS in live mode when no snapshot is loaded — deliberately, because the
      alternative was silently serving sample data — so without this line the feed
      500s on every valid token while a bad token still 404s correctly. The
      symptom to a member is "my calendar is empty", with the setup page insisting
      the subscription is fine.

      The MCP route gets away without it because it calls `lib/data/*` functions,
      and all sixteen of those open with this same line. This route reads the store
      directly, so it has to do it itself.
    */
    await preloadLiveStore();
    const store = readStore();

    /*
      The member's already-recorded calendar apps, from the SAME snapshot.

      Saves a round trip, and more usefully it means the calendar and the badge
      update are computed from one consistent view — a separate query could race
      a rotation and write a client onto a feed that had just been replaced.
    */
    const knownClients =
      store.members.find((m) => m.id === feed.memberId)?.calendarClients ?? [];

    /*
      One instant for the whole run, so every event is windowed against the same
      "now" rather than drifting as the loop proceeds.
    */
    const now = Date.now();

    /*
      Events this member is ON, and nothing else.

      `attendeeIds` is both "invited" and "attending" in this model — an RE names
      people on a session, and RSVPing adds yourself — so one condition covers
      both of the things this feature was asked for: an event you were invited to
      appears in your calendar, and so does one you said you would come to.

      Deliberately NOT every club-wide event. Publishing the whole calendar into
      somebody's personal one is how a subscription becomes noise and gets
      deleted, taking the events they did want with it. Club-wide sessions stay on
      the website, where the point is to browse them — and joining one puts it in
      the calendar, which is the incentive loop this should have.
    */
    const events = store.events
      .filter((event) => event.attendeeIds.includes(feed.memberId))
      /*
        The window — how far back and forward the feed reaches — lives in
        `lib/calendar/window.ts`, with its reasoning and its tests.

        It was inline here, which meant the one predicate deciding whether an
        RSVP'd event reaches somebody's phone was the only part of
        `lib/calendar/` with no test at all.
      */
      .filter((event) => withinFeedWindow(event, now))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((event): IcsEvent => ({
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        location: event.location,
        notes: event.notes,
        // Back to the club calendar, where the attendee list and the turn-up
        // button live. A calendar entry that can't be acted on is a dead end.
        url: appUrl("/calendar"),
        /*
          The repeat, passed through as ONE VEVENT with an RRULE.

          This is what makes "RSVP once to the weekly meeting" work: every
          occurrence lands in the member's calendar because the client expands the
          rule itself. Only set when the event actually repeats, so a one-off
          emits no RRULE at all.
        */
        repeat: event.repeatUntil
          ? {
              startsAt: event.startsAt,
              endsAt: event.endsAt,
              repeatWeeklyUntil: event.repeatUntil,
              repeatEveryWeeks: event.repeatEveryWeeks,
              skippedDates: event.skippedDates,
            }
          : undefined,
      }));

    return { events, knownClients };
  });

  const body = buildIcs(built.events, {
    name: "SkyRunners",
    description: `Club sessions, meetings and reviews you are on. Managed at ${appUrl("/calendar")}`,
    stampAt: new Date(),
    /*
      Dates the "calendar connected" placeholder that a brand-new member's feed
      consists entirely of. From the feed row so it never moves — see
      `placeholderLines`. This is the fix for a subscription Google refused to
      add at all, which presented as a bad URL rather than as an empty calendar.
    */
    connectedOn: feed.createdAt.slice(0, 10),
  });

  /*
    Bookkeeping for the badge, AFTER the document is built and never allowed to
    affect it. See `recordFeedFetch`.
  */
  await recordFeedFetch({
    memberId: feed.memberId,
    userAgent: request.headers.get("user-agent"),
    knownClients: built.knownClients,
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // Named so a manual download is recognisable, but INLINE — `attachment`
      // makes some browsers download instead of handing it to the calendar app.
      "content-disposition": 'inline; filename="skyrunners.ics"',
      /*
        Never cached by an intermediary.

        A cached feed is a calendar that stops updating, which is the failure this
        whole feature exists to prevent — and it would be invisible, because the
        member's calendar would look populated and simply be wrong.
      */
      "cache-control": "no-cache, no-store, must-revalidate",
    },
  });
}
