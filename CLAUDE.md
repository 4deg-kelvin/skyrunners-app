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
| `docs/REPORTING_REMOVAL_PLAN.md` | **Why nobody reports to anybody. Read before touching permissions** |
| `docs/DATA_MODEL.md` | Postgres schema, invariants, views |
| `docs/DESIGN_SYSTEM.md` | Visual language, tokens, component rules |
| `docs/DECISIONS.md` | Locked decisions, infrastructure notes |
| `lib/data/README.md` | Why the data layer exists and how to extend it |
| `docs/TWO_TRACK_DEPLOY.md` | Shipping to the club while still building |
| `docs/INTEGRATIONS.md` | Email invites and Discord — what to set up, and what's worth sending |
| `docs/MCP_SECURITY_REVIEW.md` | **The AI-connection threat model.** Read before adding an MCP tool |
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
npm run db:push        # apply pending migrations (needs SUPABASE_ACCESS_TOKEN)
npm run db:pending     # write supabase/PENDING.sql — the re-runnable subset
npm run db:bundle      # regenerate APPLY_ALL.sql — FRESH databases only, see below
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

**Phases 0–8 are built and live on Supabase.** Members find work, ask to join, log what
they did and mark work done; REs assign, sign off, manage their roster and get a scoped
queue of what they owe; there's a calendar, a trainings/facility-access catalogue, an
academic-term editor, division archiving, and a help-wanted board on Find Work.

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
    dashboard/      REs only, scoped to the projects you're accountable for
