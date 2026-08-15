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
| `docs/HANDOFF.md` | **Start here. Current state, the bugs that cost most, what's next** |
| `docs/STATUS.md` | What is built and what is blocked |
| `docs/PHASE_PLAN.md` | Roadmap and what is deliberately not planned |
| `docs/INFRA.md` | **Everything server/database/deploy — the doc for Kelvin and his agent** |
| `docs/PROJECT_PLAN.md` | Vision, stack rationale, roles, permissions, feature detail |
| `docs/PRODUCT_REVIEW.md` | Independent critique of the org design, and what changed because of it |
| `docs/DATA_MODEL.md` | Postgres schema, invariants, views |
| `docs/DESIGN_SYSTEM.md` | Visual language, tokens, component rules |
| `docs/DECISIONS.md` | Locked decisions, infrastructure notes |
| `lib/data/README.md` | Why the data layer exists and how to extend it |
| `docs/TWO_TRACK_DEPLOY.md` | Shipping to the club while still building |
| `docs/INTEGRATIONS.md` | Email invites and Discord — what to set up, and what's worth sending |
| `supabase/README.md` | Migrations, views, RLS plan |

## Team

- **Anish Bayya** — app functionality. **New to coding.** Explain reasoning, name
  tradeoffs, don't just emit code. Avoid unexplained jargon.
- **Kelvin (@4deg-kelvin)** — server management, hosting, deployment, production database.
  **His doc is `docs/INFRA.md`.** If you're working on his behalf, start there and avoid
  changing application code.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Supabase (Postgres + Auth +
Storage) · Resend · Vercel + Vercel Cron

**Deliberately no Python.** Rationale in `PROJECT_PLAN.md` §2 — React already forces
TypeScript, so adding Python means two languages, two servers, two deploys for a solo
beginner. Revisit only if real analytics/ML work appears.

## Commands

```bash
npm run dev            # local dev server (demo mode unless .env.local has keys)
npm run check          # everything CI runs except the build: typecheck, lint,
                       # Prettier, dead-control sweep, tests. If this passes and
                       # CI still fails, THIS command is missing a step — fix it
                       # here rather than remembering to run the extra one
npm run sweep          # just the sweep: exports nothing renders or calls
npm run build:check    # verify it compiles WITHOUT killing a running dev server
npm run db:check       # are the Supabase migrations actually applied?
npm run db:bundle      # regenerate supabase/APPLY_ALL.sql (all migrations, one paste)
npm test               # permission + contribution tests
npm run format         # Prettier
```

## Never run `npm run build` while `npm run dev` is up

`next build` deletes and rewrites `.next`; `next dev` serves live out of it. Run both at
once and the dev server loses its chunks mid-flight:

```
Cannot find module './405.js'
__webpack_modules__[moduleId] is not a function
ENOENT: .next/server/pages-manifest.json
```

Those read like application bugs and point nowhere near the cause — they cost two
debugging sessions before the pattern was spotted. The dev server does not recover: stop
it, delete `.next`, restart.

**Use `npm run build:check` instead.** It builds into `.next-build/` and leaves the dev
server alone.

## Current state

**Phases 0–8 are built and live on Supabase**, migrations `0001`–`0019` applied. Members
find work, ask to join, log what they did and mark work done; REs assign, sign off and manage
their roster; Leads get a scoped review queue with escalation; there's a calendar, a
trainings/facility-access catalogue, an academic-term editor, division archiving, and a
help-wanted board on Find Work.

`docs/HANDOFF.md` is the entry point for a fresh session — current state, the ten bugs
that cost the most time, and what's next. **Read it before debugging anything.**

Two modes still coexist: demo mode persists writes to `.data/store.json` via
`lib/store/`, live mode goes to Postgres through the same `mutate()` choke point.
`lib/store/operations.ts` holds every write and checks no permissions; `lib/actions/`
is the only layer that does.

### Two modes — this is the most important thing to understand

`lib/env.ts` checks for Supabase env vars:

- **Demo mode** (no env vars, a fresh clone): runs on `lib/mock-data.ts`, no login, yellow
  banner. Every feature works.
- **Live mode** (env vars set): Stanford Google sign-in, real Postgres.

`lib/data/viewer.ts` is the only file that branches on this. Everything else is
mode-agnostic. **Never add a second place that checks the mode** — if a feature needs to
know, it belongs in `lib/data/*`.


### Route structure

