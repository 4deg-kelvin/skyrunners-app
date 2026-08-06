# Sky Runners App — Decisions & Open Questions

Living document. **Status:** planning complete, awaiting answers to §4 before Phase 0.

See `PROJECT_PLAN.md` for the full plan and `DATA_MODEL.md` for the schema.

---

## 1. Context

Stanford UAV (Sky Runners) needs an app to track **member engagement** and
**engineering efforts** across multiple concurrent drone projects.

**Root problem:** disorganization is the top cause of member attrition.

**Team split:**
- **Anish** — app functionality (new to coding)
- **Teammate (@4deg-kelvin)** — server management, hosting, deployment

---

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15, App Router | One codebase for UI + API |
| Language | **TypeScript only — no Python** | React forces TS regardless; a second language doubles the learning and ops load for a solo beginner. See `PROJECT_PLAN.md` §2 |
| Styling | Tailwind CSS + shadcn/ui | Owned, editable components; suits high-density UI |
| Database | Postgres via Supabase | Recursive CTEs handle the nested team/project trees natively |
| Auth | Supabase Auth, Google OAuth, `stanford.edu` restricted | Satisfies "Stanford only", no password handling |
| File storage | Supabase Storage | Certificates, presentations, CAD, reports |
| Email | Resend | Deadline nudges, invites |
| Cron | Vercel Cron → API route | Missed-deadline checks, nightly engagement snapshots |
| ORM | **Supabase client, or Drizzle. Not Prisma** | Prisma bypasses RLS with elevated privileges, defeating read protection |
| Data access | RLS for reads; Server Actions + central permission module for writes | Reads are mostly open (transparency default); writes are complex and belong in one testable module |
| Charts | Recharts | |
| Gantt | Prototype `frappe-gantt`, replace with custom if nesting fights it | Nested-project Gantt is unusual; verify before committing |
| Roles | Co-Lead (`admin`) / Mentor / Member, plus project-scoped RE | "Mentor" pending confirmation |
| Deletion policy | Never hard-delete people or projects — deactivate | History must survive graduations |
| Local dev path | `C:\Users\anish\skyrunners\project_and_member_managment_website\skyrunners-app` | Outside OneDrive, deliberately |

---

## 3. Notes for the teammate handling infrastructure

Anish is building app functionality; hosting and production data are yours.

### Recommended: Supabase

It covers four needs at once — Postgres, Google OAuth with `stanford.edu` domain
restriction, file storage for certificates and engineering artifacts, and row-level
security. Generous free tier, and it's plain Postgres underneath, so nothing here is a
one-way door.

**Alternatives, if you'd rather self-manage:** Postgres on Railway / Render / Fly.io
gives more control at the cost of building auth yourself.

**Please avoid Firebase/Firestore.** This data model is deeply relational — members ↔
teams ↔ projects ↔ tasks ↔ attendance are all joins, plus two arbitrarily-nested trees
resolved with recursive CTEs. NoSQL would make the core queries painful.

### Requirements to design around

1. **Postgres, not NoSQL** — recursive CTEs are load-bearing (`DATA_MODEL.md`)
2. **Google OAuth restricted to `stanford.edu`** — this *is* the access control model
3. **File storage** with per-object access control
4. **Scheduled jobs** — nightly engagement snapshots, deadline nudge emails
5. **Transactional email** — Resend unless you prefer otherwise
6. **Preview deployments per branch** would help a lot, since Anish is learning and will
   want to show the club work-in-progress

### Deployment

Vercel is the path of least resistance for Next.js — free tier, per-branch preview URLs,
built-in cron. Anything running Node works though.

### Please don't finalize the schema unilaterally

`DATA_MODEL.md` is the current design and follows from documented requirements. If you
see problems, raise them — but changes should stay in sync with that doc, since the app
code is built against it.

---

## 4. Open questions — blocking

**Q1 and Q2 block Phase 0. Q3 blocks Phase 3.**

1. **"Tri-weekly update" — 3× per week, or once every 3 weeks?**
   The wording ("a 3 weekly update", "tri-weekly update days" plural, later "weekly
   updates") supports either. Three written updates per week is a heavy ask for students
   and risks the burnout that drives quitting; every three weeks may be too slow to
   catch problems early. Schema is flexible either way, but defaults and UI copy need
   the real answer.

2. **Role name: "Mentor"?**
   Chosen because it matches the described duties and avoids colliding with "Co-Lead."
   Alternatives: **Crew Chief** (aviation-native, fits the team identity), **Section
   Lead** (clearer hierarchy), **Advisor** (softer). Cheap to change now, painful later.

3. **Should hours and updates be visible to all members, or leadership only?**
   Full transparency drives accountability and discoverability, but can feel like
   surveillance to slower contributors — which works against retention. Suggested middle
   path: project activity and membership visible to everyone; raw individual hour totals
   and engagement ranks leadership-only. Easier to open up later than to walk back.

## 5. Open questions — non-blocking

4. **Division names** — confirm exact spellings: Fixed Wing eVTOL, SkyBeta, Spade,
   DroneHacks, SkyDelta. Any missing?
5. **Club size** — rough member count and number of sub-teams, for UI density decisions
6. **Trainings to seed** — machine shop tiers, lab equipment, safety, Stanford online
   courses?
7. **Facility access types to seed** — Robotics Room keycard, Lab 64 24-hour, PRL?
8. **Competition dates** — hard external deadlines to anchor Gantt charts to?

---

## 6. Deliberate deferrals

| Deferred | Until |
|---|---|
| Mobile app / PWA | Phase 9. Responsive web throughout, so phones work meanwhile |
| Offline hour logging | Phase 9 |
| Slack / Google Calendar integration | Post-launch. iCal feed export covers most of the need |
| Python analytics service | Only if real modeling or ML work materializes |
| Alumni / historical archive views | After a full year of data exists |
