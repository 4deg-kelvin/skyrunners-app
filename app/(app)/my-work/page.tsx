import Link from "next/link";
import { Clock, Eye, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ContactLink } from "@/components/ui/contact-link";
import { LogHoursForm } from "@/components/forms/log-hours-form";
import { CheckInForm } from "@/components/forms/check-in-form";
import {
  JoinRequestDecision,
  WithdrawRequestButton,
} from "@/components/forms/project-actions";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ContributionPanel } from "@/components/ui/contribution-panel";
import {
  DeliverableRow,
  ProgressBar,
} from "@/components/ui/deliverable-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { getMyWork } from "@/lib/data/my-work";
import { getViewer } from "@/lib/data/viewer";
import { UPDATE_STATUS_LABELS, UPDATE_STATUS_TONES } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { formatNumber } from "@/lib/utils";

export default async function MyWorkPage() {
  const viewer = await getViewer();
  const view = await getMyWork(viewer.member.id);
  const {
    me,
    lead: myLead,
    committed,
    following,
    currentUpdate,
    myDeliverables,
    contribution,
    myRequests,
    requestsAwaitingMe,
    today,
    maxBackdateDays,
  } = view;

  const pendingMine = myRequests.filter((r) => r.request.status === "pending");

  const mayLogHours = can.logOwnHours(viewer.actor, me.id);
  const maySubmitUpdate = can.submitOwnUpdate(viewer.actor, me.id);

  const dueDate = new Date(currentUpdate.update.dueAt);
  const firstName = me.preferredName ?? me.fullName.split(" ")[0];

  return (
    <div className="space-y-6">
      <PageHeader
        label="My Work"
        title={`Hi, ${firstName}`}
        description="What you own, what you owe, and how your effort is adding up."
        action={
          mayLogHours ? (
            <LogHoursForm
              projects={committed.map((c) => ({
                id: c.project.id,
                name: c.project.name,
              }))}
              defaultProjectId={committed[0]?.project.id}
              today={today}
              maxBackdateDays={maxBackdateDays}
              recent={view.recentHours}
            />
          ) : undefined
        }
      />

      {/* ---------------- Contribution: effort made visible ---------------- */}
      <Card>
        <CardBody>
          <ContributionPanel record={contribution} isOwnRecord />
          <p className="mt-5 text-sm text-ink-muted">
            Your Lead and the REs of your projects see the same four numbers.
            There is no ranking and no hidden score —{" "}
            <Link
              href="/how-we-lead"
              className="font-semibold text-cardinal-600 hover:text-cardinal-700"
            >
              here&apos;s what leadership looks for
            </Link>
            .
          </p>
        </CardBody>
      </Card>

      {/* ---------------- Requests waiting on me as an RE ---------------- */}
      {requestsAwaitingMe.length > 0 ? (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel>People Asking To Join Your Projects</SectionLabel>
              <span className="text-sm text-ink-muted">
                {requestsAwaitingMe.length} waiting
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              You control who joins your projects, which means you owe these
              people an answer. A request left hanging is a member with nothing to
              do.
            </p>

            <div className="mt-4 space-y-2.5">
              {requestsAwaitingMe.map(
                ({ request, project, requester, isStale }) => (
                  <div
                    key={request.id}
                    className={`rounded-tile border px-4 py-3.5 ${
                      isStale ? "border-risk-fg/30 bg-risk-bg" : "border-line"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold text-ink">
                          {requester?.fullName ?? "Unknown member"}
                        </p>
                        {project ? (
                          <Link
                            href={`/projects/${project.slug}`}
                            className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
                          >
                            {project.name}
                          </Link>
                        ) : null}
                      </div>
                      {isStale ? (
                        <Badge tone="risk">Overdue reply</Badge>
                      ) : (
                        <Badge tone="warn">Pending</Badge>
                      )}
                    </div>
                    {request.note ? (
                      <p className="mt-2 text-sm text-ink-soft">
                        &ldquo;{request.note}&rdquo;
                      </p>
                    ) : null}

                    {project ? (
                      <JoinRequestDecision
                        requestId={request.id}
                        projectId={project.id}
                        requesterName={requester?.fullName ?? "They"}
                      />
                    ) : null}
                  </div>
                )
              )}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------- My own pending requests ---------------- */}
      {pendingMine.length > 0 ? (
        <Card>
          <CardBody>
            <SectionLabel>My Requests</SectionLabel>
            <p className="mt-2 text-sm text-ink-soft">
              Waiting on an RE. Nothing is lost — you can see exactly where each
              ask stands.
            </p>
            <div className="mt-4 space-y-2.5">
              {pendingMine.map(({ request, project, isStale }) => (
                <div
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-line px-4 py-3"
                >
                  <div className="min-w-0">
                    {project ? (
                      <Link
                        href={`/projects/${project.slug}`}
                        className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                      >
                        {project.name}
                      </Link>
                    ) : null}
                    <p className="mt-0.5 text-sm text-ink-muted">
                      Asked{" "}
                      {new Date(request.requestedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {isStale ? (
                      <Badge tone="risk">No reply yet — nudge the RE</Badge>
                    ) : (
                      <Badge tone="warn">Pending</Badge>
                    )}
                    {/*
                      A request you can't take back isn't a tracked ask, it's a
                      commitment you made by clicking once. The operation for
                      this shipped in Phase 2 with no action and no button.
                    */}
                    <WithdrawRequestButton
                      requestId={request.id}
                      projectName={project?.name ?? "this project"}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------- What I own, across everything ---------------- */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>What I Own</SectionLabel>
            <span className="text-sm text-ink-muted">
              {myDeliverables.length} open
            </span>
          </div>

          <div className="mt-4 space-y-2.5">
            {myDeliverables.length === 0 ? (
              <EmptyState
                message="Nothing assigned to you right now."
                actionLabel="Find work to pick up"
                actionHref="/projects"
              />
            ) : (
              myDeliverables.map(({ deliverable, project }) => (
                <div key={deliverable.id}>
                  <Link
                    href={`/projects/${project.slug}`}
                    className="mb-1 block text-[13px] font-semibold text-cardinal-600 hover:text-cardinal-700"
                  >
                    {project.name}
                  </Link>
                  <DeliverableRow
                    deliverable={deliverable}
                    showOwner={false}
                    overdue={
                      deliverable.status !== "done" &&
                      !!deliverable.dueDate &&
                      new Date(deliverable.dueDate) < new Date()
                    }
                  />
                </div>
              ))
            )}
          </div>
        </CardBody>
      </Card>

      {/* ---------------- The update, split per project ---------------- */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <SectionLabel>
                {currentUpdate.inSession ? "Update Due" : "Out Of Session"}
              </SectionLabel>
              <h2 className="mt-2 text-2xl font-bold text-ink">
                {currentUpdate.inSession
                  ? `${dueDate.toLocaleDateString("en-US", { weekday: "long" })} check-in`
                  : "Nothing due right now"}
              </h2>
              {/*
                Saying WHY matters. A page that just shows no obligation reads
                as broken; "no check-ins during Winter break" reads as the club
                working as intended. Same reasoning as the academic pause.
              */}
              <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
                {currentUpdate.inSession ? (
                  <>
                    {currentUpdate.updatesPerWeek} a week, on the days you
                    picked. Your hours and open deliverables are already filled
                    in — write a line under each project so your RE knows where
                    things stand.
                  </>
                ) : (
                  <>
                    No check-ins are generated during{" "}
                    {currentUpdate.termName ?? "this period"} — nothing counts
                    against you and there&apos;s no backlog waiting. You can
                    still log hours and write one if you want to.
                  </>
                )}
              </p>
            </div>
            {currentUpdate.inSession ? (
              <Badge tone={UPDATE_STATUS_TONES[currentUpdate.update.status]}>
                {UPDATE_STATUS_LABELS[currentUpdate.update.status]}
              </Badge>
            ) : (
              <Badge tone="neutral">Paused</Badge>
            )}
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
                      {entry.progress ||
                        "No progress written yet for this project."}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {maySubmitUpdate ? (
            <div className="mt-5 flex flex-wrap items-start gap-3">
              <CheckInForm
                sections={currentUpdate.sections.map((s) => ({
                  projectId: s.project.id,
                  projectName: s.project.name,
                  hours: s.entry.hours,
                  lastProgress: s.entry.progress || undefined,
                }))}
                dueLabel={dueDate.toLocaleDateString("en-US", {
                  weekday: "long",
                })}
                readerName={myLead?.preferredName ?? myLead?.fullName}
              />
              <ButtonLink href="/updates" variant="secondary">
                Past check-ins
              </ButtonLink>
            </div>
          ) : null}

          <p className="mt-4 text-sm text-ink-muted">
            Heads-down on academics?{" "}
            <Link
              href="/settings"
              className="font-semibold text-cardinal-600 hover:text-cardinal-700"
            >
              Pause your check-ins
            </Link>{" "}
            — it doesn&apos;t count against you, and there&apos;s no backlog when
            you come back.
          </p>
        </CardBody>
      </Card>

      {/* ---------------- Committed projects ---------------- */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>My Projects</SectionLabel>
            <Link
              href="/projects"
              className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
            >
              Find work
            </Link>
          </div>

          {committed.length === 0 ? (
            <EmptyState
              className="mt-5 py-8"
              message="You're not on a project yet. Browse everything the club is building, then ask the RE of anything that interests you."
              actionLabel="Browse projects"
              actionHref="/projects"
            />
          ) : (
            <div className="mt-5 space-y-3">
              {committed.map(
                ({
                  project,
                  membership,
                  breadcrumb,
                  res,
                  hoursLogged,
                  myDeliverables: mine,
                  overdueCount,
                  progress,
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
                        {overdueCount > 0 ? (
                          <Badge tone="risk">{overdueCount} overdue</Badge>
                        ) : null}
                        <ProjectBadges project={project} />
                      </div>
                    </div>

                    {progress.total > 0 ? (
                      <ProgressBar
                        fraction={progress.fraction}
                        className="mt-3"
                      />
                    ) : null}

                    {/* What I own here — concrete, not a text field */}
                    {mine.length > 0 ? (
                      <div className="mt-4">
                        <SectionLabel tone="muted">My deliverables</SectionLabel>
                        <div className="mt-2 space-y-2">
                          {mine.map((d) => (
                            <DeliverableRow
                              key={d.id}
                              deliverable={d}
                              showOwner={false}
                              overdue={
                                d.status !== "done" &&
                                !!d.dueDate &&
                                new Date(d.dueDate) < new Date()
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-ink-muted">
                        Nothing assigned to you here yet — ask the RE what needs
                        picking up.
                      </p>
                    )}

                    {res.length > 0 ? (
                      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <SectionLabel tone="muted">
                          {res.length > 1 ? "REs" : "RE"}
                        </SectionLabel>
                        {res.map((re) => (
                          <ContactLink key={re.id} member={re} showLabel={false} />
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-muted">
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3.5" />
                        {formatNumber(hoursLogged, 1)} hrs logged
                      </span>
                      {project.timeCommitment ? (
                        <span>{project.timeCommitment}</span>
                      ) : null}
                    </div>

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
                    ) : null}
                  </div>
                )
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---------------- Following ---------------- */}
      {following.length > 0 ? (
        <Card>
          <CardBody>
            <SectionLabel>Following</SectionLabel>
            <p className="mt-2 text-sm text-ink-soft">
              Watching only — no deliverables, no update obligations.
            </p>
            <div className="mt-4 space-y-2.5">
              {following.map(({ project, breadcrumb }) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.slug}`}
                  className="block rounded-tile border border-line px-4 py-3 transition-colors hover:bg-surface"
                >
                  <Breadcrumb trail={breadcrumb} className="mb-1" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[15px] font-bold text-ink">
                      <Eye className="size-3.5 text-ink-muted" />
                      {project.name}
                    </span>
                    <ProjectBadges project={project} />
                  </div>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