```
app/
  layout.tsx        html/body/fonts ONLY — must not resolve the viewer
  login/            outside the authenticated shell
  auth/             callback route + no-profile / inactive pages
  (app)/            route group: everything requiring a session
    layout.tsx      nav, demo banner, getViewer()
    my-work/        what you own and owe. `/` redirects here
    find-work/      where to help — projects, plus open "I'm stuck" asks
    projects/       the tree; deadlines and blocked work fold in per division
    projects/archive/  retired divisions and what they built
    members/        roster and profiles — trainings live on the profile
    calendar/       sessions, meetings, 1:1s and deadlines
    settings/       your own, plus the Co-Lead academic calendar + catalogue
    dashboard/      leadership only, scoped to who you oversee
```

**Six nav items, and that's a ceiling worth keeping.** It briefly hit eight —
`/blockers`, `/deadlines` and `/trainings` were each a real feature given a
destination they didn't earn. None was wrong; all three were the wrong SIZE. A
deadline is a property of a project, a blocker is already flagged on the
project row, and "what am I cleared on" is a fact about a person. Each now
lives where the thing it describes lives. Before adding a nav item, check
whether it's a page or a section.

The `(app)` group exists because if the root layout resolved the viewer, `/login` would
render inside a layout that redirects unauthenticated visitors to `/login` — an infinite
loop. Parentheses affect layout nesting, not URLs.

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
2. Are you an RE of this project **or any above it**, or do you **lead a team that owns
   any of them**? → you own this subtree
3. Are you this member's Lead, **directly or anywhere up their chain**? → you oversee them
4. Is it your own data? → you can manage it

**Three inheritances, and they run in different directions:** RE authority flows **down**
the project tree, Lead authority flows **up** the reporting chain, and team-lead authority
flows **down** the org tree and then down the project tree. That asymmetry is where bugs
hide, which is why there are 50+ tests on it.

**Approving is a narrower right than doing.** `isREaboveProject` is
`isREofOrAbove` minus the project's own RE, and exactly two rules use it:
`can.completeProject` and `can.withdrawSignOff`. The assigned RE finishes the
work; the RE above them, or the Division Lead, agrees it's finished. Being the
project's own RE disqualifies you even if you'd qualify another way — a Division
Lead who assigns work to themselves is wearing both hats. Co-Leads always can,
which is what stops the top of the tree deadlocking. Reopening deliberately runs
on `manageProject`: saying something isn't done is always safe.

**A Division Lead is a top RE.** `leadsTeamAbove` folds into `isREofOrAbove`, so leading a
division gives RE powers — deliverables, sign-off, join requests, appointing REs — on
every project inside it, at any depth, including sub-projects that carry no `teamId` of
their own. A sub-team lead gets the same over their own team's subtree and nothing
sideways. It is deliberately **not** Co-Lead: a Division Lead still cannot read a
member's personal report unless they're in that person's Lead chain.

Depth is unbounded in both trees and always has been — an RE four projects up really does
own everything beneath them. `projectChain`, `teamChain` and `leadChain` are all
cycle-guarded, because `parent_id` / `lead_id` are plain columns and a loop would hang the
request rather than fail it.

Pages get `{ actor, graph, member }` from `getViewer()` and call `can.*`.

**`OrgGraph`'s four lookups are synchronous, and that's load-bearing.** They're called in
loops while walking all three trees, so they must never each become a query.
`lib/data/graph.ts` loads every profile, project, RE membership and team in four parallel
queries and closes over Maps. Backing them with per-call queries turns one permission
check into fifty.

`buildOrgGraphFromRows` takes `teamRows` as a **required** argument, deliberately. A
default of `[]` would make forgetting it compile, and the failure is invisible: no teams
means no team leads, so every Division Lead silently loses authority over their own
division — the same shape as the mock-data fallback in `docs/HANDOFF.md` §2.

Argument order is `(actor, graph, projectId)` — the graph is always second.

## Deliverables are the entire task model

One flat list per project: **title, ONE owner, a due date, a status.** No dependencies, no
sub-tasks, no critical path, no Gantt.

That's deliberate. A dependency graph costs an RE an hour a week, and on a volunteer team
whose availability swings with midterms it's wrong the day after it's entered — a wrong
schedule is worse than none, because people plan against it.

Five minutes of RE upkeep buys: what each member owns, update auto-drafts, real progress
percentages, trustworthy "projects completed", and an honest timeline. If you're tempted to
add dependencies or sub-tasks, re-read this paragraph.

## There are no hours. The tiers are gone. (Done 2026-08-14)

The club decided **hours are not the measure; deliverables are.** Shipped in
migration `0039` — the tier ladder, the hours-per-week figure, the `Commitment`
signal, `getClubTiers`, `TierAdminForm` and `WorkLog.hours` are all deleted.
`docs/HOURS_REMOVAL_PLAN.md` is the plan it followed.

