/**
 * Resources — standing context a client can attach and refresh.
 *
 * Different from tools, and the difference is the point. A tool is something
 * the model DECIDES to call; a resource is something the human pins so it's
 * simply there. "Keep me up to date on what everyone in Drone Hacks is working
 * on" is a resource, and asking a model to remember to poll a tool is not the
 * same thing.
 *
 * One caveat worth stating out loud, because it disappoints people: **MCP
 * cannot push.** Attaching `skyrunners://division/drone-hacks` does not make
 * an assistant speak up when something breaks — the client re-reads it when it
 * next runs. For genuinely proactive alerts the club already has the Discord
 * DM on a raised blocker, which needs no website and no AI.
 *
 * Same privacy rule as the tools: nothing here contains another member's
 * effort data. See the header of `lib/mcp/viewer.ts`.
 */

import { readStore } from "@/lib/store/disk";
import {
  getMember,
  getProject,
  projectAttentionFlags,
  projectDeliverables,
  projectsNeedingAttention,
  today,
} from "@/lib/mock-data";
import { ATTENTION_LABELS, PHASE_LABELS } from "@/lib/labels";
import { getMyWork } from "@/lib/data/my-work";
import type { McpViewer } from "./viewer";

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

const MINE = "skyrunners://me/work";
const BLOCKED = "skyrunners://club/blocked";
const DIVISION_PREFIX = "skyrunners://division/";

/**
 * What this member can attach.
 *
 * Divisions are enumerated rather than offered as a URI template, because a
 * template makes the client guess a slug and a wrong guess reads as a broken
 * server. Thirty-odd projects across five divisions is a short list.
 */
export function listResources(): McpResource[] {
  const divisions = readStore()
    .teams.filter((t) => t.parentId === null && t.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  return [
    {
      uri: MINE,
      name: "My work",
      description:
        "What you own and owe right now — your open deliverables, what's overdue, and the projects you're on.",
      mimeType: "text/markdown",
    },
    {
      uri: BLOCKED,
      name: "Everything blocked",
      description:
        "Blocked deliverables and projects needing attention across the whole club.",
      mimeType: "text/markdown",
    },
    ...divisions.map((d) => ({
      uri: `${DIVISION_PREFIX}${d.slug}`,
      name: `${d.name} — status`,
      description: `Every project in ${d.name}: who's on it, what's blocked, what's due. Attach this to keep an assistant current on the division.`,
      mimeType: "text/markdown",
    })),
  ];
}

export async function readResource(
  uri: string,
  viewer: McpViewer
): Promise<string | null> {
  if (uri === MINE) return myWork(viewer);
  if (uri === BLOCKED) return blocked();
  if (uri.startsWith(DIVISION_PREFIX)) {
    return divisionStatus(uri.slice(DIVISION_PREFIX.length));
  }
  return null;
}

async function myWork(viewer: McpViewer): Promise<string> {
  const view = await getMyWork(viewer.member.id);
  const now = today();
  const out = [`# ${viewer.member.fullName} — work as of ${now}`, ""];

  for (const card of view.committed) {
    const open = card.myDeliverables.filter((d) => d.status !== "done");
    out.push(
      `## ${card.project.name} — ${PHASE_LABELS[card.project.phase]}, ${card.project.health.replace("_", " ")}`
    );
    if (!open.length) out.push("- Nothing open for you here.");
    for (const d of open) {
      const late = d.dueDate && d.dueDate < now ? " **OVERDUE**" : "";
      out.push(
        `- ${d.title} — ${d.status.replace("_", " ")}${d.dueDate ? `, due ${d.dueDate}` : ""}${late}`
      );
    }
    out.push("");
  }

  if (!view.committed.length) {
    out.push(
      "Not committed to any project yet. Ask an RE, or use `find_work`."
    );
  }
  return out.join("\n");
}

function blocked(): string {
  const store = readStore();
  const stuck = store.deliverables.filter((d) => d.status === "blocked");
  const flagged = projectsNeedingAttention();

  const out = [`# Blocked across the club — ${today()}`, ""];

  out.push(`## Blocked deliverables (${stuck.length})`);
  if (!stuck.length) out.push("- Nothing blocked.");
  for (const d of stuck) {
    out.push(
      `- ${d.title} — ${getMember(d.ownerId)?.fullName ?? "unassigned"} on ${getProject(d.projectId)?.name}${d.blockerNote ? `: ${d.blockerNote}` : ""}`
    );
  }

  out.push("", `## Projects needing attention (${flagged.length})`);
  if (!flagged.length) out.push("- None.");
  for (const p of flagged) {
    const why = projectAttentionFlags()
      .filter((f) => f.projectId === p.id)
      .map((f) => ATTENTION_LABELS[f.reason])
      .join("; ");
    out.push(
      `- ${p.name} — ${p.health.replace("_", " ")}${why ? `; ${why}` : ""}`
    );
  }

  return out.join("\n");
}

function divisionStatus(slug: string): string | null {
  const store = readStore();
  const division = store.teams.find((t) => t.slug === slug && t.isActive);
  if (!division) return null;

  /*
    Walk the ORG tree down first, then match projects by team. A project's
    `teamId` can point at a sub-team rather than the division itself, and
    matching the division id directly would silently hide exactly the projects
    a sub-team is running — see CLAUDE.md §5.
  */
  const teamIds = new Set<string>([division.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of store.teams) {
      if (t.parentId && teamIds.has(t.parentId) && !teamIds.has(t.id)) {
        teamIds.add(t.id);
        grew = true;
      }
    }
  }

  const projects = store.projects.filter(
    (p) => p.teamId && teamIds.has(p.teamId) && p.phase !== "complete"
  );

  const lead = division.leadId ? getMember(division.leadId) : undefined;
  const out = [
    `# ${division.name} — ${today()}`,
    lead ? `Division Lead: ${lead.fullName}` : "No Division Lead set.",
    "",
  ];

  if (!projects.length) out.push("No active projects.");

  for (const p of projects) {
    const deliverables = projectDeliverables(p.id);
    const open = deliverables.filter((d) => d.status !== "done");
    const stuck = deliverables.filter((d) => d.status === "blocked");
    const people = store.projectMemberships
      .filter((m) => m.projectId === p.id && m.commitment === "committed")
      .map((m) => getMember(m.memberId)?.fullName)
      .filter(Boolean);

    out.push(
      `## ${p.name}`,
      `${PHASE_LABELS[p.phase]} · ${p.health.replace("_", " ")}${p.targetDate ? ` · target ${p.targetDate}` : ""}`,
      `On it: ${people.join(", ") || "nobody yet"}`
    );

    if (open.length) {
      out.push("Open work:");
      for (const d of open) {
        out.push(
          `- ${d.title} — ${getMember(d.ownerId)?.fullName ?? "unassigned"}${d.dueDate ? `, due ${d.dueDate}` : ""}${
            d.status === "blocked"
              ? ` — BLOCKED: ${d.blockerNote ?? "no note"}`
              : ""
          }`
        );
      }
    } else {
      out.push("No open deliverables.");
    }

    if (stuck.length) out.push(`**${stuck.length} blocked.**`);
    out.push("");
  }

  return out.join("\n");
}
