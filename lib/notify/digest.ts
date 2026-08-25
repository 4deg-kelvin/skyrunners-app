/**
 * The daily digest — one DM to each RE.
 *
 * ===========================================================================
 * The thing this has to get right is SILENCE
 * ===========================================================================
 *
 * A daily bot message is the easiest way in this whole app to get muted, and a
 * muted bot takes every other notification with it — the blocker alerts, the
 * check-in nudges, all of it. So three rules shape everything below:
 *
 *   1. **Nothing to say means nothing sent.** A member with no projects and no
 *      deadlines gets no message at all, not an empty one. This is the rule
 *      most likely to be broken by a later "just add a header".
 *
 *   2. **Quiet is reported as a FACT, not a scolding.** "Nothing logged since
 *      Aug 8 (4 days)" is information an RE can act on. "Nobody has worked on
 *      your project!" is a reproach, and people stop reading those.
 *
 *   3. **One message, not two.** Somebody who is an RE of several projects and
 *      has deadlines coming gets a single DM with two sections. Two DMs at
 *      19:30 every evening is how this feature dies.
 *
 * ---------------------------------------------------------------------------
 * There used to be a Lead section, and its removal is the point
 * ---------------------------------------------------------------------------
 *
 * A second section listed the recipient's direct reports and what each had done
 * today, or when they were last active. It went with the reporting chain on
 * 2026-08-24 — nobody has reports.
 *
 * The signal it carried did NOT go: the RE section already says "quiet today;
 * last activity Aug 8 (16 days ago)" for each project, which is the same fact
 * scoped to work rather than to a person. What is deliberately not added here is
 * a per-member version of that line. It would be four lines of code and it would
 * rebuild a list of names ranked by how recently each showed up, which is what
 * the club removed. The unit is the project.
 *
 * The standing three-week version lives on the dashboard via `lib/quiet.ts`. Two
 * windows on purpose: this is a daily narrative ("what happened today"), that is
 * a list of what has been silent long enough to chase.
 *
 * Privacy is no longer a consideration here and that is worth recording rather
 * than leaving as an absence. The old note explained that the RE half was public
 * (`can.viewMemberWorkOnProject`) while the Lead half needed
 * `can.viewMemberEffort`. Everything a member does is public as of 2026-08-24,
 * so there is no line left for a section to cross.
 *
 * ---------------------------------------------------------------------------
 * Pure, so it can be tested
 * ---------------------------------------------------------------------------
 *
 * Reads the store and returns strings. It sends nothing and touches no
 * network, so `digest.test.ts` can assert the hard parts — that a quiet
 * project says how long it has been quiet, that a member with nothing gets
 * nothing — against a temp store rather than against Discord.
 */

import { readStore } from "@/lib/store/disk";
import { isREofOrAbove, type Actor, type OrgGraph } from "@/lib/permissions";
import type { Deliverable, Member, Project } from "@/lib/types";

/**
 * How far ahead a deadline has to be to stay quiet.
 *
 * A week, because that's the horizon an RE can still do something about. Two
 * weeks would put half the term's dates in every message and train people to
 * skip the section.
 */
export const DEADLINE_HORIZON_DAYS = 7;

/**
 * Discord rejects a message over 2000 characters outright — the whole DM
 * fails, it isn't truncated for you. A Co-Lead who is RE of a dozen projects
 * would sail past that, so the builder trims and says it trimmed.
 */
export const MAX_DM_CHARS = 1900;

