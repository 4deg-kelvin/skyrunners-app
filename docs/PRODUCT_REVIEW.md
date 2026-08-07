# Product & Organizational Review

**Date:** 2026-08-06 · Reviewed before Phase 1, ahead of deployment to ~35 members.

This is a critique of the *product and management design*, not the code. It was written
with an independent reviewer brought in specifically to argue against the plan, because
the plan's own author is the wrong person to judge it.

---

## Verdict

The architecture is sound. The **product** has one systemic bias: **it is designed from
the leadership chair.** It's very good at making members legible to leaders, and thin on
giving a member a reason to open it.

The retention thesis — "disorganization causes attrition" — is half right. Disorganization
is the *mechanism*. The *felt experience* that makes someone stop showing up is: I never
got to build anything, I didn't know anybody, nobody noticed what I did. The plan has
extensive machinery for the first-order problem and almost none for the felt experience.

**Most likely outcome as currently specified:** Phase 2 (project discovery) becomes
genuinely useful and permanent. Phase 4 (three updates a week) becomes compliance theater
by week five and damages trust in everything else.

---

## What's working — don't change these

1. **Two independent hierarchies** (org tree vs. project tree). Most teams conflate them
   and rebuild the silos they're trying to remove.
2. **Open enrollment.** The right diagnosis of the most fixable failure mode. Needs
   guardrails, not reversal.
3. **Per-project update entries** rather than one text blob. Expensive to retrofit; right
   to do now.
4. **RE as a first-class inheriting role, with "who to ask" on every project.** The
   highest-value, lowest-cost feature in the app.
5. **No leaderboard; hours weighted lowest with a capped curve.** Refusing to reward
   performed busyness is the right instinct.
6. **Restricting raw hours to leadership.** Right call. (Now apply the same reasoning to
   the hidden score — see §2.)
7. **Never hard-deleting people; snapshotting values that change.** Far-sighted for an org
   with total turnover every four years.
8. **Shipping Phase 2 first.** Correct sequencing. Hold this line.

---

## The six issues that matter most

### 1. Three updates a week is the riskiest decision in the app

**The arithmetic.** A member on 3 projects owes 9 free-text sections per week. The
auto-draft fills in *hours and which projects* — it cannot fill the prose, which is the
entire cost. Call it 30 minutes a week. A typical mid-tier member contributes 4 hours a
week, so that's a **12–15% reporting overhead**; for a 2 hr/week member, **25–30%**.

**The burden is regressive.** It falls hardest on the least-engaged member — exactly the
person you're trying to retain.

**The leadership side is worse.** 35 members × 3 = ~105 updates a week. A Lead with 5
reports gets 15 updates, plus a roll-up, plus their own updates, plus "check in multiple
times a week," plus their own engineering, plus four classes. That's 60–90 minutes a week
of pure administration for an unpaid sophomore.

For calibration: three written status reports a week is a heavier cadence than most
**paid** engineering teams run. A professional standup is verbal and takes 60 seconds.

**The scarce resource is not member writing — it's leadership reading**, and nothing in
the design budgets for it.

**Also: this is largely redundant.** `work_logs` already has a `description` field filled
in daily. The granular record of what happened already exists. A separate thrice-weekly
prose ritual duplicates it.

**Recommendation.** Launch at **one update per week**. Earn your way to two only after
observing ≥85% on-time *and* ≥80% of updates receiving a response. Let daily hour
descriptions carry the granular detail; make the weekly update a synthesis.

Before writing any Phase 4 code, **paper-prototype it**: two weeks, eight volunteers, a
Google Form. Zero code, and you'll learn whether the cadence is survivable for free.

Set an explicit design target: **a Lead's weekly obligation must fit in 15 minutes.**

---

### 2. A hidden score with a secret rubric, used for advancement

From a member's chair: I write prose several times a week, log hours daily, leadership sees
all of it, my peers don't, a number is computed about me that I can't see, and that number
decides whether I get to lead. I was never told the weights, that late counts half, or
that having no assigned tasks zeroes out a quarter of my score.

That is structurally a performance review with a concealed rubric. **It will leak** — a
Lead will mention it, or a passed-over candidate will be told their engagement was low, or
someone will read this repo. When it leaks, the trust cost is retroactive: it recolors
every update the person ever wrote.

