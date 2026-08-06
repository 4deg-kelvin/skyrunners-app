# Sky Runners App — Decisions

**Status:** Phase 0 built. All blocking questions resolved.

See `PROJECT_PLAN.md` for the plan, `DATA_MODEL.md` for the schema,
`DESIGN_SYSTEM.md` for the visual language.

---

## 1. Context

Stanford UAV (Sky Runners) — ~30–40 members, five divisions — needs an app to track
**member engagement** and **engineering efforts** across concurrent drone projects.

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
| Cron | Vercel Cron → API route | Missed-update checks, RE deadline reminders, nightly engagement snapshots |
| ORM | **Supabase client, or Drizzle. Not Prisma** | Prisma bypasses RLS with elevated privileges, defeating read protection |
| Data access | RLS for reads; Server Actions + `lib/permissions.ts` for writes | Reads mostly open; writes complex and belong in one tested module |
| Gantt | Prototype `frappe-gantt`, replace with custom if nesting fights it | Nested-project Gantt is unusual; verify before committing |
| Tests | Node built-in test runner, `--experimental-strip-types` | Zero dependencies. Covers permissions and engagement |
| Deletion policy | Never hard-delete people or projects — deactivate | Contribution history must survive graduations |

### Product

| Decision | Choice |
|---|---|
| Roles | **Co-Lead** → **Team Lead** → **Member**, plus project-scoped **RE** |
| Update cadence | **3 per week**, on member-chosen weekdays. `updates_per_week` configurable |
| REs per project | **Multiple allowed**, one primary as go-to contact |
| Project enrollment | **Open by default** — members join anything |
| Project status | **Phase** (lifecycle) + **health** (how it's going), as separate fields |
| Divisions | Co-Lead editable in the UI — addable, removable, renameable |
| Activity visibility | **Public to all members** — projects, who's on what, responsibilities, artifacts, calendar, Gantt |
| Effort visibility | **Restricted** — hours, update contents, engagement scores visible to the member, their Lead chain, and REs of projects they contribute to |
| Update review | Ancestor REs up the project chain, plus the Lead chain |
| Training verification | Member submits a request; direct Lead or Co-Lead verifies |
| Engagement weights | 30% update reliability, 25% task completion, 20% RE responsibility (size-scaled), 15% event attendance, 10% hours, 0% breadth |
| Engagement framing | Flashlight, not scoreboard. **No leaderboard function, deliberately** |
| Calendar sync | **Opt-in only**, Google *and* Apple |
| Local dev path | `C:\Users\anish\skyrunners\project_and_member_managment_website\skyrunners-app` |

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
teams ↔ projects ↔ tasks ↔ attendance are all joins, plus two arbitrarily-nested trees
resolved with recursive CTEs. NoSQL would make the core queries painful.

### Requirements to design around

1. **Postgres, not NoSQL** — recursive CTEs are load-bearing (`DATA_MODEL.md`)
2. **Google OAuth restricted to `stanford.edu`** — this *is* the access control model
3. **File storage** with per-object access control
4. **Scheduled jobs** — nightly engagement snapshots, missed-update nudges, RE deadline
   reminders
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
| Breadth in engagement scoring | Weight is 0; revisit after a term of real data |

---

## 6. Open risks

| Risk | Watch for |
|---|---|
| **Scope** | This is large for a solo beginner. Phase 2 alone addresses the root problem — ship it before building Gantt charts |
| **Update fatigue** | 3 written check-ins a week is a real ask. If on-time rate drops below ~70% in month one, the cadence is the cause, not the people. `updates_per_week` is configurable for this reason |
| **Metric gaming** | Any visible metric becomes a target. Hours weighted lowest, no leaderboard, outcomes prioritized |
| **Permission bugs** | Nested inherited RE authority is the trickiest logic. Covered by `lib/permissions.test.ts` — extend it when rules change |
| **Turnover** | The app must outlive Anish. Docs and `CLAUDE.md` exist for this |
