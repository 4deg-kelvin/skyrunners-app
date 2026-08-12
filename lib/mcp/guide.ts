/**
 * What the club is and how to work it — for the model, and through it, the
 * member.
 *
 * Two audiences, one text. A model needs the club's vocabulary before its tool
 * calls make sense: without it, "mark it done" becomes a status change instead
 * of a sign-off request, and "the airframe is blocked" gets written to the
 * wrong field. A member asking "how do I…" gets the same answer relayed.
 *
 * Kept as prose in one file rather than scattered through tool descriptions,
 * because tool descriptions are read on every call and pay for their length
 * forever, whereas this is fetched once when somebody actually needs it.
 *
 * If this drifts from `CLAUDE.md` or `docs/CONNECT_YOUR_AI.md`, this file is
 * the one that's wrong — those are the sources.
 */

export const GUIDE_TOPICS = [
  "getting-started",
  "how-the-club-works",
  "permissions",
  "workflows",
  "website-only",
] as const;

export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export function isGuideTopic(value: unknown): value is GuideTopic {
  return (
    typeof value === "string" && GUIDE_TOPICS.includes(value as GuideTopic)
  );
}

const GETTING_STARTED = `# Using this connection

You are connected to SkyRunners (Stanford UAV), a ~35-person student drone team.
You act AS the member whose token this is, with exactly their permissions.

**Every session, in order:**
1. \`whoami\` — who you're acting as, what they lead, what's missing from their profile.
2. \`catch_up\` — their deliverables, what's blocked in their projects, join requests waiting on them, what's coming up.

That's usually enough to answer "what's going on" without another call.

**Then, as needed:** \`list_projects\` to browse, \`get_project\` for detail,
\`find_blocked\` for anything stalled, \`find_work\` for where to help,
\`list_members\` for the roster.

**Naming things.** Tools take project names or slugs and member names or emails,
not UUIDs. If a name is ambiguous the tool refuses and lists the candidates —
pass an email or the exact title rather than guessing. Never guess which person
was meant; assigning work to the wrong member is the mistake that costs trust.

**Before you change anything the user didn't explicitly ask for — reassigning
someone else's work, moving a date others depend on, marking work complete —
say what you're about to do and get a yes.**

If a tool refuses, read the sentence back to the user. The refusals name the
actual rule ("its own RE can't sign off their own work — that's the RE above
them"), which is usually the answer to their next question.`;

const HOW_THE_CLUB_WORKS = `# How SkyRunners works

The app exists to fix three things: members can't find work without asking a
Co-Lead, leaders can't see who's contributing, and progress doesn't flow up.

**Deliverables are the whole task model.** One flat list per project: a title,
ONE owner, a due date, a status. No sub-tasks, no dependencies, no critical
path — deliberately. A dependency graph costs an RE an hour a week and is wrong
the day after it's entered on a team whose availability swings with midterms.

**Phase and health are different fields.**
- *Phase* is where a project is in its lifecycle: concept → requirements →
  preliminary design → detailed design → build → integration → testing →
  flight test → complete.
- *Health* is how it's going: on track, at risk, blocked.
A project can be in "build" and blocked, or in "testing" and on track. Don't
collapse them.

**Marking work done is a request; sign-off is what counts.** The owner says
they've finished; an RE confirms it. Only the confirmation counts toward the
member's record, which is what keeps the "delivered" signal honest.

**Two separate hierarchies.**
- The *project tree* — what work exists. Projects nest arbitrarily deep.
- The *org tree* — who reports to whom. Divisions contain teams contain people.
A member's Lead is NOT necessarily an RE of their projects. Keeping them
separate is the point; merging them rebuilds the silos the app removes.

**Roles.**
- **Co-Lead** — runs the club, can do anything.
- **Team Lead** — middle leadership; reviews check-ins from their direct
  reports and rolls reports up.
- **RE (Responsible Engineer)** — accountable for one project's deliverables.
  Project-scoped, multiple allowed per project, and authority inherits DOWN the
  project tree: an RE four levels up owns everything beneath them.
- **Division Lead is a top RE** over their whole division, at any depth.
- **Member** — everyone else.

**Membership is RE-controlled.** Members can't add themselves to a project. They
see everything, can *follow* anything, and *ask* to join — the RE decides,
because the RE is accountable. A tracked join request escalates after 5 days so
it can't become a dead end.

**Check-ins happen twice a week**, on days each member picks, and pause for
academics without penalty. A check-in has a public half (per-project progress
and blockers — everyone sees it, it's the project's history) and a private half
(hours, reliability, the personal report — the member and their Lead chain
only). This connection only ever exposes the caller's own private half.

**There is no engagement score.** Four independent signals are reported —
delivered work, commitment tier, reliability, scope — and deliberately never
blended into one number, and never ranked. The rubric is published at
/how-we-lead. Don't invent a composite or a leaderboard when asked to compare
people; say the club decided against one, on purpose.`;

