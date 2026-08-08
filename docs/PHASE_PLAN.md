# Phase Plan

**Updated:** 2026-08-07. Roadmap and rationale. For *what is built right now*, see
[`STATUS.md`](STATUS.md) — that is the page to trust.

Two organising principles:

1. **Every phase is a vertical slice** — a working feature end to end, not "all the UI then
   all the backend."
2. **Nothing Anish builds waits on Kelvin.** Kelvin owns servers, hosting and the
   production database on his own timeline. The app is therefore built so it runs fully
   without any of that, and flips to real data when the keys land.

---

## The demo/live split — why nothing is blocked

`lib/env.ts` checks whether Supabase environment variables exist:

| Mode | When | Behaviour |
|---|---|---|
| **Demo** | No env vars — a fresh clone | Runs on `lib/mock-data.ts`. No login. Yellow banner. Every feature works |
| **Live** | Env vars set | Stanford Google sign-in, real Postgres |

So Anish keeps building features against mock data, and the day Kelvin adds keys to
`.env.local` the same code talks to the real database. No rewrite, no waiting.

Every phase below is marked **[App]** (Anish, buildable now) or **[Infra]** (Kelvin).

---

## Done

### Phase 0 — Foundation ✅

App shell and design system from the reference UI, My Work, leadership dashboard, project
tree with detail pages, roster with profiles, calendar, published expectations page.
Underneath: the `lib/data` async boundary, the tested permission module, deliverables,
the contribution record, the terms model, RE liveness detection, join requests, ESLint +
Prettier + CI, and the full Postgres schema as three migrations.

### Phase 1a — Auth, app side ✅ **[App]**

- Demo/live mode switch (`lib/env.ts`)
- Supabase browser and server clients
- **`middleware.ts`** for session refresh and route gating — the piece auth silently fails
  without
- Login page with Stanford Google sign-in
- OAuth callback with domain enforcement
- Account menu with sign-out; graceful pages for "invited but no profile" and "inactive"
- Route group `app/(app)/` so login sits outside the authenticated shell
- Settings: pick your two check-in days, set an academic pause
- Mobile nav

Verified: typecheck clean, 68 tests, lint clean, demo mode boots with zero env vars.

---

## Next

### Phase 1c — The org graph on Postgres ✅ **[App]**

*Added 2026-08-07.* Found while finishing Phase 1, not in the original plan.

`getLiveViewer()` returned a real profile (a genuine auth UUID) but handed
`lib/permissions.ts` the **mock** graph. Every rule starts with
`graph.getMember(actor.id)`, so in live mode it was reasoning about someone who,
as far as the graph was concerned, didn't exist.

It failed *closed* — nobody gained access they shouldn't have — but every Lead and
RE would have silently lost theirs, presenting as "why can't I edit my own
project?" with nothing pointing at the cause.

`lib/data/graph.ts` now loads profiles, projects and RE memberships in three
parallel queries and closes over Maps, because `OrgGraph`'s methods are
synchronous and get called in loops while walking trees. 18 tests, plus
`schema.test.ts` (below).

### Phase 1d — The rest of the data layer **[App — blocked on keys]**

The remaining app-side Phase 1 work is: replace the other
12 `lib/data/*` function bodies with real queries, then delete `lib/mock-data.ts`.

**Deliberately not done blind.** The kickoff says "one file at a time", and each
of these needs to be run against a real database to be worth anything — several
build heavy aggregates (`getMyWork`, `getDashboard`, `getFindWork`) that are a
rewrite of half the app's logic in SQL. Writing all twelve unverified would
produce code that looks finished and isn't.

**Unblocked by:** the Supabase URL and anon key in `.env.local`. That's it.

To reduce the risk when it does happen, `lib/data/schema.test.ts` parses
`supabase/migrations/*.sql` and asserts every column the code names actually
exists — so a typo or a renamed column fails `npm test` instead of becoming a 400
on a page nobody opens until launch day. **Add to `QUERIED_COLUMNS` in
`graph.ts` as you add queries.**

### Phase 1b — Auth, infrastructure side **[Infra — Kelvin]**

Everything here is his, and none of it blocks Anish.

**Status 2026-08-07:** Kelvin has the app hosted and data management set up, but
nothing of it is in the repo — `origin/main` is identical to local `main`, and his
last commit is `dbd685c`. That's expected: creating a Supabase project, running
migrations and setting env vars are dashboard actions that produce no commits.
What's needed from him isn't code, it's the two facts below.

