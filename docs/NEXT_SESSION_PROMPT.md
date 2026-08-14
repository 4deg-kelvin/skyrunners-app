# The prompt for the next session

Copy the block below into a fresh Claude Code session, in the repo root.

Replace `<DB_PASSWORD>` with the Supabase database password before sending. It
is deliberately not written into this file — this repo is on GitHub.

---

```
Read CLAUDE.md, docs/HANDOFF.md and docs/HOURS_REMOVAL_PLAN.md before you touch
anything. The plan doc is the task; the other two are context.

TASK
Remove the hour-tracking system, per docs/HOURS_REMOVAL_PLAN.md. It is one
coherent change and must not be split — the plan explains why (the tiers decay
on their own if you stop feeding them without removing them). Work through it
end to end: model, contribution signals, UI, the sweep, migration 0039, tests,
and the /how-we-lead rubric section.

The two new behaviours in that doc are the point of the change, not an extra:
the check-in auto-fills from the week's work-log entries, and only asks for a
line about a project with nothing logged against it; and members get a
day-by-day view of what they did.

STANDING PERMISSIONS — you do not need to ask for any of these
- Commit, merge the worktree branch into main, and push, without asking.
  Vercel auto-deploys on push, so pushing IS deploying. Don't stop at
  "committed locally" — 21 commits once sat unpushed while Vercel rebuilt old
  code and three debugging rounds went into code that wasn't running.
- Apply database migrations yourself (see below).
- Read and write anything in the repo.
- Run the live read-only verification harness.

AFTER EVERY PIECE OF WORK, IN THIS ORDER
1. npm run check          (typecheck, lint, prettier, dead-control sweep, tests)
2. npm run build:check    (NEVER `npm run build` — it deletes .next and kills a
                           running dev server; see CLAUDE.md)
3. Scan the staged diff for the DB password, service-role keys, or skr_ tokens
   before committing.
4. Commit, merge into main, push.
5. Confirm `git rev-list --left-right --count main...origin/main` reads `0 0`.
6. `0 0` is necessary but NOT sufficient. Also confirm, via the public GitHub
   API on 4deg-kelvin/skyrunners-app:
     - /actions/runs?per_page=1  → conclusion is "success" for your sha
     - /deployments?per_page=1   → newest sha IS your sha, and its latest
                                   status is "success"
   Pushed code has twice sat undeployed — once from red CI, once because Vercel
   silently stopped creating deployments.

DATABASE
Migrations apply through the POOLER host only. The direct db.<ref> host is
IPv6-only and fails with ENOTFOUND on this network:

  postgresql://postgres.ldijsmcnjrihwvxtypqy:<DB_PASSWORD>@aws-0-ca-central-1.pooler.supabase.com:5432/postgres

There is no Postgres client in the repo and psql is not on PATH. Install `pg`
into the session scratchpad directory (NOT the repo — don't add a dependency
for a one-off), run the migration inside a transaction, then query pg_policies
or information_schema to prove it landed rather than trusting "no error".

Apply the migration BEFORE pushing when it adds or changes a column:
loadSnapshot selects an explicit column list, so a missing column 500s every
page until the migration lands.

Verify against real data, read-only, any time:
  PW=<DB_PASSWORD> npm run verify:live
That runs every page's data function against production (21 checks).

WHAT I CANNOT DO FOR YOU
- I have no Vercel access — Kelvin owns it. So CRON_SECRET is unavailable and
  you cannot manually trigger /api/cron/*. Don't plan around being able to.
- Don't touch vercel.json's cron frequency. Hobby allows at most one run per
  day per job and rejects the WHOLE DEPLOY if you break it; that once failed
  four deploys in a row and the symptom was "my change isn't live".

HOUSE RULES THAT WILL BITE YOU
- lib/data/* is the only place that touches the data source. Pages never import
  lib/mock-data. ESLint enforces it.
- lib/permissions.ts is the only place that decides who can do what. Never
  check globalRole inline.
- Dates go through lib/dates.ts. todayInClubTime(), never
  new Date().toISOString().slice(0,10) — the club is Pacific, Vercel is UTC.
- Never hard-delete people, projects or divisions. Deactivate or archive.
- Display strings and badge tones live in lib/labels.ts.
- Run `npm run db:bundle` after adding a migration.

HOW I WANT YOU TO WORK
I'm new to coding — explain your reasoning and name tradeoffs rather than just
emitting code. If you find a real problem with what I've asked for, say so in a
sentence or two and then build it anyway under stated assumptions; don't stop
and wait unless proceeding would be genuinely unsafe.

Verify claims before making them. Prefer measuring the actual behaviour — run
the code, query the database — over reading it and inferring.
```

---

## After that lands

Two things are still outstanding and are a separate session's work:

1. **The detailed guide rewrites.** `/getting-started` and `/leading` need to
   walk through every feature in detail, and the Lead page needs the club's
   responsibilities — chasing people who stop logging, running a design review,
   handing a project over. The editable *container* for club material shipped
   on 2026-08-14 (`/settings/guides`, migration 0038); the built-in content is
   what still needs expanding.

2. **Khush, Guilherme and Michael have no Discord ID connected.** Khush is the
   DroneHacks Division Lead, so the daily digest and every blocker alert are
   silent for him. That's a nudge, not a code change.
