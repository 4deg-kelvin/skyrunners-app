# Phase Plan

**Updated:** 2026-08-06, after the product review. Supersedes the phase table in
`PROJECT_PLAN.md`.

Each phase is a **vertical slice** — a working feature end to end, not "all the UI then
all the backend." Ordering is driven by two questions: *what does the club feel the
absence of most?* and *what prevents the data from rotting?*

---

## Done

### Phase 0 — Foundation ✅

App shell, design system from the reference UI, My Work, leadership dashboard, project
tree with detail pages, roster with profiles, calendar. Underneath: the `lib/data` async
boundary, the tested permission module, deliverables, the contribution record, an academic
terms model, RE liveness detection, join requests, ESLint + Prettier + CI, and the full
Postgres schema as three migrations.

Running on mock data. 68 tests passing.

---

## Next

### Phase 1 — Auth and real data ← **starting now**

The one phase with no visible payoff and no way around it.

- Supabase project, `0001`–`0003` migrations applied, seed loaded
- Google OAuth restricted to `stanford.edu`
- **`middleware.ts`** for session refresh — `@supabase/ssr` requires it and auth will not
  work without it
- `0004_rls_policies.sql`
- Replace `getViewer()` and the `lib/data/*` bodies with real queries, signatures unchanged
- Invite flow: Lead or Co-Lead invites by Stanford email
- Delete `lib/mock-data.ts`

**Done when** two real people can sign in and see themselves in the roster.

### Phase 2 — Project discovery ← **ship this to the club**

The phase that justifies the whole project. Everything before it is plumbing.

- Project artifacts: presentations, GitHub links, requirements, test reports
- **Ask-to-join flow**, with the RE's queue and stale-request escalation
- Follow / unfollow
- "Find work" view: open needs across the club, filtered by skill area
- RE actions: add and remove members, set responsibilities

**Done when** a member can answer "what's happening in this club and who do I talk to?"
without asking a Co-Lead. That alone addresses the root problem.

### Phase 3 — Academic calendar and re-enrollment

Unglamorous, and the thing that keeps Phase 2 trustworthy for more than one quarter.

- Co-Lead editor for terms, finals, breaks
- Obligations generate only on in-session weekdays
- **Quarterly re-enrollment sweep** — everyone re-confirms their projects at quarter
  start; unconfirmed memberships auto-close

Without this, rosters accumulate zombie members and "who's on what" becomes a lie within
two quarters — which destroys confidence in the one part that was working.

### Phase 4 — Hours logging

- Quick-add reachable from anywhere: project, hours, what you did
- Today pre-filled, last project pre-selected
- Bulk week entry for catching up
- Phone-first, because this happens in the lab
- Member's own tier and progress toward Core

Highest-frequency action in the app, and it feeds everything after it.

### Phase 5 — Deliverables and RE tooling

- Create, assign, re-order, complete deliverables
- Mark blocked with a reason
- RE liveness alerts: quiet RE, stale blockers, overdue deliverables
- Deputy-RE prompt on any project with sub-projects

### Phase 6 — Blocker board

Promoted from "later" — it matters more now that joining goes through an RE.

- Club-wide "I need help" board fed by blocked deliverables and ad-hoc posts
- Anyone can answer, not just leadership
- Age-sorted, so nothing rots quietly

Three things at once: unblocks people in hours instead of at their next update, gives a
second answer to "I have nothing to do", and creates the only place in the app where
members visibly help each other.

### Phase 7 — Updates and the review chain

Highest-risk phase. **Paper-prototype it first** — two weeks, eight volunteers, a Google
Form, zero code.

- Two per week, member-chosen days, auto-drafted from hours and open deliverables
- **RE responds per project section**, not the Lead — the RE has the context
- Lead sees an exception feed: missed updates, unanswered blockers, flat hours
- Academic pause with no penalty and no backlog
- Roll-ups from Leads to Co-Leads
- Escalating nudges, suppressed out of session

**Design target: a Lead's weekly obligation fits in 15 minutes.** The scarce resource is
leadership reading, not member writing.

### Phase 8 — Events, attendance, calendar

- Event types with importance weighting
- Invitations from any Lead to anyone
- RSVP plus actual attendance, and fast check-in
- Drop-in attendance for build sessions — a QR code on the door, not an RSVP flow
- Opt-in iCal export, Google **and** Apple

### Phase 9 — Trainings and facility access

Self-contained; can move earlier if safety compliance gets urgent. Needs Anish's real
machine and lab list.

- Training catalog with expiry
- Member requests → Lead or Co-Lead verifies
- Certificate upload, viewable in one click
- Facility access: Robotics Room, Lab 64 24-hour, PRL
- **Progression ladder** — "one training away from Lab 64 access"

### Phase 10 — Leadership contribution view

- Four signals per member, sorted and filtered
- Trend over time: improving or fading
- Co-Lead editor for the hours expectation and tier thresholds
- **Still no leaderboard**

### Phase 11 — Milestones

- Name, target date, owner, status. Deliverables roll up into them
- Slip warnings when a dated deliverable pushes past a milestone

Explicitly **not** a critical-path Gantt. On a volunteer team, availability swings with
midterms, the dates are wrong the day after entry, and a wrong schedule is worse than none
because people plan against it. This is 80% of the value for 5% of the work.

### Phase 12 — Purchase requests and budget

**Deliberately late** — the club has other systems for this, and they work.

Worth building eventually because it's the operational bottleneck that blocks work most
often, and having it here would make the app the single source of truth. But it involves
approval and money, which raises the stakes, and nothing breaks while it lives elsewhere.

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
| Composite engagement score | Ranked people absurdly; four separate signals are honest |
| Leaderboard | Turns a description of someone's work into a target |
| Self-enrollment | REs own staffing. Ask-to-join preserves discovery without it |
| Project commitment cap | Unnecessary once a human approves each addition |

Each was considered and rejected for reasons recorded in `DECISIONS.md` and
`PRODUCT_REVIEW.md`. Re-opening any of them is fine — just read the reasoning first.

---

## Realistic pace

A solo beginner alongside a Stanford course load ships **Phases 1–4 in two quarters** if
things go well. That's the honest number, and it's enough: Phases 1–4 give the club
project discovery, an honest roster, and hours tracking, which is the majority of the
value.

Phases 10–12 may never happen. That's fine, and it's better to say so now than to
experience the app as permanently unfinished.

---

## Before the club ever logs in

None of this is code, and all of it matters more than any single feature.

1. **Data-entry day.** The app is empty on day one, and an empty project tree is worse
   than a Google Doc. Someone must enter 5 divisions, ~20 projects, 35 members, current
   REs, and each person's deliverables. That's 4–8 hours. Assign it to the **Co-Leads, not
   Anish**, in one room, before launch.
2. **Kill one incumbent completely.** If the project list still lives in Notion, this app
   is a second place to look and it dies. Move one thing entirely and delete the old one.
3. **Launch ritual.** Twenty minutes at a general meeting where all 35 people sign in and
   fill their profile *in the room, on their phones*. Anyone who leaves without an account
   probably never makes one.
4. **Pilot one division first.** Seven people, three weeks. Success test: do they log in
   *unprompted* twice a week?
5. **Write down what success means.** e.g. 70% unprompted weekly logins, 60% on-time
   updates, autumn-to-winter retention up from X to Y. Without a target you won't know
   whether to keep going.
6. **Talk to eight people** — five who quit last year, three who stayed. Fifteen minutes
   each. The cheapest, highest-value research available, and it may reorder this list.
