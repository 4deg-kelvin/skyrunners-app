# Handoff — read this first

**Written 2026-08-08, last revised 2026-08-10.** Everything a fresh session
needs. Written for someone with no memory of how any of this came to be.

**Start with "Session log — 2026-08-10" near the bottom** if you're picking up
where the last session stopped. It has the three outstanding items.

---

## Where things actually are

The app is **live on Supabase** at `skyrunners-app.vercel.app` — note the
`-app`; `skyrunners.vercel.app` is somebody else's site and probing it to check
a deploy gives a confident wrong answer. Real Google sign-in, real Postgres,
migrations `0001`–`0030` applied. **Phases 0–8 are built** — my work, find work, projects,
members, deliverables and sign-off, check-ins and review, terms, trainings and
facility access, and the calendar. There is no phase 9+ scoped yet beyond the
one item under "What's next".

The club is **deliberately empty** — three Co-Leads (Anish, Jonathan, Kelvin),
no projects, no divisions. It gets populated through the app, not a seed script.
That was Anish's explicit decision: a clean sheet, organised from scratch.

```bash
npm run db:check        # is the database really there?
PW=<db-password> npm run verify:live   # does every page work on real data?
```

**Before the club uses it, somebody has to add a term.** Check-ins only
generate inside an academic period the club has entered, and with no terms
`inSession` is false for every date — so nobody is prompted, no review queue
fills, and reliability never starts. It's the one setup step with no visible
symptom, which is why the dashboard now says so in a banner. Settings →
Academic Calendar.

`verify:live` is the one that matters. It loads the whole database and calls the
`lib/data/*` function behind every route, plus the two pages that call several
in parallel. As of now: **all 21 pass**.

Before every push, in this order:

```bash
npm run check       # typecheck + lint + dead-control sweep + 389 tests
npm run build:check # NEVER `npm run build` while dev is up — see Traps
```

Then commit, merge into `main`, push, and confirm
`git rev-list --left-right --count main...origin/main` reads `0 0`. Vercel
deploys on push, so pushing IS deploying. Twenty-one commits once sat unpushed
while Vercel rebuilt old code; three debugging rounds went into code that
wasn't running.

---

## The ten bugs that cost the most time

Read these before debugging anything. Each was invisible in the obvious place.

### 1. Code that was never pushed

Twenty-one commits sat unpushed while Vercel dutifully rebuilt the old code.
Three rounds of "the deployed site is wrong" were spent debugging code that
wasn't running.

**Always check `git rev-list --left-right --count main...origin/main` before
diagnosing anything about the deployed site.**

### 2. Silent fallback to mock data

`readStore()` ended in `liveResolver?.() ?? load()`. When the live snapshot
wasn't loaded it quietly returned the sample club — so the app ran live, sign-in
worked, the demo banner was correctly absent, and every page showed fake people
as real. Nothing looked broken.

Both `readStore()` and `mutate()` now **throw** in live mode rather than fall
back. If you ever feel tempted to reinstate a fallback: a page that lies is
worse than a page that errors.

### 3. Writes resolving outside the request scope

`mutate()` defers onto a module-level promise chain. The live snapshot lives in
React's request-scoped `cache()`. Resolving the backend *inside* the deferred
callback ran a tick later — outside the request — so writes silently went to a
local JSON file while reads came from Postgres. Edits "saved" and vanished.

The backend is now captured **synchronously before** the queue.
`lib/store/live-backend.test.ts` pins it; it fails if you move the resolution
back inside.

### 4. Build-time prerendering baking in fake data

`generateStaticParams` runs at build time with no request and no session, so it
hit the fallback above and prerendered member pages for people who don't exist.
Removed, and `app/(app)` is `force-dynamic`. Static pages went 63 → 8.

### 5. Migrations that could never have run

Applying `0001`–`0007` to a real database surfaced four defects no amount of
reading would have caught: a policy on a table created two migrations later, a
policy on a table that was never created, `drop index` on an index owned by a
constraint, and — the big one — `profiles.id` having a foreign key to
`auth.users`, which made the entire invite flow impossible.

**`npm run db:migrate` is idempotent now** (a `schema_migrations` ledger), so
re-running is a verified no-op.

### 6. The snapshot loading later than the first read