**The work log is now a diary, not a timesheet.** `WorkLog` is
`{ memberId, projectId?, workDate, description }` — the note is REQUIRED, where
it used to be an optional field beside a required number. That inversion is the
whole point, so don't soften it to make logging faster.

Two behaviours depend on it, and they're the reason the removal added something
rather than only taking things away:

- **The check-in drafts itself.** Each project's section is pre-filled from that
  project's log entries since the member's last *submitted* check-in. The only
  box they must write is for a project they logged nothing against.
  `lib/checkin-draft.ts` is a pure module and is called by BOTH the composer
  (`lib/data/my-work.ts`) and `submitCheckIn` — if those two ever disagree, the
  form demands a box the server accepts, or accepts one it refuses with a reason
  the page never showed.
- **Day by day.** The log renders grouped by day on My Work, with the weekday in
  the heading.

**Don't reintroduce a duration in any unit**, and don't add a fourth contribution
signal built on volume of anything — days logged, entries written, sessions
attended. Each is the same inflatable signal in new clothes.
`lib/contribution.test.ts` has a test that fails on those field names.

Historical hours are **still in Postgres** and simply unselected: `work_logs.hours`,
`update_entries.hours`, `progress_updates.hours_this_period` and the four
`club_settings` tier floors all survive with explanatory column comments. Nothing
was deleted, because the decision to stop counting is a club decision that could
be revisited and a dropped column can't be un-dropped.

**Why it had to ship as one change:** `commitmentTier` was hours ÷ in-session
weeks — a rolling average. Stopping collection while keeping the ladder would
have decayed every member's tier toward the bottom rung over the following
weeks, on their own profile, with no new data causing it.

## There is no engagement score

`lib/contribution.ts` reports **three independent signals** and deliberately computes no
composite number.

| Signal | Notes |
|---|---|
| **Delivered** | Deliverables and projects completed. **Primary** — can't be inflated |
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
— one row per project, each with its own progress, blockers and next steps.

Members are on multiple projects by design, so a single text field would be ambiguous to
a Lead overseeing several of their projects, and an RE couldn't tell whether a blocker was
theirs to clear. Anything rendering an update must iterate `entries` and label each with
its project.

## The twelve things most likely to trip you up

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

6. **Never hard-delete people, projects or divisions.** Deactivate or archive. History
   must survive graduations. Divisions use `teams.is_active` plus `archived_at` /
   `archived_by` / `archive_note`, and are read back at `/projects/archive`. Archiving is
   refused while any project under the division is still running, because hiding live work
   is the failure the app exists to remove; **completed** projects come along, since they
   are the history. `divisions()` returns only active ones — ask for
   `archivedDivisions()` deliberately.

7. **Don't use Prisma.** It connects with elevated privileges and silently bypasses the
   RLS policies protecting reads. Use the Supabase client, or Drizzle.

8. **`Button` is a Client Component** because it accepts `onClick`. Any new interactive
   primitive needs `"use client"`, or a Server Component passing a handler gets
   "Functions cannot be passed directly to Client Components" — an error whose message
   points nowhere near the cause.

9. **The trainings catalogue is DATA, never an enum.** Sites and machines are rows in
   `training_sections` / `catalogue_items`, so a Co-Lead adds one from the UI and it
   appears for everyone with no deploy. There was a `TrainingCategory` union here once;
   it was deleted for exactly this reason. The club adds machines faster than anyone
   ships deploys, and the moment the two drift the page stops matching the shop floor.
   The *only* enum in that feature is `kind` — `site_access` vs `machine`, two genuinely
   different behaviours, and **neither implies the other**.

10. **A parent project can't be marked complete while any descendant isn't.** Enforced in
   `updateProject`, recursively and cycle-guarded. Refused rather than cascaded: completing
   the children on the parent's behalf would sign off work their own REs never agreed was
   done. Completing one also writes a `ProjectNotice` addressed up the project tree —
   **not** a synthesised check-in, which would make a member's reliability record claim
   they reported in on a day they didn't.

11. **A sub-project can't be due after its parent.** Same function, checked in both
   directions — moving a child later, or pulling a parent in over children already
   dated — and **only when the date actually moves**, so one pre-existing violation
   can't freeze every other edit on the project. An undated parent constrains nothing.

12. **An upsert can never reach a `for update` RLS policy.** `persistDiff` splits
   inserts from updates for exactly this reason; see `docs/HANDOFF.md` §9 before
   touching `lib/store/supabase.ts`. And RLS does not raise on a *missing* policy —
   the statement matches nothing and returns success — so every write there calls
   `.select()` and treats zero affected rows as an error.

