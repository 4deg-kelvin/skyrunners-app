import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { LogWorkForm } from "@/components/forms/log-work-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardDivider } from "@/components/ui/card";
import { VerifyControls } from "@/components/forms/training-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { DetailRow, StatTile } from "@/components/ui/stat-tile";
import { getDashboard } from "@/lib/data/dashboard";
import { getViewer } from "@/lib/data/viewer";
import { can } from "@/lib/permissions";
import { formatDay } from "@/lib/dates";
import { RequestDecision } from "@/components/forms/request-decision";

export default async function DashboardPage() {
  const viewer = await getViewer();
  const view = await getDashboard(viewer.actor, viewer.graph);
  const {
    counts,
    club,
    flaggedProjects,
    completions,
    deadlinesMoved,
    reQueue,
    goneQuiet,
    trainings,
    requests,
  } = view;

  /**
   * The gate. Hiding the nav link is not access control — this route is
   * reachable by URL.
   *
   * Keyed on being a PL of something rather than on overseeing somebody, since
   * 2026-08-24. Sends them to /my-work rather than showing a 403: for a plain
   * member this isn't a permissions error to understand, it's a page that was
   * never meant for them, and their own work is where they were going anyway.
   */
  if (!can.viewLeadershipDashboard(viewer.actor, !view.isREofNothing)) {
    redirect("/my-work");
  }

  const mayLogWork = can.logOwnWork(viewer.actor, viewer.member.id);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Lead Portal"
        title="Dashboard"
        description="What you owe as a PL: work to sign off, requests to answer, projects that have gone quiet. Your projects only — about fifteen minutes a week."
        action={
          mayLogWork ? (
            <LogWorkForm
              projects={view.myProjects}
              defaultProjectId={view.myProjects[0]?.id}
              today={view.today}
              maxBackdateDays={view.maxBackdateDays}
              recent={view.recentWork}
            />
          ) : undefined
        }
      />

      {/*
        The one setup step whose absence has no other symptom.

        Everything else missing is obvious — no divisions, no projects, an
        empty roster. A missing academic calendar just means check-ins silently
        never generate, which looks like "nobody has written one yet" rather
        than "the feature is off".
      */}
      {!view.hasAcademicCalendar ? (
        <Card className="border-warn-fg/40 bg-warn-bg/40">
          <CardBody>
            <div className="flex flex-wrap items-start gap-3">
              <TriangleAlert className="text-warn-fg mt-0.5 size-5 shrink-0" />
              <div className="min-w-0">
                <p className="text-ink text-[15px] font-bold">
                  No academic calendar yet, so no check-ins are being asked for
                </p>
                <p className="text-ink-soft mt-1 max-w-2xl text-[15px]">
                  Check-ins only generate inside a term the club has entered.
                  Until one covers today nobody is prompted, your review queue
                  stays empty, and reliability doesn&apos;t count. Everything
                  else works normally.
                </p>
                <Link
                  href="/settings"
                  className="text-cardinal-600 hover:text-cardinal-700 mt-2 inline-block text-sm font-bold"
                >
                  Add this quarter in Settings →
                </Link>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* ---------------- Left: team summary ---------------- */}
        <Card className="h-fit">
          <CardBody>
            <SectionLabel>Team Summary</SectionLabel>

            <div className="mt-5 flex items-center gap-4">
              <div className="rounded-tile bg-cardinal-50 text-cardinal-600 flex size-[72px] shrink-0 items-center justify-center text-2xl font-bold">
                SR
              </div>
              <p className="text-ink text-xl font-bold">{club.name}</p>
            </div>

            <div className="mt-5">
              <CardDivider />
              <DetailRow label="Description">{club.description}</DetailRow>
              <CardDivider />
              <DetailRow label="People on your projects">
                {counts.peopleOnMyProjects}
              </DetailRow>
              <CardDivider />
              <DetailRow label="Divisions">{counts.divisions}</DetailRow>
              <CardDivider />
              <DetailRow label="Active projects">{counts.projects}</DetailRow>
              {/*
                "Date created" and "Annual cycle" used to sit here and in the
                stat row. Both came from a hard-coded literal in
                `lib/mock-data.ts` — so real leadership was being shown an
                invented founding date for a club that has existed for years,
                and a cycle string that would go stale and then contradict the
                academic calendar, which is the actual source of "what period
                are we in". Nothing read either value. Small wrongness on the
                leadership page is how people learn to distrust the numbers
                next to it.
              */}
            </div>
          </CardBody>
        </Card>

        {/* ---------------- Right: operations ---------------- */}
        <div className="space-y-6">
          <Card>
            <CardBody>
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <SectionLabel>Operations</SectionLabel>
                  <h2 className="text-ink mt-2 text-2xl font-bold">
                    What you owe
                  </h2>
                  {/*
                    There was a Co-Lead "My reports · Whole club" toggle here. It
                    widened one thing — whose check-ins counted toward your
                    reading obligation — and that obligation is gone. A Co-Lead
                    is already a top PL everywhere, so both settings now render
                    the same page.
                  */}
                  <p className="text-ink-soft mt-2 text-[15px]">
                    Work waiting on you, and which projects need a hand.
                  </p>
                </div>
              </div>

              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                {/*
                  A COUNT of log entries, not a sum of hours.

                  Its job is answering "is my part of the club actually logging
                  anything?" — a liveness reading. Deliberately not divided by
                  headcount and never broken down per person: that would be the
                  hours signal again in a new unit, which is the trap named in
                  `lib/delivered.ts`.
                */}
                <StatTile
                  label="Log entries this week"
                  value={view.logsThisWeek}
                />
                <StatTile
                  label="Waiting on your sign-off"
                  value={reQueue.signOffs.length}
                />
              </div>
            </CardBody>
          </Card>

          {/*
            What you owe as a PL.

            Since check-ins went there is only one queue here, and it is this
            one: work somebody marked done that nobody has confirmed. It is
            deliberately not a reading queue - a PL reads their project's feed,
            which is a page they already have a reason to open.
          */}
          {reQueue.signOffs.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Waiting On You As PL</SectionLabel>
                <p className="text-ink-soft mt-2 text-[15px]">
                  Not your reading queue — this is work on your projects that
                  can&apos;t move until you answer.
                </p>

                <div className="mt-4 space-y-2.5">
                  {reQueue.signOffs.map(
                    ({ deliverable, owner, ageDays, escalated }) => (
                      <div
                        key={deliverable.id}
                        className={`rounded-tile border px-4 py-3 ${
                          escalated
                            ? "border-warn-fg/30 bg-warn-bg/40"
                            : "border-line"
                        }`}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="text-ink text-[15px] font-bold">
                            {deliverable.title}
                          </span>
                          <span className="text-ink-muted text-sm">
                            {ageDays === 0 ? "today" : `${ageDays}d waiting`}
                          </span>
                        </div>
                        <p className="text-ink-soft mt-1 text-sm">
                          {owner?.fullName ?? "Someone"} marked this done — it
                          doesn&apos;t count until you confirm it.
                        </p>
                      </div>
                    )
                  )}
                </div>

                <p className="text-ink-muted mt-4 text-sm">
                  Answer these on the project page — the reply lands in its
                  update feed where everyone can see it.
                </p>
              </CardBody>
            </Card>
          ) : null}

          {/*
            Trainings waiting on you, and clearances that lapsed.

            This IS the notification for an expiry — there's no email, per the
            standing decision that only join requests and review escalations
            send one. So it has to be somewhere a Lead already looks, not a
            page they'd have to remember to open.
          */}
          {/*
            Requests addressed to this person by name.

            Above the trainings queue because somebody is blocked on it right
            now — they can't open the file they need — where a training
            verification is confirming something that already happened. Both
            are "waiting on you"; only one of them is stopping work today.
          */}
          {requests.length > 0 ? (
            <Card>
              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>Requests To Answer</SectionLabel>
                  <span className="text-ink-muted text-sm">
                    {requests.length} waiting
                  </span>
                </div>
                <p className="text-ink-soft mt-2 text-sm">
                  Somebody asked you for something by name. Granting is one
                  press; declining asks for a line, because a bare no is what
                  stops people asking next time.
                </p>

                <div className="mt-4 space-y-2.5">
                  {requests.map(({ request, asker, ageDays, onBehalf }) => (
                    <div
                      key={request.id}
                      className={`rounded-tile border px-4 py-3.5 ${
                        ageDays >= 5
                          ? "border-risk-fg/30 bg-risk-bg"
                          : "border-line"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/members/${request.memberId}`}
                            className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                          >
                            {asker?.fullName ?? "Unknown member"}
                          </Link>
                          {/*
                            Age, not a date. "6 days" is the thing that makes a
                            queue actionable; a timestamp is something you have
                            to do arithmetic on.
                          */}
                          <span className="text-ink-muted ml-2 text-sm">
                            {ageDays === 0
                              ? "today"
                              : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}
                          </span>
                        </div>
                        {onBehalf ? (
                          <Badge tone="neutral">Asked someone else</Badge>
                        ) : null}
                      </div>

                      <p className="text-ink-soft mt-2 text-sm">
                        &ldquo;{request.body}&rdquo;
                      </p>

                      <RequestDecision
                        requestId={request.id}
                        askerName={asker?.fullName ?? "They"}
                      />
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {trainings.pending.length + trainings.expired.length > 0 ? (
            <Card>
              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>Trainings To Verify</SectionLabel>
                  {/*
                    The catalogue moved to Settings when `/trainings` was
                    removed — a club-wide list belongs next to the academic
                    calendar, not on a page about one person's record.
                  */}
                  <Link
                    href="/settings"
                    className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
                  >
                    Edit the catalogue
                  </Link>
                </div>

                {trainings.pending.length > 0 ? (
                  <div className="mt-4 space-y-2.5">
                    {trainings.pending.map(
                      ({ record, member, item, sectionName }) => (
                        <div
                          key={record.id}
                          className="rounded-tile border-line flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
                        >
                          <div className="min-w-0">
                            <Link
                              href={`/members/${member.id}`}
                              className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                            >
                              {member.fullName}
                            </Link>
                            <p className="text-ink-muted mt-0.5 text-sm">
                              {item?.name ?? "A training"}
                              {sectionName ? ` · ${sectionName}` : ""}
                            </p>
                          </div>
                          <VerifyControls
                            certificationId={record.id}
                            memberId={member.id}
                            memberName={member.fullName}
                          />
                        </div>
                      )
                    )}
                  </div>
                ) : null}

                {trainings.expired.length > 0 ? (
                  <div className="rounded-tile border-risk-fg/25 bg-risk-bg mt-4 border px-4 py-3">
                    <p className="text-risk-fg flex items-start gap-2 text-sm">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                      <span>
                        <span className="font-semibold">
                          {trainings.expired.length} clearance
                          {trainings.expired.length === 1
                            ? " has"
                            : "s have"}{" "}
                          lapsed:
                        </span>{" "}
                        {trainings.expired
                          .map(
                            (t) =>
                              `${t.member.fullName} — ${t.item?.name ?? "a training"}`
                          )
                          .join("; ")}
                        . They&apos;re no longer cleared until it&apos;s redone.
                      </span>
                    </p>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {/*
            Where "notify up the chain" arrives.

            A notice written only into the project's own feed reaches nobody —
            the people it's for have no reason to open that page. This is the
            other half of the announcement, and it's the good news panel: the
            rest of this column is what's going wrong.

            Non-empty only, same as the escalations above it. A standing
            "0 completed" tile teaches you to skip the column.
          */}
          {completions.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Finished Recently</SectionLabel>
                <p className="text-ink-soft mt-2 text-[15px]">
                  Projects below you that were marked complete. You were told
                  because you&apos;re above them in the chain.
                </p>

                <div className="mt-4 space-y-2.5">
                  {completions.map(({ notice, project, ageDays }) => (
                    <div
                      key={notice.id}
                      className="rounded-tile border-ok-fg/25 bg-ok-bg border px-4 py-3.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        {project ? (
                          <Link
                            href={`/projects/${project.slug}`}
                            className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                          >
                            {project.name}
                          </Link>
                        ) : (
                          <span className="text-ink-muted text-[15px] font-bold">
                            A project that has since been removed
                          </span>
                        )}
                        <span className="text-ink-muted text-sm">
                          {ageDays === 0
                            ? "today"
                            : `${ageDays} ${ageDays === 1 ? "day" : "days"} ago`}
                        </span>
                      </div>
                      <p className="text-ink-soft mt-1.5 text-sm">
                        {notice.body}
                      </p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {/*
            Projects that have gone quiet.

            The one section here that is NEW rather than surviving. It replaces a
            per-person flag that lived on the dashboard of whoever a member
            reported to, and it is the mitigation for the reporting removal's
            real cost: the chain's actual function was that somebody was NAMED as
            responsible for noticing silence.

            Addressed to the PL, which is why it belongs on this page and not on
            the project. A PL who opens their project sees the feed and can tell
            it is quiet; the whole problem is that they have no reason to open a
            project nothing is happening on.

            Non-empty only, like every other card in this column. Three weeks is
            the threshold — see QUIET_AFTER_DAYS for why one week fires on half
            the club every finals week.
          */}
          {goneQuiet.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Gone Quiet</SectionLabel>
                <p className="text-ink-soft mt-2 text-[15px]">
                  Nothing logged on these in three weeks, and they still have
                  open work. Usually it&apos;s midterms; sometimes somebody is
                  stuck and hasn&apos;t said so.
                </p>

                <div className="mt-4 space-y-2.5">
                  {goneQuiet.map((q) => (
                    <div
                      key={q.project.id}
                      className="rounded-tile border-line flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${q.project.slug}`}
                          className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                        >
                          {q.project.name}
                        </Link>
                        <p className="text-ink-muted mt-0.5 text-sm">
                          {q.openDeliverables}{" "}
                          {q.openDeliverables === 1
                            ? "deliverable"
                            : "deliverables"}{" "}
                          open · {q.committedCount}{" "}
                          {q.committedCount === 1 ? "person" : "people"} on it
                        </p>
                      </div>
                      <span className="text-ink-muted shrink-0 text-sm font-semibold">
                        {q.lastLoggedAt
                          ? `last logged ${formatDay(q.lastLoggedAt, {
                              month: "short",
                              day: "numeric",
                            })}`
                          : "never logged"}
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-ink-muted mt-4 text-sm">
                  A message usually fixes it. The project page has everyone on
                  it and how to reach them.
                </p>
              </CardBody>
            </Card>
          ) : null}

          {/*
            Deadlines that moved under this person.

            A separate card from "Finished Recently" rather than a wider filter on
            it. That one is green — a completion is good news — and a slip is not,
            so merging them would either colour a slip as an achievement or drain
            the colour out of a real completion. Amber, the tone this app already
            uses for "keep an eye on this".

            Only pushes arrive here. `changeProjectDeadline` writes no notice when
            a date is pulled IN, because a notification about good news trains
            people to ignore the notification.
          */}
          {deadlinesMoved.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Deadlines Moved</SectionLabel>
                <p className="text-ink-soft mt-2 text-[15px]">
                  Projects below you whose target date was pushed out. You were
                  told because you&apos;re above them in the chain — the old
                  date is still on the project&apos;s timeline.
                </p>

                <div className="mt-4 space-y-2.5">
                  {deadlinesMoved.map(({ notice, project, ageDays }) => (
                    <div
                      key={notice.id}
                      className="rounded-tile border-warn-fg/25 bg-warn-bg border px-4 py-3.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        {project ? (
                          <Link
                            href={`/projects/${project.slug}`}
                            className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                          >
                            {project.name}
                          </Link>
                        ) : (
                          <span className="text-ink-muted text-[15px] font-bold">
                            A project that has since been removed
                          </span>
                        )}
                        <span className="text-ink-muted text-sm">
                          {ageDays === 0
                            ? "today"
                            : `${ageDays} ${ageDays === 1 ? "day" : "days"} ago`}
                        </span>
                      </div>
                      <p className="text-ink-soft mt-1.5 text-sm">
                        {notice.body}
                      </p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {/* Projects needing attention */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between gap-4">
                <SectionLabel>Needs Attention</SectionLabel>
                <Link
                  href="/projects"
                  className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
                >
                  All projects
                </Link>
              </div>

              <div className="mt-4 space-y-3">
                {flaggedProjects.length === 0 ? (
                  <EmptyState
                    message="Every project is on track."
                    actionLabel="Browse projects"
                    actionHref="/projects"
                  />
                ) : (
                  flaggedProjects.map(({ project, res }) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.slug}`}
                      className="rounded-tile border-line hover:bg-surface block border px-4 py-3.5 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-ink text-[15px] font-bold">
                          {project.name}
                        </p>
                        <ProjectBadges project={project} />
                      </div>
                      <p className="text-ink-soft mt-1.5 text-sm">
                        {res.length > 1 ? "PLs" : "PL"}:{" "}
                        {res.map((r) => r.fullName).join(", ") || "unassigned"}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
