/**
 * Every deadline in the club, laid out per division.
 *
 * ---------------------------------------------------------------------------
 * What this replaces, and why it's this small
 * ---------------------------------------------------------------------------
 *
 * Phase 11 was "milestones" — a separate entity with its own table, its own
 * CRUD, and its own upkeep. Anish dropped it on 2026-08-09 for the right
 * reason: **the milestones ARE the deadlines.** A project's target date and its
 * deliverables' due dates are already maintained, already accurate, and already
 * the things people plan against. A parallel list of milestones would be a
 * second thing to keep current, and the second thing is always the wrong one.
 *
 * So this computes, it doesn't store. Nothing to create, nothing to maintain,
 * nothing to go stale — if a due date moves, this moved with it.
 *
 * It is deliberately NOT a Gantt chart. No dependencies, no critical path, no
 * bars to drag. Those were rejected in `DECISIONS.md` and the reasoning hasn't
 * changed: on a volunteer team whose availability swings with midterms, a
 * dependency graph is wrong the day after it's entered, and a wrong schedule is
 * worse than none because people plan against it.
 *
 * What it does answer, which nothing else did: *are three divisions all landing
 * something the same week?*
 */

import {
  divisionForProject,
  divisions,
  getMember,
  getProject,
  projectProgress,
  today,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { preloadLiveStore } from "@/lib/store/request";
import { projectTone, type GanttRow } from "@/lib/gantt";
import type { Member, Project, Team } from "@/lib/types";

/** A project target date, or a deliverable due date. Same shape either way. */
export interface DeadlineItem {
  key: string;
  kind: "project" | "deliverable";
  title: string;
  date: string;
  /** The project this belongs to — its own, or the deliverable's parent. */
  project: Project;
  /** Who's accountable. The PL for a project, the owner for a deliverable. */
  owner?: Member;
  daysAway: number;
  overdue: boolean;
  /** Already finished. Kept, greyed, so a completed run still reads as done. */
  done: boolean;
}

export interface DivisionDeadlines {
  division: Team;
  items: DeadlineItem[];
  /** Soonest live deadline, for ordering divisions by urgency. */
  nextDate?: string;
}

export interface DeadlinesView {
  divisions: DivisionDeadlines[];
  /**
   * Weeks that carry deadlines from more than one division.
   *
   * The single reason this page exists rather than people reading each project.
   * Three divisions all landing something the same week is invisible from any
   * one project page and is exactly what leadership needs to see coming.
   */
  collisions: { weekStart: string; divisionNames: string[]; count: number }[];
  /** Projects with no target date at all — can't be planned around. */
  undated: { project: Project; divisionName?: string }[];
  today: string;
}

/** What a division card shows beneath its project tree. */
export interface DivisionExtrasData {
  deadlines: DeadlineItem[];
  /**
   * The same dates as a picture.
   *
   * Sits above the list rather than replacing it: the chart answers "do these
   * land on top of each other", which a date-ordered list cannot, and the list
   * stays as the precise readout. Null when the division has no dated work —
   * an empty axis is worse than nothing.
   *
   * ROWS, not a built chart. The division chart lets the reader open the window
   * on a date of their choosing, and the whole layout has to be recomputed
   * against the new span — the window auto-fits the dates present, so it isn't
   * something a component can nudge after the fact. `buildGantt` is pure maths
   * over a handful of rows, so the client calls it on each change and there is
   * no round trip.
   */
  timelineRows: GanttRow[] | null;
  /**
   * The same rows with finished projects dropped, for the page's Hide-completed
   * switch. Null when hiding completed work would leave nothing to draw.
   */
  timelineLiveRows: GanttRow[] | null;
  blocked: {
    projectId: string;
    projectSlug: string;
    projectName: string;
    count: number;
    worstAgeDays: number;
  }[];
}

/**
 * Deadlines and blocked work, keyed by division id.
 *
 * One pass over every project and deliverable, then a lookup per division —
 * rather than a function the page calls once per division card, which would
 * rescan everything five times.
 *
 * This is what `/deadlines` and `/blockers` became. Both were real pages for a
 * day; both were the wrong size. A deadline is a property of a project and a
 * blocker is already flagged on the project row, so making each a destination
 * asked people to navigate away to learn something about the thing in front of
 * them. Now they're two collapsed strips under the tree.
 */
export async function getDivisionExtras(): Promise<
  Record<string, DivisionExtrasData>
> {
  const view = await getDeadlines();
  const store = readStore();
  const now = today();

  const out: Record<string, DivisionExtrasData> = {};

  for (const { division, items } of view.divisions) {
    out[division.id] = {
      deadlines: items,
      blocked: [],
      timelineRows: timelineFor(division.id, store.projects, now),
      timelineLiveRows: timelineFor(division.id, store.projects, now, true),
    };
  }

  // Blocked deliverables, grouped by project, then attributed to a division.
  const byProject = new Map<string, { count: number; worst: number }>();
  for (const deliverable of store.deliverables) {
    if (deliverable.status !== "blocked") continue;
    const existing = byProject.get(deliverable.projectId) ?? {
      count: 0,
      worst: 0,
    };
    existing.count += 1;
    // No "blocked at" column exists, so the due date is the closest honest
    // proxy for how long this has been stuck. Undated counts as new rather
    // than ancient — guessing old would push real week-old blockers down.
    const age = deliverable.dueDate
      ? Math.max(0, daysBetween(deliverable.dueDate, now))
      : 0;
    existing.worst = Math.max(existing.worst, age);
    byProject.set(deliverable.projectId, existing);
  }

  for (const [projectId, { count, worst }] of byProject) {
    const project = getProject(projectId);
    if (!project) continue;
    const division = divisionForProject(projectId);
    if (!division || !out[division.id]) continue;

    out[division.id].blocked.push({
      projectId,
      projectSlug: project.slug,
      projectName: project.name,
      count,
      worstAgeDays: worst,
    });
  }

  for (const entry of Object.values(out)) {
    entry.blocked.sort((a, b) => b.worstAgeDays - a.worstAgeDays);
  }

  return out;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Monday of the week containing `iso`. Monday-based, like the dashboard. */
function weekStartOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Every upcoming date, grouped by division.
 *
 * Internal now, not exported: `/deadlines` was a page for a day and folded
 * into the collapsed strip under each division, so `getDivisionExtras` is the
 * only caller. Left as its own function because the grouping is the awkward
 * part — a deliverable's division comes from its project, which may hang off a
 * sub-team rather than the division itself.
 */
async function getDeadlines(): Promise<DeadlinesView> {
  await preloadLiveStore();
  const store = readStore();
  const now = today();

  const itemsByDivision = new Map<string, DeadlineItem[]>();
  const push = (divisionId: string, item: DeadlineItem) => {
    const list = itemsByDivision.get(divisionId);
    if (list) list.push(item);
    else itemsByDivision.set(divisionId, [item]);
  };

  const undated: DeadlinesView["undated"] = [];

  for (const project of store.projects) {
    const division = divisionForProject(project.id);

    // A project target date is the biggest milestone the project has.
    if (project.targetDate) {
      if (division) {
        push(division.id, {
          key: `project:${project.id}`,
          kind: "project",
          title: project.name,
          date: project.targetDate,
          project,
          owner: getMember(project.primaryReId),
          daysAway: daysBetween(now, project.targetDate),
          overdue: project.targetDate < now && project.phase !== "complete",
          done: project.phase === "complete",
        });
      }
    } else if (project.phase !== "complete") {
      undated.push({ project, divisionName: division?.name });
    }
  }

  for (const deliverable of store.deliverables) {
    if (!deliverable.dueDate) continue;
    const project = getProject(deliverable.projectId);
    if (!project) continue;
    const division = divisionForProject(project.id);
    if (!division) continue;

    push(division.id, {
      key: `deliverable:${deliverable.id}`,
      kind: "deliverable",
      title: deliverable.title,
      date: deliverable.dueDate,
      project,
      owner: getMember(deliverable.ownerId),
      daysAway: daysBetween(now, deliverable.dueDate),
      overdue: deliverable.dueDate < now && deliverable.status !== "done",
      done: deliverable.status === "done",
    });
  }

  const byDivision: DivisionDeadlines[] = divisions()
    .map((division) => {
      const items = (itemsByDivision.get(division.id) ?? []).sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      return {
        division,
        items,
        nextDate: items.find((i) => !i.done && i.date >= now)?.date,
      };
    })
    .filter((d) => d.items.length > 0);

  // --- where two divisions land in the same week ---------------------------
  //
  // Only live, future work: a collision in a week that has already passed is
  // history, and a completed deliverable colliding with anything is noise.
  const weeks = new Map<string, Map<string, number>>();
  for (const { division, items } of byDivision) {
    for (const item of items) {
      if (item.done || item.date < now) continue;
      const week = weekStartOf(item.date);
      const perDivision = weeks.get(week) ?? new Map<string, number>();
      perDivision.set(division.name, (perDivision.get(division.name) ?? 0) + 1);
      weeks.set(week, perDivision);
    }
  }

  const collisions = [...weeks.entries()]
    .filter(([, perDivision]) => perDivision.size > 1)
    .map(([weekStart, perDivision]) => ({
      weekStart,
      divisionNames: [...perDivision.keys()].sort(),
      count: [...perDivision.values()].reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return {
    divisions: byDivision.sort((a, b) =>
      (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999")
    ),
    collisions,
    undated: undated.sort((a, b) =>
      a.project.name.localeCompare(b.project.name)
    ),
    today: now,
  };
}

/**
 * One division's projects as a timeline.
 *
 * Depth comes from walking the project tree rather than from a column, because
 * a sub-project's division is inherited: `teamId` may point at a sub-team, or
 * be unset entirely and resolved through the parent. Grouping by `teamId`
 * directly is the documented way to make projects vanish from this page.
 *
 * Ordered by the tree, not by date — a child must render under its parent or
 * the indentation says nothing. Date order is what the list underneath is for.
 */
function timelineFor(
  divisionId: string,
  allProjects: Project[],
  now: string,
  /**
   * Drop finished work.
   *
   * A parent is only dropped if everything under it is finished too — a
   * completed project with live sub-projects still has to render, or its
   * children lose the row they're indented beneath and the nesting says
   * nothing.
   */
  liveOnly = false
): GanttRow[] | null {
  let mine = allProjects.filter(
    (p) => divisionForProject(p.id)?.id === divisionId
  );

  if (liveOnly) {
    const hasLiveDescendant = (id: string): boolean =>
      mine.some(
        (c) =>
          c.parentId === id &&
          (c.phase !== "complete" || hasLiveDescendant(c.id))
      );
    mine = mine.filter(
      (p) => p.phase !== "complete" || hasLiveDescendant(p.id)
    );
  }
  if (mine.length === 0) return null;

  const byParent = new Map<string | null, Project[]>();
  for (const p of mine) {
    // A project whose parent sits in another division is a root HERE, or it
    // would never be reached and would silently vanish from the chart.
    const parentId =
      p.parentId && mine.some((m) => m.id === p.parentId) ? p.parentId : null;
    const list = byParent.get(parentId);
    if (list) list.push(p);
    else byParent.set(parentId, [p]);
  }

  const rows: GanttRow[] = [];
  const seen = new Set<string>();

  const walk = (parentId: string | null, depth: number) => {
    const children = [...(byParent.get(parentId) ?? [])].sort((a, b) =>
      (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999")
    );
    for (const project of children) {
      // Cycle guard, same as everywhere else that walks this tree: `parent_id`
      // is a plain column and a loop would hang the request.
      if (seen.has(project.id)) continue;
      seen.add(project.id);

      const progress = projectProgress(project.id);
      rows.push({
        id: project.id,
        name: project.name,
        href: `/projects/${project.slug}`,
        start: project.startDate,
        end: project.targetDate,
        depth,
        tone: projectTone(
          project.phase,
          project.health,
          !!project.targetDate && project.targetDate < now
        ),
        progress: progress.total > 0 ? progress.fraction : undefined,
        kind: "project",
      });
      walk(project.id, depth + 1);
    }
  };
  walk(null, 0);

  // Nothing dated at all draws an axis with no information on it.
  if (!rows.some((r) => r.start || r.end)) return null;
  return rows;
}
