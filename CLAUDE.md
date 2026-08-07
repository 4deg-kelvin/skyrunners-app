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
| `docs/PHASE_PLAN.md` | **Current build order and what's deliberately not planned** |
| `docs/PHASE_1_KICKOFF.md` | Step-by-step Phase 1 plan, split between the two developers |
| `docs/PROJECT_PLAN.md` | Vision, stack rationale, roles, permissions, feature detail |
| `docs/PRODUCT_REVIEW.md` | Independent critique of the org design, and what changed because of it |
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

## Deliverables are the entire task model

One flat list per project: **title, ONE owner, a due date, a status.** No dependencies, no
sub-tasks, no critical path, no Gantt.

That's deliberate. A dependency graph costs an RE an hour a week, and on a volunteer team
whose availability swings with midterms it's wrong the day after it's entered — a wrong
schedule is worse than none, because people plan against it.

Five minutes of RE upkeep buys: what each member owns, update auto-drafts, real progress
percentages, trustworthy "projects completed", and an honest timeline. If you're tempted to
add dependencies or sub-tasks, re-read this paragraph.

## There is no engagement score

`lib/contribution.ts` reports **four independent signals** and deliberately computes no
composite number.

| Signal | Notes |
|---|---|
| **Delivered** | Deliverables and projects completed. **Primary** — can't be inflated |
| **Commitment** | Hours/week vs the 10–12 hr expectation, as a named tier |
| **Reliability** | Updates on time |
| **Scope** | RE roles held. Reported, **never blended in** |

Rules that must not regress:

- **A component with no data returns `null`, never `0`.** The old score returned 0 for "no
  tasks assigned" but 1 for "no updates due", which made a reliable contributor score 50
  while a member on leave scored 45.
- **Never blend Scope into an overall judgment.** It requires already having been appointed,
  so it would make the metric measure having already been chosen.
- **Members always see their own record.** The rubric is published at `/how-we-lead`.
- **Never add a ranking function.** The data supports one; it's absent on purpose.

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
| **Update** | Member's progress report. **Two per week**, on member-chosen weekdays. Pausable for academics without penalty |
| **Deliverable** | One unit of work with one owner and a date. The whole task model |
| **Committed / Following** | Committed = an RE added them; carries deliverables and obligations. Following = self-service watch-only, unlimited |
| **Join request** | A member's tracked ask to join. RE approves. Escalates after 5 days |
| **Term** | Academic period. Obligations only generate when `generatesObligations` is true |
| **Roll-up** | Lead's aggregated report up the chain to Co-Leads |

## Key product decisions

- **Membership is RE-controlled, with no cap.** Members cannot add themselves. They see
  everything, follow anything, and *ask* — the RE decides, because the RE is accountable
  for the deliverable.
- **`join_requests` is what keeps that from being a dead end.** "Email the RE" produces
  silence and an invisible member, which is the original problem wearing a different hat.
  A tracked request lands in a queue, shows as pending, and escalates at 5 days.
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

**`docs/PHASE_PLAN.md` is canonical.** Phase 0 is complete; Phase 1 (auth + real data) is
next, with a step-by-step plan in `docs/PHASE_1_KICKOFF.md`.

Explicitly **not** planned: critical-path Gantt, a composite engagement score, a
leaderboard, self-enrollment, a project commitment cap. Each was considered and rejected —
read the reasoning in `DECISIONS.md` and `PRODUCT_REVIEW.md` before re-opening any of them.


## Phase 1 starting points

1. `npm i @supabase/supabase-js @supabase/ssr`
2. Add `lib/supabase/{client,server}.ts` and **`middleware.ts`** — `@supabase/ssr` needs
   middleware for session refresh, and auth will not work without it
3. Run `supabase/migrations/0001_core_schema.sql`, then `supabase/seed.sql`
4. Write `0002_rls_policies.sql` (shape sketched in `supabase/README.md`)
5. Replace the body of `getViewer()` in `lib/data/viewer.ts` with the real session
6. Replace the other `lib/data/*` bodies with queries, keeping signatures identical
7. Delete `lib/mock-data.ts` when nothing imports it
