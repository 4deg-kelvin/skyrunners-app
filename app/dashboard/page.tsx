import Link from "next/link";
import { Plus, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDivider } from "@/components/ui/card";
import { Donut } from "@/components/ui/donut";
import { FieldLabel, SectionLabel } from "@/components/ui/section-label";
import { DetailRow, StatTile } from "@/components/ui/stat-tile";
import {
  activeMembers,
  atRiskProjects,
  awaitingReview,
  club,
  divisions,
  getMember,
  hoursThisWeek,
  projects,
  updateCompliance,
} from "@/lib/mock-data";
import { PHASE_LABELS, type ProjectHealth } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

const healthTone: Record<ProjectHealth, "ok" | "warn" | "risk" | "neutral"> = {
  on_track: "ok",
  at_risk: "warn",
  blocked: "risk",
  complete: "neutral",
};

const healthLabel: Record<ProjectHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
  complete: "Complete",
};

export default function DashboardPage() {
  const compliance = updateCompliance();
  const reviewQueue = awaitingReview();
  const flagged = atRiskProjects();
  const memberCount = activeMembers().length;

  return (
    <div className="space-y-6">
      <PageHeader
        label="Lead Portal"
        title="Dashboard"
        description={`Stay on top of team health, update windows, and project status for ${club.name}.`}
        action={
          <Button>
            <Plus className="size-4" strokeWidth={2.5} />
            Log hours
          </Button>
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
              <DetailRow label="Members">{memberCount}</DetailRow>
              <CardDivider />
              <DetailRow label="Divisions">{divisions().length}</DetailRow>
              <CardDivider />
              <DetailRow label="Active projects">{projects.length}</DetailRow>
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
                    A quick snapshot of update compliance, effort, and project
                    health.
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
                  value={formatNumber(hoursThisWeek(), 1)}
                />
                <StatTile
                  label="Updates awaiting review"
                  value={reviewQueue.length}
                />
              </div>
            </CardBody>
          </Card>

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
                    reviewQueue.map((update) => {
                      const author = getMember(update.memberId);
                      return (
                        <div
                          key={update.id}
                          className="rounded-tile border border-line px-4 py-3.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-[15px] font-bold text-ink">
                              {author?.fullName}
                            </p>
                            <Badge
                              tone={update.status === "late" ? "warn" : "ok"}
                            >
                              {update.status === "late" ? "Late" : "Submitted"}
                            </Badge>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">
                            {update.progress}
                          </p>
                          {update.blockers ? (
                            <p className="mt-2 flex items-start gap-1.5 text-sm text-cardinal-600">
                              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                              <span className="font-medium">
                                {update.blockers}
                              </span>
                            </p>
                          ) : null}
                        </div>
                      );
                    })
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
                  Wednesday check-in
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

                <div className="mt-5">
                  <ButtonLink href="/updates" variant="secondary" className="w-full">
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
                {flagged.length === 0 ? (
                  <EmptyState
                    message="Every project is on track."
                    actionLabel="Browse projects"
                    actionHref="/projects"
                  />
                ) : (
                  flagged.map((project) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.slug}`}
                      className="block rounded-tile border border-line px-4 py-3.5 transition-colors hover:bg-surface"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[15px] font-bold text-ink">
                          {project.name}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge tone="neutral">
                            {PHASE_LABELS[project.phase]}
                          </Badge>
                          <Badge tone={healthTone[project.health]}>
                            {healthLabel[project.health]}
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-1.5 text-sm text-ink-soft">
                        RE:{" "}
                        {project.reIds
                          .map((id) => getMember(id)?.fullName)
                          .filter(Boolean)
                          .join(", ")}
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
      <FieldLabel className="mt-1 tracking-normal normal-case text-[12px] font-medium">
        {label}
      </FieldLabel>
    </div>
  );
}

/**
 * Empty states always offer a next action. A new member should never hit a
 * dead end that doesn't tell them what to do — that's the "productive in five
 * minutes" principle applied at the component level.
 */
function EmptyState({
  message,
  actionLabel,
  actionHref,
}: {
  message: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div className="rounded-tile border border-dashed border-line px-4 py-6 text-center">
      <p className="text-sm text-ink-soft">{message}</p>
      <Link
        href={actionHref}
        className="mt-2 inline-block text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
