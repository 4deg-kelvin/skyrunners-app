# MCP Plan — driving SkyRunners from an AI client

Status: **draft, nothing built.** Written 2026-08-12.

## Why

Two different needs point at the same thing.

**The immediate one.** A Division Lead for Drone Hacks who will not use a
website. He wants to assign work, see what's moving, and sign things off. Every
one of those is a two-minute job on the site and he won't do it, which means
the division's state goes stale and the app stops being worth trusting for
that division — the exact failure this whole project exists to remove, arriving
through a side door.

**The general one.** Anyone in the club should be able to point their own AI at
the app. That's the harder requirement and it's the one that shapes the design:
the moment a second person connects, the server has to enforce *their* role, not
the role of whoever built it.

---

## 1. What a Division Lead can actually do

Worth pinning down before designing tools, because the answer is more generous
than it sounds and has one sharp edge.

`leadsTeamAbove` folds into `isREofOrAbove` (`lib/permissions.ts`), so **leading
Drone Hacks makes him a top RE over everything inside it**, at any depth,
including sub-projects that carry no `teamId` of their own.

**He can:**

| Action | Rule |
|---|---|
| Create, assign and re-assign deliverables | `manageDeliverables` |
| Sign off finished work | `confirmDeliverable` |
| Mark a project complete | `completeProject` — he qualifies on any project he isn't personally the RE of |
| Edit phase, health, dates, description | `manageProject` |
| Appoint and remove REs | `assignRE` |
| Add members, answer join requests | `addProjectMember`, `reviewJoinRequest` |
| Attach and remove documentation | `attachArtifact`, `manageArtifact` |
| See hours logged **on his projects** | `viewMemberHoursOnProject` |

**He cannot**, and this is deliberate:

- **Read anyone's personal effort record** — total hours, reliability, the
  private half of a check-in. That needs `viewMemberEffort`, which is the Lead
  chain only. A Division Lead is not a Co-Lead.
- **Use the leadership dashboard.** `/dashboard` redirects anyone who oversees
  nobody (`viewLeadershipDashboard(actor, hasReports)`), and if nobody's
  `lead_id` points at him, that's him.

That second point is a *feature* here, not a problem. You said he doesn't want
to manage people. Division Lead with zero direct reports is precisely "all the
project authority, none of the people obligations" — so **don't give him
reports, and don't build the MCP around `get_dashboard`.** Build it around
project-scoped tools, which is where all his authority actually lives.

---

## 2. Shape: a remote server on the same deployment

`app/api/mcp/route.ts`, on the existing Vercel deploy. Streamable HTTP.

The alternative — a local stdio server the user installs with `npx` — is worse
for both audiences. It needs Node on their machine, a config file, and a
separate update path when tools change. For someone who won't use a website,
"install this CLI" is not the answer. A remote server means the setup is one
URL and one token, and everyone gets new tools the moment we deploy.

```
Claude Desktop / Claude Code / claude.ai
                │  HTTPS + Bearer token
                ▼
   app/api/mcp/route.ts        ← MCP transport, tool registry
                │
                ▼
   lib/mcp/viewer.ts           ← token → { actor, graph, member }
                │
                ▼
   lib/data/*  and  lib/permissions.ts   ← UNCHANGED, and that is the point
```

---

## 3. The one rule

> **The MCP server is an adapter. It is not a second permission layer, and it
> is not a second data layer.**

Every tool resolves a viewer, then calls the same `lib/data/*` readers and the
same `can.*` checks the web pages use. No new queries, no inline role checks, no
`globalRole ===` anywhere in `lib/mcp/`.

This is not tidiness. `lib/permissions.ts` has 50+ tests on three inheritances
that run in different directions, and the asymmetry between them is where bugs
hide. A second implementation in the MCP layer would be a privilege-escalation
surface that nobody is testing — and unlike the website, the caller is a
language model that will happily try every tool to see what works.

Concretely, three prohibitions worth writing into the file header:

1. **No raw query tool.** No `run_sql`, no `query_table`, no "escape hatch for
   the model". One of those undoes every policy in the repo.
2. **No service-role client in a tool.** Same reasoning as "don't use Prisma"
   in CLAUDE.md, one layer down.
3. **Reads project down, they don't re-query.** `lib/data/*` returns
   page-shaped view models — `getProjectBySlug` carries a timeline, a Gantt,
   an events list and the full update feed. Dumping that into a model's context
   is both wasteful and unreadable. Tools call the same function and then
   *narrow* the result. Narrowing is fine; re-fetching is not.

