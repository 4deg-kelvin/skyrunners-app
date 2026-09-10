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
 * All four combinations, as of 2026-09-09:
 *
 *   deliverable → deliverable   "my layup waits on your mould"
 *   project     → project       "load testing waits on the spar redesign"
 *   deliverable → project       "the coupon report waits on layup qualification"
 *   project     → deliverable   "the walls wait on the floor plan being signed"
 *
 * The last one was refused for a day, on the argument that a whole project
 * waiting on one person's single task inverts the sizes. Real data disproved it:
 * the available workaround was to wait on the whole sibling PROJECT instead,
 * which warns against that project's target date rather than the deliverable's
 * — so the coarser link reads as landing weeks later than the thing actually
 * being waited for. A refusal that pushes people towards a wronger answer is
 * not a guardrail. Migration `0056` dropped the CHECK.
 *
 * ---------------------------------------------------------------------------
 * Scope: one top-level project's tree
 * ---------------------------------------------------------------------------
 *
 * **Everything in scope lives under the same top-level project** — the one
 * sitting directly under a division. Nothing reaches sideways into another
 * top-level project, at any depth.
 *
 * This replaced "siblings and ancestors" on 2026-09-09, and the reason is worth
 * keeping because it is a general trap. That rule was correct in the middle of a
 * tree and wrong at the top, where every top-level project is a "sibling" of
 * every other — so a deliverable on one course was offered every unrelated
 * project in the club, seven of them, as things it might be waiting for. The
 * rule was right about the relationship and wrong about what the relationship
 * MEANS at the root. When a scope rule is phrased in tree terms, check what it
 * degenerates to at both ends of the tree.
 *
 * Within that tree, one asymmetry, and both halves have reasons:
 *
 *   - **A project may wait on its own ancestors** (warned, never refused). The
 *     club chose this. A sub-project's target can never be after its parent's,
 *     which `updateProject` enforces, so such a link ALWAYS shows a date
 *     conflict. That is informative rather than annoying — it is the shape of a
 *     link somebody probably did not mean — and it costs nothing, because
 *     nothing here blocks.
 *   - **A project may NOT wait on its own descendants.** `updateProject`
 *     already refuses to complete a parent while a child is unfinished, so a
 *     link there is a second hand-maintained copy of a rule the database
 *     enforces, and the two disagree the moment one is edited.
 *
 * A DELIVERABLE gets the descendants back, and that is deliberate. It is not a
 * container of anything, so no tree rule covers it: "I can't book the room until
 * the floor-design sub-project lands" is a real sentence with no database rule
 * saying it already. What a deliverable may not wait on is its OWN project —
 * that one is its container, and the project is not finished until its
 * deliverables are.
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
 * The top-level project a project sits under — the one directly below a
 * division. Its own id when it is already top-level.
 *
 * This is the boundary of every scope decision below, so it is the one function
 * to get right. Cycle-guarded via `ancestorsOf`.
 */
export function rootProjectIdOf(
  projectId: string,
  projects: Project[]
): string | undefined {
  const byId = new Map(projects.map((p) => [p.id, p]));
  if (!byId.has(projectId)) return undefined;

  const chain = ancestorsOf(projectId, byId);
  return chain.length ? chain[chain.length - 1].id : projectId;
}

/**
 * Every project under the same top-level project, including it — the "tree"
 * that scope is confined to.
 *
 * Walks DOWN from the root rather than testing each project's chain upwards,
 * so the cycle guard is one `seen` set instead of one per candidate.
 */
function treeIdsOf(projectId: string, projects: Project[]): Set<string> {
  const rootId = rootProjectIdOf(projectId, projects);
  if (!rootId) return new Set();

  const childrenOf = new Map<string, string[]>();
  for (const p of projects) {
    const parent = p.parentId ?? null;
    if (!parent) continue;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), p.id]);
  }

  const out = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }
  return out;
}

/** A project's descendants, not including itself. Cycle-guarded. */
export function descendantIdsOf(
  projectId: string,
  projects: Project[]
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const p of projects) {
    const parent = p.parentId ?? null;
    if (!parent) continue;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), p.id]);
  }

  const out = new Set<string>();
  const queue = [...(childrenOf.get(projectId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (out.has(id) || id === projectId) continue;
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }
  return out;
}

/**
 * Projects that something living at `projectId` may wait on.
 *
 * `dependentKind` changes the answer, which is the whole reason it is an
 * argument rather than being inferred:
 *
 *   - **project** — the tree, minus itself and minus its own descendants. The
 *     descendants are already covered by `updateProject`'s completion rule.
 *   - **deliverable** — the tree, minus the project it lives on. A deliverable
 *     is not a container, so its project's sub-projects are fair game; its own
 *     project is not, because that IS its container.
 *
 * Completed projects are included deliberately: recording that you waited on
 * something already finished is how a dependency stops being a warning, and
 * deleting the row is not the only honest way to say "that's done".
 */
export function eligibleProjectTargets(
  projectId: string,
  projects: Project[],
  dependentKind: DependencyEndKind = "project"
): Project[] {
  const tree = treeIdsOf(projectId, projects);
  if (tree.size === 0) return [];

  const excluded = new Set<string>([projectId]);
  if (dependentKind === "project") {
    for (const id of descendantIdsOf(projectId, projects)) excluded.add(id);
  }

  return projects
    .filter((p) => tree.has(p.id) && !excluded.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Deliverables that something living at `homeProjectId` may wait on.
 *
 * Every deliverable on an in-scope project, plus — for a deliverable dependent
 * — the others on its own project, which is the commonest real case by far
 * (design the mould, machine the mould, do the layup). A project dependent does
 * NOT get its own deliverables: they are its own work, and it is not finished
 * until they are.
 *
 * This used to be same-project-only, on the argument that reaching across a
 * boundary should go through the PROJECT rather than one row inside it, since
 * the other PL may split or rename their deliverables at any time. That risk is
 * real and is now carried instead by the cascade on the foreign key: if the
 * target deliverable is deleted, the link goes with it rather than dangling.
 */
export function eligibleDeliverableTargets(input: {
  dependentKind: DependencyEndKind;
  dependentId: string;
  homeProjectId: string;
  projects: Project[];
  deliverables: Deliverable[];
}): Deliverable[] {
  const scope = new Set(
    eligibleProjectTargets(
      input.homeProjectId,
      input.projects,
      input.dependentKind
    ).map((p) => p.id)
  );
  if (input.dependentKind === "deliverable") scope.add(input.homeProjectId);

  /*
    This project's own work first, then everywhere else, grouped by project.

    A flat alphabetical list interleaved them, so "Material selection and BOM"
    on this project sat between two same-named items on sibling projects and the
    only way to tell them apart was the attribution suffix — on a course with
    six sub-projects that is a list nobody reads, and the commonest case by far
    (waiting on something on your own project) was scattered through it.

    Within the "elsewhere" group the key is the project NAME rather than its id,
    so the run of items under one project is contiguous AND the projects
    themselves come in the order the picker's project list uses.
  */
  const nameOfProject = new Map(input.projects.map((p) => [p.id, p.name]));

  return input.deliverables
    .filter((d) => scope.has(d.projectId) && d.id !== input.dependentId)
    .sort((a, b) => {
      const own = (d: Deliverable) =>
        d.projectId === input.homeProjectId ? 0 : 1;
      return (
        own(a) - own(b) ||
        (nameOfProject.get(a.projectId) ?? "").localeCompare(
          nameOfProject.get(b.projectId) ?? ""
        ) ||
        a.title.localeCompare(b.title)
      );
    });
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
