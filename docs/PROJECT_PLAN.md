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
| **Leaders can't see effort** | No idea who's contributing or coasting | Make contribution visible and rankable without manual chasing |
| **Updates don't flow** | Progress lives in people's heads and DMs | Make the update → review → roll-up chain the path of least resistance |

**Design principle that follows:** *transparency by default.* Almost everything is
readable by every member. Restrictions apply to **writes** and to a small set of
**leadership-only views** (engagement rankings, mentor notes). This is both what the
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

**If you later need real analytics** (engagement modeling, forecasting), add a small
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
| Charts | **Recharts** | Engagement trends, hours over time |
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
| `admin` | Team co-leads | **Co-Lead** |
| `mentor` | Your "Managers" | **Mentor** ← *needs your confirmation* |
| `member` | Everyone else | **Member** |

**On the "Manager" rename:** I went with **Mentor** because it accurately describes
the duty you wrote — checking in multiple times a week, reviewing updates, supporting
people — and because "Lead" would collide with "Co-Lead." Alternatives if you'd rather:

- **Crew Chief** — aviation-native, fits Sky Runners, slightly playful
- **Section Lead** — clearer hierarchy, more corporate
- **Advisor** — softer, less authoritative than reality

This is a one-line change now and a find-and-replace nightmare later, so decide before
Phase 1.

### Project-scoped role

**RE (Responsible Engineer)** — keep this term, it's already club vocabulary and it
carries real meaning: the go-to person accountable for deliverables.

RE authority is **inherited downward**. An RE of a project can act on that project
*and every project nested beneath it*: add members, create sub-projects, appoint REs
for those sub-projects, upload artifacts, manage tasks.

### Two independent hierarchies — this is the key structural insight

Your description contains **two separate trees that must not be conflated**:

```
ORG TREE (who reports to whom)          PROJECT TREE (what work exists)
─────────────────────────────           ──────────────────────────────
Division: Fixed Wing eVTOL              Project: eVTOL Airframe v2
└── Sub-team: Structures                └── Project: Wing Spar Redesign
    └── Sub-sub-team: Composites            ├── Project: Layup Process
                                            └── Project: Load Testing
Each unit has a Mentor.                 Each project has an RE.
Each member has ONE direct Mentor.      Members join projects freely.
```

A member's Mentor is **not** necessarily the RE of the projects they work on. Someone
in Structures might contribute to a SkyDelta software project. Keeping these separate
is what lets people work across divisions — which is exactly the cross-pollination
you want. Merging them would quietly rebuild the silos you're trying to remove.

---

## 4. Permissions

| Action | Who can do it |
|---|---|
| Configure divisions | Co-Lead only |
| Create sub-teams / sub-sub-teams | Division RE, or Mentor of the parent unit |
| Assign a unit's Mentor | Mentor one level up, or Co-Lead |
| Reassign a member's Mentor | The Mentor one level above both, or Co-Lead |
| Create a project under a unit | Any Mentor of that unit or above |
| Create a nested sub-project | RE of the parent project (inherited authority) |
| Appoint an RE | RE of the parent project, or Co-Lead |
| Add a member to a project | RE of that project or any ancestor project |
| **Join an open project** | **Any member, if the RE marked it open** |
| Log own hours | Any member |
| Submit own update | Any member |
| Set own update schedule | Any member |
| Review an update | The author's direct Mentor, the RE of a referenced project, or any ancestor Mentor |
| Submit a roll-up report | Any Mentor, to their own Mentor or a Co-Lead |
| Create an event | Any Mentor or Co-Lead |
| Invite anyone to an event | Any Mentor or Co-Lead — deliberately not scope-limited, per your requirement |
| Record event attendance | Event creator, any Mentor, Co-Lead |
| Invite a new member by email | Any Mentor or Co-Lead |
| Verify a training / grant access record | Co-Lead, or a Mentor designated as a trainer |
| Configure engagement weights | Co-Lead only |
| **View engagement rankings** | **Mentors (own reports) and Co-Leads (everyone)** |
| View anyone's profile, projects, hours, updates | Any member — transparency default |

> **A note on that last row.** Making hours and updates visible to all members is a
> real culture decision, not just a technical one. It drives the accountability and
> discoverability you want, and it's how many strong student teams run. But it can also
> make slower contributors feel surveilled, which cuts against your retention goal.
> A middle path: everyone sees *project* activity and *who's on what*, while raw
> individual hour totals and engagement ranks stay leadership-only. I'd suggest
> starting there — it's easier to open up later than to walk back.

---

## 5. Feature areas

### 5.1 Member profile — the leadership one-pager

Everything you listed, at a glance:

- **Header** — photo, name, class year, division/sub-team, Mentor, contact, join date
- **Trainings & certifications** — machine shop, lab equipment, safety, Stanford online
  courses. Each with completion date, expiry if applicable, and a **certificate file**
  viewable in one click
- **Facility access** — Robotics Room keycard, Lab 64 24-hour access, PRL, etc., with
  status and expiry. Answers "can this person work unsupervised at 2am?" instantly
- **Projects** — every project they're on, and **what they're responsible for** on each
- **Update history** — their tri-weekly updates, with on-time / late / missed status
- **Engagement snapshot** — hours trend, update reliability, event attendance

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
Member submits update  →  Mentor reviews & comments  →  Mentor rolls up to Co-Leads
      ↑ nudged if late        ↑ nudged if unreviewed        ↑ periodic digest
