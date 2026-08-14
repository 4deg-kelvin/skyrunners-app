-- ===========================================================================
-- 0043_recurring_events.sql
--
-- Weekly and fortnightly meetings: the club's team meeting and its townhall.
--
-- ---------------------------------------------------------------------------
-- ONE row per series, expanded on read. Never many rows.
-- ---------------------------------------------------------------------------
--
-- The tempting alternative is to write ten `events` rows when somebody creates a
-- weekly meeting. It is wrong in three ways that only show up later:
--
--   * **RSVP fragments.** Ten rows means ten `attendee_ids` arrays, so "I come to
--     the weekly meeting" becomes ten clicks and nobody's attendance is
--     answerable in one place. Anish asked for exactly the opposite: RSVP once and
--     have every occurrence land in your calendar.
--   * **Editing becomes ten edits.** Moving the meeting an hour later means
--     finding every future copy, and any already edited individually is now
--     inconsistent with no record of which was intended.
--   * **The feed bloats.** One VEVENT with an RRULE is a few lines; fifty-two
--     VEVENTs is a document every phone re-downloads on every refresh.
--
-- So one row, one attendee list, one edit — and `lib/calendar/recurrence.ts`
-- expands occurrences when a page or a feed needs them.
--
-- ---------------------------------------------------------------------------
-- Weekly and fortnightly ONLY, deliberately
-- ---------------------------------------------------------------------------
--
-- RFC 5545's RRULE can express "the last Thursday of every second month except
-- December". Supporting that means a recurrence engine, which is a classic way for
-- a small codebase to acquire a permanent maintenance burden — every date bug for
-- the next two years lands in it.
--
-- A student club meets weekly, fortnightly, or once. `repeat_every_weeks` covers
-- all three with one integer, and the CHECK below keeps it to values the app can
-- actually render and validate.
-- ===========================================================================

alter table events
  -- Last date the repeat may land on, INCLUSIVE. Null means a one-off.
  --
  -- Required when repeating, enforced in the app rather than by a CHECK, because
  -- the useful error names the mistake ("that would repeat 5,214 times, over 100
  -- years") and a constraint violation cannot.
  add column if not exists repeat_until date,

  -- 1 = weekly, 2 = fortnightly. Null/1 both mean weekly.
  --
  -- The CHECK is deliberately narrow. A 3 or a 7 would expand and emit valid ICS,
  -- but no UI offers it, so a value outside this range could only arrive from a
  -- hand-written API call or a bug — and silently accepting it would put a
  -- schedule on the club calendar that nobody can edit back.
  add column if not exists repeat_every_weeks integer
    check (repeat_every_weeks is null or repeat_every_weeks in (1, 2)),

  -- Occurrence dates the club cancelled, e.g. finals week.
  --
  -- A date[] rather than a join table, on the same test the schema already applies
  -- to `events.attendee_ids`: written whole, read whole, never queried by element.
  --
  -- It exists so cancelling ONE week doesn't mean deleting the series and losing
  -- its attendee list. Becomes EXDATE in the feed, which is what actually clears
  -- that week from a member's phone — without it the client expands the rule
  -- itself and shows a meeting nobody is attending.
  add column if not exists skipped_dates date[] not null default '{}';

-- A repeat with no end date would expand forever. Guarded here as well as in the
-- app because a NULL end on a repeating row is the one state that has no sensible
-- reading — and unlike the interval, it cannot be defaulted.
alter table events
  drop constraint if exists events_repeat_needs_end;

alter table events
  add constraint events_repeat_needs_end
  check (repeat_every_weeks is null or repeat_until is not null);

comment on column events.repeat_until is
  'Last date a repeat may land on, inclusive. Null = one-off. Added 0043.';
comment on column events.repeat_every_weeks is
  '1 weekly, 2 fortnightly. Null reads as weekly. Expanded by lib/calendar/recurrence.ts; emitted as RRULE in the ICS feed. Added 0043.';
comment on column events.skipped_dates is
  'Cancelled occurrence dates. Becomes EXDATE in the feed so the week actually clears from a subscriber calendar. Added 0043.';
