import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Lock } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ContactLink } from "@/components/ui/contact-link";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardBody, CardDivider } from "@/components/ui/card";
import { ContributionPanel } from "@/components/ui/contribution-panel";
import { DeliverableRow } from "@/components/ui/deliverable-row";
import { DueCountdown } from "@/components/ui/due-countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { DetailRow } from "@/components/ui/stat-tile";
import { TrainingRecord } from "@/components/ui/training-record";
import { CompletedProjectsSection } from "@/components/ui/completed-filter";
import { ActionButton } from "@/components/forms/action-form";
import { ReopenButton } from "@/components/forms/help-request-actions";
import { deleteCheckInAction } from "@/lib/actions";
import { getResolvedAsksFor } from "@/lib/data/blockers";
import { getMemberProfile, type MemberProjectRow } from "@/lib/data/members";
import { getTrainings } from "@/lib/data/trainings";
import { getViewer } from "@/lib/data/viewer";
import { ROLE_LABELS, ROLE_TONES } from "@/lib/labels";
import { can, isCoLead } from "@/lib/permissions";
import { formatNumber } from "@/lib/utils";
import { formatDay, todayInClubTime } from "@/lib/dates";

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();

  // Decide visibility BEFORE fetching, so restricted numbers are never loaded
  // into a page that isn't allowed to show them.
  const canViewEffort = can.viewMemberEffort(viewer.actor, viewer.graph, id);
  const [view, trainings, resolvedAsks] = await Promise.all([
    getMemberProfile(id, canViewEffort),
    getTrainings(id),
    // Asks they posted that got sorted. Public, like the trainings below it —
    // the note on HOW it got sorted is the useful half, and it's how the next
    // person with the same problem finds the answer without asking again.
    getResolvedAsksFor(id, viewer.actor),
  ]);

  if (!view) notFound();

  const { member, lead, directReports, projects, contribution, checkIns } =
    view;
  /*
    Live work first, finished work behind a toggle at the end.

    A member two years in has more completed projects than live ones, and the
    live ones are the reason anybody opens this page.
  */
  const liveProjects = projects.filter((p) => p.project.phase !== "complete");
  const finishedProjects = projects.filter(
    (p) => p.project.phase === "complete"
  );

  const isOwnProfile = viewer.member.id === member.id;
  const canDeleteCheckIns = can.deleteCheckIn(viewer.actor, member.id);
  // Their Lead chain or a Co-Lead. Never themselves — the operation refuses
  // that too, because this is a safety record and one check isn't enough.
  const canVerifyTrainings = can.verifyTraining(
    viewer.actor,
    viewer.graph,
    member.id
  );

  return (
    <div className="space-y-6">
      <PageHeader
        label="Member Profile"
        title={member.fullName}
        description={
          member.major
            ? `${member.major}${member.classYear ? ` · Class of ${member.classYear}` : ""}`
            : undefined
        }
        action={
          member.globalRole !== "member" ? (
            <Badge tone={ROLE_TONES[member.globalRole]}>
              {ROLE_LABELS[member.globalRole]}
            </Badge>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* ---------------- Left: identity ---------------- */}
        <Card className="h-fit">
          <CardBody>
            <SectionLabel>Details</SectionLabel>

            <div className="mt-5 flex items-center gap-4">
              <Avatar
                name={member.fullName}
                photoUrl={member.photoUrl}
                className="size-[72px] text-2xl"
              />
              <ContactLink member={member} />
            </div>

            <div className="mt-5">
              <CardDivider />
              <DetailRow label="Reports to">
                {lead ? (
                  <Link
                    href={`/members/${lead.id}`}
                    className="hover:text-cardinal-600"
                  >
                    {lead.fullName}
                  </Link>
                ) : (
                  "—"
                )}
              </DetailRow>
              <CardDivider />
              <DetailRow label="Projects">{projects.length}</DetailRow>
              <CardDivider />
              <DetailRow label="Joined">
                {formatDay(member.joinedAt, {
                  month: "long",
                  year: "numeric",
                })}
              </DetailRow>
              {member.skills && member.skills.length > 0 ? (
                <>
                  <CardDivider />
                  <div className="py-4">
                    <SectionLabel tone="muted">Skills</SectionLabel>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {member.skills.map((skill) => (
                        <Badge key={skill} tone="neutral">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </CardBody>
        </Card>

        {/* ---------------- Right ---------------- */}
        <div className="space-y-6">
          <Card>
            <CardBody>
              <SectionLabel>Projects &amp; Responsibilities</SectionLabel>

              <div className="mt-4 space-y-3">
                {projects.length === 0 ? (
                  <EmptyState
                    message="Not on any projects yet."
                    actionLabel="Browse projects"
                    actionHref="/projects"
                  />
                ) : (
                  liveProjects.map((row) => (
                    <MemberProjectCard
                      key={row.project.id}
                      row={row}
                      canViewEffort={canViewEffort}
                    />
                  ))
                )}

                {/*
                  Finished work last, and folded away.

                  Same reasoning as My Work: a member two years in has more
                  completed projects than live ones, and the live ones are what
                  anybody opening this page came for. Collapsed rather than
                  removed — the record IS the point of not hard-deleting
                  anything, so it stays one click away.
                */}
                {finishedProjects.length > 0 ? (
                  <CompletedProjectsSection count={finishedProjects.length}>
                    <div className="mt-4 space-y-3">
                      {finishedProjects.map((row) => (
                        <MemberProjectCard
                          key={row.project.id}
                          row={row}
                          canViewEffort={canViewEffort}
                        />
                      ))}
                    </div>
                  </CompletedProjectsSection>
                ) : null}
              </div>
            </CardBody>
          </Card>

          {directReports.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Direct Reports</SectionLabel>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {directReports.map((report) => (
                    <Link
                      key={report.id}
                      href={`/members/${report.id}`}
                      className="rounded-tile border-line hover:bg-surface border px-4 py-3 transition-colors"
                    >
                      <p className="text-ink text-[15px] font-bold">
                        {report.fullName}
                      </p>
                      <p className="text-ink-muted mt-0.5 text-sm">
                        {report.major ?? "—"}
                      </p>
                    </Link>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {/* Contribution: four signals, no composite score, no ranking */}
          <Card>
            <CardBody>
              {canViewEffort && contribution ? (
                <>
                  <ContributionPanel
                    record={contribution}
                    isOwnRecord={isOwnProfile}
                  />
                  <p className="text-ink-muted mt-5 text-sm">
                    Four independent signals, deliberately not combined into a
                    score and never ranked against other members.{" "}
                    <Link
                      href="/how-we-lead"
                      className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
                    >
                      What leadership looks for
                    </Link>
                  </p>
                </>
              ) : (
                <>
                  <SectionLabel>Contribution</SectionLabel>
                  <p className="text-ink-soft mt-3 flex items-start gap-2 text-[15px]">
                    <Lock className="text-ink-muted mt-0.5 size-4 shrink-0" />
                    <span>
                      Hours and update contents are visible only to this
                      member&apos;s Lead chain and the REs of projects they
                      contribute to. Their project work is public — see above.
                    </span>
                  </p>
                </>
              )}
            </CardBody>
          </Card>

          {/*
            Their check-in history.
            Reading is separate from being accountable for reading: the review
            QUEUE on the dashboard stays scoped to direct reports, because that's
            the obligation that escalates. This is here so a Co-Lead, or any Lead
            further up the chain, can catch up on someone without inheriting a
            queue item for them.
          */}
          {canViewEffort ? (
            <Card>
              <CardBody>
                <SectionLabel>Check-ins</SectionLabel>
                {checkIns.length === 0 ? (
                  <p className="text-ink-soft mt-3 text-[15px]">
                    {member.preferredName ?? member.fullName} hasn&apos;t
                    submitted a check-in yet.
                  </p>
                ) : (
                  <ul className="mt-4 space-y-4">
                    {checkIns
                      .slice(0, 8)
                      .map(({ update, sections, reviewedBy }) => (
                        <li
                          key={update.id}
                          className="rounded-tile border-line bg-surface border p-3.5"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-ink text-sm font-bold">
                              {formatDay(update.submittedAt ?? update.dueAt, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </p>
                            <div className="flex items-center gap-3">
                              <p className="text-ink-muted text-xs">
                                {update.hoursThisPeriod} hrs
                                {reviewedBy
                                  ? ` · read by ${reviewedBy.preferredName ?? reviewedBy.fullName}`
                                  : " · not yet read"}
                              </p>
                              {/*
                              Your own, or a Co-Lead clearing up. Anything a
                              Lead has already read stays — the operation
                              refuses it, because they acted on it.
                            */}
                              {canDeleteCheckIns && !reviewedBy ? (
                                <ActionButton
                                  action={deleteCheckInAction}
                                  fields={{
                                    updateId: update.id,
                                    authorId: member.id,
                                  }}
                                  label="Delete"
                                  pendingLabel="Deleting…"
                                  tone="danger"
                                />
                              ) : null}
                            </div>
                          </div>

                          {sections.map(({ entry, project }) => (
                            <div key={entry.id} className="mt-3">
                              <p className="text-ink-muted text-xs font-semibold tracking-wide uppercase">
                                {project?.name ?? "Unknown project"}
                              </p>
                              <p className="text-ink-soft mt-1 text-[15px]">
                                {entry.progress}
                              </p>
                              {entry.blockers ? (
                                <p className="text-cardinal-700 mt-1 text-[15px]">
                                  Blocked: {entry.blockers}
                                </p>
                              ) : null}
                            </div>
                          ))}

                          {update.generalNote ? (
                            <p className="border-line text-ink-soft mt-3 border-t pt-3 text-[15px]">
                              {update.generalNote}
                            </p>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : null}

          {/*
            Their trainings. Public to read — knowing who can run a machine is
            how you find the person to ask.

            Everything here is per-person. Editing the club's CATALOGUE lives
            in Settings, because retiring a machine affects everyone and has no
            business on a row inside one member's record.
          */}
          {/*
            Asks that got answered.

            This is also the ONLY route back from "Mark sorted". Resolving is
            otherwise a one-way door: the ask leaves the Find Work board and
            there is nowhere left to click. Somebody closing a thread too early
            — the fix didn't hold, the part was still wrong — had to post the
            whole question again and lose the replies.
          */}
          {resolvedAsks.length > 0 ? (
            <Card>
              <CardBody>
                <SectionLabel>Answered Asks</SectionLabel>
                <div className="mt-4 space-y-2.5">
                  {resolvedAsks.map((ask) => (
                    <div
                      key={ask.key}
                      className="rounded-tile border-line border px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-ink text-[15px] font-bold">
                            {ask.title}
                          </p>
                          {ask.project ? (
                            <Link
                              href={`/projects/${ask.project.slug}`}
                              className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
                            >
                              {ask.project.name}
                            </Link>
                          ) : null}
                        </div>
                        <Badge tone="ok">Sorted</Badge>
                      </div>

                      {ask.request.resolutionNote ? (
                        <p className="text-ink-soft mt-2 text-sm">
                          <span className="text-ink font-semibold">How: </span>
                          {ask.request.resolutionNote}
                        </p>
                      ) : null}

                      {ask.canClose ? (
                        <div className="mt-3">
                          <ReopenButton requestId={ask.request.id} />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardBody>
              <TrainingRecord
                view={trainings}
                isOwnProfile={isOwnProfile}
                canVerify={canVerifyTrainings}
                viewerIsCoLead={isCoLead(viewer.actor)}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * One project row on somebody's profile.
 *
 * Extracted so the live list and the collapsed completed list render
 * identically — two copies of this markup would drift, and the one that drifts
 * is always the one behind the toggle nobody opens.
 */
function MemberProjectCard({
  row,
  canViewEffort,
}: {
  row: MemberProjectRow;
  /** Hours only. The due countdown is public — see the note inside. */
  canViewEffort: boolean;
}) {
  const {
    project,
    membership,
    breadcrumb,
    hoursLogged,
    deliverables,
    daysToTarget,
  } = row;

  return (
    <div
      key={project.id}
      className="rounded-tile border-line border px-4 py-3.5"
    >
      <Breadcrumb trail={breadcrumb} className="mb-1.5" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Link
          href={`/projects/${project.slug}`}
          className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
        >
          {project.name}
        </Link>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {membership.role === "re" ? <Badge tone="cardinal">RE</Badge> : null}
          {membership.commitment === "following" ? (
            <Badge tone="neutral">Following</Badge>
          ) : null}
          <ProjectBadges project={project} />
        </div>
      </div>

      {/* What they own here — public, unlike hours */}
      {deliverables.length > 0 ? (
        <div className="mt-3 space-y-2">
          {deliverables.map((d) => (
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
      ) : membership.responsibility ? (
        <p className="text-ink-soft mt-2 text-sm">
          <span className="text-ink font-semibold">Owns:</span>{" "}
          {membership.responsibility}
        </p>
      ) : null}

      {/*
        Hours are gated on `canViewEffort`; the countdown
        isn't. When a project is due is a fact about the
        project, and the whole club can already read it on
        the project page — hiding it here would be privacy
        theatre that costs the page its point.
      */}
      <div className="text-ink-muted mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        {canViewEffort ? (
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {formatNumber(hoursLogged, 1)} hrs logged
          </span>
        ) : null}
        <DueCountdown
          daysLeft={daysToTarget}
          done={project.phase === "complete"}
        />
      </div>
    </div>
  );
}
