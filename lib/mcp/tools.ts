/**
 * The tools an AI client can call.
 *
 * ===========================================================================
 * Three rules, and they are the whole design
 * ===========================================================================
 *
 * 1. **This is an adapter, not a second permission layer.** Every tool calls
 *    the same `lib/data/*` readers and the same `can.*` checks the website
 *    uses. There is no `globalRole ===` in this file and there never should
 *    be. `lib/permissions.ts` has 50+ tests on three inheritances that run in
 *    different directions; a second copy nobody tests — called by a model that
 *    will try every tool to see what sticks — is the worst place to duplicate
 *    that logic.
 *
 * 2. **No tool returns another member's effort data.** No hours, no check-in
 *    contents, no reliability, no personal report. See the header of
 *    `lib/mcp/viewer.ts`: the MCP snapshot is loaded past RLS, so the privacy
 *    boundary is enforced by which tools EXIST rather than by a filter that
 *    could be wrong. Restricted questions answer "use the website".
 *
 * 3. **Output is prose, not JSON.** A model reads `Wing Spar — blocked, due
 *    Fri, Tyler` far better than a nested object, and it costs a third of the
 *    tokens. Tools call the page-shaped `lib/data/*` view models and then
 *    NARROW them. Narrowing is fine; re-querying is not.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately absent
 * ---------------------------------------------------------------------------
 *
 * Anything destructive or identity-shaped: deleting projects or members,
 * archiving divisions, changing someone's role or Lead, editing club settings,
 * commitment tiers or the academic calendar, removing people from projects,
 * and withdrawing a sign-off. Each is rare, hard to undo, and fine to do on a
 * website twice a term.
 *
 * Submitting a check-in is absent for a different reason: the point of a
 * check-in is to prompt a conversation with your Lead, and one an assistant
 * wrote on your behalf is worse than none. Logging hours IS here — that's
 * bookkeeping, and making it frictionless is the whole reason to have an MCP.
 */

import { getFindWork } from "@/lib/data/find-work";
import { getMyWork } from "@/lib/data/my-work";
import { getRoster } from "@/lib/data/members";
import { getProjectBySlug, getProjectTree } from "@/lib/data/projects";
import { getUpcomingEvents } from "@/lib/data/events";
import { can, isLeadership } from "@/lib/permissions";
import * as ops from "@/lib/store/operations";
import { readStore } from "@/lib/store/disk";
import {
  memberProjects,
  projectAttentionFlags,
  projectDeliverables,
  projectsNeedingAttention,
  today,
  getMember,
  getProject,
} from "@/lib/mock-data";
import { ATTENTION_LABELS, PHASE_LABELS } from "@/lib/labels";
import { detectArtifactKind } from "@/lib/artifacts";
import { formatDay } from "@/lib/dates";
import { GUIDE_TOPICS, guideFor, isGuideTopic } from "./guide";
import type { McpViewer } from "./viewer";

// ---------------------------------------------------------------------------
// Tool plumbing
// ---------------------------------------------------------------------------

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Write tools need a `write`-scoped token; reads work with either. */
  write?: boolean;
  handler(args: Record<string, unknown>, viewer: McpViewer): Promise<string>;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | undefined =>
  typeof v === "number"
    ? v
    : typeof v === "string" && v
      ? Number(v)
      : undefined;

function schema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

/** Thrown by a tool to produce a clean refusal rather than a stack trace. */
export class ToolRefusal extends Error {}

function refuse(message: string): never {
  throw new ToolRefusal(message);
}

function requireProject(slugOrId: string) {
  const store = readStore();
  const match = store.projects.find(
    (p) => p.slug === slugOrId || p.id === slugOrId
  );
  if (!match) {
    refuse(
      `No project called "${slugOrId}". Call list_projects to see the exact names and slugs.`
    );
  }
  return match;
}

function requireMember(nameOrId: string) {
  const store = readStore();
  const needle = nameOrId.toLowerCase();
  const matches = store.members.filter(
    (m) =>
      m.id === nameOrId ||
      m.email.toLowerCase() === needle ||
      m.fullName.toLowerCase() === needle ||
      (m.preferredName ?? "").toLowerCase() === needle
  );

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    refuse(
      `"${nameOrId}" matches ${matches.length} people. Use their email instead.`
    );
  }

  // Fall back to a contains-match so "tyler" works, but never guess between
  // two people — assigning work to the wrong person is exactly the mistake an
  // agent should not make silently.
  const loose = store.members.filter((m) =>
    m.fullName.toLowerCase().includes(needle)
  );
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) {
    refuse(
      `"${nameOrId}" could be ${loose.map((m) => m.fullName).join(", ")}. Use their email.`
    );
  }
  refuse(`Nobody in the club matches "${nameOrId}".`);
}

function ok<T>(
  result: { ok: true; value: T } | { ok: false; error: string }
): T {
  if (!result.ok) refuse(result.error);
  return result.value;
}

// ---------------------------------------------------------------------------
// Formatting helpers — compact lines, not object dumps
// ---------------------------------------------------------------------------