Every page except `/my-work` and `/dashboard` died with "Something broke", and
saving a profile edit failed the same way.

The preload used to be the caller's job, and `getViewer()` was the only caller.
Those two pages happen to `await getViewer()` first. Everything else does

```ts
Promise.all([getRoster(), getRosterOptions(), getViewer()])
```

which starts the reads *before* the preload — so `readStore()` found no snapshot
and threw. Writes broke identically: `updateProfile()` reached `mutate()` with
nothing loaded.

**Anything that reads the store must load it itself.** All 16 functions in
`lib/data/*` now open with `await preloadLiveStore()`. It's idempotent, so call
order stopped being something you can get wrong. If you add a data function, add
that line — `npm run verify:live` is what catches you if you forget.

The general shape of this one: *it worked on the pages I happened to click.*
Two of eleven pages sequenced their calls differently, and that was enough to
make the bug look like a data problem rather than an ordering one.

### 7. `cache()` is render-scoped, so every write failed

Reads worked everywhere. Writes failed everywhere. That split IS the diagnosis.

The per-request snapshot lived in React's `cache()`. React memoizes a cached
function for the duration of a **render**, and a Server Action doesn't run
inside one — so in an action `cache()` returned a fresh object every call.
`getViewer()` loaded the database into one throwaway holder; the write a moment
later asked a second, empty one.

It surfaced as two unrelated-looking failures. Operations that write directly
(role change, reassign lead, deactivate) threw from `mutate()` and showed the
message inline. `createProject` reads the store first to check the slug, so it
threw the *read* error from outside `guarded()` and took the whole page down.

The holder is now anchored to the async execution context (`AsyncLocalStorage`
+ `enterWith`), which renders and actions both have. `enterWith` is the part
worth remembering: it lets a callee establish a scope the caller keeps seeing,
so the ~25 actions didn't each need wrapping.

**If you touch `lib/store/request.ts`, run `lib/store/request-scope.test.ts`.**
Its first test fails against the old holder — that's how this was confirmed
rather than guessed.

**Rule of thumb:** anything that must survive from `getViewer()` to a write
cannot rely on `cache()`. Test it outside a render or you won't see it.

### 8. Controls that existed and were never rendered

Not one bug — a *class* of them, and the most productive thing to go looking
for. An action would be written, tested, exported, and then either wired to
nothing or mounted only on a page nobody reaches it from. It never throws, never
logs, and looks finished in the diff.

A sweep on 2026-08-08 checked **every export of `lib/actions/` against a UI that
actually calls it**, then every exported component against a page that mounts
it. Seven findings, all fixed:

| What | How it failed |
|---|---|
| The RE's join-request queue on a project page | Two plain `Button`s wired to nothing. Pressing either did nothing at all. The working control existed and was mounted only on `/my-work` |
| `FollowToggle` | Built in Phase 2, imported nowhere. The project page even read `isFollowing` to show a badge for a state nothing could produce |
| `withdrawJoinRequest` | An operation with no action and no button. A request sent by mistake was permanent: it sat in the RE's queue, escalated at 5 days, and showed the sender a badge they couldn't clear |
| `deleteHoursAction` | Wired, but no screen listed a single work-log entry, so there was nothing to hang it on. A mistyped `80` for `8.0` was forever |
| Division Lead | Shown on `/projects`, settable nowhere. Neither team form had the field |
| …and worse: `updateTeam` did `team.leadId = input.leadId` | So every **rename** posted an empty value and silently cleared the lead. Pure data loss, invisible at the call site |
| `can.manageDivisions` | A duplicate of `can.manageTeams`, referenced only by its own tests |

**How to run the sweep again** — it's cheap and it keeps finding things:

```bash
for a in $(grep -o 'export async function [a-zA-Z]*' lib/actions/index.ts \
           | sed 's/export async function //'); do
  echo "$a :: $(grep -rl "\b$a\b" app components | tr '\n' ' ')"
done
```

A name with nothing after it is dead. But note the two hardest cases above
passed that grep: the join-request buttons were *rendered but inert*, and
`deleteHoursAction` was *imported by a component with nothing to act on*. So
after the grep, read the render path — "is it imported" and "can a person reach
it" are different questions.

