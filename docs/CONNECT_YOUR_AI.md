# Connect your AI to SkyRunners

You can point Claude at the club and ask it what's going on, what's blocked, or
what you should be doing — and, if you want, let it assign work and update
projects for you.

It acts **as you**. It sees exactly what you can see on the website and can do
exactly what you can do. Nothing more.

---

## Setup — about two minutes, once

### 1. Get a token

Go to **Settings → Connect your AI** on the website and press **New token**.

- Give it a name you'll recognise later ("Claude on my laptop"). You'll see this
  next to the revoke button.
- Choose what it may do:
  - **Read only** — ask questions, change nothing. Start here.
  - **Read and write** — also assign deliverables, move dates, update project
    status, and log what you did.

**Copy the token immediately.** It's shown once and never again — only a hash of
it is stored, so nobody, including whoever runs the site, can recover it. Lost
one? Revoke it and make another; it takes ten seconds.

The panel that appears after you press **Create token** also gives you the whole
`claude mcp add` command with your token and the server URL already filled in, so
step 2 is one paste into a terminal. Nothing on that panel survives leaving the
page — that is the "shown once" rule working, not a bug.

Tokens last 180 days.

### 2. Add it to Claude

The same box in Settings shows the **server URL**. It is:

```
https://skyrunners-app.vercel.app/api/mcp
```

Add it as an **HTTP MCP server** with your token as the bearer credential.

**Claude Code** — one command, from anywhere:

```bash
claude mcp add --transport http skyrunners https://skyrunners-app.vercel.app/api/mcp --header "Authorization: Bearer skr_your_token_here"
```

Note the `-app`. `skyrunners.vercel.app` is somebody else's site.

**Claude Desktop / claude.ai** — these cannot send a header at all: the "add a
custom connector" dialog takes a URL and nothing else. So Settings gives you a
second, personal URL with the token in it:

```
https://skyrunners-app.vercel.app/api/mcp/skr_your_token_here
```

Settings → Connectors → Add custom connector, and paste that.

**That connection is read-only, on purpose.** It can answer anything about the club
and change nothing. The reason is that Vercel logs the path of every request, so a
token in a URL is a credential sitting in the platform's logs — fine for reading a
calendar or a project list, not fine for something that can reassign work. If you
want an assistant that makes changes, use Claude Code, where the token travels in a
header. The proper fix for claude.ai is OAuth; it's scoped in
`docs/MCP_SECURITY_REVIEW.md`.

### 3. Check it worked

Ask your assistant:

> who am I in SkyRunners?

It should come back with your name, your role, what you lead, and anything
missing from your profile. If it doesn't, see *Troubleshooting* below.

---

## What to ask it

Start every session with something like *"catch me up"* — that's one call and
gives the assistant the whole picture.

**Finding out what's happening**

> Catch me up
> What's blocked in Drone Hacks?
> Show me the Wing Spar project
> Who's on the airframe team, and what are they working on?
> What should I work on this week?

**Getting things done** (needs a write token)

> Assign "update the mass budget" to Tyler on Wing Spar, due Friday
> Push the Wing Spar target date to the 30th
> Mark the propulsion test stand at risk
> The spar layup is blocked — we're waiting on the laser cutter
> Sign off the mass budget deliverable
> Approve Julia's request to join SkyBeta Kits
> Put Kevin on the test stand, owning the load cell wiring
> Start a new project under Wing Spar called "Rib Tooling"
> Post on the help board — I need someone who knows Onshape
> Add my skills: composites, CAD, structural analysis

**The calendar** (reading is free; creating needs a write token)

> What's on this week?
> What am I signed up for in the next month?
> Put a build session on for Thursday at 6, in Building 550
> Set up a weekly all-hands, Tuesdays at 5, running until December 8th
> Make it fortnightly instead — a townhall every other Tuesday
> I'm coming to the Skydio tour

One event covers a whole repeating series, so **saying you're coming once covers
every occurrence.** Anything you're on lands in your own Apple, Google or Outlook
calendar within a few hours, if you've connected one — see
`docs/CONNECT_YOUR_CALENDAR.md`.

Times are **club time** (Pacific), written like `2026-09-15T18:00`. Don't add a
`Z` or an offset; the server converts, and it handles the daylight-saving change
so a 5pm meeting stays 5pm all year.

Three calendar things are deliberately not available from an assistant:
**cancelling** an event (it deletes the attendee list, with no undo),
**invite-only** events (Co-Lead only, on purpose — every closed event subtracts
from an open calendar), and **your subscription link** (it's a credential, and
asking for it would print it into your chat transcript).

**Moving a date, on the record** (needs a write token)

> Push the Wing Spar target to October 30th — the spar tooling slipped two weeks
> Move Tyler's mass budget deliverable to the 12th, we're waiting on the laser cutter

Both keep the old date on the project's record and show it as a ghost marker on
the timeline, so a slipping schedule stays visible instead of being quietly
rewritten. **A reason is required** — the tool refuses without one, because
whoever is planning around that date is going to read it.

**Logging what you did** (needs a write token)

There are no hours — the club stopped counting time in August 2026. You describe
the work, and the description is the whole point:

> Log on Wing Spar: ran the tensile coupons, two of five failed early
> Log yesterday on the layup: vacuum-bagged the second coupon
> Log misc: helped at the open build session, cable-managed the test stand

**This is worth the ten seconds, and it got more important in August 2026.** The
club dropped its twice-weekly check-in on the 24th. Your log line is now the only
thing you report: it lands in the project's feed, its PL can read it and reply to
it, and nothing else is collected from you.

