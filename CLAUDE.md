# CLAUDE.md — Context for AI agents working in this repo

Read this first. It orients you fast and prevents the most likely mistakes.

## What this is

A project and member management app for **Stanford UAV / Sky Runners**, a student
drone team. It tracks member engagement and engineering efforts across multiple
concurrent drone projects.

**The problem it solves:** the club loses members to disorganization. People can't find
work without asking a co-lead, leaders can't see who's contributing, and progress
updates don't flow up the chain. Every feature decision should trace back to one of
those three.

## Read these before writing code

| Doc | Contents |
|---|---|
| `docs/PROJECT_PLAN.md` | Vision, stack rationale, roles, permissions, features, build phases, risks |
| `docs/DATA_MODEL.md` | Full Postgres schema, invariants, views |
| `docs/DECISIONS.md` | Locked decisions, open questions, infrastructure notes |

## Team

- **Anish Bayya** — app functionality. **New to coding.** Explain reasoning, name
  tradeoffs, don't just emit code. Avoid unexplained jargon.
- **Teammate (@4deg-kelvin)** — server management, hosting, deployment, production
  database. Infrastructure notes for them live in `docs/DECISIONS.md`.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind + shadcn/ui · Supabase
(Postgres + Auth + Storage) · Resend · Vercel + Vercel Cron · Recharts

**Deliberately no Python.** Rationale in `PROJECT_PLAN.md` §2 — briefly: React already
forces TypeScript, so adding Python means two languages, two servers, two deploys for a
solo beginner. Revisit only if genuine analytics/ML work appears.

## The five things most likely to trip you up

1. **There are two independent hierarchies.** The **org tree** (`teams.parent_id`, who
   reports to whom) and the **project tree** (`projects.parent_id`, what work exists)
   are separate. A member's Mentor is *not* necessarily the RE of their projects.
   Merging them rebuilds the silos this app exists to remove. Never conflate them.

2. **RE authority inherits downward.** An RE of a project can act on that project and
   every descendant. Permission checks must walk the project tree, not just check one
   row. All of this lives in one central module — put it there, not inline.

3. **Transparency is the default.** Most reads are open to all authenticated members
   by design. Restrict **writes**, and only a small set of leadership views
   (engagement rankings, private Mentor notes).

4. **Never hard-delete people or projects.** Deactivate. Historical updates, hours, and
   attendance must stay interpretable after members graduate.

5. **Don't use Prisma.** It connects with elevated privileges and silently bypasses the
   RLS policies protecting reads. Use the Supabase client, or Drizzle if you need
   typed queries.

## Conventions

- Reads via Supabase client + RLS; writes via Server Actions calling the central
  permission module
- Nested queries use recursive CTEs (`docs/DATA_MODEL.md` has the pattern)
- Snapshot values that change over time (`mentor_id_at_submission`,
  `weights_version`) so history stays correct
- Mobile-responsive from the start — hours get logged in the lab, on phones
- Auth: Google OAuth, `@stanford.edu` enforced. No passwords.

## Terminology

| Term | Meaning |
|---|---|
| **Co-Lead** | Team leads. `global_role = admin` |
| **Mentor** | Middle leadership; reviews updates, checks in weekly. *Pending Anish's confirmation of the name* |
| **Member** | Everyone else |
| **RE** | Responsible Engineer — accountable for a project's deliverables. Project-scoped, inherits down |
| **Division** | Top-level org unit (`teams.parent_id IS NULL`): Fixed Wing eVTOL, SkyBeta, Spade, DroneHacks, SkyDelta |
| **Update** | Member's recurring progress report to their Mentor |
| **Roll-up** | Mentor's aggregated report up the chain to Co-Leads |

## Build phase status

Phases are vertical slices — each one ships a working feature end to end.

- [ ] **0** — Scaffold, Stanford Google auth, app shell
- [ ] **1** — Org tree, roster, profiles, Mentor assignment
- [ ] **2** — Project tree, join flow, artifacts ← *ship this to the club first*
- [ ] **3** — Hours logging
- [ ] **4** — Updates, reviews, roll-ups, notifications
- [ ] **5** — Events, attendance, calendar
- [ ] **6** — Tasks, dependencies, auto-Gantt
- [ ] **7** — Trainings, certifications, facility access
- [ ] **8** — Engagement scoring, leadership dashboard
- [ ] **9** — Mobile/PWA polish

## Unresolved — ask, don't assume

1. **"Tri-weekly update"** — 3× per week, or once every 3 weeks? Schema is
   intentionally flexible (`update_schedules.cadence`) until answered
2. **"Mentor"** as the role name — awaiting confirmation
3. **Hours visibility** — all members, or leadership only?
4. Exact division spellings; club size; trainings and access types to seed;
   competition dates for Gantt anchoring
