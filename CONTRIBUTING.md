# Contributing

For Anish, his teammate, and whoever inherits this after they graduate.

---

## First-time setup

You need [Git](https://git-scm.com/download/win) and [Node.js](https://nodejs.org) 22.6
or newer. Check with `node --version` — if it prints v20 or lower, `npm test` will fail,
because the test runner uses Node's built-in TypeScript support.

```bash
git clone https://github.com/4deg-kelvin/skyrunners-app.git
cd skyrunners-app
npm install
cp .env.example .env.local     # PowerShell: copy .env.example .env.local
npm run dev
```

Open http://localhost:3000. Phase 0 runs entirely on sample data, so an empty
`.env.local` is fine until Supabase is wired up.

Tell Git who you are, once per machine:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@stanford.edu"
```

---

## The daily loop

```bash
git checkout main
git pull                          # get your teammate's work first
git checkout -b feature/hours-logging

# ... make changes ...

npm run check                     # typecheck + lint + Prettier + sweep + tests
git add .
git commit -m "Add quick-add hours form"
git push -u origin feature/hours-logging
```

Then open a pull request on GitHub.

### Why branches instead of pushing to main

With two people committing to `main` directly, you eventually both edit the same file and
land in a merge conflict — usually at the worst possible moment. A branch keeps your
half-finished work out of the other person's way, gives you a place to review each other's
changes, and gets you a preview deployment per branch on Vercel that you can show the
club without touching production.

It costs two extra commands. Worth it.

### Branch names

| Prefix | For |
|---|---|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `chore/` | Dependencies, config, tooling |

### Commit messages

Present tense, describing what the change does:

- Good: `Add per-project sections to update form`
- Good: `Fix projects owned by sub-teams not appearing`
- Less useful: `updates`, `fixed stuff`, `wip`

---

## Before you push

```bash
npm run check
```

Runs typecheck, lint, and tests. CI runs the same thing plus a production build on every
push, so if this passes locally the pull request should be green.

`npm run format` fixes formatting automatically. Prettier config is committed, so both
your editors produce identical output — which keeps diffs about real changes instead of
whitespace.

---

## Rules that matter

These exist because breaking them causes real pain later, not for tidiness.

### 1. Pages import from `lib/data/*`, never `lib/mock-data.ts`

ESLint enforces this. The data layer is what lets the Supabase migration change one
directory instead of every page. See `lib/data/README.md`.

### 2. Never do data lookups inside a render loop

Join everything in `lib/data/*` and pass a finished view model to the component. A helper
called per row is a harmless array scan against mock data and a separate database round
trip against Postgres — 40 members becomes 80 queries.

### 3. All permission logic lives in `lib/permissions.ts`

Never check `globalRole` inline in a component. Add a rule to `can`, add a test, use it.
The nested RE inheritance is subtle enough that scattered checks will drift.

### 4. Never hardcode colors

Use the tokens in `app/globals.css`. See `docs/DESIGN_SYSTEM.md`.

### 5. Never edit a migration that has already run

Add a new numbered file in `supabase/migrations/`. Editing an applied migration puts your
database and your teammate's silently out of sync.

### 6. Never hard-delete people or projects

Set `status` to `inactive`. Contribution history has to survive graduations — that's a
stated product requirement, not a nicety.

### 7. Empty states always offer a next action

Use the `EmptyState` component. A new member should never hit a dead end that doesn't tell
them what to do.

---

## Where things live

```
app/          Pages. Folder name = URL. Server Components by default
components/
  ui/         Reusable primitives — Card, Badge, Button, ProjectBadges
  layout/     TopNav, PageHeader
lib/
  data/       ★ The only place that touches the data source
  permissions.ts  ★ Every "who can do what" rule. Tested
  engagement.ts   ★ Scoring. Tested
  labels.ts   All user-facing strings and badge tones
  types.ts    Domain types, mirroring the database
docs/         Plan, schema, design system, decisions
supabase/     Migrations and seed
scripts/      One-off tooling (seed generation)
```

Starred files are where bugs are most expensive. Both have tests — extend them when you
change the rules.

---

## Adding a feature

1. Check `docs/PROJECT_PLAN.md` for which phase it belongs to
2. If it needs new data, add the tables in a new `supabase/migrations/` file **and**
   update `docs/DATA_MODEL.md`
3. Add types to `lib/types.ts`, display strings to `lib/labels.ts`
4. Add a function to `lib/data/*` returning everything the page needs
5. Add permission rules to `lib/permissions.ts`, with tests
6. Build the page, importing only from `lib/data/*`
7. `npm run check`, then open a PR

---

## If you get stuck

Read the error message fully — it usually says exactly what's wrong. Paste the whole
thing, not a paraphrase, when asking for help.

Common ones:

| Error | Cause |
|---|---|
| `'node' is not recognized` | Node isn't installed, or you didn't reopen your terminal after installing |
| `Functions cannot be passed directly to Client Components` | A Server Component passed `onClick` to something without `"use client"` |
| `Module not found: @/lib/...` | Typo in the path, or the file doesn't exist yet |
| Lint error about `mock-data` | You imported it from a page — use `lib/data/*` |
| `npm test` fails immediately | Node older than 22.6 |
