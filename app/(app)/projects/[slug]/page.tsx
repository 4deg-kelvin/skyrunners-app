import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  CornerDownRight,
  TriangleAlert,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { LogWorkForm } from "@/components/forms/log-work-form";
import { workLogRepliesFor } from "@/lib/worklog/replies";
import { ProjectTeamForm } from "@/components/forms/team-admin";
import { ContactLink } from "@/components/ui/contact-link";
import {
  AddDeliverableForm,
  DeliverableActions,
} from "@/components/forms/deliverable-actions";
import { DeliverableTodos } from "@/components/forms/deliverable-todos";
import { ProjectAdvisors } from "@/components/forms/project-advisors";
import {
  AskToJoinButton,
  FollowToggle,
  JoinRequestDecision,
  RemoveMemberButton,
  WithdrawRequestButton,
} from "@/components/forms/project-actions";
import { EntryResponse } from "@/components/forms/entry-response";
import { ProjectEditForm } from "@/components/forms/project-edit";
import {
  AddProjectMemberForm,
  CreateProjectForm,
  REControls,
} from "@/components/forms/project-admin";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardBody } from "@/components/ui/card";
import { ArtifactList } from "@/components/ui/artifact-list";
import { AttachArtifactForm } from "@/components/forms/artifact-form";
import { DeliverableRow, ProgressBar } from "@/components/ui/deliverable-row";
import { EmptyState } from "@/components/ui/empty-state";
import { Gantt } from "@/components/ui/gantt";
import { AttendToggle } from "@/components/forms/event-actions";
import { EVENT_KIND_LABELS } from "@/lib/labels";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import { PushDeadlineForm } from "@/components/forms/push-deadline";
import { getProjectBySlug, type ProjectDetailView } from "@/lib/data/projects";
import { getViewer } from "@/lib/data/viewer";
import {
  ATTENTION_LABELS,
  PHASE_LABELS,
  PROJECT_ROLE_LABELS,
} from "@/lib/labels";
import { can, isLeadership } from "@/lib/permissions";
import { daysBetweenDays, formatDay } from "@/lib/dates";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await getViewer();
  const view = await getProjectBySlug(
    slug,
    viewer.member.id,
    isLeadership(viewer.actor)
  );

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

  /*
    ONE feed: check-in entries and work-log lines together, newest first.

    These were two cards — "Recent Work" (PLs only) and "Recent Updates On This
    Project" (public) — and Anish's decision on 2026-08-16 is that they are the
    same thing and both public. With hours gone, a log line and a check-in entry
    are both just "what somebody did here"; the only difference is that one is
    written as you go and the other twice a week. See
    `can.viewMemberWorkOnProject` for why the privacy went with the hours.

    Sorted by comparing an INSTANT (`submittedAt`) against a CALENDAR DATE
    (`workDate`) as strings, which is sound because both are ISO-prefixed:
    "2026-08-13T10:00Z" sorts above "2026-08-12" exactly as the dates do. On the
    same day the check-in lands above the log line — arbitrary, but stable.
    Never build two Dates to compare these; see `lib/dates.ts`.
  */
  const activity = [
    ...updateFeed.map((row) => ({
      kind: "update" as const,
      at: row.submittedAt,
      key: `u-${row.entry.id}`,
      update: row,
    })),
    ...view.recentWorkLog.map((row) => ({
      kind: "log" as const,
      at: row.log.workDate,
      key: `l-${row.log.id}`,
      log: row,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  /*
    A draft for the log box: what THIS member ticked off on THIS project today.

    Anish's ask — "when people are checking off checklist items or deliverables it
    should be super easy for them to effortlessly log what they did". Ticking
    something is already a statement about what you did; asking somebody to retype
    it as prose is the friction that stops people logging at all.

    Scoped to today and to this member, so it never puts somebody else's work in
    your box, and never resurfaces last week's. If nothing was ticked the box is
    empty and behaves exactly as it does elsewhere.
  */
  const tickedToday = (() => {
    const mine = deliverables.filter(
      (row) => row.deliverable.ownerId === viewer.member.id
    );
    const finished = mine
      .filter((row) => row.deliverable.submittedAt?.startsWith(view.today))
      .map((row) => row.deliverable.title);
    const items = mine.flatMap((row) =>
      row.todos
        .filter(
          (todo) =>
            todo.done &&
            todo.doneBy === viewer.member.id &&
            todo.doneAt?.startsWith(view.today)
        )
        .map((todo) => todo.title)
    );

    const parts = [
      finished.length ? `Finished: ${finished.join(", ")}` : "",
      items.length ? `Checked off: ${items.join(", ")}` : "",
    ].filter(Boolean);
    return parts.length ? `${parts.join(". ")}.` : undefined;
  })();

  /*
    Replies to logged lines, one query for the whole feed.

    Read outside the snapshot and fails soft to {} — see `workLogRepliesFor`. A
    query per row would be the round-trip-per-row mistake the data layer exists to
    prevent, on a feed that renders three weeks of entries.
  */
  const logReplies = await workLogRepliesFor(project.id);

  const mayManage = can.manageProject(viewer.actor, viewer.graph, project.id);
  const mayAssignRE = can.assignRE(viewer.actor, viewer.graph, project.id);
  /*
    Approving, as opposed to running the project.

    Both of these deliberately EXCLUDE the project's own PL, who has
    `mayManage` and everything that comes with it. Finishing the work and
    agreeing it's finished are different jobs — see `isREaboveProject`.
  */
  const mayComplete = can.completeProject(
    viewer.actor,
    viewer.graph,
    project.id
  );
  const mayWithdrawSignOff = can.withdrawSignOff(
    viewer.actor,
    viewer.graph,
    project.id
  );
  const mayDelete = can.deleteProject(viewer.actor, viewer.graph, project.id);
  const mayManageAdvisors = can.manageProjectAdvisors(
    viewer.actor,
    viewer.graph,
    project.id
  );

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

  /*
    The engineering record splits adding from removing, and only this one is
    open past the PLs. `isOnProject` deliberately excludes followers — watching
    a project isn't working on it.
  */
  const mayAttachArtifact = can.attachArtifact(
    viewer.actor,
    viewer.graph,
    project.id,
    isOnProject
  );
  const mayManageArtifacts = can.manageArtifact(
    viewer.actor,
    viewer.graph,
    project.id
  );

  const mayRequest =
    !isOnProject && !view.myPendingRequest && can.requestToJoin(viewer.actor);
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
          /*
            Following was built in Phase 2 and never rendered anywhere, so the
            self-service half of "membership is PL-controlled" didn't exist —
            you could ask to join and wait, and that was it. The page even read
            `isFollowing` to show a badge for a state nothing could produce.

            It sits next to whichever join control applies, because the two are
            the pair: ask to be committed, or just watch.
          */
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isOnProject ? (
                <Badge tone="ok">You&apos;re on this project</Badge>
              ) : view.myPendingRequest ? (
                <>
                  <Badge tone="warn">Request pending</Badge>
                  <WithdrawRequestButton
                    requestId={view.myPendingRequest.id}
                    projectName={project.name}
                  />
                </>
              ) : mayRequest ? (
                <AskToJoinButton
                  projectId={project.id}
                  projectName={project.name}
                  isRecruiting={project.isOpenToJoin}
                />
              ) : null}

              {isOnProject ? null : (
                <FollowToggle projectId={project.id} following={isFollowing} />
              )}
            </div>
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
                  className="text-warn-fg flex items-start gap-2 text-sm"
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
                  <h2 className="text-ink mt-2 text-2xl font-bold">
                    {PHASE_LABELS[project.phase]}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ProjectBadges project={project} />
                  {mayManage ? (
                    <ProjectEditForm
                      project={project}
                      canDelete={mayDelete}
                      canComplete={mayComplete}
                      parentTargetDate={view.parent?.targetDate}
                      incompleteDescendants={view.incompleteDescendants}
                    />
                  ) : null}
                  {/*
                    Breaking work down, from the project it belongs under.

                    `can.createProject` has always allowed a PL to create a
                    sub-project of something they own — and the form has always
                    had the `parentId` prop for it — but it was only ever
                    mounted on /projects, where the button is Lead-and-above.
                    So a plain-member PL had the right and no door, and anyone
                    else had to create the project at top level and reparent it.

                    Not offered on a complete project: a live child under a
                    finished parent is the state `updateProject` exists to
                    prevent.
                  */}
                  {mayManage && project.phase !== "complete" ? (
                    <CreateProjectForm
                      parents={[]}
                      divisions={[]}
                      people={assignableMembers.map((m) => ({
                        id: m.id,
                        name: m.fullName,
                      }))}
                      defaultReId={viewer.member.id}
                      parentId={project.id}
                      parentTargetDate={project.targetDate}
                      label="Add a sub-project"
                    />
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
                {/*
                  `relative` so the move-date popover anchors to THIS tile.

                  Without it the panel positions against the grid and lands under
                  whichever tile happens to be first, which looks like a CSS
                  accident rather than a control belonging to a number.
                */}
                <StatTile
                  className="relative"
                  label="Target"
                  value={
                    project.targetDate ? formatDay(project.targetDate) : "—"
                  }
                  action={
                    mayManage &&
                    project.targetDate &&
                    project.phase !== "complete" ? (
                      <PushDeadlineForm
                        projectId={project.id}
                        projectName={project.name}
                        currentTarget={project.targetDate}
                        parentTargetDate={view.parent?.targetDate}
                      />
                    ) : undefined
                  }
                  /*
                    The slip, stated on the tile itself.

                    This is the whole reason the history is worth recording: the
                    current date alone cannot tell you the project has moved
                    three times. Absent entirely when nothing has moved — a
                    standing "on the original schedule" line would be noise on
                    every project that has never slipped.
                  */
                  hint={
                    view.baselineTargetDate && project.targetDate ? (
                      <>
                        Originally {formatDay(view.baselineTargetDate)} —{" "}
                        <span className="text-cardinal-600 font-semibold">
                          {(() => {
                            const d = daysBetweenDays(
                              view.baselineTargetDate,
                              project.targetDate
                            );
                            // "1 days later" is the kind of small wrongness that
                            // makes people distrust the numbers next to it.
                            return `${d} ${d === 1 ? "day" : "days"} later`;
                          })()}
                        </span>
                        {view.deadlineHistory.length > 1
                          ? `, across ${view.deadlineHistory.length} moves`
                          : ""}
                      </>
                    ) : undefined
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

          {/*
            Log what you did, right here.

            First thing under the status block, and expanded rather than
            collapsed, because the moment somebody has just ticked a deliverable
            is the moment they know what to write. Sending them to My Work to do
            it loses most of them.

            The SAME component and the same action as the dashboard and My Work —
            not a second write path. It is locked to this project by passing one
            option, so there is no picker to get wrong.

            Committed members only: `isOnProject` excludes followers, matching
            `logWork`, which refuses a project you are not on. Showing the box to
            a follower would be a control that always fails.

            No `recent` list here on purpose — correcting or deleting an entry
            stays on My Work, where that affordance already exists and is tested,
            and where somebody looking for it will go.

            Deliberately NOT wrapped in a `Card` with its own label and heading.
            It had those, and that heading said the same thing as the form's own
            "Log what I did" one line below it: two titles and a paragraph of
            explanation around a box with one field in it. Anish asked for it to
            feel convenient rather than big, so the form's own panel IS the block.
            Everything else on this page is a Card, and this one being a bare
            panel is what makes it read as a control rather than a section.
          */}
          {isOnProject ? (
            <LogWorkForm
              projects={[{ id: project.id, name: project.name }]}
              defaultProjectId={project.id}
              today={view.today}
              maxBackdateDays={view.maxBackdateDays}
              startOpen
              defaultDescription={tickedToday}
            />
          ) : null}

          {/* Deliverables — the whole task model, one flat list */}
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionLabel>Deliverables</SectionLabel>
                {mayManage ? (
                  <AddDeliverableForm
                    projectId={project.id}
                    candidates={assignableMembers}
                    projectTargetDate={project.targetDate}
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
                        : "The PL hasn't listed deliverables for this project yet."
                    }
                    actionLabel="See your own work"
                    actionHref="/my-work"
                  />
                ) : (
                  deliverables.map(({ deliverable, owner, overdue, todos }) => {
                    const isOwner = deliverable.ownerId === viewer.member.id;
                    return (
                      <div
                        key={deliverable.id}
                        className="rounded-tile border-line border px-3.5 py-3"
                      >
                        <DeliverableRow
                          deliverable={deliverable}
                          owner={owner}
                          overdue={overdue}
                        />

                        {/*
                          Checklist above the buttons, because it's the reason
                          one of them may be missing. See `DeliverableTodos` —
                          the owner writes these as much as the PL does, which
                          is why `canManage` is wider here than `mayManage`.
                        */}
                        <DeliverableTodos
                          deliverableId={deliverable.id}
                          projectId={project.id}
                          todos={todos}
                          canManage={isOwner || mayManage}
                          locked={deliverable.status === "done"}
                        />

                        <div className="mt-2.5">
                          <DeliverableActions
                            deliverable={deliverable}
                            isOwner={isOwner}
                            canSignOff={mayManage}
                            canWithdrawSignOff={mayWithdrawSignOff}
                            projectTargetDate={project.targetDate}
                            openTodos={todos.filter((t) => !t.done).length}
                            candidates={assignableMembers.map((m) => ({
                              id: m.id,
                              name: m.fullName,
                            }))}
                          />
                        </div>
                      </div>
                    );
                  })
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
                  members.map(({ membership, member, daysWorked }) => (
                    <div
                      key={membership.memberId}
                      className="rounded-tile border-line flex flex-wrap items-start justify-between gap-3 border px-4 py-3"
                    >
                      <div className="min-w-0">
                        {member ? (
                          <Link
                            href={`/members/${member.id}`}
                            className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                          >
                            {member.fullName}
                          </Link>
                        ) : (
                          <span className="text-ink-muted text-[15px] font-bold">
                            Unknown member
                          </span>
                        )}
                        {membership.responsibility ? (
                          <p className="text-ink-soft mt-0.5 text-sm">
                            {membership.responsibility}
                          </p>
                        ) : null}
                        {/*
                          Days worked on THIS project, for the PLs of it.

                          The per-project half of the privacy split, and the
                          only effort figure a PL is allowed — never the
                          person's record or reliability, which belong to them
                          and their Lead. See `can.viewMemberWorkOnProject`.

                          Counts from the moment they log, not from their next
                          check-in: a check-in reports work that already
                          happened, it doesn't create it.
                        */}
                        {mayManage && daysWorked > 0 ? (
                          <p className="text-ink-muted mt-0.5 flex items-center gap-1.5 text-sm">
                            <Clock className="size-3.5" />
                            {daysWorked === 1
                              ? "worked here on 1 day"
                              : `worked here on ${daysWorked} days`}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            membership.role === "re" ? "cardinal" : "neutral"
                          }
                        >
                          {PROJECT_ROLE_LABELS[membership.role]}
                        </Badge>

                        {/*
                          Multiple PLs per project is a deliberate part of the
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

                        {/*
                          `RemoveMemberButton` rather than a bare ActionButton.
                          The component was written for this and never used, so
                          the page grew its own one-click version — and taking
                          somebody off a project reassigns their open work and
                          can't be undone from here. It asks first, by name.
                        */}
                        {mayAddMember &&
                        project.primaryReId !== membership.memberId ? (
                          <RemoveMemberButton
                            projectId={project.id}
                            memberId={membership.memberId}
                            memberName={member?.fullName ?? "them"}
                          />
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>

          {/* Join requests — visible to the PL, so an ask can't be lost */}
          {mayReviewRequests && view.pendingRequests.length > 0 ? (
            <Card>
              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>People Asking To Join</SectionLabel>
                  <span className="text-ink-muted text-sm">
                    {view.pendingRequests.length} waiting on you
                  </span>
                </div>

                <div className="mt-4 space-y-2.5">
                  {view.pendingRequests.map(
                    ({ request, requester, daysWaiting }) => (
                      <div
                        key={request.id}
                        className="rounded-tile border-line border px-4 py-3.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            {requester ? (
                              <Link
                                href={`/members/${requester.id}`}
                                className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                              >
                                {requester.fullName}
                              </Link>
                            ) : (
                              <span className="text-ink-muted text-[15px] font-bold">
                                Unknown member
                              </span>
                            )}
                            {requester?.skills?.length ? (
                              <p className="text-ink-muted mt-1 text-sm">
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
                          <p className="text-ink-soft mt-2 text-sm">
                            &ldquo;{request.note}&rdquo;
                          </p>
                        ) : null}

                        {/*
                          These were two plain `Button`s wired to nothing.

                          The PL's own project page is where they'd naturally
                          answer a request, and pressing either did exactly
                          nothing — no error, no change, no clue. The working
                          controls existed the whole time and were only mounted
                          on /my-work, so the queue looked answerable from the
                          place it's advertised and wasn't.
                        */}
                        <JoinRequestDecision
                          requestId={request.id}
                          projectId={project.id}
                          requesterName={requester?.fullName ?? "They"}
                        />
                      </div>
                    )
                  )}
                </div>

                <p className="text-ink-muted mt-4 text-sm">
                  Answering these is part of being PL — a request left hanging
                  is a member with nothing to do.
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
                      className="rounded-tile border-line hover:bg-surface block border px-4 py-3 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <CornerDownRight className="text-ink-muted size-4 shrink-0" />
                          <span className="text-ink text-[15px] font-bold">
                            {child.name}
                          </span>
                        </span>
                        <ProjectBadges project={child} />
                      </div>
                      {childRes.length > 0 ? (
                        <p className="text-ink-muted mt-1.5 pl-6 text-sm">
                          {childRes.length > 1 ? "PLs" : "PL"}:{" "}
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
              <SectionLabel>Work on this project</SectionLabel>
              <p className="text-ink-soft mt-2 text-sm">
                Everything anyone has done here, newest first. Public to the
                whole club: it is the project&apos;s history, and how anyone
                above you sees what is happening without asking. Reply to any
                line — that is what tells somebody it was read.
              </p>

              {/*
                Milestones the app announced, above the human entries.

                Deliberately NOT synthesised check-ins. Building these as
                progress updates would have been less code and would have made
                a member's reliability record claim they reported in on a day
                they didn't — see `ProjectNotice`. So they're their own rows,
                pinned above the feed and visibly automatic.
              */}
              {view.notices.length > 0 ? (
                <div className="mt-4 space-y-2.5">
                  {view.notices.map(({ notice, notified }) => (
                    <div
                      key={notice.id}
                      className="rounded-tile border-ok-fg/25 bg-ok-bg border px-4 py-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-ok-fg flex items-center gap-2 text-[15px] font-bold">
                          <CheckCircle2 className="size-4 shrink-0" />
                          {notice.body}
                        </p>
                        <span className="text-ink-muted text-xs">
                          {new Date(
                            `${notice.createdAt.slice(0, 10)}T00:00:00Z`
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            timeZone: "UTC",
                          })}
                        </span>
                      </div>
                      {notified.length > 0 ? (
                        <p className="text-ink-muted mt-1.5 text-xs">
                          Sent up the chain to{" "}
                          {notified.map((m) => m.fullName).join(", ")}.
                        </p>
                      ) : (
                        <p className="text-ink-muted mt-1.5 text-xs">
                          Nobody sits above this project, so there was no one to
                          tell.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 space-y-3">
                {activity.length === 0 ? (
                  view.notices.length > 0 ? null : (
                    <EmptyState
                      message="Nothing logged here yet."
                      actionLabel="Log what you did"
                      actionHref="/my-work"
                    />
                  )
                ) : (
                  activity.map((item) =>
                    /*
                      A logged line and a check-in entry, in one list.

                      The log line is deliberately plainer — one sentence, a name
                      and a date — because that is all it is. Giving it the same
                      chrome as a check-in would imply it carries blockers and
                      next steps that nobody wrote.
                    */
                    item.kind === "log" ? (
                      <div
                        key={item.key}
                        className="rounded-tile border-line flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border px-4 py-2.5"
                      >
                        <span className="min-w-0 text-sm">
                          <span className="text-ink font-semibold">
                            {item.log.member?.fullName ?? "Unknown member"}
                          </span>
                          {item.log.log.description ? (
                            <span className="text-ink-soft">
                              {" "}
                              — {item.log.log.description}
                            </span>
                          ) : (
                            <span className="text-ink-muted"> — no note</span>
                          )}
                        </span>
                        <span className="text-ink-muted shrink-0 text-xs">
                          {formatDay(item.log.log.workDate)}
                        </span>
                        {/*
                          Answerable, exactly like a check-in entry.

                          Anish's note on the merged feed: "you should be able to
                          reply to all of these". A box on one row and not the next
                          reads as the app being broken, and the whole point of the
                          merge is that the two rows are the same kind of thing.

                          `w-full` because the row is a flex line with the date
                          pushed to the end — without it the reply sits in the
                          middle of that line instead of under it.
                        */}
                        <div className="w-full">
                          <EntryResponse
                            workLogId={item.log.log.id}
                            projectId={project.id}
                            authorName={
                              item.log.member?.preferredName ??
                              item.log.member?.fullName ??
                              "them"
                            }
                            existing={logReplies[item.log.log.id]?.response}
                            responderName={
                              members.find(
                                (m) =>
                                  m.member?.id ===
                                  logReplies[item.log.log.id]?.respondedBy
                              )?.member?.fullName
                            }
                            canRespond={mayManage}
                          />
                        </div>
                      </div>
                    ) : (
                      <UpdateRow
                        key={item.key}
                        row={item.update}
                        projectId={project.id}
                        canRespond={mayManage}
                      />
                    )
                  )
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ---------------- Sidebar ---------------- */}
        <div className="space-y-6">
          {/*
            This project's own timeline.

            Scoped to this project: its span, its deliverables, its
            sub-projects — and nothing above or beside it. The division chart
            on /projects answers "how does the division's work stack up"; this
            one answers "how does mine", which is the question somebody
            standing on this page actually has.

            Deliverables appear here and only here. On the division chart they
            would bury five projects under a hundred diamonds.
          */}
          {view.timeline ? (
            <Card className="h-fit">
              <CardBody>
                <SectionLabel>Timeline</SectionLabel>
                <div className="mt-4">
                  <Gantt
                    chart={view.timeline}
                    compact
                    caption="Diamonds are deliverable due dates. The red line is today."
                  />
                </div>

                {/*
                  The schedule's history, directly under the chart that draws it.

                  Here rather than in its own card because it explains the hollow
                  markers a few pixels above — a "Deadline history" card further
                  down the sidebar would be a list of dates with nothing to
                  attach them to. Absent entirely when nothing has moved.
                */}
                {view.deadlineHistory.length > 0 ? (
                  <div className="border-line mt-4 border-t pt-3">
                    <p className="text-ink-muted text-[11px] font-semibold tracking-wide uppercase">
                      Deadlines moved{" "}
                      {view.deadlineHistory.length === 1
                        ? "once"
                        : `${view.deadlineHistory.length} times`}
                    </p>

                    <ul className="mt-2 space-y-2.5">
                      {view.deadlineHistory.map(
                        ({ change, actor, daysMoved, deliverableTitle }) => (
                          <li key={change.id} className="text-xs">
                            {/*
                              Which thing moved. Absent for the project's own
                              target, because "SkyBeta Kits" above the list
                              already says that — and repeating it on every row
                              would bury the deliverable rows that are the
                              interesting ones.
                            */}
                            {deliverableTitle ? (
                              <p className="text-cardinal-600 font-semibold">
                                {deliverableTitle}
                              </p>
                            ) : null}
                            <p className="text-ink font-semibold">
                              {change.fromDate
                                ? `${formatDay(change.fromDate)} → ${formatDay(change.toDate)}`
                                : `Set to ${formatDay(change.toDate)}`}
                              {daysMoved !== 0 ? (
                                <span
                                  className={
                                    daysMoved > 0
                                      ? "text-cardinal-600 font-normal"
                                      : "text-ok-fg font-normal"
                                  }
                                >
                                  {" · "}
                                  {`${Math.abs(daysMoved)} ${
                                    Math.abs(daysMoved) === 1 ? "day" : "days"
                                  } ${daysMoved > 0 ? "later" : "earlier"}`}
                                </span>
                              ) : null}
                            </p>
                            {/*
                              A move made through the full project editor carries
                              no reason — only `changeProjectDeadline` requires
                              one. Saying so is better than an empty line: it
                              tells the reader the gap is a route somebody took,
                              not data that went missing.
                            */}
                            {change.reason ? (
                              <p className="text-ink-soft mt-0.5">
                                {change.reason}
                              </p>
                            ) : (
                              <p className="text-ink-muted mt-0.5 italic">
                                No reason recorded — changed from Edit project.
                              </p>
                            )}
                            <p className="text-ink-muted mt-0.5">
                              {actor
                                ? (actor.preferredName ?? actor.fullName)
                                : "Someone"}
                              {" · "}
                              {formatDay(change.changedAt)}
                            </p>
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {/*
            What's scheduled for this project.

            The other half of the calendar link. An event has carried a
            projectId since the calendar shipped, and the calendar linked BACK
            to the project — but nothing came the other way, so somebody
            reading a project had no idea a build session for it was on
            Thursday. That's the "I can't find something to do" problem
            arriving on the page where the work is described.

            Turning up is offered right here. Making somebody go to the
            calendar to press a button about the thing they're already looking
            at is the navigation tax this app keeps removing.
          */}
          {view.events.length > 0 ? (
            <Card className="h-fit">
              <CardBody>
                <SectionLabel>Coming Up</SectionLabel>
                <div className="mt-4 space-y-3">
                  {view.events.map(({ event, attendees, isAttending }) => (
                    <div
                      key={event.id}
                      className="rounded-tile border-line border px-3.5 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="text-ink text-sm font-bold">
                          {event.title}
                        </span>
                        <Badge tone="neutral">
                          {EVENT_KIND_LABELS[event.kind]}
                        </Badge>
                      </div>

                      <p className="text-ink-muted mt-1 text-sm">
                        {new Date(
                          `${event.startsAt.slice(0, 10)}T00:00:00Z`
                        ).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                        {event.location ? ` · ${event.location}` : ""}
                      </p>

                      {attendees.length > 0 ? (
                        <p className="text-ink-muted mt-1 text-xs">
                          {attendees.map((a) => a.fullName).join(", ")}
                        </p>
                      ) : null}

                      <div className="mt-2.5">
                        {event.isOpen ? (
                          <AttendToggle
                            eventId={event.id}
                            attending={isAttending}
                          />
                        ) : (
                          /*
                            Closed events still show. The time IS taken, and
                            hiding an invite-only review from the project it's
                            about would make this page quietly less true than
                            the calendar. What you can't do is add yourself.
                          */
                          <span className="text-ink-muted text-xs">
                            Invite only — the organiser sets who&apos;s on it.
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-ink-muted mt-3 text-xs">
                  Anything open, you can turn up to — you don&apos;t have to be
                  on the project.
                </p>
              </CardBody>
            </Card>
          ) : null}

          <Card className="h-fit">
            <CardBody>
              <SectionLabel>Who To Ask</SectionLabel>
              <div className="mt-4 space-y-3">
                {res.length === 0 ? (
                  <p className="text-ink-muted text-sm">No PL assigned yet.</p>
                ) : (
                  /*
                    A face next to the name.

                    This card answers "who do I ask about this?", and the answer
                    is more useful when you'd recognise them in the lab. Same
                    reason the roster has avatars — the club is 35 people who
                    mostly know each other by sight before they know each other
                    by name.
                  */
                  res.map((re, i) => (
                    <div key={re.id} className="flex items-start gap-2.5">
                      <Avatar
                        name={re.fullName}
                        photoUrl={re.photoUrl}
                        className="size-9 shrink-0 text-xs"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/members/${re.id}`}
                            className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
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
                          className="mt-0.5"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/*
                Advisors under the PLs, quieter. The PL is who you ask first;
                the advisor is who the PL asks. See `ProjectAdvisors`.
              */}
              <ProjectAdvisors
                projectId={project.id}
                advisors={view.advisors}
                choices={view.advisorChoices}
                canManage={mayManageAdvisors}
              />
            </CardBody>
          </Card>

          {project.openRoles || project.timeCommitment ? (
            <Card className="h-fit">
              <CardBody>
                <SectionLabel>Getting Involved</SectionLabel>
                {project.timeCommitment ? (
                  <p className="text-ink-soft mt-3 text-[15px]">
                    <span className="text-ink font-semibold">Commitment:</span>{" "}
                    {project.timeCommitment}
                  </p>
                ) : null}
                {project.openRoles ? (
                  <p className="text-ink-soft mt-2 text-[15px]">
                    <span className="text-ink font-semibold">Looking for:</span>{" "}
                    {project.openRoles}
                  </p>
                ) : null}
                {!project.isOpenToJoin ? (
                  <p className="text-ink-muted mt-3 text-sm">
                    This project is closed to new members right now — contact
                    the PL if you&apos;d like to help.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card className="h-fit">
            <CardBody>
              <SectionLabel>Engineering Record</SectionLabel>
              <p className="text-ink-soft mt-2 text-sm">
                Slides, requirements, CAD and reports — everything you&apos;d
                read to understand this project.
              </p>

              {/*
                Attaching is open to anyone committed to the project, not just
                the PL — the person who ran the test holds the test report, and
                routing that through one inbox is how the record stays empty.
                Removing is the PL's, and a Co-Lead's alone once this is
                complete. See `can.attachArtifact` / `can.manageArtifact`.
              */}
              {mayAttachArtifact ? (
                <div className="mt-4">
                  {/*
                    Demo mode has no Supabase, so there's no bucket to upload
                    into. `viewer.isDemo` is the sanctioned way to ask — it
                    comes from `lib/data/viewer.ts`, the one file allowed to
                    know which mode the app is in.
                  */}
                  <AttachArtifactForm
                    projectId={project.id}
                    canUpload={!viewer.isDemo}
                  />
                </div>
              ) : null}

              <div className="mt-4">
                <ArtifactList
                  rows={artifacts}
                  projectId={project.id}
                  canAdd={mayAttachArtifact}
                  canRemove={mayManageArtifacts}
                  frozen={project.phase === "complete"}
                />
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * One check-in entry in the project's activity feed.
 *
 * Extracted when the work log and the check-in feed merged into a single list
 * (2026-08-16). The two entry kinds have genuinely different shapes — a log line
 * is a sentence, an entry carries progress, blockers, next steps and a reply — so
 * the branch inside `.map()` needed one of them out of the way to stay readable.
 */
function UpdateRow({
  row,
  projectId,
  canRespond,
}: {
  row: ProjectDetailView["updateFeed"][number];
  projectId: string;
  /** PL of this project or above — who may answer an entry here. */
  canRespond: boolean;
}) {
  const { entry, author, submittedAt, responder } = row;
  return (
    <div className="rounded-tile border-line border px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-ink text-[15px] font-bold">
          {author?.fullName ?? "Unknown member"}
        </p>

        <span className="text-ink-muted text-xs">{formatDay(submittedAt)}</span>
      </div>

      <p className="text-ink-soft mt-1.5 text-sm">{entry.progress}</p>

      {entry.blockers ? (
        <p className="text-ink-soft mt-2 flex items-start gap-1.5 text-sm">
          <TriangleAlert className="text-cardinal-600 mt-0.5 size-3.5 shrink-0" />

          <span className="font-medium">{entry.blockers}</span>
        </p>
      ) : null}

      {entry.nextSteps ? (
        <p className="text-ink-muted mt-1.5 text-sm">Next: {entry.nextSteps}</p>
      ) : null}

      {/*

                        The PL answers here, on the project, where the context

                        is. A Lead marking the whole check-in read is a

                        different obligation belonging to a different person —

                        that one lives on /updates.

                      */}

      <EntryResponse
        entryId={entry.id}

        projectId={projectId}

        authorName={author?.preferredName ?? author?.fullName ?? "them"}

        existing={entry.response}

        responderName={responder?.fullName}

        canRespond={canRespond}
      />
    </div>
  );
}
