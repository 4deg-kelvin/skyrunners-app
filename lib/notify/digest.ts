/**
 * The daily digest — one DM to each PL.
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
 *      Aug 8 (4 days)" is information a PL can act on. "Nobody has worked on
 *      your project!" is a reproach, and people stop reading those.
 *
 *   3. **One message, not two.** Somebody who is a PL of several projects and
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
 * The signal it carried did NOT go: the PL section already says "quiet today;
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
 * than leaving as an absence. The old note explained that the PL half was public
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
import {
  isCoLead,
  isLeadership,
  isREofOrAbove,
  type Actor,
  type OrgGraph,
} from "@/lib/permissions";
import { quietProjects, QUIET_AFTER_DAYS } from "@/lib/quiet";
import { discordMessages } from "@/lib/notify/discord";
import { appUrl } from "@/lib/urls";
import { HEALTH_LABELS } from "@/lib/labels";
import type { Deliverable, Member, Project } from "@/lib/types";

/**
 * Which weekday carries the weekly sections. 1 = Monday.
 *
 * ---------------------------------------------------------------------------
 * Why a weekday check instead of a second cron
 * ---------------------------------------------------------------------------
 *
 * The club wanted "gone quiet" weekly rather than daily, and the obvious way to
 * do that is a second entry in `vercel.json`. Two reasons not to.
 *
 * Vercel's Hobby plan limits cron FREQUENCY — at most once a day each — and it
 * rejects the whole DEPLOYMENT when a schedule breaks that, not just the cron.
 * That has already cost this repo four failed deploys, and the error names the
 * plan rather than the schedule. A weekly cron (`0 2 * * 1`) is legal, so this
 * would have worked; the reason to avoid it anyway is the second one.
 *
 * A second cron is a second thing that can silently stop. One job that decides
 * what to include has one failure mode and one place to look. `npm test` asserts
 * the frequency rule in `lib/notify/cron-schedule.test.ts`, and the spare Hobby
 * slot stays spare.
 *
 * Monday, because a list of things that went quiet is a list of things to do
 * this week.
 */
const WEEKLY_ON = 1;

/** UTC weekday of a `YYYY-MM-DD`. Never `new Date(today).getDay()` — see lib/dates.ts. */
function weekdayOf(today: string): number {
  return new Date(Date.parse(`${today.slice(0, 10)}T00:00:00Z`)).getUTCDay();
}

/**
 * How far ahead a deadline has to be to stay quiet.
 *
 * A week, because that's the horizon a PL can still do something about. Two
 * weeks would put half the term's dates in every message and train people to
 * skip the section.
 */
export const DEADLINE_HORIZON_DAYS = 7;

/**
 * Discord rejects a message over 2000 characters outright — the whole DM
 * fails, it isn't truncated for you. A Co-Lead who is PL of a dozen projects
 * would sail past that, so the builder trims and says it trimmed.
 */
export const MAX_DM_CHARS = 1900;

/**
 * How many days before a due date the owner gets their own DM.
 *
 * EXACTLY this many, not "within" — the difference is the whole design.
 * `<= 2` would fire on the day before too, and again every day it ran late,
 * which turns one useful nudge into a countdown clock nobody reads. Firing on
 * one day only also means no new database column: it cannot repeat, so there
 * is nothing to remember.
 *
 * Two days, because it is the last point at which the honest answers — move
 * the date, or say it is blocked — are still available without letting anyone
 * down. Warning on the day it is due is just an accusation.
 */
export const DUE_NUDGE_DAYS = 2;

export interface Digest {
  memberId: string;
  discordUserId: string;
  /** The digest itself. Empty when the only thing to send is `urgent`. */
  body: string;
  /**
   * A separate, shorter DM about THEIR OWN work due in two days, sent just
   * before the digest.
   *
   * Two messages rather than a section, deliberately: the digest is a summary
   * you skim, and this is a thing you have to do. Folding it in would make the
   * one line that needs acting on look like the eight that do not.
   *
   * It rides the digest so it inherits the digest's `daily_digest_sent_on`
   * claim — one send per member per day, already atomic — instead of needing a
   * second cron, a second column and a second race. Vercel's Hobby plan allows
   * two cron slots total and rejects the whole DEPLOYMENT when a schedule
   * breaks the once-a-day rule, so a spare slot is worth keeping.
   */
  urgent?: string;
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
 * Takes the graph rather than rebuilding one, so PL authority is resolved
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

