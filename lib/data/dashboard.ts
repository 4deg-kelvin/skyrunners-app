/**
 * The leadership dashboard, in one call.
 *
 * PHASE 1 NOTE: `compliance` and `hoursThisWeek` map onto the
 * `v_update_compliance` and `v_member_hours_weekly` views in
 * docs/DATA_MODEL.md. Define those views to match these shapes exactly and this
 * function becomes two selects.
 */

import {
  activeMembers,
  atRiskProjects,
  awaitingReview,
  club,
  divisions,
  getMember,
  getProject,
  hoursThisWeek,
  projects,
  updateCompliance,
} from "@/lib/mock-data";
import type {
  Member,
  Project,
  ProgressUpdate,
  UpdateEntry,
} from "@/lib/types";

export interface ReviewQueueItem {
  update: ProgressUpdate;
  author?: Member;
  /** Each entry paired with its project, so the UI never has to look it up. */
  sections: { entry: UpdateEntry; project?: Project }[];
}

export interface FlaggedProject {
  project: Project;
  res: Member[];
}

export interface DashboardView {
  club: typeof club;
  counts: {
    members: number;
    divisions: number;
    projects: number;
  };
  compliance: ReturnType<typeof updateCompliance>;
  hoursThisWeek: number;
  reviewQueue: ReviewQueueItem[];
  flaggedProjects: FlaggedProject[];
}

export async function getDashboard(): Promise<DashboardView> {
  const reviewQueue: ReviewQueueItem[] = awaitingReview().map((update) => ({
    update,
    author: getMember(update.memberId),
    sections: update.entries.map((entry) => ({
      entry,
      project: getProject(entry.projectId),
    })),
  }));

  const flaggedProjects: FlaggedProject[] = atRiskProjects().map((project) => ({
    project,
    res: project.reIds
      .map((id) => getMember(id))
      .filter((m): m is Member => m !== undefined),
  }));

  return {
    club,
    counts: {
      members: activeMembers().length,
      divisions: divisions().length,
      projects: projects.length,
    },
    compliance: updateCompliance(),
    hoursThisWeek: hoursThisWeek(),
    reviewQueue,
    flaggedProjects,
  };
}