**What Anish needs to unblock Phase 1d:**

1. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. Which of `0001`–`0006` have actually been applied

- Create the Supabase project
- Apply migrations `0001` → `0005` (all five are written and waiting)
- Google OAuth restricted to `stanford.edu`
- ~~Uncomment the bootstrap Co-Lead block in `0005`~~ — **superseded by
  `0006_bootstrap_co_lead.sql`**, which does the same thing for
  anish25@stanford.edu and is safe to run at any time, before or after his first
  sign-in, more than once. Written as a new migration rather than an edit to
  `0005` because `0005` may already have been applied, and editing an applied
  migration means the file no longer describes the database
- Load `seed.sql` (dev only)
- Vercel project and environment variables, including `NEXT_PUBLIC_APP_URL`

**His doc is `docs/INFRA.md`** — written so his AI agent can work from it without touching
app code.

**Two migrations are hard requirements**, both found by an audit rather than in production:

- `0004_rls_policies.sql` — the anon key ships in the browser bundle, and RLS is the only
  thing deciding what it can read. Without it the whole database is public.
- `0005_profile_provisioning.sql` — links auth users to profiles by email. Without it every
  sign-in dead-ends at `/auth/no-profile`, forever, for everyone.

The one thing to check when it's live: sign in, then refresh. If you're logged out, the
middleware matcher is wrong — that's the only cause.

### Phase 2 — Project discovery **[App]** ← *in progress, ship this to the club*

The phase that justifies the whole project. Everything else is plumbing.

- [x] **Project artifacts** — slides, GitHub, requirements, CAD, test reports. Grouped by
      kind, mostly links rather than uploads
- [x] **Find Work page** — every active project ranked by where a member would help most,
      with skill matching and the RE's contact on every card
- [x] **Ask-to-join** — a tracked request, visible as pending, escalating at 5 days
- [x] Follow / unfollow
- [x] RE actions: answer requests, add and remove members, assign deliverables

**Done 2026-08-07.** The writes did not wait for Postgres after all — they persist to a
local disk store (`lib/store/`), so the whole flow is usable and testable now and becomes
SQL when the keys land.

**Done when** a member can answer "what's happening in this club and who do I talk to?"
without asking a Co-Lead.

### Phase 3 — Hours logging ✅ **[App]**

Done 2026-08-07, except bulk week entry. Backdating is capped at 7 days and hours lock
once a submitted check-in has reported them, so a report a Lead has already read cannot
change underneath them.

Moved earlier — it's the highest-frequency action, it's satisfying to use, and it feeds
every later phase.

- Quick-add reachable from anywhere: project, hours, what you did
- Today pre-filled, last project pre-selected
- Bulk week entry for catching up
- Phone-first, because this happens in the lab
- Your own tier and progress toward Core

### Phase 4 — Deliverables and RE tooling ✅ **[App]**

Done 2026-08-07, except re-ordering and the deputy-RE prompt.

- [x] Create, assign, complete deliverables. Assigning to a non-member auto-adds them
- [x] **Two-step completion** — the owner marks `submitted`, an RE confirms `done`. Only
      `done` counts as delivered, which is what keeps that signal from being self-certified
- [x] Mark blocked with a reason (required — a blocker nobody can route is useless)
- [x] Unconfirmed work escalates on the same clock as an unread check-in, so a quiet RE
      freezing everyone's record is visible rather than silent
- [ ] Re-ordering; deputy-RE prompt

### Phase 5 — Terms calendar and re-enrollment **[App]**

Unglamorous, and what keeps Phase 2 trustworthy past one quarter.

- Co-Lead editor for terms, finals, breaks
- Obligations generate only on in-session weekdays
- **Quarterly re-enrollment sweep** — everyone re-confirms their projects at quarter start;
  unconfirmed memberships auto-close

Without it, rosters fill with zombie members and "who's on what" becomes a lie.

### Phase 6 — Blocker board **[App]**

- Club-wide "I need help" board, fed by blocked deliverables plus ad-hoc posts
- Anyone can answer, not just leadership
- Age-sorted so nothing rots quietly

Matters more now that joining goes through an RE: it gives a stuck member a second route to
being useful that doesn't wait on one person's inbox.

### Phase 7 — Updates and the review chain **[App]**

Highest-risk phase. **Paper-prototype first** — two weeks, eight volunteers, a Google Form,
zero code.

