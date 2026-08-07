import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Lock, Mail } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardBody, CardDivider } from "@/components/ui/card";
import { ContributionPanel } from "@/components/ui/contribution-panel";
import { DeliverableRow } from "@/components/ui/deliverable-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { DetailRow } from "@/components/ui/stat-tile";
import { getAllMemberIds, getMemberProfile } from "@/lib/data/members";
import { getViewer } from "@/lib/data/viewer";
import { ROLE_LABELS, ROLE_TONES } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { formatNumber, initials } from "@/lib/utils";

export async function generateStaticParams() {
  const ids = await getAllMemberIds();
  return ids.map((id) => ({ id }));
}

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
  const view = await getMemberProfile(id, canViewEffort);

  if (!view) notFound();

  const { member, lead, directReports, projects, contribution } = view;
  const isOwnProfile = viewer.member.id === member.id;

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
              <span className="flex size-[72px] shrink-0 items-center justify-center rounded-full bg-cardinal-50 text-2xl font-bold text-cardinal-600">
                {initials(member.fullName)}
              </span>
              <a
                href={`mailto:${member.email}`}
                className="flex items-center gap-1.5 text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
              >
                <Mail className="size-3.5" />
                Email
              </a>
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

                        {canViewEffort ? (
                          <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-muted">
                            <Clock className="size-3.5" />
                            {formatNumber(hoursLogged, 1)} hrs logged
                          </p>
                        ) : null}
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

          <Card>
            <CardBody>
              <SectionLabel>Trainings &amp; Facility Access</SectionLabel>
              <p className="mt-3 text-[15px] text-ink-soft">
                Machine shop and lab certifications, expiry dates, certificate
                files, and keycard access arrive in Phase 7.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
