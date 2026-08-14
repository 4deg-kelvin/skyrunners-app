# Put SkyRunners in your own calendar

Every club session you're on — build sessions, design reviews, 1:1s, meetings —
shows up in the calendar you already use. It updates itself when a time moves and
clears itself when something is cancelled.

**Setup is one link, once.** You will not need to come back to this page.

---

## Do it now — about thirty seconds

1. On the website, go to **Settings → Your calendar**.
2. Press **Connect my calendar**.
3. Copy the link it shows you.
4. Follow the line below for whatever you use.

**iPhone, iPad or Mac** — just open the link. It starts with `webcal://`, which
your phone recognises, so Calendar opens and asks whether you want to subscribe.
Say yes. That's it.

**Google Calendar** — Google won't take a `webcal://` link, so use the `https://`
one shown underneath it. On a computer: **Other calendars → + → From URL**, paste,
**Add calendar**. It has to be done on a computer; the Google Calendar phone app
can't add a subscription, but once it's added on a computer it shows up on your
phone.

**Outlook** — **Add calendar → Subscribe from web**, paste either version.

---

## How to tell it worked

Go back to **Settings → Your calendar**. Once your calendar app has collected the
link, that box says which app it was, and your profile gets a badge showing the
same thing under your Discord one.

Give it a few minutes first — your calendar app checks in on its own schedule, not
when you press something.

If it still says nothing after a while, the link almost certainly didn't paste in
full. Press **Show me the link again** and re-add it.

---

## What actually appears

Sessions **you are on** — either because somebody put you on one, or because you
said you'd be there on the club calendar.

Not every club event. Your personal calendar would become unusable, and you'd
delete the whole thing, losing the events you did want. Everything else stays on
the website at **/calendar**, where browsing it is the point — and the moment you
say you're coming to something, it appears in your own calendar.

So: **saying you'll be there is what puts it in your calendar.** That's the only
step.

---

## Repeating meetings

The team meeting and the townhall are **one entry each**, not one per week.

Tick **It repeats** when you create or edit them, pick *every week* or *every other
week*, and set the last date — end of the quarter is the usual answer. You can come
back and extend it any time; that's the point of the range being editable.

**Say you're coming once and every week lands in your calendar.** The feed sends the
repeat as a rule rather than fifty-two copies, so your calendar app works out the
dates itself. Extending the range or cancelling a week updates what's already there.

**No meeting one week?** Cancel that single week rather than deleting the series —
deleting it throws away everyone's RSVP. A cancelled week disappears from
subscribers' calendars too.

---

## Will I get a notification?

Two different things, and it's worth being precise:

- **When you're added to a meeting, you get a Discord DM.** The calendar can't tell
  you — a subscription is a pull, so the event appears silently on the next refresh
  and nothing pings. The bot covers that gap, and says when the meeting is.
- **When you RSVP yourself, nothing pings** — you already know. The entry just
  appears in your calendar within a few hours.
- **Before the event itself, your own device reminds you**, 30 minutes ahead. That's
  built into every entry the feed sends, so it works on Apple, Google and Outlook
  without the club doing anything.

So: added to something → Discord. About to happen → your own calendar alarm.

---

## The one honest limitation

**Your calendar app decides how often to check for changes, and we can't change
that.** Roughly:

| App | How quickly it notices a change |
|---|---|
| Apple Calendar | Usually minutes |
| Outlook | A few hours |
| Google Calendar | Slowest, and unpredictable — sometimes many hours |

This is how calendar subscriptions work everywhere, not something specific to
SkyRunners. It matters in one situation: **if a session moves at short notice,
don't rely on the calendar to tell everyone.** Say so in Discord too. The club's
bot messages you about things that need to reach you now; the calendar is for
knowing what's on.

If you're on Google Calendar and want changes faster, subscribing on your phone in
Apple Calendar as well works — same link, and Apple polls much more often.

---

## Questions people actually ask

**Do I have to install anything?** No. It's a link.

**Will this see my personal events?** No, and it cannot. The link only sends
information out to you. Nothing in your own calendar is read, sent anywhere, or
visible to the club.

**Can I put something on the club calendar from my phone's calendar?** Not yet.
Right now events are created on the website. Making it work the other way round is
planned — see `docs/CALENDAR_INBOUND_SPEC.md` — and it will need you to opt in
deliberately, precisely so a dentist appointment can never end up on the club
calendar.

**Is the link secret?** Treat it like a password. Anyone who has it can see which
club sessions you're on — nothing more. It can't change anything, and it shows
nothing about anybody else. If you've shared it by accident, press **Show me the
link again**: that makes a new one and the old one stops working immediately.

**I added it on my laptop and now my phone is empty.** Pressing **Show me the link
again** creates a *new* link and disconnects everything using the old one. Re-add
the current link on each device. (One link works on all your devices — you only
need to generate it once.)

**How do I turn it off?** **Settings → Your calendar → Turn it off.** Also remove
it from your calendar app, or you'll be left with an empty SkyRunners calendar
sitting there.

**It's not showing a session I'm definitely on.** Two likely reasons: it's more
than a year away, or your calendar app hasn't refreshed yet. In most apps you can
force a refresh — on a Mac, Calendar → right-click the SkyRunners calendar →
Refresh.

---

## For whoever maintains this

The feed is `app/api/calendar/[token]/skyrunners.ics/route.ts`; the document is
built by `lib/calendar/ics.ts`, which is pure and has tests. **Read the header of
that file before changing the output** — every failure mode in the ICS format is
silent, so a client that dislikes the file shows an empty calendar and reports
nothing.

Three things that will break it, all of which have a comment saying so:

- **Taking `api/calendar` out of the middleware exclusion list.** The feed would
  307 to `/login` and every subscription would quietly go blank.
- **Returning HTML on error.** Some clients unsubscribe themselves. A bad token
  gets plain text and a 404.
- **Dropping a cancelled event from the feed instead of marking it `CANCELLED`.**
  Clients keep what they last saw, so it would sit in everybody's calendar
  forever.

The connected-calendars badge reads `profiles.calendar_clients`, written by the
feed route from the request's User-Agent. It is deliberately an observation rather
than something a member can assert — see `lib/calendar/feed-token.ts`.
