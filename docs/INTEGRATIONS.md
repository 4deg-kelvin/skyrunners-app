# Integrations — email and Discord

> **Partly superseded, 2026-08-24.** The club removed the reporting chain and
> twice-weekly check-ins. Anything below about a member's Lead, reviewing
> check-ins, roll-ups, reliability or the academic pause is a record of what was
> planned, not of how the app works — kept because the reasoning behind each
> decision is still worth reading. See `docs/REPORTING_REMOVAL_PLAN.md` and the
> section in `CLAUDE.md` for what replaced it.

**What Anish needs to set up.** Both close the same gap: the app only notifies
in-app, so **an invited member never learns they've been invited unless
somebody tells them out of band.**

| | State |
|---|---|
| **Email invites** | Not built. Needs a sending domain first — see below |
| **Discord DMs** | **Built and inert.** Set `DISCORD_BOT_TOKEN` and it starts working. Fifteen DM templates plus a daily digest — see [What is actually built](#what-is-actually-built-2026-08-24) |

Written 2026-08-09.

---

## 1. Email invites (Resend)

### What you're deciding first: which domain sends the mail

This is the whole setup, and it's the only part that needs somebody else.

You cannot send from `@stanford.edu`. Stanford owns that domain's DNS and won't
publish sending records for a student club, so any mail claiming to be from it
gets marked as spoofed and lands in spam — or is rejected outright.

Three options, best first:

| Option | What it costs | What recipients see |
|---|---|---|
| **A club domain you control** (`stanforduav.org`, `skyrunners.dev`, anything) | ~$12/yr, and you must be able to edit its DNS | `hq@stanforduav.org` — looks right, works properly |
| **Resend's shared sending domain** | Free, zero setup | `onboarding@resend.dev` — fine for testing, wrong for real invites |
| **A subdomain of a domain the club already has** | Free if one exists | `mail.<existing>` |

If the club already owns a domain, find out **who has access to its DNS**. That
person has to add three records, and it's usually the slowest step — not
technically, but because it's someone else's afternoon.

### Steps

1. **Create a Resend account** at `resend.com`. Free tier is 3,000 emails/month
   and 100/day, which is far more than a 35-person club will ever use.
2. **Add your domain** — Resend → Domains → Add Domain.
3. **Add the DNS records it gives you.** Three TXT records, in the DNS provider
   for that domain (Namecheap, Cloudflare, Google Domains, whoever):
   - **SPF** — says Resend is allowed to send as you
   - **DKIM** — signs each message so it can't be forged
   - **DMARC** — tells receiving servers what to do if the first two fail
   Verification takes anywhere from two minutes to an hour to propagate.
4. **Wait for "Verified"** in the Resend dashboard. Don't skip this — sending
   from an unverified domain is what gets a domain blacklisted.
5. **Create an API key** — Resend → API Keys → Create. Give it **Sending
   access only**, not full access. Copy it once; it isn't shown again.
6. **Add two environment variables in Vercel** (Settings → Environment
   Variables, for Production *and* Preview):
   ```
   RESEND_API_KEY=re_xxxxxxxxxxxx
   EMAIL_FROM=SkyRunners HQ <hq@yourdomain.org>
   ```
   Add the same two to `.env.local` for local testing.
7. **Tell whoever is building it.** That's the whole handover — with those two
   variables present, the app can send.

### What gets built afterwards

`npm i resend`, then a `lib/email/` module and one call in
`inviteMemberAction`. The email says who invited them, what the club is, and
links to `/login`. Keep it to that: **an invite is the only email worth sending
at launch**, because it's the only one whose absence breaks something. Everything
else the app already surfaces in-app, and a club that emails on every event is
a club whose members filter it.

`lib/env.ts` should gate on `RESEND_API_KEY` the same way it gates on Supabase
— no key means no send and no crash, so a fresh clone still runs.

---

## 2. Discord

### Status: the app side is BUILT and waiting on a token

Anish asked for DMs rather than channel posts, and a webhook cannot DM anybody
— only a bot can. So the bot path below is the one to follow.

What exists already:

- `profiles.discord_user_id` (migration 0025), with a field on Settings → your
  profile. Members paste their own; it's optional and validated as a snowflake.
- `lib/notify/discord.ts` — opens a DM channel and posts to it.
- Wired into the three events worth pushing: **you were added to a project**,
  **your join request was answered** (either way), and **one of your people
  submitted a check-in**.

**All of it is inert until `DISCORD_BOT_TOKEN` is set.** No token means no
send, no error, and nothing in the UI changes. Add the variable and it starts
working with no deploy of app code.

Two things to know about the behaviour:

- Discord refuses a DM to somebody who **shares no server with the bot**, and
  to anybody who has "allow DMs from server members" switched off. Both are
  silent no-ops by design — a member's Discord privacy setting must never make
  somebody else's save fail.
- Sends run via `after()`, so they happen once the response is already on its
  way. A slow or broken Discord can never hold up a save.

Set `NEXT_PUBLIC_SITE_URL` too, or the links in those DMs point at localhost.

### Why a webhook is still right for anything channel-shaped

For "post a message in a channel when something happens in the app", a
**webhook** is the right tool and a **bot** is not. The difference is large:

| | Webhook | Bot |
|---|---|---|
| Setup | Two minutes, in Discord's UI | Developer Portal app, token, OAuth invite, scopes |
| Hosting | None — the app POSTs a URL | Needs a always-on process for a gateway connection |
| Can post to a channel | Yes | Yes |
| Can respond to commands, read messages, DM people | No | Yes |
| Can be @-mentioned | No | Yes |

Everything you described — a message when someone joins a project, a message
for a calendar invite — is one-way posting. That's a webhook. A bot only earns
its keep if you later want `/whoson spar` typed in Discord, or DMs to
individuals.

**Recommendation: start with webhooks.** If you outgrow them, the bot can be
added later without changing anything that was built.

### Webhook setup (the recommended path)

1. **Decide which channels get what.** Don't send everything to one channel —
   that's how a feed becomes noise people mute. A sensible split:
   - `#project-updates` — joins, completions, sign-offs
   - `#calendar` — new sessions and reminders
   - `#leads` — escalations (unread check-ins, stale join requests)
2. For each channel: **Discord → Server Settings → Integrations → Webhooks →
   New Webhook**. Pick the channel, name it "SkyRunners HQ", optionally give it
   the club logo, then **Copy Webhook URL**.
3. **Add them to Vercel** as environment variables:
   ```
   DISCORD_WEBHOOK_PROJECTS=https://discord.com/api/webhooks/...
   DISCORD_WEBHOOK_CALENDAR=https://discord.com/api/webhooks/...
   DISCORD_WEBHOOK_LEADS=https://discord.com/api/webhooks/...
   ```
   **Treat these like passwords.** Anyone with the URL can post to your server
   as that webhook, with no authentication at all. Never commit one.
4. Done. No bot, no token, no hosting.

### If you decide you want a real bot later

1. **Discord Developer Portal** → New Application → name it.
2. **Bot** tab → Add Bot → **Reset Token** → copy it. This is a password.
3. **Privileged intents**: leave Message Content OFF unless the bot needs to
   read message text. Turning it on unnecessarily is the commonest mistake and
   requires Discord's approval past 100 servers.
4. **OAuth2 → URL Generator** → scopes `bot` and `applications.commands` →
   permissions `Send Messages`, `Embed Links`. Copy the generated URL, open it,
   invite the bot to the SkyRunners server.
5. `DISCORD_BOT_TOKEN` into Vercel.
6. Note: a bot that only *posts* still doesn't need a gateway connection — you
   can POST to the REST API with the token. You need a persistent process only
   for slash commands and reactions.

### The one piece of data you'd need either way

To @-mention a specific person ("@kenji you've been added to Wing Spar"), the
app has to know their Discord user id. That's a new nullable column on
`profiles` and a field on the Settings page — a member pastes their Discord id
(Discord → Settings → Advanced → Developer Mode, then right-click their name →
Copy User ID).

**Worth deciding before it's built:** without it, messages read "Kenji Tanaka
has joined Wing Spar" — informative, not actionable. With it, it pings them.
Pinging is more useful and more annoying; a club that pings people fifteen
times a day gets muted, at which point the channel is worse than nothing.

Suggestion: **no mentions at launch.** Post the events, see whether people
actually read the channel, and add mentions only for the two or three things
that genuinely need a person to act.

---

## What to send, whichever you build

The temptation is to send everything, and it's the failure mode. The app
already shows all of this in-app; the only messages worth pushing out are the
ones where **nobody would otherwise find out in time**:

| Event | Worth sending? | Why |
|---|---|---|
| You've been invited to the club | **Yes, email** | Nothing else tells them the app exists |
| You've been added to a project | **Yes** | They didn't ask for it and won't be looking |
| Your join request was approved | **Yes** | They're waiting on it |
| A session was added to the calendar | **Yes, channel** | The point is that people turn up |
| Your check-in is due | No | It's on My Work, twice a week, forever. This is nagging |
| Somebody logged hours | No | Nobody needs this |

The rule: **push what somebody couldn't have known, not what they could have
looked up.**

---

## What is actually built (2026-08-24)

Everything below is a **DM**. No channel posts: the club chose DMs because a
channel post that matters to one person is noise to thirty-nine, and a channel
that is mostly noise gets muted — which mutes the blocker alerts with it.

Templates live in `lib/notify/discord.ts` and are wired in `lib/actions/`.

### The fifteen DMs

| Template | Goes to | Fires when |
|---|---|---|
| `addedToProject` | the member | a PL commits them to a project |
| `addedToEvent` | the guest | a Co-Lead adds them to an invite-only event |
| `joinRequestApproved` / `joinRequestDeclined` | the asker | a PL answers |
| `requestReceived` / `requestAnswered` | PL / asker | an "I'm stuck" ask, both directions |
| `blockerRaised` | the project's PLs | somebody marks a deliverable blocked |
| `projectBlockedAbove` | PLs up the tree | the blocker is on a sub-project |
| `deliverableSignedOff` | the owner | a PL signs their work off |
| `signOffWithdrawn` | the owner | a PL takes it back, **with the reason** |
| `deliverableAssigned` | the new owner | assigned on create, or reassigned on edit |
| `awaitingSignOff` | the project's PLs | the owner marks it done |
| `deliverableDueSoon` | the owner | **exactly** two days before the date |
| `blockerCleared` | whoever was stuck | their blocker is lifted |
| `logReplied` | whoever logged it | a PL answers their log line |

Four rules these all obey, each of which was a bug at some point:

- **Never DM the person who acted.** A Co-Lead signing off their own work does
  not need a DM about their own click.
- **Free text is `quoted()`, never interpolated raw.** Discord rejects a message
  over 2000 characters *outright* — it does not truncate for you — and
  `sendDiscordDM` only logs the refusal, so a pasted stack trace in a
  withdrawal reason or a log reply would lose the notification silently. Caught
  by a test asserting the length, not by seeing it happen.
- **A DM can never fail a save.** They are sent after the write commits and
  every failure path returns false.
- **Assignments are one DM each, deliberately.** Being given three things is
  three decisions somebody else made. Contrast `deliverableDueSoon`, which
  batches: three things sharing a Thursday is one calendar fact, and three DMs
  about it is what gets a bot muted.

### The daily digest

One DM a day per person, from **one** Vercel cron
(`/api/cron/daily-digest`, `lib/notify/digest.ts`).

**Scope: projects you are actually ON.** Two ways in, answering different
questions — you hold **PL authority** over it (so you are accountable whether or
not you asked, and this inherits down the project tree, which is how a Division
Lead still sees their whole division), or you hold a **membership**, committed or
following. Nothing else.

There used to be a third: every Co-Lead got every live project, added because
`isREofOrAbove` has no Co-Lead shortcut and scoping by authority alone left a
Co-Lead who is PL of nothing with an empty digest. **It was removed on
2026-08-25 after one evening's real digest** — 8 live projects for somebody on 4
of them, which is exactly the failure CLAUDE.md already names for the dashboard.
Membership answers the original problem better and more narrowly: on the live
club it halved the Co-Leads' digests, and it gave a digest to a Lead who is PL of
nothing but committed to one project and was previously getting none. A Co-Lead
who wants the club-wide view follows the projects — opt-in, not assumed.

Sections, in the order they appear:

| Section | Who | When |
|---|---|---|
| Needs attention | anyone on 2+ projects | only when something is blocked or at risk |
| Due within 7 days | everyone | when there is anything, theirs or on their projects |
| Quiet for 21+ days | everyone in scope | **Mondays only** |
| Trainings to verify | leadership | when the queue is non-empty |
| A project was added | Co-Leads club-wide, others scoped | when one started yesterday or today |
| Your projects | everyone in scope | **only when something happened on one today** |

"A project was added" is the one section that does not narrow, and it cannot: a
brand-new project has no members but its creator, so scoping it would make it
permanently empty. Club-wide for Co-Leads keeps it working as the 994-project
tripwire.

**Order is by value, and it is load-bearing.** The 1900-character clamp trims
from the bottom, so the roll call goes last and the things that need attention
go first. Rendering the real fixture is what found this: the only digest that
overflowed was the Co-Lead's with twelve projects, and what it dropped was the
Monday-only quiet section.

Two more rules:

- **Nothing to say → nothing sent.** No cheerful empty digest, and no section
  that says the same thing every evening. "3 on track" daily for a year is a
  line people learn to skip, and it takes the sections under it with it.
- **The roll call is a record of what HAPPENED**, so on a day when nothing did,
  it says nothing — and if it was the only section, no DM goes out. This was
  found by widening the scope: members who are PL of nothing started getting a
  daily DM whose whole content was "your one project was quiet today", about a
  project they cannot act on. It cut 31 digests to 26 on the fixture.
- **Deadlines include other people's work on your projects.** Deliberate, and
  it is why "nothing of my own is due" is not the same as "nothing to say" — a
  date slipping on a project you are committed to is something you might be the
  one to help with.

### Why weekly sections are a weekday check, not a second cron

Vercel's Hobby plan allows **two** cron slots and at most **one run per day**
each, and it rejects the whole **deployment** when a schedule breaks that rule —
not just the cron. A weekly schedule would have been legal, but a second cron is
a second thing that can silently stop. One job that decides what to include has
one failure mode and one place to look, and the spare slot stays spare.
`lib/notify/cron-schedule.test.ts` asserts the frequency rule.

### Reach, as of 2026-08-24

**5 of 12 members have a Discord id.** Everything above reaches nobody else —
`sendDiscordDM` returns false with no id and the digest skips them entirely.
Three of the five are the Co-Leads. Getting the other seven connected is worth
more than any further notification: the Settings page has the field, and
`verifyDiscordDM` tells somebody exactly why their id did not work.
