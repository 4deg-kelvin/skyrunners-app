/**
 * Trainings and facility access.
 *
 * Two questions, one page:
 *
 *   "What am I cleared to use?"
 *   "Who on my team can run the laser cutter?"
 *
 * The second is the one that pays for the feature. Certifications are what
 * silently block work — somebody can't do a task and nobody knew, so the task
 * sits. Knowing who can run a machine is how you find the person to ask, which
 * is the same thesis as `/find-work`.
 *
 * Everything here is readable by every member, per `PUBLIC_TO_ALL_MEMBERS`.
 * Only *verifying* is restricted, and that's enforced in the action layer.
 */

import {
  catalogueItemsFor,
  certificationsFor,
  getMember,
  trainingSections,
  today,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { expireLapsedCertifications } from "@/lib/store/operations";
import { preloadLiveStore } from "@/lib/store/request";
import type {
  CatalogueItem,
  MemberCertification,
  Member,
  TrainingSection,
} from "@/lib/types";

/** One catalogue entry as it appears to one member. */
export interface CatalogueRow {
  item: CatalogueItem;
  /** Their record, if they have one. Absent means never requested. */
  record?: MemberCertification;
  /** Resolved so the page never looks a verifier up inside a render loop. */
  verifier?: Member;
  /** Everyone in the club currently cleared on this. The "who can I ask" half. */
  clearedMembers: Member[];
}

export interface TrainingSectionView {
  section: TrainingSection;
  /** Doors first, machines after — you need the one before the other. */
  siteAccess: CatalogueRow[];
  machines: CatalogueRow[];
}

export interface TrainingsView {
  /** Whose record this is. Not necessarily the viewer. */
  member: Member;
  sections: TrainingSectionView[];
  /** Retired entries this member still holds. Shown, greyed, never requestable. */
  retiredHeld: CatalogueRow[];
  counts: { verified: number; pending: number; expired: number };
  /** Every section, for the Co-Lead "add an item" picker. */
  sectionOptions: { id: string; name: string }[];
  today: string;
}

/**
 * Requests waiting on a verifier, plus clearances that have lapsed.
 *
 * The in-app half of "the lead notified". There is deliberately no email —
 * only join requests and review escalations do that — so this is what makes an
 * expiry visible, and it's surfaced in the dashboard exception feed.
 */
export interface TrainingQueueItem {
  record: MemberCertification;
  member: Member;
  item?: CatalogueItem;
  sectionName?: string;
}

/**
 * Cancel anything past its date, before reading.
 *
 * Anish's rule: *"if there is [an expiration], the training should be
 * cancelled and the lead notified."* So expiry is a real state change, not a
 * display filter — a lapsed clearance that still reads as valid is the one
 * failure here that gets somebody hurt.
 *
 * Run on read rather than on a cron, deliberately. There is no scheduled job
 * in this app yet, and a rule that only fires when somebody remembers to set
 * one up is not a safety rule. It's idempotent and touches nothing in the
 * common case where no `validityMonths` is set anywhere — which is the club's
 * entire catalogue today.
 */
async function sweepExpired(): Promise<void> {
  const store = readStore();
  const anyExpirable = store.certifications.some(
    (c) => c.status === "verified" && c.expiresAt && c.expiresAt < today()
  );
  // Check before writing: `mutate()` diffs and persists, and doing that on
  // every page load for a no-op would be a write per request.
  if (anyExpirable) await expireLapsedCertifications(today());
}

export async function getTrainings(memberId: string): Promise<TrainingsView> {
  await preloadLiveStore();
  await sweepExpired();

  const member = getMember(memberId);
  if (!member) throw new Error(`Member not found: ${memberId}`);

  const store = readStore();
  const mine = certificationsFor(memberId);

  // Who holds what, built once. Doing this per row would be a scan per
  // catalogue entry — twenty-odd scans of every certification in the club.
  const clearedByItem = new Map<string, Member[]>();
  for (const record of store.certifications) {
    if (record.status !== "verified") continue;
    const who = getMember(record.memberId);
    if (!who || who.status !== "active") continue;
    const list = clearedByItem.get(record.itemId);
    if (list) list.push(who);
    else clearedByItem.set(record.itemId, [who]);
  }

  const row = (item: CatalogueItem): CatalogueRow => {
    const record = mine.find((c) => c.itemId === item.id);
    return {
      item,
      record,
      verifier: record?.verifiedById
        ? getMember(record.verifiedById)
        : undefined,
      clearedMembers: (clearedByItem.get(item.id) ?? []).sort((a, b) =>
        a.fullName.localeCompare(b.fullName)
      ),
    };
  };

  const sections = trainingSections()
    .map((section) => {
      const items = catalogueItemsFor(section.id).filter((i) => i.isActive);
      return {
        section,
        siteAccess: items.filter((i) => i.kind === "site_access").map(row),
        machines: items.filter((i) => i.kind === "machine").map(row),
      };
    })
    // A section with nothing in it is noise on everyone's page. It still shows
    // in the Co-Lead picker, so a freshly-created one can be filled.
    .filter((s) => s.siteAccess.length + s.machines.length > 0);

  return {
    member,
    sections,
    retiredHeld: store.catalogueItems
      .filter((i) => !i.isActive && mine.some((c) => c.itemId === i.id))
      .map(row),
    counts: {
      verified: mine.filter((c) => c.status === "verified").length,
      pending: mine.filter((c) => c.status === "requested").length,
      expired: mine.filter((c) => c.status === "expired").length,
    },
    sectionOptions: trainingSections().map((s) => ({ id: s.id, name: s.name })),
    today: today(),
  };
}

/**
 * What a Lead owes: requests to verify, and clearances that have lapsed.
 *
 * `memberIds` is who they oversee. Scoped by the caller rather than here, for
 * the same reason the dashboard is: a Lead looking at a list that's mostly
 * other people's cannot tell what they owe.
 */
export async function getTrainingQueue(
  memberIds: string[]
): Promise<{ pending: TrainingQueueItem[]; expired: TrainingQueueItem[] }> {
  await preloadLiveStore();
  // Here too, so a Lead sees a lapse even if the member never opens their own
  // trainings page — which is exactly the case where nobody would notice.
  await sweepExpired();
  const store = readStore();
  const scope = new Set(memberIds);

  const sectionName = new Map(
    store.trainingSections.map((s) => [s.id, s.name])
  );

  const decorate = (record: MemberCertification): TrainingQueueItem | null => {
    const who = getMember(record.memberId);
    if (!who) return null;
    const item = store.catalogueItems.find((i) => i.id === record.itemId);
    return {
      record,
      member: who,
      item,
      sectionName: item ? sectionName.get(item.sectionId) : undefined,
    };
  };

  const scoped = store.certifications.filter((c) => scope.has(c.memberId));

  return {
    pending: scoped
      .filter((c) => c.status === "requested")
      .map(decorate)
      .filter((x): x is TrainingQueueItem => x !== null)
      // Oldest first — the ordering rule everywhere else in this app.
      .sort((a, b) => a.record.requestedAt.localeCompare(b.record.requestedAt)),
    expired: scoped
      .filter((c) => c.status === "expired")
      .map(decorate)
      .filter((x): x is TrainingQueueItem => x !== null)
      .sort((a, b) =>
        (a.record.expiresAt ?? "").localeCompare(b.record.expiresAt ?? "")
      ),
  };
}

/**
 * The catalogue itself, for the Co-Lead editor in Settings.
 *
 * Deliberately separate from `getTrainings`, which is one person's record.
 * Two different questions with two different audiences — and mixing them is
 * what put a club-wide "retire this machine" button on a row inside somebody's
 * personal training list.
 *
 * Retired items are INCLUDED here and nowhere else: this is the only screen
 * that can bring one back.
 */
export async function getCatalogue(): Promise<{
  sections: { section: TrainingSection; items: CatalogueItem[] }[];
  sectionOptions: { id: string; name: string }[];
}> {
  await preloadLiveStore();

  return {
    sections: trainingSections().map((section) => ({
      section,
      items: catalogueItemsFor(section.id),
    })),
    sectionOptions: trainingSections().map((s) => ({ id: s.id, name: s.name })),
  };
}

/*
  `getClearanceIndex` used to live here — a flat club-wide index answering
  "who can run the laser cutter?".

  `getTrainings` already resolves `clearedMembers` per catalogue row, and the
  standalone /trainings page it was built for is gone (trainings moved onto the
  member profile). Two ways to compute the same answer is how they drift.
*/
