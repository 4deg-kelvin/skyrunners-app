/**
 * Exercise every page's data function against the REAL database.
 *
 *   PW=<db-password> npm run verify:live
 *
 * Answers the question a build cannot: does each page actually work on live
 * data? It loads the whole database over SQL, installs it as the live store,
 * then calls the `lib/data/*` function behind every route.
 *
 * Reads only — no writes, nothing mutated. Safe against production.
 *
 * Needs the alias loader because `lib/data/*` imports via `@/…`, which plain
 * Node doesn't resolve. See scripts/alias-hooks.mjs.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL =
  "https://ldijsmcnjrihwvxtypqy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_JEqTbPs2obkLIX2mo7qJYQ_6VXCPc5D";

import pg from "pg";

/**
 * Hand back date/time columns as raw strings.
 *
 * This harness reads over SQL, but the APP reads over PostgREST — and the two
 * disagree: node-postgres parses timestamps into JavaScript `Date` objects,
 * PostgREST returns ISO strings. `lib/types.ts` says string, and the code does
 * `submittedAt.slice(0, 10)`.
 *
 * So the harness reported "iso.slice is not a function" for a page that works
 * perfectly in production. A verification script that fails differently from
 * the real thing is worse than none — it costs a debugging session and trains
 * you to ignore it. 1082 = date, 1114 = timestamp, 1184 = timestamptz.
 */
for (const oid of [1082, 1114, 1184]) {
  pg.types.setTypeParser(oid, (v: string) => v);
}
import { installLiveBackend } from "../lib/store/disk.ts";
import { COLLECTIONS } from "../lib/store/mapping.ts";

// Load the real database over SQL (bypasses RLS, so we see everything the
// signed-in Co-Lead would).
const c = new pg.Client({
  host: "aws-0-ca-central-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.ldijsmcnjrihwvxtypqy",
  password: process.env.PW,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const snap: any = { version: 5 };
for (const spec of COLLECTIONS) {
  const { rows } = await c.query(`select ${spec.columns} from ${spec.table}`);
  snap[spec.key] = rows.map((r: any) => spec.fromRow(r));
}
// Mirror ENTRY_COLUMNS in lib/store/supabase.ts, including the PL response
// columns added in 0016 — a harness that reads fewer columns than the app
// passes on data the app would choke on.
const ent = await c.query(
  "select id, update_id, project_id, progress, blockers, next_steps, hours, response, responded_by, responded_at from update_entries"
);
for (const u of snap.progressUpdates)
  u.entries = ent.rows.filter((e: any) => e.update_id === u.id);
const reBy = new Map<string, string[]>();
for (const m of snap.projectMemberships)
  if (m.role === "re")
    reBy.set(m.projectId, [...(reBy.get(m.projectId) ?? []), m.memberId]);
for (const p of snap.projects) {
  const ids = reBy.get(p.id) ?? [];
  if (p.primaryReId && !ids.includes(p.primaryReId)) ids.unshift(p.primaryReId);
  p.reIds = ids;
}
await c.end();

// Import the data modules BEFORE installing our backend. `lib/store/request.ts`
// installs its own at module scope, so loading it afterwards would silently
// replace ours — and every call would then try to build a Supabase client and
// die on `cookies` outside a request scope.
const dataModules = {
  myWork: await import("../lib/data/my-work.ts"),
  findWork: await import("../lib/data/find-work.ts"),
  members: await import("../lib/data/members.ts"),
  projects: await import("../lib/data/projects.ts"),
  dashboard: await import("../lib/data/dashboard.ts"),
  settings: await import("../lib/data/settings.ts"),
  events: await import("../lib/data/events.ts"),
  blockers: await import("../lib/data/blockers.ts"),
  trainings: await import("../lib/data/trainings.ts"),
  deadlines: await import("../lib/data/deadlines.ts"),
};

installLiveBackend(
  () => snap,
  async () => {}
);
console.log(
  `loaded: ${snap.members.length} members, ${snap.projects.length} projects, ${snap.teams.length} teams\n`
);

const me = snap.members.find((m: any) => m.email === "anish25@stanford.edu");
const actor = { id: me.id, globalRole: me.globalRole };
// All four OrgGraph lookups. `getTeam` is what the Division-Lead-is-a-top-PL
// rule walks, and omitting it doesn't fail to compile — `scripts` is excluded
// from tsconfig — it fails at runtime, inside a permission check, as
// "graph.getTeam is not a function". Add every new lookup here too.
const { directREs, getMember, getProject, getTeam } =
  await import("../lib/mock-data.ts");
const graph = { getMember, getProject, directREs, getTeam };

async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log("  ✓ " + name);
  } catch (e) {
    const error = e as Error;
    console.log(
      "  ✗ " + name + "  →  " + error.message.split("\n")[0].slice(0, 90)
    );
    // The first app frame. Without it a failure names the symptom and not the
    // line, which costs a round trip every single time.
    const frame = (error.stack ?? "")
      .split("\n")
      .find((l) => l.includes("lib") && l.includes(".ts"));
    if (frame) console.log("      " + frame.trim());
  }
}

