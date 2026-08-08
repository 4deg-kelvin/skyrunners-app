# Open questions — phases 5 to 11

**Written 2026-08-08.** Everything here changes what gets built. Anything I could
reasonably decide myself, I have decided and it isn't in this list.

Each question has a **recommended default**. You can reply "defaults except 3, 7,
12" and that's enough to unblock everything. Phase 12 (purchasing) is excluded
per your instruction.

---

## Calendar and meetings — Phase 8

You gave the most direction here, and it raised the questions I most need
answered before building.

### 1. Are one-to-ones visible to the whole club?

You want 1:1s on the calendar. That collides with the privacy model, which keeps
the *personal* half of a check-in between a member and their Lead.

- **Recommended:** the 1:1 **exists** publicly as a busy block — "Kenji + Marcus,
  Tue 3pm" — with no agenda or notes. Everyone can see the club is meeting and
  who with; nobody sees what about.
- Alternatives: fully private (only participants see it), or fully public
  including any agenda.

The recommendation is what makes "see when everyone is meeting" work without
turning a 1:1 into a performance.

### 2. What does "important stuff shows" rank by?

Events have an `importance_weight` (1–5). Something has to set it.

- **Recommended:** the event *kind* sets a default (general meeting 5, design
  review 4, build session 3, 1:1 2, social 1), and whoever creates it can
  override. Sorting and visual weight follow that number.
- Alternative: creator picks every time — more control, more friction, and in
  practice everyone leaves it on the default anyway.

### 3. Default calendar view?

- **Recommended:** an **agenda list** grouped by day, with a week grid available.
  A month grid looks impressive and is unusable on a phone, and hours get logged
  in the lab on phones.
- Alternative: week grid default.

### 4. Should deliverable due dates appear on the calendar alongside meetings?

- **Recommended:** yes, visually distinct from meetings. It's the only way the
  calendar answers "what's actually coming up" rather than "when are we in a
  room".
- Alternative: meetings only, deadlines stay on the project page.

### 5. Recurring meetings — needed now?

Weekly build sessions and standing 1:1s are the obvious cases.

- **Recommended:** yes, but only simple weekly/biweekly recurrence with an end
  date. Full RRULE support (exceptions, "third Tuesday") is a large amount of
  work for a club that meets on a fixed rhythm.

### 6. Who can create which event kinds?

- **Recommended:** any member can create a 1:1 with anyone; Leads and Co-Leads
  can create anything else. Matches how meetings actually get scheduled, and
  stops the calendar filling with club-wide events nobody called.

---

## Terms and re-enrollment — Phase 5

### 7. Should I preload Stanford's academic calendar?

Obligations only generate on in-session weekdays, so the terms table has to be
real or check-ins will generate over winter break.

- **Recommended:** I preload 2026–27 quarter dates, finals weeks and breaks as a
  migration, and Co-Leads can edit them. Faster than data entry and easy to fix.
- **I need from you:** confirmation the club follows the standard university
  calendar and not something custom.

### 8. What happens to someone who doesn't re-enroll at quarter start?

- **Recommended:** their project memberships close automatically, they stay an
  active member, and their REs are told. Nobody is removed from the club for
  missing a form; the roster just stops claiming they're on projects they aren't.
- Alternative: deactivate the member entirely (harsher, and reversible only by a
  Lead).

### 9. Does re-enrollment also drop RE roles?

- **Recommended:** no. An RE who goes quiet is handled by the liveness alert,
  which names a person; silently vacating accountability at quarter boundaries
  would leave projects ownerless with nobody noticing.

---

## Blocker board — Phase 6

### 10. Blocked deliverables only, or free-form posts too?

- **Recommended:** both. Blocked deliverables appear automatically; anyone can
  also post "I need help with X". The second is what makes it useful to somebody
  who hasn't been assigned work yet — which is the member most at risk of
  leaving.

### 11. Who can clear a blocker?

- **Recommended:** the owner or any RE of that project. Whoever *helped* posts a
  reply, but only the owner or RE closes it — otherwise a helpful person marks it
  solved and the owner discovers it wasn't.

