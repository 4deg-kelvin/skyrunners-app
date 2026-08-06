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
| `docs/PROJECT_PLAN.md` | Vision, stack rationale, roles, permissions, features, phases, risks |
| `docs/DATA_MODEL.md` | Full Postgres schema, invariants, views |
| `docs/DESIGN_SYSTEM.md` | Visual language, tokens, component rules |
| `docs/DECISIONS.md` | Locked decisions and infrastructure notes |

## Team

- **Anish Bayya** — app functionality. **New to coding.** Explain reasoning, name
  tradeoffs, don't just emit code. Avoid unexplained jargon.
- **Teammate (@4deg-kelvin)** — server management, hosting, deployment, production
  database. Infrastructure notes for them are in `docs/DECISIONS.md`.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Supabase (Postgres + Auth +
Storage) · Resend · Vercel + Vercel Cron

**Deliberately no Python.** Rationale in `PROJECT_PLAN.md` §2 — briefly: React already
forces TypeScript, so adding Python means two languages, two servers, two deploys for a
solo beginner. Revisit only if real analytics/ML work appears.

## Commands

```bash
npm run dev        # local dev server
npm run build      # production build
npm test           # permission + engagement tests (Node built-in runner)
npm run typecheck  # tsc --noEmit
```

## Current state

Phase 0 is complete: app shell, design system, dashboard, project tree, roster,
calendar. **All data comes from `lib/mock-data.ts`** and auth is mocked in
`app/layout.tsx` via `CURRENT_USER_ID`. Supabase is not wired up yet.

## The seven things most likely to trip you up

1. **There are two independent hierarchies.** The **org tree** (`teams.parent_id`, who
   reports to whom) and the **project tree** (`projects.parent_id`, what work exists)
   are separate. A member's Lead is *not* necessarily an RE of their projects. Merging
   them rebuilds the silos this app exists to remove. Never conflate them.

2. **Two kinds of inheritance, in opposite directions.**
   - RE authority flows **down** the project tree: RE of a parent can act on all
     descendants.
   - Lead authority flows **up** the reporting chain: your Lead's Lead oversees you too.

3. **All permission logic lives in `lib/permissions.ts`.** Never check roles inline in a
   component or action. That file is tested; ad-hoc checks are not.

4. **Phase and health are different fields.** `phase` is *where* a project is in its
   lifecycle (concept → flight test). `health` is *how it's going* (on track / at risk /
   blocked). Don't collapse them.

5. **Multiple REs per project.** `primary_re_id` is the go-to contact; additional REs
   are `project_members` rows with `role = 're'`. Code that assumes one RE is wrong.

6. **Never hard-delete people or projects.** Deactivate. Contribution history must
   survive graduations — explicitly required.

7. **Don't use Prisma.** It connects with elevated privileges and silently bypasses the
   RLS policies protecting reads. Use the Supabase client, or Drizzle for typed queries.

## Conventions

- Reads via Supabase client + RLS; writes via Server Actions calling `lib/permissions.ts`
- Nested queries use recursive CTEs (pattern in `docs/DATA_MODEL.md`)
- Snapshot values that change over time (`lead_id_at_submission`, `weights_version`)
  so history stays correct
- **Never hardcode colors.** Use the tokens in `app/globals.css`
- Mobile-responsive from the start — hours get logged in the lab, on phones
- Empty states always offer a next action (see `EmptyState` in the dashboard)
- Auth: Google OAuth, `@stanford.edu` enforced. No passwords.

## Terminology

| Term | Meaning |
|---|---|
| **Co-Lead** | Team leads. `global_role = co_lead`. Configures divisions and engagement weights |
| **Team Lead** ("Lead") | Middle leadership. Reviews updates, checks in multiple times a week, verifies trainings, rolls reports up |
| **Member** | Everyone else |
| **RE** | Responsible Engineer — accountable for a project's deliverables. Project-scoped, inherits down, multiple per project allowed |
| **Division** | Top-level org unit (`teams.parent_id IS NULL`). Co-Lead editable: Fixed Wing eVTOL, SkyBeta, Spade, DroneHacks, SkyDelta |
| **Update** | Member's progress report. **Three per week**, on member-chosen weekdays |
| **Roll-up** | Lead's aggregated report up the chain to Co-Leads |
| **Phase** | Project lifecycle stage: concept → requirements → PDR → CDR → manufacturing → integration → testing → flight test → complete |

## Key product decisions

- **Enrollment is open by default.** Members join any project that interests them
  without asking. This is the core fix for "go ask a co-lead what to do."
- **Transparency by default for *activity*.** Everyone sees projects, who's on what,
  responsibilities, artifacts, the calendar, and Gantt charts.
- **Effort data is restricted.** Raw hours, update contents, and engagement scores are
  visible only to the member, their Lead chain, and REs of projects they contribute to.
- **Engagement is a flashlight, not a scoreboard.** Outcomes outweigh hours; no
  leaderboard function exists, deliberately. See `lib/engagement.ts`.
- **Calendar sync is opt-in**, and must support Apple Calendar as well as Google.
- **Creating projects must feel effortless for leadership** — permissions are
  deliberately permissive there.

## Build phase status

- [x] **0** — Scaffold, design system, app shell, dashboard, project tree, roster
- [ ] **1** — Supabase + Stanford Google auth, real org tree, profiles, Lead assignment
- [ ] **2** — Project detail pages, enrollment flow, artifacts ← *ship this to the club first*
- [ ] **3** — Hours logging
- [ ] **4** — Updates, reviews, roll-ups, notifications
- [ ] **5** — Events, attendance, calendar, opt-in iCal
- [ ] **6** — Tasks, dependencies, auto-Gantt, RE deadline reminders
- [ ] **7** — Trainings, certifications, facility access (Anish supplies the machine list)
- [ ] **8** — Engagement scoring UI, weights config, leadership dashboard
- [ ] **9** — Mobile/PWA polish
