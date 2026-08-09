# Handoff — read this first

**Written 2026-08-08, last revised 2026-08-09.** Everything a fresh session
needs. Written for someone with no memory of how any of this came to be.

---

## Where things actually are

The app is **live on Supabase**. Real Google sign-in, real Postgres, migrations
`0001`–`0019` applied. **Phases 0–8 are built** — my work, find work, projects,
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
reach it. `lib/store/persist-diff.test.ts` pins the verb rather than the data,
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

### Mini Gantt charts — scoped with Anish 2026-08-09, not yet built

The one open piece of scope. It matters that this is **not** the critical-path
Gantt in the "don't re-litigate" list. That one was rejected because a
dependency graph costs an RE an hour a week and is wrong the day after it's
entered. This is a read-only picture of dates that already exist, with no
dependencies and nothing new to maintain. Keep it that way — the moment it
needs its own upkeep it has become the thing that was rejected.

Decided:

| Question | Answer |
|---|---|
| What's a bar | **One per project.** Start date → target date. Not deliverables |
| Time window | **Auto-fit to the dates present** in that division. Nothing falls off the edge, and a division with one December project doesn't render a mostly-empty chart |
| On the bar | Health colour, progress fill from deliverables done, and a **today marker** |
| Placement | **Under each division**, always visible — not behind the deadlines toggle |
| Also | Each project gets **a small chart of its own on the side** (project detail page) |
| Depth | **Render at most two levels of sub-project.** Below that it stops being readable |

That last one is a real constraint, not a nicety — the project tree is
unbounded and `p-layup` already sits three deep. Whatever is cut off must be
*said*, not silently dropped: a chart that looks complete and isn't is worse
than one that admits its limit.

**Groundwork already done** (2026-08-09), so don't redo it:

- `createProject` now sets `startDate`, defaulting to today. It never did, so
  every project made through the app had no left edge for a bar. Clamped to the
  target date when that's in the past, because `0001_core_schema.sql` has
  `check (target_date >= start_date)` and demo mode would have accepted a row
  that failed on insert.
- `datesOverridden` is set properly. It means **"derive this project's dates
  from its children"** — a parent with no date of its own spans whatever its
  sub-projects span, which is most of the roll-up logic the chart needs, and it
  was hard-coded `false` so a hand-typed target looked derived.
- A sub-project can't be due after its parent, enforced on create and update.
  So bars nest without crossing their parent's right edge.

**Still open before building:** projects created before today have no
`startDate`. Decide whether to render those as a point at the target date, bar
them from the division's earliest date, or ask REs to fill them in. There are
only a handful, and the club's real data is young.

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
