# Removing the reporting chain: the plan

Written 2026-08-24, after the team decided to drop bi-weekly check-ins and
person-to-person reporting. **Nothing here is built yet.**

Read `docs/HOURS_REMOVAL_PLAN.md` first if you weren't here for that one. This is
the same shape of change, and it went well for one reason worth copying: the
removal shipped as a single coherent change *with its replacement*, rather than as
a deletion followed by a gap.

---

## What the club decided

- **No more bi-weekly check-ins.** Members stop filing a twice-weekly report.
- **No reporting chain.** Nobody has a Lead they report to; `profiles.lead_id`
  stops meaning anything.
- **Members report to their REs instead** — through the work they log on a
  project, which is already public and already in the project's feed.
- **Co-Lead, Team Lead and Member remain as titles**, but symbolic. Authority
  comes from being an RE of a project.
- **Co-Leads keep access to everything.**
- **Trainings and facility access need a new framework**, because today a Lead
  verifies them and there will be no Leads in the authority sense.

---

## The distinction that makes this tractable

The codebase has **two** hierarchies and they are easy to conflate. Only one is
being removed.

| | What it answers | Functions | Fate |
|---|---|---|---|
| Reporting chain | "who oversees this PERSON?" | `isLeadOfOrAbove`, `leadChain` | **Deleted** |
| Project authority | "who is accountable for this WORK?" | `isREofOrAbove`, `leadsTeamAbove` | **Kept** |

**`leadsTeamAbove` must survive, and it is the one item I would push back on if it
were on the list.** It is what makes a Division Lead a top RE over every project
in their division. That is authority over PROJECTS, not over people; it is already
folded into `isREofOrAbove`; and it is exactly "the RE rules for projects" that the
decision says to keep. Delete it and a Division Lead cannot add a deliverable in
their own division without being named RE on every project individually — which
recreates the "go ask a Co-Lead" bottleneck this app exists to remove.

So: **`isLeadOfOrAbove` and `leadChain` go; `isREofOrAbove` and `leadsTeamAbove`
are untouched.** Every decision below follows from that line.

---

## Blast radius, measured

Counted, not estimated.

**Files that go entirely — 2,239 lines:**

| File | Lines | What it is |
|---|---|---|
| `lib/review.ts` | 336 | Unread-report escalation |
| `app/api/cron/checkin-reminders/route.ts` | 331 | Nudges before a check-in is due |
| `components/forms/check-in-form.tsx` | 315 | Writing one |
| `lib/review.test.ts` | 302 | |
| `app/(app)/updates/page.tsx` | 292 | The check-in page |
| `lib/checkin-draft.test.ts` | 226 | |
| `lib/checkin-draft.ts` | 176 | Drafting a check-in from the work log |
| `lib/data/updates.ts` | 136 | |
| `app/(app)/settings/update-schedule-form.tsx` | 125 | Which weekdays you check in |

**Call sites to work through:**

| Symbol | Hits |
|---|---|
| `.leadId` | 108 |
| `progressUpdates` | 71 |
| `reliability` | 51 |
| `updateSchedules` | 18 |
| `isLeadOfOrAbove` | 16 |
| `reviewUpdate` | 15 |
| `leadChain` | 10 |

**Seven permission rules use the chain.** Four die with it; three need a new home:

| Rule | Today | Proposed |
|---|---|---|
| `reassignLead` | chain | **deleted** |
| `reviewUpdate` | chain | **deleted** |
| `viewMemberEffort` | chain | self + Co-Lead + advisor |
| `viewMemberContribution` | chain | self + Co-Lead + advisor |
| `setMemberStatus` | chain | Co-Lead only |
| `verifyTraining` | chain | see decision 2 |
| `grantAccess` | chain | see decision 2 |

**Dashboard:** five of its thirteen sections are chain-shaped — Not Being Read,
Gone Quiet, Roll-Up, Needs Review, Update Window. What remains (Waiting On You As
RE, Requests To Answer, Trainings To Verify, Finished Recently, Deadlines Moved,
Needs Attention) is already an RE dashboard.

**Cron:** `checkin-reminders` goes, freeing one of the two Hobby-plan cron slots.
Worth knowing — that limit has already cost four failed deployments once.

---

## What replaces it, and why most of it already exists

This is what makes the change safe: **the replacement shipped last week.** Logging
work is public, the project page shows one merged feed of work, and an RE can reply
to any line in it. "Members report to their REs" is already the working path, so
removing check-ins removes a second, heavier way of doing the same thing rather
than leaving a hole.

Two things the chain did that nothing else does yet:

1. **It made somebody accountable for reading.** An unread check-in escalated to a
   named person after three days. Nothing replaces that, and nothing should — an RE
   reading their own project's feed is the model now, and an RE who ignores their
   project has a visibly stalled project rather than a private failure.
2. **It made "gone quiet" detectable.** A member who stopped appearing was flagged
   on their Lead's dashboard. **Recommendation: keep this, re-scoped to the
   project** — "nobody has logged anything here in three weeks" is a fact about a
   project, which is the right shape now.

---

## Five decisions I need from you

Each has a recommendation. Say "all as recommended" and I will build it.

### 1. Reliability — redefine it rather than delete it

