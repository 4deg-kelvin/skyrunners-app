import Link from "next/link";
import { Clock, Mail, PenLine, Plus, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import { getMyWork } from "@/lib/data/my-work";
import { getViewer } from "@/lib/data/viewer";
import { UPDATE_STATUS_LABELS, UPDATE_STATUS_TONES } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { formatNumber } from "@/lib/utils";

export default async function MyWorkPage() {
  const viewer = await getViewer();
  const view = await getMyWork(viewer.member.id);
  const { me, projects, currentUpdate, totals } = view;

  const mayLogHours = can.logOwnHours(viewer.actor, me.id);
  const maySubmitUpdate = can.submitOwnUpdate(viewer.actor, me.id);

  const dueDate = new Date(currentUpdate.update.dueAt);
  const firstName = me.preferredName ?? me.fullName.split(" ")[0];

  return (
    <div className="space-y-6">
      <PageHeader
        label="My Work"
        title={`Hi, ${firstName}`}
        description="Everything you're working on, and the update you owe on each."
        action={
          mayLogHours ? (
            <Button>
              <Plus className="size-4" strokeWidth={2.5} />
              Log hours
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="My projects"
          value={totals.projectCount}
          hint={totals.reCount > 0 ? `RE on ${totals.reCount}` : undefined}
        />
        <StatTile
          label="Hours logged"
          value={formatNumber(totals.hoursLogged, 1)}
          hint="this period"
        />
        <StatTile
          label="Next update due"
          value={dueDate.toLocaleDateString("en-US", { weekday: "long" })}
          hint={dueDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        />
      </div>

      {/* ---------------- The update, split per project ---------------- */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <SectionLabel>Update Due</SectionLabel>
              <h2 className="mt-2 text-2xl font-bold text-ink">
                One section per project
              </h2>
              <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
                Your hours are already filled in below. Write a line or two under
                each project so your Lead and that project&apos;s RE know exactly
                what you&apos;re talking about.
              </p>
            </div>
            <Badge tone={UPDATE_STATUS_TONES[currentUpdate.update.status]}>
              {UPDATE_STATUS_LABELS[currentUpdate.update.status]}
            </Badge>
          </div>

          <div className="mt-6 space-y-3">
            {currentUpdate.sections.length === 0 ? (
              <EmptyState
                message="No hours logged yet this period, so there's nothing to report on."
                actionLabel="Browse projects"
                actionHref="/projects"
              />
            ) : (
              currentUpdate.sections.map(({ entry, project, breadcrumb }) => (
                <div
                  key={entry.id}
                  className="rounded-tile border border-line px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Breadcrumb trail={breadcrumb} className="mb-1" />
                      <Link
                        href={`/projects/${project.slug}`}
                        className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                      >
                        {project.name}
                      </Link>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-ink-soft">
                      <Clock className="size-3.5" />
                      {formatNumber(entry.hours, 1)} hrs
                    </span>
                  </div>

                  <div className="mt-3 rounded-tile border border-dashed border-line px-3.5 py-3">
                    <p className="text-sm text-ink-muted">
                      {entry.progress || "No progress written yet for this project."}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {maySubmitUpdate ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <Button>
                <PenLine className="size-4" strokeWidth={2.5} />
                Write my update
              </Button>
              <ButtonLink href="/updates" variant="secondary">
                Past updates
              </ButtonLink>
            </div>
          ) : null}

          <p className="mt-4 text-sm text-ink-muted">
            The full submit form arrives in Phase 4.
          </p>
        </CardBody>
      </Card>

      {/* ---------------- Project cards ---------------- */}
      <Card>
        <CardBody>
          <div className="flex items-center justify-between gap-4">
            <SectionLabel>My Projects</SectionLabel>
            <Link
              href="/projects"
              className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
            >
              Find more work
            </Link>
          </div>

          {projects.length === 0 ? (
            <EmptyState
              className="mt-5 py-8"
              message="You're not on any projects yet."
              actionLabel="Browse projects and join one"
              actionHref="/projects"
            />
          ) : (
            <div className="mt-5 space-y-3">
              {projects.map(
                ({
                  project,
                  membership,
                  breadcrumb,
                  res,
                  hoursLogged,
                  lastUpdate,
                }) => (
                  <div
                    key={project.id}
                    className="rounded-tile border border-line px-4 py-4"
                  >
                    <Breadcrumb trail={breadcrumb} className="mb-1.5" />

                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <Link
                        href={`/projects/${project.slug}`}
                        className="text-[17px] font-bold text-ink hover:text-cardinal-600"
                      >
                        {project.name}
                      </Link>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {membership.role === "re" ? (
                          <Badge tone="cardinal">You are RE</Badge>
                        ) : null}
                        <ProjectBadges project={project} />
                      </div>
                    </div>

                    {membership.responsibility ? (
                      <p className="mt-2.5 text-[15px] text-ink-soft">
                        <span className="font-semibold text-ink">You own:</span>{" "}
                        {membership.responsibility}
                      </p>
                    ) : null}

                    {/* Who to ask — easy to find the RE */}
                    {res.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <SectionLabel tone="muted">
                          {res.length > 1
                            ? "Responsible Engineers"
                            : "Responsible Engineer"}
                        </SectionLabel>
                        {res.map((re) => (
                          <a
                            key={re.id}
                            href={`mailto:${re.email}`}
                            className="flex items-center gap-1.5 text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
                          >
                            <Mail className="size-3.5" />
                            {re.fullName}
                          </a>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-muted">
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3.5" />
                        {formatNumber(hoursLogged, 1)} hrs logged
                      </span>
                      {project.targetDate ? (
                        <span>
                          Target{" "}
                          {new Date(project.targetDate).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric" }
                          )}
                        </span>
                      ) : null}
                      {project.timeCommitment ? (
                        <span>{project.timeCommitment}</span>
                      ) : null}
                    </div>

                    {/* Last thing this member said about THIS project */}
                    {lastUpdate ? (
                      <div className="mt-3.5 rounded-tile bg-surface px-3.5 py-3">
                        <SectionLabel tone="muted">
                          Your last update here
                        </SectionLabel>
                        <p className="mt-1.5 text-sm text-ink-soft">
                          {lastUpdate.entry.progress}
                        </p>
                        {lastUpdate.entry.blockers ? (
                          <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-soft">
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-cardinal-600" />
                            <span className="font-medium">
                              {lastUpdate.entry.blockers}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-3.5 text-sm text-ink-muted">
                        No update written for this project yet.
                      </p>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
