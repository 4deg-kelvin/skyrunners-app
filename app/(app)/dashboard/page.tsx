import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { LogWorkForm } from "@/components/forms/log-work-form";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDivider } from "@/components/ui/card";
import { ContactLink } from "@/components/ui/contact-link";
import { VerifyControls } from "@/components/forms/training-actions";
import { Donut } from "@/components/ui/donut";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { FieldLabel, SectionLabel } from "@/components/ui/section-label";
import { DetailRow, StatTile } from "@/components/ui/stat-tile";
import { getDashboard } from "@/lib/data/dashboard";
import { getViewer } from "@/lib/data/viewer";
import { UPDATE_STATUS_LABELS, UPDATE_STATUS_TONES } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { RequestDecision } from "@/components/forms/request-decision";
import { MarkReviewedButton } from "@/components/forms/review-actions";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope: scopeParam } = await searchParams;
  const scope = scopeParam === "club" ? "club" : "mine";
  const viewer = await getViewer();
  const view = await getDashboard(viewer.actor, viewer.graph, scope);
  const {
    compliance,
    counts,
    club,
    reviewQueue,
    escalations,
    flaggedProjects,
    completions,
    deadlinesMoved,
    reQueue,
    goneQuiet,
    rollUp,
    trainings,
    requests,
  } = view;

  /**
   * The gate. Hiding the nav link is not access control — this route was
   * reachable by URL and renders other people's hours and review queue.
   *
   * Sends them to /my-work rather than showing a 403: for a plain member this
   * isn't a permissions error to understand, it's a page that was never meant
   * for them, and their own work is where they were going anyway.
   */
  if (!can.viewLeadershipDashboard(viewer.actor, !view.isLeadOfNobody)) {
    redirect("/my-work");
  }

  const mayLogWork = can.logOwnWork(viewer.actor, viewer.member.id);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Lead Portal"
        title="Dashboard"
        description="What you owe as a Lead: check-ins waiting on you, work waiting on a sign-off, and anyone who has gone quiet. Scoped to your people — about fifteen minutes a week."
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
                  Until one covers today, nobody is prompted to write one,
                  nothing shows in your review queue, and reliability
                  doesn&apos;t start counting. Everything else — the work log,
                  projects, deliverables — works normally.
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
              <DetailRow label="People you oversee">
                {counts.peopleOverseen}
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
                  <div className="flex flex-wrap items-center gap-3">
                    <SectionLabel>Operations</SectionLabel>
                    {/*
                      Co-Leads only. Scoped stays the default: the dashboard is
                      built around a 15-minute weekly obligation, and landing on
                      the whole club makes "what do I owe" unanswerable.
                    */}
                    {viewer.actor.globalRole === "co_lead" ? (
                      <div className="flex items-center gap-1 text-sm">
                        <Link
                          href="/dashboard"
                          className={
                            scope === "mine"
                              ? "text-cardinal-600 font-bold"
                              : "text-ink-muted hover:text-ink font-semibold"
                          }
                        >
                          My reports
                        </Link>
                        <span className="text-ink-muted">·</span>
                        <Link
                          href="/dashboard?scope=club"
                          className={
                            scope === "club"
                              ? "text-cardinal-600 font-bold"
                              : "text-ink-muted hover:text-ink font-semibold"
                          }
                        >
                          Whole club
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  <h2 className="text-ink mt-2 text-2xl font-bold">
                    Cycle summary
                  </h2>
                  <p className="text-ink-soft mt-2 text-[15px]">
                    {scope === "club"
                      ? "Who has checked in, how the effort is spread, and which projects need a hand — across the whole club."
                      : `Who has checked in, how the effort is spread, and which projects need a hand — for you and the ${counts.peopleOverseen} ${counts.peopleOverseen === 1 ? "person" : "people"} you oversee, not the whole club.`}
                  </p>
                </div>
                <Donut
                  fraction={compliance.fraction}
                  label="on time"
                  size={132}
                />
              </div>

              <div className="mt-7 grid gap-4 sm:grid-cols-3">
                {/*
                  A COUNT of log entries, not a sum of hours.

                  Its job is answering "is my part of the club actually logging
                  anything?" — a liveness reading. Deliberately not divided by
                  headcount and never broken down per person: that would be the
                  hours signal again in a new unit, which is the trap named in
                  `lib/contribution.ts`.
                */}
                <StatTile
                  label="Log entries this week"
                  value={view.logsThisWeek}
                />
                <StatTile
                  label="Updates awaiting review"
                  value={reviewQueue.length}
                />
              </div>
            </CardBody>
          </Card>

          {/*
            Escalations — Leads under you who are leaving people unheard.
            Rendered only when non-empty: a permanent "0 escalations" panel is
            noise that trains you to skip the whole column.

            Reports on LEADS, not on updates. "Marcus has 2 people waiting,
            oldest 5 days" is one conversation; a list of thirty unread reports
            is a spreadsheet.
          */}
          {escalations.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Not Being Read</SectionLabel>
                <p className="text-ink-soft mt-2 text-[15px]">
                  These Leads have check-ins they haven&apos;t read. A report
                  nobody reads is worse than no report — the member spent effort
                  on it.
                </p>

                <div className="mt-4 space-y-3">
                  {escalations.map(({ lead, overdue, worstAgeDays }) => (
                    <div
                      key={lead.id}
                      className="rounded-tile border-warn-fg/30 bg-warn-bg/40 border px-4 py-3.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <Link
                          href={`/members/${lead.id}`}
                          className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                        >
                          {lead.fullName}
                        </Link>
                        <span className="text-warn-fg text-sm font-semibold">
                          oldest waiting {worstAgeDays}{" "}
                          {worstAgeDays === 1 ? "day" : "days"}
                        </span>
                      </div>
                      <p className="text-ink-soft mt-1.5 text-sm">
                        {overdue.length}{" "}
                        {overdue.length === 1 ? "person" : "people"} waiting:{" "}
                        {overdue
                          .map((r) => r.author?.fullName ?? "someone")
                          .join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {/*
            The RE half of what you owe, kept separate from the Lead half above.

            Two obligations belonging to two different roles: a Lead reads a
            person's check-in, an RE answers a project's section and signs off
            its work. Merging them would tell somebody who is both that they
            owe "seven things" without saying which hat they're wearing.
          */}
          {reQueue.signOffs.length + reQueue.unanswered.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Waiting On You As RE</SectionLabel>
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

                  {reQueue.unanswered.map(
                    ({ entry, author, ageDays, escalated }) => (
                      <div
                        key={entry.id}
                        className={`rounded-tile border px-4 py-3 ${
                          escalated
                            ? "border-warn-fg/30 bg-warn-bg/40"
                            : "border-line"
                        }`}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="text-ink text-[15px] font-bold">
                            {author?.fullName ?? "Someone"} is waiting on an
                            answer
                          </span>
                          <span className="text-ink-muted text-sm">
                            {ageDays === 0 ? "today" : `${ageDays}d waiting`}
                          </span>
                        </div>
                        <p className="text-ink-soft mt-1 text-sm">
                          {entry.blockers || entry.nextSteps}
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
            Who has gone quiet.

            Not a missed check-in — that's already visible and already
            escalates. This is the person who simply stopped, which nothing
            reported and which is what the club actually loses people to.
            Deliberately framed as a prompt, not a flag on anybody's record.
          */}
          {goneQuiet.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Gone Quiet</SectionLabel>
                <p className="text-ink-soft mt-2 text-[15px]">
                  No hours logged this week, but still holding open work. Worth
                  a message — usually it&apos;s midterms, sometimes it&apos;s
                  being stuck and not saying so.
                </p>

                <div className="mt-4 space-y-2.5">
                  {goneQuiet.map(
                    ({ member, openDeliverables, lastLoggedAt }) => (
                      <div
                        key={member.id}
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
                            {openDeliverables} open{" "}
                            {openDeliverables === 1
                              ? "deliverable"
                              : "deliverables"}
                            {lastLoggedAt
                              ? ` · last logged ${new Date(
                                  `${lastLoggedAt}T00:00:00Z`
                                ).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  timeZone: "UTC",
                                })}`
                              : " · has never logged hours"}
                          </p>
                        </div>
                        <ContactLink member={member} showLabel={false} />
                      </div>
                    )
                  )}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {/*
            The roll-up, derived rather than composed.

            "Roll-ups from Leads to Co-Leads" was on the phase list as a thing
            a Lead writes. A report somebody types by hand is a chore that gets
            skipped in week three, and every number in it already exists — the
            scarce resource is leadership READING, not leadership typing.
          */}
          {rollUp.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Roll-Up</SectionLabel>
                <p className="text-ink-soft mt-2 text-[15px]">
                  Every Lead and how their people are doing this week. Sorted by
                  who has somebody waiting longest.
                </p>

                <div className="mt-4 space-y-2.5">
                  {rollUp.map((row) => (
                    <div
                      key={row.lead.id}
                      className="rounded-tile border-line border px-4 py-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <Link
                          href={`/members/${row.lead.id}`}
                          className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                        >
                          {row.lead.fullName}
                        </Link>
                        {row.worstUnreadDays >= 3 ? (
                          <Badge tone="risk">
                            oldest unread {row.worstUnreadDays}d
                          </Badge>
                        ) : row.unread > 0 ? (
                          <Badge tone="warn">{row.unread} to read</Badge>
                        ) : (
                          <Badge tone="ok">Caught up</Badge>
                        )}
                      </div>
                      <p className="text-ink-muted mt-1 text-sm">
                        {row.reports} {row.reports === 1 ? "report" : "reports"}{" "}
                        · {row.logsThisWeek}{" "}
                        {row.logsThisWeek === 1 ? "log entry" : "log entries"}{" "}
                        this week
                        {row.quietCount > 0
                          ? ` · ${row.quietCount} gone quiet`
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
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

          <div className="grid gap-6 md:grid-cols-2">
            {/* Review queue */}
            <Card>
              <CardBody>
                <div className="flex items-center justify-between gap-4">
                  <SectionLabel>Needs Review</SectionLabel>
                  <Link
                    href="/updates"
                    className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
                  >
                    All updates
                  </Link>
                </div>

                <div className="mt-4 space-y-3">
                  {reviewQueue.length === 0 ? (
                    <EmptyState
                      message="Nothing waiting on you."
                      actionLabel="View all updates"
                      actionHref="/updates"
                    />
                  ) : (
                    reviewQueue.map(
                      ({ update, author, sections, ageDays, escalated }) => (
                        <div
                          key={update.id}
                          className={
                            escalated
                              ? "rounded-tile border-cardinal-600 border px-4 py-3.5"
                              : "rounded-tile border-line border px-4 py-3.5"
                          }
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-ink text-[15px] font-bold">
                              {author?.fullName ?? "Unknown member"}
                              {/* Age, not a count. "12 unread" is ignorable;
                                "waiting 5 days" names a specific person kept
                                waiting, and is the same weight of problem
                                whether you lead three people or fifteen. */}
                              <span
                                className={
                                  escalated
                                    ? "text-cardinal-600 ml-2 text-sm font-semibold"
                                    : "text-ink-muted ml-2 text-sm font-normal"
                                }
                              >
                                {ageDays === 0
                                  ? "today"
                                  : `waiting ${ageDays} ${ageDays === 1 ? "day" : "days"}`}
                                {escalated ? " — your Lead can see this" : ""}
                              </span>
                            </p>
                            <Badge tone={UPDATE_STATUS_TONES[update.status]}>
                              {UPDATE_STATUS_LABELS[update.status]}
                            </Badge>
                          </div>

                          {/* One block per project, so it's always clear which
                            piece of work each note refers to. */}
                          <div className="mt-2.5 space-y-2.5">
                            {sections.map(({ entry, project }) => (
                              <div
                                key={entry.id}
                                className="border-line-soft border-l-2 pl-3"
                              >
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  {project ? (
                                    <Link
                                      href={`/projects/${project.slug}`}
                                      className="text-cardinal-600 hover:text-cardinal-700 text-[13px] font-semibold"
                                    >
                                      {project.name}
                                    </Link>
                                  ) : (
                                    <span className="text-ink-muted text-[13px] font-semibold">
                                      Unknown project
                                    </span>
                                  )}
                                </div>
                                <p className="text-ink-soft mt-1 line-clamp-2 text-sm">
                                  {entry.progress}
                                </p>
                                {entry.blockers ? (
                                  <p className="text-ink-soft mt-1.5 flex items-start gap-1.5 text-sm">
                                    <TriangleAlert className="text-cardinal-600 mt-0.5 size-3.5 shrink-0" />
                                    <span className="font-medium">
                                      {entry.blockers}
                                    </span>
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>

                          {/*
                            Clear it from here.

                            The button used to live only on /updates, which is
                            not in the nav — reachable solely through a link on
                            this page. So the dashboard showed you a queue with
                            an escalation clock on it and no way to act, and the
                            honest reaction was "how do I get rid of this?".

                            Reading the check-in is the obligation and the whole
                            check-in is right here; making somebody navigate to
                            press a button about what they just read is the kind
                            of friction that turns a 15-minute weekly job into a
                            skipped one.
                          */}
                          {author ? (
                            <div className="border-line-soft mt-3 border-t pt-3">
                              <MarkReviewedButton
                                updateId={update.id}
                                authorId={author.id}
                              />
                            </div>
                          ) : null}
                        </div>
                      )
                    )
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Update window */}
            <Card>
              <CardBody>
                <div className="flex items-center justify-between gap-4">
                  <SectionLabel>Update Window</SectionLabel>
                  <Badge tone="ok">Open now</Badge>
                </div>

                <h3 className="text-ink mt-4 text-[17px] font-bold">
                  Today&apos;s check-in
                </h3>
                <p className="text-ink-soft mt-1.5 text-sm">
                  Members submit twice a week on the days they choose. This
                  window closes at 11:59 PM.
                </p>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  <MiniStat
                    label="On time"
                    value={compliance.onTime}
                    tone="ok"
                  />
                  <MiniStat label="Late" value={compliance.late} tone="warn" />
                  <MiniStat
                    label="Missed"
                    value={compliance.missed}
                    tone="risk"
                  />
                </div>

                {compliance.pending > 0 ? (
                  <p className="text-ink-muted mt-3 text-sm">
                    {compliance.pending} not yet due — excluded from the
                    percentage.
                  </p>
                ) : null}

                <div className="mt-5">
                  <ButtonLink
                    href="/updates"
                    variant="secondary"
                    className="w-full"
                  >
                    Open review queue
                  </ButtonLink>
                </div>
              </CardBody>
            </Card>
          </div>

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
                        {res.length > 1 ? "REs" : "RE"}:{" "}
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

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "risk";
}) {
  const color =
    tone === "ok"
      ? "text-ok-fg"
      : tone === "warn"
        ? "text-warn-fg"
        : "text-risk-fg";

  return (
    <div className="rounded-tile border-line border px-3 py-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <FieldLabel className="mt-1 text-[12px] font-medium tracking-normal normal-case">
        {label}
      </FieldLabel>
    </div>
  );
}
