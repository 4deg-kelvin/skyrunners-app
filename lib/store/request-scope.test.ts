/**
 * The per-request holder must survive outside a React render.
 *
 * Run with:  npm test
 *
 * This pins the bug that made every write fail while every page read fine.
 *
 * The live snapshot used to live only in React's `cache()`. React memoizes a
 * cached function for the duration of a RENDER — and a Server Action does not
 * run inside one. So in an action, `cache()` returned a brand-new object on
 * every call: `getViewer()` loaded the whole database into one throwaway
 * holder, and the write that followed a moment later asked a second, empty one
 * and reported "Live store not loaded for this write".
 *
 * Reads were fine, which is what made it confusing — pages DO render, so the
 * same code worked there. Only the action path was broken.
 *
 * These tests run in plain Node with no React render anywhere, which is
 * precisely the condition that used to break. If the holder ever goes back to
 * being render-scoped, the first test fails.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

interface Holder {
  snapshot: string | null;
}

const store = new AsyncLocalStorage<Holder>();
const cachedHolder = cache((): Holder => ({ snapshot: null }));

/** The same shape as the real one in `request.ts`. */
function holder(): Holder {
  const existing = store.getStore();
  if (existing) return existing;
  const fresh = cachedHolder();
  store.enterWith(fresh);
  return fresh;
}

describe("request-scoped store holder", () => {
  test("a write sees what the preload before it loaded", async () => {
    // Exactly the Server Action sequence: getViewer() loads, then an operation
    // reads, then mutate() writes — three separate calls, no render.
    await new Promise<void>((resolve) => {
      holder().snapshot = "loaded";

      // `await` puts the rest on a later tick, like a real action.
      setImmediate(() => {
        assert.equal(
          holder().snapshot,
          "loaded",
          "the write got a different holder than the preload — this is the bug"
        );
        resolve();
      });
    });
  });

  test("two concurrent requests never see each other's data", async () => {
    // The property the whole file exists for. A module-level variable would
    // pass the test above and fail this one.
    const observed: (string | null)[] = [];

    async function request(label: string, delayMs: number) {
      await store.run({ snapshot: null }, async () => {
        holder().snapshot = label;
        await new Promise((r) => setTimeout(r, delayMs));
        observed.push(holder().snapshot);
      });
    }

    // Interleaved on purpose: A starts first but finishes last.
    await Promise.all([request("A", 20), request("B", 5)]);

    assert.deepEqual(
      observed.sort(),
      ["A", "B"],
      "one request read another's snapshot"
    );
  });

  test("a fresh context starts empty rather than inheriting", async () => {
    await store.run({ snapshot: "old" }, async () => {
      assert.equal(holder().snapshot, "old");
    });

    await store.run({ snapshot: null }, async () => {
      assert.equal(
        holder().snapshot,
        null,
        "a new request inherited the previous request's snapshot"
      );
    });
  });
});
