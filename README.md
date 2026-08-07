# SkyRunners HQ

Project and member management for **Stanford UAV / Sky Runners**.

Tracks engineering efforts and member contribution across the club's drone projects, so
members can see everything the club is building and leadership can see what's actually
happening.

**Build order lives in [`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md).**

New here? Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup and workflow.

---

## Run it locally

Needs [Node.js](https://nodejs.org) **22.6+** and [Git](https://git-scm.com).

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. `Ctrl+C` stops the server.

```bash
npm run check     # typecheck + lint + tests — run before pushing
npm test          # permission and contribution tests
npm run format    # Prettier
```

---

## Two modes

A fresh clone runs in **demo mode**: sample data, no login, a yellow banner. Every feature
works; nothing is saved. Add Supabase keys to `.env.local` and it switches to **live
mode** — Stanford Google sign-in and a real database — with no code changes.

That's deliberate. Kelvin sets up the server side on his own schedule, and app development
never waits on it.

---

## Current state

**Phases 0 and 1a complete.**

| Page | What's there |
|---|---|
| **My Work** | Your projects, what you own on each, who the RE is, hours logged, per-project update sections |
| Dashboard | Leadership view — update compliance, review queue, projects needing attention |
| Projects | Nested project tree grouped by division |
| Project detail | Phase progress, team and responsibilities, sub-projects, per-project update feed |
| Members | Roster with roles, project counts, reporting lines |
| Member profile | Projects and responsibilities, direct reports, restricted effort data |
| Calendar | Upcoming events |
| How we lead | Published expectations, tiers, and the leadership rubric |
| Settings | Pick your two check-in days, set an academic pause |
| Login | Stanford Google sign-in, with a demo-mode notice |
| Updates | Placeholder — Phase 7 |

Opening the app lands you on **My Work**, not the dashboard — your own projects and the
update you owe are what you came for.

> **All data is fake**, from `lib/mock-data.ts`, and the signed-in user is mocked in
> `lib/data/viewer.ts`. Supabase arrives in Phase 1 — the schema is already written as
> SQL in `supabase/migrations/`.

---

## How the code is organized

```
app/
  layout.tsx            html/body/fonts only
  globals.css           Design tokens — all colors and radii
  login/                Stanford Google sign-in
  auth/                 OAuth callback, no-profile, inactive
  (app)/                Everything requiring a session
    layout.tsx          Nav, demo banner
    my-work/            Member home
    dashboard/          Leadership overview
    projects/           Tree + [slug] detail
    members/            Roster + [id] profiles
    settings/           Check-in days, academic pause
    calendar/  updates/  how-we-lead/

middleware.ts           Session refresh + route gating (must be at the root)

components/
  ui/                   Card, Badge, Button, StatTile, Donut, Breadcrumb,
                        ProjectBadges, EmptyState
  layout/               TopNav, PageHeader, ComingSoon

lib/
  data/                 ★ The ONLY place that touches the data source
  permissions.ts        ★ Every "who can do what" rule. Tested
  contribution.ts       ★ The four contribution signals. Tested
  labels.ts             All display strings and badge tones
  types.ts              Domain types, mirroring the database
  mock-data.ts          Sample data — replaced in Phase 1

docs/                   Phase plan, schema, design system, decisions, product review
supabase/               Migrations, views, seed
scripts/                Seed generation
```

Starred files hold the logic that's most expensive to get wrong, which is why they're the
ones with tests.

---

## The two boundaries

### `lib/data/*` — the data boundary

Pages import from here and **never** from `lib/mock-data.ts`. ESLint enforces it.

Every function is `async` even though the mock behind it is instant, and each returns a
fully-joined view model — one call per page. That means Phase 1 replaces function bodies
in one directory instead of rewriting every page, and no page ever fires a query per
table row.

See [`lib/data/README.md`](lib/data/README.md).

### `lib/permissions.ts` — the authority boundary

Four questions decide everything:

1. Are you a Co-Lead? → anything
2. Are you an RE of this project **or any above it**? → you own this subtree
3. Are you this member's Lead, **directly or up their chain**? → you oversee them
4. Is it your own data? → you can manage it

The two inheritances run in **opposite directions** — RE authority flows *down* the
project tree, Lead authority flows *up* the reporting chain. That's where bugs would hide,
so it has 33 tests.

---

## Core concepts

**Two separate hierarchies.** The **org tree** is who reports to whom (Division →
sub-team → sub-sub-team, each with a Team Lead). The **project tree** is what work exists
(projects nested in projects, each with Responsible Engineers). They're independent — a
member's Lead isn't necessarily an RE of their projects, which is what lets people work
across divisions.

**Roles.** Co-Lead → Team Lead → Member, plus the project-scoped RE. Multiple REs per
project, one primary contact.

**See everything, ask to join.** Every project is readable by every member — phase, team,
who owns what, what's blocked, who the RE is. Joining goes through that RE, because they're
accountable for the deliverable. Requests are tracked objects that escalate if unanswered,
so "ask the RE" never means waiting in silence.

**Per-project updates.** An update carries one section per project, so a note is never
ambiguous and a blocker routes to the right RE.

---

## Team

- **Anish Bayya** — app functionality
- **@4deg-kelvin** — hosting, deployment, production database
  (see [`docs/DECISIONS.md`](docs/DECISIONS.md) §3 and [`supabase/README.md`](supabase/README.md))