**That sweep is now `npm run sweep`** (`scripts/dead-controls.mjs`), and it runs
inside `npm run check` and in CI. It checks three things with three different
rules: actions must be referenced from `app/` or `components/`, components from
any file including their own, data functions from some *other* file. Keeping
something deliberately unreferenced needs a `// dead-controls: allow <why>`
comment on the line above, so it's a written decision rather than an oversight.

It caught three more on 2026-08-09, all now fixed: `updateEventAction` (no edit
form existed, so moving a session by an hour meant cancelling it — which deletes
the attendee list), `ReopenButton` (written, never imported, so "Mark sorted" was
a one-way door), and four `lib/data` functions nothing called.

### 9. Every `for update` RLS policy was unreachable

The one that reached a real user. A Lead pressing **Mark as read** on somebody's
check-in got:

```
new row violates row-level security policy for table "progress_updates"
```

`progress_updates_review` is an UPDATE policy that permits exactly that action.
The problem was the verb. `persistDiff` upserted every row the diff touched, and
an upsert is `INSERT ... ON CONFLICT DO UPDATE` — so Postgres evaluates the
table's **INSERT** policy `WITH CHECK` even when the row exists and only an
update happens. The only INSERT policy says you may insert a check-in with your
own `member_id`, which is correct and must not be loosened: it's what stops a
Lead filing a report in somebody's name.

So the fix is in the app, not the schema. `persistDiff` now splits the diff:
rows that already exist go out as `UPDATE`, only genuinely new rows insert.
`update_entries_respond_re` had the identical latent bug and would have failed
the first time an RE answered somebody's section.

**The general lesson:** if you add a `for update` policy, an upsert will never
reach it.

**And its bigger sibling, which has now happened four times:** a policy that was
CORRECT when written and got left behind when the feature grew a new audience.
`events_write` said `auth_is_leadership()` from 0007, when the calendar was a
leadership noticeboard — and stayed that way through 0018 turning it into
something members create sessions on and RSVP to. Three app-permitted actions
were refused by Postgres and only one had ever been clicked, so only one was
reported. **Widening who can act in `lib/permissions.ts` does not widen it in
the database.** When a feature grows an audience, re-read its policies.

`lib/data/rls.test.ts` now checks both halves: every cascade has a delete
policy, and the member-facing writes (RSVP, own hours, own join request, own
check-in, own event) aren't leadership-gated.

One follow-up left deliberately undone: **attendance should be an
`event_attendees` join table.** It's a `uuid[]` on the event row, so RSVP is an
UPDATE of the whole row — RLS is per-row, so any policy permitting RSVP also
permits renaming the event, and a BEFORE UPDATE trigger (`events_rsvp_guard`,
migration 0024) is what closes that. The trigger is correct and tested, but the
join table would make the whole problem disappear. `ClubEvent.attendeeIds`
justifies the array as "write-once, read-whole, never queried by attendee" —
which stopped being true the moment attendees started writing to it. `lib/store/persist-diff.test.ts` pins the verb rather than the data,
because asserting on the resulting rows passes either way.

