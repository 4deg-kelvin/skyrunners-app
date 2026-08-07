import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { getUpcomingEvents } from "@/lib/data/events";
import { getViewer } from "@/lib/data/viewer";
import { EVENT_KIND_LABELS, KEY_EVENT_WEIGHT } from "@/lib/labels";
import { can } from "@/lib/permissions";

export default async function CalendarPage() {
  const [upcoming, viewer] = await Promise.all([
    getUpcomingEvents(),
    getViewer(),
  ]);
  const mayCreate = can.createEvent(viewer.actor);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Schedule"
        title="Calendar"
        description="Everything happening across SkyRunners. Add any event to your own Google or Apple calendar."
        action={mayCreate ? <Button>New event</Button> : undefined}
      />

      <Card>
        <CardBody>
          <SectionLabel>Upcoming</SectionLabel>

          <div className="mt-5 space-y-3">
            {upcoming.map((event) => {
              const date = new Date(event.startsAt);
              return (
                <div
                  key={event.id}
                  className="flex flex-wrap items-center gap-4 rounded-tile border border-line px-4 py-3.5"
                >
                  <div className="w-14 shrink-0 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-cardinal-600">
                      {date.toLocaleDateString("en-US", { month: "short" })}
                    </p>
                    <p className="text-2xl font-bold leading-tight text-ink">
                      {date.getDate()}
                    </p>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-ink">
                      {event.title}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {date.toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {event.location ? ` · ${event.location}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="neutral">
                      {EVENT_KIND_LABELS[event.kind]}
                    </Badge>
                    {event.importanceWeight >= KEY_EVENT_WEIGHT ? (
                      <Badge tone="cardinal">Key event</Badge>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-5 text-sm text-ink-muted">
            Opt-in Google and Apple calendar subscription, RSVPs, and attendance
            tracking arrive in Phase 5.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