The plan already reasoned that visible hours "can make slower contributors feel
surveilled, which cuts against your retention goal." That argument applies with *more*
force to a hidden score used for promotion.

**"No leaderboard" and "hidden from the person being scored" are two separate decisions.**
The flashlight-not-scoreboard logic only justifies the first. They got conflated.

**Recommendation.** Show every member **their own** score and full component breakdown,
and publish the weights. Hide only cross-member comparison — no ranks, no percentiles.
Publish a plain-English "how to become an RE or a Lead."

A stronger version worth considering: **in year one, don't show a composite number at
all** — to anyone. Show the raw components (hours, on-time rate, projects, events). A
single number invites optimization; raw facts invite reflection.

---

### 3. The engagement score has three defects that make it unfit for selecting leaders

Run real people through `computeEngagement`:

| Persona | Score |
|---|---|
| **A** — Reliable non-RE workhorse: 2 projects, 6 hrs/week, every update on time, 3 of 4 events, no tasks assigned because their RE doesn't use the task feature | **≈50** |
| **B** — A member on leave. No updates due, not invited to anything, no hours, no tasks | **45** |
| **C** — An RE: reliable, 8/10 tasks, two medium projects, 8 hrs/week | **88** |

**Your best non-RE contributor scores 50. A member who is literally absent scores 45.**
That is disqualifying for a metric used to pick leaders. Three causes:

1. **Inconsistent no-data handling.** `taskCompletionScore` returns **0** when no tasks are
   assigned, while `updateReliabilityScore` and `eventAttendanceScore` return **1** on no
   data. Three components, three conventions, and the punitive one is worth 25%. Tasks
   don't arrive until Phase 6, so in year one this mostly measures *whether your RE
   happens to use the task feature*. **This one is an outright bug, not a design choice.**
2. **~45% of the score is gated on already having authority.** `reResponsibility` (20%)
   requires being appointed an RE, and task assignment mostly flows through REs. A metric
   for selecting future leaders substantially measures *having already been selected*.
   In a club with annual turnover, that's how leadership becomes a clique.
3. **The event denominator is set by other people.** Any Lead can invite anyone, there's no
   `excused` state, and declining doesn't reduce the denominator. Invite someone to a
   Tuesday 2pm review when they have class and their score drops — penalizing people for
   their class schedule, which correlates with major, year, athletics, and having a job.

**Recommendation.** Return `null` for components with no data and renormalize over the
components that do have data. **Exclude `reResponsibility` from leadership selection** —
report it separately as "scope of responsibility." Count only required events, and let a
decline with a stated conflict leave the denominator. Add **persona tests**, not just
property tests: the current tests lock in true-but-weak invariants and none of them catches
"absent member scores 45."

---

### 4. The system converts invisible drift into documented delinquency

Why students actually quit, roughly in order: six weeks in and they still haven't touched
hardware; they didn't make friends; the work was menial; they contributed and nobody
noticed; **midterms hit, they drifted two weeks, felt embarrassed about the gap, and never
came back.**

That last one is enormous, and this app **accelerates** it. Today someone who disappears
for two weeks can slide back in unremarked. Under this system they return to a *record*:
six missed updates, a red compliance row, nudge emails, a note to their Lead, and a tanked
score. **People do not return to organizations where they feel they have already failed.**

And nothing addresses belonging. There is no social surface anywhere in the schema.
Legibility is not belonging.

**Recommendation.**
- A one-click **"heads-down on academics for N weeks"** that pauses the schedule and
  suppresses nudges *without generating missed rows*. Frame lapses as pauses, never debt.
- **A first-quarter amnesty**, announced at launch: nothing before a stated date counts,
  and no score is used for anything in quarter one.
- **One belonging feature.** A public per-project activity feed, or a "shipped it" post
  with a photo. The resolution to the privacy tension: show **contributions** publicly
  ("wrote the layup procedure"), keep **quantities** private ("logged 4.5 hrs").

---

### 5. Nothing detects an inactive RE, and RE authority inheriting downward makes that a hard stop

A senior gets a job offer in January and checks out. If they're the primary RE of a
top-level project: nobody can create sub-projects beneath it, nobody can appoint REs
beneath it, blockers route to an unread inbox, and deadline notifications fire into the
void. The only escape is a Co-Lead who doesn't know the project is stuck.