Both this and the `profiles` delete bug (#8's cousin, migration `0019`) have the
same shape — **RLS does not raise when a policy is missing.** The statement
simply matches nothing and PostgREST returns success. Every write path in
`lib/store/supabase.ts` therefore calls `.select()` and treats zero affected rows
as an error naming the likely policy.

### 10. The disk store went stale between the action and the render

Demo mode only, but it wasted a debugging round. `next dev` compiles Server
Actions and the RSC render into **separate module instances**, each with its own
copy of the `cache` in `lib/store/disk.ts`. A save updated the action's copy and
the file; the render kept serving the copy it first loaded, forever. Save,
reload, unchanged — indistinguishable from the write failing.

`load()` now compares the file's `mtime` and re-reads when another instance has
written. Live mode never hit this, because `readStore()` returns the
per-request Postgres snapshot.

---

## Architecture, in the order it matters

### `lib/store/` — one choke point, two backends

Everything reads through `readStore()` and writes through `mutate()`.

- `disk.ts` — a JSON file under `.data/`. Demo mode. **Cannot work on Vercel.**
- `supabase.ts` — loads a snapshot per request, diffs before/after on write.
- `request.ts` — holds that snapshot in React's `cache()`, per request.
- `mapping.ts` — every table, column and snake↔camel translation, once.

**The bet:** because `mutate()` is a single choke point, the Postgres backend
diffs two snapshots and derives the inserts/updates/deletes itself. None of the
~25 operations in `operations.ts` know Postgres exists, and every test pinning
their rules still covers the real logic.

**Known trade:** two simultaneous writers each diff against their own snapshot,
so the later can revert a field. Blast radius is one field on one row, and the
high-frequency operations append rather than overwrite. Fine for 35 people. The
fix when it isn't is to push operations down into SQL — which is why
`mapping.ts` describes tables rather than hiding them.

### `lib/permissions.ts` — the only place authority is decided

Four questions: Co-Lead? RE of this project or above? Lead of this person or
above? Your own data?

**Three inheritances, running in different directions** — RE authority flows
*down* the project tree, Lead authority flows *up* the reporting chain, and
team-lead authority flows *down* the org tree and then down the project tree.
That asymmetry is where the bugs are, which is why there are 50+ tests on it.

**A Division Lead is a top RE.** `leadsTeamAbove` folds into `isREofOrAbove`, so
leading a division gives RE powers on every project inside it at any depth,
including sub-projects carrying no `teamId` of their own.

#### Doing the work is not the same right as approving it

Added 2026-08-09, and the one distinction most likely to be flattened by
accident. `isREaboveProject` is `isREofOrAbove` **minus the project's own RE**:
an ancestor project's RE qualifies, so does the Division Lead (who sits above
the project by org position — that's what covers a top-level project with no
parent), and being the project's own RE disqualifies you *even if you would
qualify another way*.

Exactly two rules use it, and both are "review somebody else's work":

| Rule | Who |
|---|---|
| `can.completeProject` | The RE above, or the Division Lead. **Not** the project's own RE |
| `can.withdrawSignOff` | Same. Overturning a sign-off, as opposed to granting one |

Everything else about a project still runs on `isREofOrAbove`, because the
assigned RE has to be able to do their job. Two deliberate asymmetries:

- **Reopening a project runs on `manageProject`, not `completeProject`.** Saying
  something isn't finished always makes the record more conservative, so it
  needs no permission from above.
- **Signing a deliverable off stays with the RE at the project's own level.**
  That's their job. Only *overturning* one escalates.

**Co-Leads are the escape hatch.** Without it, a Co-Lead who is the RE of a
top-level project could never complete it — nobody is above them — and it would
be stuck forever. That fallback is what lets the rule be strict everywhere else.

Role changes are **Co-Lead only**: it's the one permission that can reshape the
permission system. A Co-Lead cannot change their own role, and the last Co-Lead
cannot be demoted or deactivated — both are lock-out guards.

### The privacy model — the rule most likely to be got wrong

| Thing | Who sees it |
|---|---|
| Per-project check-in content | **Everyone** — it's the project's history |
| Hours on one project | That project's REs, inheriting **down** |
| Personal report, total hours, reliability | The member and their **Lead chain only** |

REs deliberately **cannot** read someone's personal report. They get the
per-project half publicly instead. That's what makes reviewing one named
person's obligation, and what makes the escalation mean anything.

---

## Decisions that are settled — don't re-litigate

- **Deliverables are the whole task model.** One flat list, one owner, one date,
  one status. No dependencies, no sub-tasks, no Gantt.
- **No engagement score, no leaderboard, no ranking.** Four independent signals.
  A component with no data returns `null`, never `0`.
- **Two-step sign-off**: the owner marks `submitted`, an RE confirms `done`.
  Only `done` counts as delivered. Unconfirmed work escalates like an unread
  check-in, so a quiet RE is visible rather than silently freezing records.
- **Completing a project is a review step, done from above.** The assigned RE
  finishes it; the RE above them or the Division Lead agrees it's done. A
  signed-off deliverable can be rejected from above too, with a mandatory
  reason — and that reopens the project if it was complete, because "the
  engineering doesn't meet requirements" and "the project is done" can't both
  be true.
- **Work inside a project can't be due after the project.** Checked both
  directions and only when a date actually moves, so one legacy violation can't
  freeze every other edit. An undated parent constrains nothing.
