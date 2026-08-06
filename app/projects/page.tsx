import Link from "next/link";
import { CornerDownRight, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import {
  childProjects,
  divisions,
  getMember,
  projectMembers,
  projects,
} from "@/lib/mock-data";
import { PHASE_LABELS, type Project, type ProjectHealth } from "@/lib/types";

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

export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        label="All Divisions"
        title="Projects"
        description="Every project in SkyRunners, grouped by division. Join anything that interests you — no permission needed."
        action={<Button>New project</Button>}
      />

      <div className="space-y-6">
        {divisions().map((division) => {
          const roots = projects.filter(
            (p) => p.parentId === null && p.teamId === division.id
          );

          return (
            <Card key={division.id}>
              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <SectionLabel>Division</SectionLabel>
                    <h2 className="mt-1.5 text-2xl font-bold text-ink">
                      {division.name}
                    </h2>
                    {division.description ? (
                      <p className="mt-1.5 text-[15px] text-ink-soft">
                        {division.description}
                      </p>
                    ) : null}
                  </div>
                  {division.leadId ? (
                    <div className="text-right">
                      <SectionLabel tone="muted">Division Lead</SectionLabel>
                      <p className="mt-1 text-[15px] font-bold text-ink">
                        {getMember(division.leadId)?.fullName}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 space-y-3">
                  {roots.length === 0 ? (
                    <div className="rounded-tile border border-dashed border-line px-4 py-6 text-center">
                      <p className="text-sm text-ink-soft">
                        No projects in this division yet.
                      </p>
                    </div>
                  ) : (
                    roots.map((project) => (
                      <ProjectNode
                        key={project.id}
                        project={project}
                        depth={0}
                      />
                    ))
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders a project and recurses into its children.
 * The indent makes the nesting legible at a glance, which is the whole point:
 * a member should be able to see the shape of the work without asking anyone.
 */
function ProjectNode({
  project,
  depth,
}: {
  project: Project;
  depth: number;
}) {
  const children = childProjects(project.id);
  const team = projectMembers(project.id);
  const res = project.reIds
    .map((id) => getMember(id)?.fullName)
    .filter(Boolean);

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

            <div className="flex shrink-0 items-center gap-2">
              <Badge tone="neutral">{PHASE_LABELS[project.phase]}</Badge>
              <Badge tone={healthTone[project.health]}>
                {healthLabel[project.health]}
              </Badge>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-muted">
            {res.length > 0 ? (
              <span>
                <span className="font-semibold text-ink-soft">
                  {res.length > 1 ? "REs" : "RE"}:
                </span>{" "}
                {res.join(", ")}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              {team.length} {team.length === 1 ? "member" : "members"}
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
            <ProjectNode key={child.id} project={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