const PERMISSIONS = `# Who can do what

Four questions, in order. If none is true, the answer is no.

1. **Are you a Co-Lead?** → anything.
2. **Are you an RE of this project or any above it — or do you lead a team that
   owns any of them?** → you own this subtree.
3. **Are you this member's Lead, directly or anywhere up their chain?** → you
   oversee them.
4. **Is it your own data?** → you can manage it.

**Three inheritances, running in different directions.** RE authority flows
DOWN the project tree. Lead authority flows UP the reporting chain. Team-lead
authority flows down the org tree and then down the project tree. That asymmetry
is where mistakes hide — don't reason about it, just call the tool and read the
refusal.

**Approving is narrower than doing.** An RE runs their project and can change
almost anything about it, but cannot mark their OWN project complete or withdraw
a sign-off — that's the RE above them, or a Co-Lead. A Division Lead who assigns
work to themselves is wearing both hats, and the rule notices.

**A Division Lead is not a Co-Lead.** They get full project authority over their
division and still cannot read a member's personal report unless they're in that
person's Lead chain.

Don't pre-judge whether something is allowed. Attempt it; the refusal is
accurate and explains itself.`;

const WORKFLOWS = `# Common jobs

**Assign work**
\`create_deliverable\` with project, title, owner, due date. One owner — if the
user names two people, that's two deliverables.

**Reassign or move a date**
\`update_deliverable\`. Confirm first if it isn't the user's own work: somebody
is planning around that date.

**Something is stuck**
\`set_deliverable_status\` with status "blocked" AND a note saying what's needed.
The note is what gets DMed to whoever must clear it; "blocked" alone tells them
nothing. This is the single most valuable thing to record promptly — a blocker
nobody hears about is the failure the whole app exists to prevent.

**Weekly review as a Lead or RE**
\`catch_up\`, then \`find_blocked\` for the division. Work down the blocked list
first, then projects needing attention, then join requests. Sign off finished
work with \`sign_off_deliverable\` — unsigned work doesn't count for the person
who did it.

**Finish something**
Owner marks it done on the website or via \`set_deliverable_status\`; an RE then
\`sign_off_deliverable\`. To close a whole project, \`update_project\` with
phase "complete" — it refuses if any sub-project is still open, and completing
freezes the project's document record.

**Log time**
\`log_hours\`, with a description of what was actually done. Backdating up to 7
days. "3.5 hrs — ran the tensile coupons" is worth far more to the RE than a
bare number.

**Getting started as a new member**
\`whoami\` lists what's missing from their profile. Fix it with
\`update_my_profile\` — skills matter most, because Find Work ranks projects by
them, and Discord matters second, because it's how the club actually reaches
people. Then \`find_work\` for where to help, and tell them to ask the RE named
on the project.`;

const WEBSITE_ONLY = `# What needs the website

No tool exists for these. Say so plainly and point at the site — don't attempt
a workaround.

- Deleting anything: projects, members, divisions
- Archiving a division
- Changing someone's role, or who they report to
- Club settings, commitment tiers, the academic calendar
- Removing someone from a project
- Withdrawing a sign-off
- Uploading files (links work here; uploads need a browser)
- Verifying a Discord ID (one click in Settings)
- Approving a training or facility-access request

Each is rare, hard to undo, or both.

**Two that are absent for a reason worth repeating:**

*Submitting a check-in.* Its purpose is to prompt a conversation with the
member's Lead. One you wrote for them is worse than none. If asked, offer to
help them think through what to say, and let them type it.

*Reading anyone's hours, check-in contents or reliability but the caller's own.*
The club's privacy model gives effort data to the member and their Lead chain.
Rather than reproduce that rule out here, this connection doesn't expose it at
all — for anybody, at any role. Point at the website, where the session is real.`;

const SECTIONS: Record<GuideTopic, string> = {
  "getting-started": GETTING_STARTED,
  "how-the-club-works": HOW_THE_CLUB_WORKS,
  permissions: PERMISSIONS,
  workflows: WORKFLOWS,
  "website-only": WEBSITE_ONLY,
};

/** One topic, or all of them when nothing specific was asked for. */
export function guideFor(topic?: GuideTopic): string {
  if (topic) return SECTIONS[topic];
  return GUIDE_TOPICS.map((t) => SECTIONS[t]).join("\n\n---\n\n");
}

/**
 * The short version, handed to the client at `initialize`.
 *
 * Deliberately brief: this is prepended to the model's context for the whole
 * conversation whether it's needed or not, so it covers only what changes
 * behaviour immediately, and points at `guide` for the rest.
 */
export const SERVER_INSTRUCTIONS = `SkyRunners — Stanford UAV project and member management. You act as the member whose token this is, with exactly their permissions.

Start with \`whoami\`, then \`catch_up\`. Call \`guide\` for how the club works, who can do what, or common workflows — do that before answering anything you're unsure of rather than guessing.

Vocabulary that changes what you do:
- A DELIVERABLE is one unit of work with ONE owner and a due date. That is the entire task model; there are no sub-tasks or dependencies.
- PHASE is where a project sits in its lifecycle. HEALTH is how it's going. Different fields.
- Marking work done is a REQUEST; an RE signing it off is what counts.
- RE authority inherits DOWN the project tree, and a Division Lead is a top RE over their whole division.
- Blocking a deliverable requires a note — it's DMed to whoever must clear it.

Confirm with the user before reassigning someone else's work, moving a date others depend on, or marking anything complete.

Some things are website-only and have no tool: deleting anything, archiving a division, changing roles or reporting lines, club settings, the academic calendar, removing someone from a project, withdrawing a sign-off, submitting a check-in, and reading anyone's hours or check-in contents but your own. Say so and point at the website; don't work around it.`;
