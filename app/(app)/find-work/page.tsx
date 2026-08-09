import Link from "next/link";
import { Sparkles, TriangleAlert, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ContactLink } from "@/components/ui/contact-link";
import { AskToJoinButton } from "@/components/forms/project-actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/deliverable-row";
import { ProjectBadges } from "@/components/ui/project-badges";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import { getFindWork, type WorkSignal } from "@/lib/data/find-work";
import { getViewer } from "@/lib/data/viewer";

export const metadata = {
  title: "Find work · SkyRunners HQ",
};

const SIGNAL_LABELS: Record<WorkSignal, string> = {
  needs_help: "Needs help",
  unstaffed: "Nobody on it",
  unowned_deliverables: "Only one person",
  overdue: "Behind schedule",
  open_roles: "Looking for people",
  healthy: "Running fine",
};

const SIGNAL_TONES: Record<WorkSignal, BadgeTone> = {
  needs_help: "risk",
  unstaffed: "risk",
  unowned_deliverables: "warn",
  overdue: "warn",
  open_roles: "cardinal",
  healthy: "neutral",
};

/** Signals worth showing. "Running fine" is true but not useful on a card. */
const VISIBLE_SIGNALS: WorkSignal[] = [
  "unstaffed",
  "needs_help",
  "overdue",
  "unowned_deliverables",
  "open_roles",
];

export default async function FindWorkPage() {
  const viewer = await getViewer();
  const view = await getFindWork(viewer.member.id, viewer.member.skills ?? []);
  const { openWork, counts } = view;

  const available = openWork.filter((w) => w.viewerStatus !== "committed");
  const alreadyOn = openWork.filter((w) => w.viewerStatus === "committed");

  return (
    <div className="space-y-6">
      <PageHeader
        label="Get Involved"
        title="Find work"
        description="Everything the club is building, sorted by where you'd help most. Nobody needs to tell you what to work on — pick something and message the RE."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Active projects" value={counts.total} />
        <StatTile
          label="Need help right now"
          value={counts.needingHelp}
          hint={counts.needingHelp > 0 ? "blocked or at risk" : undefined}
        />
        <StatTile
          label="Nobody on them"
          value={counts.unstaffed}
          hint={counts.unstaffed > 0 ? "easiest place to matter" : undefined}
        />
      </div>

      {/* How this works — the app is only useful if the flow is obvious */}
      <Card className="border-cardinal-200 bg-cardinal-50">
        <CardBody className="py-4">
          <p className="text-sm text-ink-soft">
            <span className="font-semibold text-ink">How joining works:</span>{" "}
            browse anything, then hit <em>Ask to join</em>. The project&apos;s
            Responsible Engineer decides — they know what the project needs. Your
            request goes into their queue and you can see it&apos;s pending, so
            it won&apos;t vanish. If nobody replies in five days it gets flagged
            for a Co-Lead.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>Where You&apos;d Help Most</SectionLabel>
            <Link
              href="/projects"
              className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
            >
              See the full project tree
            </Link>
          </div>

          <div className="mt-5 space-y-3">
            {available.length === 0 ? (
              <EmptyState
                message="You're already on everything that's open. Impressive."
                actionLabel="See your work"
                actionHref="/my-work"
              />
            ) : (
              available.map((card) => {
                const {
                  project,
                  division,
                  res,
                  memberCount,
                  progress,
                  needsAttention,
                  signals,
                  viewerStatus,
                  matchedSkills,
                } = card;

                const shown = signals.filter((s) =>
                  VISIBLE_SIGNALS.includes(s)
                );

                return (
                  <div
                    key={project.id}
                    className="rounded-tile border border-line px-4 py-4"
                  >
                    {division ? (
                      <p className="mb-1 text-[13px] font-semibold text-cardinal-600">
                        {division.name}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <Link
                        href={`/projects/${project.slug}`}
                        className="text-[17px] font-bold text-ink hover:text-cardinal-600"
                      >
                        {project.name}
                      </Link>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {shown.map((s) => (
                          <Badge key={s} tone={SIGNAL_TONES[s]}>
                            {SIGNAL_LABELS[s]}
                          </Badge>
                        ))}
                        <ProjectBadges project={project} />
                      </div>
                    </div>

                    {project.description ? (
                      <p className="mt-2 text-[15px] text-ink-soft">
                        {project.description}
                      </p>
                    ) : null}

                    {/* Skill match — the reason this project is near the top */}
                    {matchedSkills.length > 0 ? (
                      <p className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-cardinal-600">
                        <Sparkles className="size-3.5" />
                        Matches your {matchedSkills.join(", ")}
                      </p>
                    ) : null}

                    {project.openRoles ? (
                      <p className="mt-2 text-[15px] text-ink-soft">
                        <span className="font-semibold text-ink">
                          Looking for:
                        </span>{" "}
                        {project.openRoles}
                      </p>
                    ) : null}

                    {/* Concrete work someone could pick up today */}
                    {needsAttention.length > 0 ? (
                      <div className="mt-3 rounded-tile bg-surface px-3.5 py-3">
                        <SectionLabel tone="muted">
                          Stuck or overdue right now
                        </SectionLabel>
                        <ul className="mt-2 space-y-1.5">
                          {needsAttention.slice(0, 3).map((d) => (
                            <li
                              key={d.id}
                              className="flex items-start gap-1.5 text-sm text-ink-soft"
                            >
                              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-cardinal-600" />
                              <span>
                                {d.title}
                                {d.blockerNote ? ` — ${d.blockerNote}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {progress.total > 0 ? (
                      <ProgressBar
                        fraction={progress.fraction}
                        className="mt-3.5"
                      />
                    ) : null}

                    <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-muted">
                      <span className="flex items-center gap-1.5">
                        <Users className="size-3.5" />
                        {memberCount === 0
                          ? "No one committed yet"
                          : `${memberCount} ${memberCount === 1 ? "member" : "members"}`}
                      </span>
                      {project.timeCommitment ? (
                        <span>{project.timeCommitment}</span>
                      ) : null}
                    </div>

                    {/* Who to ask, and the action */}
                    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-soft pt-4">
                      {viewerStatus === "requested" ? (
                        <Badge tone="warn">Request pending</Badge>
                      ) : (
                        <AskToJoinButton
                          projectId={project.id}
                          projectName={project.name}
                        />
                      )}

                      {res.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="text-sm text-ink-muted">
                            {res.length > 1 ? "REs:" : "RE:"}
                          </span>
                          {res.map((re) => (
                            <ContactLink
                              key={re.id}
                              member={re}
                              subject={`Joining ${project.name}`}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-ink-muted">
                          No RE assigned — ask a Co-Lead about this one.
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <p className="mt-5 text-sm text-ink-muted">
            Asking to join lands in the RE&apos;s queue and shows here as
            pending, so it never disappears. If it sits for five days it
            escalates. Their contact details are on every card if you&apos;d
            rather just talk to them.
          </p>
        </CardBody>
      </Card>

      {/* Already involved, kept at the bottom */}
      {alreadyOn.length > 0 ? (
        <Card>
          <CardBody>
            <SectionLabel>Already On These</SectionLabel>
            <div className="mt-4 space-y-2.5">
              {alreadyOn.map(({ project }) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.slug}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-line px-4 py-3 transition-colors hover:bg-surface"
                >
                  <span className="text-[15px] font-bold text-ink">
                    {project.name}
                  </span>
                  <ProjectBadges project={project} />
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
