# SkyRunners HQ

Project and member management for **Stanford UAV / Sky Runners**, a ~35-person student
drone team.

## The problem it solves

The club loses members to disorganisation. Three specific failures:

1. **You can't find work without asking a Co-Lead.** New members drift and leave.
2. **Leaders can't see who's actually contributing.** Effort is invisible until someone
   burns out or disappears.
3. **Progress doesn't flow up the chain.** Leads find out things are stuck too late.

Every feature here traces back to one of those three. If a proposed change doesn't, it
probably shouldn't be built — that's the filter.

---

## Run it

Needs [Node.js](https://nodejs.org) **22.6+**.

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:3000**. With Supabase keys in `.env.local` you get real Google
sign-in; without them a fresh clone still runs on sample data with no setup at all.

```bash
npm run check
```

Typecheck, lint and 184 tests. Run it before every push; CI runs the same thing plus a
Prettier check.

```bash
npm run build:check
```

Verifies the production build. **Use this rather than `npm run build` whenever the dev
server is running** — a plain build deletes the directory the dev server is serving from,
which breaks it with errors that look like application bugs (`Cannot find module
'./405.js'`). If that happens: stop the server, delete `.next`, restart.

---

## Where things stand

**The app is live on Supabase** — real sign-in, real Postgres, migrations 0001-0012
applied. The club starts empty and is populated through the app itself.

Read **[`docs/STATUS.md`](docs/STATUS.md)** — one page covering what's built, what's
blocked and on exactly what, and the known gaps.

---

## The two modes

| Mode | When | Behaviour |
|---|---|---|
| **Demo** | Fresh clone, no env vars | Sample data, no login, yellow banner. Writes persist to `.data/store.json` |
| **Live** | Supabase keys in `.env.local` | Stanford Google sign-in, real Postgres |

`lib/data/viewer.ts` is the only file that branches on this. That split is why app
development never had to wait on the server side.


---

## Documentation

Start here, in this order:

| Doc | What it's for |
|---|---|
| **[`docs/STATUS.md`](docs/STATUS.md)** | **What's built, what's blocked. Read this first** |
| [`CLAUDE.md`](CLAUDE.md) | Architecture and the traps most likely to bite you |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, git workflow, the seven rules |
| [`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md) | Roadmap, and what's deliberately not planned |
| [`docs/INFRA.md`](docs/INFRA.md) | **Kelvin's doc** — servers, database, deploy |
| [`docs/TWO_TRACK_DEPLOY.md`](docs/TWO_TRACK_DEPLOY.md) | Shipping to the club while still building |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked decisions and the reasoning behind them |

Reference, when you need it: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) ·
[`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) ·
[`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) ·
[`docs/PRODUCT_REVIEW.md`](docs/PRODUCT_REVIEW.md)

---

## Three things that will trip you up

Full list in [`CLAUDE.md`](CLAUDE.md); these are the ones that cost the most time.

- **Two hierarchies run in opposite directions.** RE authority inherits *down* the project
  tree; Lead authority inherits *up* the reporting chain. Never check `globalRole` inline —
  go through `lib/permissions.ts`.
- **A check-in has a public half and a private half.** Per-project content belongs to the
  project and everyone sees it. The personal report, total hours and reliability are
  visible only to the member and their Lead chain.
- **Pages never import `lib/mock-data`.** They go through `lib/data/*`. ESLint enforces it,
  and that boundary is the entire reason swapping in Postgres won't touch a single page.

---

## Team

- **Anish Bayya** — application
- **Kelvin (@4deg-kelvin)** — servers, hosting, production database. His doc is
  [`docs/INFRA.md`](docs/INFRA.md)

Next.js 15 · TypeScript · Tailwind v4 · Supabase · Vercel