`lib/contribution.ts` reports three signals: Delivered, **Reliability** (updates on
time), Scope. Reliability's only input is check-ins, so afterwards it can only ever
be `null`.

**Recommended:** redefine Reliability as **deliverables finished by their due
date**. Same meaning to a reader, real data that still exists, and it keeps the
three-signal shape instead of leaving a hole where the third was. It also stays
honest under the existing rule that a signal with no data returns `null`, never
`0`.

*Alternative:* delete the signal, leaving Delivered and Scope.

### 2. Trainings and facility access — a named verifier per item

Today a Lead verifies, because a Lead oversees the person. That reasoning is gone,
and machine clearances are not project-scoped, so RE authority does not reach them
either.

**Recommended:** give each `catalogue_items` row a **verifier** — one named member,
exactly like an RE but for a machine or a room. Co-Leads can always verify. It is
the pattern the club already trusts: accountability sits with a named person rather
than a hierarchy, and the person who actually runs the mill is the right person to
sign off on the mill.

*Alternatives:* Co-Leads only (simple, but bottlenecks on the people least likely to
be in the shop); or any RE of a project the member is on (wrong shape — being on a
project says nothing about machine competence).

Needs a migration: `catalogue_items.verifier_id`.

### 3. The academic pause — keep a lighter version

Pausing exists to suspend check-in obligations. With no obligations there is
nothing to pause, so the feature dies as written. But the need behind it is real: an
RE should know somebody is heads-down on midterms before chasing them.

**Recommended:** a **"heads-down until &lt;date&gt;"** flag on the member, shown on the
roster and beside their name on project member lists. No obligations, no penalties,
no reminders — just a visible fact, so an RE does not chase and a member does not
feel they have gone silent.

*Alternative:* delete it outright.

### 4. Academic terms — keep the table, drop the obligation flag

`Term.generatesObligations` decides whether check-ins are asked for. It has one
other reader, in `lib/data/events.ts`.

**Recommended:** keep terms (the calendar and the archive use them) and delete
`generatesObligations` from the model — *after* confirming that events reader does
not depend on the semantics. That is one grep, and I would rather do it than assume.

### 5. Check-in history — keep every row, stop writing new ones

**Recommended, and I would argue for this one:** do exactly what the hours removal
did. Stop creating `progress_updates` / `update_entries`, stop asking for them,
delete no rows and drop no tables.

Two reasons. Historical entries are part of each project's permanent record and they
*already render in the merged project feed*, so a project's history stays continuous
instead of restarting the day this ships. And a dropped table cannot be un-dropped
if the club decides in a year that it wants something like this back.

The tables become read-only history, with a column comment saying so.

---

## Order of work

Sequenced so nothing is half-removed at any commit, and so the parts needing a
migration do not block the parts that do not.

**Phase 1 — stop asking.** Ships alone and safely. Remove the check-in write path:
the form, `/updates`, the reminder cron, `checkin-draft`, the Settings check-in days
card, the academic pause. Existing rows keep rendering in project feeds. After this
the club stops being asked for check-ins, which is the visible half of the decision.

**Phase 2 — dismantle the chain in the permission layer.** Delete `isLeadOfOrAbove`
and `leadChain`; rehome the three rules per the table above; delete `reviewUpdate`
and `reassignLead`. The tests do the work here — `lib/permissions.test.ts` is the
safety net, and every removed arm should have a test deleted or rewritten
deliberately, with the reasoning in the diff.

**Phase 3 — the pages.** The dashboard loses five sections and becomes explicitly
the RE dashboard. Member profiles lose Lead and Direct Reports. `lib/review.ts` and
the digest's check-in sections go. "Gone quiet" is re-scoped to the project.

**Phase 4 — the new frameworks.** Reliability redefined; catalogue verifiers;
heads-down flag. Two migrations.

**Phase 5 — schema and docs.** `teams.lead_id` **stays** — it feeds
`leadsTeamAbove`. Only `profiles.lead_id` and
`progress_updates.lead_id_at_submission` become dead, and per decision 5 they should
be left in place with comments rather than dropped. Then CLAUDE.md, HANDOFF,
`/how-we-lead`, `/leading`, `/getting-started`, the MCP guide and
`docs/CONNECT_YOUR_AI.md` — all of which currently teach the chain.

---

## Risks, and the one that worries me

**Accountability genuinely thins out.** The chain's real function was that somebody
was *named* as responsible for noticing. "The RE sees the feed" is lighter by
design, but if REs do not look, nothing tells anyone. The per-project "gone quiet"
flag is the mitigation, and I would build it in Phase 3 rather than defer it.

**966 tests currently pass, and a large block of them assert chain behaviour.**
Deleting a test is how a real rule gets lost quietly. Every deletion should appear
in a diff with a reason rather than being swept up in a bulk edit.

**Two migrations are already pending** (`0044`, `0045`) and I cannot apply them —
the database password is rejected. Phases 1–3 need no migration and can ship
regardless; Phase 4 cannot land until database access works again.

**"Symbolic" is easy to over-apply.** A Team Lead will still appear in the member
directory as the person to ask for the Fusion drive. That is a directory, not a
chain, and it should survive — the copy simply has to stop implying oversight.
