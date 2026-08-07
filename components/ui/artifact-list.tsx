import {
  ExternalLink,
  FileText,
  Github,
  Presentation,
  Box,
  FlaskConical,
  LineChart,
  PenLine,
  Link2,
} from "lucide-react";

import { Badge } from "./badge";
import { EmptyState } from "./empty-state";
import { ARTIFACT_KIND_LABELS, ARTIFACT_KIND_ORDER } from "@/lib/labels";
import type { ArtifactKind, Member, ProjectArtifact } from "@/lib/types";

const KIND_ICONS: Record<ArtifactKind, typeof FileText> = {
  presentation: Presentation,
  github: Github,
  requirements: FileText,
  cad: Box,
  test_report: FlaskConical,
  analysis: LineChart,
  drawing: PenLine,
  doc: FileText,
  link: Link2,
};

export interface ArtifactRow {
  artifact: ProjectArtifact;
  uploadedBy?: Member;
}

/**
 * The project's engineering record.
 *
 * Grouped by kind rather than listed by date, because the question someone
 * actually arrives with is "where are the requirements?" not "what changed most
 * recently".
 *
 * Note that most entries are LINKS, not uploads. A student team's CAD lives in
 * Onshape and its code lives in GitHub; copying files here would guarantee the
 * copy goes stale. The app's job is to be the index.
 */
export function ArtifactList({
  rows,
  canAdd,
}: {
  rows: ArtifactRow[];
  canAdd?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message={
          canAdd
            ? "Nothing linked yet. Adding the slides, requirements and CAD makes this project understandable to anyone who wanders in."
            : "The RE hasn't linked any documents for this project yet."
        }
        actionLabel="Browse other projects"
        actionHref="/projects"
      />
    );
  }

  const grouped = ARTIFACT_KIND_ORDER.map((kind) => ({
    kind,
    items: rows.filter((r) => r.artifact.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      {grouped.map(({ kind, items }) => {
        const Icon = KIND_ICONS[kind];
        return (
          <div key={kind}>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
              <Icon className="size-3.5" />
              {ARTIFACT_KIND_LABELS[kind]}
            </p>
            <div className="mt-2 space-y-2">
              {items.map(({ artifact, uploadedBy }) => {
                const href = artifact.externalUrl ?? artifact.fileUrl;
                const isExternal = !!artifact.externalUrl;

                return (
                  <a
                    key={artifact.id}
                    href={href}
                    target={isExternal ? "_blank" : undefined}
                    rel={isExternal ? "noopener noreferrer" : undefined}
                    className="block rounded-tile border border-line px-4 py-3 transition-colors hover:bg-surface"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                        {artifact.title}
                        {isExternal ? (
                          <ExternalLink className="size-3.5 shrink-0 text-ink-muted" />
                        ) : null}
                      </p>
                      {artifact.version ? (
                        <Badge tone="neutral">{artifact.version}</Badge>
                      ) : null}
                    </div>

                    {artifact.description ? (
                      <p className="mt-1 text-sm text-ink-soft">
                        {artifact.description}
                      </p>
                    ) : null}

                    <p className="mt-1.5 text-sm text-ink-muted">
                      {uploadedBy?.fullName ?? "Unknown"} ·{" "}
                      {new Date(artifact.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </a>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
