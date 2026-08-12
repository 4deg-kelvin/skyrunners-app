# Sky Runners App — Decisions

**Status:** Phase 0 built. All blocking questions resolved.

See `PROJECT_PLAN.md` for the plan, `DATA_MODEL.md` for the schema,
`DESIGN_SYSTEM.md` for the visual language.

---

## 1. Context

Stanford UAV (Sky Runners) — ~30–40 members, five divisions — needs an app to track
**member contribution** and **engineering efforts** across concurrent drone projects.

**Root problem:** disorganization is the top cause of member attrition.

**Team split:**
- **Anish** — app functionality (new to coding)
- **Teammate (@4deg-kelvin)** — server management, hosting, deployment

---

## 2. Locked decisions

### Technical

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15, App Router | One codebase for UI + API |
| Language | **TypeScript only — no Python** | React forces TS regardless; a second language doubles learning and ops load for a solo beginner. `PROJECT_PLAN.md` §2 |
| Styling | Tailwind CSS v4, CSS-first tokens | Tokens in `app/globals.css`; no hardcoded colors |
| Database | Postgres via Supabase | Recursive CTEs handle the nested team/project trees natively |
| Auth | Supabase Auth, Google OAuth, `stanford.edu` restricted | Satisfies "Stanford only", no password handling |
| File storage | Supabase Storage | Certificates, presentations, CAD, reports |
| Email | Resend | Deadline nudges, invites |
| Cron | Vercel Cron → API route | Missed-update checks (in-session only), RE liveness checks, deadline reminders |
| ORM | **Supabase client, or Drizzle. Not Prisma** | Prisma bypasses RLS with elevated privileges, defeating read protection |
| Data access | RLS for reads; Server Actions + `lib/permissions.ts` for writes | Reads mostly open; writes complex and belong in one tested module |
| Gantt | Prototype `frappe-gantt`, replace with custom if nesting fights it | Nested-project Gantt is unusual; verify before committing |
| Tests | Node built-in test runner, `--experimental-strip-types` | Zero dependencies. Covers permissions and contribution |
| Deletion policy | Never hard-delete people or projects — deactivate | Contribution history must survive graduations |

### Product

