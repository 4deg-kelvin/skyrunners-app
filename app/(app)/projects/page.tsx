import Link from "next/link";
import { CornerDownRight, TriangleAlert, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { CreateTeamForm, EditTeamForm } from "@/components/forms/team-admin";
import { CreateProjectForm } from "@/components/forms/project-admin";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import {
  getOrphanedProjects,
  getProjectFormOptions,
  getProjectTree,
  type ProjectTreeNode,
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

              <div className="mt-5 space-y-3">
                {roots.length === 0 ? (
                  <EmptyState
                    message="No projects in this division yet."
                    actionLabel="See other divisions"
                    actionHref="/projects"
                  />
                ) : (
                  roots.map((node) => (
                    <ProjectNode key={node.project.id} node={node} depth={0} />
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders a project and recurses into its children.
 *
 * The tree arrives fully built from `getProjectTree`, so this component does no
 * data lookups — it walks an in-memory structure. That's what keeps a deep tree
 * from turning into a query per row.
 */
function ProjectNode({
  node,
  depth,
}: {
  node: ProjectTreeNode;
  depth: number;
}) {
  const { project, res, memberCount, blockedCount, children } = node;

  return (
    <div>
      <div
        className="rounded-tile border border-line transition-colors hover:bg-surface"
        style={{ marginLeft: depth * 24 }}
      >
        <Link href={`/projects/${project.slug}`} className="block px-4 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {depth > 0 ? (
                  <CornerDownRight className="size-4 shrink-0 text-ink-muted" />
                ) : null}
                <p className="text-[15px] font-bold text-ink">{project.name}</p>
              </div>
              {project.description ? (
                <p className="mt-1 text-sm text-ink-soft">
                  {project.description}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <ProjectBadges project={project} />
              {/*
                Someone marking their work blocked is a fact; project health is
                the RE's judgement and only moves when they change it. Both
                belong here — otherwise a blocked deliverable is invisible to
                the person who could clear it.
              */}
              {blockedCount > 0 ? (
                <Badge tone="risk">
                  {blockedCount} blocked
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-muted">
            {res.length > 0 ? (
              <span>
                <span className="font-semibold text-ink-soft">
                  {res.length > 1 ? "REs" : "RE"}:
                </span>{" "}
                {res.map((r) => r.fullName).join(", ")}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </span>
            {project.timeCommitment ? <span>{project.timeCommitment}</span> : null}
            {project.openRoles ? (
              <span className="font-medium text-cardinal-600">
                Looking for: {project.openRoles}
              </span>
            ) : null}
          </div>
        </Link>
      </div>

      {children.length > 0 ? (
        <div className="mt-3 space-y-3">
          {children.map((child) => (
            <ProjectNode
              key={child.project.id}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
