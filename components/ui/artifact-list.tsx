import {
  Download,
  ExternalLink,
  FileText,
  Github,
  Presentation,
  Box,
  FlaskConical,
  LineChart,
  Lock,
  PenLine,
  Link2,
} from "lucide-react";

import { Badge } from "./badge";
import { EmptyState } from "./empty-state";
import { RemoveArtifactButton } from "@/components/forms/artifact-form";
import { ARTIFACT_KIND_LABELS, ARTIFACT_KIND_ORDER } from "@/lib/labels";
import type { ArtifactKind, Member, ProjectArtifact } from "@/lib/types";
import { formatDay } from "@/lib/dates";

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
  /**
   * Where the row points, resolved by `lib/data/projects.ts`.
   *
   * Not derived here: an uploaded file lives in a private bucket, so its
   * address is a signed URL that only the server can mint. Absent means the
   * file couldn't be signed — the row still renders, it just isn't a link.
   */
  href?: string;
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
  projectId,
  canAdd,
  canRemove,
  /**
   * The project is complete, so the record is history and nobody below Co-Lead
   * can take anything out of it. Worth saying out loud rather than just hiding
   * the buttons — a missing control with no explanation reads as a bug.
   */
  frozen,
}: {
  rows: ArtifactRow[];
  projectId: string;
  canAdd?: boolean;
  canRemove?: boolean;
  frozen?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message={
          canAdd
            ? "Nothing linked yet. Adding the slides, requirements and CAD makes this project understandable to anyone who wanders in."
            : "Nobody has linked any documents for this project yet."
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
      {frozen ? (
        <p className="text-ink-muted flex items-start gap-2 text-sm">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          This project is complete, so its record is frozen. You can still
          attach something new — removing takes a Co-Lead.
        </p>
      ) : null}

      {grouped.map(({ kind, items }) => {
        const Icon = KIND_ICONS[kind];
        return (
          <div key={kind}>
            <p className="text-ink-muted flex items-center gap-2 text-[11px] font-semibold tracking-[0.09em] uppercase">
              <Icon className="size-3.5" />
              {ARTIFACT_KIND_LABELS[kind]}
            </p>
            <div className="mt-2 space-y-2">
              {items.map(({ artifact, uploadedBy, href }) => {
                const isExternal = !!artifact.externalUrl;
                const isUpload = !!artifact.storagePath;

                /*
                  The row is a div wrapping an anchor, not an anchor wrapping
                  everything. Remove is a form, and a form inside an <a> is
                  invalid HTML that browsers "fix" by hoisting it out — the
                  button ends up outside the row and clicking it navigates.
                */
                return (
                  <div
                    key={artifact.id}
                    className="rounded-tile border-line hover:bg-surface flex items-start justify-between gap-3 border px-4 py-3 transition-colors"
                  >
                    <a
                      href={href}
                      target={isExternal ? "_blank" : undefined}
                      rel={isExternal ? "noopener noreferrer" : undefined}
                      className="min-w-0 flex-1"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="text-ink flex items-center gap-2 text-[15px] font-semibold">
                          {artifact.title}
                          {isExternal ? (
                            <ExternalLink className="text-ink-muted size-3.5 shrink-0" />
                          ) : null}
                          {isUpload ? (
                            <Download className="text-ink-muted size-3.5 shrink-0" />
                          ) : null}
                        </p>
                        {artifact.version ? (
                          <Badge tone="neutral">{artifact.version}</Badge>
                        ) : null}
                      </div>

                      {/*
                        A stored file whose signed URL couldn't be minted. Say
                        so rather than rendering a link that goes nowhere —
                        this is the record people are told to trust.
                      */}
                      {isUpload && !href ? (
                        <p className="text-risk-fg mt-1 text-sm">
                          This file couldn&apos;t be opened. Ask a Co-Lead to
                          re-attach it.
                        </p>
                      ) : null}

                      {artifact.description ? (
                        <p className="text-ink-soft mt-1 text-sm">
                          {artifact.description}
                        </p>
                      ) : null}

                      <p className="text-ink-muted mt-1.5 text-sm">
                        {uploadedBy?.fullName ?? "Unknown"} ·{" "}
                        {formatDay(artifact.createdAt)}
                      </p>
                    </a>

                    {canRemove ? (
                      <RemoveArtifactButton
                        artifactId={artifact.id}
                        projectId={projectId}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