export interface Digest {
  memberId: string;
  discordUserId: string;
  body: string;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const base = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** "4 days ago", "yesterday", "today" — a person's phrasing, not a date diff. */
function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * Has this happened yet, as far as "today" is concerned?
 *
 * `>=`, not `===`, and the difference is a bug found by rendering real
 * digests: a work log dated tomorrow wasn't counted as today's activity but
 * still set the last-activity date, producing
 * "quiet today; last activity 2026-08-13 (today)" — a line that contradicts
 * itself in eight words.
 *
 * Future dates are real here for two reasons. The club runs on Pacific while
 * the database is UTC, so an evening in the lab is already tomorrow in one of
 * them; and nothing stops somebody dating an entry ahead. Either way, work
 * dated tomorrow is not a quiet project.
 */
function isCurrent(date: string | undefined, today: string): boolean {
  return !!date && date.slice(0, 10) >= today;
}

interface Activity {
  /** Newest first. */
  lines: string[];
  /** Most recent date anything happened, across every signal. */
  lastOn?: string;
}

/**
 * What happened on one project, and when it last did.
 *
 * Five signals, because "activity" means different things to different people
 * and using only one of them produces confidently wrong silence — a project
 * where somebody spent all Saturday writing the test report and logged nothing
 * is not quiet.
 */
function projectActivity(projectId: string, today: string): Activity {
  const store = readStore();
  const lines: string[] = [];
  const dates: string[] = [];

  const seen = (date?: string) => {
    if (date) dates.push(date.slice(0, 10));
  };

  for (const log of store.workLogs) {
    if (log.projectId !== projectId) continue;
    seen(log.workDate);
    if (isCurrent(log.workDate, today)) {
      const who = store.members.find((m) => m.id === log.memberId)?.fullName;
      /*
        The DESCRIPTION is the line now, not a suffix on a number.

        This used to read "Sofia Reyes logged 3 hrs — Coupon layup", and the
        hours were the part that carried no information: three hours of what?
        Now it reads "Sofia Reyes: Coupon layup", which is the sentence a Lead
        skimming a digest actually needs.

        The fallback matters — rows written before the note was required have no
        description, and a bare name with a dangling colon reads as a rendering
        bug rather than as missing data.
      */
      lines.push(
        log.description
          ? `${who ?? "Someone"}: ${log.description}`
          : `${who ?? "Someone"} logged work (no note)`
      );
    }
  }

  for (const d of store.deliverables) {
    if (d.projectId !== projectId) continue;
    seen(d.completedAt);
    seen(d.submittedAt);

    if (isCurrent(d.completedAt, today)) {
      lines.push(`✅ signed off: ${d.title}`);
    } else if (isCurrent(d.submittedAt, today)) {
      const who = store.members.find((m) => m.id === d.ownerId)?.fullName;
      lines.push(`awaiting your sign-off: ${d.title} (${who ?? "unknown"})`);
    }
  }

  for (const update of store.progressUpdates) {
    if (!update.submittedAt) continue;
    for (const entry of update.entries) {
      if (entry.projectId !== projectId) continue;
      seen(update.submittedAt);
      if (isCurrent(update.submittedAt, today)) {
        const who = store.members.find(
          (m) => m.id === update.memberId
        )?.fullName;
        lines.push(
          `check-in from ${who ?? "someone"}: ${entry.progress.slice(0, 120)}`
        );
      }
    }
  }

  for (const artifact of store.projectArtifacts) {
    if (artifact.projectId !== projectId) continue;
    seen(artifact.createdAt);
    if (isCurrent(artifact.createdAt, today)) {
      lines.push(`📎 attached: ${artifact.title}`);
    }
  }

  const lastOn = dates.sort().at(-1);
  return { lines, lastOn };
}

/** Deliverables due inside the horizon, soonest first. Excludes finished work. */
function dueSoon(deliverables: Deliverable[], today: string): Deliverable[] {
  const horizon = addDays(today, DEADLINE_HORIZON_DAYS);
  return deliverables
    .filter(
      (d) =>
        d.status !== "done" &&
        !!d.dueDate &&
        // Overdue counts: something a week late is more urgent than something
        // due Friday, and leaving it out would make the section a liar.
        d.dueDate <= horizon
    )
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
}

function dueLabel(dueDate: string, today: string): string {
  const days = daysBetween(today, dueDate);
  if (days < 0) return `**${Math.abs(days)}d OVERDUE**`;
  if (days === 0) return "**due today**";
  if (days === 1) return "due tomorrow";
  return `due in ${days}d`;
}

/**
 * Build every digest that should go out today.
 *
 * Takes the graph rather than rebuilding one, so RE authority is resolved
 * through `isREofOrAbove` — the same function the website uses. Matching
 * `reIds` directly would miss inherited authority and every Division Lead,
 * which is the bug shape CLAUDE.md warns about twice.
 */
export function buildDigests(input: {
  today: string;
  graph: OrgGraph;
  /** Members who have opted out or already had today's. */
  skip?: Set<string>;
}): Digest[] {
  const { today, graph } = input;
  const skip = input.skip ?? new Set<string>();
  const store = readStore();
  const digests: Digest[] = [];

  const live = store.projects.filter((p) => p.phase !== "complete");

  for (const member of store.members) {
    if (member.status !== "active") continue;
    if (!member.discordUserId) continue;
    if (skip.has(member.id)) continue;

    const actor: Actor = { id: member.id, globalRole: member.globalRole };
    const sections: string[] = [];

    // --- what you're responsible for --------------------------------------
    const mine = live.filter((p) => isREofOrAbove(actor, graph, p.id));
    if (mine.length) {
      sections.push(reSection(mine, today));
    }

    // --- what's about to be due -------------------------------------------
    const deadlines = deadlineSection(member, mine, today);
    if (deadlines) sections.push(deadlines);

    /*
      Rule 1. Somebody who is an RE of nothing with nothing of their own due has
      nothing here, and gets no DM — not a cheerful empty one.
    */
    if (!sections.length) continue;

    const body = [`**SkyRunners — ${today}**`, "", ...sections].join("\n");
    digests.push({
      memberId: member.id,
      discordUserId: member.discordUserId,
      body: clamp(body),
    });
  }

  return digests;
}

function reSection(projects: Project[], today: string): string {
  const out = [`__Your projects (${projects.length})__`];

  for (const project of projects) {
    const activity = projectActivity(project.id, today);

    if (activity.lines.length) {
      out.push(`**${project.name}**`);
      for (const line of activity.lines.slice(0, 4)) out.push(`• ${line}`);
      if (activity.lines.length > 4) {
        out.push(`• …and ${activity.lines.length - 4} more`);
      }
    } else if (activity.lastOn) {
      /*
        Rule 2: the fact, not the reproach. The gap is the useful number —
        "quiet since Friday" is a prompt to send a message, where "no activity"
        is just an absence.
      */
      const days = daysBetween(activity.lastOn, today);
      out.push(
        `**${project.name}** — quiet today; last activity ${activity.lastOn} (${ago(days)})`
      );
    } else {
      out.push(`**${project.name}** — nothing logged on it yet`);
    }
  }

  return out.join("\n");
}

function deadlineSection(
  member: Member,
  myProjects: Project[],
  today: string
): string | null {
  const store = readStore();
  const horizon = addDays(today, DEADLINE_HORIZON_DAYS);

  const projectIds = new Set(myProjects.map((p) => p.id));

  /*
    Everything the member could act on: work on their projects, and their own.

    A third clause matched work owned by their direct reports, and it went with
    the reporting chain. It was mostly redundant even then -- a report's
    deliverable is nearly always ON one of the RE's projects -- and what it
    uniquely added was somebody else's deadline on somebody else's project,
    which the recipient could not act on.

    Deduped by id, because an RE's own deliverable on their own project would
    otherwise appear twice.
  */
  const relevant = store.deliverables.filter(
    (d) => projectIds.has(d.projectId) || d.ownerId === member.id
  );

  const deliverables = dueSoon(relevant, today);
  const projects = myProjects
    .filter((p) => p.targetDate && p.targetDate <= horizon)
    .sort((a, b) => (a.targetDate ?? "").localeCompare(b.targetDate ?? ""));

  if (!deliverables.length && !projects.length) return null;

  const out = [`__Due within ${DEADLINE_HORIZON_DAYS} days__`];

  for (const d of deliverables.slice(0, 8)) {
    const owner = store.members.find((m) => m.id === d.ownerId)?.fullName;
    const project = store.projects.find((p) => p.id === d.projectId)?.name;
    out.push(
      `• ${d.title} — ${owner ?? "unassigned"}, ${project} · ${dueLabel(d.dueDate!, today)}${
        d.status === "blocked" ? " · BLOCKED" : ""
      }`
    );
  }
  if (deliverables.length > 8) {
    out.push(`• …and ${deliverables.length - 8} more`);
  }

  for (const p of projects) {
    out.push(`• PROJECT ${p.name} · ${dueLabel(p.targetDate!, today)}`);
  }

  return out.join("\n");
}

/**
 * Keep the message inside Discord's limit.
 *
 * Cuts on a line boundary and says what happened, because a digest that stops
 * mid-sentence reads as a broken bot rather than a long day.
 */
function clamp(body: string): string {
  if (body.length <= MAX_DM_CHARS) return body;

  const tail = "\n…trimmed. Open the site for the rest.";
  const room = MAX_DM_CHARS - tail.length;

  const cut = body.slice(0, room);
  const lastBreak = cut.lastIndexOf("\n");
  return (lastBreak > 0 ? cut.slice(0, lastBreak) : cut) + tail;
}
