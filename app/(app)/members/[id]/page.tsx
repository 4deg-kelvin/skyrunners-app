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
import { ActionButton } from "@/components/forms/action-form";
import { deleteCheckInAction } from "@/lib/actions";
import { getMemberProfile } from "@/lib/data/members";
import { getTrainings } from "@/lib/data/trainings";
import { getViewer } from "@/lib/data/viewer";
import {
  ROLE_LABELS,
  ROLE_TONES,
} from "@/lib/labels";
import { can, isCoLead } from "@/lib/permissions";
import { formatNumber } from "@/lib/utils";

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
  const [view, trainings] = await Promise.all([
    getMemberProfile(id, canViewEffort),
    getTrainings(id),
  ]);

  if (!view) notFound();

  const {
    member,
    lead,
    directReports,
    projects,
    contribution,
    checkIns,
  } = view;
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
                {new Date(member.joinedAt).toLocaleDateString("en-US", {
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
                  projects.map(
                    ({
                      project,
                      membership,
                      breadcrumb,
                      hoursLogged,
                      deliverables,
                      daysToTarget,
                    }) => (
                      <div
                        key={project.id}
                        className="rounded-tile border border-line px-4 py-3.5"
                      >
                        <Breadcrumb trail={breadcrumb} className="mb-1.5" />
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <Link
                            href={`/projects/${project.slug}`}
                            className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                          >
                            {project.name}
                          </Link>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {membership.role === "re" ? (
                              <Badge tone="cardinal">RE</Badge>
                            ) : null}
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
                                  !!d.dueDate &&
                                  new Date(d.dueDate) < new Date()
                                }
                              />
                            ))}
                          </div>
                        ) : membership.responsibility ? (
                          <p className="mt-2 text-sm text-ink-soft">
                            <span className="font-semibold text-ink">Owns:</span>{" "}
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
                        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-muted">
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
                    )
                  )
                )}
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
                      className="rounded-tile border border-line px-4 py-3 transition-colors hover:bg-surface"
                    >
                      <p className="text-[15px] font-bold text-ink">
                        {report.fullName}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-muted">
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
                  <p className="mt-5 text-sm text-ink-muted">
                    Four independent signals, deliberately not combined into a
                    score and never ranked against other members.{" "}
                    <Link
                      href="/how-we-lead"
                      className="font-semibold text-cardinal-600 hover:text-cardinal-700"
                    >
                      What leadership looks for
                    </Link>
                  </p>
                </>
              ) : (
                <>
                  <SectionLabel>Contribution</SectionLabel>
                  <p className="mt-3 flex items-start gap-2 text-[15px] text-ink-soft">
                    <Lock className="mt-0.5 size-4 shrink-0 text-ink-muted" />
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
                  <p className="mt-3 text-[15px] text-ink-soft">
                    {member.preferredName ?? member.fullName} hasn&apos;t
                    submitted a check-in yet.
                  </p>
                ) : (
                  <ul className="mt-4 space-y-4">
                    {checkIns.slice(0, 8).map(({ update, sections, reviewedBy }) => (
                      <li
                        key={update.id}
                        className="rounded-tile border border-line bg-surface p-3.5"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-bold text-ink">
                            {new Date(
                              update.submittedAt ?? update.dueAt
                            ).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </p>
                          <div className="flex items-center gap-3">
                            <p className="text-xs text-ink-muted">
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
                            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                              {project?.name ?? "Unknown project"}
                            </p>
                            <p className="mt-1 text-[15px] text-ink-soft">
                              {entry.progress}
                            </p>
                            {entry.blockers ? (
                              <p className="mt-1 text-[15px] text-cardinal-700">
                                Blocked: {entry.blockers}
                              </p>
                            ) : null}
                          </div>
                        ))}

                        {update.generalNote ? (
                          <p className="mt-3 border-t border-line pt-3 text-[15px] text-ink-soft">
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
