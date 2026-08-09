# Integrations — email and Discord

**What Anish needs to set up.** Both close the same gap: the app only notifies
in-app, so **an invited member never learns they've been invited unless
somebody tells them out of band.**

| | State |
|---|---|
| **Email invites** | Not built. Needs a sending domain first — see below |
| **Discord DMs** | **Built and inert.** Set `DISCORD_BOT_TOKEN` and it starts working |

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
| A deliverable was signed off | Channel, maybe | Nice for morale, useless as a notification |

The rule: **push what somebody couldn't have known, not what they could have
looked up.**