- Twice a week on member-chosen days, auto-drafted from hours and open deliverables
- **The RE responds per project section**, not the Lead — the RE has the context
- Lead gets an exception feed: missed updates, unanswered blockers, flat hours
- Academic pause with no penalty and no backlog
- Roll-ups from Leads to Co-Leads
- Escalating nudges, suppressed out of session

**Design target: a Lead's weekly obligation fits in 15 minutes.** The scarce resource is
leadership *reading*, not member writing.

### Phase 8 — Events, attendance, calendar **[App]**

- Event types with importance weighting
- Invitations from any Lead to anyone
- RSVP plus actual attendance, and fast check-in
- Drop-in attendance for build sessions — a QR code on the door, not an RSVP flow
- Opt-in iCal export, Google **and** Apple

### Phase 9 — Trainings and facility access **[App]**

Self-contained; move earlier if safety compliance gets urgent. Needs Anish's real machine
and lab list.

- Training catalog with expiry
- Member requests → Lead or Co-Lead verifies
- Certificate upload, viewable in one click
- Facility access: Robotics Room, Lab 64 24-hour, PRL
- **Progression ladder** — "one training away from Lab 64 access"

### Phase 10 — Leadership contribution view **[App]**

- Four signals per member, sorted and filtered
- Trend over time: improving or fading
- Co-Lead editor for the hours expectation and tier thresholds
- **Still no leaderboard**

### Phase 11 — Milestones **[App]**

- Name, target date, owner, status. Deliverables roll up into them
- Slip warnings when a dated deliverable pushes past a milestone

Explicitly **not** a critical-path Gantt. On a volunteer team availability swings with
midterms, the dates are wrong the day after entry, and a wrong schedule is worse than none
because people plan against it. 80% of the value for 5% of the work.

### Phase 12 — Purchase requests and budget **[App]**

**Deliberately late** — the club has working systems for this, so nothing breaks while it
lives elsewhere.

Worth building eventually: it's the operational bottleneck that blocks work most often, and
having it here would make the app the single source of truth. But it involves approvals and
money, which raises the stakes.

- Request → approved → ordered → received, with reimbursement status
- Per-division budget rollup

### Later

- Slack/Discord bot for reminders and new open needs
- Mobile PWA polish, offline hour logging
- Alumni and year-archive views
- Decision log, inventory, flight and safety log — see `PRODUCT_REVIEW.md` §10

---

## Explicitly not planned

| Not building | Why |
|---|---|
| Critical-path Gantt | Fiction on a volunteer team. Milestones cover it |
| Composite engagement score | Ranked people absurdly. Four separate signals are honest |
| Leaderboard | Turns a description of someone's work into a target |
| Self-enrollment | REs own staffing. Ask-to-join preserves discovery without it |
| Project commitment cap | Unnecessary once a human approves each addition |

Each was considered and rejected for reasons recorded in `DECISIONS.md` and
`PRODUCT_REVIEW.md`. Re-opening any is fine — read the reasoning first.

---

## Realistic pace

Phases 2–4 in one quarter is achievable. **Phases 2–6 over two quarters** is the honest
target, and it's enough: discovery, hours, deliverables, an honest roster and a help board
is the majority of the value.

Phases 10–12 may never happen. Better to say that now than to experience the app as
permanently unfinished.

---

## Before the club ever logs in

None of this is code, and all of it matters more than any single feature.

1. **Data-entry day.** The app is empty on day one, and an empty project tree is worse than
   a Google Doc. Someone must enter 5 divisions, ~20 projects, 35 members, current REs and
   each person's deliverables. That's 4–8 hours. Assign it to the **Co-Leads, not Anish**,
   in one room, before launch.
2. **Kill one incumbent completely.** If the project list still lives in Notion, this app is
   a second place to look and it dies. Move one thing entirely and delete the old one.
3. **Launch ritual.** Twenty minutes at a general meeting where all 35 people sign in and
   fill their profile *in the room, on their phones*.
4. **Pilot one division first.** Seven people, three weeks. Success test: do they log in
   *unprompted* twice a week?
5. **Write down what success means.** e.g. 70% unprompted weekly logins, 60% on-time
   check-ins, autumn-to-winter retention up from X to Y.
6. **Talk to eight people** — five who left last year, three who stayed. Fifteen minutes
   each. Cheapest, highest-value research available, and it may reorder this list.
