/**
 * ============================================================================
 * THE ICS CALENDAR FEED
 * ============================================================================
 *
 * One subscribable calendar per member. They paste a URL into Apple Calendar,
 * Google Calendar or Outlook once, and every club event they are on appears —
 * and keeps appearing, updating when a time moves and disappearing when a
 * session is cancelled. No app to install, no OAuth, nothing to remember.
 *
 * ----------------------------------------------------------------------------
 * Why a subscription feed rather than an API integration
 * ----------------------------------------------------------------------------
 *
 * Because it is the only mechanism that works on all three, and Apple is not
 * optional for a Stanford club.
 *
 *   - **Apple has no public calendar API.** A server can only write to iCloud
 *     Calendar over CalDAV with an app-specific password, which would mean
 *     asking members to mint an Apple credential granting full access to their
 *     personal calendar and paste it into a student club website. That is not a
 *     thing this app will ever ask for.
 *   - Google and Microsoft both have real APIs, and they are worth adding later
 *     for INSTANT push and for reading events back — see
 *     `docs/CALENDAR_INBOUND_SPEC.md`. They need OAuth apps registered and
 *     secrets set on the deployment, so they cannot be the thing that makes the
 *     calendar usable today.
 *   - An ICS feed needs no credentials at either end. It works identically on
 *     all three, and on anything else that speaks the format.
 *
 * **The honest cost, which the member docs state plainly:** refresh cadence
 * belongs to the client, not to us. Apple polls in minutes, Outlook in a few
 * hours, and Google is the slowest and least predictable. So a session added
 * this afternoon is not guaranteed to be on somebody's phone this afternoon.
 * That is a real limitation of subscriptions, it cannot be fixed from this end,
 * and pretending otherwise would be worse than saying so.
 *
 * ----------------------------------------------------------------------------
 * Why this file is pure, and worth its own tests
 * ----------------------------------------------------------------------------
 *
 * Every failure mode in RFC 5545 is SILENT. A calendar client that dislikes the
 * output does not report an error to the server — it shows an empty calendar, or
 * quietly drops the events it could not parse. There is no feedback channel at
 * all. So the format rules are pinned by tests here rather than discovered by a
 * member whose calendar is mysteriously blank:
 *
 *   - **CRLF line endings**, everywhere. Not optional in the spec, and some
 *     clients genuinely reject LF-only.
 *   - **Folding at 75 octets**, continuation lines starting with one space. A
 *     long project name in a SUMMARY is the realistic way to exceed it.
 *   - **Escaping** `\` `;` `,` and newlines in every TEXT value. An unescaped
 *     comma in a location silently truncates the field.
 *   - **A stable UID per event.** This is the one that matters most: the UID is
 *     how a client knows an update is the SAME event rather than a second copy.
 *     Get it wrong and rescheduling a session leaves the old time in everyone's
 *     calendar next to the new one.
 *   - **A rising SEQUENCE**, so an edit is treated as a revision rather than
 *     ignored as a duplicate.
 */

import { instantFrom } from "../dates";
import { exdatesFor, rruleFor, type RepeatingEvent } from "./recurrence";

/** Anything this module needs from a `ClubEvent`. Structural, so tests pass literals. */
export interface IcsEvent {
  id: string;
  title: string;
  /** Instant or club-local; `instantFrom` sorts out which. */
  startsAt: string;
  endsAt?: string;
  location?: string;
  notes?: string;
  /** Rendered into the description so the entry links back to the site. */
  url?: string;
  /**
   * Bumped whenever the event changes.
   *
   * Derived by the caller from the event's own fields rather than stored — see
   * `sequenceFor`. Without a rising SEQUENCE a client may ignore a revision.
   */
  sequence?: number;
  /**
   * A cancelled event is published as CANCELLED rather than dropped.
   *
   * Omitting it would leave it sitting in everybody's calendar forever: a
   * subscription client has no way to distinguish "removed from the feed" from
   * "the feed is having a bad day", so most keep what they last saw. An explicit
   * CANCELLED is the only thing that reliably clears it.
   */
  cancelled?: boolean;
  /**
   * Repeat rule, when the event is a series. Absent for a one-off.
   *
   * ONE VEVENT carries the whole series through RRULE, which is exactly why
   * RSVPing once puts every occurrence in a member's calendar — the client expands
   * the rule itself. Fifty-two separate VEVENTs would be a document every phone
   * re-downloads on every refresh.
   */
  repeat?: RepeatingEvent;
}