- **Hours backdate 7 days** and lock once a submitted check-in reports them.
- **Phone over email** everywhere a human is contacted. Email stays the auth
  identity and the fallback.
- **Escalation is on age, not count.** "Kenji has been waiting 6 days" beats
  "12 unread".
- **Never hard-delete people or projects.** Deactivate.

Full reasoning in `docs/DECISIONS.md` and `docs/PRODUCT_REVIEW.md`.

---

## What's next

`docs/OPEN_QUESTIONS.md` has 23 questions with recommended defaults; Anish
answered them all in chat on 2026-08-08, and everything in those answers is now
built. Phases 5–8 shipped on 2026-08-08/09.

### Mini Gantt charts — built 2026-08-09

Two charts, and the distinction between them is the design:

| Where | What's on it |
|---|---|
| Inside each division's deadlines strip on `/projects` | Every project in that division, nested two levels deep |
| The sidebar of a project page | That project, its sub-projects, **and its deliverables as diamonds** |

Deliverables are on the project chart and nowhere else — on the division chart
they'd bury five projects under a hundred markers.

**This is not the critical-path Gantt in the list below.** No dependencies, no
slack, nothing new for an RE to maintain: it draws dates that already exist. The
moment it needs its own upkeep it has become the thing that was rejected. The
header of `lib/gantt.ts` says this at length; read it before adding a field.

Things that are easy to break:

- **The geometry is a pure module** (`lib/gantt.ts`, 15 tests) rather than
  inline in the component, because an off-by-one-day bar looks *slightly* wrong
  and nobody can tell whether the chart or the schedule is lying.
- **Everything parses as UTC.** A bare date is UTC midnight, a datetime is
  LOCAL; mix them and a bar shifts a day, and west of Greenwich a UTC midnight
  formats as the day before.
- **A deliverable is a date, a project is a span.** Deliverables collapse to a
  marker. Giving one a width would invent a duration the model deliberately
  doesn't have.
- **The depth cap reports what it dropped.** The project tree is unbounded; a
  chart that looks complete and isn't is worse than one that admits its limit.

`createProject` now sets `startDate` (clamped to the target, since 0001 checks
`target_date >= start_date`), and migration 0021 backfilled every project that
predated it.

### Explicitly not planned — read the reasoning before reopening

Critical-path Gantt with dependencies, a composite engagement score, a
leaderboard or any ranking function, self-enrollment, a project commitment cap,
purchasing/procurement, and the **quarterly re-enrollment sweep** (dropped
2026-08-08: a 35-person club where everyone has a named Lead doesn't need
memberships auto-closing, and silently dropping somebody is worse than a Lead
glancing at their roster). Email nudges are deferred — notifications are
in-app only for now.

Reasoning lives in `docs/DECISIONS.md` and `docs/PRODUCT_REVIEW.md`.

---

## Traps specific to this environment

- **Never `npm run build` while `npm run dev` is running.** It deletes the
  directory the dev server serves from. Use `npm run build:check`.
- The repo is **CRLF**. In JavaScript `.` does not match `\r`, so a regex ending
  `.*\n` silently never matches on Windows.
- Bash `node -e "…"` **executes backticks** in your string. Markdown is full of
  them. Use the Edit tool for prose.
- The direct `db.<ref>.supabase.co` host is **IPv6-only**. Use the pooler:
  `aws-0-ca-central-1.pooler.supabase.com:5432`, user `postgres.<ref>`.
- A git worktree lives inside the repo, so ESLint/tsconfig ignore patterns need
  `**/` prefixes or they miss it.

---

## Loose ends

- **Rotate the database password.** It was shared in chat. Nothing in the repo
  depends on it.
- `salvage/local-test-harness` holds an uncommitted parallel persona-switcher
  found in the main checkout, preserved rather than overwritten. Its `0006`
  claims to fix two bugs in `0005`; worth comparing before deleting the branch.
- `lib/mock-data.ts` is ~2,000 lines and only seeds demo mode now.
  `lib/store/operations.test.ts` pins rules against specific mock records, so
  gutting it means rewriting those tests.

---

# Session log — 2026-08-10

