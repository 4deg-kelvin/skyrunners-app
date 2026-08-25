import Link from "next/link";
import { Sparkles, TriangleAlert, Users } from "lucide-react";

import { ContactLink } from "./contact-link";
import { AskToJoinButton } from "@/components/forms/project-actions";
import { Badge, type BadgeTone } from "./badge";
import { CollapsibleCard } from "./collapsible-card";
import { EmptyState } from "./empty-state";
import { ProgressBar } from "./deliverable-row";
import { ProjectBadges } from "./project-badges";
import { SectionLabel } from "./section-label";
import type { FindWorkView, WorkSignal } from "@/lib/data/find-work";

/**
 * Where you'd help most — the ranked list, and the ask-to-join button.
 *
 * ---------------------------------------------------------------------------
 * This was a whole page, and the ranking is the part worth keeping
 * ---------------------------------------------------------------------------
 *
 * `/find-work` existed because the club's root problem is "I can't find
 * something to do without asking a Co-Lead", and its answer was this ordering:
 * unstaffed and blocked first, healthy last, already-joined at the bottom. That
 * logic is the valuable part and it is unchanged here.
 *
 * What didn't work was making it a separate destination. Six nav items is a lot
 * for somebody's first week, and "Projects" and "Find Work" are indistinguishable
 * from the outside — both are lists of projects, and a new member has no way to
 * guess that one is sorted by where they'd be useful. Two doors to the same
 * room, one of which nobody opens.
 *
 * So it sits at the top of `/projects` instead: the ranked shortlist first, the
 * full division tree underneath. One page, one door, and the ordering still does
 * the work.
 *
 * The ordering itself lives in `lib/data/find-work.ts` and must not be replaced
 * by a sort on date or division — that would bury exactly the projects that need
 * people.
 */

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

/**
 * How many ranked cards to show before deferring to the tree below.
 *
 * A shortlist, not a second copy of the page. The whole division tree is
 * directly underneath, so listing thirty cards here would just push it off
 * screen and recreate the problem this merge was meant to fix — the top of the
 * page should answer "where should I go?" in one screen.
 */
const SPOTLIGHT_LIMIT = 5;

export function WorkSpotlight({ view }: { view: FindWorkView }) {
  const { openWork, counts } = view;

  const available = openWork.filter((w) => w.viewerStatus !== "committed");
  const shortlist = available.slice(0, SPOTLIGHT_LIMIT);

  const openCount = counts.needingHelp + counts.unstaffed;

  const short = available.length === 1 ? "" : "s";
  const summary =
    available.length === 0
      ? "Nothing open to join right now."
      : `${available.length} project${short} you could join — ${openCount} short of people.`;

  return (
    <CollapsibleCard
      storageKey="skyrunners.showWorkSpotlight"
      summaryWhenClosed={summary}
      header={
        <>
          <SectionLabel>Where You&apos;d Help Most</SectionLabel>
          <p className="text-ink-soft mt-1.5 max-w-2xl text-[15px]">
            Ranked by where you&apos;d make the biggest difference — nobody on
            it, or stuck, first. Ask to join and the project&apos;s PL decides;
            the request is tracked, and escalates if it sits for five days.
          </p>
        </>
      }
    >
      <div className="mt-5 space-y-3">
        {shortlist.length === 0 ? (
          /*
              Two very different states, and they used to share one message.
              "You're already on everything that's open" is warm when there IS
              work; on a fresh club it congratulates somebody for having done
              nothing, on the section meant to answer "what do I do?".
            */
          <EmptyState
            message={
              counts.total === 0
                ? "No projects yet. When the club puts some up they'll appear here, sorted by where you'd help most."
                : "You're on everything that's open. Impressive — the full tree is below if you want a look around."
            }
            actionLabel="See your work"
            actionHref="/my-work"
          />
        ) : (
          shortlist.map((card) => {
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

            const shown = signals.filter((s) => VISIBLE_SIGNALS.includes(s));

            return (
              <div
                key={project.id}
                className="rounded-tile border-line border px-4 py-4"
              >
                {division ? (
                  <p className="text-cardinal-600 mb-1 text-[13px] font-semibold">
                    {division.name}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Link
                    href={`/projects/${project.slug}`}
                    className="text-ink hover:text-cardinal-600 text-[17px] font-bold"
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
                  <p className="text-ink-soft mt-2 text-[15px]">
                    {project.description}
                  </p>
                ) : null}

                {/* Skill match — the reason this project is near the top */}
                {matchedSkills.length > 0 ? (
                  <p className="text-cardinal-600 mt-2.5 flex items-center gap-1.5 text-sm font-semibold">
                    <Sparkles className="size-3.5" />
                    Matches your {matchedSkills.join(", ")}
                  </p>
                ) : null}

                {project.openRoles ? (
                  <p className="text-ink-soft mt-2 text-[15px]">
                    <span className="text-ink font-semibold">Looking for:</span>{" "}
                    {project.openRoles}
                  </p>
                ) : null}

                {/* Concrete work someone could pick up today */}
                {needsAttention.length > 0 ? (
                  <div className="rounded-tile bg-surface mt-3 px-3.5 py-3">
                    <SectionLabel tone="muted">
                      Stuck or overdue right now
                    </SectionLabel>
                    <ul className="mt-2 space-y-1.5">
                      {needsAttention.slice(0, 3).map((d) => (
                        <li
                          key={d.id}
                          className="text-ink-soft flex items-start gap-1.5 text-sm"
                        >
                          <TriangleAlert className="text-cardinal-600 mt-0.5 size-3.5 shrink-0" />
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

                <div className="text-ink-muted mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
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
                <div className="border-line-soft mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
                  {viewerStatus === "requested" ? (
                    <Badge tone="warn">Request pending</Badge>
                  ) : (
                    <AskToJoinButton
                      projectId={project.id}
                      projectName={project.name}
                      isRecruiting={project.isOpenToJoin}
                    />
                  )}

                  {res.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-ink-muted text-sm">
                        {res.length > 1 ? "PLs:" : "PL:"}
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
                    <span className="text-ink-muted text-sm">
                      No PL assigned — ask a Co-Lead about this one.
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {available.length > SPOTLIGHT_LIMIT ? (
        <p className="text-ink-muted mt-4 text-sm">
          {available.length - SPOTLIGHT_LIMIT} more open project
          {available.length - SPOTLIGHT_LIMIT === 1 ? "" : "s"} in the divisions
          below — every one has an <em>Ask to join</em> button on its own page.
        </p>
      ) : null}
    </CollapsibleCard>
  );
}
