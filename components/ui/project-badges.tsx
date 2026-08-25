import { Badge } from "./badge";
import { HEALTH_LABELS, HEALTH_TONES, PHASE_LABELS } from "@/lib/labels";
import type { Project } from "@/lib/types";
import { todayInClubTime } from "@/lib/dates";

/**
 * Phase + health badges for a project.
 *
 * Exists because this pair was previously duplicated across three pages, each
 * with its own copy of the label and tone maps. Four more pages render project
 * status in later phases — this keeps it to one definition.
 */
export function ProjectBadges({
  project,
  className,
}: {
  project: Pick<Project, "phase" | "health" | "targetDate" | "isOpenToJoin">;
  className?: string;
}) {
  /*
    Past its target date and not finished.

    Health is the PL's own judgement and only moves when they move it — that's
    deliberate and it stays. But it produced a row reading "3 days overdue"
    next to a green "On track", which is the app stating two contradictory
    things and asking the reader to work out which one to believe.

    So the date gets its own badge rather than health being silently
    overwritten. Overdue is a FACT; on-track is an OPINION, and the fact goes
    first. The PL is separately prompted to reconcile them by the `past_target`
    attention flag — annotating the contradiction without offering a way to
    close it would just be a tidier lie.
  */
  // Pacific, not UTC. `toISOString()` here meant a project stopped being
  // "on time" at 5pm the day before its target date. See `lib/dates.ts`.
  const overdue =
    project.phase !== "complete" &&
    !!project.targetDate &&
    project.targetDate < todayInClubTime();

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Complete gets the green. Every other stage is a waypoint and reads as
          neutral; finishing something is the one state worth celebrating, and a
          grey "Complete" next to a grey "Concept" makes them look equivalent.
        */}
        <Badge tone={project.phase === "complete" ? "ok" : "neutral"}>
          {PHASE_LABELS[project.phase]}
        </Badge>
        {overdue ? <Badge tone="risk">Past due</Badge> : null}
        <Badge tone={HEALTH_TONES[project.health]}>
          {HEALTH_LABELS[project.health]}
        </Badge>
        {/*
          "Not recruiting" is a signal, not a lock.

          The Ask to join button stays either way — `can.requestToJoin` is
          unconditional. This exists so nobody spends an ask on a project
          that's fully staffed, and so somebody who really is the right person
          can still make the case knowing the odds. A project that literally
          refused requests would leave a member with no route in except knowing
          somebody, which is the thing this app exists to remove.

          Hidden on complete projects: "not recruiting" for something that's
          finished is noise stating the obvious.
        */}
        {!project.isOpenToJoin && project.phase !== "complete" ? (
          <Badge tone="neutral">Not recruiting</Badge>
        ) : null}
      </div>
    </div>
  );
}
