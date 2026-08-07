# Sky Runners App — Project Plan

**Version:** 1.0 · **Date:** 2026-08-06 · **Author:** Anish Bayya + Claude

---

## 1. The actual problem

Stanford UAV loses members to **disorganization**. That's the stated root cause, and
it's the thing to design against. Everything in this plan traces back to one of three
failure modes:

| Failure mode | What it looks like today | What the app must do |
|---|---|---|
| **Members can't find work** | You have to ask a co-lead "what should I do?" | Make all work across the club browsable and joinable without permission-seeking |
| **Leaders can't see effort** | No idea who's contributing or coasting | Make contribution visible without manual chasing |
| **Updates don't flow** | Progress lives in people's heads and DMs | Make the update → review → roll-up chain the path of least resistance |

**Design principle that follows:** *transparency by default.* Almost everything is
readable by every member. Restrictions apply to **writes** and to a small set of
**leadership-only views** (individual hour totals, update contents, private lead notes). This is both what the
club needs and, conveniently, a much simpler security model than the alternative.

**Second design principle:** *a new member must be productive in under 5 minutes
with no training.* You said scalability across members who need to learn it fast is
the most important thing. Concretely that means: no empty states without a next
action, no jargon without a tooltip, and every high-frequency action (log hours,
submit update) reachable in one click from anywhere.

---

## 2. Stack recommendation — and why not Python

You said you're most comfortable in Python but deferred to me. **My recommendation is
to skip Python for this project.** Here's the honest reasoning, because you should be
able to push back on it:

**The argument against Python here isn't that Python is worse.** It's that you've
already committed to React on the frontend, which means TypeScript is non-negotiable —
you *will* be learning it. Adding a Python backend means learning TypeScript **and**
maintaining a second language, a second server, a second deployment, and the API
contract between them. For a solo beginner building something this large, that's the
single biggest risk to ever shipping it.

Python's real advantages — data science, ML, scientific computing — aren't the
bottleneck here. Your hardest problems are *nested tree queries*, *permissions*, and
*UI density*. Postgres handles the first, and the other two live in the frontend.

**If you later need real analytics** (contribution modeling, forecasting), add a small
Python service then, for exactly that. That door stays open.

### Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15** (App Router) + TypeScript | One codebase for UI and API. Server Components keep data fetching simple. |
| Styling | **Tailwind CSS** + shadcn/ui | shadcn gives you accessible, good-looking components you own and can edit — critical for the UI density this app needs |
| Database | **Postgres** (via Supabase) | Recursive CTEs handle your nested teams/projects natively. This is the killer feature for your data model. |
| Auth | **Supabase Auth**, Google OAuth, `stanford.edu` domain restriction | Satisfies "only Stanford members" almost for free. No password management. |
| File storage | **Supabase Storage** | Certificates, presentations, CAD, test reports |
| Email | **Resend** | Missed-deadline nudges, event invites, member invites |
| Scheduled jobs | **Vercel Cron** → API route | Deadline checks, digest emails |
| Charts | **Recharts** | Hours trends over time |
| Gantt | Custom (CSS grid + SVG) — evaluate `frappe-gantt` first | Your nested-project Gantt is unusual; off-the-shelf libraries may fight you. Prototype with frappe-gantt, replace if it doesn't nest well. |
| Hosting | **Vercel** | Your teammate owns this call — see `DECISIONS.md` |

### Data access pattern

Use the **Supabase client with Row Level Security for reads**, and **Next.js Server
Actions with a single central permission module for writes**.

Reasoning: your read model is mostly open (transparency by default), so RLS read
policies stay simple and give you defense-in-depth. Your *write* permissions are
genuinely complex (RE authority inherits down the project tree), and that logic is
far easier to get right, test, and debug in one auditable TypeScript module than
spread across SQL policies.

> Avoid Prisma here. Prisma connects as a privileged user and bypasses RLS, which
> quietly defeats the read protection. If you want typed queries beyond the Supabase
> client, use Drizzle.

---

## 3. Roles and terminology

### Global roles

| Role | Who | Club-facing name |
|---|---|---|
| `co_lead` | Team co-leads | **Co-Lead** |
| `lead` | Formerly "Managers" | **Team Lead** (shortened to "Lead" in prose) |
| `member` | Everyone else | **Member** |

