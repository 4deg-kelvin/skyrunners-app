import Link from "next/link";
import { notFound } from "next/navigation";
import { CornerDownRight, Mail, TriangleAlert, UserPlus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import {
  getAllProjectSlugs,
  getProjectBySlug,
} from "@/lib/data/projects";
import { getViewer } from "@/lib/data/viewer";
import { PHASE_LABELS, PHASE_ORDER, PROJECT_ROLE_LABELS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { formatNumber } from "@/lib/utils";

export async function generateStaticParams() {
  const slugs = await getAllProjectSlugs();
  return slugs.map((slug) => ({ slug }));
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [view, viewer] = await Promise.all([
    getProjectBySlug(slug),
    getViewer(),
  ]);

  if (!view) notFound();

  const { project, breadcrumb, res, members, children, updateFeed } = view;

  const mayManage = can.manageProject(viewer.actor, viewer.graph, project.id);
  const mayAddMember = can.addProjectMember(
    viewer.actor,
    viewer.graph,
    project.id
  );
  const alreadyOn = members.some(
    (m) => m.membership.memberId === viewer.member.id
  );
  const mayJoin = !alreadyOn && can.joinProject(viewer.actor, project);

  const phaseIndex = PHASE_ORDER.indexOf(project.phase);

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb trail={breadcrumb.slice(0, -1)} className="mb-3 px-1" />
        <PageHeader
          label="Project"
          title={project.name}
          description={project.description}
          action={
            mayJoin ? (
              <Button>
                <UserPlus className="size-4" strokeWidth={2.5} />
                Join this project
              </Button>
            ) : alreadyOn ? (
              <Badge tone="ok">You&apos;re on this project</Badge>
            ) : undefined
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Status */}
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <SectionLabel>Status</SectionLabel>
                  <h2 className="mt-2 text-2xl font-bold text-ink">
                    {PHASE_LABELS[project.phase]}
                  </h2>
                </div>
                <ProjectBadges project={project} />
              </div>

              {/* Phase progress — where in the lifecycle this sits */}
              <div className="mt-5 flex gap-1">
                {PHASE_ORDER.map((phase, i) => (
                  <div
                    key={phase}
                    title={PHASE_LABELS[phase]}
                    className={`h-1.5 flex-1 rounded-full ${
                      i <= phaseIndex ? "bg-cardinal-600" : "bg-line"
                    }`}
                  />
                ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-ink-muted">
                <span>{PHASE_LABELS[PHASE_ORDER[0]]}</span>
                <span>{PHASE_LABELS[PHASE_ORDER[PHASE_ORDER.length - 1]]}</span>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <StatTile
                  label="Start"
                  value={
                    project.startDate
                      ? new Date(project.startDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"
                  }
                />
                <StatTile
                  label="Target"
                  value={
                    project.targetDate
                      ? new Date(project.targetDate).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" }
                        )
                      : "—"
                  }
                />
                <StatTile label="Members" value={members.length} />
              </div>
            </CardBody>
          </Card>

          {/* Team */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-4">
                <SectionLabel>Team</SectionLabel>
                {mayAddMember ? (
                  <Button variant="ghost" className="px-2 py-1">
                    Add member
                  </Button>
                ) : null}
              </div>

              <div className="mt-4 space-y-2.5">
                {members.length === 0 ? (
                  <EmptyState
                    message="Nobody on this project yet."
                    actionLabel="Browse other projects"
                    actionHref="/projects"
                  />
                ) : (
                  members.map(({ membership, member }) => (
                    <div
                      key={membership.memberId}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-tile border border-line px-4 py-3"
                    >
                      <div className="min-w-0">
                        {member ? (
                          <Link
                            href={`/members/${member.id}`}
                            className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                          >
                            {member.fullName}
                          </Link>
                        ) : (
                          <span className="text-[15px] font-bold text-ink-muted">
                            Unknown member
                          </span>
                        )}
                        {membership.responsibility ? (
                          <p className="mt-0.5 text-sm text-ink-soft">
                            {membership.responsibility}
                          </p>
                        ) : null}
                      </div>
                      <Badge
                        tone={membership.role === "re" ? "cardinal" : "neutral"}
                      >
                        {PROJECT_ROLE_LABELS[membership.role]}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>

          {/* Sub-projects */}
          {children.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Sub-projects</SectionLabel>
                <div className="mt-4 space-y-2.5">
                  {children.map(({ project: child, res: childRes }) => (
                    <Link
                      key={child.id}
                      href={`/projects/${child.slug}`}
                      className="block rounded-tile border border-line px-4 py-3 transition-colors hover:bg-surface"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <CornerDownRight className="size-4 shrink-0 text-ink-muted" />
                          <span className="text-[15px] font-bold text-ink">
                            {child.name}
                          </span>
                        </span>
                        <ProjectBadges project={child} />
                      </div>
                      {childRes.length > 0 ? (
                        <p className="mt-1.5 pl-6 text-sm text-ink-muted">
                          {childRes.length > 1 ? "REs" : "RE"}:{" "}
                          {childRes.map((r) => r.fullName).join(", ")}
                        </p>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {/* Per-project update feed — a payoff of update_entries */}
          <Card>
            <CardBody>
              <SectionLabel>Recent Updates On This Project</SectionLabel>
              <p className="mt-2 text-sm text-ink-soft">
                Everything anyone has reported about this project specifically.
              </p>

              <div className="mt-4 space-y-3">
                {updateFeed.length === 0 ? (
                  <EmptyState
                    message="No updates written about this project yet."
                    actionLabel="See your own work"
                    actionHref="/my-work"
                  />
                ) : (
                  updateFeed.map(({ entry, author, submittedAt }) => (
                    <div
                      key={entry.id}
                      className="rounded-tile border border-line px-4 py-3.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[15px] font-bold text-ink">
                          {author?.fullName ?? "Unknown member"}
                        </p>
                        <span className="text-xs text-ink-muted">
                          {new Date(submittedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          · {formatNumber(entry.hours, 1)} hrs
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-ink-soft">
                        {entry.progress}
                      </p>
                      {entry.blockers ? (
                        <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-soft">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-cardinal-600" />
                          <span className="font-medium">{entry.blockers}</span>
                        </p>
                      ) : null}
                      {entry.nextSteps ? (
                        <p className="mt-1.5 text-sm text-ink-muted">
                          Next: {entry.nextSteps}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ---------------- Sidebar ---------------- */}
        <div className="space-y-6">
          <Card className="h-fit">
            <CardBody>
              <SectionLabel>Who To Ask</SectionLabel>
              <div className="mt-4 space-y-3">
                {res.length === 0 ? (
                  <p className="text-sm text-ink-muted">No RE assigned yet.</p>
                ) : (
                  res.map((re, i) => (
                    <div key={re.id}>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/members/${re.id}`}
                          className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                        >
                          {re.fullName}
                        </Link>
                        {i === 0 && res.length > 1 ? (
                          <Badge tone="cardinal">Primary</Badge>
                        ) : null}
                      </div>
                      <a
                        href={`mailto:${re.email}`}
                        className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
                      >
                        <Mail className="size-3.5" />
                        {re.email}
                      </a>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>

          {project.openRoles || project.timeCommitment ? (
            <Card className="h-fit">
              <CardBody>
                <SectionLabel>Getting Involved</SectionLabel>
                {project.timeCommitment ? (
                  <p className="mt-3 text-[15px] text-ink-soft">
                    <span className="font-semibold text-ink">Commitment:</span>{" "}
                    {project.timeCommitment}
                  </p>
                ) : null}
                {project.openRoles ? (
                  <p className="mt-2 text-[15px] text-ink-soft">
                    <span className="font-semibold text-ink">Looking for:</span>{" "}
                    {project.openRoles}
                  </p>
                ) : null}
                {!project.isOpenToJoin ? (
                  <p className="mt-3 text-sm text-ink-muted">
                    This project is closed to new members right now — contact the
                    RE if you&apos;d like to help.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card className="h-fit">
            <CardBody>
              <SectionLabel>Artifacts</SectionLabel>
              <p className="mt-3 text-sm text-ink-soft">
                Presentations, GitHub links, requirements, and test reports arrive
                in Phase 2.
              </p>
              {mayManage ? (
                <p className="mt-2 text-sm text-ink-muted">
                  You have RE authority here, so you&apos;ll be able to upload
                  them.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
