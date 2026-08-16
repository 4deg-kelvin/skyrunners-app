import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, Eye, PenLine, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ContactLink } from "@/components/ui/contact-link";
import { LogWorkForm } from "@/components/forms/log-work-form";
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
import { DeliverableTodos } from "@/components/forms/deliverable-todos";
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
import { can, isAdvisor } from "@/lib/permissions";
import { formatDay, todayInClubTime } from "@/lib/dates";

export default async function MyWorkPage() {
  const viewer = await getViewer();

  /*
    Advisors have no work of their own, so this page has nothing to show them.

    Not access control — nothing here is secret — but every section would be an
    empty state: no projects, no deliverables, no check-in, no work log, no
    contribution record. Redirected rather than merely hidden from the nav, for
    the same reason `/dashboard` redirects: `/` points here, so an advisor
    typing the club's URL would land on a page that looks broken before they
    have seen anything that works.
  */
  if (isAdvisor(viewer.actor)) redirect("/projects");

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

  const mayLogWork = can.logOwnWork(viewer.actor, me.id);
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
        description="What you own, what you owe, and what you've delivered."
        action={
          mayLogWork ? (
            <LogWorkForm
              projects={committed.map((c) => ({
                id: c.project.id,
                name: c.project.name,
              }))}
              defaultProjectId={committed[0]?.project.id}
              today={today}
              maxBackdateDays={maxBackdateDays}
              recent={view.recentWork}
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
                      Asked {formatDay(request.requestedAt)}
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
              myDeliverables.map(({ deliverable, project, todos }) => (
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
                    /*
                      Plain string compare against the PACIFIC day, and
                      `submitted` is not overdue — the same rule as
                      `isOverdue`. `new Date(dueDate) < new Date()` parsed the
                      bare date as UTC midnight, so work due today started
                      reading "Overdue" from 5pm the day before.
                    */
                    overdue={
                      deliverable.status !== "done" &&
                      deliverable.status !== "submitted" &&
                      !!deliverable.dueDate &&
                      deliverable.dueDate < today
                    }
                  />
                  {/*
                    Writable here, not just readable. This list is the owner's
                    working copy — everything on this page is theirs — and a
                    checklist you have to open another page to tick is a
                    checklist nobody keeps.
                  */}
                  <DeliverableTodos
                    deliverableId={deliverable.id}
                    projectId={project.id}
                    todos={todos}
                    canManage
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
                    picked. Each project&apos;s section is already written from
                    your work log — the only boxes left are for projects you
                    logged nothing against.
                  </>
                ) : (
                  <>
                    No check-ins are generated during{" "}
                    {currentUpdate.termName ?? "this period"} — nothing counts
                    against you and there&apos;s no backlog waiting. You can
                    still log work and write one if you want to.
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
                actionHref="/projects"
              />
            ) : (
              currentUpdate.sections.map(
                ({
                  entry,
                  project,
                  breadcrumb,
                  draftProgress,
                  loggedWork,
                  needsWriting,
                }) => (
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
                      {/*
                      Says where this section's text came from, or that it needs
                      writing. The preview is the only place a member sees the
                      draft before opening the composer, so "already done for
                      you" has to be legible from here or they won't open it.
                    */}
                      {needsWriting ? (
                        <span className="text-ink-muted flex shrink-0 items-center gap-1.5 text-sm font-semibold">
                          <PenLine className="size-3.5" />
                          Needs a line
                        </span>
                      ) : (
                        <span className="text-ink-soft flex shrink-0 items-center gap-1.5 text-sm font-semibold">
                          <Clock className="size-3.5" />
                          {loggedWork.length === 1
                            ? "1 log entry"
                            : loggedWork.length + " log entries"}
                        </span>
                      )}
                    </div>

                    <div className="rounded-tile border-line mt-3 border border-dashed px-3.5 py-3">
                      {/*
                      `whitespace-pre-line`, because the draft is newline-joined
                      — one line per log entry. Without it a week of work renders
                      as one run-on paragraph and the diary reads as a blob.
                    */}
                      <p className="text-ink-muted text-sm whitespace-pre-line">
                        {draftProgress ||
                          "Nothing logged against this project — write a line in the composer below."}
                      </p>
                    </div>
                  </div>
                )
              )
            )}
          </div>

          {maySubmitUpdate ? (
            <div className="mt-5 flex flex-wrap items-start gap-3">
              <CheckInForm
                sections={currentUpdate.sections.map((s) => ({
                  projectId: s.project.id,
                  projectName: s.project.name,
                  draftProgress: s.draftProgress,
                  loggedCount: s.loggedWork.length,
                  needsWriting: s.needsWriting,
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
              /*
                the top of Projects, not the raw tree.

                Projects ranks by where a member would actually help —
                unstaffed and stuck first — which is the whole reason it
                exists. The tree is sorted by org structure, so it puts a
                newcomer in front of a hierarchy rather than an opportunity.
              */
              message="You're not on a project yet. Projects ranks everything by where you'd help most — pick one and ask to join."
              actionLabel="Find something to work on"
              actionHref="/projects"
            />
          ) : liveProjects.length === 0 ? (
            <EmptyState
              className="mt-5 py-8"
              message="Everything you're on is finished. Nice — now find the next thing."
              actionLabel="Find work"
              actionHref="/projects"
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
    daysWorked,
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
                  d.status !== "submitted" &&
                  !!d.dueDate &&
                  d.dueDate < todayInClubTime()
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
          {/* Name AND number: nothing else on this row says who the RE is. */}
          {res.map((re) => (
            <ContactLink key={re.id} member={re} />
          ))}
        </div>
      ) : null}

      <div className="text-ink-muted mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        {/*
          Days WORKED, not hours logged. Answers "have I actually been touching
          this?" — which is the honest question a diary can answer — and sits
          beside the countdown so the pair reads as "I've been on it four days,
          and there are nine left".
        */}
        {daysWorked > 0 ? (
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {daysWorked === 1 ? "1 day worked" : daysWorked + " days worked"}
          </span>
        ) : null}
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
