/**
 * Absolute link building.
 *
 * Worth testing because the failure is DELAYED and silent: a URL built from the
 * wrong variable works when it is created and dies on the next deploy, by which
 * time it is sitting in somebody's Apple Calendar or AI config with nothing to
 * explain it.
 */

import assert from "node:assert/strict";
import { test, describe, afterEach } from "node:test";

import { appUrl } from "./urls.ts";

const KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

function only(set: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(set)) process.env[k] = v;
}

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("which host wins", () => {
  test("an explicit site URL beats everything", () => {
    only({
      NEXT_PUBLIC_SITE_URL: "https://skyrunners.org",
      VERCEL_PROJECT_PRODUCTION_URL: "skyrunners-app.vercel.app",
      VERCEL_URL: "skyrunners-abc123.vercel.app",
    });
    assert.equal(appUrl("/calendar"), "https://skyrunners.org/calendar");
  });

  test("the STABLE production domain beats the per-deployment one", () => {
    /*
      The bug this file exists for. `VERCEL_URL` changes on every deploy, so a
      calendar subscription or an MCP config built from it works once and then
      quietly stops — with no error anywhere the member would see.
    */
    only({
      VERCEL_PROJECT_PRODUCTION_URL: "skyrunners-app.vercel.app",
      VERCEL_URL: "skyrunners-2qhfdv7k0-kelvins-projects.vercel.app",
    });
    assert.equal(
      appUrl("/calendar"),
      "https://skyrunners-app.vercel.app/calendar"
    );
  });

  test("the deployment host is the last resort, not the default", () => {
    only({ VERCEL_URL: "skyrunners-abc123.vercel.app" });
    assert.equal(
      appUrl("/calendar"),
      "https://skyrunners-abc123.vercel.app/calendar"
    );
  });

  test("localhost when nothing is set", () => {
    only({});
    assert.equal(appUrl("/calendar"), "http://localhost:3000/calendar");
  });
});

describe("shape", () => {
  test("a trailing slash on the configured URL is not doubled", () => {
    only({ NEXT_PUBLIC_SITE_URL: "https://skyrunners.org/" });
    assert.equal(appUrl("/calendar"), "https://skyrunners.org/calendar");
  });

  test("an empty path gives a bare origin, for building feed URLs", () => {
    // `rotateMyFeed` passes `appUrl("")` as the origin.
    only({ VERCEL_PROJECT_PRODUCTION_URL: "skyrunners-app.vercel.app" });
    assert.equal(appUrl(""), "https://skyrunners-app.vercel.app");
  });

  test("a blank env var is ignored rather than producing https://", () => {
    // An env var set to "" is a real Vercel state and would otherwise build
    // `https:///calendar`.
    only({ NEXT_PUBLIC_SITE_URL: "  ", VERCEL_URL: "x.vercel.app" });
    assert.equal(appUrl("/calendar"), "https://x.vercel.app/calendar");
  });
});
