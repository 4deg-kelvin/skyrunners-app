import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { CreateTeamForm, EditTeamForm } from "@/components/forms/team-admin";
import { CreateProjectForm } from "@/components/forms/project-admin";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectNode } from "@/components/ui/project-tree";
import { SectionLabel } from "@/components/ui/section-label";
import {
  getOrphanedProjects,
  getProjectFormOptions,
  getProjectTree,
} from "@/lib/data/projects";
import { getViewer } from "@/lib/data/viewer";
import { can } from "@/lib/permissions";

export default async function ProjectsPage() {
  const [tree, orphans, formOptions, viewer] = await Promise.all([
    getProjectTree(),
    getOrphanedProjects(),
    getProjectFormOptions(),
    getViewer(),
  ]);

  const mayCreate = can.createProject(viewer.actor, viewer.graph);
  const mayManageTeams = can.manageTeams(viewer.actor);

  return (
    <div className="space-y-6">
      <PageHeader
        label="All Divisions"
        title="Projects"
        description="Every project in SkyRunners, grouped by division. Join anything that interests you — no permission needed."
        action={
          mayCreate ? (
            <div className="flex flex-wrap items-center gap-2">
              {mayManageTeams ? (
                <CreateTeamForm divisions={formOptions.divisions} />
              ) : null}
              <CreateProjectForm
                parents={formOptions.parents}
                divisions={formOptions.divisions}
                people={formOptions.people}
                defaultReId={viewer.member.id}
              />
            </div>
          ) : undefined
        }
      />

      {/* Data-integrity warning rather than silently hiding work */}
      {orphans.length > 0 ? (
        <Card className="border-warn-fg/25 bg-warn-bg">
          <CardBody className="py-4">
            <p className="flex items-start gap-2 text-sm text-warn-fg">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-semibold">
                  {orphans.length} project
                  {orphans.length === 1 ? "" : "s"} not linked to a division:
                </span>{" "}
                {orphans.map((p) => p.name).join(", ")}. Assign each an owning
                team so members can find them.
              </span>
            </p>
          </CardBody>
        </Card>
      ) : null}

      <div className="space-y-6">
        {tree.map(({ division, lead, roots }) => (
          <Card key={division.id}>
            <CardBody>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-3">
                    <SectionLabel>Division</SectionLabel>
                    {mayManageTeams ? (
                      <EditTeamForm
                        team={{
                          id: division.id,
                          name: division.name,
                          parentId: division.parentId,
                        }}
                        divisions={formOptions.divisions}
                      />
                    ) : null}
                  </div>
                  <h2 className="mt-1.5 text-2xl font-bold text-ink">
                    {division.name}
                  </h2>
                  {division.description ? (
                    <p className="mt-1.5 text-[15px] text-ink-soft">
                      {division.description}
                    </p>
                  ) : null}
                </div>
                {lead ? (
                  <div className="text-right">
                    <SectionLabel tone="muted">Division Lead</SectionLabel>
                    <Link
                      href={`/members/${lead.id}`}
                      className="mt-1 block text-[15px] font-bold text-ink hover:text-cardinal-600"
                    >
                      {lead.fullName}
                    </Link>
                  </div>
                ) : null}
              </div>

              {(() => {
                /*
                  Live work first, finished work underneath.
                  A completed project still matters — it's the club's record of
                  what got built, and years from now that history is the point.
                  But mixed into the same list it just makes the ongoing work
                  harder to see, which is the one job this page has.
                */
                const live = roots.filter(
                  (n) => n.project.phase !== "complete"
                );
                const finished = roots.filter(
                  (n) => n.project.phase === "complete"
                );

                return (
                  <>
                    <div className="mt-5 space-y-3">
                      {live.length === 0 ? (
                        <EmptyState
                          message={
                            finished.length > 0
                              ? "Nothing active in this division right now."
                              : "No projects in this division yet."
                          }
                          actionLabel="See other divisions"
                          actionHref="/projects"
                        />
                      ) : (
                        live.map((node) => (
                          <ProjectNode
                            key={node.project.id}
                            node={node}
                            depth={0}
                          />
                        ))
                      )}
                    </div>

                    {finished.length > 0 ? (
                      <div className="mt-6 border-t border-line pt-5">
                        <SectionLabel tone="muted">
                          Completed · {finished.length}
                        </SectionLabel>
                        <div className="mt-3 space-y-3">
                          {finished.map((node) => (
                            <ProjectNode
                              key={node.project.id}
                              node={node}
                              depth={0}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