---

## Check-ins and the review chain — Phase 7

Mostly built. Two gaps.

### 12. What is a roll-up, concretely?

"Leads roll reports up to Co-Leads" is in the plan, but not what it contains.

- **Recommended:** auto-generated per Lead — who's on track, who's blocked, who
  hasn't checked in — with one free-text box for the Lead to add context. No
  blank page, and 60 seconds of work.
- Alternative: fully written by the Lead (higher quality, much lower completion).

### 13. How many nudges before the app stops nagging?

- **Recommended:** in-app on the due date, one more the day after, then silence —
  the escalation to the Lead above takes over at day three. An app that keeps
  nagging gets muted, and then the escalation doesn't work either.

---

## Trainings and facility access — Phase 9

**This phase is blocked on your data, not on decisions.**

### 14. What are the actual trainings and facilities?

I need the real list: training names, which expire and after how long, and which
facilities each one unlocks (Robotics Room, Lab 64 24-hour, PRL). Without it I'd
be inventing a compliance system, which is the one area where invented data is
actively dangerous.

### 15. Who verifies a training?

- **Recommended:** any Lead or Co-Lead, with who-verified recorded. Requiring a
  specific person per training is more correct and creates a bottleneck for
  safety access, which is the worst thing to bottleneck.

### 16. Certificate uploads — files or links?

- **Recommended:** links only for now. File upload means Supabase Storage,
  storage policies, and a retention question, for a feature whose value is "one
  click to see proof". A Drive link does that today.

---

## Contribution view — Phase 10

### 17. Trend over time needs history the app isn't keeping.

"Improving or fading" requires weekly snapshots, and none exist. If I don't start
capturing them now, the feature has no data whenever it's built.

- **Recommended:** start writing a weekly contribution snapshot immediately, even
  though nothing reads it yet. Cheap now, impossible to backfill later.

### 18. Confirming: still no ranking?

- **Recommended:** confirmed — filter and sort, but no rank column, no "top
  contributor". Sorting by hours is one CSS change away from a leaderboard, so I
  want this stated rather than assumed.

---

## Milestones — Phase 11

### 19. Do milestones belong to a project or a division?

- **Recommended:** a project, with deliverables rolling up into them. Division-
  level milestones sound useful and in practice become a second planning layer
  nobody maintains.

### 20. What happens when a deliverable slips past its milestone?

- **Recommended:** the milestone shows "at risk" and it appears in the RE's
  attention list. No notification — dates move constantly on a volunteer team,
  and an alert per slip is an alert nobody reads.

---

## Cross-cutting

### 21. Bulk import for launch day?

`PHASE_PLAN.md` estimates 4–8 hours of data entry for 5 divisions, ~20 projects,
35 members. Typing that through the UI is most of a day.

- **Recommended:** I build a CSV import for members and projects, Co-Lead only.
  Roughly a day of work that saves a day of typing and makes re-doing it cheap
  when the first attempt is wrong — which it will be.

### 22. Who are the other Co-Leads?

Right now you are the only one, and the app refuses to let the last Co-Lead be
demoted. I need at least their names and Stanford emails to set up a realistic
hierarchy — and you want a second Co-Lead before launch anyway, so you're not a
single point of failure.

### 23. Email: when, and how loud?

Resend is in the stack and unused. Once notifications go out, tone matters more
than plumbing.

- **Recommended:** one weekly digest per person, plus immediate email ONLY for
  things a human is waiting on (a join request, an escalation). Nothing else.

---

## What I'd do first, given free choice

1. **Calendar (Phase 8)** — you asked for it, and it's the most visible
   improvement to daily use.
2. **Blocker board (Phase 6)** — small, and it directly serves the "can't find
   work" problem the app exists for.
3. **Bulk import (21)** — because launch day is otherwise a full day of typing.
4. **Terms (Phase 5)** — unglamorous, but without it check-ins generate over
   winter break and the app starts lying.