## Conventions

- Display strings and badge tones go in `lib/labels.ts`, never inline in a page
- Reads via Supabase client + RLS; writes via Server Actions calling `lib/permissions.ts`.
  **Role and graph** questions live in `permissions.ts`; **ownership** questions
  ("is this your row") live in `operations.ts`, which is the only layer holding
  the row — four operations do this, and the header there names them
- Nested queries use recursive CTEs — views already written in `0001_core_schema.sql`
- Generated Supabase types are snake_case; `lib/types.ts` is camelCase. **Map between
  them inside `lib/data/*`** — don't let snake_case leak into components
- Snapshot values that change over time (`lead_id_at_submission`, `weights_version`)
- **Never hardcode colors.** Tokens live in `app/globals.css`
- **Dates go through `lib/dates.ts`.** The club runs on Pacific time and Vercel
  runs on UTC, so `new Date().toISOString().slice(0, 10)` means the app rolls
  over to tomorrow at 5pm California time — every evening this club is in the
  lab. `todayInClubTime()` for "what day is it"; `formatDay()` for a
  `YYYY-MM-DD` calendar date; `formatMoment()` for a real instant. Never
  `toLocaleDateString` without an explicit `timeZone` — the server renders in
  UTC and the browser doesn't, which is both a wrong date and a hydration
  mismatch. Compare dates as **strings** (`dueDate < today`), never by
  constructing two `Date`s
- Mobile-responsive from the start — the work log gets written in the lab, on phones
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
| **Check-in / Update** | Member's progress report. **Twice a week**, on member-chosen weekdays. Pausable for academics without penalty. Purpose is prompting a conversation with their Lead, not filing a report |
| **Deliverable** | One unit of work with one owner and a date. The whole task model |
| **Committed / Following** | Committed = an RE added them; carries deliverables and obligations. Following = self-service watch-only, unlimited |
| **Join request** | A member's tracked ask to join. RE approves. Escalates after 5 days |
| **Term** | Academic period. Obligations only generate when `generatesObligations` is true |
| **Roll-up** | Lead's aggregated report up the chain to Co-Leads |

## Key product decisions

- **`/find-work` is the point of the app.** The club's root problem is "I can't find
  something to do without asking a Co-Lead". That page ranks every active project by where
  a member would help most — unstaffed and blocked first, healthy last, already-joined at
  the bottom — and puts the RE's email on every card. Protect its ordering logic; a list
  sorted by date or division would bury the work that needs people.
- **Membership is RE-controlled, with no cap.** Members cannot add themselves. They see
  everything, follow anything, and *ask* — the RE decides, because the RE is accountable
  for the deliverable.
- **`join_requests` is what keeps that from being a dead end.** "Email the RE" produces
  silence and an invisible member, which is the original problem wearing a different hat.
  A tracked request lands in a queue, shows as pending, and escalates at 5 days.
- **Transparency by default for *activity*.** Everyone sees projects, who's on what,
  responsibilities, the calendar, Gantt charts.
- **A check-in has a public half and a private half.** This is the rule most likely to be
  got wrong, so it's spelled out:

  | Thing | Who sees it | Rule |
  |---|---|---|
  | Per-project entry (progress, blockers, next steps) | **Everyone** — it's the project's history | `can.viewProjectUpdates` |
  | What they logged on one project | That project's REs, inheriting **down** the tree | `can.viewMemberWorkOnProject` |
  | The personal report and reliability | The member and their **Lead chain only** | `can.viewMemberEffort`, `can.reviewUpdate` |

  **REs deliberately cannot read someone's personal report.** They get the per-project half
  publicly instead. Reviewing is one named person's obligation — that's what makes the
  escalation in `lib/review.ts` meaningful.
- **An unread check-in escalates after 3 days** to the Lead *above* the Lead who didn't read
  it. On age, not on count: "12 unread" is ignorable and punishes Leads with more reports,
  whereas "Kenji has been waiting 6 days" names one person and is actionable.
- **The dashboard is scoped to who you oversee**, not the club. A Lead opening thirty
  reports, twenty-six of which aren't theirs, cannot tell what they owe — and the design
  target is a 15-minute weekly obligation. `/dashboard` also redirects anyone who oversees
  nobody; hiding the nav link is not access control.
- **Engagement is a flashlight, not a scoreboard.** Outcomes are all that count; no
  leaderboard function exists, deliberately. See `lib/engagement.ts`.
