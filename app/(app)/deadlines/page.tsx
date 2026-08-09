import Link from "next/link";
import { CircleCheck, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { getDeadlines } from "@/lib/data/deadlines";

export const metadata = {
  title: "Deadlines · SkyRunners HQ",
};

/** "Sep 30" — parsed as UTC so the day never shifts by timezone. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Every deadline in the club, per division, on one page.
 *
 * This is what replaced Phase 11's milestones. The milestones ARE the
 * deadlines — a project's target date and its deliverables' due dates are
 * already maintained and already what people plan against, so a parallel list
 * of milestones would be a second thing to keep current and the second thing
 * is always the one that goes stale.
 *
 * Computed, never stored. Nothing to create, nothing to maintain.
 *
 * Deliberately not a Gantt chart: no dependencies, no critical path, no bars.
 * Those are rejected in DECISIONS.md and the reasoning holds — on a volunteer
 * team a dependency graph is wrong the day after it's entered, and a wrong
 * schedule is worse than none because people plan against it.
 */
export default async function DeadlinesPage() {
  const view = await getDeadlines();
  const { divisions, collisions, undated, today } = view;

  return (
    <div className="space-y-6">
      <PageHeader
        label="Timeline"
        title="Deadlines"
        description="Every project target and deliverable due date, grouped by division. Built from dates that already exist — there's nothing extra to keep up to date."
      />

      {/*
        The one thing no project page can tell you: two divisions landing in
        the same week. This is the reason the page exists.
      */}
      {collisions.length > 0 ? (
        <Card className="border-warn-fg/25 bg-warn-bg">
          <CardBody className="py-4">
            <SectionLabel tone="muted">Busy Weeks</SectionLabel>
            <p className="mt-2 text-sm text-warn-fg">
              More than one division has something landing in these weeks.
              Worth knowing before somebody promises a lab booking.
            </p>
            <ul className="mt-3 space-y-1.5">
              {collisions.slice(0, 6).map((week) => (
                <li key={week.weekStart} className="text-sm text-warn-fg">
                  <span className="font-semibold">
                    Week of {shortDate(week.weekStart)}
                  </span>{" "}
                  — {week.count} deadline{week.count === 1 ? "" : "s"} across{" "}
                  {week.divisionNames.join(", ")}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {divisions.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              message="No dates set anywhere yet. Give a project a target date and it shows up here."
              actionLabel="Go to projects"
              actionHref="/projects"
            />
          </CardBody>
        </Card>
      ) : (
        divisions.map(({ division, items }) => (
          <Card key={division.id}>
            <CardBody>
              <SectionLabel>{division.name}</SectionLabel>

              <div className="mt-4 space-y-2">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-tile border px-4 py-2.5 ${
                      item.overdue
                        ? "border-risk-fg/30 bg-risk-bg"
                        : "border-line"
                    } ${item.done ? "opacity-55" : ""}`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {/*
                        A fixed-width date column is what makes the list scan
                        as a timeline rather than as prose.
                      */}
                      <span
                        className={`w-16 shrink-0 text-sm font-bold tabular-nums ${
                          item.overdue ? "text-risk-fg" : "text-ink"
                        }`}
                      >
                        {shortDate(item.date)}
                      </span>

                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          {item.done ? (
                            <CircleCheck className="size-3.5 shrink-0 text-ok-fg" />
                          ) : null}
                          <span className="text-[15px] font-semibold text-ink">
                            {item.title}
                          </span>
                          {item.kind === "project" ? (
                            <Badge tone="cardinal">Project target</Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-sm text-ink-muted">
                          <Link
                            href={`/projects/${item.project.slug}`}
                            className="hover:text-cardinal-600"
                          >
                            {item.project.name}
                          </Link>
                          {item.owner ? ` · ${item.owner.fullName}` : ""}
                        </span>
                      </span>
                    </div>

                    <span className="shrink-0 text-sm text-ink-muted">
                      {item.done
                        ? "Done"
                        : item.overdue
                          ? `${Math.abs(item.daysAway)}d overdue`
                          : item.daysAway === 0
                            ? "Today"
                            : `in ${item.daysAway}d`}
                    </span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ))
      )}

      {/*
        Projects nobody can plan around. Not an error — plenty of work starts
        undated — but a project with no target never appears above, and that
        absence is invisible unless something says so.
      */}
      {undated.length > 0 ? (
        <Card>
          <CardBody>
            <SectionLabel tone="muted">No Date Set</SectionLabel>
            <p className="mt-2 flex items-start gap-2 text-sm text-ink-soft">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn-fg" />
              <span>
                These have no target date, so they appear on no timeline. Fine
                early on; worth fixing once the work is real.
              </span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {undated.map(({ project, divisionName }) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.slug}`}
                  className="rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
                >
                  {project.name}
                  {divisionName ? (
                    <span className="font-normal text-ink-muted">
                      {" "}
                      · {divisionName}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <p className="px-1 text-sm text-ink-muted">
        Dates as of {shortDate(today)}. Change a project&apos;s target or a
        deliverable&apos;s due date and this follows — there is no separate
        milestone list to maintain.
      </p>
    </div>
  );
}