Written at the end of the session, for the next one. **The three outstanding
items are at the bottom of this section.** Everything above them shipped, is
merged to `main`, deployed, and covered by tests (539 passing).

## The two hours spent on nothing, and how not to repeat them

Both were "my change isn't live", and neither was a code problem. `git rev-list
--left-right --count main...origin/main` reading `0 0` is **necessary but not
sufficient** — pushed code sat undeployed twice, for two different reasons.
Check both of these before saying anything about the live site. No Vercel access
required; the repo is public:

```bash
curl -s "https://api.github.com/repos/4deg-kelvin/skyrunners-app/actions/runs?per_page=3"
curl -s "https://api.github.com/repos/4deg-kelvin/skyrunners-app/deployments?per_page=3"
curl -s "https://api.github.com/repos/4deg-kelvin/skyrunners-app/commits/SHA/status"
```

The last one is the useful one: it carries a `Vercel` context whose state is
`success`, `pending` or `failure`. **A red Vercel status next to a green CI check
is the signature of both bugs below.**

### 1. CI was red on Prettier, which `npm run check` did not run

CI runs `format:check`; `npm run check` didn't. So the pre-push gate said green
while the gate that actually blocks a deploy said red. **Fixed by putting
Prettier into `npm run check`** — remembering to also run a second command is not
a fix. If `npm run check` ever passes and CI fails again, the bug is that `check`
is missing a step. Fix it there.

### 2. An hourly cron made every deployment fail

`vercel.json` declared `0 * * * *`. **Vercel's Hobby plan allows cron jobs that
run at most once a day, and it rejects the whole deployment over it — not just
the cron.** A schedule string in a file nobody was looking at silently stopped
the site updating for four commits, and the symptom pointed nowhere near it.

Now `30 19 * * *`, and daily is genuinely enough: every check-in is due at 23:59
UTC, so one run with a five-hour window catches the whole club. If a future job
needs to be more frequent, that's a Pro-plan conversation, not a schedule edit.
Written up in `docs/INFRA.md`.

### 3. An env-var edit dropped the site into demo mode

Adding the Discord variables removed or unscoped a `NEXT_PUBLIC_SUPABASE_*` one,
and the app **silently fell back to sample data with no login** — by design, so a
fresh clone runs, which is exactly why nothing errored. Rolling back fixed it.

Diagnosing this without Vercel access: `/my-work` returns `307 -> /login` in live
mode and `200` in demo mode, because `updateSession` no-ops when
`supabaseConfig()` is null. That one request tells you which mode production is
in.

## What shipped

### Deliverable checklists (migration 0028)

A collapsible checklist under every deliverable, on the project page and My Work.
**Not sub-tasks** — a todo has no owner, no date, no credit, and appears in no
count. It exists because errands were being entered as deliverables, and a
deliverable feeds the Delivered signal, so ten of them made somebody outrank the
person who shipped the airframe.

The gate: **neither the owner's "Mark done" nor the RE's "Sign off" goes through
while an item is open.** Gating only sign-off would put the wall in front of the
RE, who didn't write the list. Deleting an item is a legitimate way to clear it —
a todo counts towards nothing, so "it turned out not to be needed" must not force
a false tick.

`can.manageDeliverableTodos` is the one rule in `permissions.ts` where owning a
row grants a right RE-only neighbours don't have. Deliberate: the person doing
the work discovers what it involves, and making them ask an RE to write down
"book the CNC" guarantees the list stays empty.

### Pacific time (`lib/dates.ts`)

**This was a live bug.** `today()` was `new Date().toISOString().slice(0, 10)` —
the UTC date — and Vercel runs UTC, so **from 5pm Pacific the app believed it was
tomorrow.** Every evening this club is in the lab. Invisible locally, because a
laptop in California agrees with UTC until 5pm.

The second half was rendering: `new Date("2026-08-09")` parses as UTC midnight
and formats as *Aug 8* in California. Nine files did that. It also rendered
differently on the server and in the browser, so React was logging a hydration
mismatch nobody had connected to it.

Everything now goes through `lib/dates.ts`. The rule is in CLAUDE.md; the short
version is that **calendar dates and instants are different things**, dates are
compared as strings, and day arithmetic happens in UTC because a Pacific day is
23 or 25 hours twice a year.