    /*
      A Co-Lead's scope is the club, and this branch is load-bearing.

      `isREofOrAbove` has no Co-Lead shortcut — it answers "does the project tree
      grant this person authority here", and the Co-Lead answer lives in the
      `can.*` rules. Without this branch a Co-Lead who is PL of nothing gets
      `mine = []`, no sections, and no digest at all. That is the live club
      exactly: the only Co-Lead is PL of 0 of 12 projects. Same bug, same shape,
      as the empty dashboard — see `lib/data/dashboard.test.ts`.
    */
    const mine = isCoLead(actor)
      ? live
      : live.filter((p) => isREofOrAbove(actor, graph, p.id));

    /*
      ORDER IS BY VALUE, NOT BY CHRONOLOGY, and it is load-bearing.

      `clamp()` trims from the BOTTOM, so whatever is last is what a long digest
      loses. That is not hypothetical: rendering the real fixture, the only
      person whose digest overflowed was the Co-Lead with twelve projects, and
      what it dropped was the WEEKLY quiet section — the one thing they see once
      a week rather than daily. The roll call of project names was safe at the
      top, repeating "quiet today" twelve times.

      So: things that need attention first, the roll call last. If something has
      to go, lose the list of names, not the list of problems.
    */

    /*
      --- rough health of everything under you ---------------------------------

      The club's ask: an important PL or Division Lead should be able to tell
      from the digest whether something below them needs attention.
    */
    const health = healthSection(mine);
    if (health) sections.push(health);

    // --- what's about to be due -------------------------------------------
    const deadlines = deadlineSection(member, mine, today);
    if (deadlines) sections.push(deadlines);

    /*
      --- gone quiet, WEEKLY --------------------------------------------------

      Monday only. Daily would make a three-week-old silence into a twenty-one
      day nag, which is how a section teaches people to skip the whole message.
    */
    if (weekdayOf(today) === WEEKLY_ON) {
      const quiet = quietSection(mine, today);
      if (quiet) sections.push(quiet);
    }

    /*
      --- trainings waiting on somebody ---------------------------------------

      The club asked for this INSTEAD of a DM when a training is verified or
      rejected: it belongs in the queue a Lead already works through, not as its
      own interruption. Only for leadership, and only when the queue is non-empty.
    */
    if (isLeadership(actor)) {
      const trainings = trainingSection();
      if (trainings) sections.push(trainings);
    }

    /*
      --- projects added since yesterday ---------------------------------------

      Asked for as a digest line rather than a DM. Scoped to what the member
      oversees, so a Division Lead hears about work appearing in their division —
      which is also the tripwire that would have caught the 994-project incident
      on day one instead of after the fact.
    */
    const added = newProjectSection(mine, today);
    if (added) sections.push(added);

    /*
      --- what you're responsible for, last ----------------------------------

      The longest section and the least urgent: it is a roll call, and on a
      quiet week every line of it says the same thing.
    */
    if (mine.length) {
      sections.push(reSection(mine, today));
    }

    /*
      --- your own work, two days out -----------------------------------------

      Its own DM, not a section. See `Digest.urgent`.
    */
    const urgent = dueSoonNudge(member, today);

    /*
      Rule 1. Somebody who is a PL of nothing with nothing of their own due has
      nothing here, and gets no DM — not a cheerful empty one.

      `&& !urgent` is belt-and-braces. Anything the nudge matches is inside
      `deadlineSection`'s seven-day window too, so sections is never empty today
      when urgent is set — but that coupling is invisible, and if the horizon is
      ever shortened the nudge would go silent rather than fail loudly.
    */
    if (!sections.length && !urgent) continue;

