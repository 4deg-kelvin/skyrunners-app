import Link from "next/link";
import { notFound } from "next/navigation";
import { CornerDownRight, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ProjectTeamForm } from "@/components/forms/team-admin";
import { ContactLink } from "@/components/ui/contact-link";
import {
  AddDeliverableForm,
  DeliverableActions,
} from "@/components/forms/deliverable-actions";
import { AskToJoinButton } from "@/components/forms/project-actions";
import { ProjectEditForm } from "@/components/forms/project-edit";
import {
  AddProjectMemberForm,
  REControls,
} from "@/components/forms/project-admin";
import { ActionButton } from "@/components/forms/action-form";
import { removeProjectMemberAction } from "@/lib/actions";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ArtifactList } from "@/components/ui/artifact-list";
import {
  DeliverableRow,
  ProgressBar,
} from "@/components/ui/deliverable-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import {
  getProjectBySlug,
} from "@/lib/data/projects";
import { getViewer } from "@/lib/data/viewer";
import {
  ATTENTION_LABELS,
  PHASE_LABELS,
  PROJECT_ROLE_LABELS,
} from "@/lib/labels";
import { can } from "@/lib/permissions";
import { formatNumber } from "@/lib/utils";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await getViewer();
  const view = await getProjectBySlug(slug, viewer.member.id);

  if (!view) notFound();

  const {
    project,
    breadcrumb,
    res,
    members,
    children,
    updateFeed,
    deliverables,
    artifacts,
    progress,
    attentionFlags,
    assignableMembers,
    division,
    teamOptions,
  } = view;

  const mayManage = can.manageProject(viewer.actor, viewer.graph, project.id);
  const mayAssignRE = can.assignRE(viewer.actor, viewer.graph, project.id);
  const mayDelete = can.deleteProject(viewer.actor, viewer.graph, project.id);

  const mayAddMember = can.addProjectMember(
    viewer.actor,
    viewer.graph,
    project.id
  );
  const myMembership = members.find(
    (m) => m.membership.memberId === viewer.member.id
  );
  const isOnProject = myMembership?.membership.commitment === "committed";
  const isFollowing = myMembership?.membership.commitment === "following";

  const mayRequest =
    !isOnProject &&
    !view.myPendingRequest &&
    can.requestToJoin(viewer.actor, project);
  const mayReviewRequests = can.reviewJoinRequest(
    viewer.actor,
    viewer.graph,
    project.id
  );


  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb trail={breadcrumb.slice(0, -1)} className="mb-3 px-1" />
        <PageHeader
          label="Project"
          title={project.name}
          description={project.description}
          action={
            isOnProject ? (
              <Badge tone="ok">You&apos;re on this project</Badge>
            ) : view.myPendingRequest ? (
              <Badge tone="warn">Request pending</Badge>
            ) : mayRequest ? (
              <AskToJoinButton
                projectId={project.id}
                projectName={project.name}
              />
            ) : isFollowing ? (
              <Badge tone="neutral">Following</Badge>
            ) : undefined
          }
        />
      </div>

      {/* Attention flags — surfaced rather than left to stall silently */}
      {attentionFlags.length > 0 ? (
        <Card className="border-warn-fg/25 bg-warn-bg">
          <CardBody className="py-4">
            <SectionLabel tone="muted">Needs Attention</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {attentionFlags.map((flag) => (
                <li
                  key={`${flag.reason}-${flag.detail}`}
                  className="flex items-start gap-2 text-sm text-warn-fg"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="font-semibold">
                      {ATTENTION_LABELS[flag.reason]}:
                    </span>{" "}
                    {flag.detail}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

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
                <div className="flex flex-wrap items-center gap-2">
                  <ProjectBadges project={project} />
                  {mayManage ? (
                    <ProjectEditForm project={project} canDelete={mayDelete} />
                  ) : null}
                </div>
              </div>

              {/*
                The lifecycle bar that used to sit here is gone.
                It looked like a progress bar and wasn't one — it showed which
                of nine named stages the project is at, right next to a real
                completion bar on the deliverables. Two identical-looking bars
                meaning different things is worse than one. The stage is the
                heading and the badge; the bar added nothing.
              */}

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
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
                <StatTile
                  label="Deliverables done"
                  value={`${progress.done} / ${progress.total}`}
                  hint={
                    progress.overdue > 0
                      ? `${progress.overdue} overdue`
                      : undefined
                  }
                />
                <StatTile
                  label="Committed members"
                  value={
                    members.filter(
                      (m) => m.membership.commitment === "committed"
                    ).length
                  }
                />
              </div>
            </CardBody>
          </Card>

          {/* Deliverables — the whole task model, one flat list */}
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionLabel>Deliverables</SectionLabel>
                {mayManage ? (
                  <AddDeliverableForm
                    projectId={project.id}
                    candidates={assignableMembers}
                  />
                ) : null}
              </div>

              {progress.total > 0 ? (
                <ProgressBar fraction={progress.fraction} className="mt-4" />
              ) : null}

              <div className="mt-4 space-y-2.5">
                {deliverables.length === 0 ? (
                  <EmptyState
                    message={
                      mayManage
                        ? "No deliverables yet. Adding a few makes it obvious who owns what."
                        : "The RE hasn't listed deliverables for this project yet."
                    }
                    actionLabel="See your own work"
                    actionHref="/my-work"
                  />
                ) : (
                  deliverables.map(({ deliverable, owner, overdue }) => (
                    <div
                      key={deliverable.id}
                      className="rounded-tile border border-line px-3.5 py-3"
                    >
                      <DeliverableRow
                        deliverable={deliverable}
                        owner={owner}
                        overdue={overdue}
                      />
                      <div className="mt-2.5">
                        <DeliverableActions
                          deliverable={deliverable}
                          isOwner={deliverable.ownerId === viewer.member.id}
                          canSignOff={mayManage}
                          candidates={assignableMembers.map((m) => ({
                            id: m.id,
                            name: m.fullName,
                          }))}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>

          {mayManage ? (
            <ProjectTeamForm
              projectId={project.id}
              currentTeamId={project.teamId}
              currentDivisionName={division?.name}
              teams={teamOptions}
            />
          ) : null}

          {/* Team */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-4">
                <SectionLabel>Team</SectionLabel>
                {mayAddMember ? (
                  <AddProjectMemberForm
                    projectId={project.id}
                    candidates={assignableMembers.map((m) => ({
                      id: m.id,
                      name: m.fullName,
                    }))}
                    canAssignRE={mayAssignRE}
                  />
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={membership.role === "re" ? "cardinal" : "neutral"}
                        >
                          {PROJECT_ROLE_LABELS[membership.role]}
                        </Badge>

                        {/*
                          Multiple REs per project is a deliberate part of the
                          model, so promoting somebody has to be reachable from
                          the roster rather than living in a form nothing
                          rendered.
                        */}
                        {mayAssignRE ? (
                          <REControls
                            projectId={project.id}
                            memberId={membership.memberId}
                            isRE={membership.role === "re"}
                            isPrimary={
                              project.primaryReId === membership.memberId
                            }
                          />
                        ) : null}

                        {mayAddMember &&
                        project.primaryReId !== membership.memberId ? (
                          <ActionButton
                            action={removeProjectMemberAction}
                            fields={{
                              projectId: project.id,
                              memberId: membership.memberId,
                            }}
                            label="Remove"
                            pendingLabel="Removing…"
                            tone="danger"
                          />
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>

          {/* Join requests — visible to the RE, so an ask can't be lost */}
          {mayReviewRequests && view.pendingRequests.length > 0 ? (
            <Card>
              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>People Asking To Join</SectionLabel>
                  <span className="text-sm text-ink-muted">
                    {view.pendingRequests.length} waiting on you
                  </span>
                </div>

                <div className="mt-4 space-y-2.5">
                  {view.pendingRequests.map(
                    ({ request, requester, daysWaiting }) => (
                      <div
                        key={request.id}
                        className="rounded-tile border border-line px-4 py-3.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            {requester ? (
                              <Link
                                href={`/members/${requester.id}`}
                                className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                              >
                                {requester.fullName}
                              </Link>
                            ) : (
                              <span className="text-[15px] font-bold text-ink-muted">
                                Unknown member
                              </span>
                            )}
                            {requester?.skills?.length ? (
                              <p className="mt-1 text-sm text-ink-muted">
                                {requester.skills.join(" · ")}
                              </p>
                            ) : null}
                          </div>
                          <Badge tone={daysWaiting >= 5 ? "risk" : "warn"}>
                            {daysWaiting === 0
                              ? "Today"
                              : `${daysWaiting}d waiting`}
                          </Badge>
                        </div>

                        {request.note ? (
                          <p className="mt-2 text-sm text-ink-soft">
                            &ldquo;{request.note}&rdquo;
                          </p>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button className="px-3 py-2">Add to project</Button>
                          <Button variant="secondary" className="px-3 py-2">
                            Not right now
                          </Button>
                        </div>
                      </div>
                    )
                  )}
                </div>

                <p className="mt-4 text-sm text-ink-muted">
                  Answering these is part of being RE — a request left hanging is
                  a member with nothing to do.
                </p>
              </CardBody>
            </Card>
          ) : null}

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
                      <ContactLink
                        member={re}
                        showLabel={false}
                        className="mt-1"
                      />
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionLabel>Engineering Record</SectionLabel>
                {mayManage ? (
                  <Button variant="ghost" className="px-2 py-1" disabled>
                    Add link
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-ink-soft">
                Slides, requirements, CAD and reports — everything you&apos;d read
                to understand this project.
              </p>
              <div className="mt-4">
                <ArtifactList rows={artifacts} canAdd={mayManage} />
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