| Decision | Choice |
|---|---|
| Roles | **Co-Lead** → **Team Lead** → **Member**, plus project-scoped **RE** |
| Update cadence | **2 per week**, on member-chosen weekdays. Pausable for academics without penalty |
| Hours expectation | **10–12 hrs/week**, published up front. Named tiers (Core / Committed / Contributing), never pass-fail |
| REs per project | **Multiple allowed**, one primary as go-to contact |
| Project membership | **RE-controlled. No self-enrollment, no cap.** Members see everything, follow anything, and ask to join; the RE decides |
| Join requests | Tracked objects, not emails. RE queue, visible pending state, escalation after 5 days |
| Task model | **Deliverables** — one flat list per project, one owner each. **No dependencies, no nesting, no critical path** |
| Project status | **Phase** (lifecycle) + **health** (how it's going), as separate fields |
| Divisions | Co-Lead editable in the UI — addable, removable, renameable |
| Academic calendar | **`terms` table gates all obligations.** Finals, breaks and summer generate nothing |
| Activity visibility | **Public to all members** — projects, deliverables, who's on what, artifacts, calendar |
| Engineering record | **Anyone committed to the project attaches; only an RE removes.** Links must be confirmed non-expiring, and provably temporary ones are refused outright |
| Record on completion | **Frozen.** A complete project accepts new attachments but nothing can be edited or removed except by a Co-Lead |
| Effort visibility | **Restricted** — hours and update contents visible to the member, their Lead chain, and REs of projects they contribute to |
| Contribution tracking | **Four independent signals, no composite score:** deliverables done, hours/week tier, updates on time, roles held |
| Score visibility | **Members see their own.** Weights and rubric published at `/how-we-lead`. No ranking exists |
| Leadership rubric | Delivered work first, then sustained commitment, then reliability, then lifting others |
| Update review | Ancestor REs up the project chain, plus the Lead chain |
| Training verification | Member submits a request; direct Lead or Co-Lead verifies |
| RE liveness | Projects flagged when the primary RE goes quiet 14+ days, or a blocker sits 7+ days |
| Calendar sync | **Opt-in only**, Google *and* Apple |
| Local dev path | `C:\Users\anish\skyrunners\project_and_member_managment_website\skyrunners-app` |

### Why there's no composite score

The original design computed a weighted engagement score, hidden from the member it
described, and used it for leadership selection. Three problems killed it:

1. **It ranked people absurdly.** A reliable non-RE contributor whose RE didn't use the
   task feature scored 50; a member on leave all term scored 45. Components disagreed on
   how to treat missing data, and the punitive convention was worth 25%.
2. **~45% of it was gated on already holding authority** (RE roles, and tasks assigned by
   REs). A metric for choosing future leaders substantially measured having already been
   chosen — which is how leadership becomes a clique in a club with annual turnover.
3. **A hidden rubric that decides advancement always leaks**, and when it does the trust
   cost is retroactive: it recolors every update the person ever wrote.

Four separate signals fix all three. A single number invites optimization; four columns
invite judgment. And **Delivered leads**, because finished work is the only signal that
can't be inflated — someone can sit in the lab twelve hours and ship nothing.

---

## 3. Notes for the teammate handling infrastructure

Anish is building app functionality; hosting and production data are yours.

### Recommended: Supabase

Covers four needs at once — Postgres, Google OAuth with `stanford.edu` domain
restriction, file storage for certificates and engineering artifacts, and row-level
security. Generous free tier, plain Postgres underneath, so nothing here is a one-way
door.

**Alternatives if you'd rather self-manage:** Postgres on Railway / Render / Fly.io,
building auth yourself.

**Please avoid Firebase/Firestore.** This data model is deeply relational — members ↔
teams ↔ projects ↔ deliverables ↔ attendance are all joins, plus two arbitrarily-nested trees
resolved with recursive CTEs. NoSQL would make the core queries painful.

### Requirements to design around

1. **Postgres, not NoSQL** — recursive CTEs are load-bearing (`DATA_MODEL.md`)
2. **Google OAuth restricted to `stanford.edu`** — this *is* the access control model
3. **File storage** with per-object access control
4. **Scheduled jobs** — missed-update checks (only when `in_session()` is true), RE
   liveness detection, deadline reminders
5. **Transactional email** — Resend unless you prefer otherwise
6. **Preview deployments per branch** would help a lot, since Anish is learning and will
   want to show the club work in progress

### Deployment

Vercel is the path of least resistance for Next.js — free tier, per-branch preview URLs,
built-in cron. Anything running Node works.

### Two things to watch

**Don't introduce Prisma.** It connects with elevated privileges and silently bypasses
the RLS policies protecting reads.

**Don't finalize the schema unilaterally.** `DATA_MODEL.md` follows from documented
requirements and the app code is built against it. Raise problems rather than diverging.

---

## 4. Still to gather

Non-blocking, needed when the relevant phase arrives:

- **Trainings to seed** (Phase 7) — Anish will supply the machine and lab list
- **Facility access types** (Phase 7) — Robotics Room keycard, Lab 64 24-hour, PRL, etc.
- **Competition dates** — none yet; project deadlines are settable at any time

---

## 5. Deliberate deferrals

| Deferred | Until |
|---|---|
| Mobile app / PWA | Phase 9. Responsive web throughout, so phones work meanwhile |
| Offline hour logging | Phase 9 |
| Slack integration | Post-launch |
| Python analytics service | Only if real modeling or ML work materializes |
| Alumni / historical archive views | After a full year of data exists |
| Cross-division breadth as a tracked signal | Not tracked; it's a member's own choice |

---

## 6. Open risks

| Risk | Watch for |
|---|---|
| **Scope** | Large for a solo beginner. Phase 2 alone addresses the root problem — ship it before building Gantt charts |
| **Update fatigue** | 2 written check-ins a week is still a real ask on top of coursework. If the on-time rate drops below ~70% in month one, the cadence is the cause, not the people. `updates_per_week` is configurable for exactly this |
| **The hours bar shrinks the club** | A 10–12 hr/week expectation self-selects for a committed core. That may be precisely what "high class team" means — but it is a *different goal* from "stop people quitting", and the two can pull against each other. It works by being stated at recruiting, never discovered in week six |
| **Hours gaming** | Hours are the easiest signal to inflate. Mitigated by making Delivered the primary column and publishing that finished work outranks time logged |
| **Documented delinquency** | The biggest retention risk in the whole design. A member who drifts two weeks during midterms must be able to return without facing a record of failure. Hence academic pause, no `missed` rows while paused, and tiers instead of pass-fail |
| **Understaffed unglamorous work** | Harnesses, layups, test stands and requirements verification will be short every year. RE-controlled staffing helps — an RE can recruit directly — but a "needs help" boost and some assigned rotation are still worth adding |
| **Permission bugs** | Nested inherited RE authority is the trickiest logic. Covered by `lib/permissions.test.ts` — extend it when rules change |
| **Adoption** | See `PHASE_PLAN.md` § "Before the club ever logs in" — data-entry day, killing one incumbent tool, a launch ritual, and a one-division pilot all matter more than any feature |
| **Unanswered join requests** | The new failure mode created by RE-gated membership. A silent RE is a member with nothing to do. Mitigated by the RE queue on My Work, staleness flags at 5 days, and Co-Lead override |
| **Turnover** | The app must outlive Anish. Docs and `CLAUDE.md` exist for this |