function deliverableLine(d: {
  title: string;
  status: string;
  dueDate?: string;
  ownerId: string;
  blockerNote?: string;
}): string {
  const owner = getMember(d.ownerId)?.fullName ?? "unassigned";
  const bits = [d.status.replace("_", " "), owner];
  if (d.dueDate) bits.push(`due ${d.dueDate}`);
  if (d.blockerNote) bits.push(`blocked: ${d.blockerNote}`);
  return `- ${d.title} — ${bits.join(", ")}`;
}

function projectLine(p: {
  name: string;
  slug: string;
  phase: string;
  health: string;
  targetDate?: string;
}): string {
  const bits = [PHASE_LABELS[p.phase as keyof typeof PHASE_LABELS] ?? p.phase];
  if (p.health !== "on_track") bits.push(p.health.replace("_", " "));
  if (p.targetDate) bits.push(`target ${p.targetDate}`);
  return `- ${p.name} (${p.slug}) — ${bits.join(", ")}`;
}

/**
 * Things this member should fix about their own account.
 *
 * Surfaced from `whoami` and `catch_up` rather than as its own tool, because
 * nobody is ever going to ask "is my profile incomplete?" — it has to arrive
 * unbidden in something they already call. Discord first: it's how the club
 * actually reaches people, so an unconnected account misses every blocker
 * alert and check-in nudge the app sends.
 */
