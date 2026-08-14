# Removing hours: the plan

Status: **DONE, 2026-08-14.** Migration `0039_remove_hours.sql`. Kept as the
record of why, not as work outstanding — the reasoning below is what stops the
tiers being rebuilt by somebody who reads only the code.

**What differs from the plan as written**, so nobody has to diff it:

| Plan said | Shipped | Why |
|---|---|---|
| The check-in window starts at "the previous check-in's **due** date" | Starts at the last **submitted** check-in's date | The due date is wrong twice over: a LATE check-in would re-report entries it already covered, and a MISSED one would silently drop the week before it. Anchoring to the last submission makes the window mean exactly "everything not yet reported", which is also precisely what `workIsLocked` means — so the two rules can't drift. See `lib/checkin-draft.ts` |
| `hoursOnProject` simply disappears | Became `daysWorkedOnProject` — distinct days, not entries | The per-project figure an RE is allowed to see is load-bearing (it's the public half of the privacy split). Counting entries would rebuild volume in a new unit; counting days won't, since three entries in one afternoon is one day |
| `hoursThisWeek` on the dashboard disappears | Became `logsThisWeek`, a COUNT | A club-wide liveness reading — "is anyone logging?" — never per person, never divided by headcount |
| — | `showHours` deleted from `/updates` | It gated nothing else once hours were gone. The privacy rule it protected is still enforced upstream in `can.viewMemberEffort` |
| — | `updateClubTiers` deleted, and a latent bug recorded | It rebuilt the `club_settings` row from the four numbers alone, so saving tiers wiped `clubName`, `clubDescription` and `discordInviteUrl`. Same shape as the `updateTeam` bug in HANDOFF §8. Noted in `operations.ts` in case anything writes that row again |

Two things the plan listed that turned out not to exist: there was no
`TIER_THRESHOLDS` constant left to delete (already data since 0020), and
`activeWeeksFor` had to go too — it existed only as the divisor of a rate nothing
computes any more.

Everything below is the plan as agreed, unchanged.

---

Written 2026-08-14 after scoping it and backing out a partial attempt.

## What the club decided

Hours are not the measure. Progress is **deliverables met**. The log stops being
a timesheet and becomes a diary: what you did, on each project, day by day. The
twice-weekly check-in then writes itself from that diary, and only asks for a
line about a project the member logged nothing on.

Two calls made explicitly, so they don't get re-litigated:

| Decision | Choice |
|---|---|
| The Core / Committed / Contributing tiers | **Removed.** Three signals remain: Delivered, Reliability, Scope |
| Historical hours already recorded | **Rows kept, numbers never shown again.** Nothing deleted |

## The finding that shapes the work

**Hours removal and tier removal have to ship in the same change.** They cannot
be sequenced.

The tempting order is "stop collecting hours first, clean up the tiers after",
because the first half is small and safe. It is actively harmful. `commitmentTier`
is hours ÷ in-session weeks since joining — a rolling figure. Stop feeding it and
every member's tier decays toward *Light* over the following weeks, on their own
profile and in the published rubric, with no new data causing it. The app would
spend a month telling people their commitment was collapsing because a feature
was half-removed.

So it is one change or none.

## Blast radius, measured

60 files mention hours. A trial removal of `WorkLog.hours` produced ~20 compile
errors, which is the honest map of the work:

**Aggregates that stop existing**
- `hoursThisWeek()`, `hoursOnProject()`, `hoursOnProjectThisWeek()` in `lib/mock-data.ts`
- `hoursThisWeek` on the dashboard view, and `hoursThisWeek` per Lead in the roll-up
- `goneQuiet` currently means "logged zero hours this week" — becomes "logged nothing"
- `MyProjectCard.hoursLogged`

**The contribution model** — `lib/contribution.ts`
- Delete `CommitmentTier`, `TIER_LABELS`, `TierThresholds`, `DEFAULT_TIERS`,
  `tierThresholds`, `commitmentTier`, `nextTierGap`, `tierDescriptions`,
  `WEEKLY_HOURS_EXPECTATION`, `WEEKLY_HOURS_MINIMUM`
- Drop `Commitment` from `ContributionRecord`; drop `hoursTotal` and `tiers` from
  `ContributionInputs`
- `LEADERSHIP_RUBRIC` — the "Sustained commitment" row currently says "Core or
  Committed tier held across a quarter" and needs rewriting against something real

**Surfaces that render tiers**
`lib/data/members.ts`, `lib/data/settings.ts` (`getClubTiers`),
`components/ui/contribution-panel.tsx`, `components/forms/tier-admin.tsx`
(delete), `app/(app)/settings/page.tsx`, `app/(app)/how-we-lead/page.tsx`,
`app/(app)/getting-started/page.tsx`

**Elsewhere**
- `lib/notify/digest.ts` — "logged 2 hrs" becomes the description
- `lib/mcp/tools.ts` — `log_hours` → `log_work`; `lib/mcp/guide.ts` copy
- `components/forms/log-hours-form.tsx` — drop the number, require the note
- Tests: `operations.test.ts`, `calendar.test.ts`, `my-work.test.ts`,
  `contribution.test.ts`, `digest.test.ts`

## Schema — migration 0039

Additive and non-destructive, in keeping with the never-hard-delete rule.

- `work_logs.hours` → drop `NOT NULL`. Column and existing values stay.
- `work_logs.description` → stays nullable in SQL (some historical rows have
  none, and inventing text for a real record is worse than a gap). Required in
  `logWork` instead.
- Drop the `sync_update_hours` trigger and function from 0007 — it recalculates
  `update_entries.hours` from `work_logs` and no longer means anything.
- `update_entries.hours` and `progress_updates.hours_this_period` → leave the
  columns, stop reading and writing them.
- `club_settings` tier floors → leave the columns, remove from the app's column
  spec so `loadSnapshot` stops selecting them.

## The two new behaviours

**Check-in auto-fill.** When a draft is opened, for each project the member is
committed to, gather their work-log entries since the previous check-in's due
date (or the last 7 days if there is no previous one). If there are entries, the
project's section is pre-filled from them and needs no typing. If there are none,
that section is empty and required — which is the only thing the member has to
write.

Worth deciding when building: whether the pre-filled text is editable (it should
be — the log is raw notes, the check-in is what they want their Lead to read).

**Day by day.** The log becomes a dated list grouped by day, on My Work. The
existing `recentWorkLogs` (14-day window) and `lastWorkLogs` fallback already do
the fetching; this is a grouping and a heading change, plus dropping the hours
column from the row.

## Why this wasn't done in the session that planned it

It was scoped, the model change was started, and then backed out to a clean tree
rather than left half-applied. The reason is the coupling above: a partial
version is worse than none, and this touches the club's contribution model —
which every member sees on their own profile — so it wants a full pass with
tests and a careful read of `/how-we-lead` before it goes near production.

Nothing from the attempt is left in the tree. Start from `main`.
