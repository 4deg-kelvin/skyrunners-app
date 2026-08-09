import Link from "next/link";
import { Clock, Lock } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import { MarkReviewedButton } from "@/components/forms/review-actions";
import { getUpdates, type UpdateCard } from "@/lib/data/updates";
import { getViewer } from "@/lib/data/viewer";
import { UPDATE_STATUS_LABELS, UPDATE_STATUS_TONES } from "@/lib/labels";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Check-ins · SkyRunners HQ" };

function formatDue(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * One check-in, rendered in full.
 *
 * `showHours` is the privacy line drawn in the UI. The per-project text is the
 * project's history and is public; the hours attached to it are effort data.
 * On this page the viewer is always either the author or their Lead, so hours
 * are shown — but the flag has to exist, because this card is the obvious thing
 * to reuse on a project page, where they must not be.
 */
function CheckInCard({
  card,
  showHours,
  action,
}: {
  card: UpdateCard;
  showHours: boolean;
  action?: React.ReactNode;
}) {
  const { update, author, sections, ageDays, escalated } = card;

  return (
    <div
      className={
        escalated
          ? "rounded-tile border-cardinal-600 border px-4 py-3.5"
          : "rounded-tile border-line border px-4 py-3.5"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink text-[15px] font-bold">
            {author ? (
              <Link
                href={`/members/${author.id}`}
                className="hover:text-cardinal-600"
              >
                {author.fullName}
              </Link>
            ) : (
              "Unknown member"
            )}
          </p>
          <p className="text-ink-muted mt-0.5 text-sm">
            Due {formatDue(update.dueAt)}
            {update.submittedAt
              ? ` · submitted ${formatDue(update.submittedAt)}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showHours && update.hoursThisPeriod > 0 ? (
            <span className="text-ink-muted flex items-center gap-1.5 text-sm">
              <Clock className="size-3.5" />
              {formatNumber(update.hoursThisPeriod, 1)} hrs
            </span>
          ) : null}
          <Badge tone={UPDATE_STATUS_TONES[update.status]}>
            {UPDATE_STATUS_LABELS[update.status]}
          </Badge>
        </div>
      </div>

      {/*
        One section per project. Never collapse these into one blob — a Lead
        overseeing several of someone's projects can't tell which work a note
        refers to, and an RE can't tell whether a blocker is theirs to clear.
      */}
      {sections.length > 0 ? (
        <div className="mt-3 space-y-2.5">
          {sections.map(({ entry, project }) => (
            <div key={entry.id} className="rounded-tile bg-surface px-3.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {project ? (
                  <Link
                    href={`/projects/${project.slug}`}
                    className="text-cardinal-600 hover:text-cardinal-700 text-sm font-bold"
                  >
                    {project.name}
                  </Link>
                ) : (
                  <span className="text-ink text-sm font-bold">
                    Unknown project
                  </span>
                )}
                {showHours ? (
                  <span className="text-ink-muted text-xs">
                    {formatNumber(entry.hours, 1)} hrs
                  </span>
                ) : null}
              </div>
              <p className="text-ink-soft mt-1.5 text-sm">{entry.progress}</p>
              {entry.blockers ? (
                <p className="text-risk-fg mt-1.5 text-sm">
                  <span className="font-semibold">Blocked:</span>{" "}
                  {entry.blockers}
                </p>
              ) : null}
              {entry.nextSteps ? (
                <p className="text-ink-muted mt-1.5 text-sm">
                  <span className="font-semibold">Next:</span> {entry.nextSteps}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-ink-muted mt-2 text-sm">Nothing written yet.</p>
      )}

      {update.generalNote ? (
        <p className="text-ink-soft mt-2.5 text-sm">{update.generalNote}</p>
      ) : null}

      {action ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {action}
          {escalated ? (
            <span className="text-cardinal-600 text-sm font-semibold">
              Waiting {ageDays} days — your Lead can see this
            </span>
          ) : ageDays > 0 ? (
            <span className="text-ink-muted text-sm">
              Waiting {ageDays} {ageDays === 1 ? "day" : "days"}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default async function UpdatesPage() {
  const viewer = await getViewer();
  const view = await getUpdates(viewer.actor);
  const { mine, toReview, reviewed, record, isReviewer, graceDays } = view;

  return (
    <div className="space-y-6">
      <PageHeader
        label="Progress"
        title="Check-ins"
        description="Twice a week, on the days you pick. The point is to start a conversation with your Lead, not to file a report."
      />

      {/* ---------------- What you owe as a Lead ---------------- */}
      {isReviewer ? (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel>Waiting On You</SectionLabel>
              <Link
                href="/dashboard"
                className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
              >
                Dashboard
              </Link>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <StatTile label="Unread" value={record.unread} />
              <StatTile
                label="Past the grace period"
                value={record.escalated}
                hint={
                  record.escalated > 0
                    ? "visible to your own Lead"
                    : `escalates after ${graceDays} days`
                }
              />
              <StatTile
                label="Longest wait"
                value={
                  record.worstAgeDays > 0 ? `${record.worstAgeDays}d` : "—"
                }
              />
            </div>

            <div className="mt-5 space-y-3">
              {toReview.length === 0 ? (
                <EmptyState
                  message="Nothing waiting on you. Your people have been heard."
                  actionLabel="See your own check-ins"
                  actionHref="#mine"
                />
              ) : (
                toReview.map((card) => (
                  <CheckInCard
                    key={card.update.id}
                    card={card}
                    showHours
                    action={
                      <MarkReviewedButton
                        updateId={card.update.id}
                        authorId={card.update.memberId}
                      />
                    }
                  />
                ))
              )}
            </div>

            <p className="text-ink-muted mt-4 text-sm">
              Only people who report to you appear here. Marking one read stops
              its clock — after {graceDays} days an unread check-in is shown to
              the Lead above you, because a report nobody reads is worse than no
              report at all.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------- Already read ---------------- */}
      {isReviewer && reviewed.length > 0 ? (
        <Card>
          <CardBody>
            <SectionLabel>Already Read</SectionLabel>
            <div className="mt-4 space-y-3">
              {reviewed.slice(0, 5).map((card) => (
                <CheckInCard key={card.update.id} card={card} showHours />
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------- Your own ---------------- */}
      {/* Anchor target for the "see your own check-ins" empty state above.
          On a span rather than the Card, which doesn't take an id. */}
      <span id="mine" />
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>My Check-ins</SectionLabel>
            <Link
              href="/settings"
              className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
            >
              Change my days
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {mine.length === 0 ? (
              <EmptyState
                message="You haven't written a check-in yet."
                actionLabel="See what you owe"
                actionHref="/my-work"
              />
            ) : (
              mine.map((card) => (
                <CheckInCard key={card.update.id} card={card} showHours />
              ))
            )}
          </div>

          <p className="text-ink-muted mt-4 flex items-start gap-1.5 text-sm">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Your total hours and reliability are visible only to you and your
              Lead chain. The per-project notes above are public — they belong
              to the project, and they&apos;re how someone spots a blocker they
              can clear.
            </span>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
