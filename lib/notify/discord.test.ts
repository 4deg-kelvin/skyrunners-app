/**
 * Discord DMs must never be able to break a save.
 *
 * Run with:  npm test
 *
 * These are called from Server Actions AFTER the write has committed, so every
 * failure mode has exactly one correct behaviour: return false, log, and let
 * the action succeed. A member logging hours must not see "couldn't save that"
 * because Discord was rate-limiting.
 */

import assert from "node:assert/strict";
import { test, describe, beforeEach, afterEach } from "node:test";

import {
  discordIsConfigured,
  discordMessages,
  sendDiscordDM,
} from "./discord.ts";

const realFetch = globalThis.fetch;
const realToken = process.env.DISCORD_BOT_TOKEN;

beforeEach(() => {
  delete process.env.DISCORD_BOT_TOKEN;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
  else process.env.DISCORD_BOT_TOKEN = realToken;
});

describe("sending is optional at every step", () => {
  test("no token configured means no send and no error", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;

    assert.equal(discordIsConfigured(), false);
    assert.equal(await sendDiscordDM("461208577118896129", "hi"), false);
    assert.equal(called, false, "must not reach the network with no token");
  });

  test("a member with no Discord id is skipped", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;

    assert.equal(await sendDiscordDM(undefined, "hi"), false);
    assert.equal(called, false);
  });

  test("Discord refusing the DM returns false rather than throwing", async () => {
    /*
      The commonest real case: the recipient shares no server with the bot, or
      has DMs from server members switched off. Both are their setting, not a
      bug, and neither is worth failing somebody's save over.
    */
    process.env.DISCORD_BOT_TOKEN = "test-token";
    globalThis.fetch = (async () =>
      new Response("{}", { status: 403 })) as typeof fetch;

    assert.equal(await sendDiscordDM("461208577118896129", "hi"), false);
  });

  test("a network failure returns false rather than throwing", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    globalThis.fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;

    assert.equal(await sendDiscordDM("461208577118896129", "hi"), false);
  });

  test("the happy path opens a channel, then posts to it", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith("/users/@me/channels")) {
        return new Response(JSON.stringify({ id: "chan-1" }));
      }
      return new Response("{}");
    }) as unknown as typeof fetch;

    assert.equal(await sendDiscordDM("461208577118896129", "hi"), true);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /users\/@me\/channels$/);
    // Discord has no "send to user" endpoint — the channel id from the first
    // call is the whole reason there's a second.
    assert.match(calls[1], /channels\/chan-1\/messages$/);
  });

  test("the bot token is sent as a Bot credential, not a bearer", async () => {
    // `Authorization: Bearer <token>` is silently rejected by Discord with a
    // 401 that reads like a bad token.
    process.env.DISCORD_BOT_TOKEN = "test-token";
    let auth: string | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>)?.Authorization;
      return new Response(JSON.stringify({ id: "chan-1" }));
    }) as unknown as typeof fetch;

    await sendDiscordDM("461208577118896129", "hi");
    assert.equal(auth, "Bot test-token");
  });
});

describe("the messages make sense on a lock screen", () => {
  test("each one names the person or project, not just the event", () => {
    // "You were added to a project" is useless in a notification shade.
    const added = discordMessages.addedToProject({
      projectName: "Wing Spar Redesign",
      addedBy: "Priya",
      url: "https://hq.example/projects/wing-spar",
    });
    assert.match(added, /Priya/);
    assert.match(added, /Wing Spar Redesign/);
    assert.match(added, /https:\/\//);
  });

  test("a decline carries the RE's note when there is one", () => {
    const withNote = discordMessages.joinRequestDeclined({
      projectName: "Layup",
      note: "Full for now — try again next quarter.",
    });
    assert.match(withNote, /next quarter/);

    // And reads fine without one, rather than leaving a dangling quote block.
    const bare = discordMessages.joinRequestDeclined({ projectName: "Layup" });
    assert.ok(!bare.includes(">"));
  });

  test("a check-in with no written projects doesn't claim a count", () => {
    const none = discordMessages.checkInSubmitted({
      memberName: "Kenji",
      projectCount: 0,
      url: "https://hq.example/dashboard",
    });
    assert.ok(!none.includes("0 project"));

    const one = discordMessages.checkInSubmitted({
      memberName: "Kenji",
      projectCount: 1,
      url: "https://hq.example/dashboard",
    });
    assert.match(one, /1 project\b/);
    assert.ok(!one.includes("1 projects"));
  });
});
