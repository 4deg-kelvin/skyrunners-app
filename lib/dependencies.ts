/**
 * ============================================================================
 * Dependencies — "this is waiting on that", declared and displayed
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * What this is NOT, because the docs rejected that thing
 * ---------------------------------------------------------------------------
 *
 * `docs/DECISIONS.md` and the header of `lib/gantt.ts` both rule out a
 * critical-path Gantt, and the reasoning is worth restating because it still
 * holds: on a volunteer team whose availability swings with midterms, a
 * schedule COMPUTED from a dependency graph is wrong the day after it is
 * entered, and a wrong schedule is worse than none because people plan
 * against it.
 *
 * This is not that. The distinction is the whole design:
 *
 *   - **Nothing here computes a date.** No slack, no earliest-start, no
 *     critical path, no reflow when a date moves. A dependency is a fact a PL
 *     wrote down, and it is displayed. That is all.
 *   - **Nothing here blocks work.** A dependency never refuses a sign-off or a
 *     completion. The club chose "show it, and warn on date conflicts" over
 *     enforcement precisely because a stale link would otherwise deadlock real
 *     work until somebody went and deleted it.
 *   - **A stale link is visibly stale**, not silently wrong: if the thing you
 *     wait on lands after you do, that is drawn and stated. The failure mode is
 *     a visible contradiction rather than a confident lie.
 *
 * The honest cost, stated once: this IS new upkeep, which the rejected feature
 * was rejected for. What makes it acceptable is that letting it rot degrades to
 * "a note that looks wrong" rather than to "a schedule that is wrong".
 *
 * ---------------------------------------------------------------------------
 * What can wait on what
 * ---------------------------------------------------------------------------
 *
 * Three of the four combinations, chosen by the club on 2026-09-08:
 *
 *   deliverable → deliverable   "my layup waits on your mould"
 *   project     → project       "load testing waits on the spar redesign"
 *   deliverable → project       "the coupon report waits on layup qualification"
 *
 * **project → deliverable is deliberately absent.** A whole project waiting on
 * one person's single task inverts the sizes: if a project genuinely hinges on
 * one deliverable, the honest model is that the deliverable belongs to that
 * project, or that the two projects depend on each other.
 *
 * ---------------------------------------------------------------------------
 * Scope: siblings and ancestors
 * ---------------------------------------------------------------------------
 *
 * A project may wait on a project that shares its parent, or on one of its own
 * ancestors. Nothing else — not another division's work, and not its own
 * descendants.
 *
 * Descendants are excluded because the tree already says it: `updateProject`
 * refuses to complete a parent while any descendant is unfinished. A link there
 * would be a second, hand-maintained copy of a rule the database enforces, and
 * the two would disagree the moment one was edited.
 *
 * Ancestors are allowed because the club asked for them, and they are worth a
 * warning rather than a refusal: a sub-project's target date can never be after
 * its parent's (`updateProject` enforces that too), so waiting on your own
 * ancestor ALWAYS produces a date conflict. That is informative — it is the
 * shape of a link somebody probably did not mean — and it costs nothing to
 * allow, because nothing here blocks.
 */

import type {
  Deliverable,
  Dependency,
  DependencyEndKind,
  Project,
} from "@/lib/types";

/*
  The TYPES live in `lib/types.ts` with every other store shape; the RULES live
  here. Re-exported so a caller needs one import rather than two, and so the
  split does not leak into every consumer.
*/
export type { Dependency, DependencyEndKind };

/** The three legal shapes. `project → deliverable` is not one of them. */
export function isLegalPair(
  dependentKind: DependencyEndKind,
  targetKind: DependencyEndKind
): boolean {
  if (dependentKind === "project" && targetKind === "deliverable") return false;
  return true;
}

/**
 * A project's ancestor chain, nearest first. Cycle-guarded.
 *
 * `parent_id` is a plain column, so a loop is representable and would hang the
 * request rather than fail it — the same reason `projectChain` and `teamChain`
 * in `lib/permissions.ts` carry a `seen` set.
 */
export function ancestorsOf(
  projectId: string,
  byId: Map<string, Project>
): Project[] {
  const out: Project[] = [];
  const seen = new Set<string>([projectId]);

  let current = byId.get(projectId)?.parentId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    out.push(parent);
    current = parent.parentId ?? null;
  }
  return out;
}

/**
 * Projects this project may wait on: its siblings, and its ancestors.
 *
 * A top-level project's "siblings" are the other top-level projects — both have
 * `parentId` undefined, so they share a parent in the only sense the tree has.
 * Completed projects are included deliberately: recording that you waited on
 * something already finished is how a dependency stops being a warning, and
 * removing the row is not the only honest way to say "that's done".
 */