---

## 4. Authentication — the hard part

This is the piece to get right, and the piece most likely to be done badly in a
hurry. Three layers.

### 4a. The user's credential: a personal token

A new `mcp_tokens` table. A member creates one in Settings, sees it exactly
once, pastes it into their client.

```
mcp_tokens
  id            uuid pk
  member_id     uuid → profiles
  name          text          -- "Kelvin's laptop", so revoking is meaningful
  token_hash    text          -- sha-256. NEVER the token itself
  scope         text          -- 'read' | 'write'
  created_at    timestamptz
  last_used_at  timestamptz   -- so a dormant token is visible and revocable
  expires_at    timestamptz   -- default 180 days; a student's token should
                              -- not outlive their membership by years
  revoked_at    timestamptz
```

Not OAuth, deliberately, and this is a real tradeoff. Proper OAuth 2.1 is what
the MCP spec prefers and what a public server should do — but it means
implementing an authorization server, and for a 35-person club where every user
already has an account, a hashed token is the same security property with a
fraction of the surface. Design the resolver so an OAuth path can be added
later without touching a single tool.

The irony is noted: he has to visit the website once to get a token. Once,
versus daily.

### 4b. Becoming that user against Postgres, without losing RLS

The naive move is: token → member id → do the work with the service-role key.
**Don't.** That turns off RLS for every MCP read, and RLS is the primary read
gate in this app (`supabase/migrations/0004`). One bug in a tool's filter then
leaks the whole table.

Instead: **mint a short-lived Supabase JWT for that member and use a normal
client.** The token resolver looks up `member_id`, signs a 5-minute HS256 JWT
with `sub = member_id`, `role: authenticated`, `aud: authenticated` using
`SUPABASE_JWT_SECRET`, and builds a Supabase client with it. From that point on
the request is indistinguishable from a signed-in browser session, and every
policy — including the storage policies from 0035 — applies exactly as written.

**Verify before building:** this needs the project's legacy shared JWT secret.
Newer Supabase projects use asymmetric signing keys and the flow is different
(you publish a JWKS or use the signing-key API). Check which one
`ldijsmcnjrihwvxtypqy` is on — it changes maybe thirty lines, but it changes
them before anything else works.

### 4c. Building the viewer

`getViewer()` can't be reused directly: `getLiveViewer` calls
`redirect("/login")` when there's no session, which is meaningless in an API
route and would surface to the model as a confusing HTTP redirect.

So a sibling in `lib/mcp/viewer.ts` that returns the same `Viewer` shape
(`{ member, actor, graph, isDemo }`) or a typed failure. It reuses
`membersSpec.fromRow` and `loadLiveOrgGraph` — the same two calls the live
viewer makes — so a new profile column reaches the MCP the moment it reaches
the spec, which is the drift `lib/data/viewer.ts` already got bitten by once.

---

## 5. Tools

Named for what a person would ask for, not for the function behind them. The
model picks tools off the description, so `find_blocked_work` beats
`getProjectAttentionFlags`.

### Phase 1 — the partner's actual job

**Read**

| Tool | Returns |
|---|---|
| `list_projects` | Projects, filterable by division / health / phase. Compact: name, slug, phase, health, RE, progress %, blocked count |
| `get_project` | One project in full — deliverables with owners and due dates, members, REs, attention flags, documentation links |
| `find_blocked_work` | Everything stalled in scope: blocked deliverables with their notes, at-risk and blocked projects, overdue work. **This is his morning question in one call** |
| `list_deliverables` | Filter by project, owner, status, overdue |
| `get_member` | Someone's public half — projects, responsibilities, skills, RE roles. Explicitly *not* the effort record |
| `whoami` | Who the token belongs to and what it can do. First thing to build: it makes every auth problem debuggable in one call |

**Write**

| Tool | Guarded by |
|---|---|
| `create_deliverable` | `can.manageDeliverables` |
| `assign_deliverable` | `can.manageDeliverables` |
| `set_deliverable_status` | `can.manageDeliverables` |
| `sign_off_deliverable` | `can.confirmDeliverable` |
| `update_project` | `can.manageProject` — phase, health, dates |

That set alone covers "assign work and track progress across Drone Hacks."

### Phase 2 — the rest of the club

`find_work`, `my_work`, `log_hours`, `submit_check_in`, `attach_documentation`
(links only — a file upload through MCP is possible but the client would have
to base64 a file into a tool argument, which is ugly and blows context),
`answer_join_request`, `add_project_member`, `list_events`, `create_event`,
`post_help_request`.