await check("/my-work        getMyWork", async () =>
  dataModules.myWork.getMyWork(me.id)
);
await check("/find-work      getFindWork", async () =>
  dataModules.findWork.getFindWork(me.id, me.skills ?? [])
);
await check("/members        getRoster", async () =>
  dataModules.members.getRoster()
);
await check("/members/[id]   getMemberProfile", async () =>
  dataModules.members.getMemberProfile(me.id, true)
);
await check("/projects       getProjectTree", async () =>
  dataModules.projects.getProjectTree()
);
await check("/projects       getProjectFormOptions", async () =>
  dataModules.projects.getProjectFormOptions()
);
await check("/projects       countArchivedDivisions", async () =>
  dataModules.projects.countArchivedDivisions()
);
await check("/projects/archive getArchivedDivisions", async () =>
  dataModules.projects.getArchivedDivisions()
);
// The one route whose data function takes a slug, so it needs a real project.
// Skipped rather than failed on an empty club: a red line for "there is no
// project to open" would train you to ignore the red lines.
await check("/projects/[slug] getProjectBySlug", async () =>
  snap.projects[0]
    ? dataModules.projects.getProjectBySlug(snap.projects[0].slug, me.id)
    : Promise.resolve(null)
);
await check("/dashboard      getDashboard", async () =>
  dataModules.dashboard.getDashboard(actor, graph)
);
await check("/settings       getSettings", async () =>
  dataModules.settings.getSettings(me.id)
);
await check("/calendar       getUpcomingEvents", async () =>
  dataModules.events.getUpcomingEvents()
);
await check("/calendar       getCalendar", async () =>
  dataModules.events.getCalendar({ memberId: me.id, isLeadership: true })
);
await check("/find-work      getOpenAsks", async () =>
  dataModules.blockers.getOpenAsks(actor)
);
await check("/projects       getDivisionExtras", async () =>
  dataModules.deadlines.getDivisionExtras()
);
await check("/members/[id]   getTrainings", async () =>
  dataModules.trainings.getTrainings(me.id)
);
await check("/settings       getCatalogue", async () =>
  dataModules.trainings.getCatalogue()
);

// The exact call shape the pages use. /members and /projects fire their data
// functions in a Promise.all ALONGSIDE getViewer, so the read starts before the
// preload finishes — which is what broke every page but My Work and Dashboard.
console.log("");
console.log("page-shaped calls (Promise.all racing the preload):");
const m = dataModules.members;
const pr = dataModules.projects;
await check("/members   roster racing the preload", async () =>
  Promise.all([m.getRoster()])
);
await check("/projects  tree + orphans + options in parallel", async () =>
  Promise.all([
    pr.getProjectTree(),
    pr.getOrphanedProjects(),
    pr.getProjectFormOptions(),
  ])
);
