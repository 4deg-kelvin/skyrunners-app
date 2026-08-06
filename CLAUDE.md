# CLAUDE.md — Context for AI agents working in this repo

Read this first. It orients you fast and prevents the most likely mistakes.

## What this is

A project and member management app for **Stanford UAV / Sky Runners**, a student
drone team of ~30–40 members across five divisions.

**The problem it solves:** the club loses members to disorganization. People can't find
work without asking a co-lead, leaders can't see who's contributing, and progress
updates don't flow up the chain. Every feature decision should trace back to one of
those three.

## Read these before writing code

| Doc | Contents |
|---|---|
| `CONTRIBUTING.md` | Setup, git workflow, the seven rules |
| `docs/PROJECT_PLAN.md` | Vision, stack rationale, roles, permissions, features, phases |
| `docs/DATA_MODEL.md` | Postgres schema, invariants, views |
| `docs/DESIGN_SYSTEM.md` | Visual language, tokens, component rules |
| `docs/DECISIONS.md` | Locked decisions, infrastructure notes |
| `lib/data/README.md` | Why the data layer exists and how to extend it |
| `supabase/README.md` | Migrations, views, RLS plan |

## Team

- **Anish Bayya** — app functionality. **New to coding.** Explain reasoning, name
  tradeoffs, don't just emit code. Avoid unexplained jargon.
- **Teammate (@4deg-kelvin)** — server management, hosting, deployment, production
  database. Infrastructure notes are in `docs/DECISIONS.md` §3.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Supabase (Postgres + Auth +
Storage) · Resend · Vercel + Vercel Cron

**Deliberately no Python.** Rationale in `PROJECT_PLAN.md` §2 — React already forces
TypeScript, so adding Python means two languages, two servers, two deploys for a solo
beginner. Revisit only if real analytics/ML work appears.

## Commands

```bash
npm run dev            # local dev server
npm run check          # typecheck + lint + tests — run before every push
npm test               # permission + engagement tests
npm run format         # Prettier
npm run seed:generate  # regenerate supabase/seed.sql from lib/mock-data.ts
```

## Current state

**Phase 0 complete.** App shell, design system, My Work, dashboard, project tree with
detail pages, roster with profiles, calendar.

**All data comes from `lib/mock-data.ts`, reached through `lib/data/*`.** Auth is mocked
in `lib/data/viewer.ts` via `CURRENT_USER_ID`. Supabase is not wired up yet, but the
schema exists as SQL in `supabase/migrations/0001_core_schema.sql`.

`/` redirects to `/my-work`. Members land on their own projects and the update they owe;
the dashboard is the leadership view and is hidden from plain members in the nav.

## Architecture: the two boundaries that matter

### 1. `lib/data/*` is the only place that touches the data source

Pages import from `lib/data/*` and never from `lib/mock-data.ts`. **ESLint enforces
this** (`no-restricted-imports` in `eslint.config.mjs`).

Every function there is `async` even though the mock behind it is synchronous, so
swapping in Supabase changes no signatures and therefore no pages.

Each returns a **fully-joined view model** — one call per page. Never look data up inside
a render loop: harmless against arrays, a round trip per row against Postgres.

### 2. `lib/permissions.ts` is the only place that decides who can do what

Never check `globalRole` inline. The whole model is four questions:

1. Are you a Co-Lead? → anything
2. Are you an RE of this project **or any above it**? → you own this subtree
3. Are you this member's Lead, **directly or anywhere up their chain**? → you oversee them
4. Is it your own data? → you can manage it

**Two inheritances running in opposite directions:** RE authority flows **down** the
project tree, Lead authority flows **up** the reporting chain. That asymmetry is where
bugs hide, which is why there are 33 tests on it.

Pages get `{ actor, graph, member }` from `getViewer()` and call `can.*`.

## Updates are per-project, not one blob

`progress_updates` is an envelope (who, when, status). Content lives in **`update_entries`**
— one row per project, each with its own progress, blockers, next steps, and hours.

Members are on multiple projects by design, so a single text field would be ambiguous to
a Lead overseeing several of their projects, and an RE couldn't tell whether a blocker was
theirs to clear. Anything rendering an update must iterate `entries` and label each with
its project.

## The eight things most likely to trip you up

1. **Two independent hierarchies.** Org tree (`teams.parent_id`, who reports to whom) and
   project tree (`projects.parent_id`, what work exists) are separate. A member's Lead is
   *not* necessarily an RE of their projects. Merging them rebuilds the silos this app
   exists to remove.

2. **Enum strings must match between `lib/types.ts` and the SQL.** `global_role` is
   `co_lead`, **not** `admin`. A mismatch wouldn't throw — `isCoLead()` would just return
   false forever, silently disabling every leadership permission.