**This happens every single year, and it silently blocks other people's work** — the exact
disorganization the app exists to remove. The invariants protect orphaned mentees but not
orphaned projects.

**Recommendation.** An **RE liveness monitor**: if a primary RE has no activity in 14 days,
or a blocker sits unanswered for 7, set the project `health = at_risk` and notify the
owning Lead and Co-Leads with a one-click reassign. **Require two REs on any project that
has children.** Cheap, uses data you already have, and worth more than the Gantt chart.

---

### 6. Open enrollment allocates people to attractive work, not necessary work

Open enrollment is a market, and markets clear on appeal.

**Predictably oversubscribed:** airframe CAD, autonomy, anything with "AI" in it.
**Predictably understaffed, every year, in every club:** wiring harnesses, layups and
sanding, ground support equipment, test stands, jigs and fixtures, integration and
debugging, test reports, requirements verification (your `requirements` table will be
empty), safety documentation, parts logistics — and anything whose RE is slow to reply.

**The worse second-order effect:** joining is free and interesting, so members join five
projects and contribute to one. Every roster now overstates its staffing and REs plan
against headcount that doesn't exist. **That's worse than the status quo, because it's
disorganization with false confidence.** It also breaks the update system — a member on
five projects owes five sections and will write nothing meaningful in any of them.

**Recommendation.** Separate **following** from **committing**: browse and follow
anything, but **commit to at most 2 (hard max 3)** with a visible "at capacity" state.
Make `responsibility` **required at join time** — joining should mean claiming something
specific. Show **committed vs. needed** per project. Add a leadership-set **"needs help"**
boost that pins understaffed work to the top of the find-work feed. And accept that some
work must be **assigned and rotated** — a shop-duty and integration rotation with explicit
credit. A club that only does what people volunteer for never finishes an aircraft.

---

## Two structural notes

### The reviewer often has no context

The two-tree separation (correctly) means a member's Lead is often not an RE on their
projects. So a Structures Lead reads an update about a SkyDelta software project, can add
nothing, and yet owns the review and the on-track/at-risk flag.

Content-free reviews are worse than none: they teach members that updates are ritual. This
is the specific mechanism by which the system becomes theater.

**Recommendation.** Make the **RE the primary responder per update entry** — they own the
domain and the blocker. Reduce the Lead's role to a **fortnightly 1:1 plus an exception
feed** (missed updates, unanswered blockers, flat hours). Roughly halves review load and
puts each response with someone who can actually help.

### The org model is sized for 150 people, not 35

35 ÷ 5 divisions = 7 people per division. A sub-team is 3. A "sub-sub-team: Composites" is
**one sophomore**. Add Team Leads at each level plus REs at every project level and you
could have 15 of 35 people holding a title. Meanwhile the score *pays* 20% for RE roles,
capped at three — so collecting titles is score-optimal.

Title inflation is the classic student-org failure: everyone leads something and nobody
builds.

**Recommendation.** Keep arbitrary nesting in the schema — it's free and correct — but
enforce a **soft UI limit of org depth 2 and project depth 3**, and require a unit to
exceed ~8 people before it can spawn a sub-team. At launch, **2 Co-Leads + 5 Division
Leads is your complete Team Lead tier**; don't create leads below division level until a
division passes ~10 people. Cap RE credit at **one** primary role.

---

## Missing features a working UAV team needs

Ranked by how much a real team would use them.

1. **Purchase requests and budget.** "Who ordered the carbon fiber, did it arrive, what's
   left in the budget, who approves a $40 servo, where's my reimbursement." This is the #1
   operational bottleneck of every student engineering team and the thing that blocks work
   most often. **Note: the reference UI Anish supplied has "Finances" in the nav and a "Log
   purchase" button — and the plan dropped it.** A minimal `purchase_requests` table
   (requester, project, item, link, cost, status: requested → approved → ordered →
   received, reimbursement status) plus a per-division budget rollup would be used *daily*
   and earn more goodwill than Phases 6, 7 and 8 combined.
2. **A blocker / "I need help" board.** Blockers currently surface only inside a scheduled
   update, so someone stuck on Tuesday waits until their update day. A standing help board
   unblocks people in hours, answers "I can't find anything to do," and lets *peers* help
   each other — the only mechanism that builds peer bonds.
