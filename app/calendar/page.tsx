import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { events } from "@/lib/mock-data";
import type { EventKind } from "@/lib/types";

const KIND_LABELS: Record<EventKind, string> = {
  design_review: "Design Review",
  company_tour: "Company Tour",
  company_visit: "Company Visit",
  build_session: "Build Session",
  general_meeting: "Meeting",
  training: "Training",
  social: "Social",
  competition: "Competition",
  one_on_one: "1:1",
};

export default function CalendarPage() {
  const upcoming = [...events].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        label="Schedule"
        title="Calendar"
        description="Everything happening across SkyRunners. Add any event to your own Google or Apple calendar."
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
                    <Badge tone="neutral">{KIND_LABELS[event.kind]}</Badge>
                    {event.importanceWeight >= 4 ? (
                      <Badge tone="cardinal">Key event</Badge>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-5 text-sm text-ink-muted">
            Calendar subscription, RSVPs, and attendance tracking arrive in
            Phase 5.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
