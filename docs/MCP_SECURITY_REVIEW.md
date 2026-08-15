# MCP server — security review

Written 2026-08-15, after an assistant connected to this server created roughly
4,000 empty projects in a single run.

Read `lib/mcp/handler.ts`, `lib/mcp/viewer.ts` and `lib/mcp/tools.ts` alongside
this. The point of the document is the reasoning, not the inventory.

---

## What actually happened, stated precisely

Artash connected Claude to the server with a write-scoped token and it created
~4,000 projects named `Project ABCX`, `Project ABDG`, and so on.

**Nothing was bypassed.** He leads a division, `can.createProject` correctly
allowed a top-level project there, and every one of those calls was a legitimate
action by an entitled member. The permission model did its job.

The failure was that **the app had no concept of scale**. Every control it owned
answered "may this person do this once?" and none answered "should this be
happening four thousand times?" A human hand cannot reach that number, so nothing
had ever needed to ask.

That distinction matters for the fix. Tightening permissions would have been the
wrong response — it would have taken a capability away from someone who should
have it, and left the same hole for every other write tool.

### The second-order damage

- `/projects` and `/find-work` render every active project, so both became
  enormous. The purge fixes this by removing the rows.
- The Settings cleanup page itself was O(members × projects) on the first
  attempt, measured at **4.7 seconds** for 40 members and 4,000 projects. Fixed
  before it shipped — see `emptyProjectsByCreator`.
- There was **no way to undo a bulk write from the website at all**. A Co-Lead's
  only recovery was a per-project delete button, four thousand times.

---

## Findings

Severity is about this club — 35 people, all authenticated Stanford accounts, no
public write surface — not about a product with anonymous users.

### 1. No ceiling on writes — HIGH, fixed

The incident itself. Two layers now:

- **Durable, per-day, cross-instance:** `createProject` refuses past 25 projects
  per person per day that still have no deliverables on them
  (`MAX_EMPTY_PROJECTS_PER_DAY`). It lives in `lib/store/operations.ts`, the only
  write choke point, so it covers the website, the MCP server and anything added
  later. It counts *empty* projects rather than requests, so it never blocks
  somebody doing real work — a project with a deliverable on it stops counting.
- **General, per-token, in-memory:** `lib/mcp/rate-limit.ts` allows 30 writes a
  minute and 200 an hour per token, across all sixteen write tools.

**The honest limit of the second layer:** the state is per-serverless-instance, so
a caller spreading requests around gets a multiple of it, and a cold start forgets
everything. It stops the accident that happened — a client in a tight loop keeps
hitting the same warm instance — and it is *not* a boundary against a hostile
token holder. Against that, the answer is revoking the token.

**Why the durable layer only covers projects:** it counts creations per day, which
needs a creator and a date on the row. `project_members` has both. `Deliverable`
records neither a creator nor a created-at; `ClubEvent` has `createdBy` and no
timestamp. So a per-day ceiling cannot be built for the other collections without
a migration. See *Recommended next* below.

### 2. `projects.created_by` was never written — HIGH, fixed

The column has existed since migration `0001` and was selected by nothing and
written by nothing, so every project in production has `NULL`. Attributing these
4,000 meant reconstructing authorship from `project_members.added_by`, which
happens to be recorded and happens to agree.

An audit trail nobody has tested is not an audit trail. It's now mapped in both
directions, with no migration needed.

### 3. Postgres error text returned to unauthenticated callers — LOW, fixed

`viewerFromToken` returned `Couldn't check that token: ${error.message}` on a
database failure. That branch is reachable by anyone who can POST to the endpoint,
with no valid credential, so its contents are public — and a Postgres error can
name tables, columns and constraints. Now logged server-side, with a generic
sentence returned.

### 4. claude.ai could not connect at all — MEDIUM (usability), fixed

Not a vulnerability, but it belongs here because the fix is a security trade. The
connector dialog in claude.ai and the desktop app takes a URL and nothing else —
it cannot send `Authorization` — so the server was reachable from Claude Code
only, while Settings told people to "put Bearer <token> in the Authorization
header", which is impossible in that UI.