3. **Decision log.** Options considered, choice, rationale, date, who. Turnover-heavy teams
   re-litigate settled questions every year because the reasoning graduated. One table.
4. **Flight and safety log.** For a *drone* club: flights, airframe status, pre-flight
   checklists, incident reports, authorized pilots. `flight` exists as a training category
   and `flight_test` as a phase, but **nothing records a flight.** If the app omits the
   highest-stakes data the club produces, it isn't the system of record.
5. **Drop-in attendance.** Weekly build sessions need a QR code on the door, not an RSVP
   flow.
6. **Inventory.** "Do we already own a 6S battery? Where's the torque wrench?"
7. **A new-member starter path.** "Find work" assumes you can evaluate projects. A
   first-year can't. They need three trainings, one small scoped task, and a named buddy.
   Add a "good first task" flag.
8. **Equipment and shop-bay reservations.**
9. **Recruitment pipeline.** Fall recruiting determines the year's roster, and invite-only
   means the app can't help with the biggest annual event.
10. **Cross-project procedure library.** "How do I run the CNC." Artifacts are per-project;
    there's no shared how-to shelf. This is what makes year two better than year one.

---

## What breaks at predictable moments

**There is no academic calendar in the data model** — a notable omission for a
quarter-system school. `is_paused` is per-member and manual, and nobody will set it.

| When | What happens |
|---|---|
| **Finals week** | Everyone misses ~6 updates. Scores collapse club-wide. "You missed your update" emails land on maximally stressed students — worst message at the worst moment |
| **Winter / spring break** | 2–3 weeks of silent `missed` rows for everyone |
| **Summer** | 11 weeks. By autumn, compliance data is garbage and every engagement snapshot is meaningless |
| **Quarter transitions** | Nothing marks a new quarter, so projects accumulate zombie members — people listed on four projects they abandoned in the fall. Within two quarters "who's on what" is a lie, destroying trust in the one part that was working |
| **Graduation** | No succession workflow: no RE handoff, no year archive, no lead promotion path |
| **RE goes inactive** | See §5 — hard stop on their whole subtree |

**Recommendation.** Add a **`terms` table** (quarter start/end, in-session flag, dead week,
finals, breaks). Generate update obligations only on in-session weekdays; auto-suppress
nudges during finals and breaks. Add a **quarterly re-enrollment sweep**: every member
re-confirms their projects at quarter start, unconfirmed enrollments auto-close. That one
feature keeps the roster honest indefinitely.

---

## How this most likely degrades

| When | What |
|---|---|
| Weeks 1–2 | Launch enthusiasm. 30 of 35 sign in. Genuinely useful |
| Week 3 | First full week of updates. On-time ~65%. Leads review conscientiously |
| Week 4 | Midterms. Submissions ~45%. Queues hit 40 unread. Leads start click-acknowledging. Two stop opening it |
| Week 5 | Members notice nobody responded to their last three updates. Update text collapses to one line. **Hours logging dies first** — easiest to skip, no audience, nothing breaks |
| Weeks 6–7 | A Co-Lead posts "please submit your updates" in Slack. **This is the moment the app becomes a compliance instrument rather than a tool** |
| Week 8 | Only the project tree and calendar are still used — i.e. Phase 2 |
| Weeks 10–11 | Finals. Zero activity, nudges firing, scores showing universal failure |
| Next quarter | Nobody relaunches. Project data is three months stale, so even the good part loses trust |

**The trigger is not member laziness. It's the first week a Lead doesn't respond.** Design
against that single event: make responding cheap, route it to someone with context, make
non-response visible upward, and set a cadence a Lead can sustain.

---

## Rollout — currently absent, and where tools like this actually die

In order:

1. **Budget the data-entry day.** On day one the app is empty, and an empty project tree is
   worse than a Google Doc. Someone must enter 5 divisions, ~20 projects, 35 members,
   current REs, and each person's responsibility. That's 4–8 hours of unglamorous work and
   the single most likely thing to not happen. Assign it to the **Co-Leads, not Anish**,
   in one room, with pizza, before launch.
2. **Kill one incumbent completely.** Adoption fails when the tool is additive. If updates
   still happen in Slack and the project list still lives in Notion, this is a second place
   to look and it dies. Move one thing entirely: "the project list lives only here; the
   Notion page is deleted today."
