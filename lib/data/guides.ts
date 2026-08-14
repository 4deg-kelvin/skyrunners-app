/**
 * Club-written material on the guide pages.
 *
 * The pages themselves stay hard-coded — how the APP works has to track the
 * code, or the guide starts confidently describing buttons that no longer
 * exist. What lives here is how the CLUB works: which Google Doc explains the
 * Fusion licence, where the KiCad setup lives, what a Lead is expected to chase
 * this quarter. Those change faster than anybody ships a deploy.
 *
 * Same argument that made the trainings catalogue data rather than an enum
 * (CLAUDE.md §9), applied to prose.
 */

import { readStore } from "@/lib/store/disk";
import { preloadLiveStore } from "@/lib/store/request";
import { getMember } from "@/lib/mock-data";
import type { GuideBlock, GuidePage, Member } from "@/lib/types";

export interface GuideBlockRow {
  block: GuideBlock;
  updatedBy?: Member;
}

/** Blocks grouped under their category heading, both in the club's order. */
export interface GuideSection {
  /** The club's own heading. Blank categories collect under "Resources". */
  category: string;
  rows: GuideBlockRow[];
}

const DEFAULT_CATEGORY = "Resources";

/**
 * Everything a member sees on one guide page.
 *
 * Grouped rather than flat because the club will accumulate a dozen of these —
 * "Software setup", "Shop safety", "Templates" — and an ungrouped list of
 * twelve links is a wall nobody reads. Sorted by the first block in each group,
 * so a Co-Lead controls section order with the same up/down buttons.
 */
export async function getGuideSections(
  page: GuidePage
): Promise<GuideSection[]> {
  await preloadLiveStore();

  const blocks = readStore()
    .guideBlocks.filter((b) => b.page === page)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const sections: GuideSection[] = [];
  for (const block of blocks) {
    const category = block.category?.trim() || DEFAULT_CATEGORY;
    const row: GuideBlockRow = {
      block,
      updatedBy: block.updatedById ? getMember(block.updatedById) : undefined,
    };

    const existing = sections.find((s) => s.category === category);
    if (existing) existing.rows.push(row);
    else sections.push({ category, rows: [row] });
  }

  return sections;
}

/** The flat list, for the editor — where order is the thing being edited. */
export async function getGuideBlocks(
  page: GuidePage
): Promise<GuideBlockRow[]> {
  await preloadLiveStore();

  return readStore()
    .guideBlocks.filter((b) => b.page === page)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((block) => ({
      block,
      updatedBy: block.updatedById ? getMember(block.updatedById) : undefined,
    }));
}
