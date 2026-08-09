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
import { CompletedProjectsSection } from "@/components/ui/completed-filter";
import { ContributionPanel } from "@/components/ui/contribution-panel";
import { DeliverableRow, ProgressBar } from "@/components/ui/deliverable-row";
import { DueCountdown } from "@/components/ui/due-countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import {
  getMyWork,
  type MyProjectCard as MyProjectCardData,
} from "@/lib/data/my-work";
import { getViewer } from "@/lib/data/viewer";
import {
  checkInDue,
  UPDATE_STATUS_LABELS,
  UPDATE_STATUS_TONES,
} from "@/lib/labels";
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

  /*
    Finished projects go to the bottom, behind a toggle.

    Same reasoning as /projects: this page answers "what am I doing", and a
    project you finished last quarter competes with that for the only thing
    it has — vertical space. The record still matters, so it's collapsed
    rather than dropped.
  */
  const liveProjects = committed.filter((c) => c.project.phase !== "complete");
  const finishedProjects = committed.filter(
    (c) => c.project.phase === "complete"
  );

  const mayLogHours = can.logOwnHours(viewer.actor, me.id);
  const maySubmitUpdate = can.submitOwnUpdate(viewer.actor, me.id);

  // "Sunday check-in" said nothing about whether Sunday had already been and
  // gone. `checkInDue` answers when, and says so out loud once it's late.
  const due = checkInDue(currentUpdate.update.dueAt, today);
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
          <p className="text-ink-muted mt-5 text-sm">
            Your Lead and the REs of your projects see the same four numbers.
            There is no ranking and no hidden score —{" "}
            <Link
              href="/how-we-lead"
              className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
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
              <span className="text-ink-muted text-sm">
                {requestsAwaitingMe.length} waiting
              </span>
            </div>
            <p className="text-ink-soft mt-2 text-sm">
              You control who joins your projects, which means you owe these
              people an answer. A request left hanging is a member with nothing
              to do.
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
                        <p className="text-ink text-[15px] font-bold">
                          {requester?.fullName ?? "Unknown member"}
                        </p>
                        {project ? (
                          <Link
                            href={`/projects/${project.slug}`}
                            className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
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
                      <p className="text-ink-soft mt-2 text-sm">
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
            <p className="text-ink-soft mt-2 text-sm">
              Waiting on an RE. Nothing is lost — you can see exactly where each
              ask stands.
            </p>
            <div className="mt-4 space-y-2.5">
              {pendingMine.map(({ request, project, isStale }) => (
                <div
                  key={request.id}
                  className="rounded-tile border-line flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
                >
                  <div className="min-w-0">
                    {project ? (
                      <Link
                        href={`/projects/${project.slug}`}
                        className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                      >
                        {project.name}
                      </Link>
                    ) : null}
                    <p className="text-ink-muted mt-0.5 text-sm">
                      Asked{" "}
                      {new Date(request.requestedAt).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                        }
                      )}
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
            <span className="text-ink-muted text-sm">
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
                    className="text-cardinal-600 hover:text-cardinal-700 mb-1 block text-[13px] font-semibold"
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
              <h2 className="text-ink mt-2 text-2xl font-bold">
                {currentUpdate.inSession
                  ? due.heading
                  : "Nothing due right now"}
              </h2>
              {/*
                Saying WHY matters. A page that just shows no obligation reads
                as broken; "no check-ins during Winter break" reads as the club
                working as intended. Same reasoning as the academic pause.
              */}
              <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
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
                message="You're not on any projects yet, so there's nothing project-specific to report."
                actionLabel="Find something to join"
                actionHref="/find-work"
              />
            ) : (
              currentUpdate.sections.map(({ entry, project, breadcrumb }) => (
                <div
                  key={entry.id}
                  className="rounded-tile border-line border px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Breadcrumb trail={breadcrumb} className="mb-1" />
                      <Link
                        href={`/projects/${project.slug}`}
                        className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                      >
                        {project.name}
                      </Link>
                    </div>
                    <span className="text-ink-soft flex shrink-0 items-center gap-1.5 text-sm font-semibold">
                      <Clock className="size-3.5" />
                      {formatNumber(entry.hours, 1)} hrs
                    </span>
                  </div>

                  <div className="rounded-tile border-line mt-3 border border-dashed px-3.5 py-3">
                    <p className="text-ink-muted text-sm">
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
                dueLabel={due.phrase}
                readerName={myLead?.preferredName ?? myLead?.fullName}
              />
              <ButtonLink href="/updates" variant="secondary">
                Past check-ins
              </ButtonLink>
            </div>
          ) : null}

          <p className="text-ink-muted mt-4 text-sm">
            Heads-down on academics?{" "}
            <Link
              href="/settings"
              className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
            >
              Pause your check-ins
            </Link>{" "}
            — it doesn&apos;t count against you, and there&apos;s no backlog
            when you come back.
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
              className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
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
          ) : liveProjects.length === 0 ? (
            <EmptyState
              className="mt-5 py-8"
              message="Everything you're on is finished. Nice — now find the next thing."
              actionLabel="Find work"
              actionHref="/find-work"
            />
          ) : (
            <div className="mt-5 space-y-3">
              {liveProjects.map((card) => (
                <MyProjectCard key={card.project.id} card={card} />
              ))}
            </div>
          )}

          {/*
            Finished projects last, behind a toggle — the same rule as
            /projects. What you're working on is what this page is for; what
            you finished is a record, and mixed together the record wins on
            volume as the year goes on.
          */}
          {finishedProjects.length > 0 ? (
            <CompletedProjectsSection count={finishedProjects.length}>
              <div className="mt-3 space-y-3">
                {finishedProjects.map((card) => (
                  <MyProjectCard key={card.project.id} card={card} />
                ))}
              </div>
            </CompletedProjectsSection>
          ) : null}
        </CardBody>
      </Card>

      {/* ---------------- Following ---------------- */}
      {following.length > 0 ? (
        <Card>
          <CardBody>
            <SectionLabel>Following</SectionLabel>
            <p className="text-ink-soft mt-2 text-sm">
              Watching only — no deliverables, no update obligations.
            </p>
            <div className="mt-4 space-y-2.5">
              {following.map(({ project, breadcrumb }) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.slug}`}
                  className="rounded-tile border-line hover:bg-surface block border px-4 py-3 transition-colors"
                >
                  <Breadcrumb trail={breadcrumb} className="mb-1" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-ink flex items-center gap-2 text-[15px] font-bold">
                      <Eye className="text-ink-muted size-3.5" />
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

/**
 * One committed project, as it appears on My Work.
 *
 * Extracted so the same card can render in both the live list and the
 * completed section without a hundred lines of duplicate JSX. A plain function
 * component, not a client one — nothing here is interactive.
 */
function MyProjectCard({ card }: { card: MyProjectCardData }) {
  const {
    project,
    membership,
    breadcrumb,
    res,
    hoursLogged,
    myDeliverables: mine,
    overdueCount,
    progress,
    lastUpdate,
  } = card;

  return (
    <div className="rounded-tile border-line border px-4 py-4">
      <Breadcrumb trail={breadcrumb} className="mb-1.5" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <Link
          href={`/projects/${project.slug}`}
          className="text-ink hover:text-cardinal-600 text-[17px] font-bold"
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
        <ProgressBar fraction={progress.fraction} className="mt-3" />
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
      ) : project.phase === "complete" ? null : (
        <p className="text-ink-muted mt-3 text-sm">
          Nothing assigned to you here yet — ask the RE what needs picking up.
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

      <div className="text-ink-muted mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5" />
          {formatNumber(hoursLogged, 1)} hrs logged
        </span>
        {/*
          Days, right beside the hours. The two together answer "how much have
          I put in, and how long have I got" — which the target date alone
          never did, because a date needs arithmetic before it means anything.
        */}
        <DueCountdown
          daysLeft={card.daysToTarget}
          done={project.phase === "complete"}
        />
        {project.timeCommitment ? <span>{project.timeCommitment}</span> : null}
      </div>

      {lastUpdate ? (
        <div className="rounded-tile bg-surface mt-3.5 px-3.5 py-3">
          <SectionLabel tone="muted">Your last update here</SectionLabel>
          <p className="text-ink-soft mt-1.5 text-sm">
            {lastUpdate.entry.progress}
          </p>
          {lastUpdate.entry.blockers ? (
            <p className="text-ink-soft mt-2 flex items-start gap-1.5 text-sm">
              <TriangleAlert className="text-cardinal-600 mt-0.5 size-3.5 shrink-0" />
              <span className="font-medium">{lastUpdate.entry.blockers}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