### Discord, end to end

The bot works — Kelvin verified. What exists:

| Trigger | Recipient |
|---|---|
| Added to a project | the person added |
| Join request approved / declined | whoever asked |
| Check-in submitted | that member's Lead |
| Deliverable or project marked **blocked** | see `blockerAudience` below |
| Check-in due in ~4 hours | the member (daily cron) |
| Check-in still open the next day | the member, **once** |
| "Send a test message" from Settings | themselves |

`blockerAudience(projectId, raiserId)` is the interesting one: the project's REs
minus the raiser, climbing **one level** if that empties the list. Deliberately
not the whole chain like `completionAudience` — a blocker is a request for one
named person to act, and telling five produces the bystander effect. The
escalation is the point: an RE stuck on their own deliverable would otherwise be
DMed about their own blocker, so the case that most needs escalating would be the
only one nobody heard about.

Verification lives on the ID field itself (badge plus "Verify now"), and the badge
records *which* ID was proven, so it can't survive the number changing. A public
`DiscordStatus` badge is on the member profile — **profile only, not the
roster**, per Anish after seeing both.

The invite link is a Co-Lead setting (migration 0030), validated to Discord's own
hosts in the operation and by a CHECK constraint. It appears in **exactly two
places**: the new-member guide and beside the Discord ID field in Settings. Not
the club-wide banner — that would publish the server link permanently to thirty
people already in the server.

### Admitting members

The flow already existed (link, Stanford sign-in, a trigger creates an inactive
profile, **Admit** on the roster) but was **broken for Leads**: a person who signs
in without an invite has no Lead, so `isLeadOfOrAbove` was false for everybody and
only Co-Leads could admit. The panel showed the button to all five Leads and
refused every press.

`can.admitMember` is now any Lead or Co-Lead. Admitting also **assigns a Lead**,
defaulting to whoever clicked — a member with no Lead is invisible to the half of
the app that runs on the reporting chain, and a separate "now assign a Lead" step
would get skipped with silent consequences for weeks.

### Smaller

- **Alphabetical divisions and projects**, at every depth, from one comparator in
  `mock-data.ts`. The order was whatever Postgres returned, which is not just
  arbitrary but *unstable* between loads.
- **The Dashboard nav link** now asks the same question `/dashboard` redirects on.
  It keyed off `globalRole`, so a Lead with no reports saw a link that bounced
  them back, and a member who had been given reports saw none.
- **The cron route was behind the auth middleware** and answered `307 -> /login`.
  Vercel Cron sends a bearer token and no cookie, so the job would never have run
  — and the only symptom would have been reminders quietly never arriving.
  `api/cron` is excluded from the matcher; the route still authenticates itself.
- **Division Gantt clips the past** to today, unless something has slipped, with a
  "Show history" control that re-lays-out client-side. Project charts are
  unchanged, deliberately.
- **A "you haven't logged any hours" banner**, from their second day until their
  first log. No cron — it's a `joinedAt` versus today comparison, so the delay
  starts applying on its own.

## Outstanding — start here

1. **Rotate the Supabase database password.** It has been in plaintext in a chat
   transcript all session, along with the pooler connection string. Anish deferred
   this to "once everything else is done". It is now.
2. **Five of seven people have no verified Discord.** Julia, Kevin, Khush, Michael
   and Jonathan get no notifications at all, including check-in reminders — and
   check-in alerts if they lead anyone. Nothing to build; each of them presses
   Verify now in Settings.
3. **Nobody has logged hours yet.** 2 work logs, 1 check-in, 7 deliverables across
   4 projects. Every downstream number — the four contribution signals, tier
   placement, the review queue, reliability — reads empty until people start.
   Don't judge whether any of it works before one real week of use.

Two things offered but not done:

- **Fold the behavioural design rules into `docs/DESIGN_SYSTEM.md`.** The dates
  rule, the no-dead-controls rule, and "replace a dead button with a sentence
  saying why" are enforced in review and written nowhere.
- **Warn when the academic calendar is about to run out.** There are 9 terms and a
  `calendarRunsOut` value already computed in the settings view, surfaced nowhere.
  When the calendar ends, check-ins silently stop generating with no symptom — the
  same shape as the bug that banner already exists to prevent.