    const body = sections.length
      ? clamp([`**SkyRunners — ${today}**`, "", ...sections].join("\n"))
      : "";
    digests.push({
      memberId: member.id,
      discordUserId: member.discordUserId,
      body,
      ...(urgent ? { urgent } : {}),
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

/**
 * Your own work due in exactly two days.
 *
 * Owned by the member, not merely on their projects: a PL already sees their
 * projects' dates in the deadline section, and a DM saying "somebody else's
 * task is due Thursday" is a fact they cannot act on.
 *
 * `submitted` is excluded along with `done`. Submitted work is waiting on a PL,
 * so the member has finished their half — nudging them about the date would
 * blame them for somebody else's queue. `blocked` is deliberately INCLUDED: a
 * blocked deliverable with a date two days out is exactly the one worth a
 * conversation, and the message's own wording still lands, because the date is
 * the part that has not been dealt with.
 */
function dueSoonNudge(member: Member, today: string): string | null {
  const on = addDays(today, DUE_NUDGE_DAYS);
  const store = readStore();

  const due = store.deliverables.filter(
    (d) =>
      d.ownerId === member.id &&
      d.dueDate === on &&
      d.status !== "done" &&
      d.status !== "submitted"
  );
  if (!due.length) return null;

  const names = new Map(store.projects.map((p) => [p.id, p.name]));

  if (due.length === 1) {
    const d = due[0];
    return discordMessages.deliverableDueSoon({
      title: d.title,
      projectName: names.get(d.projectId) ?? "a project",
      dueDate: `in ${DUE_NUDGE_DAYS} days (${d.dueDate})`,
      url: appUrl("/my-work"),
    });
  }

  /*
    Several in one message, rather than one DM each.

    The club's call on the assignment DMs was "3 DMs is fine, people know they
    are being added to a lot" — and that reasoning does not carry over. Being
    assigned three things is three decisions somebody else made, each worth
    hearing about separately. Three things happening to share a due date is one
    calendar fact, and three DMs about the same Thursday is the shape that gets
    a bot muted.
  */
  return [
    `**${due.length} things you own are due in ${DUE_NUDGE_DAYS} days (${on}):**`,
    ...due.map(
      (d) => `• ${d.title} — ${names.get(d.projectId) ?? "a project"}`
    ),
    "If any of those aren't going to happen, move the date or say it's blocked — both are better than the day arriving.",
    appUrl("/my-work"),
  ].join("\n");
}

/**
 * Rough health of everything under you, in two lines at most.
 *
 * The club's ask: an important PL or Division Lead should be able to tell from
 * the digest whether something below them needs attention.
 *
 * A COUNT first, then the names of only the ones that are wrong. Listing all
 * twelve projects with a status each is a table, and a table in a DM is
 * something people scroll past — the two facts that matter are "is anything
 * wrong" and "which".
 *
 * SILENT when nothing is wrong, which is the part worth defending. A Lead with
 * three healthy projects was getting "__Across your 3 projects__ / 3 on track"
 * every single evening, and a line that cannot change is a line people learn to
 * skip — taking the sections under it with them. Nothing wrong is also the
 * default assumption, so saying it adds nothing; the roll call below already
 * names the projects.
 *
 * `complete` is filtered out by the caller, so the three states here are the
 * three live ones.
 */
function healthSection(projects: Project[]): string | null {
  // With one project the roll call already says everything this would.
  if (projects.length < 2) return null;

  const blocked = projects.filter((p) => p.health === "blocked");
  const atRisk = projects.filter((p) => p.health === "at_risk");
  const needy = [...blocked, ...atRisk];
  if (!needy.length) return null;

  const onTrack = projects.length - needy.length;
  const counts = [
    blocked.length ? `${blocked.length} blocked` : "",
    atRisk.length ? `${atRisk.length} at risk` : "",
    onTrack ? `${onTrack} on track` : "",
  ].filter(Boolean);

  const out = [
    `__Needs attention (${needy.length} of ${projects.length})__`,
    counts.join(" · "),
  ];

  // Name them, cap at six.
  for (const p of needy.slice(0, 6)) {
    out.push(`• ${p.name} — ${HEALTH_LABELS[p.health].toLowerCase()}`);
  }
  if (needy.length > 6) out.push(`• …and ${needy.length - 6} more`);

  return out.join("\n");
}

/**
 * Trainings waiting on a verifier, club-wide.
 *
 * Asked for INSTEAD of a DM when a training is verified or rejected: it belongs
 * in the queue a Lead already works through, not as its own interruption.
 *
 * Not scoped to a particular verifier, deliberately. Until
 * `catalogue_items.verifier_id` is populated, `can.verifyTraining` is "any Lead"
 * — so scoping this would invent a narrower rule than the one the app enforces,
 * and the request would sit in nobody's digest. When named verifiers land, scope
 * it to them and keep Co-Leads seeing all.
 */
function trainingSection(): string | null {
  const store = readStore();
  const waiting = store.certifications.filter((c) => c.status === "requested");
  if (!waiting.length) return null;

  const itemName = new Map(store.catalogueItems.map((i) => [i.id, i.name]));
  const out = [`__Trainings to verify (${waiting.length})__`];

  // Oldest first: age is what makes a queue actionable, the same rule every
  // other queue in this app uses.
  const ordered = [...waiting].sort((a, b) =>
    a.requestedAt.localeCompare(b.requestedAt)
  );
  for (const c of ordered.slice(0, 6)) {
    const who = store.members.find((m) => m.id === c.memberId);
    out.push(
      `• ${who?.fullName ?? "Somebody"} — ${itemName.get(c.itemId) ?? "a training"}`
    );
  }
  if (ordered.length > 6) out.push(`• …and ${ordered.length - 6} more`);

  return out.join("\n");
}

/**
 * Projects that appeared since yesterday, within what this member oversees.
 *
 * Asked for as a digest line rather than a DM. It is also the tripwire that
 * would have caught the 994-project incident on day one rather than after the
 * fact — a Division Lead seeing "47 projects added" in their evening digest asks
 * a question immediately.
 *
 * `startDate` is the proxy for "created", because `projects` has no `created_at`
 * and `createProject` defaults `startDate` to today. It is imperfect in one
 * direction only: a project entered in advance for next quarter carries a future
 * start and will not appear here. That is the safe direction — a missed line
 * beats a nightly line about a project nobody has touched.
 */
function newProjectSection(projects: Project[], today: string): string | null {
  const since = addDays(today, -1);
  const fresh = projects.filter(
    (p) => p.startDate && p.startDate >= since && p.startDate <= today
  );
  if (!fresh.length) return null;

  const out = [
    fresh.length === 1
      ? "__A project was added__"
      : `__${fresh.length} projects were added__`,
  ];
  for (const p of fresh.slice(0, 8)) out.push(`• ${p.name}`);
  if (fresh.length > 8) {
    out.push(
      `• …and ${fresh.length - 8} more — worth a look at who added them`
    );
  }
  return out.join("\n");
}

/**
 * Projects nobody has logged against in three weeks. WEEKLY — Mondays only.
 *
 * Reuses `lib/quiet.ts` rather than recomputing, so the digest and the dashboard
 * can never disagree about what "quiet" means. That module is also where the
 * three-week threshold is argued; a shorter one fires on half the club every
 * finals week.
 */
function quietSection(projects: Project[], today: string): string | null {
  const store = readStore();
  const quiet = quietProjects(
    projects,
    projects.map((p) => p.id),
    store.projectMemberships,
    store.workLogs,
    store.deliverables,
    today
  );
  if (!quiet.length) return null;

  const out = [`__Quiet for ${QUIET_AFTER_DAYS}+ days (${quiet.length})__`];
  for (const q of quiet.slice(0, 6)) {
    out.push(
      `• ${q.project.name} — ${
        q.lastLoggedAt ? `nothing since ${q.lastLoggedAt}` : "never logged"
      }, ${q.openDeliverables} open`
    );
  }
  if (quiet.length > 6) out.push(`• …and ${quiet.length - 6} more`);
  out.push("A message usually fixes it. Worth ten minutes on a Monday.");

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
    deliverable is nearly always ON one of the PL's projects -- and what it
    uniquely added was somebody else's deadline on somebody else's project,
    which the recipient could not act on.

    Deduped by id, because a PL's own deliverable on their own project would
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