**Decided:** the middle role is **Team Lead**. It should carry manager-like weight —
these people review updates, check in with their reports multiple times a week, and
roll reporting up the chain. "Lead" in running text, "Team Lead" as the formal label.

### Project-scoped role

**RE (Responsible Engineer)** — keep this term, it's already club vocabulary and it
carries real meaning: the go-to person accountable for deliverables.

RE authority is **inherited downward**. An RE of a project can act on that project
*and every project nested beneath it*: add members, create sub-projects, appoint REs
for those sub-projects, upload artifacts, manage deliverables.

### Two independent hierarchies — this is the key structural insight

Your description contains **two separate trees that must not be conflated**:

```
ORG TREE (who reports to whom)          PROJECT TREE (what work exists)
─────────────────────────────           ──────────────────────────────
Division: Fixed Wing eVTOL              Project: eVTOL Airframe v2
└── Sub-team: Structures                └── Project: Wing Spar Redesign
    └── Sub-sub-team: Composites            ├── Project: Layup Process
                                            └── Project: Load Testing
Each unit has a Lead.                 Each project has an RE.
Each member has ONE direct Lead.      Members join projects freely.
```

A member's Lead is **not** necessarily the RE of the projects they work on. Someone
in Structures might contribute to a SkyDelta software project. Keeping these separate
is what lets people work across divisions — which is exactly the cross-pollination
you want. Merging them would quietly rebuild the silos you're trying to remove.

---

## 4. Permissions

| Action | Who can do it |
|---|---|
| Configure divisions | Co-Lead only |
| Create sub-teams / sub-sub-teams | Division RE, or Lead of the parent unit |
| Assign a unit's Lead | Lead one level up, or Co-Lead |
| Reassign a member's Lead | The Lead one level above both, or Co-Lead |
| Create a project under a unit | Any Lead of that unit or above |
| Create a nested sub-project | RE of the parent project (inherited authority) |
| Appoint an RE (multiple allowed per project) | RE of that project or any ancestor, or Co-Lead |
| Add a member to a project | RE of that project or any ancestor project |
| **Follow a project** | **Any member, unlimited** |
| **Ask to join a project** | **Any member, any project** |
| **Add a member to a project** | **RE of that project or any ancestor, or Co-Lead — members cannot add themselves** |
| Accept or decline a join request | RE of that project or any ancestor, or Co-Lead |
| Log own hours | Any member |
| Submit own update | Any member |
| Set own update schedule | Any member |
| Review an update | The author's direct Lead, the RE of a referenced project, or any ancestor Lead |
| Submit a roll-up report | Any Lead, to their own Lead or a Co-Lead |
| Create an event | Any Lead or Co-Lead |
| Invite anyone to an event | Any Lead or Co-Lead — deliberately not scope-limited, per your requirement |
| Record event attendance | Event creator, any Lead, Co-Lead |
| Invite a new member by email | Any Lead or Co-Lead |
| Verify a training / grant access record | Co-Lead, or a Lead designated as a trainer |
| Configure hours expectation and tiers | Co-Lead only |
| **View own contribution record** | **Every member, always** |
| View another member's record | Their Lead chain, REs of projects they contribute to, Co-Leads |
| Manage the academic calendar | Co-Lead only |
| Manage a project's deliverables | RE of that project or any ancestor, Co-Lead |
| Update a deliverable's status | Its owner, or any RE above it |
| View anyone's profile, projects, hours, updates | Any member — transparency default |

> **A note on that last row.** Making hours and updates visible to all members is a
> real culture decision, not just a technical one. It drives the accountability and
> discoverability you want, and it's how many strong student teams run. But it can also
> make slower contributors feel surveilled, which cuts against your retention goal.
> A middle path: everyone sees *project* activity and *who's on what*, while raw
> individual hour totals and update contents stay leadership-only. I'd suggest
> starting there — it's easier to open up later than to walk back.

---

## 5. Feature areas

### 5.1 Member profile — the leadership one-pager

Everything you listed, at a glance:

- **Header** — photo, name, class year, division/sub-team, Lead, contact, join date
- **Trainings & certifications** — machine shop, lab equipment, safety, Stanford online
  courses. Each with completion date, expiry if applicable, and a **certificate file**
  viewable in one click
- **Facility access** — Robotics Room keycard, Lab 64 24-hour access, PRL, etc., with
  status and expiry. Answers "can this person work unsupervised at 2am?" instantly
