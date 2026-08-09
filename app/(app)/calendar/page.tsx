import Link from "next/link";
import { CalendarDays, Clock, MapPin, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import {
  AttendToggle,
  CancelEventButton,
  CreateEventForm,
} from "@/components/forms/event-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { getCalendar, type CalendarEvent } from "@/lib/data/events";
import { getViewer } from "@/lib/data/viewer";
import { EVENT_KIND_LABELS } from "@/lib/labels";

export const metadata = {
  title: "Calendar · SkyRunners HQ",
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
    isLeadership: viewer.actor.globalRole !== "member",
  });

  const { days, myProjects, people, canCreateClubEvent, today } = view;

  return (
    <div className="space-y-6">
      <PageHeader
        label="What's On"
        title="Calendar"
        description="Every session, meeting and deadline. Anything open, you can turn up to — you don't have to be on the project."
        action={
          <CreateEventForm
            myProjects={myProjects}
            people={people}
            canCreateClubEvent={canCreateClubEvent}
            today={today}
          />
        }
      />

      {days.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              message="Nothing scheduled in the next two months. If you're working on something, put it up — somebody may well join you."
              actionLabel="See what needs doing"
              actionHref="/find-work"
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
                  <span className="text-xs font-semibold text-warn-fg">
                    Some of these run at the same time
                  </span>
                ) : null}
              </div>

              <div className="mt-4 space-y-2.5">
                {day.events.map((row) => (
                  <EventRow key={row.event.id} row={row} />
                ))}

                {day.deadlines.map((d) => (
                  <div
                    key={d.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-dashed border-line px-4 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <CalendarDays className="size-3.5 shrink-0 text-ink-muted" />
                      <span className="min-w-0 text-sm text-ink">
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

      <p className="px-1 text-sm text-ink-muted">
        Sessions keep running over breaks — the academic calendar pauses
        check-ins, not the club. Helping on something you&apos;re not committed
        to? Log those hours as <span className="font-semibold">misc</span>.
      </p>
    </div>
  );
}

function EventRow({ row }: { row: CalendarEvent }) {
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
            <span className="text-[15px] font-bold text-ink">
              {event.title}
            </span>
            <Badge tone={isKey ? "cardinal" : "neutral"}>
              {EVENT_KIND_LABELS[event.kind]}
            </Badge>
            {row.overlaps ? <Badge tone="warn">Overlaps</Badge> : null}
            {!event.isOpen ? <Badge tone="neutral">Private</Badge> : null}
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
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
                className="font-semibold text-cardinal-600 hover:text-cardinal-700"
              >
                {project.name}
              </Link>
            ) : null}
          </p>

          {event.notes ? (
            <p className="mt-1.5 text-sm text-ink-soft">{event.notes}</p>
          ) : null}

          {attendees.length > 0 ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-muted">
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
            <AttendToggle eventId={event.id} attending={isAttending} />
          ) : null}
          {canManage ? (
            <CancelEventButton eventId={event.id} title={event.title} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
