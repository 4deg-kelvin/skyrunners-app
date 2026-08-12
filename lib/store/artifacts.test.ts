/**
 * The engineering record — the write path.
 *
 * Run with:  npm test
 *
 * The rules worth pinning:
 *
 *   1. A link that expires cannot get in. Once a project completes the record
 *      freezes, so nobody will be around to fix a dead one.
 *   2. The confirmation is required, not decorative.
 *   3. What's stored is `externalUrl`, not `fileUrl` — the list reads that
 *      distinction to decide how to open the row.
 *
 * Same setup rules as the other store suites: `SKYRUNNERS_STORE_DIR` is set
 * BEFORE the store module is imported, because `disk.ts` resolves its path at
 * module scope and a static import would bind the developer's real `.data/`.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-artifacts-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let ops: typeof import("./operations.ts");
let disk: typeof import("./disk.ts");

const TODAY = "2026-08-11";
const MEMBER = "m-tyler";
const PROJECT = "p-airframe-v2";

before(async () => {
  ops = await import("./operations.ts");
  disk = await import("./disk.ts");
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

function attach(
  overrides: Partial<Parameters<typeof ops.addProjectArtifact>[0]> = {}
) {
  return ops.addProjectArtifact({
    projectId: PROJECT,
    uploadedById: MEMBER,
    kind: "cad",
    title: "Spar layup drawing",
    url: "https://cad.onshape.com/documents/abc/w/def/e/ghi",
    confirmedPermanent: true,
    today: TODAY,
    ...overrides,
  });
}

function recordFor(projectId: string) {
  return disk
    .readStore()
    .projectArtifacts.filter((a) => a.projectId === projectId);
}

describe("attaching to the engineering record", () => {
  test("a good link lands, and lands as externalUrl", async () => {
    const before = recordFor(PROJECT).length;
    const result = await attach();

    assert.equal(result.ok, true);
    assert.equal(recordFor(PROJECT).length, before + 1);

    const stored = recordFor(PROJECT).find(
      (a) => a.title === "Spar layup drawing"
    );
    assert.ok(stored);
    /*
      `fileUrl` means "a file this app hosts", which it doesn't do yet.
      `ArtifactList` reads the difference to decide whether to open in a new tab
      and show the outbound arrow, so storing it in the wrong column is a
      visible bug, not just an untidy one.
    */
    assert.equal(
      stored.externalUrl,
      "https://cad.onshape.com/documents/abc/w/def/e/ghi"
    );
    assert.equal(stored.fileUrl, undefined);
    assert.equal(stored.uploadedById, MEMBER);
    assert.equal(stored.createdAt, TODAY);
  });

  test("optional fields are dropped rather than stored empty", async () => {
    await attach({ title: "No extras", description: "  ", version: "" });
    const stored = recordFor(PROJECT).find((a) => a.title === "No extras");
    assert.ok(stored);
    assert.equal(stored.description, undefined);
    assert.equal(stored.version, undefined);
  });

  test("an unconfirmed link is refused, and the reason says why it matters", async () => {
    const result = await attach({ confirmedPermanent: false });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /frozen/i);
  });

  test("a signed download link is refused even WITH confirmation", async () => {
    /*
      The two checks are independent on purpose. Someone will tick the box out
      of habit, and a presigned S3 URL is provably temporary regardless of what
      they believe about it.
    */
    const result = await attach({
      url: "https://bucket.s3.amazonaws.com/spar.step?X-Amz-Signature=abc&X-Amz-Expires=3600",
      confirmedPermanent: true,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /temporary/i);
  });

  test("a bad link is reported before a missing confirmation", async () => {
    // Both wrong: the link is the more useful thing to hear about first.
    const result = await attach({
      url: "http://localhost:3000/spar.step",
      confirmedPermanent: false,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /nobody else can open it/i);
  });

  test("an empty title is refused", async () => {
    const result = await attach({ title: "   " });
    assert.equal(result.ok, false);
  });

  test("an unreasonably long title is refused", async () => {
    const result = await attach({ title: "x".repeat(161) });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /keep the title to a line/i);
  });

  test("attaching to a project that doesn't exist fails rather than throwing", async () => {
    const result = await attach({ projectId: "p-does-not-exist" });
    assert.equal(result.ok, false);
  });

  test("nothing is written when the link is refused", async () => {
    const before = recordFor(PROJECT).length;
    await attach({ url: "file:///C:/spar.step" });
    await attach({ confirmedPermanent: false });
    assert.equal(recordFor(PROJECT).length, before);
  });
});

describe("removing from the engineering record", () => {
  test("removes the row and leaves the rest alone", async () => {
    const result = await attach({ title: "Temporary mistake" });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const before = recordFor(PROJECT).length;
    const removed = await ops.removeProjectArtifact({
      artifactId: result.value.id,
    });

    assert.equal(removed.ok, true);
    assert.equal(recordFor(PROJECT).length, before - 1);
    assert.equal(
      recordFor(PROJECT).some((a) => a.id === result.value.id),
      false
    );
  });

  test("removing twice fails with a sentence rather than throwing", async () => {
    const result = await attach({ title: "Gone in a moment" });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    await ops.removeProjectArtifact({ artifactId: result.value.id });
    const second = await ops.removeProjectArtifact({
      artifactId: result.value.id,
    });

    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.error, /already been removed/i);
  });

  test("an unknown id fails rather than throwing", async () => {
    const result = await ops.removeProjectArtifact({ artifactId: "nope" });
    assert.equal(result.ok, false);
  });
});