- **Projects** — every project they're on, and **what they're responsible for** on each
- **Update history** — their twice-weekly updates, with on-time / late / missed status
- **Contribution record** — deliverables finished, hours tier, update reliability

### 5.2 Hours logging — optimize this ruthlessly

You said this must be *really easy*. It's the highest-frequency action in the app, so
friction here kills adoption of everything else.

- Persistent quick-add button in the nav, reachable from any page
- Defaults: today's date, most recent project pre-selected
- Three fields: project, hours, what you did — and only the first two required
- Bulk week entry for people catching up
- Optional timer for live sessions in the shop
- Phone-friendly from day one, since this happens in the lab, not at a desk

### 5.3 Progress updates and the review chain

The core workflow:

```
Member submits update  →  Lead reviews & comments  →  Lead rolls up to Co-Leads
      ↑ nudged if late        ↑ nudged if unreviewed        ↑ periodic digest
```

- Member picks their own update days
- **One section per project**, not one blob of text. A member on three projects writes
  three short sections, each labeled with its project and pre-filled with the hours
  logged there. Without this, "finished the layup, waiting on parts" is ambiguous to a
  Lead who oversees several of that person's projects, and an RE can't tell whether a
  blocker is theirs to clear
- Blockers route to that project's REs automatically, via the entry's `project_id`
- Structured per section: progress, blockers, next steps, hours
- Auto-populated draft: pre-fills projects and hours from their logged work, so the
  update is mostly *confirming* rather than *recalling*. This single feature will do
  more for submission rates than any reminder
- Lead review queue with comments
- Roll-up reports: a Lead's dashboard aggregates their reports' updates into a
  draftable summary for the chain of command
- Escalating notifications: in-app on due date, email the day after, Lead notified
  if still missing

**Cadence: two updates per week**, on weekdays each member chooses.

> **One thing to watch once this is live.** Three written check-ins a week is a real
> ask for a student on top of coursework, and update fatigue would undercut the
> retention you're trying to fix. Two safeguards are built in: the auto-populated draft
> means most submissions are a few clicks rather than a writing task, and
> `updates_per_week` is configurable rather than hardcoded — so if compliance sags after
> a term, you can dial it to two without a schema change. Watch the on-time rate in the
> first month; if it drops below roughly 70%, the cadence is likely the cause rather
> than the people.

### 5.3a "My Work" — the member's home

Members land here, not on the leadership dashboard. Everything they need in one place:

- **Their projects**, REs listed first, each showing the division › parent › project
  trail so multi-project membership stays legible at a glance
- **What they own** on each project, from `project_members.responsibility`
- **Who to ask** — the project's REs, with one-click email. A stated requirement: it must
  be easy to find the RE
- **Hours logged per project**, and their last update about that specific project
- **The update they owe**, already split into per-project sections with hours pre-filled

The design goal is that a member never has to reconstruct context. Open the app, see the
three things you're working on, see what you said last time about each, write two lines
under each, done.

### 5.4 Project tree and discovery

The answer to "what should I work on?"

- Browsable tree: Division → sub-teams → projects → nested sub-projects
- Every project shows: RE, members and their responsibilities, status, dates, recent
  activity, artifacts, open roles
- **"Open to join" flag** — RE-controlled. Browse and join without asking anyone
- A **"find work" view**: open projects filtered by skill area and time commitment.
  This is the feature that directly replaces "go ask a co-lead"
- Artifacts per project: presentations, GitHub paths, engineering requirements, CAD,
  test reports

### 5.5 Auto-generated Gantt charts

Derived, never hand-maintained — that's what makes it stay accurate.

- **Rows follow the project tree.** Parent projects are collapsible summary bars
- **Parent dates roll up automatically** from children: earliest start, latest end,
  unless an RE explicitly overrides
- Tasks appear as bars within their project
- Dependencies drawn between tasks (finish-to-start, plus start-to-start and
  finish-to-finish for completeness)
- Milestones as diamonds
- **Critical path highlighting** and slip warnings when a dependency pushes a
  downstream milestone past its target
- Views scoped to a division, a project subtree, or the whole club

### 5.6 Events, attendance, and weighting

- Event types: design review, company tour, company visit, build session, general
  meeting, social
- **Importance weight** per event, set by leadership — feeds contribution tracking, so a
  design review counts for more than a social
