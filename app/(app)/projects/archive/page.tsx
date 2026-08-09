import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { RestoreTeamButton } from "@/components/forms/team-admin";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import { getArchivedDivisions } from "@/lib/data/projects";
import { getViewer } from "@/lib/data/viewer";
import { can } from "@/lib/permissions";

/**
 * What the club used to be organised as, and what those divisions built.
 *
 * Divisions used to hard-delete, and only once nothing pointed at them — so
 * retiring one meant first deleting every project that recorded what it did.
 * Over a few years of reorganising, the club would have erased its own history
 * to keep this page tidy.
 *
 * Readable by everyone. The transparency rule covers activity, and what got
 * built is the most durable activity there is; a Co-Lead is only needed to
 * bring one back.
 */
export default async function ProjectArchivePage() {
  const [archived, viewer] = await Promise.all([
    getArchivedDivisions(),
    getViewer(),
  ]);

  const mayRestore = can.manageTeams(viewer.actor);

  return (
    <div className="space-y-6">
      <PageHeader
        label="History"
        title="Archived divisions"
        description="Retired parts of the org chart, and the work they left behind. Nothing here was deleted."
        action={
          <Link
            href="/projects"
            className="inline-flex items-center gap-1.5 rounded-tile border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
          >
            <ArrowLeft className="size-4" strokeWidth={2.5} />
            Back to projects
          </Link>
        }
      />

      {archived.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              message="Nothing archived yet. Retiring a division from the projects page puts it here, with its projects intact."
              actionLabel="Go to projects"
              actionHref="/projects"
            />
          </CardBody>
        </Card>
      ) : (
        archived.map(
          ({
            division,
            lead,
            archivedBy,
            subTeams,
            projects,
            memberCount,
          }) => {
            const delivered = projects.reduce((n, p) => n + p.delivered, 0);

            return (
              <Card key={division.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <SectionLabel tone="muted">
                          Archived Division
                        </SectionLabel>
                        <Badge tone="neutral">Retired</Badge>
                      </div>
                      <h2 className="mt-1.5 text-2xl font-bold text-ink">
                        {division.name}
                      </h2>
                      {division.description ? (
                        <p className="mt-1.5 text-[15px] text-ink-soft">
                          {division.description}
                        </p>
                      ) : null}

                      {/*
                        Who and when, in one line. An archive that says only
                        "this is gone" answers the wrong question — the useful
                        one is who decided and what for.
                      */}
                      <p className="mt-2 text-sm text-ink-muted">
                        Archived
                        {division.archivedAt
                          ? ` ${new Date(
                              `${division.archivedAt}T00:00:00Z`
                            ).toLocaleDateString("en-US", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                              timeZone: "UTC",
                            })}`
                          : ""}
                        {archivedBy ? ` by ${archivedBy.fullName}` : ""}
                        {lead ? ` · Led by ${lead.fullName}` : ""}
                      </p>
                      {division.archiveNote ? (
                        <p className="mt-1.5 text-sm text-ink-soft">
                          &ldquo;{division.archiveNote}&rdquo;
                        </p>
                      ) : null}
                    </div>

                    {mayRestore ? (
                      <RestoreTeamButton
                        teamId={division.id}
                        teamName={division.name}
                      />
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <StatTile label="Projects" value={projects.length} />
                    <StatTile
                      label="Deliverables signed off"
                      value={delivered}
                      hint="Only confirmed work counts"
                    />
                    <StatTile label="People based here" value={memberCount} />
                  </div>

                  {subTeams.length > 0 ? (
                    <p className="mt-4 text-sm text-ink-muted">
                      <span className="font-semibold text-ink-soft">
                        Sub-teams:
                      </span>{" "}
                      {subTeams.map((t) => t.name).join(", ")}
                    </p>
                  ) : null}

                  <div className="mt-5 border-t border-line pt-5">
                    <SectionLabel tone="muted">
                      What it built · {projects.length}
                    </SectionLabel>

                    <div className="mt-3 space-y-2.5">
                      {projects.length === 0 ? (
                        <p className="text-sm text-ink-muted">
                          No projects were ever filed under this division.
                        </p>
                      ) : (
                        projects.map(({ project, res, delivered: done }) => (
                          /*
                            Still a link. The project pages survive archiving —
                            that IS the archive. A read-only list of names would
                            keep the row and lose the record.
                          */
                          <Link
                            key={project.id}
                            href={`/projects/${project.slug}`}
                            className="block rounded-tile border border-line px-4 py-3 transition-colors hover:bg-surface"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <span className="text-[15px] font-bold text-ink">
                                {project.name}
                              </span>
                              <ProjectBadges project={project} />
                            </div>
                            <p className="mt-1.5 text-sm text-ink-muted">
                              {res.length > 0
                                ? `${res.length > 1 ? "REs" : "RE"}: ${res
                                    .map((r) => r.fullName)
                                    .join(", ")}`
                                : "No RE recorded"}
                              {done > 0
                                ? ` · ${done} delivered`
                                : " · nothing signed off"}
                            </p>
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          }
        )
      )}
    </div>
  );
}