- **Calendar sync is opt-in**, and it's one subscription URL covering Apple,
  Google and Outlook — there is no public Apple calendar API, so an ICS feed is
  the only mechanism that reaches all three. `lib/calendar/` is pure and heavily
  tested because **every failure mode is silent**: a client that dislikes the
  document shows an empty calendar, never an error. Three rules that have each
  already been broken, all in `docs/HANDOFF.md` §12–13:
  - **Never emit a calendar with zero VEVENTs** — Google refuses to add it.
  - **A repeating event carries `TZID` + `VTIMEZONE`, never an absolute UTC
    `DTSTART`** — a client expanding the rule would hold UTC fixed and drift the
    local time an hour at the DST change.
  - **`EXDATE` must match `DTSTART`'s value type and zone**, or it cancels
    nothing.

  When changing anything here, parse the output with a real ICS library rather
  than reading it. Reading it is how all three shipped.
- **An event links to a project, both ways.** The calendar row links to the
  project; the project's sidebar lists its upcoming sessions with the attend
  button, and its timeline shows them as round dots beside the deliverable
  diamonds. Optional on create and editable afterwards — a session created
  club-wide is very often about work the organiser isn't on.
- **Invite-only events are Co-Lead only, deliberately.** An open calendar is
  the point of the feature — it exists so a member can plug into the club's
  work without asking — so every closed event subtracts from it. Don't widen
  this to leadership: the cases that need one (a sponsor visit with a
  headcount, an interview panel) are things a Co-Lead is arranging anyway.
  `setEventGuestList` is the only way a closed event's list can change, since
  `setEventAttendance` refuses those by design, and closing an open event never
  evicts whoever already joined.
- **The engineering record is the one project write open past the REs.** Anyone
  *committed* to a project can attach a document (`can.attachArtifact`);
  removing is the RE's (`can.manageArtifact`). Adding extends the record,
  removing rewrites it — that asymmetry is the design, and it exists because
  the person who ran the test holds the test report. Following is not enough:
  watching a project isn't working on it.
- **Completing a project freezes its record.** Existing entries can no longer be
  edited or removed by anyone but a Co-Lead. New attachments are still allowed
  deliberately — the final report is usually written the week *after* the work
  stops, and blocking that means the record can never be finished. There is no
  edit-in-place, so a Co-Lead removing plus anyone re-attaching *is* the repair
  path; don't close it.
- **Links must be permanent, checked twice.** `lib/artifacts.ts` refuses what a
  machine can prove is temporary — presigned S3/GCS/Azure URLs, Supabase signed
  storage paths, `localhost` and RFC1918 hosts — and a required checkbox covers
  what only a person can judge. Both run on the client (as you type) and the
  server (on submit) from the same function, so they can't drift. Keep the
  machine half **conservative**: a validator that blocks a good link teaches
  people to route around the feature, which costs more than the rot it prevents.
  That's why bare `token=` is deliberately allowed.
- **The artifact kind auto-detects from the URL, as a DEFAULT only.** Host beats
  extension. `requirements` and `test_report` are never guessed — both are
  claims about what a document *says*, and both are usually PDFs.
- **Creating projects must feel effortless for leadership** — permissions are deliberately
  permissive there.

## Build phase status

**`docs/PHASE_PLAN.md` is canonical.** Phase 0 is complete; Phase 1 (auth + real data) is
next, with a step-by-step plan in `docs/PHASE_1_KICKOFF.md`.

Explicitly **not** planned: critical-path Gantt, a composite engagement score, a
leaderboard, self-enrollment, a project commitment cap, and the **quarterly
re-enrollment sweep**. Each was considered and rejected — read the reasoning in
`DECISIONS.md` and `PRODUCT_REVIEW.md` before re-opening any of them.

The sweep is the newest of those (dropped 2026-08-08): a 35-person club where every
member has a named Lead doesn't need memberships auto-closing at quarter start, and
silently dropping somebody is worse than a Lead glancing at their roster. Keeping the
roster honest is that Lead's job.


## Phase 1 starting points

1. `npm i @supabase/supabase-js @supabase/ssr`
2. Add `lib/supabase/{client,server}.ts` and **`middleware.ts`** — `@supabase/ssr` needs
   middleware for session refresh, and auth will not work without it
3. Run `supabase/migrations/0001_core_schema.sql`, then `supabase/seed.sql`
4. Write `0002_rls_policies.sql` (shape sketched in `supabase/README.md`)
5. Replace the body of `getViewer()` in `lib/data/viewer.ts` with the real session
6. Replace the other `lib/data/*` bodies with queries, keeping signatures identical
7. Delete `lib/mock-data.ts` when nothing imports it
