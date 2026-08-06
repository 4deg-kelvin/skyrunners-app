# SkyRunners HQ

Project and member management for **Stanford UAV / Sky Runners**.

Tracks engineering efforts and member engagement across the club's drone projects, so
members can find work without asking a co-lead and leadership can see what's actually
happening.

---

## Run it locally

You need [Node.js](https://nodejs.org) (LTS) and [Git](https://git-scm.com).

```bash
npm install     # first time only, downloads dependencies
npm run dev     # start the dev server
```

Open **http://localhost:3000**. Leave that terminal window open while you work;
`Ctrl+C` stops the server.

### Other commands

```bash
npm test          # run the permission and engagement tests
npm run typecheck # check types without building
npm run build     # production build
```

---

## Current state

**Phase 0 complete.** The app shell, design system, and four pages are built and
working, running on sample data.

| Page | State |
|---|---|
| Dashboard | Update compliance, review queue, projects needing attention |
| Projects | Full nested project tree grouped by division |
| Members | Roster with roles, project counts, reporting lines |
| Calendar | Upcoming events list |
| Updates | Placeholder — Phase 4 |

> **All data is fake**, from `lib/mock-data.ts`, and the signed-in user is hardcoded in
> `app/layout.tsx`. Supabase and real auth arrive in Phase 1. This is deliberate — it let
> the whole interface get built and reviewed before committing to a database schema.

---

## Layout of the code

```
app/                  Pages (Next.js App Router — folder name = URL)
  globals.css         Design tokens. All colors and radii live here
  layout.tsx          Shell wrapping every page. Mock auth for now
  dashboard/          Leadership overview
  projects/           Nested project tree
  members/            Roster
  calendar/           Events
  updates/            Placeholder

components/
  ui/                 Reusable primitives: Card, Badge, Button, StatTile, Donut
  layout/             TopNav, PageHeader, ComingSoon

lib/
  types.ts            Domain types, mirroring the database schema
  permissions.ts      ★ Every "who can do what" rule. Tested
  engagement.ts       ★ Engagement scoring. Tested
  mock-data.ts        Sample data — replaced by real queries in Phase 1
  utils.ts            Small helpers

docs/
  PROJECT_PLAN.md     Vision, stack rationale, features, build phases
  DATA_MODEL.md       Database schema
  DESIGN_SYSTEM.md    Visual language and component rules
  DECISIONS.md        Locked decisions, infrastructure notes for hosting
```

`lib/permissions.ts` and `lib/engagement.ts` hold the logic most likely to cause real
problems if wrong, which is why they're the two files with tests.

---

## Core concepts

**Two separate hierarchies.** The **org tree** is who reports to whom (Division →
sub-team → sub-sub-team, each with a Team Lead). The **project tree** is what work exists
(projects nested inside projects, each with Responsible Engineers). They're independent —
a member's Lead is not necessarily an RE of their projects. That's what lets people work
across divisions.

**Two directions of inherited authority.** RE authority flows *down* the project tree: an
RE of a parent project can act on everything beneath it. Lead authority flows *up* the
reporting chain: your Lead's Lead oversees you too.

**Roles.** Co-Lead → Team Lead → Member, plus the project-scoped RE. Multiple REs per
project are allowed, with one primary contact.

**Open enrollment.** Members join any project that interests them, no permission needed.
This is the main fix for the club's biggest problem.

---

## Team

- **Anish Bayya** — app functionality
- **@4deg-kelvin** — hosting, deployment, production database
  (see `docs/DECISIONS.md` §3)
