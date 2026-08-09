import { Badge } from "./badge";
import { HEALTH_LABELS, HEALTH_TONES, PHASE_LABELS } from "@/lib/labels";
import type { Project } from "@/lib/types";

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
  project: Pick<Project, "phase" | "health">;
  className?: string;
}) {
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
        <Badge tone={HEALTH_TONES[project.health]}>
          {HEALTH_LABELS[project.health]}
        </Badge>
      </div>
    </div>
  );
}