- Any Lead or Co-Lead can invite anyone, regardless of division
- RSVP plus actual attendance (they differ, and the gap is itself informative)
- Fast check-in for the person running the event

### 5.7 Calendar and meeting scheduling

- Unified club calendar: events, meetings, update due dates, project milestones
- Filter by division, project, or "just mine"
- Member-to-member meeting requests with availability, so 1:1s don't require Slack
  archaeology
- Subscribable via iCal feed so it lands in people's existing Google Calendar —
  meeting people where they already are

### 5.8 Contribution tracking

Implemented in `lib/contribution.ts`, tested as **personas** in
`lib/contribution.test.ts` — because the previous composite score passed every property
test it had while ranking an absent member almost as high as a reliable contributor.

### Four signals, no composite number

Anish's framing, which is better than the score it replaced:

> "We don't really need to see a score. We just need to see that members are being
> dedicated, and that they know their efforts are being tracked and not wasted."

| Signal | What it is | Notes |
|---|---|---|
| **Delivered** | Deliverables finished, projects carried to completion | **Primary.** Finished work is the only thing that can't be inflated |
| **Commitment** | Hours/week against the 10–12 hr expectation, as a named tier | Context, not achievement. Twelve hours with nothing shipped isn't a strong quarter |
| **Reliability** | Updates submitted on time | Being predictable is what lets others depend on you |
| **Scope** | RE roles held, projects committed to | **Reported, never blended in** |

**A single number invites optimization. Four columns invite judgment.**

### Rules the tests lock in

- No composite score exists anywhere in the returned record
- A component with no data returns `null`, never `0` — nobody is punished for data that
  doesn't exist
- An absent member cannot approach a contributing member's standing
- Hours alone cannot make someone look productive
- Holding three RE titles cannot disguise weak delivery
- The published rubric leads with Delivered

### Commitment tiers, not grades

| Tier | Hours/week |
|---|---|
| **Core** | 12+ |
| **Committed** | 8–12 |
| **Contributing** | 4–8 |
| **Getting started** | under 4 |
| **On academic pause** | nothing counted, nothing owed |

Tiers are rungs on a ladder. "You're Contributing at 6.5 hrs/week; Core is 12+" gives
someone somewhere to go. "You scored 54" gives them a verdict.

> **The honest tradeoff on the 10–12 hour bar.** That's roughly a part-time job on top of
> a Stanford course load. Serious teams do run this way and it produces excellent results
> — but it works by **self-selection**, so it has to be stated at recruiting, never
> discovered in week six. And it will shrink the club toward its committed core. That may
> be exactly what "high class team" means, but it is a different goal from "stop people
> quitting," and the two can pull against each other. Worth choosing deliberately.

### Guardrails

- **Members see their own record.** Weights, tiers and the leadership rubric are published
  at `/how-we-lead`. Nothing that affects someone's standing is hidden from them
- **No ranking function exists**, deliberately. The data supports one; it's absent because
  the moment a leaderboard exists these numbers stop describing work and become a target
- Leadership reads the four columns next to the member's actual projects, where numbers can
  be interpreted rather than merely compared

### 5.8a Deliverables — the whole task model

One flat list per project. Four fields: **title, one owner, a due date, a status.**

No dependencies, no sub-tasks, no critical path. That design would cost an RE an hour a
week, and on a volunteer team whose availability swings with midterms the dependency graph
is wrong the day after it's entered — and a wrong schedule is worse than none, because
people plan against it.

What five minutes of RE upkeep a week buys:

- Every member sees exactly what they own, on My Work and on the project
- Update drafts pre-fill from open deliverables
- Project progress is a real percentage
- "Projects completed" becomes a trustworthy leadership signal
- Dated deliverables give an honest timeline **without a Gantt chart**

**Exactly one owner, always.** Shared ownership means nobody owns it.

### 5.9 Onboarding and invitations

- Lead or Co-Lead invites by `@stanford.edu` email
- Invite carries a pre-assigned division, sub-team, and Lead, so nobody lands nowhere
- Google sign-in only, `stanford.edu` enforced — satisfies "Stanford members only"
- Guided first-run: fill profile → declare trainings → browse open projects → join one.
  A new member's first session should end with them on a project

---

## 6. Build phases

