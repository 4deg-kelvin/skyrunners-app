# Handoff — read this first

**Written 2026-08-08.** Everything a fresh session needs. Written for someone
with no memory of how any of this came to be.

---

## Where things actually are

The app is **live on Supabase**. Real Google sign-in, real Postgres, migrations
`0001`–`0012` applied. Phases 0–4 are built.

The club is **deliberately empty** — three Co-Leads (Anish, Jonathan, Kelvin),
no projects, no divisions. It gets populated through the app, not a seed script.
That was Anish's explicit decision: a clean sheet, organised from scratch.

```bash
npm run db:check        # is the database really there?
PW=<db-password> npm run verify:live   # does every page work on real data?
```

`verify:live` is the one that matters. It loads the whole database and calls the
`lib/data/*` function behind every route. As of now: **all 11 pass**.

---

## The six bugs that cost the most time

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

**Two inheritances running in opposite directions** — RE authority flows *down*
the project tree, Lead authority flows *up* the reporting chain. That asymmetry
is where the bugs are.

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
answered them all in chat on 2026-08-08. The answers not yet reflected in code:

- **Calendar (Phase 8)** is the priority. Any engineering session goes on it, so
  members can see what's happening and join. 1:1s appear as busy blocks —
  visible, no agenda. Importance 1–5 per event, defaulting by kind. Members can
  create sessions for projects they're on. Overlapping meetings must both be
  visible.
- **Log hours to "misc"** when helping another project — needed for the above.
- **Phase 6 blocker board**: blocked deliverables plus free-form asks.
- **Phase 9 trainings**: the real list is in Anish's answers — site accesses
  (Robotics Room, Lab 64, Lab 64 24hr, PRL, CHIP) and machine trainings per
  site. Co-Leads must be able to add more, and new ones must appear for
  everyone automatically.
- **Phase 10**: contribution trends need weekly snapshots that nothing writes
  yet, and only after a member has been active a month. Only Co-Leads may sort
  by rank or hours.
- **Phase 11**: no separate milestones — a progress bar driven by project
  deadlines, which are the real milestones. Projects and deliverables must be
  deletable.
- **Phase 12 (purchasing) is explicitly out of scope.**

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
