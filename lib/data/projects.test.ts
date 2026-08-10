/**
 * The project tree comes back in a stable, alphabetical order.
 *
 * Run with:  npm test
 *
 * ---------------------------------------------------------------------------
 * Why this is worth a test
 * ---------------------------------------------------------------------------
 *
 * `/projects` is the discoverability page. Its whole job is that somebody can
 * find the work they're looking for — and the order used to be whatever
 * Postgres handed back, which is not merely arbitrary but **not stable**. Two
 * loads could list the divisions differently, so finding Airframe meant
 * reading the page top to bottom every single time.
 *
 * Ordering also fails silently. Nothing throws, nothing looks broken, and the
 * only way to notice is to be the person hunting for a project. A new call
 * site that filters the store by hand instead of going through
 * `childProjects()` would quietly reintroduce it, which is exactly what these
 * assertions are here to catch.
 *
 * `SKYRUNNERS_STORE_DIR` is set BEFORE the store module loads, because
 * `disk.ts` resolves its path at module scope: a static top-level import would
 * bind the developer's real `.data/` directory and this suite would rewrite it.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-projects-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let disk: typeof import("../store/disk.ts");
let getProjectTree: typeof import("./projects.ts").getProjectTree;

before(async () => {
  disk = await import("../store/disk.ts");
  ({ getProjectTree } = await import("./projects.ts"));
});

beforeEach(() => {
  disk.resetStore();
});

process.on("exit", () => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Best effort — a leftover temp dir is harmless.
  }
});

/** True when every entry is <= the next one, by the same rule the app uses. */
function isSorted(names: string[]): boolean {
  return names.every(
    (name, i) => i === 0 || names[i - 1].localeCompare(name) <= 0
  );
}

/** Every project name in the tree, one array per nesting level walked. */
function allLevels(
  nodes: { project: { name: string }; children: unknown[] }[]
): string[][] {
  if (nodes.length === 0) return [];
  const here = [nodes.map((n) => n.project.name)];
  const below = nodes.flatMap((n) => allLevels(n.children as typeof nodes));
  return [...here, ...below];
}

describe("the project tree is alphabetical", () => {
  test("divisions are in name order", async () => {
    const tree = await getProjectTree();
    const names = tree.map((d) => d.division.name);

    assert.ok(
      names.length > 1,
      "seed needs several divisions to be meaningful"
    );
    assert.ok(isSorted(names), `divisions out of order: ${names.join(", ")}`);
  });

  test("root projects inside each division are in name order", async () => {
    const tree = await getProjectTree();
    let checked = 0;

    for (const division of tree) {
      const names = division.roots.map((r) => r.project.name);
      if (names.length > 1) checked++;
      assert.ok(
        isSorted(names),
        `${division.division.name}: ${names.join(", ")}`
      );
    }

    assert.ok(checked > 0, "seed needs a division with several projects");
  });

  /*
    The tree recurses through `childProjects()`, so sorting it once should hold
    all the way down. This walks every level rather than just the second,
    because "we sorted the top two levels" is the shape the bug comes back in.
  */
  test("sub-projects are in name order at every depth", async () => {
    const tree = await getProjectTree();

    for (const division of tree) {
      for (const level of allLevels(division.roots)) {
        assert.ok(isSorted(level), `out of order: ${level.join(", ")}`);
      }
    }
  });

  test("the order does not change between calls", async () => {
    const first = await getProjectTree();
    const second = await getProjectTree();

    assert.deepEqual(
      first.map((d) => [d.division.name, d.roots.map((r) => r.project.name)]),
      second.map((d) => [d.division.name, d.roots.map((r) => r.project.name)])
    );
  });
});
