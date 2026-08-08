import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { LogHoursForm } from "@/components/forms/log-hours-form";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDivider } from "@/components/ui/card";
import { Donut } from "@/components/ui/donut";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { FieldLabel, SectionLabel } from "@/components/ui/section-label";
import { DetailRow, StatTile } from "@/components/ui/stat-tile";
import { getDashboard } from "@/lib/data/dashboard";
import { getViewer } from "@/lib/data/viewer";
import { UPDATE_STATUS_LABELS, UPDATE_STATUS_TONES } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { formatNumber } from "@/lib/utils";

export default async function DashboardPage() {
  const viewer = await getViewer();
  const view = await getDashboard(viewer.actor, viewer.graph);
  const {
    compliance,
    counts,
    club,
    reviewQueue,
    escalations,
    flaggedProjects,
  } = view;

  /**
   * The gate. Hiding the nav link is not access control — this route was
   * reachable by URL and renders other people's hours and review queue.
   *
   * Sends them to /my-work rather than showing a 403: for a plain member this
   * isn't a permissions error to understand, it's a page that was never meant
   * for them, and their own work is where they were going anyway.
   */
  if (!can.viewLeadershipDashboard(viewer.actor, !view.isLeadOfNobody)) {
    redirect("/my-work");
  }

  const mayLogHours = can.logOwnHours(viewer.actor, viewer.member.id);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Lead Portal"
        title="Dashboard"
        description={`Stay on top of team health, update windows, and project status for ${club.name}.`}
        action={
          mayLogHours ? (
            <LogHoursForm
              projects={view.myProjects}
              defaultProjectId={view.myProjects[0]?.id}
              today={view.today}
              maxBackdateDays={view.maxBackdateDays}
            />
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* ---------------- Left: team summary ---------------- */}
        <Card className="h-fit">
          <CardBody>
            <SectionLabel>Team Summary</SectionLabel>

            <div className="mt-5 flex items-center gap-4">
              <div className="flex size-[72px] shrink-0 items-center justify-center rounded-tile bg-cardinal-50 text-2xl font-bold text-cardinal-600">
                SR
              </div>
              <p className="text-xl font-bold text-ink">{club.name}</p>
            </div>

            <div className="mt-5">
              <CardDivider />
              <DetailRow label="Description">{club.description}</DetailRow>
              <CardDivider />
              <DetailRow label="People you oversee">
                {counts.peopleOverseen}
              </DetailRow>
              <CardDivider />
              <DetailRow label="Divisions">{counts.divisions}</DetailRow>
              <CardDivider />
              <DetailRow label="Active projects">{counts.projects}</DetailRow>
              <CardDivider />
              <DetailRow label="Date created">
                {new Date(club.createdAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </DetailRow>
            </div>
          </CardBody>
        </Card>

        {/* ---------------- Right: operations ---------------- */}
        <div className="space-y-6">
          <Card>
            <CardBody>
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <SectionLabel>Operations</SectionLabel>
                  <h2 className="mt-2 text-2xl font-bold text-ink">
                    Cycle summary
                  </h2>
                  <p className="mt-2 text-[15px] text-ink-soft">
                    Compliance, effort and project health for the{" "}
                    {counts.peopleOverseen}{" "}
                    {counts.peopleOverseen === 1 ? "person" : "people"} you
                    oversee — not the whole club.
                  </p>
                </div>
                <Donut
                  fraction={compliance.fraction}
                  label="on time"
                  size={132}
                />
              </div>

              <div className="mt-7 grid gap-4 sm:grid-cols-3">
                <StatTile label="Annual cycle" value={club.cycle} />
                <StatTile
                  label="Hours logged this week"
                  value={formatNumber(view.hoursThisWeek, 1)}
                />
                <StatTile
                  label="Updates awaiting review"
                  value={reviewQueue.length}
                />
              </div>
            </CardBody>
          </Card>

          {/*
            Escalations — Leads under you who are leaving people unheard.
            Rendered only when non-empty: a permanent "0 escalations" panel is
            noise that trains you to skip the whole column.

            Reports on LEADS, not on updates. "Marcus has 2 people waiting,
            oldest 5 days" is one conversation; a list of thirty unread reports
            is a spreadsheet.
          */}
          {escalations.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Not Being Read</SectionLabel>
                <p className="mt-2 text-[15px] text-ink-soft">
                  These Leads have check-ins they haven&apos;t read. A report
                  nobody reads is worse than no report — the member spent effort
                  on it.
                </p>

                <div className="mt-4 space-y-3">
                  {escalations.map(({ lead, overdue, worstAgeDays }) => (
                    <div
                      key={lead.id}
                      className="rounded-tile border border-warn-fg/30 bg-warn-bg/40 px-4 py-3.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <Link
                          href={`/members/${lead.id}`}
                          className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                        >
                          {lead.fullName}
                        </Link>
                        <span className="text-sm font-semibold text-warn-fg">
                          oldest waiting {worstAgeDays}{" "}
                          {worstAgeDays === 1 ? "day" : "days"}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-ink-soft">
                        {overdue.length}{" "}
                        {overdue.length === 1 ? "person" : "people"} waiting:{" "}
                        {overdue
                          .map((r) => r.author?.fullName ?? "someone")
                          .join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          <div className="grid gap-6 md:grid-cols-2">
            {/* Review queue */}
            <Card>
              <CardBody>
                <div className="flex items-center justify-between gap-4">
                  <SectionLabel>Needs Review</SectionLabel>
                  <Link
                    href="/updates"
                    className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
                  >
                    All updates
                  </Link>
                </div>

                <div className="mt-4 space-y-3">
                  {reviewQueue.length === 0 ? (
                    <EmptyState
                      message="Nothing waiting on you."
                      actionLabel="View all updates"
                      actionHref="/updates"
                    />
                  ) : (
                    reviewQueue.map(({ update, author, sections, ageDays, escalated }) => (
                      <div
                        key={update.id}
                        className={
                          escalated
                            ? "rounded-tile border border-cardinal-600 px-4 py-3.5"
                            : "rounded-tile border border-line px-4 py-3.5"
                        }
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[15px] font-bold text-ink">
                            {author?.fullName ?? "Unknown member"}
                            {/* Age, not a count. "12 unread" is ignorable;
                                "waiting 5 days" names a specific person kept
                                waiting, and is the same weight of problem
                                whether you lead three people or fifteen. */}
                            <span
                              className={
                                escalated
                                  ? "ml-2 text-sm font-semibold text-cardinal-600"
                                  : "ml-2 text-sm font-normal text-ink-muted"
                              }
                            >
                              {ageDays === 0
                                ? "today"
                                : `waiting ${ageDays} ${ageDays === 1 ? "day" : "days"}`}
                              {escalated ? " — your Lead can see this" : ""}
                            </span>
                          </p>
                          <Badge tone={UPDATE_STATUS_TONES[update.status]}>
                            {UPDATE_STATUS_LABELS[update.status]}
                          </Badge>
                        </div>

                        {/* One block per project, so it's always clear which
                            piece of work each note refers to. */}
                        <div className="mt-2.5 space-y-2.5">
                          {sections.map(({ entry, project }) => (
                            <div
                              key={entry.id}
                              className="border-l-2 border-line-soft pl-3"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                {project ? (
                                  <Link
                                    href={`/projects/${project.slug}`}
                                    className="text-[13px] font-semibold text-cardinal-600 hover:text-cardinal-700"
                                  >
                                    {project.name}
                                  </Link>
                                ) : (
                                  <span className="text-[13px] font-semibold text-ink-muted">
                                    Unknown project
                                  </span>
                                )}
                                <span className="text-xs text-ink-muted">
                                  {formatNumber(entry.hours, 1)} hrs
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
                                {entry.progress}
                              </p>
                              {entry.blockers ? (
                                <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-soft">
                                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-cardinal-600" />
                                  <span className="font-medium">
                                    {entry.blockers}
                                  </span>
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Update window */}
            <Card>
              <CardBody>
                <div className="flex items-center justify-between gap-4">
                  <SectionLabel>Update Window</SectionLabel>
                  <Badge tone="ok">Open now</Badge>
                </div>

                <h3 className="mt-4 text-[17px] font-bold text-ink">
                  Today&apos;s check-in
                </h3>
                <p className="mt-1.5 text-sm text-ink-soft">
                  Members submit three updates a week on the days they choose.
                  This window closes at 11:59 PM.
                </p>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  <MiniStat label="On time" value={compliance.onTime} tone="ok" />
                  <MiniStat label="Late" value={compliance.late} tone="warn" />
                  <MiniStat
                    label="Missed"
                    value={compliance.missed}
                    tone="risk"
                  />
                </div>

                {compliance.pending > 0 ? (
                  <p className="mt-3 text-sm text-ink-muted">
                    {compliance.pending} not yet due — excluded from the
                    percentage.
                  </p>
                ) : null}

                <div className="mt-5">
                  <ButtonLink
                    href="/updates"
                    variant="secondary"
                    className="w-full"
                  >
                    Open review queue
                  </ButtonLink>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Projects needing attention */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-4">
                <SectionLabel>Needs Attention</SectionLabel>
                <Link
                  href="/projects"
                  className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
                >
                  All projects
                </Link>
              </div>

              <div className="mt-4 space-y-3">
                {flaggedProjects.length === 0 ? (
                  <EmptyState
                    message="Every project is on track."
                    actionLabel="Browse projects"
                    actionHref="/projects"
                  />
                ) : (
                  flaggedProjects.map(({ project, res }) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.slug}`}
                      className="block rounded-tile border border-line px-4 py-3.5 transition-colors hover:bg-surface"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[15px] font-bold text-ink">
                          {project.name}
                        </p>
                        <ProjectBadges project={project} />
                      </div>
                      <p className="mt-1.5 text-sm text-ink-soft">
                        {res.length > 1 ? "REs" : "RE"}:{" "}
                        {res.map((r) => r.fullName).join(", ") || "unassigned"}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "risk";
}) {
  const color =
    tone === "ok"
      ? "text-ok-fg"
      : tone === "warn"
        ? "text-warn-fg"
        : "text-risk-fg";

  return (
    <div className="rounded-tile border border-line px-3 py-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <FieldLabel className="mt-1 text-[12px] font-medium normal-case tracking-normal">
        {label}
      </FieldLabel>
    </div>
  );
}