3. **Phase and health are different fields.** `phase` is *where* in the lifecycle
   (concept → flight test). `health` is *how it's going* (on track / at risk / blocked).

4. **Multiple REs per project.** `primaryReId` is the go-to contact; `reIds` holds all of
   them. Never infer "primary" from array order — Postgres join order isn't guaranteed.

5. **A project's `teamId` may point at a sub-team, not a division.** Resolve the division
   with `divisionForProject` / the `v_project_division` view. Grouping by `teamId`
   directly silently hides projects from the discoverability page.

6. **Never hard-delete people or projects.** Deactivate. History must survive graduations.

7. **Don't use Prisma.** It connects with elevated privileges and silently bypasses the
   RLS policies protecting reads. Use the Supabase client, or Drizzle.

8. **`Button` is a Client Component** because it accepts `onClick`. Any new interactive
   primitive needs `"use client"`, or a Server Component passing a handler gets
   "Functions cannot be passed directly to Client Components" — an error whose message
   points nowhere near the cause.

## Conventions

- Display strings and badge tones go in `lib/labels.ts`, never inline in a page
- Reads via Supabase client + RLS; writes via Server Actions calling `lib/permissions.ts`
- Nested queries use recursive CTEs — views already written in `0001_core_schema.sql`
- Generated Supabase types are snake_case; `lib/types.ts` is camelCase. **Map between
  them inside `lib/data/*`** — don't let snake_case leak into components
- Snapshot values that change over time (`lead_id_at_submission`, `weights_version`)
- **Never hardcode colors.** Tokens live in `app/globals.css`
- Mobile-responsive from the start — hours get logged in the lab, on phones
- Empty states use `EmptyState`, which requires a next action
- Auth: Google OAuth, `@stanford.edu` enforced. No passwords.

## Terminology

| Term | Meaning |
|---|---|
| **Co-Lead** | Team leads. `global_role = co_lead`. Configures divisions and engagement weights |
| **Team Lead** ("Lead") | Middle leadership. Reviews updates, checks in multiple times a week, verifies trainings, rolls reports up |
| **Member** | Everyone else |
| **RE** | Responsible Engineer — accountable for a project's deliverables. Project-scoped, inherits down, multiple per project |
| **Division** | Top-level org unit (`teams.parent_id IS NULL`). Co-Lead editable |
| **Update** | Member's progress report. **Three per week**, on member-chosen weekdays |
| **Roll-up** | Lead's aggregated report up the chain to Co-Leads |

## Key product decisions

- **Enrollment is open by default.** Members join any project without asking. The core fix
  for "go ask a co-lead what to do."
- **Transparency by default for *activity*.** Everyone sees projects, who's on what,
  responsibilities, the calendar, Gantt charts.
- **Effort data is restricted.** Hours, update contents, and engagement scores are visible
  only to the member, their Lead chain, and REs of projects they contribute to.
- **Engagement is a flashlight, not a scoreboard.** Outcomes outweigh hours; no
  leaderboard function exists, deliberately. See `lib/engagement.ts`.
- **Calendar sync is opt-in**, Google and Apple.
- **Creating projects must feel effortless for leadership** — permissions are deliberately
  permissive there.

## Build phase status

- [x] **0** — Scaffold, design system, app shell, My Work, dashboard, projects, roster,
      data layer, permissions wiring, CI, SQL schema
- [ ] **1** — Supabase + Stanford Google auth, real org tree, Lead assignment
      ← *next*
- [ ] **2** — Project artifacts, enrollment actions, find-work view ← *ship to the club*
- [ ] **3** — Hours logging
- [ ] **4** — Updates, reviews, roll-ups, notifications
- [ ] **5** — Events, attendance, calendar, opt-in iCal
- [ ] **6** — Tasks, dependencies, auto-Gantt, RE deadline reminders
- [ ] **7** — Trainings, certifications, facility access (Anish supplies the machine list)
- [ ] **8** — Engagement scoring UI, weights config, leadership dashboard
- [ ] **9** — Mobile/PWA polish

## Phase 1 starting points

1. `npm i @supabase/supabase-js @supabase/ssr`
2. Add `lib/supabase/{client,server}.ts` and **`middleware.ts`** — `@supabase/ssr` needs
   middleware for session refresh, and auth will not work without it
3. Run `supabase/migrations/0001_core_schema.sql`, then `supabase/seed.sql`
4. Write `0002_rls_policies.sql` (shape sketched in `supabase/README.md`)
5. Replace the body of `getViewer()` in `lib/data/viewer.ts` with the real session
6. Replace the other `lib/data/*` bodies with queries, keeping signatures identical
7. Delete `lib/mock-data.ts` when nothing imports it