> **Superseded by `PHASE_PLAN.md`**, which is the current ordering. Kept here for the
> reasoning behind vertical slices.

Each phase is a **vertical slice** — a working, usable feature end to end — rather than
"all the UI, then all the backend." You'll have something demoable to the club early,
which is how you get feedback while it's still cheap to act on.

| Phase | Deliverable | Why this order |
|---|---|---|
| **0** | Scaffold, Stanford Google auth, empty shell + nav | Nothing works without auth |
| **1** | Org tree (divisions, nested teams), member roster, profiles, Lead assignment | Everything references people and units |
| **2** | Project tree, membership, responsibilities, browse + join, artifacts | The discoverability payload — the core value |
| **3** | Hours logging + quick-add | Highest frequency, immediately useful, generates data for later phases |
| **4** | Updates, review queue, roll-ups, notifications | The workflow that fixes the reporting chain |
| **5** | Events, invitations, attendance, calendar | Depends on people + weighting |
| **6** | Tasks, dependencies, milestones, auto-Gantt | Richest feature; needs the project tree solid first |
| **7** | Trainings, certifications, facility access on profiles | Self-contained, can slot earlier if urgent |
| **8** | Contribution tracking, weights config, leadership dashboard | Needs phases 3–6 producing real data first |
| **9** | Mobile/PWA polish, offline hour logging | Responsive throughout, dedicated pass at the end |

**Ship Phase 2 to the club as soon as it works.** Project discoverability alone
addresses your biggest problem, and real usage will reshape everything after it.

---

## 7. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Scope** | This is genuinely a large app — more than most 2-person student projects finish | Phase gates. Ship Phase 2 standalone. Resist building 6 and 8 early, however fun the Gantt is |
| **Adoption** | A perfect app nobody opens changes nothing | Obsess over hours-logging friction. Auto-draft updates. Get 3 members using Phase 2 before building Phase 3 |
| **Solo learning curve** | You're new to coding and this is a real system | One language. Copy patterns between phases. Each phase teaches what the next needs |
| **Permission bugs** | Nested inherited RE authority is the trickiest logic here | One central permission module, unit-tested, with the project-tree cases written first |
| **Metric gaming** | Visible scores distort behavior | Weight outcomes over hours; frame as conversation input |
| **Turnover** | Club members graduate; this app must outlive you | Document as you go. `CLAUDE.md` keeps future contributors and AI agents oriented |

---

## 8. Resolved

| Question | Answer |
|---|---|
| Update cadence | **Two per week**, on weekdays each member picks |
| Middle role name | **Team Lead** — should feel manager-like |
| Hours & update visibility | **Restricted.** REs of projects the member contributes to, plus their Lead chain. Project activity and who's-on-what stays public |
| Divisions | Fixed Wing eVTOL, SkyBeta, Spade, DroneHacks, SkyDelta — **all editable, addable, removable by Co-Leads in the UI** |
| Club size | 30–40 members, growing. Contribution history is never deleted, even for departed members |
| REs per project | **Multiple allowed.** One primary as the go-to contact |
| Project enrollment | **Open by default.** Members join anything that interests them |
| Project status | Lifecycle **phase** (concept → flight test) plus **health** (on track / at risk / blocked) |
| Update review access | Ancestor REs up the project chain, plus the member's Lead chain |
| Training verification | Member submits a request; their direct Lead or a Co-Lead verifies |
| Breadth reward | **None.** Cross-division work is a member's own choice |
| Calendar sync | **Opt-in only**, and must support Apple Calendar as well as Google |
| Competition dates | None yet. Project deadlines settable at any time; REs get reminders |
| Contribution philosophy | Four separate signals, no composite score. Delivered work leads |

### Still to gather, when we reach those phases

- **Trainings to seed** — Anish will supply the machine and lab list during the design
  cycle for Phase 7
- **Facility access types** — same
- Whether to keep breadth at zero weight after a term of real data

---

## 9. Next actions

1. ~~Answer the blocking questions~~ — done
2. ~~Scaffold Phase 0~~ — done. `npm install && npm run dev`
3. Set up Supabase (Anish for dev; teammate handles production)
4. Wire real auth, replacing the mock session in `app/layout.tsx`
5. Build Phase 1: org tree, roster, profiles, Lead assignment

See `DATA_MODEL.md` for the schema and `DECISIONS.md` for infrastructure notes.
