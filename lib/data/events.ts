/**
 * The calendar.
 *
 * ---------------------------------------------------------------------------
 * What it answers
 * ---------------------------------------------------------------------------
 *
 * *"What is happening right now, and can I join it?"* That's the whole brief.
 * It is **not** a meeting-scheduling tool: no availability matching, no invite
 * negotiation, no RSVP round trip. Its job is the same as `/find-work` — make
 * it possible to plug into the club's work without asking a Co-Lead.
 *
 * The case that pays for it is the **ad-hoc engineering session**: two people
 * on the wing spar Thursday night, visible, so a third can turn up.
 *
 * ---------------------------------------------------------------------------
 * Overlaps
 * ---------------------------------------------------------------------------
 *
 * Concurrent events are NORMAL — a design review runs inside a general
 * meeting — and **both have to stay readable**. That's the requirement a
 * standard calendar grid quietly drops, by stacking one behind the other or
 * collapsing the rest into "+2 more". So this returns a day-grouped list
 * rather than a grid, and every event in a day renders in full.
 *
 * Deadlines ride along in the same stream. A project target is a thing
 * happening on a date, and keeping it on a separate page meant checking two
 * places to answer one question.
 */

import {
  divisionForProject,
  getMember,
  getProject,
  today,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { preloadLiveStore } from "@/lib/store/request";
import {
  occurrenceDates,
  occurrenceEnd,
  occurrenceStart,
} from "@/lib/calendar/recurrence";
import { addDays, todayInClubTime } from "@/lib/dates";
import {
  isCoLead,
  isREofOrAbove,
  type Actor,
  type OrgGraph,
} from "@/lib/permissions";
import type { ClubEvent, Member, Project } from "@/lib/types";

/** How far ahead the calendar looks by default. */
const HORIZON_DAYS = 60;

export interface CalendarEvent {
  event: ClubEvent;
  project?: Project;
  attendees: Member[];
  organiser?: Member;
  /** The viewer is on the attendee list. */
  isAttending: boolean;
  /** The viewer created it, or is leadership. */
  canManage: boolean;
  /**
   * Another event on this day overlaps in time.
   *
   * Surfaced rather than hidden. Two things at once is a fact somebody needs
   * before they promise to be at both — the failure mode is a calendar that
   * quietly renders one of them and lets you find out on the night.
   */
  overlaps: boolean;
}

/** A project target or deliverable due date, shown inline with events. */
export interface CalendarDeadline {
  key: string;
  title: string;
  projectName: string;
  projectSlug: string;
  divisionName?: string;
  kind: "project" | "deliverable";
  overdue: boolean;
}

export interface CalendarDay {
  date: string;
  events: CalendarEvent[];
  deadlines: CalendarDeadline[];
}

export interface CalendarView {
  days: CalendarDay[];
  /**
   * Projects this person may attach an event to.
   *
   * Three ways to qualify, and the old code had two different wrong answers
   * for the same question:
   *
   *   - you're COMMITTED to it — a session on work you're doing
   *   - you're an RE of it or of anything above it — authority inherits down
   *     the project tree, so a Division Lead can schedule a review on any
   *     project inside their division without being named on it
   *   - you're a Co-Lead
   *
   * Creating used to offer only committed memberships, which silently excluded
   * every RE who holds a project through inheritance. Editing offered EVERY
   * live project to anybody who could edit the event, which let a member move
   * a club-wide session onto work they have nothing to do with. One list, one
   * rule, both forms.
   */
  myProjects: { id: string; name: string }[];
  /**
   * Same list as `myProjects`, kept as a separate field so the edit form's
   * intent stays readable at the call site.
   *
   * It used to be every live project in the club. That was wrong: the
   * commonest reason to edit the link is attaching a club-wide session to the
   * work it turned out to be about — but "the work it turned out to be about"
   * is still work the organiser has standing on, and offering everything let
   * somebody point an event at a project they have nothing to do with.
   */
  allProjects: { id: string; name: string }[];
  /** Everyone active, for naming who you're working with. */
  people: { id: string; fullName: string }[];
  canCreateClubEvent: boolean;
  today: string;
}

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Do two events share any minute? Open-ended events count as one hour. */
function timesOverlap(a: ClubEvent, b: ClubEvent): boolean {
  const start = (e: ClubEvent) => Date.parse(`${e.startsAt}:00`);
  const end = (e: ClubEvent) =>
    e.endsAt ? Date.parse(`${e.endsAt}:00`) : start(e) + 3_600_000;
  return start(a) < end(b) && start(b) < end(a);
}

export async function getCalendar(input: {
  memberId: string;
  isLeadership: boolean;
  /**
   * Needed to work out which projects this person may attach an event to.
   *
   * Optional so `verify:live` and the store tests can call this without
   * building a graph — without it, the linkable list falls back to committed
   * memberships only, which is the narrower answer and never the wrong one to
   * fail towards.
   */
  viewer?: { actor: Actor; graph: OrgGraph };
  /** Days ahead. The page passes nothing; tests pass a window. */
  horizonDays?: number;
}): Promise<CalendarView> {
  await preloadLiveStore();
  const store = readStore();
  const now = today();

  const horizon = new Date(`${now}T00:00:00Z`);
  horizon.setUTCDate(
    horizon.getUTCDate() + (input.horizonDays ?? HORIZON_DAYS)
  );
  const until = horizon.toISOString().slice(0, 10);

  /*
    Everything from today to the horizon.

    The club meets over academic breaks, so this deliberately does NOT consult
    the terms table. A `Term` with `generatesObligations = false` suppresses
    CHECK-IN obligations and nothing else — treating it as "the club is closed"
    would hide exactly the summer build sessions people show up to.
  */
  /*
    Every OCCURRENCE in the window, not every event row.

    A repeating meeting is one row (migration 0043), so filtering on `startsAt`
    would show the club's weekly meeting exactly once — on the day the series
    began, possibly months ago and therefore not at all.

    `occurrenceDates` expands it, and each occurrence is presented as a synthetic
    event carrying the series' id. That id is what every control needs: RSVPing
    joins the SERIES, which is the whole point — one answer covers every week.

    The `key` is what makes two occurrences of one series distinct to React
    without pretending they are different events.
  */
  const inWindow = expandOccurrences(store.events, now, until);

  /*
    What this person may hang an event on. Committed, or RE-of-or-above, or a
    Co-Lead — see `myProjects` on `CalendarView` for why all three.
  */
  const committedTo = new Set(
    store.projectMemberships
      .filter(
        (m) => m.memberId === input.memberId && m.commitment === "committed"
      )
      .map((m) => m.projectId)
  );
  const linkable = store.projects
    .filter((p) => {
      if (p.phase === "complete") return false;
      if (committedTo.has(p.id)) return true;
      if (!input.viewer) return false;
      return (
        isCoLead(input.viewer.actor) ||
        isREofOrAbove(input.viewer.actor, input.viewer.graph, p.id)
      );
    })
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byDay = new Map<string, ClubEvent[]>();
  for (const event of inWindow) {
    const day = dateOf(event.startsAt);
    const list = byDay.get(day);
    if (list) list.push(event);
    else byDay.set(day, [event]);
  }

  // Deadlines, same window, keyed by day so they interleave with events.
  const deadlinesByDay = new Map<string, CalendarDeadline[]>();
  const pushDeadline = (day: string, item: CalendarDeadline) => {
    const list = deadlinesByDay.get(day);
    if (list) list.push(item);
    else deadlinesByDay.set(day, [item]);
  };

  for (const project of store.projects) {
    if (!project.targetDate || project.phase === "complete") continue;
    if (project.targetDate < now || project.targetDate > until) continue;
    pushDeadline(project.targetDate, {
      key: `project:${project.id}`,
      title: `${project.name} target`,
      projectName: project.name,
      projectSlug: project.slug,
      divisionName: divisionForProject(project.id)?.name,
      kind: "project",
      overdue: false,
    });
  }

  for (const deliverable of store.deliverables) {
    if (!deliverable.dueDate || deliverable.status === "done") continue;
    if (deliverable.dueDate < now || deliverable.dueDate > until) continue;
    const project = getProject(deliverable.projectId);
    if (!project) continue;
    pushDeadline(deliverable.dueDate, {
      key: `deliverable:${deliverable.id}`,
      title: deliverable.title,
      projectName: project.name,
      projectSlug: project.slug,
      divisionName: divisionForProject(project.id)?.name,
      kind: "deliverable",
      overdue: false,
    });
  }

  const days: CalendarDay[] = [
    ...new Set([...byDay.keys(), ...deadlinesByDay.keys()]),
  ]
    .sort()
    .map((date) => {
      const dayEvents = (byDay.get(date) ?? []).sort(
        (a, b) =>
          // Time first, then importance — a 5 at 6pm must not jump above a 2 at
          // 9am, or the day stops reading as a day.
          a.startsAt.localeCompare(b.startsAt) ||
          b.importanceWeight - a.importanceWeight
      );

      return {
        date,
        events: dayEvents.map((event) => ({
          event,
          project: event.projectId ? getProject(event.projectId) : undefined,
          attendees: event.attendeeIds
            .map((id) => getMember(id))
            .filter((m): m is Member => Boolean(m)),
          organiser: event.createdBy ? getMember(event.createdBy) : undefined,
          isAttending: event.attendeeIds.includes(input.memberId),
          canManage: input.isLeadership || event.createdBy === input.memberId,
          overlaps: dayEvents.some(
            (other) => other.id !== event.id && timesOverlap(event, other)
          ),
        })),
        deadlines: deadlinesByDay.get(date) ?? [],
      };
    });

  return {
    days,
    myProjects: linkable,
    allProjects: linkable,
    people: store.members
      .filter((m) => m.status === "active" && m.id !== input.memberId)
      .map((m) => ({ id: m.id, fullName: m.fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    canCreateClubEvent: input.isLeadership,
    today: now,
  };
}

/**
 * Every OCCURRENCE of every event between two dates, as synthetic events.
 *
 * A repeating meeting is ONE row (migration 0043) whose `startsAt` is the day the
 * series began. So anything that filters or sorts on `startsAt` sees the club's
 * weekly meeting once, in the past, and never again — which is not a rendering
 * detail but the difference between a calendar that works and one that doesn't.
 *
 * Each occurrence keeps the series' `id`, deliberately: that id is what RSVPing
 * needs, because one answer covers every week. Callers that must tell two
 * occurrences apart use the date as well.
 *
 * Shared rather than inlined because it was inlined, and the copy that wasn't
 * here — `getUpcomingEvents` — went on filtering `startsAt` and reported a
 * two-day-old session under "Coming up".
 */
function expandOccurrences(
  events: ClubEvent[],
  from: string,
  to: string
): ClubEvent[] {
  return events.flatMap((e) => {
    const days = occurrenceDates(
      {
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        repeatWeeklyUntil: e.repeatUntil,
        repeatEveryWeeks: e.repeatEveryWeeks,
        skippedDates: e.skippedDates,
      },
      from,
      to
    );

    return days.map((day) => ({
      ...e,
      startsAt: occurrenceStart({ startsAt: e.startsAt }, day),
      endsAt: e.endsAt
        ? occurrenceEnd({ startsAt: e.startsAt, endsAt: e.endsAt }, day)
        : undefined,
    }));
  });
}

/**
 * What is actually coming up, soonest first.
 *
 * ---------------------------------------------------------------------------
 * This used to return every event in the database, unfiltered
 * ---------------------------------------------------------------------------
 *
 * It sorted ascending and did nothing else, so its only caller — `catch_up` in
 * the MCP server — took `.slice(0, 5)` and printed the five OLDEST events in the
 * club's history under the heading "Coming up". Anish caught it reporting a
 * session from two days earlier.
 *
 * Worth being precise about the cause, because the plausible diagnosis was
 * wrong: not an off-by-one and not a timezone boundary, despite `lib/dates.ts`
 * existing for exactly that reason. There was no comparison to today at all. A
 * function called `getUpcomingEvents` that never mentions the current date is the
 * kind of thing a reader trusts by its name — including the person who wrote it.
 *
 * @param withinDays How far ahead to look. Two months matches the calendar page.
 * @param limit      Caps the list; a repeating meeting alone could fill it.
 */
export async function getUpcomingEvents({
  withinDays = 60,
  limit = 20,
}: { withinDays?: number; limit?: number } = {}): Promise<ClubEvent[]> {
  await preloadLiveStore();

  const from = todayInClubTime();
  const to = addDays(from, withinDays);

  return expandOccurrences(readStore().events, from, to)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
}