3. **Promote a Slack/Discord bot to Phase 3.5.** For a tool whose core jobs are reminders
   and finding work, a bot posting "you owe an update" and "3 new open projects" is higher
   leverage than the Gantt chart, events, and engagement UI combined. Meet people where
   they already are.
4. **Pilot with one division.** 7 people, 3 weeks, 1 update/week. Success criterion: do
   they log in *unprompted* twice a week? Don't go club-wide until that's true.
5. **Run a launch ritual.** 20 minutes at a general meeting where all 35 sign in, fill
   their profile, and join a project *in the room, on their phones*. Anyone who leaves
   without an account probably never makes one.
6. **Recruit 2–3 champions who aren't Co-Leads.** Peer adoption beats mandate.
7. **Put a "this is annoying" button in the nav.**
8. **Write down what success means before launch.** e.g. 70% unprompted weekly logins, 60%
   on-time updates, 80% of members on ≥1 project, autumn-to-winter retention up from X to
   Y. Without a target you won't know whether to keep going, and you'll spend the winter
   perfecting the Gantt chart.

---

## Scope: name the phases that probably aren't happening

Nine phases including nested critical-path Gantt, events, trainings, engagement UI and an
offline PWA is one to two engineer-*years* of professional work. A solo beginner alongside
Stanford coursework realistically ships Phases 0–3 in two quarters if things go well.

**Auto-Gantt with critical path on a volunteer team is fiction.** Availability fluctuates
with midterms, the dates are wrong the day after they're entered, and a *wrong* schedule is
worse than none because people plan against it. It's simultaneously the most seductive
feature in the plan and the one that will eat a month.

**Recommendation.** Label Phase 6 (Gantt) and Phase 8 (engagement UI) explicitly
**"probably never — and that's fine."** Replace Phase 6 with a plain **milestones list**:
name, target date, owner, status. 80% of the value for 5% of the work. Reallocate that
time to the RE liveness monitor, the academic calendar, and purchase requests — all of
which get used weekly.

---

## The cheapest, highest-value thing available

**Talk to eight people for fifteen minutes each: five who quit in the last year, three who
stayed.** Ask what specifically made them stop showing up.

Every document in this repo traces back to one unverified sentence — "disorganization is
the top cause of attrition." That's a leadership-side diagnosis of a member-side problem.
Members rarely say "I quit because of disorganization." They say "I never actually got to
build anything" or "I didn't know anybody there."

If the real driver is belonging, then most of Phase 4 is effort on the wrong axis — and it
costs member goodwill besides. Those eight conversations will reorder this entire roadmap,
and you cannot get that information from a schema.

---

## Revised recommended order

| Priority | Work | Why |
|---|---|---|
| **0** | Eight exit conversations | Validates or reorders everything below |
| **1** | Phase 1 auth + Phase 2 project discovery, enrollment cap 2, responsibility required | The part that justifies the whole project |
| **2** | Academic calendar (`terms`) + quarterly re-enrollment sweep | Prevents the data rot that kills trust in Phase 2 |
| **3** | RE liveness monitor + required deputy RE | Highest-severity structural failure, happens annually |
| **4** | Hours logging (Phase 3) | High frequency, feeds everything, low burden |
| **5** | Purchase requests + budget | Daily use, biggest real bottleneck, in your own reference UI |
| **6** | Blocker / help board | Unblocks in hours, builds peer bonds, answers "what do I do" |
| **7** | Updates — **weekly**, RE-responded, with amnesty and pause | The risky one. Paper-prototype first |
| **8** | Trainings + facility access | Self-contained, motivating, safety-relevant |
| **9** | Slack bot | Meets people where they are |
| **10** | Milestones list (not Gantt) | 80% of value, 5% of work |
| **Later / never** | Critical-path Gantt, engagement scoring UI, PWA | Be at peace with this |

---

## The three-sentence version

Ship project discovery — find work, who's the RE, open enrollment with a 2-project cap —
because that alone justifies the project and will still be running in two years. Cut
updates to weekly, route responses to REs instead of Leads, add an academic calendar and an
inactive-RE detector, and show members their own scores. Then build purchase requests and a
blocker board instead of the Gantt chart.
