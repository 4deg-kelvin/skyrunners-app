import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadSnapshot } from "./supabase.ts";
import { loadLiveOrgGraph } from "../data/graph.ts";

// Exercise the real Supabase query builder, with HTTP replaced by a capped
// PostgREST response. No credentials and no network access are used.
function database(cap = 1000, failAfterFirst = false) {
  const rows = Array.from({ length: 1005 }, (_, i) => ({
    id: `p-${String(i).padStart(4, "0")}`,
    name: `Project ${i}`,
    slug: `project-${i}`,
    parent_id: null,
    primary_re_id: "lead",
    phase: "concept",
    health: "on_track",
  }));
  const calls: URL[] = [];
  const client = createClient("https://test.supabase.co", "test", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        calls.push(url);
        const table = url.pathname.split("/").at(-1);
        const source = table === "projects" ? rows : [];
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (failAfterFirst && table === "projects" && offset > 0) {
          return new Response(
            JSON.stringify({ message: "page unavailable", code: "test" }),
            { status: 400 }
          );
        }
        const page = source.slice(
          offset,
          offset + Math.min(cap, Number(url.searchParams.get("limit") ?? cap))
        );
        return new Response(JSON.stringify(page), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Range": `${page.length ? `${offset}-${offset + page.length - 1}` : "*"}/${source.length}`,
          },
        });
      },
    },
  });
  return { client, calls };
}

test("snapshot includes projects beyond the default API row cap", async () => {
  const { client, calls } = database();
  const store = await loadSnapshot(client);
  assert.equal(store.projects.length, 1005);
  assert.equal(store.projects.at(-1)?.id, "p-1004");
  assert.ok(calls.every((url) => url.searchParams.has("order")));
  const membership = calls.find((url) =>
    url.pathname.endsWith("/project_members")
  )!;
  assert.equal(
    membership.searchParams.get("order"),
    "project_id.asc,member_id.asc"
  );
});

test("a lower configured row cap does not silently truncate the snapshot", async () => {
  const { client } = database(250);
  assert.equal((await loadSnapshot(client)).projects.length, 1005);
});

test("permissions retain a project lead beyond the first page", async () => {
  const { client, calls } = database();
  const graph = await loadLiveOrgGraph(client);
  assert.deepEqual(graph.directREs("p-1004"), ["lead"]);
  const membership = calls.find((url) =>
    url.pathname.endsWith("/project_members")
  )!;
  assert.equal(membership.searchParams.get("left_at"), "is.null");
  assert.equal(membership.searchParams.get("role"), "eq.re");
});

test("a later page failing rejects the whole snapshot and graph", async () => {
  await assert.rejects(
    loadSnapshot(database(1000, true).client),
    /page unavailable/
  );
  await assert.rejects(
    loadLiveOrgGraph(database(1000, true).client),
    /page unavailable/
  );
});
