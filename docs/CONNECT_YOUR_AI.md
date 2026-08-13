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
    status, log hours.

**Copy the token immediately.** It's shown once and never again — only a hash of
it is stored, so nobody, including whoever runs the site, can recover it. Lost
one? Revoke it and make another; it takes ten seconds.

Tokens last 180 days.

### 2. Add it to Claude

The same box in Settings shows the **server URL**. It looks like:

```
https://<the-club-site>/api/mcp
```

Add it as an **HTTP MCP server** with your token as the bearer credential.

**Claude Code** — one command, from anywhere:

```bash
claude mcp add --transport http skyrunners https://<the-club-site>/api/mcp --header "Authorization: Bearer skr_your_token_here"
```

**Claude Desktop / claude.ai** — Settings → Connectors → Add custom connector,
paste the URL, and put `Bearer skr_your_token_here` in the Authorization header.

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
> Log 3 hours on Wing Spar yesterday, ran the tensile coupons
> Add my skills: composites, CAD, structural analysis

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
- Club settings, commitment tiers, the academic calendar
- Removing someone from a project
- Withdrawing a sign-off
- Uploading files (links work fine; uploads need the browser)

Two more worth explaining:

**Submitting a check-in.** The point of a check-in is to start a conversation
with your Lead. One your assistant wrote for you is worse than not writing one,
so it isn't offered. Logging *hours* is fine — that's bookkeeping, and the
assistant makes it fast.

**Reading anyone's hours or check-in contents but your own.** The club's privacy
model says effort data belongs to the member and their Lead chain. Rather than
try to reproduce that rule out here, the MCP simply doesn't expose it — for
anybody, at any role. Use the website, where you're properly signed in.

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

## For whoever maintains this

The server is `app/api/mcp/route.ts`; tools are in `lib/mcp/tools.ts`. Before
adding a tool, read the header of `lib/mcp/viewer.ts` — the privacy boundary is
enforced by which tools exist, not by a filter, and that's load-bearing.

It needs `SUPABASE_SERVICE_ROLE_KEY` set on the deployment. Without it the
endpoint answers every call with a sentence saying so, rather than half-working.
