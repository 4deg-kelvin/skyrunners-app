import { cn } from "@/lib/utils";

/**
 * Shows where a project sits: division › parent project › this project.
 *
 * This exists because a member on several projects needs to tell them apart
 * instantly. "Layup Process Qualification" is ambiguous on its own; showing it
 * under the spar redesign inside Fixed Wing eVTOL places it immediately.
 */
export function Breadcrumb({
  trail,
  className,
}: {
  trail: { id: string; name: string; kind: "division" | "team" | "project" }[];
  className?: string;
}) {
  if (trail.length === 0) return null;

  return (
    <p
      className={cn(
        "text-ink-muted flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]",
        className
      )}
    >
      {trail.map((node, i) => (
        <span key={`${node.id}-${i}`} className="flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden="true">›</span> : null}
          <span
            className={
              node.kind === "division"
                ? "text-cardinal-600 font-semibold"
                : undefined
            }
          >
            {node.name}
          </span>
        </span>
      ))}
    </p>
  );
}
