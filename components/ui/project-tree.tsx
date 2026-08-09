"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, CornerDownRight } from "lucide-react";

import { Badge } from "./badge";
import { ProjectBadges } from "./project-badges";
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
  const { project, res, memberCount, blockedCount, progress, children } = node;
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div
        className="rounded-tile border border-line transition-colors hover:bg-surface"
        style={{ marginLeft: depth * 24 }}
      >
        <div className="flex items-start gap-2 px-4 py-3.5">
          {children.length > 0 ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Hide sub-projects" : "Show sub-projects"}
              className="mt-0.5 rounded p-0.5 text-ink-muted hover:bg-line hover:text-ink"
            >
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          ) : depth > 0 ? (
            <CornerDownRight className="mt-0.5 size-4 shrink-0 text-ink-muted" />
          ) : (
            <span className="size-5 shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/projects/${project.slug}`}
                  className="text-[15px] font-bold text-ink hover:text-cardinal-600"
                >
                  {project.name}
                </Link>
                {project.description ? (
                  <p className="mt-1 text-sm text-ink-soft">
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

            <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-muted">
              {res.length > 0 ? (
                <span>
                  <span className="font-semibold text-ink-soft">
                    {res.length > 1 ? "REs" : "RE"}:
                  </span>{" "}
                  {res.map((r) => r.fullName).join(", ")}
                </span>
              ) : (
                <span className="font-semibold text-warn-fg">No RE yet</span>
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
                  className="font-semibold text-cardinal-600 hover:text-cardinal-700"
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
            <ProjectNode key={child.project.id} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