```

- Member picks their own update days
- Structured fields: progress, blockers, next steps, hours summary, projects touched
- Auto-populated draft: pre-fills projects and hours from their logged work, so the
  update is mostly *confirming* rather than *recalling*. This single feature will do
  more for submission rates than any reminder
- Mentor review queue with comments
- Roll-up reports: a Mentor's dashboard aggregates their reports' updates into a
  draftable summary for the chain of command
- Escalating notifications: in-app on due date, email the day after, Mentor notified
  if still missing

> **Open question — "tri-weekly" is ambiguous.** Your wording ("a 3 weekly update",
> "tri-weekly update days" plural) could mean *3 times per week* or *once every 3
> weeks*, and later you wrote "weekly updates." Three written updates per week is a
> heavy ask for students and risks the exact burnout that causes quitting; once every
> three weeks may be too slow to catch problems.
>
> **I've designed the schedule as fully configurable** — cadence type plus chosen
> weekdays — so any interpretation works and you can tune it after a term of real use.
> But tell me what you actually meant so the defaults and copy are right.

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
- **Importance weight** per event, set by leadership — feeds engagement scoring, so a
  design review counts for more than a social
- Any Mentor or Co-Lead can invite anyone, regardless of division
- RSVP plus actual attendance (they differ, and the gap is itself informative)
- Fast check-in for the person running the event

### 5.7 Calendar and meeting scheduling

- Unified club calendar: events, meetings, update due dates, project milestones
- Filter by division, project, or "just mine"
- Member-to-member meeting requests with availability, so 1:1s don't require Slack
  archaeology
- Subscribable via iCal feed so it lands in people's existing Google Calendar —
  meeting people where they already are

### 5.8 Engagement scoring

Configurable weighted score, since the right formula isn't knowable in advance:

| Signal | Notes |
|---|---|
| Hours logged | Consider diminishing returns so it doesn't become a race |
| Update on-time rate | Reliability, not just volume |
| Event attendance | Weighted by that event's importance |
| Task completion | Delivered vs. assigned |
| Breadth | Cross-division contribution, if you want to reward it |
| RE responsibility | Carrying accountability is itself contribution |

- Co-Leads tune weights in the UI; changes are versioned so history stays interpretable
- Leaderboard for leadership, to inform future leadership selection — your stated goal
- Trend view per member: improving or fading

> **Worth thinking about before you ship this.** Any metric people can see, they will
> optimize. Hours logged is the easy one to game and the weakest proxy for real
> contribution — you'd be rewarding time spent over work delivered, and possibly
> encouraging people to sit in the lab performing busyness. Two mitigations: weight
> *delivered outcomes* (tasks, REs held, updates) above raw hours, and treat the score
> as a conversation-starter for Mentors rather than an automatic ranking. It's a
> flashlight, not a scoreboard.

### 5.9 Onboarding and invitations

- Mentor or Co-Lead invites by `@stanford.edu` email
- Invite carries a pre-assigned division, sub-team, and Mentor, so nobody lands nowhere
- Google sign-in only, `stanford.edu` enforced — satisfies "Stanford members only"
- Guided first-run: fill profile → declare trainings → browse open projects → join one.
  A new member's first session should end with them on a project

---

## 6. Build phases

Each phase is a **vertical slice** — a working, usable feature end to end — rather than
"all the UI, then all the backend." You'll have something demoable to the club early,
which is how you get feedback while it's still cheap to act on.

| Phase | Deliverable | Why this order |
|---|---|---|
| **0** | Scaffold, Stanford Google auth, empty shell + nav | Nothing works without auth |
| **1** | Org tree (divisions, nested teams), member roster, profiles, Mentor assignment | Everything references people and units |
| **2** | Project tree, membership, responsibilities, browse + join, artifacts | The discoverability payload — the core value |
| **3** | Hours logging + quick-add | Highest frequency, immediately useful, generates data for later phases |
| **4** | Updates, review queue, roll-ups, notifications | The workflow that fixes the reporting chain |
| **5** | Events, invitations, attendance, calendar | Depends on people + weighting |
| **6** | Tasks, dependencies, milestones, auto-Gantt | Richest feature; needs the project tree solid first |
| **7** | Trainings, certifications, facility access on profiles | Self-contained, can slot earlier if urgent |
| **8** | Engagement scoring, weights config, leadership dashboard | Needs phases 3–6 producing real data first |
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

## 8. Open questions

1. **"Tri-weekly"** — 3× per week, or once every 3 weeks? (§5.3)
2. **"Mentor"** — approve, or prefer Crew Chief / Section Lead / other? (§3)
3. **Hours visibility** — all members, or leadership only? (§4)
4. **Real division list** — confirm: Fixed Wing eVTOL, SkyBeta, Spade, DroneHacks,
   SkyDelta. Exact spellings and any missing?
5. **Club size** — roughly how many members and sub-teams? Affects UI density choices
6. **Existing training and access lists** — what trainings and facility accesses should
   be seeded? (machine shop tiers, Lab 64, Robotics Room, PRL…)
7. **Competition dates** — hard external deadlines to anchor Gantt charts to?

---

## 9. Next actions

1. You answer §8 — questions 1–3 block Phase 0/1 naming and schema
2. I scaffold Phase 0 and you get it running locally
3. Set up Supabase (yours for dev; teammate handles production)
4. Build Phase 1

See `DATA_MODEL.md` for the schema and `DECISIONS.md` for infrastructure notes.