export function eligibleProjectTargets(
  projectId: string,
  projects: Project[]
): Project[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const self = byId.get(projectId);
  if (!self) return [];

  const ancestorIds = new Set(ancestorsOf(projectId, byId).map((p) => p.id));

  return projects
    .filter((p) => {
      if (p.id === projectId) return false;
      if (ancestorIds.has(p.id)) return true;
      // Siblings: same parent, including "both top-level".
      return (p.parentId ?? null) === (self.parentId ?? null);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Deliverables a deliverable may wait on: the others on its own project.
 *
 * Same-project only, which is what "siblings" means for a deliverable. It also
 * happens to be the common real case — design the mould, machine the mould, do
 * the layup are three deliverables on one project — and it keeps the picker to
 * a list somebody can actually read.
 *
 * Reaching another project's deliverables is available through the
 * `deliverable → project` shape instead: wait on the project, not on one row
 * inside it. That is the more honest granularity across a boundary, because the
 * other project's PL may split or rename their deliverables at any time.
 */
export function eligibleDeliverableTargets(
  deliverableId: string,
  projectId: string,
  deliverables: Deliverable[]
): Deliverable[] {
  return deliverables
    .filter((d) => d.projectId === projectId && d.id !== deliverableId)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** One end of a dependency, as an opaque key. */
function endKey(kind: DependencyEndKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Would adding this link create a cycle?
 *
 * Walks the existing graph forward from the proposed TARGET, looking for the
 * proposed dependent. Cheap because the graph is tiny, and necessary because a
 * cycle is what turns "show what you wait on" into an infinite regress in any
 * renderer that follows the chain.
 *
 * Note this only guards the DECLARED graph. A project waiting on its own
 * ancestor is not a cycle here — the tree's completion rule is a separate
 * relationship — and it is allowed, with a warning. See the header.
 */
export function wouldCycle(
  proposed: {
    dependentKind: DependencyEndKind;
    dependentId: string;
    targetKind: DependencyEndKind;
    targetId: string;
  },
  existing: Dependency[]
): boolean {
  const from = endKey(proposed.dependentKind, proposed.dependentId);
  const start = endKey(proposed.targetKind, proposed.targetId);
  if (from === start) return true;

  const edges = new Map<string, string[]>();
  for (const d of existing) {
    const a = endKey(d.dependentKind, d.dependentId);
    const b = endKey(d.targetKind, d.targetId);
    edges.set(a, [...(edges.get(a) ?? []), b]);
  }

  const queue = [start];
  const seen = new Set<string>();
  while (queue.length) {
    const node = queue.shift()!;
    if (node === from) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of edges.get(node) ?? []) queue.push(next);
  }
  return false;
}

export interface ResolvedDependency {
  dependency: Dependency;
  /** Display name of the thing being waited on. */
  targetName: string;
  targetKind: DependencyEndKind;
  /** Where to click through to, when the target has a page. */
  targetHref?: string;
  /** The target's own date — a project's target date, a deliverable's due date. */
  targetDate?: string;
  /** Whether the target is already finished, which makes the link moot. */
  targetDone: boolean;
  /**
   * The date conflict, when there is one: the thing you wait on lands AFTER
   * you are due.
   *
   * Undefined when either side has no date. That is the honest answer rather
   * than treating "undated" as "fine" — the warning claims a comparison, and
   * with a date missing there is nothing to compare.
   */
  conflict?: {
    /** The dependent's own date. */
    dueOn: string;
    /** The target's date, which is later. */
    waitingUntil: string;
    /** How many days late, for the wording. */
    days: number;
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Turn stored rows into something renderable, with the date check applied.
 *
 * `ownDate` is the dependent's own date — the caller knows whether that is a
 * project's target or a deliverable's due date, so it is passed rather than
 * re-derived here.
 *
 * A finished target never conflicts, whatever the dates say. Something that is
 * already done cannot make you late, and warning about it is how a panel
 * becomes noise a PL learns to skip.
 */
export function resolveDependencies(input: {
  dependencies: Dependency[];
  ownKind: DependencyEndKind;
  ownId: string;
  ownDate?: string;
  projects: Project[];
  deliverables: Deliverable[];
}): ResolvedDependency[] {
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  const deliverableById = new Map(input.deliverables.map((d) => [d.id, d]));

  const mine = input.dependencies.filter(
    (d) => d.dependentKind === input.ownKind && d.dependentId === input.ownId
  );

  const out: ResolvedDependency[] = [];

  for (const dependency of mine) {
    let targetName: string | undefined;
    let targetHref: string | undefined;
    let targetDate: string | undefined;
    let targetDone = false;

    if (dependency.targetKind === "project") {
      const p = projectById.get(dependency.targetId);
      if (!p) continue; // row outlived its target; nothing honest to draw
      targetName = p.name;
      targetHref = `/projects/${p.slug}`;
      targetDate = p.targetDate;
      targetDone = p.phase === "complete";
    } else {
      const d = deliverableById.get(dependency.targetId);
      if (!d) continue;
      targetName = d.title;
      targetDate = d.dueDate;
      targetDone = d.status === "done";
    }

    let conflict: ResolvedDependency["conflict"];
    if (
      !targetDone &&
      input.ownDate &&
      targetDate &&
      targetDate > input.ownDate
    ) {
      conflict = {
        dueOn: input.ownDate,
        waitingUntil: targetDate,
        days: daysBetween(input.ownDate, targetDate),
      };
    }

    out.push({
      dependency,
      targetName,
      targetKind: dependency.targetKind,
      targetHref,
      targetDate,
      targetDone,
      ...(conflict ? { conflict } : {}),
    });
  }

  /*
    Conflicts first, then unfinished, then done. The list is a thing to act on,
    so the row that needs acting on should not be third.
  */
  return out.sort((a, b) => {
    const rank = (r: ResolvedDependency) =>
      r.conflict ? 0 : r.targetDone ? 2 : 1;
    return rank(a) - rank(b) || a.targetName.localeCompare(b.targetName);
  });
}