### Resources, not just tools

For *"his Claude can be updated with what everyone is working on"* — that's a
**resource**, not a tool. Tools are for doing; resources are context a client
can attach and refresh.

- `skyrunners://division/{slug}/status` — one page of prose: every project,
  who's on it, what's blocked, what's due this week
- `skyrunners://me/work` — what the token's owner owns and owes

One caveat to set expectations: **MCP cannot push.** Nothing here will make his
Claude speak up unprompted. If he wants proactive nudges, two things already
exist and need no website: the Discord DM on a raised blocker
(`blockerAudience`, live now) and the daily check-in cron. A scheduled prompt on
his side that reads the division resource each morning is the third option, and
it's a client-side setup, not something this server provides.

---

## 6. Safety

An LLM with write access to the club's project tracker is a genuinely different
risk from a person with the same access. A person doesn't reassign eleven
deliverables because they misread a sentence.

- **Two scopes, and read is the default.** A token is `read` unless the creator
  ticks write. Most people connecting an AI want to ask questions.
- **Every write is attributed to MCP.** Whatever audit trail a write already
  leaves — `confirmedById`, `uploadedById`, `ProjectNotice` — should record that
  it came from an agent, plus the token name. "Priya signed this off" and
  "Priya's agent signed this off" are different claims and the record should not
  conflate them. This one matters more than it looks: the club's sign-off record
  is the thing contribution is measured on.
- **Bulk operations refuse past a threshold.** A tool asked to touch more than
  ~5 rows returns a refusal listing what it would have done. The model can then
  ask the human.
- **Rate limit per token**, so a looping agent can't hammer the free-tier
  database.
- **Structured refusals.** When `can.*` says no, return the same complete
  sentence the web UI shows, not a 403. The model relays it to the human, and
  "you can't sign off your own deliverable — the RE above you does that" is
  actionable where "Forbidden" is not.
- **`last_used_at` and a revoke button** in Settings, next to where tokens are
  made.

---

## 7. What I'd expect to go wrong

Written down now so it's recognisable later.

1. **The JWT secret turns out to be asymmetric-only.** Most likely blocker.
   Check first.
2. **Tool descriptions are the actual product.** The model chooses from them. A
   vague description means the wrong tool called confidently. Expect to spend
   real time here, and expect it to feel like it shouldn't matter.
3. **Response size.** `get_project` on a busy project could be thousands of
   tokens. Narrow aggressively; add a `verbose` flag rather than defaulting to
   everything.
4. **Demo mode.** The MCP is meaningless without a database. It should refuse
   cleanly with a sentence, not half-work against `.data/store.json`.
5. **`npm run sweep`** looks for exports nothing renders. MCP tools are called
   by a protocol, not a component, so they'll trip it. The sweep needs to learn
   about the tool registry, or it will be quietly disabled — which is worse than
   the false positive.

---

## 8. Sequencing

| Step | Work |
|---|---|
| 0 | Confirm the JWT secret situation. Everything else depends on it |
| 1 | `mcp_tokens` migration + RLS (a member sees only their own tokens) |
| 2 | Settings UI: create, name, copy once, revoke |
| 3 | `lib/mcp/viewer.ts` — token → viewer, with tests for expired / revoked / wrong-hash |
| 4 | `app/api/mcp/route.ts` with exactly one tool, `whoami` |
| 5 | Phase 1 reads |
| 6 | Phase 1 writes, with the audit attribution |
| 7 | `docs/CONNECT_YOUR_AI.md` — the copy-paste setup, written for someone who does not want to be doing this |
| 8 | Phase 2 |

Steps 0–4 are the risky part; once `whoami` returns the right person with the
right role, the rest is repetitive.

---

## 9. Open questions for Anish

1. **Does the partner get any direct reports?** If no — which is what "doesn't
   want to manage people" implies — he has no dashboard and no access to
   anyone's effort record, and the MCP should not pretend otherwise. Confirm
   that's intended.
2. **Does "Drone Hacks" exist as a division yet**, with him as `lead_id`? The
   MCP grants nothing on its own; every permission in §1 comes from that one
   row.
3. **Write access in v1, or read-only first?** Read-only is a much smaller blast
   radius and would still let him answer "what's blocked in Drone Hacks" without
   opening a browser. Assigning is the half that needs care.
4. **Club-wide, or him first?** Same server either way — but "anyone can
   connect" means the token UI, the docs and the rate limits are all v1 rather
   than later.