`POST /api/mcp/<token>` now accepts the token in the path and is **forced
read-only**, whatever scope the token was minted with.

**Why read-only, specifically:** Vercel logs the path of every request. A token in
a URL is therefore a credential sitting in plain text in the platform's logs,
readable by anyone with log access. That is an acceptable trade for reading — the
club's projects and calendar are transparent by design, and it is the same trade
already accepted for the calendar feed — and not acceptable for a credential that
can change the club's data.

### 5. The privacy boundary is enforced by which tools exist — ACCEPTED RISK

The MCP snapshot is loaded with the **service-role client**, past RLS, exactly as
the calendar feed is. There is no session on an MCP call, so a cookie-backed
client would read nothing at all.

This means the rule "no tool returns another member's effort data" is enforced by
the *absence* of tools rather than by the database. It holds today. It is one
careless tool away from not holding, and no test would catch it.

Documented rather than fixed because the alternative — threading RLS through a
service-role snapshot — is a large change to the store layer for a boundary that
is currently correct. The mitigation is the rule stated at the top of
`lib/mcp/tools.ts` and the fact that adding a tool is a deliberate act.

### 6. Unauthenticated requests cause a database query — LOW, accepted

`tools/call` with a bad token costs one indexed lookup on `mcp_tokens`. Somebody
could use that to generate load. Tokens are 256 bits of CSPRNG output, so guessing
one is infeasible; this is a cost/noise concern, not an access one. Vercel's own
platform limits are the backstop. Not worth adding infrastructure for at this
club's size.

### 7. `tools/list` answers without a valid token — LOW, deliberate

It returns tool names, descriptions and schemas — the club's vocabulary, no member
data. Deliberate: a misconfigured client that shows an empty server sends people
debugging the URL instead of the token. Write tools are hidden from read-only
tokens so a model doesn't try them.

### 8. Token scope is all-or-nothing — MEDIUM, accepted for now

A write token can do everything its member can do through the MCP: sixteen tools,
no per-tool granularity. Somebody who wants an assistant that only logs work must
either trust it with everything or use a read token and log by hand.

Not fixed because per-tool scopes are a real design problem (a UI for choosing
them, migration, and the risk of people granting everything anyway), and because
the write tools are deliberately non-destructive.

### 9. What the tools deliberately cannot do — verified, unchanged

No tool deletes anything, archives a division, changes a role or reporting line,
edits club settings or the academic calendar, removes somebody from a project,
withdraws a sign-off, submits a check-in, or reads anyone's work log or check-in
contents but the caller's own. That list is why the incident produced 4,000
harmless rows rather than 4,000 deletions, and it is the single most valuable
security property of this server. **Do not add a delete tool.**

---

## Recommended next, in priority order

1. **A `created_by` / `created_at` pair on `deliverables` and `events`**, so the
   durable per-day ceiling can cover them the way it covers projects. This needs a
   migration; until it lands, those tools are protected only by the in-memory
   limiter.
2. **An MCP audit log** — one row per write: token id, tool, arguments, timestamp.
   During this incident there was no way to ask "what did that token do", and
   attribution had to be inferred. Needs a table.
3. **OAuth 2.1 with dynamic client registration**, which is what claude.ai wants
   for a connector that writes: authorization-server metadata, `/authorize` with
   PKCE against the existing Supabase session, `/token`, and short-lived codes
   (which need somewhere to live — a table, since serverless memory won't do).
   That removes the read-only limitation on finding 4 properly.
4. **Alert on a burst.** The club has a Discord bot and a daily digest. "Tyler's
   assistant created 60 projects in a minute" reaching a Co-Lead in real time is
   worth more than any of the above; nobody knew this was happening until the
   projects were noticed by eye.

---

## For whoever reviews this next

The lesson worth carrying is narrow and general: **an agent with a legitimate
credential is a load-testing tool pointed at your write paths.** Every check in
this codebase asked "is this allowed?" and the app was correct throughout, at four
thousand times the intended scale. Ask the second question — "how often, and what
happens if this runs in a loop?" — of every write path added from here.