Which makes this a good standing instruction to give your assistant:

> At the end of any session where we worked on club stuff, log it to SkyRunners
> for me — one line per project, describing what actually changed.

One caveat, and it's the reason there was never a tool for submitting a check-in:
an assistant writing your report *for* you is worse than a short one you wrote.
Have it record what you actually did, not a polished version of what it assumes
you did.

---

## Keeping an assistant permanently up to date

Tools are things your assistant decides to call. **Resources** are context you
pin once, and it refreshes them.

Available to attach:

| Resource | What's in it |
|---|---|
| `skyrunners://me/work` | Your open deliverables and the projects you're on |
| `skyrunners://club/blocked` | Everything blocked, club-wide |
| `skyrunners://division/<slug>` | One division: every project, who's on it, what's blocked, what's due |

A Division Lead who wants their assistant to always know the state of their
division should attach the division resource — then "what's the state of Drone
Hacks" needs no tool call at all.

**One thing to be clear about: this can't notify you.** MCP has no way to push;
your assistant re-reads a resource when it next runs. If you want to *hear*
about a blocker the moment it's raised, that's already the Discord DM the club
sends — it needs no AI and no website. Connect Discord in Settings.

---

## What it can't do, and why

Some things are deliberately website-only. They're rare, hard to undo, or both,
and none of them is something you do more than a couple of times a term:

- Deleting anything — projects, people, divisions
- Archiving a division
- Changing someone's role, or who they report to
- Club settings and the academic calendar
- Removing someone from a project
- Withdrawing a sign-off
- Uploading files (links work fine; uploads need the browser)

Also: assigning who verifies a training, or marking one self-verify.

**One more worth explaining: reading anyone's archived check-ins but your own.**
Almost everything about a member is public now — every log line, every project,
what they finished — and there are tools for all of it. Old check-ins are the
exception, because they carried a note written back when only one person was
going to read it. The MCP doesn't expose them for anybody, at any role. Use the
website, where you're properly signed in.

*Submitting a check-in* was listed here for a long time, with the reasoning that
one your assistant wrote for you was worse than not writing one. Check-ins are
gone; the reasoning moved to logging work, above.

Your assistant knows all of this and will tell you to open the site.

---

## Is this safe?

**It can only do what you can do.** Every action runs through the same
permission rules as the website — the ones with 50+ tests behind them. If you
can't reassign work on a project through the site, your assistant can't either,
and it gets the same explanation you would.

**Read-only really is read-only.** Write tools aren't just refused, they aren't
offered — a read token can't see them.

**Revoke instantly.** Settings → Connect your AI → Revoke. It stops working on
the next call.

**Keep the token like a password.** Anyone holding it can act as you. Don't
paste it into a shared channel or commit it. If you think it's leaked, revoke it
— that's the whole recovery procedure.

---

## Troubleshooting

**"That token isn't recognised" / "has expired" / "has been revoked"**
Make a new one in Settings. The message tells you which of the three it is.

**Your assistant sees the server but no tools**
It connected but the token isn't reaching it. Check the Authorization header is
`Bearer skr_...`, with the space, and that nothing was truncated on paste.

**It says a token is read-only when you meant it to write**
Scope is fixed when the token is made. Revoke it and create a write one.

**It assigned something to the wrong person**
It refuses to guess between two people with similar names, but a single loose
match will go through. Use email addresses when it matters — and ask it to
confirm before it changes anything that isn't yours.

---

## Checking the server itself, without an AI client

Worth doing before debugging a client, because it separates "the server is
broken" from "my client is misconfigured" — and the two look identical from
inside Claude.

`initialize` needs no token, so this answers even with nothing set up:

```bash
curl -s -X POST https://skyrunners-app.vercel.app/api/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

A healthy server returns `"protocolVersion":"2024-11-05"` and a long
`instructions` string. Two failures to recognise:

- **`307` to `/login`** — the endpoint has fallen behind the auth middleware.
  `api/mcp` must be excluded from the matcher in `middleware.ts`. This has
  happened before, to the cron routes.
- **A sentence about `SUPABASE_SERVICE_ROLE_KEY`** — the env var is missing on
  the deployment. The endpoint says so rather than half-working.

Then, with your own token, the one call that proves auth end to end:

```bash
curl -s -X POST https://skyrunners-app.vercel.app/api/mcp -H "Content-Type: application/json" -H "Authorization: Bearer skr_your_token_here" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

Your name comes back in `result.content[0].text`. A bad token gives a readable
sentence with `"isError":true` — deliberately, not an HTTP 403, because the model
has to be able to read it and tell you what to do.

**`tools/list` answers without a valid token, on purpose.** Tool names and
descriptions aren't secret, and a client that can list before authenticating
gives a much better error. Nothing is *callable* without a real token.

---

## For whoever maintains this

The server is `app/api/mcp/route.ts`; tools are in `lib/mcp/tools.ts`. Before
adding a tool, read the header of `lib/mcp/viewer.ts` — the privacy boundary is
enforced by which tools exist, not by a filter, and that's load-bearing.

The model's instructions and the long-form `guide` tool both live in
`lib/mcp/guide.ts`, deliberately in one file. **When a club rule changes, that
file is the easiest thing in the repo to forget** — it is prose, nothing
typechecks it, and a stale sentence there quietly teaches every member's
assistant the old rule. The hours removal left one behind ("3.5 hrs — ran the
tensile coupons") and only a grep for `hrs` found it.

It needs `SUPABASE_SERVICE_ROLE_KEY` set on the deployment. Without it the
endpoint answers every call with a sentence saying so, rather than half-working.
