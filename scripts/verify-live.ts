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

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ldijsmcnjrihwvxtypqy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JEqTbPs2obkLIX2mo7qJYQ_6VXCPc5D";

import pg from "pg";
import { installLiveBackend } from "../lib/store/disk.ts";
import { COLLECTIONS } from "../lib/store/mapping.ts";

// Load the real database over SQL (bypasses RLS, so we see everything the
// signed-in Co-Lead would).
const c = new pg.Client({
  host: "aws-0-ca-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.ldijsmcnjrihwvxtypqy", password: process.env.PW,
  database: "postgres", ssl: { rejectUnauthorized: false },
});
await c.connect();

const snap: any = { version: 5 };
for (const spec of COLLECTIONS) {
  const { rows } = await c.query(`select ${spec.columns} from ${spec.table}`);
  snap[spec.key] = rows.map((r: any) => spec.fromRow(r));
}
const ent = await c.query("select id, update_id, project_id, progress, blockers, next_steps, hours from update_entries");
for (const u of snap.progressUpdates) u.entries = ent.rows.filter((e: any) => e.update_id === u.id);
const reBy = new Map<string, string[]>();
for (const m of snap.projectMemberships) if (m.role === "re") reBy.set(m.projectId, [...(reBy.get(m.projectId) ?? []), m.memberId]);
for (const p of snap.projects) { const ids = reBy.get(p.id) ?? []; if (p.primaryReId && !ids.includes(p.primaryReId)) ids.unshift(p.primaryReId); p.reIds = ids; }
await c.end();

installLiveBackend(() => snap, async () => {});
console.log(`loaded: ${snap.members.length} members, ${snap.projects.length} projects, ${snap.teams.length} teams\n`);

const me = snap.members.find((m: any) => m.email === "anish25@stanford.edu");
const actor = { id: me.id, globalRole: me.globalRole };
const { directREs, getMember, getProject } = await import("../lib/mock-data.ts");
const graph = { getMember, getProject, directREs };

async function check(name: string, fn: () => Promise<unknown>) {
  try { await fn(); console.log("  ✓ " + name); }
  catch (e) { console.log("  ✗ " + name + "  →  " + (e as Error).message.split("\n")[0].slice(0, 90)); }
}

await check("/my-work        getMyWork", async () => (await import("../lib/data/my-work.ts")).getMyWork(me.id));
await check("/find-work      getFindWork", async () => (await import("../lib/data/find-work.ts")).getFindWork(me.id, me.skills ?? []));
await check("/members        getRoster", async () => (await import("../lib/data/members.ts")).getRoster());
await check("/members        getRosterOptions", async () => (await import("../lib/data/members.ts")).getRosterOptions());
await check("/members/[id]   getMemberProfile", async () => (await import("../lib/data/members.ts")).getMemberProfile(me.id, true));
await check("/projects       getProjectTree", async () => (await import("../lib/data/projects.ts")).getProjectTree());
await check("/projects       getProjectFormOptions", async () => (await import("../lib/data/projects.ts")).getProjectFormOptions());
await check("/dashboard      getDashboard", async () => (await import("../lib/data/dashboard.ts")).getDashboard(actor, graph));
await check("/updates        getUpdates", async () => (await import("../lib/data/updates.ts")).getUpdates(actor));
await check("/settings       getSettings", async () => (await import("../lib/data/settings.ts")).getSettings(me.id));
await check("/calendar       getUpcomingEvents", async () => (await import("../lib/data/events.ts")).getUpcomingEvents());
