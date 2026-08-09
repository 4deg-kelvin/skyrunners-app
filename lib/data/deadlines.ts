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
  today,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { preloadLiveStore } from "@/lib/store/request";
import type { Member, Project, Team } from "@/lib/types";

/** A project target date, or a deliverable due date. Same shape either way. */
export interface DeadlineItem {
  key: string;
  kind: "project" | "deliverable";
  title: string;
  date: string;
  /** The project this belongs to — its own, or the deliverable's parent. */
  project: Project;
  /** Who's accountable. The RE for a project, the owner for a deliverable. */
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

export async function getDeadlines(): Promise<DeadlinesView> {
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
          overdue:
            project.targetDate < now && project.phase !== "complete",
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
