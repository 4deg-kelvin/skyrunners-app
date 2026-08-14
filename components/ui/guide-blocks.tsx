import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Card, CardBody } from "./card";
import { SectionLabel } from "./section-label";
import type { GuideSection } from "@/lib/data/guides";

/**
 * The club's own material on a guide page, under the built-in content.
 *
 * Renders nothing at all when the club hasn't added anything — an empty
 * "Resources" heading on a new member's first page would look like something
 * failed to load.
 *
 * Deliberately BELOW the hard-coded sections. Those explain how the app works
 * and are the same for everybody; these are the club's own additions, and a
 * member who reads to the bottom has the context to make sense of them.
 */
export function GuideBlocks({
  sections,
  canEdit,
}: {
  sections: GuideSection[];
  /** Shows the way to the editor. Co-Leads only — see `can.manageGuides`. */
  canEdit?: boolean;
}) {
  if (sections.length === 0) {
    return canEdit ? (
      <Card>
        <CardBody>
          <SectionLabel>Club material</SectionLabel>
          <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
            Nothing here yet. This is where the club&apos;s own guides go —
            setting up Fusion or KiCad, shop rules, templates — as links to
            Google Docs or short notes.
          </p>
          <Link
            href="/settings/guides"
            className="text-cardinal-600 hover:text-cardinal-700 mt-3 inline-block text-sm font-semibold"
          >
            Add something →
          </Link>
        </CardBody>
      </Card>
    ) : null;
  }

  return (
    <>
      {sections.map((section) => (
        <Card key={section.category}>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel>{section.category}</SectionLabel>
              {canEdit ? (
                <Link
                  href="/settings/guides"
                  className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
                >
                  Edit
                </Link>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {section.rows.map(({ block }) =>
                block.kind === "link" && block.url ? (
                  <a
                    key={block.id}
                    href={block.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-tile border-line hover:bg-surface block border px-4 py-3 transition-colors"
                  >
                    <p className="text-ink flex items-center gap-2 text-[15px] font-semibold">
                      {block.title}
                      <ExternalLink className="text-ink-muted size-3.5 shrink-0" />
                    </p>
                    {block.body ? (
                      <p className="text-ink-soft mt-1 text-sm">{block.body}</p>
                    ) : null}
                  </a>
                ) : (
                  <div key={block.id}>
                    <p className="text-ink text-[15px] font-semibold">
                      {block.title}
                    </p>
                    {/*
                      `whitespace-pre-line` so a Co-Lead's paragraph breaks
                      survive. They typed them into a textarea and expect them
                      back; collapsing everything into one block is the classic
                      way a CMS makes people stop using it.
                    */}
                    {block.body ? (
                      <p className="text-ink-soft mt-1 max-w-2xl text-[15px] whitespace-pre-line">
                        {block.body}
                      </p>
                    ) : null}
                  </div>
                )
              )}
            </div>
          </CardBody>
        </Card>
      ))}
    </>
  );
}
