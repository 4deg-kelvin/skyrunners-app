import Link from "next/link";
import { CalendarDays, Clock, MapPin, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import {
  AttendToggle,
  CancelEventButton,
  EditEventForm,
  GuestListForm,
  CreateEventForm,
} from "@/components/forms/event-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { getCalendar, type CalendarEvent } from "@/lib/data/events";
import { getViewer } from "@/lib/data/viewer";
import { can, isLeadership } from "@/lib/permissions";
import { EVENT_KIND_LABELS } from "@/lib/labels";

export const metadata = {
  title: "Calendar",
};

function dayLabel(iso: string, today: string): string {
  if (iso === today) return "Today";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "6:00 PM" from a `2026-08-13T18:00` local-ish string. */
function timeLabel(iso?: string): string {
  if (!iso) return "";
  const [, time] = iso.split("T");
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * What's happening, and whether you can join it.
 *
 * ---------------------------------------------------------------------------
 * Why this is a day list and not a month grid
 * ---------------------------------------------------------------------------
 *
 * The hard requirement is that **concurrent events both stay readable**. A
 * design review runs inside a general meeting; two build sessions run in
 * different labs at once. A month grid solves that by stacking one behind the
 * other or collapsing the rest into "+2 more" — which hides precisely the
 * thing somebody needed to see, and does it silently.
 *
 * A day-grouped list has no such geometry. Every event on a day renders in
 * full, in time order, however many there are. Overlaps are called out rather
 * than compressed, because two things at once is a fact you want *before* you
 * promise to be at both.
 *
 * Deadlines ride in the same stream. A project target is a thing happening on
 * a date, and keeping it on its own page meant two places to check.
 */
export default async function CalendarPage() {
  const viewer = await getViewer();
  const view = await getCalendar({
    memberId: viewer.member.id,
    isLeadership: isLeadership(viewer.actor),
    // Decides which projects an event may be attached to: committed, PL-of-or-
    // above, or Co-Lead. Without it the list falls back to committed only.
    viewer: { actor: viewer.actor, graph: viewer.graph },
  });

  const { days, myProjects, allProjects, people, canCreateClubEvent, today } =
    view;

  // Narrower than creating a club-wide event: an open calendar is the point of
  // this feature, so closing one off is a Co-Lead's call.
  const canCloseEvent = can.createClosedEvent(viewer.actor);

  return (
    <div className="space-y-6">
      <PageHeader
        label="What's On"
        title="Calendar"
        description="Every session, meeting and deadline. If it's open, just turn up — you don't need to be on the project."
        action={
          <CreateEventForm
            myProjects={myProjects}
            people={people}
            canCreateClubEvent={canCreateClubEvent}
            canCloseEvent={canCloseEvent}
            today={today}
          />
        }
      />

      {/*
        Where to go to get this in your own calendar.

        A pointer rather than the control itself, because the control belongs in
        Settings beside its sibling ("Connect your AI") and duplicating it would be
        two places to rotate a token from. But THIS is the page somebody is on when
        the thought occurs — Anish went looking for it here and reported there was
        "nowhere to link my calendar", which is the right complaint about a feature
        living only where he wasn't.

        Shown to everyone, including people already connected: it's one line, and
        the alternative is loading a feed row into this page purely to hide a link.
      */}
      <p className="text-ink-muted px-1 text-sm">
        Want these in your own calendar?{" "}
        <Link
          href="/settings"
          className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
        >
          Connect Apple, Google or Outlook in Settings
        </Link>{" "}
        — one link, once, and anything you say you&apos;re coming to shows up
        there.
      </p>

      {days.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              message="Nothing in the next two months. Put a session up — somebody may well join you."
              actionLabel="See what needs doing"
              actionHref="/projects"
            />
          </CardBody>
        </Card>
      ) : (
        days.map((day) => (
          <Card key={day.date}>
            <CardBody>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <SectionLabel>{dayLabel(day.date, today)}</SectionLabel>
                {day.events.some((e) => e.overlaps) ? (
                  /*
                    Named, not hidden. This is the one thing a grid would have
                    swallowed, and it's the thing worth knowing before you
                    commit to being in two places.
                  */
                  <span className="text-warn-fg text-xs font-semibold">
                    Some of these run at the same time
                  </span>
                ) : null}
              </div>

              <div className="mt-4 space-y-2.5">
                {day.events.map((row) => (
                  <EventRow
                    key={row.event.id}
                    row={row}
                    canSetImportance={canCreateClubEvent}
                    canCloseEvent={canCloseEvent}
                    projects={allProjects}
                    people={people}
                  />
                ))}

                {day.deadlines.map((d) => (
                  <div
                    key={d.key}
                    className="rounded-tile border-line flex flex-wrap items-center justify-between gap-2 border border-dashed px-4 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <CalendarDays className="text-ink-muted size-3.5 shrink-0" />
                      <span className="text-ink min-w-0 text-sm">
                        <span className="font-semibold">{d.title}</span>
                        <span className="text-ink-muted">
                          {" "}
                          ·{" "}
                          <Link
                            href={`/projects/${d.projectSlug}`}
                            className="hover:text-cardinal-600"
                          >
                            {d.projectName}
                          </Link>
                          {d.divisionName ? ` · ${d.divisionName}` : ""}
                        </span>
                      </span>
                    </span>
                    <Badge tone="neutral">
                      {d.kind === "project" ? "Project target" : "Due"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ))
      )}

      <p className="text-ink-muted px-1 text-sm">
        Sessions keep running over breaks. The academic calendar says when the
        club is formally in session; it never stops anybody putting work on
        here.
      </p>
    </div>
  );
}

function EventRow({
  row,
  canSetImportance,
  canCloseEvent,
  projects,
  people,
}: {
  row: CalendarEvent;
  canSetImportance: boolean;
  canCloseEvent: boolean;
  /** Every project, for re-pointing an event at the work it turned out to be. */
  projects: { id: string; name: string }[];
  people: { id: string; fullName: string }[];
}) {
  const { event, project, attendees, organiser, isAttending, canManage } = row;

  // 4 and 5 are what a member should not miss. Below that the badge would be
  // on nearly every row and would stop meaning anything.
  const isKey = event.importanceWeight >= 4;

  return (
    <div
      className={`rounded-tile border px-4 py-3 ${
        isKey ? "border-cardinal-600/40 bg-cardinal-50/40" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink text-[15px] font-bold">
              {event.title}
            </span>
            <Badge tone={isKey ? "cardinal" : "neutral"}>
              {EVENT_KIND_LABELS[event.kind]}
            </Badge>
            {row.overlaps ? <Badge tone="warn">Overlaps</Badge> : null}
            {!event.isOpen ? <Badge tone="neutral">Private</Badge> : null}
          </div>

          <p className="text-ink-muted mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {timeLabel(event.startsAt)}
              {event.endsAt ? ` – ${timeLabel(event.endsAt)}` : ""}
            </span>
            {event.location ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {event.location}
              </span>
            ) : null}
            {project ? (
              <Link
                href={`/projects/${project.slug}`}
                className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
              >
                {project.name}
              </Link>
            ) : null}
          </p>

          {event.notes ? (
            <p className="text-ink-soft mt-1.5 text-sm">{event.notes}</p>
          ) : null}

          {attendees.length > 0 ? (
            <p className="text-ink-muted mt-1.5 flex items-center gap-1.5 text-sm">
              <Users className="size-3.5" />
              {attendees.map((a) => a.fullName).join(", ")}
              {organiser ? (
                <span className="text-ink-muted">
                  · organised by {organiser.fullName}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/*
            Turning up is the whole feature. Only for open events — a 1:1 is
            the two people in it, so there's nothing to drop in on.
          */}
          {event.isOpen ? (
            <AttendToggle
              eventId={event.id}
              attending={isAttending}
              // So the note can say every week is covered, not just this one.
              repeats={Boolean(event.repeatUntil)}
            />
          ) : null}
        </div>
      </div>

      {/*
        Organiser controls sit under the row, full width, rather than in the
        right-hand column: the edit form is a two-column grid and would be
        squeezed to nothing there.

        Editing exists because cancelling deletes the attendee list, and the
        commonest change by far is a time slipping an hour.
      */}
      {canManage ? (
        <div className="border-line mt-2.5 flex flex-wrap items-center gap-4 border-t pt-2.5">
          <EditEventForm
            event={event}
            canSetImportance={canSetImportance}
            canCloseEvent={canCloseEvent}
            projects={projects}
          />
          {/*
            The only way a closed event's list can ever change.

            `setEventAttendance` refuses an invite-only event by design, so
            without this the guest list would be frozen at creation and the
            organiser would have to cancel and rebuild it. Open events don't
            need it — people add themselves.
          */}
          {!event.isOpen ? (
            <GuestListForm
              eventId={event.id}
              attendeeIds={event.attendeeIds}
              people={people}
            />
          ) : null}
          <CancelEventButton eventId={event.id} title={event.title} />
        </div>
      ) : null}
    </div>
  );
}