/** UTC basic format: `20260812T150000Z`. What DTSTART/DTEND/DTSTAMP need. */
export function toIcsUtc(iso: string): string {
  const at = instantFrom(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/**
 * Escape a TEXT value per RFC 5545 §3.3.11.
 *
 * Backslash FIRST, or the escapes inserted below get escaped in turn and the
 * reader sees a literal `\,` instead of a comma.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * Fold a content line to 75 OCTETS, not characters.
 *
 * The distinction is the whole point: a member's name or a project title may
 * contain a multi-byte character, and splitting a UTF-8 sequence in half
 * produces a line some clients reject outright and others render as a replacement
 * character. So the accounting is done in bytes and never splits a code point.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let bytes = 0;
  // First line takes 75 octets; continuations take 74, because the leading
  // space they are prefixed with counts towards the limit.
  let limit = 75;

  for (const char of line) {
    const size = enc.encode(char).length;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += char;
    bytes += size;
  }
  if (current) out.push(current);

  return out.join("\r\n ");
}

/**
 * A UID that is stable for the life of the event and unique to this club.
 *
 * The event's own id is already a UUID, so it is stable across edits by
 * construction — which is exactly what a UID must be. The domain suffix is the
 * RFC's convention and stops a collision with an unrelated feed the member also
 * subscribes to.
 */
export function uidFor(eventId: string): string {
  return `${eventId}@skyrunners-app.vercel.app`;
}

/**
 * A revision number derived from the event's contents.
 *
 * Stored nowhere, deliberately. A `sequence` column would have to be bumped by
 * every write path that touches an event, and the day somebody adds a fourth one
 * and forgets, rescheduling silently stops propagating — a failure nobody would
 * notice for weeks because it only shows up in other people's calendars.
 *
 * Hashing the fields that matter means any change to them produces a different
 * number, and an unchanged event produces the same one. It is not monotonic,
 * which the RFC would prefer; in practice clients treat "different SEQUENCE plus
 * a newer DTSTAMP" as a revision, and DTSTAMP always rises.
 */
export function sequenceFor(event: IcsEvent): number {
  const material = [
    event.startsAt,
    event.endsAt ?? "",
    event.title,
    event.location ?? "",
    event.notes ?? "",
    event.cancelled ? "cancelled" : "",
    /*
      Changing the repeat range or cancelling a week must bump SEQUENCE too, or a
      client treats the revision as a duplicate and keeps the old schedule — so
      "no meeting next week" would never reach anybody's phone.
    */
    event.repeat?.repeatWeeklyUntil ?? "",
    String(event.repeat?.repeatEveryWeeks ?? ""),
    (event.repeat?.skippedDates ?? []).join(","),
    /*
      Joined with a SEPARATOR, not concatenated.

      Without one, different field combinations hash identically — a title of "AB"
      with location "C" would match a title of "A" with location "BC". The
      consequence is a real edit that produces the same SEQUENCE and therefore
      never propagates.
    */
  ].join(" | ");

  let hash = 0;
  for (let i = 0; i < material.length; i++) {
    hash = (hash * 31 + material.charCodeAt(i)) % 2147483647;
  }
  return hash;
}

function eventLines(event: IcsEvent, stamp: string): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uidFor(event.id)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(event.startsAt)}`,
  ];

  /*
    No DTEND means a one-hour block, not an all-day event.

    `endsAt` is optional on `ClubEvent` and plenty of sessions are created
    without one. Omitting DTEND entirely is legal and means "instantaneous",
    which clients draw as a zero-height sliver that is easy to miss on a busy
    day. An hour is the honest default for a club session and is what the
    website already implies by showing a start time.
  */
  const end = event.endsAt
    ? toIcsUtc(event.endsAt)
    : toIcsUtc(
        new Date(
          instantFrom(event.startsAt).getTime() + 3_600_000
        ).toISOString()
      );
  lines.push(`DTEND:${end}`);

  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);

  const description = [event.notes, event.url].filter(Boolean).join("\n\n");
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (event.url) lines.push(`URL:${event.url}`);

  /*
    The repeat rule, and the exceptions to it.

    Both come from `lib/calendar/recurrence.ts`, so the feed and the website can
    never disagree about which weeks a meeting happens on. Placed with the other
    date-time properties, before the descriptive ones, which is where some parsers
    expect them.
  */
  if (event.repeat) {
    const rule = rruleFor(event.repeat);
    if (rule) lines.push(rule);
    const exdates = exdatesFor(event.repeat, toIcsUtc);
    if (exdates) lines.push(exdates);
  }

  lines.push(`SEQUENCE:${event.sequence ?? sequenceFor(event)}`);
  lines.push(`STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`);
  /*
    TRANSP:OPAQUE — the event marks the member as busy.

    Right for a club session: the point of putting it in a personal calendar is
    that it collides visibly with a lecture. TRANSPARENT would draw it and let
    everything schedule straight over it.
  */
  lines.push("TRANSP:OPAQUE");

  /*
    NO VALARM, deliberately.

    An earlier version emitted a 30-minute reminder. Anish removed it, and the
    reasoning is worth keeping: the ask was only ever that a club event POPULATE
    somebody's calendar. How they want to be reminded about their own diary is
    their setting, not the club's.

    It is also the more honest choice. Whether a SUBSCRIBED calendar honours an
    alarm is entirely the client's decision — Apple fires them, Google discards
    them on calendars added from a URL — so the feature would have worked for some
    members and silently not for others, with nobody able to tell which. Every
    calendar app already lets its owner set a default reminder per calendar, which
    is the right place for that decision and works today.

    If a reminder is ever genuinely needed, the reliable channel is a Discord DM
    from the existing daily cron, not this file.
  */
  lines.push("END:VEVENT");

  return lines;
}

/**
 * The one event a calendar is never allowed to be without.
 *
 * ---------------------------------------------------------------------------
 * Google refuses to ADD a feed that contains no events at all
 * ---------------------------------------------------------------------------
 *
 * This shipped as a real bug and it looked like a broken URL. A member who
 * connects their calendar before they have joined anything has an empty event
 * list, which produced a valid, empty VCALENDAR — legal per RFC 5545, and
 * rejected by Google Calendar's "From URL" box with "Validation failed, please
 * edit the URL and try again". Nothing about that message points at "you are on
 * no events yet", so the member concludes the link is wrong and tries again,
 * forever. That was Anish's report.
 *
 * Emitting one placeholder makes the document acceptable to every client, and it
 * is worth having on its own merits: a subscription that appears as an empty
 * calendar is indistinguishable from one that silently failed, so this is also
 * the only confirmation a member ever gets that the connection works.
 *
 * Three deliberate properties:
 *
 *   - **All-day**, so it occupies no time slot. DTEND on an all-day event is
 *     exclusive, hence the next day.
 *   - **TRANSPARENT**, so it never marks anybody busy. This is the one event in
 *     the feed that is not a commitment, and OPAQUE would make a note about
 *     nothing collide with a lecture.
 *   - **Dated when the feed was made**, not today. A DTSTART derived from the
 *     stamp would move the note forward every time a client polled, so it would
 *     follow the member down their calendar a day at a time — the kind of
 *     harmless-looking wrongness nobody reports and everybody notices.
 *
 * It disappears from the feed as soon as there is a real event, which is the
 * correct end state: it exists only to answer "did this work".
 */
function placeholderLines(connectedOn: string, stamp: string): string[] {
  const start = connectedOn.slice(0, 10).replace(/-/g, "");
  const next = new Date(`${connectedOn.slice(0, 10)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10).replace(/-/g, "");

  return [
    "BEGIN:VEVENT",
    `UID:${uidFor("calendar-connected")}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    "SUMMARY:SkyRunners calendar connected",
    `DESCRIPTION:${escapeText(
      "Your SkyRunners calendar is working. Club sessions and meetings will " +
        "appear here as soon as you say you're coming to one — this note will " +
        "go away once you have.\n\nRSVP on the website: " +
        "https://skyrunners-app.vercel.app/calendar"
    )}`,
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}

/**
 * Build the whole calendar document.
 *
 * @param name  What the calendar is called in the member's client. Worth being
 *              specific — it sits in a sidebar next to "Home" and "Birthdays".
 * @param stampAt Now, injected so the output is deterministic under test.
 * @param connectedOn `YYYY-MM-DD` the feed was created. Dates the placeholder
 *              that keeps an eventless calendar addable — see
 *              `placeholderLines`. Falls back to the stamp day if absent, which
 *              is only ever a caller that has no feed row to hand.
 */
export function buildIcs(
  events: IcsEvent[],
  options: {
    name: string;
    description?: string;
    stampAt: Date;
    connectedOn?: string;
  }
): string {
  const stamp = `${options.stampAt.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    // PRODID is required. The convention is the FPI form.
    "PRODID:-//SkyRunners//Club Calendar//EN",
    "CALSCALE:GREGORIAN",
    /*
      PUBLISH, not REQUEST. REQUEST is an invitation the client will try to
      reply to, and there is nothing here to reply to: RSVP happens on the
      website, which is where the attendee list actually lives. A feed full of
      REQUESTs would put an Accept/Decline button in front of members whose
      answer would go nowhere.
    */
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.name)}`,
    /*
      A refresh hint, in both the modern and the legacy spelling.

      Purely advisory — every client does as it likes, and Google in particular
      ignores it. Both are emitted because Apple reads REFRESH-INTERVAL and some
      older clients only read X-PUBLISHED-TTL, and the cost of saying it twice is
      two lines.
    */
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  if (options.description) {
    lines.push(`X-WR-CALDESC:${escapeText(options.description)}`);
  }

  for (const event of events) lines.push(...eventLines(event, stamp));

  /*
    A calendar with no VEVENT is unaddable in Google, so there is always one.

    Checked on the OUTPUT rather than trusted to the caller: the route builds its
    event list from a filtered store read, and every future caller will do
    something similar, so "did that come back empty" is exactly the question a
    caller forgets to ask. Here it cannot be forgotten.
  */
  if (events.length === 0) {
    lines.push(
      ...placeholderLines(
        options.connectedOn ?? options.stampAt.toISOString().slice(0, 10),
        stamp
      )
    );
  }

  lines.push("END:VCALENDAR");

  // Fold every line, join with CRLF, and end with a trailing CRLF — all three
  // are required, and all three fail silently when wrong.
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
