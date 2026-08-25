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

**Seven permission rules use the chain.** Five die with it; two need a new home:

| Rule | Today | Proposed |
|---|---|---|
| `reassignLead` | chain | **deleted** |
| `reviewUpdate` | chain | **deleted** |
| `viewMemberEffort` | chain | **deleted** (see decision 3) |
| `viewMemberContribution` | chain | **deleted** (see decision 3) |
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

## Decided (2026-08-24)

Anish answered all four open questions. Recorded here rather than in a chat log,
because each one is a rule somebody will want the reasoning for later.

### 1. Division Leads keep project authority

`leadsTeamAbove` stays. A Division Lead remains a top RE over every project in
their division. Symbolic applies to the reporting relationship between people, not
to accountability for work.

### 2. Trainings: assigned to a named Lead, or self-verified

Each catalogue item is configured one of two ways:

- **Assigned to a named Lead** who signs off requests for it. This is the RE
  pattern applied to a machine: accountability sits with a person, not a rank.
- **Self-verify.** The member ticks it themselves and no sign-off is asked for.
  Right for anything where the honest answer is "did you read this" — a shop
  induction video, a document — and it removes the queue entirely for those.

Co-Leads can always verify anything.

**Plus a lock-out safeguard, and it is the interesting part.** You cannot remove
somebody from a Lead position while a training is assigned to them. The refusal
has to name what is blocking it — "Tyler verifies the mill and the laser cutter;
reassign those first" — because a bare "not allowed" on an org-chart edit is the
kind of message people work around by deleting something else.

This is the same family as the two guards already in `updateProject` and the
member admin: the last Co-Lead cannot be demoted, and a parent project cannot be
completed while a child is open. Both refuse rather than cascade, for the same
reason — the app should not quietly decide who inherits a safety sign-off.

Two migrations: `catalogue_items.verifier_id` and `catalogue_items.self_verify`.

### 3. Reliability is deleted outright, and contribution stops being central

Not redefined. Deleted.

In its place: a plain **counter** — deliverables completed, projects completed --
in the side column of a member's profile, next to the other details. Not a panel,
not a scored record, not a signal.

**This has a consequence worth stating plainly, because it is larger than it
looks: after this there is nothing private left about a member.** Reliability was
the last piece of the "personal record" — the work log went public on 2026-08-16,
and check-ins are going. So `viewMemberEffort` and `viewMemberContribution` are
not rehomed to Co-Leads, they are **deleted**, along with `lib/contribution.ts`
and the `ContributionPanel`. Two public counters need no permission rule.

That also finishes what Anish said two days ago — "I dont see what should be
private anymore since we removed hour logging." It is now true of the whole app,
and the privacy table in CLAUDE.md collapses to one line.

`/how-we-lead` currently publishes the three-signal rubric as club policy. It
needs rewriting rather than trimming: the honest version is that the club looks at
what you delivered, and there is no score.

### 4. The academic pause is deleted

No obligations to pause, so nothing to keep. No replacement flag.

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

**Phase 4 — the new frameworks.** Delete `lib/contribution.ts`, the
`ContributionPanel` and the two view rules; add the two profile counters. Catalogue
verifiers plus self-verify, and the Lead-removal safeguard. Two migrations
(`verifier_id`, `self_verify`) — so the trainings half cannot land until database
access works again, while the contribution half needs no schema change and can
ship in Phase 3.

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

**The Lead-removal safeguard can strand the club.** If the only person who can
verify the mill graduates, somebody has to be able to reassign it — so the guard
must refuse the demotion *and* point at the reassignment, and a Co-Lead must
always be able to override. A guard with no exit is worse than no guard.

**"Symbolic" is easy to over-apply.** A Team Lead will still appear in the member
directory as the person to ask for the Fusion drive. That is a directory, not a
chain, and it should survive — the copy simply has to stop implying oversight.