```

`/updates` was here and is gone (2026-08-24). It was the check-in page.

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

`/` redirects to `/my-work`. Members land on their own projects and deliverables; the
dashboard is the RE view and is hidden in the nav from anyone who is RE of nothing.

## Architecture: the two boundaries that matter

### 1. `lib/data/*` is the only place that touches the data source

Pages import from `lib/data/*` and never from `lib/mock-data.ts`. **ESLint enforces
this** (`no-restricted-imports` in `eslint.config.mjs`).

Every function there is `async` even though the mock behind it is synchronous, so
swapping in Supabase changes no signatures and therefore no pages.

Each returns a **fully-joined view model** — one call per page. Never look data up inside
a render loop: harmless against arrays, a round trip per row against Postgres.

### 2. `lib/permissions.ts` is the only place that decides who can do what

Never check `globalRole` inline. The whole model is three questions:

1. Are you a Co-Lead? → anything
2. Are you an RE of this project **or any above it**, or do you **lead a team that owns
   any of them**? → you own this subtree
3. Is it your own data? → you can manage it

There was a fourth — "are you this member's Lead, directly or anywhere up their chain?" —
and it went with the reporting chain on 2026-08-24 along with `isLeadOfOrAbove` and
`leadChain`. **Do not reintroduce a person-to-person authority check.** If a feature needs
"somebody is accountable for this member", the answer is the RE of the project the work is
on. `lib/permissions.test.ts` has a structural test asserting the five deleted rule names
stay absent.

**Two inheritances, and both run down:** RE authority flows **down** the project tree, and
team-lead authority flows **down** the org tree and then down the project tree. The one
that flowed **up** — Lead authority over people — is the one that went. That asymmetry
used to be where bugs hid, which is why there are 50+ tests on it.

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
member's archived check-ins, and cannot configure the club.

Depth is unbounded in both trees and always has been — an RE four projects up really does
own everything beneath them. `projectChain` and `teamChain` are both cycle-guarded, because
`parent_id` / `lead_id` are plain columns and a loop would hang the request rather than
fail it. (`leadChain` was a third, over `profiles.lead_id`, and went with the reporting
chain.)

Pages get `{ actor, graph, member }` from `getViewer()` and call `can.*`.

**`OrgGraph`'s four lookups are synchronous, and that's load-bearing.** They're called in
loops while walking both trees, so they must never each become a query.
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

The log renders grouped by day on My Work, with the weekday in the heading. It
also went public on 2026-08-16 and, since 2026-08-24, it **is** how a member
reports — there is nothing else to file. See the next section.

There was a second behaviour here: the twice-weekly check-in drafted itself from
these entries, via `lib/checkin-draft.ts`. Both are gone.

**Don't reintroduce a duration in any unit**, and don't add a counter built on
volume of anything — days logged, entries written, sessions attended. Each is
the same inflatable signal in new clothes. `lib/delivered.test.ts` has a test
that fails on those field names, and it has now survived two removals.

Historical hours are **still in Postgres** and simply unselected: `work_logs.hours`,
`update_entries.hours`, `progress_updates.hours_this_period` and the four
`club_settings` tier floors all survive with explanatory column comments. Nothing
was deleted, because the decision to stop counting is a club decision that could
be revisited and a dropped column can't be un-dropped.

**Why it had to ship as one change:** `commitmentTier` was hours ÷ in-session
weeks — a rolling average. Stopping collection while keeping the ladder would
have decayed every member's tier toward the bottom rung over the following
weeks, on their own profile, with no new data causing it.

## Nobody reports to anybody. Check-ins are gone. (Done 2026-08-24)

The club decided **members report to their REs, through the work they log on a
project** — which is public, lands in that project's feed, and can be replied to
in place. `docs/REPORTING_REMOVAL_PLAN.md` is the plan it followed and holds the
reasoning for every decision below.

What went, in one list: the check-in composer, `/updates`, the reminder cron, the
auto-draft, the Settings check-in-days card, the academic pause, the
review/escalation module, `isLeadOfOrAbove`, `leadChain`, `reassignLead`,
`reviewUpdate`, `viewMemberEffort`, `viewMemberContribution`, `submitRollup`,
`lib/contribution.ts`, the `ContributionPanel`, and five of the dashboard's
thirteen sections. About 6,000 lines.

**Co-Lead, Team Lead and Member are still real titles, but symbolic.** Authority
comes from being an RE. The one exception is a **Division Lead**, who is a top RE
over their whole division — that is `leadsTeamAbove`, it survives deliberately,
and it is authority over WORK rather than over people.

Three things replaced what was removed:

- **`lib/quiet.ts`** — per-PROJECT "gone quiet": nothing logged in three weeks
  while open work remains, on the RE's dashboard. This is the one thing the
  removal ADDED, and it is the mitigation for its real cost: the chain's actual
  function was that somebody was *named* as responsible for noticing silence.
  Three weeks, not one — one week fires on half the club every finals week and
  teaches an RE to skip the panel. **Never add a per-person breakdown**; the work
  logs carry `memberId` so it is two lines, and it rebuilds the thing the club
  removed.
- **`lib/delivered.ts`** — two counts on a profile, replacing the three-signal
  record. See the next section.
- **Per-item training verifiers** — `lib/trainings/verifiers.ts`. See #9 below.

**Nothing about a member is private any more, with one exception.** A check-in
carried a `generalNote` written under a stated promise that only the member and
their Lead chain would read it, so `can.readArchivedCheckIns` narrowed to the
member plus Co-Leads rather than opening. Publishing what people already typed is
the one privacy change that changing it back cannot undo. Everything else — every
log line, every deliverable, both counters — is public.

`profiles.lead_id`, `progress_updates.lead_id_at_submission` and the whole
`update_schedules` table are **still in Postgres** with comments, unselected.
Same reasoning as the hours: the decision to stop is a club decision that could
be revisited, and a dropped column can't be un-dropped. **`teams.lead_id`
STAYS LIVE** — it feeds `leadsTeamAbove`.

## Two counters, not an engagement score

`lib/delivered.ts` reports **two counts** — deliverables completed and projects
completed — and computes no composite, no rate and no rank. They sit in the side
column of a member's profile next to the other details, deliberately not in a
panel: the club's decision was that this should be available, not central.

It replaced `lib/contribution.ts`, which reported three independent signals and
also refused to combine them. That rule held; what did not survive was
**Reliability**, which measured check-ins filed on time. The club deleted it
rather than redefining it. **Scope** — RE roles held — went too: it required
having already been appointed, so it measured having already been chosen.

Rules that must not regress:

- **Never add a rate.** A percentage needs a denominator and every candidate here
  is a judgment: deliverables assigned depends on how finely an RE splits work,
  projects joined depends on who invited you.
- **Never add a third count built on volume.** See the note above.
- **Never add a ranking function.** The data supports one; it's absent on purpose.
- The rubric is published at `/how-we-lead`, from `lib/rubric.ts`.

## Updates are an ARCHIVE, and were per-project not one blob

`progress_updates` is an envelope (who, when, status); content lives in
**`update_entries`** — one row per project. **Nothing writes either any more.**
The rows that exist still render: the per-project half is public and part of each
project's feed, and the envelope shows on a member's profile behind
`can.readArchivedCheckIns`.

The reason for the per-project shape is worth keeping, because it applies to
anything that reports on somebody's work across projects: members are on several
by design, so a single text field is ambiguous to anyone overseeing more than one
of them, and an RE couldn't tell whether a blocker was theirs to clear. Anything
rendering an update must iterate `entries` and label each with its project.

## The fourteen things most likely to trip you up

1. **Two trees, and only one of them is about people.** The project tree
   (`projects.parent_id`, what work exists) carries all authority. The org tree
   (`teams.parent_id`) says which division owns what and who leads it — and
   `teams.lead_id` is live and load-bearing, because leading a division makes you
   a top RE inside it.

   There used to be a third: a reporting chain over `profiles.lead_id`, where
   every member had a named Lead. It went on 2026-08-24. `profiles.lead_id` still
   exists and nothing reads it. **Don't rebuild it** — see the section above.

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

   **Who verifies one is also data, per item.** `lib/trainings/verifiers.ts`: a
   named person signs it off, or it is marked self-verify and the member ticks it.
   Unconfigured falls back to "any Lead", which is an interim rule while
   `catalogue_items.verifier_id` waits on migration `0046`. A named verifier
   **cannot be demoted or deactivated** until it is reassigned, and the refusal
   names the items — a bare "not allowed" on an org-chart edit is the kind of
   message people work around by deleting something else.

   That config lives in its own table rather than as two columns on
   `catalogue_items`, and the migration explains why at length: that table is read
   by the per-request snapshot with an explicit column list, so selecting a column
   before the SQL lands 500s every page. **Worth folding in once the database is
   reachable.**

10. **A parent project can't be marked complete while any descendant isn't.** Enforced in
   `updateProject`, recursively and cycle-guarded. Refused rather than cascaded: completing
   the children on the parent's behalf would sign off work their own REs never agreed was
   done. Completing one also writes a `ProjectNotice` addressed up the project tree —
   **not** a synthesised check-in. That reasoning outlived check-ins: never
   manufacture a record of somebody having said something they didn't say.

11. **A sub-project can't be due after its parent.** Same function, checked in both
   directions — moving a child later, or pulling a parent in over children already
   dated — and **only when the date actually moves**, so one pre-existing violation
   can't freeze every other edit on the project. An undated parent constrains nothing.

12. **A view without `security_invoker = on` bypasses RLS, and PostgREST
   exposes it.** Write `create view x with (security_invoker = on) as ...` —
   every time. Without it the view reads its base tables as the OWNER, so the
   policies protecting them do nothing. On 2026-08-25 ten views were serving real
   member data to an ANONYMOUS caller holding only the publishable key, including
   per-member hours and the contribution record the club had just deleted. Fixed
   in `0048`; `docs/HANDOFF.md` §14 has the whole thing.

   **And before dropping a view, grep the migrations for its name.** Postgres
   records dependencies for views-on-views and policies-on-views, so `drop view`
   usually errors if something needs it. A FUNCTION BODY is an opaque string:
   dropping `v_lead_chain` silently broke `auth_can_view_effort()`, and through it
   every read of `work_logs` — which the snapshot reads on every page. `pg_depend`
   will not save you.

13. **`APPLY_ALL.sql` is for FRESH databases only.** It is the whole history and
   is not re-runnable: `0001` has `create type global_role as enum (...)`, and
   `create type` takes no `if not exists`. Pasted into a live database it aborts
   on the first statement with `42710` and nothing after it runs. Use
   `npm run db:pending`, which writes only the unapplied migrations and refuses
   if that set is not re-runnable.

14. **An upsert can never reach a `for update` RLS policy.** `persistDiff` splits
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
- Nested queries use recursive CTEs. Views exist in `0001_core_schema.sql` but
  **nothing reads them** — `lib/data/*` uses the snapshot over tables and
  `OrgGraph` walks the trees in memory. See #12 before touching one
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
| **Co-Lead** | The club's leads. `global_role = co_lead`. Configures divisions, the calendar and the catalogue, and can do anything |
| **Team Lead** ("Lead") | A title and a directory entry — "ask this person about composites". Carries **no authority over people**. Leading a **division** is different: it makes you a top RE inside it |
| **Member** | Everyone else |
| **RE** | Responsible Engineer — accountable for a project's deliverables. Project-scoped, inherits down, multiple per project. **This is where all authority comes from** |
| **Division** | Top-level org unit (`teams.parent_id IS NULL`). Co-Lead editable |
| **Work log** | One line about what you did, on a project or as misc. Public, in the project's feed, replyable. **This is how a member reports** |
| **Check-in / Update** | *Retired 2026-08-24.* Was a twice-weekly report to a named Lead. Existing rows still render; nothing writes new ones |
| **Deliverable** | One unit of work with one owner and a date. The whole task model |
| **Committed / Following** | Committed = an RE added them; carries deliverables and obligations. Following = self-service watch-only, unlimited |
| **Join request** | A member's tracked ask to join. RE approves. Escalates after 5 days |
| **Term** | Academic period. `generatesObligations` now means "the club is in session" — the obligations it named are gone, and the column kept its name rather than costing a migration |
| **Gone quiet** | A PROJECT with nothing logged in three weeks and open work left. `lib/quiet.ts` |

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
- **Everything about a member is public, with exactly one exception.** This table
  used to have three rows and a long argument about which half of a check-in was
  whose. It collapsed on 2026-08-24:

  | Thing | Who sees it | Rule |
  |---|---|---|
  | Every log line, every project, both counters, per-project update entries | **Everyone** | `can.viewProjectUpdates`, `can.viewMemberWorkOnProject` — both `() => true` |
  | Archived check-in envelopes (incl. `generalNote`) | The member and **Co-Leads** | `can.readArchivedCheckIns` |

  The path to that is worth knowing, because each step had a different reason.
  What somebody logged on a project was RE-and-Lead-chain only until 2026-08-16,
  because the log carried HOURS and a number invites comparison between
  volunteers with different course loads. The hours went on 2026-08-14, leaving a
  sentence about a project — and the project is public. Then reliability and the
  contribution record went on 2026-08-24, and they were the last person-level
  judgment in the app.

  **The one exception is narrower than the rule it replaced, not wider.** A
  `generalNote` was written under a stated promise that only the member and their
  Lead chain would read it. Their old Lead can no longer read it; a Co-Lead can.
  Publishing what people already typed is the one privacy change that changing it
  back cannot undo.
- **The dashboard is scoped to the projects you're accountable for**, not the club.
  Opening thirty items, twenty-six of which aren't yours, tells you nothing about
  what you owe — the design target is a 15-minute weekly obligation. `/dashboard`
  also redirects anyone who is an RE of nothing; hiding the nav link is not access
  control, and the nav has to ask the same question or it offers a link that
  bounces people straight back.
- **Engagement is a flashlight, not a scoreboard.** Outcomes are all that count; no
  leaderboard function exists, deliberately.
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
  permissive there. Still true, and not the whole story: an assistant on the MCP
  server created **994 empty projects** through exactly those permissions,
  correctly applied. So `createProject` also carries a ceiling on how many EMPTY
  projects one person can leave behind in a day, and Settings has a Co-Lead
  cleanup for shells already there.

  The general lesson is in `docs/MCP_SECURITY_REVIEW.md` and it applies to every
  write path in this repo: every check here asks **"is this allowed?"**, and the
  answer was yes four thousand times over. An agent holding a legitimate token is
  a load test pointed at your write paths, so ask the second question too —
  **"how often, and what if this runs in a loop?"**

## Build phase status

**`docs/PHASE_PLAN.md` is canonical.** Phase 0 is complete; Phase 1 (auth + real data) is
next, with a step-by-step plan in `docs/PHASE_1_KICKOFF.md`.

Explicitly **not** planned: critical-path Gantt, a composite engagement score, a
leaderboard, self-enrollment, a project commitment cap, the **quarterly
re-enrollment sweep**, and — since 2026-08-24 — **anything that reintroduces a
person-to-person reporting relationship**. Each was considered and rejected; read
the reasoning in `DECISIONS.md`, `PRODUCT_REVIEW.md` and
`REPORTING_REMOVAL_PLAN.md` before re-opening any of them.

The sweep was dropped on 2026-08-08 and its reasoning has partly expired, which is
worth flagging: it rested on "every member has a named Lead who glances at their
roster", and there are no Leads in that sense now. The conclusion stands on the
other half — silently dropping somebody is worse than a stale membership — and the
RE of a project is who keeps its roster honest. If it comes back up, it is the RE's
roster now, not a Lead's.


## Phase 1 starting points

1. `npm i @supabase/supabase-js @supabase/ssr`
2. Add `lib/supabase/{client,server}.ts` and **`middleware.ts`** — `@supabase/ssr` needs
   middleware for session refresh, and auth will not work without it
3. Run `supabase/migrations/0001_core_schema.sql`, then `supabase/seed.sql`
4. Write `0002_rls_policies.sql` (shape sketched in `supabase/README.md`)
5. Replace the body of `getViewer()` in `lib/data/viewer.ts` with the real session
6. Replace the other `lib/data/*` bodies with queries, keeping signatures identical
7. Delete `lib/mock-data.ts` when nothing imports it
