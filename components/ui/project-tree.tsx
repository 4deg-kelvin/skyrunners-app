"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, CornerDownRight } from "lucide-react";

import { Badge } from "./badge";
import { ProjectBadges } from "./project-badges";
import { EmptyState } from "./empty-state";
import { SectionLabel } from "./section-label";
import { useHideCompleted } from "./completed-filter";
import type { ProjectTreeNode } from "@/lib/data/projects";

/**
 * One project in the tree, with its children collapsible.
 *
 * Collapsed by DEFAULT once a project has sub-projects. The projects page is
 * the club's map, and a map you have to scroll for a minute is one people stop
 * opening — which is the discoverability problem this app exists to fix,
 * reintroduced by its own success. The parent still shows how many are hidden,
 * so nothing is a surprise.
 */
export function ProjectNode({
  node,
  depth,
}: {
  node: ProjectTreeNode;
  depth: number;
}) {
  const { project, res, memberCount, blockedCount, progress } = node;
  const [expanded, setExpanded] = useState(false);
  const hideCompleted = useHideCompleted();

  /*
    The switch has to reach down here, not just the top-level sections.
    A completed sub-project nested three deep is exactly the kind of finished
    work somebody turning the filter on is trying to get out of the way — and
    the counts beside the expander have to agree with what expanding shows, or
    "Show 2 sub-projects" opens onto one.

    A parent can only be complete when all its children are (enforced in
    `updateProject`), so this never hides a live project under a finished one.
  */
  const children = hideCompleted
    ? node.children.filter((c) => c.project.phase !== "complete")
    : node.children;

  return (
    <div>
      <div
        className="rounded-tile border-line hover:bg-surface border transition-colors"
        style={{ marginLeft: depth * 24 }}
      >
        <div className="flex items-start gap-2 px-4 py-3.5">
          {children.length > 0 ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Hide sub-projects" : "Show sub-projects"}
              className="text-ink-muted hover:bg-line hover:text-ink mt-0.5 rounded p-0.5"
            >
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          ) : depth > 0 ? (
            <CornerDownRight className="text-ink-muted mt-0.5 size-4 shrink-0" />
          ) : (
            <span className="size-5 shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/projects/${project.slug}`}
                  className="text-ink hover:text-cardinal-600 text-[15px] font-bold"
                >
                  {project.name}
                </Link>
                {project.description ? (
                  <p className="text-ink-soft mt-1 text-sm">
                    {project.description}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <ProjectBadges project={project} />
                {/*
                  Health is the RE's judgement and only moves when they change
                  it. Somebody marking their work blocked is a fact, and the
                  person who could clear it has to see it from here.
                */}
                {blockedCount > 0 ? (
                  <Badge tone="risk">{blockedCount} blocked</Badge>
                ) : null}
              </div>
            </div>

            <div className="text-ink-muted mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
              {res.length > 0 ? (
                <span>
                  <span className="text-ink-soft font-semibold">
                    {res.length > 1 ? "REs" : "RE"}:
                  </span>{" "}
                  {res.map((r) => r.fullName).join(", ")}
                </span>
              ) : (
                <span className="text-warn-fg font-semibold">No RE yet</span>
              )}
              <span>
                {memberCount} {memberCount === 1 ? "person" : "people"}
              </span>
              {progress.total > 0 ? (
                <span>
                  {progress.done}/{progress.total} delivered
                </span>
              ) : null}
              {children.length > 0 ? (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
                >
                  {expanded ? "Hide" : "Show"} {children.length} sub-project
                  {children.length === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3">
          {children.map((child) => (
            <ProjectNode
              key={child.project.id}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One division's projects: live work first, finished work underneath.
 *
 * A completed project still matters — it's the club's record of what got built,
 * and years from now that history is the point. But mixed into the same list it
 * makes the ongoing work harder to see, which is the one job this page has.
 *
 * A client component so the hide-completed switch reaches it. The split itself
 * is cheap and pure, so doing it here rather than on the server costs nothing
 * and keeps the toggle instant.
 */
export function DivisionProjectList({ roots }: { roots: ProjectTreeNode[] }) {
  const hideCompleted = useHideCompleted();

  const live = roots.filter((n) => n.project.phase !== "complete");
  const finished = roots.filter((n) => n.project.phase === "complete");

  return (
    <>
      <div className="mt-5 space-y-3">
        {live.length === 0 ? (
          <EmptyState
            message={
              finished.length > 0
                ? "Nothing active in this division right now."
                : "No projects in this division yet."
            }
            actionLabel="See other divisions"
            actionHref="/projects"
          />
        ) : (
          live.map((node) => (
            <ProjectNode key={node.project.id} node={node} depth={0} />
          ))
        )}
      </div>

      {finished.length > 0 && !hideCompleted ? (
        <div className="border-line mt-6 border-t pt-5">
          <SectionLabel tone="muted">
            Completed · {finished.length}
          </SectionLabel>
          <div className="mt-3 space-y-3">
            {finished.map((node) => (
              <ProjectNode key={node.project.id} node={node} depth={0} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