function profileNudges(viewer: McpViewer): string[] {
  const m = viewer.member;
  const todo: string[] = [];

  if (!m.discordUserId) {
    todo.push(
      "Connect Discord — it's how the club reaches you, and without it you miss blocker alerts and check-in reminders. `update_my_profile` can set it, or Settings on the website."
    );
  } else if (!m.discordVerifiedAt) {
    todo.push(
      "Your Discord ID is saved but unverified — send the test DM from Settings to confirm it's the right account."
    );
  }
  if (!m.skills || m.skills.length === 0) {
    todo.push(
      "Add your skills — Projects ranks work by them, so an empty list means worse suggestions. `update_my_profile` takes them."
    );
  }
  if (!m.major) todo.push("Add your major.");
  if (!m.classYear) todo.push("Add your class year.");
  if (!m.photoUrl) {
    todo.push(
      "Add a profile photo — link one with `update_my_profile`, or upload on the website."
    );
  }

  return todo;
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

export const TOOLS: McpTool[] = [
  {
    name: "guide",
    description:
      "How SkyRunners works and how to drive it: the club's model (deliverables, REs, phase vs health, check-ins), who is allowed to do what, recipes for common jobs, and what needs the website. Read this before guessing — and use it to explain the app to the member too.",
    inputSchema: schema({
      topic: {
        type: "string",
        enum: [...GUIDE_TOPICS],
        description: "Omit for the whole guide.",
      },
    }),
    async handler(args) {
      const topic = args.topic;
      return guideFor(isGuideTopic(topic) ? topic : undefined);
    },
  },

  {
    name: "whoami",
    description:
      "Who this token belongs to, what they're allowed to do in the club, and anything missing from their profile. Call this first in a new conversation — every other tool's permissions follow from it.",
    inputSchema: schema({}),
    async handler(_args, viewer) {
      const m = viewer.member;
      const store = readStore();

      const leads = store.teams.filter((t) => t.leadId === m.id && t.isActive);
      const reOf = store.projects.filter((p) => p.reIds.includes(m.id));
      const reports = store.members.filter(
        (r) => r.leadId === m.id && r.status === "active"
      );

      const lines = [
        `You are ${m.fullName} (${m.email}), role: ${m.globalRole}.`,
        `Token "${viewer.tokenName}", scope: ${viewer.scope}${
          viewer.scope === "read"
            ? " — read-only, so nothing can be changed from here."
            : " — can read and make changes."
        }`,
        "",
      ];

      if (leads.length) {
        lines.push(
          `Leads: ${leads.map((t) => t.name).join(", ")}. That makes you a top RE over every project in those, at any depth — you can assign deliverables, sign work off, appoint REs and approve join requests there.`
        );
      }
      if (reOf.length) {
        lines.push(`RE of: ${reOf.map((p) => p.name).join(", ")}.`);
      }
      lines.push(
        reports.length
          ? `Lead to ${reports.length} ${reports.length === 1 ? "person" : "people"}: ${reports.map((r) => r.fullName).join(", ")}.`
          : "You have no direct reports, so you have no check-ins to review and no leadership dashboard."
      );

      const todo = profileNudges(viewer);
      if (todo.length) {
        lines.push("", "Worth fixing on your profile:");
        for (const t of todo) lines.push(`- ${t}`);
      }

      lines.push(
        "",
        "Call `guide` for how the club works, who can do what, and common workflows — including the handful of things that are website-only.",
        "Next: `catch_up` for what's on your plate right now."
      );

      return lines.join("\n");
    },
  },

  {
    name: "catch_up",
    description:
      "One-call briefing: what you own, what's overdue, what's blocked across the projects you're responsible for, join requests waiting on you, and what's coming up. Use this to answer 'what's going on' or 'what do I need to do'.",
    inputSchema: schema({}),
    async handler(_args, viewer) {
      const mine = await getMyWork(viewer.member.id);
      const store = readStore();
      const now = today();

      const out: string[] = [`**${viewer.member.fullName} — ${now}**`, ""];

      const myOpen = mine.committed.flatMap((c) =>
        c.myDeliverables
          .filter((d) => d.status !== "done")
          .map((d) => ({ d, project: c.project }))
      );

      out.push(`### Your deliverables (${myOpen.length} open)`);
      if (!myOpen.length) out.push("- Nothing assigned to you right now.");
      for (const { d, project } of myOpen) {
        const overdue = d.dueDate && d.dueDate < now ? " **OVERDUE**" : "";
        out.push(`${deliverableLine(d)} [${project.name}]${overdue}`);
      }

      /*
        Blocked work in the viewer's RE subtree, resolved through the
        permission module rather than by matching `reIds` — authority inherits
        DOWN the project tree and a Division Lead is a top RE, so matching ids
        would miss both and under-report what somebody actually owns.
      */
      const myProjectIds = store.projects
        .filter((p) => can.manageDeliverables(viewer.actor, viewer.graph, p.id))
        .map((p) => p.id);

      const blocked = store.deliverables.filter(
        (d) => d.status === "blocked" && myProjectIds.includes(d.projectId)
      );

      out.push("", `### Blocked in your projects (${blocked.length})`);
      if (!blocked.length) out.push("- Nothing blocked.");
      for (const d of blocked) {
        out.push(`${deliverableLine(d)} [${getProject(d.projectId)?.name}]`);
      }

      const flagged = projectsNeedingAttention().filter((p) =>
        myProjectIds.includes(p.id)
      );
      out.push("", `### Projects needing attention (${flagged.length})`);
      if (!flagged.length) out.push("- None.");
      for (const p of flagged) {
        const why = projectAttentionFlags()
          .filter((f) => f.projectId === p.id)
          .map((f) => ATTENTION_LABELS[f.reason])
          .join("; ");
        out.push(`${projectLine(p)}${why ? ` — ${why}` : ""}`);
      }

      const requests = store.joinRequests.filter(
        (r) =>
          r.status === "pending" &&
          can.reviewJoinRequest(viewer.actor, viewer.graph, r.projectId)
      );
      if (requests.length) {
        out.push("", `### Join requests waiting on you (${requests.length})`);
        for (const r of requests) {
          out.push(
            `- ${getMember(r.memberId)?.fullName} → ${getProject(r.projectId)?.name} (asked ${r.requestedAt})`
          );
        }
      }

      const events = (await getUpcomingEvents()).slice(0, 5);
      if (events.length) {
        out.push("", "### Coming up");
        for (const e of events) {
          out.push(`- ${formatDay(e.startsAt)} — ${e.title}`);
        }
      }

      const todo = profileNudges(viewer);
      if (todo.length) {
        out.push("", "### Your profile", ...todo.map((t) => `- ${t}`));
      }

      return out.join("\n");
    },
  },

  {
    name: "list_projects",
    description:
      "Every active project, or a filtered slice. Use `division` to narrow to one division (e.g. 'Drone Hacks'), `health` for on_track/at_risk/blocked, or `search` to match a name.",
    inputSchema: schema({
      division: { type: "string", description: "Division name or slug" },
      health: { type: "string", enum: ["on_track", "at_risk", "blocked"] },
      include_complete: { type: "boolean", default: false },
      search: { type: "string" },
    }),
    async handler(args, _viewer) {
      const tree = await getProjectTree();
      const division = str(args.division).toLowerCase();
      const health = str(args.health);
      const search = str(args.search).toLowerCase();
      const includeComplete = args.include_complete === true;

      const out: string[] = [];
      for (const group of tree) {
        if (
          division &&
          !group.division.name.toLowerCase().includes(division) &&
          group.division.slug !== division
        ) {
          continue;
        }

        const rows: string[] = [];
        const walk = (nodes: typeof group.roots, depth: number) => {
          for (const node of nodes) {
            const p = node.project;
            const keep =
              (includeComplete || p.phase !== "complete") &&
              (!health || p.health === health) &&
              (!search || p.name.toLowerCase().includes(search));
            if (keep) {
              const re = node.res[0]?.fullName ?? "no RE";
              const blocked = node.blockedCount
                ? `, ${node.blockedCount} blocked`
                : "";
              rows.push(
                `${"  ".repeat(depth)}${projectLine(p)} — RE ${re}, ${Math.round(node.progress.fraction * 100)}% done${blocked}`
              );
            }
            walk(node.children, depth + 1);
          }
        };
        walk(group.roots, 0);

        if (rows.length) {
          out.push(`### ${group.division.name}`, ...rows, "");
        }
      }

      return out.length
        ? out.join("\n")
        : "No projects matched. Try without filters, or check the division name.";
    },
  },

  {
    name: "get_project",
    description:
      "Everything about one project: deliverables with owners and dates, who's on it, the REs, attached documentation, and why it needs attention. Takes the name or slug.",
    inputSchema: schema({ project: { type: "string" } }, ["project"]),
    async handler(args, viewer) {
      const target = requireProject(str(args.project));
      const view = await getProjectBySlug(
        target.slug,
        viewer.member.id,
        isLeadership(viewer.actor)
      );
      if (!view) refuse(`Couldn't load "${target.name}".`);

      const out = [
        `# ${view.project.name} (${view.project.slug})`,
        view.project.description ?? "",
        "",
        `Phase: ${PHASE_LABELS[view.project.phase]} · Health: ${view.project.health.replace("_", " ")}${
          view.project.targetDate ? ` · Target: ${view.project.targetDate}` : ""
        }`,
        `Division: ${view.division?.name ?? "unassigned"} · REs: ${view.res.map((r) => r.fullName).join(", ") || "none"}`,
        `Progress: ${view.progress.done}/${view.progress.total} done, ${view.progress.blocked} blocked, ${view.progress.overdue} overdue`,
      ];

      if (view.attentionFlags.length) {
        out.push("", "## Needs attention");
        for (const f of view.attentionFlags) {
          out.push(`- ${ATTENTION_LABELS[f.reason]}: ${f.detail}`);
        }
      }

      out.push("", `## Deliverables (${view.deliverables.length})`);
      if (!view.deliverables.length) out.push("- None yet.");
      for (const row of view.deliverables) {
        out.push(deliverableLine(row.deliverable));
      }

      out.push("", `## People (${view.members.length})`);
      for (const m of view.members) {
        out.push(
          `- ${m.member?.fullName} — ${m.membership.role}${m.membership.responsibility ? `, ${m.membership.responsibility}` : ""}`
        );
      }

      if (view.artifacts.length) {
        out.push("", "## Documentation");
        for (const a of view.artifacts) {
          out.push(
            `- [${a.artifact.kind}] ${a.artifact.title} — ${a.href ?? "no link"}`
          );
        }
      }

      if (view.children.length) {
        out.push("", "## Sub-projects");
        for (const c of view.children) out.push(projectLine(c.project));
      }

      return out.join("\n");
    },
  },

  {
    name: "find_blocked",
    description:
      "Everything stalled across the club, or one division: blocked deliverables with their notes, projects marked at-risk or blocked, and open 'I'm stuck' asks. The fastest way to answer 'what needs unblocking'.",
    inputSchema: schema({ division: { type: "string" } }),
    async handler(args, _viewer) {
      const store = readStore();
      const division = str(args.division).toLowerCase();

      const inScope = (projectId: string) => {
        if (!division) return true;
        const p = getProject(projectId);
        if (!p) return false;
        const tree = store.teams.find((t) => t.id === p.teamId);
        return (tree?.name ?? "").toLowerCase().includes(division);
      };

      const blocked = store.deliverables.filter(
        (d) => d.status === "blocked" && inScope(d.projectId)
      );
      const flagged = projectsNeedingAttention().filter((p) => inScope(p.id));
      const asks = store.helpRequests.filter((r) => !r.resolvedAt);

      const out = [`### Blocked deliverables (${blocked.length})`];
      if (!blocked.length) out.push("- None.");
      for (const d of blocked) {
        out.push(`${deliverableLine(d)} [${getProject(d.projectId)?.name}]`);
      }

      out.push("", `### Projects needing attention (${flagged.length})`);
      if (!flagged.length) out.push("- None.");
      for (const p of flagged) out.push(projectLine(p));

      if (asks.length) {
        out.push("", `### Open asks on the help board (${asks.length})`);
        for (const a of asks) {
          out.push(
            `- ${getMember(a.memberId)?.fullName}: ${a.title} (since ${a.createdAt})`
          );
        }
      }

      return out.join("\n");
    },
  },

  {
    name: "list_members",
    description:
      "The club roster — names, emails, roles, divisions and skills. Public information only; this never returns anyone's hours, check-ins or reliability.",
    inputSchema: schema({ search: { type: "string" } }),
    async handler(args, _viewer) {
      const roster = await getRoster();
      const search = str(args.search).toLowerCase();

      const rows = roster
        .filter(
          (r) =>
            !search ||
            r.member.fullName.toLowerCase().includes(search) ||
            (r.member.skills ?? []).some((s) =>
              s.toLowerCase().includes(search)
            )
        )
        .map((r) => {
          const skills = (r.member.skills ?? []).join(", ");
          return `- ${r.member.fullName} <${r.member.email}> — ${r.member.globalRole}${skills ? ` · ${skills}` : ""}`;
        });

      return rows.length
        ? `${rows.length} members\n${rows.join("\n")}`
        : "Nobody matched.";
    },
  },

  {
    name: "find_work",
    description:
      "Projects ranked by where this member would help most — unstaffed and blocked first, already-joined last. Use when someone asks what they should work on.",
    inputSchema: schema({}),
    async handler(_args, viewer) {
      const view = await getFindWork(
        viewer.member.id,
        viewer.member.skills ?? []
      );
      const rows = view.openWork
        .filter((c) => c.viewerStatus !== "committed")
        .slice(0, 15)
        .map((c) => {
          const why = c.signals.join(", ") || "open";
          const match = c.matchedSkills.length
            ? `; matches your ${c.matchedSkills.join("/")}`
            : "";
          return `- ${c.project.name} (${c.project.slug}) — ${why}; RE ${c.res[0]?.fullName ?? "none"}${match}`;
        });
      return rows.length ? rows.join("\n") : "Nothing open right now.";
    },
  },

  {
    name: "get_member",
    description:
      "One person's public record — the projects they're on, what they own on each, their skills and any RE roles. Never their hours, check-ins or reliability; those are website-only.",
    inputSchema: schema({ member: { type: "string" } }, ["member"]),
    async handler(args) {
      const m = requireMember(str(args.member));
      const store = readStore();

      const on = memberProjects(m.id);
      const lines = [
        `# ${m.fullName} <${m.email}>`,
        [
          m.globalRole,
          m.major,
          m.classYear ? `class of ${m.classYear}` : "",
          m.status !== "active" ? m.status : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ];

      if (m.skills?.length) lines.push(`Skills: ${m.skills.join(", ")}`);

      const leads = store.teams.filter((t) => t.leadId === m.id && t.isActive);
      if (leads.length) {
        lines.push(`Leads: ${leads.map((t) => t.name).join(", ")}`);
      }

      lines.push("", `## Projects (${on.length})`);
      if (!on.length) lines.push("- Not on any project yet.");
      for (const pm of on) {
        const project = getProject(pm.projectId);
        if (!project) continue;
        const open = projectDeliverables(project.id).filter(
          (d) => d.ownerId === m.id && d.status !== "done"
        );
        lines.push(
          `- ${project.name} — ${pm.role}${pm.commitment === "following" ? " (following)" : ""}${
            pm.responsibility ? `, ${pm.responsibility}` : ""
          }${open.length ? `; ${open.length} open` : ""}`
        );
      }

      return lines.join("\n");
    },
  },

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  {
    name: "answer_join_request",
    description:
      "Approve or decline someone's request to join a project. Requests escalate after 5 days, so clearing these is the highest-value thing an RE does in a week — `catch_up` lists the ones waiting on you.",
    write: true,
    inputSchema: schema(
      {
        project: { type: "string" },
        member: { type: "string", description: "Who asked" },
        decision: { type: "string", enum: ["approve", "decline"] },
        note: {
          type: "string",
          description: "Sent to them. Worth writing when declining.",
        },
      },
      ["project", "member", "decision"]
    ),
    async handler(args, viewer) {
      const project = requireProject(str(args.project));
      const member = requireMember(str(args.member));

      if (!can.reviewJoinRequest(viewer.actor, viewer.graph, project.id)) {
        refuse(
          `Answering join requests for ${project.name} is the RE's call — you aren't one on that project.`
        );
      }

      const request = readStore().joinRequests.find(
        (r) =>
          r.projectId === project.id &&
          r.memberId === member.id &&
          r.status === "pending"
      );
      if (!request) {
        refuse(
          `${member.fullName} has no pending request on ${project.name}. It may already have been answered.`
        );
      }

      const accept = str(args.decision) === "approve";
      ok(
        await ops.decideJoinRequest({
          requestId: request.id,
          decidedById: viewer.member.id,
          accept,
          responseNote: str(args.note) || undefined,
          today: today(),
        })
      );

      return accept
        ? `${member.fullName} is now on ${project.name}. They can be given deliverables straight away.`
        : `Declined ${member.fullName}'s request for ${project.name}${str(args.note) ? ` — they'll see: "${str(args.note)}"` : ""}.`;
    },
  },

  {
    name: "add_project_member",
    description:
      "Put someone on a project directly, without waiting for them to ask. Members can't add themselves — the RE decides, because the RE is accountable for the work.",
    write: true,
    inputSchema: schema(
      {
        project: { type: "string" },
        member: { type: "string" },
        responsibility: {
          type: "string",
          description: "What they own here. Shows on their profile.",
        },
        as_re: {
          type: "boolean",
          default: false,
          description: "Make them a Responsible Engineer, not a contributor",
        },
      },
      ["project", "member"]
    ),
    async handler(args, viewer) {
      const project = requireProject(str(args.project));
      const member = requireMember(str(args.member));

      if (!can.addProjectMember(viewer.actor, viewer.graph, project.id)) {
        refuse(`Adding people to ${project.name} is for its REs.`);
      }

      // Appointing an RE is a bigger step than adding a contributor, and the
      // app guards it separately.
      const asRE = args.as_re === true;
      if (asRE && !can.assignRE(viewer.actor, viewer.graph, project.id)) {
        refuse(`Appointing REs on ${project.name} isn't yours to do.`);
      }

      ok(
        await ops.addProjectMember({
          projectId: project.id,
          memberId: member.id,
          asRE,
          responsibility: str(args.responsibility) || undefined,
          addedBy: viewer.member.id,
          today: today(),
        })
      );

      return `${member.fullName} added to ${project.name}${asRE ? " as an RE" : ""}${
        str(args.responsibility) ? `, owning: ${str(args.responsibility)}` : ""
      }.`;
    },
  },

  {
    name: "create_project",
    description:
      "Start a new project. Give it a parent to nest it under existing work, or a division for a top-level one. The RE defaults to you — a project with nobody accountable is the one state the club's model can't represent.",
    write: true,
    inputSchema: schema(
      {
        name: { type: "string" },
        description: { type: "string" },
        parent: { type: "string", description: "Parent project name or slug" },
        division: {
          type: "string",
          description: "Division name, for a top-level project",
        },
        re: { type: "string", description: "Defaults to you" },
        target_date: { type: "string", description: "YYYY-MM-DD" },
      },
      ["name"]
    ),
    async handler(args, viewer) {
      const parent = str(args.parent) ? requireProject(str(args.parent)) : null;

      const store = readStore();
      const divisionName = str(args.division).toLowerCase();
      const division = divisionName
        ? store.teams.find(
            (t) =>
              t.isActive &&
              (t.name.toLowerCase() === divisionName ||
                t.slug === divisionName ||
                t.name.toLowerCase().includes(divisionName))
          )
        : undefined;

      if (divisionName && !division) {
        refuse(`No division called "${str(args.division)}".`);
      }
      if (!parent && !division) {
        refuse(
          "Say where it goes — either a parent project, or a division for a top-level one."
        );
      }

      const teamId = division?.id ?? parent?.teamId;
      if (
        !can.createProject(viewer.actor, viewer.graph, {
          parentProjectId: parent?.id,
          teamId,
        })
      ) {
        refuse("You can't start a project there.");
      }

      const re = str(args.re) ? requireMember(str(args.re)) : viewer.member;
      const created = ok(
        await ops.createProject({
          name: str(args.name),
          description: str(args.description) || undefined,
          parentId: parent?.id ?? null,
          teamId,
          primaryReId: re.id,
          targetDate: str(args.target_date) || undefined,
          createdBy: viewer.member.id,
          today: today(),
        })
      );

      return `Created ${created.name} (${created.slug})${parent ? ` under ${parent.name}` : ` in ${division?.name}`}, RE ${re.fullName}.`;
    },
  },

  {
    name: "ask_for_help",
    description:
      "Post on the club's help board — 'does anyone know Onshape well enough to look at this?'. Anyone can answer. Use it when someone is stuck on something that isn't a specific deliverable, or is waiting on a join request.",
    write: true,
    inputSchema: schema(
      {
        title: { type: "string", description: "One line, scannable" },
        detail: { type: "string" },
        project: { type: "string", description: "Optional, if it's about one" },
      },
      ["title"]
    ),
    async handler(args, viewer) {
      const projectId = str(args.project)
        ? requireProject(str(args.project)).id
        : undefined;

      /*
        No permission check, deliberately — see `can.postHelpRequest`. The
        board exists because membership is RE-controlled, so somebody waiting
        on a join request needs a route to being useful that doesn't depend on
        one person answering their inbox.
      */
      ok(
        await ops.postHelpRequest({
          memberId: viewer.member.id,
          title: str(args.title),
          detail: str(args.detail) || undefined,
          projectId,
          today: today(),
        })
      );

      return `Posted "${str(args.title)}" to the help board. It shows at the top of Projects for the whole club.`;
    },
  },

  {
    name: "create_deliverable",
    description:
      "Add a unit of work to a project with one owner and a due date. This is how you assign work.",
    write: true,
    inputSchema: schema(
      {
        project: { type: "string", description: "Project name or slug" },
        title: { type: "string" },
        owner: {
          type: "string",
          description: "Member name or email. Defaults to you.",
        },
        due_date: { type: "string", description: "YYYY-MM-DD" },
      },
      ["project", "title"]
    ),
    async handler(args, viewer) {
      const project = requireProject(str(args.project));
      if (!can.manageDeliverables(viewer.actor, viewer.graph, project.id)) {
        refuse(
          `You can't assign work on ${project.name} — that's for its REs, the REs above it, or the Division Lead.`
        );
      }

      const owner = str(args.owner)
        ? requireMember(str(args.owner))
        : viewer.member;

      const created = ok(
        await ops.createDeliverable({
          projectId: project.id,
          title: str(args.title),
          ownerId: owner.id,
          dueDate: str(args.due_date) || undefined,
        })
      );

      return `Created "${created.title}" on ${project.name}, owned by ${owner.fullName}${created.dueDate ? `, due ${created.dueDate}` : " with no due date"}.`;
    },
  },

  {
    name: "update_deliverable",
    description:
      "Change a deliverable's title, owner or due date. Find it with get_project first — takes the exact title.",
    write: true,
    inputSchema: schema(
      {
        project: { type: "string" },
        title: { type: "string", description: "Current title" },
        new_title: { type: "string" },
        owner: { type: "string", description: "Reassign to this member" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
      },
      ["project", "title"]
    ),
    async handler(args, viewer) {
      const project = requireProject(str(args.project));
      if (!can.manageDeliverables(viewer.actor, viewer.graph, project.id)) {
        refuse(`You can't change deliverables on ${project.name}.`);
      }

      const target = findDeliverable(project.id, str(args.title));
      const owner = str(args.owner)
        ? requireMember(str(args.owner))
        : undefined;

      ok(
        await ops.updateDeliverable({
          deliverableId: target.id,
          title: str(args.new_title) || target.title,
          ownerId: owner?.id ?? target.ownerId,
          dueDate: str(args.due_date) || target.dueDate,
          today: today(),
        })
      );

      const changes = [
        str(args.new_title) && `renamed to "${str(args.new_title)}"`,
        owner && `reassigned to ${owner.fullName}`,
        str(args.due_date) && `due ${str(args.due_date)}`,
      ].filter(Boolean);

      return `Updated "${target.title}" on ${project.name}${changes.length ? `: ${changes.join(", ")}` : " (nothing changed)"}.`;
    },
  },

  {
    name: "set_deliverable_status",
    description:
      "Mark a deliverable open, in_progress or blocked. Blocking one DMs whoever has to clear it, so always include a note saying what's needed.",
    write: true,
    inputSchema: schema(
      {
        project: { type: "string" },
        title: { type: "string" },
        status: { type: "string", enum: ["open", "in_progress", "blocked"] },
        note: { type: "string", description: "Required when blocking" },
      },
      ["project", "title", "status"]
    ),
    async handler(args, viewer) {
      const project = requireProject(str(args.project));
      const target = findDeliverable(project.id, str(args.title));
      const status = str(args.status) as "open" | "in_progress" | "blocked";
      const note = str(args.note);

      const mine = target.ownerId === viewer.member.id;
      if (
        !mine &&
        !can.manageDeliverables(viewer.actor, viewer.graph, project.id)
      ) {
        refuse(
          `That deliverable belongs to ${getMember(target.ownerId)?.fullName}, and you're not an RE on ${project.name}.`
        );
      }
      if (status === "blocked" && !note) {
        refuse(
          "Say what's blocking it. The note is what the RE gets DMed, and 'blocked' on its own tells them nothing."
        );
      }

      ok(await ops.setDeliverableStatus(target.id, status, note || undefined));
      return `"${target.title}" is now ${status.replace("_", " ")}${note ? ` — ${note}` : ""}.`;
    },
  },

  {
    name: "sign_off_deliverable",
    description:
      "Confirm finished work as an RE. This is the one that counts toward the owner's record — the owner marking it done is only a request.",
    write: true,
    inputSchema: schema(
      { project: { type: "string" }, title: { type: "string" } },
      ["project", "title"]
    ),
    async handler(args, viewer) {
      const project = requireProject(str(args.project));
      const target = findDeliverable(project.id, str(args.title));

      /*
        `manageDeliverables`, matching `confirmDeliverableAction` exactly.
        There is no separate `can.confirmDeliverable` — sign-off inherits down
        the project tree, so an RE of a parent can sign off on its children.
      */
      if (!can.manageDeliverables(viewer.actor, viewer.graph, project.id)) {
        refuse(`Signing off on ${project.name} is for its REs.`);
      }

      ok(await ops.confirmDeliverable(target.id, viewer.member.id, today()));
      return `Signed off "${target.title}" on ${project.name}.`;
    },
  },

  {
    name: "update_project",
    description:
      "Change a project's phase, health or target date. Phase is where it is in the lifecycle; health is how it's going — they're different fields and both matter.",
    write: true,
    inputSchema: schema(
      {
        project: { type: "string" },
        phase: {
          type: "string",
          enum: [
            "concept",
            "requirements",
            "preliminary_design",
            "detailed_design",
            "build",
            "integration",
            "testing",
            "flight_test",
            "complete",
          ],
        },
        health: { type: "string", enum: ["on_track", "at_risk", "blocked"] },
        target_date: { type: "string", description: "YYYY-MM-DD" },
        description: { type: "string" },
      },
      ["project"]
    ),
    async handler(args, viewer) {
      const project = requireProject(str(args.project));
      if (!can.manageProject(viewer.actor, viewer.graph, project.id)) {
        refuse(`You can't edit ${project.name}.`);
      }

      const phase = (str(args.phase) || project.phase) as typeof project.phase;
      if (
        phase === "complete" &&
        project.phase !== "complete" &&
        !can.completeProject(viewer.actor, viewer.graph, project.id)
      ) {
        refuse(
          `Marking ${project.name} complete is the review step, and its own RE can't do it — that's for the RE above them or a Co-Lead.`
        );
      }

      ok(
        await ops.updateProject({
          projectId: project.id,
          name: project.name,
          description: str(args.description) || project.description,
          phase,
          health: (str(args.health) || project.health) as typeof project.health,
          targetDate: str(args.target_date) || project.targetDate,
          actorId: viewer.member.id,
          today: today(),
        })
      );

      const after = getProject(project.id);
      return `${project.name}: phase ${after?.phase}, health ${after?.health}${after?.targetDate ? `, target ${after.targetDate}` : ""}.`;
    },
  },

  {
    name: "log_hours",
    description:
      "Record time worked. Backdating is allowed up to 7 days. Include what you did — 'ran the tensile coupons' is worth far more to the RE than a bare number.",
    write: true,
    inputSchema: schema(
      {
        hours: { type: "number" },
        project: {
          type: "string",
          description: "Omit for miscellaneous club work",
        },
        date: { type: "string", description: "YYYY-MM-DD, defaults to today" },
        description: { type: "string" },
      },
      ["hours"]
    ),
    async handler(args, viewer) {
      const hours = num(args.hours);
      if (hours === undefined) refuse("How many hours?");

      const projectId = str(args.project)
        ? requireProject(str(args.project)).id
        : undefined;

      if (projectId) {
        const on = memberProjects(viewer.member.id).some(
          (m) => m.projectId === projectId
        );
        if (!on) {
          refuse(
            "You're not on that project. Log it as miscellaneous by leaving `project` out, or ask to join first."
          );
        }
      }

      ok(
        await ops.logHours({
          memberId: viewer.member.id,
          projectId,
          workDate: str(args.date) || today(),
          hours,
          description: str(args.description) || undefined,
          today: today(),
        })
      );

      return `Logged ${hours} hrs${projectId ? ` on ${getProject(projectId)?.name}` : " (misc)"}.`;
    },
  },

  {
    name: "update_my_profile",
    description:
      "Update your OWN profile — preferred name, major, class year, skills, phone, Discord ID, photo link. Only ever your own; nobody can edit somebody else's from here.",
    write: true,
    inputSchema: schema({
      preferred_name: { type: "string" },
      major: { type: "string" },
      class_year: { type: "number" },
      skills: {
        type: "array",
        items: { type: "string" },
        description: "Replaces the whole list",
      },
      phone: { type: "string" },
      discord_user_id: { type: "string" },
      photo_url: { type: "string" },
    }),
    async handler(args, viewer) {
      const m = viewer.member;
      const skills = Array.isArray(args.skills)
        ? args.skills.map((s) => String(s).trim()).filter(Boolean)
        : m.skills;

      ok(
        await ops.updateProfile({
          memberId: m.id,
          edits: {
            preferredName: str(args.preferred_name) || (m.preferredName ?? ""),
            phone: str(args.phone) || (m.phone ?? ""),
            discordUserId: str(args.discord_user_id) || (m.discordUserId ?? ""),
            major: str(args.major) || (m.major ?? ""),
            photoUrl: str(args.photo_url) || (m.photoUrl ?? ""),
            classYear: num(args.class_year) ?? m.classYear ?? 0,
            skills: skills ?? [],
          },
        })
      );

      const remaining = profileNudges({
        ...viewer,
        member: getMember(m.id) ?? m,
      });
      return [
        "Profile updated.",
        ...(remaining.length
          ? ["", "Still missing:", ...remaining.map((t) => `- ${t}`)]
          : ["Nothing else missing."]),
        ...(str(args.discord_user_id)
          ? [
              "",
              "Discord ID saved, but it isn't verified yet — that takes one click in Settings on the website, and until then the bot won't DM you.",
            ]
          : []),
      ].join("\n");
    },
  },

  {
    name: "attach_link",
    description:
      "Add a link to a project's engineering record — slides, CAD, a repo, a report. Must be permanent: signed or temporary download URLs are refused. File uploads are website-only.",
    write: true,
    inputSchema: schema(
      {
        project: { type: "string" },
        title: { type: "string" },
        url: { type: "string" },
        description: { type: "string" },
      },
      ["project", "title", "url"]
    ),
    async handler(args, viewer) {
      const project = requireProject(str(args.project));
      const committed = memberProjects(viewer.member.id).some(
        (m) => m.projectId === project.id && m.commitment === "committed"
      );

      if (
        !can.attachArtifact(viewer.actor, viewer.graph, project.id, committed)
      ) {
        refuse(
          `You'd need to be on ${project.name} (or an RE above it) to add to its record.`
        );
      }

      const url = str(args.url);
      ok(
        await ops.addProjectArtifact({
          projectId: project.id,
          uploadedById: viewer.member.id,
          kind: detectArtifactKind(url),
          title: str(args.title),
          url,
          description: str(args.description) || undefined,
          /*
            The website makes a person tick a box promising the link won't
            expire. There is no person here to promise anything — so the
            machine half (`checkLinkPermanence`, inside addProjectArtifact) is
            the only guard, and it's the strict one. It refuses presigned S3,
            Supabase signed URLs, localhost and private IPs outright.
          */
          confirmedPermanent: true,
          today: today(),
        })
      );

      return `Attached "${str(args.title)}" to ${project.name} as ${detectArtifactKind(url)}.`;
    },
  },
];

function findDeliverable(projectId: string, title: string) {
  const all = projectDeliverables(projectId);
  const needle = title.toLowerCase();

  const exact = all.find((d) => d.title.toLowerCase() === needle);
  if (exact) return exact;

  const loose = all.filter((d) => d.title.toLowerCase().includes(needle));
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) {
    refuse(
      `"${title}" matches ${loose.length} deliverables: ${loose.map((d) => d.title).join(" / ")}. Use the full title.`
    );
  }
  refuse(
    `No deliverable called "${title}" on that project. Call get_project to see the exact titles.`
  );
}
