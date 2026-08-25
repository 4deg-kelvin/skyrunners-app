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
  verifyDiscordDM,
  DISCORD_PROBLEM_MESSAGE,
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

  test("a decline carries the PL's note when there is one", () => {
    const withNote = discordMessages.joinRequestDeclined({
      projectName: "Layup",
      note: "Full for now — try again next quarter.",
    });
    assert.match(withNote, /next quarter/);

    // And reads fine without one, rather than leaving a dangling quote block.
    const bare = discordMessages.joinRequestDeclined({ projectName: "Layup" });
    assert.ok(!bare.includes(">"));
  });

  /*
    A `checkInSubmitted` pluralisation test was here -- "1 project" not
    "1 projects", and no "0 project" clause at all. The template went with
    check-ins; its only remaining references were these assertions.

    The rule it was protecting is still worth applying to any new template:
    never emit a count of zero as prose. "covering 0 projects" is worse than
    saying nothing, and it is the kind of thing that only shows up in the one
    case nobody tries by hand.
  */
});

describe("verification distinguishes whose problem it is", () => {
  test("no token at all", async () => {
    const r = await verifyDiscordDM("461208577118896129", "hi");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.problem, "not-configured");
  });

  test("a 401 is the CLUB's bad token, not the member's settings", async () => {
    /*
      The one that would waste an hour. A revoked or mistyped bot token reads
      as "Discord blocked the message" if it isn't separated out, and the
      member goes hunting through their own privacy settings for a fault that
      is entirely on our side.
    */
    process.env.DISCORD_BOT_TOKEN = "test-token";
    globalThis.fetch = (async () =>
      new Response("{}", { status: 401 })) as typeof fetch;

    const r = await verifyDiscordDM("461208577118896129", "hi");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.problem, "bad-token");
      assert.match(
        DISCORD_PROBLEM_MESSAGE[r.problem],
        /our problem, not yours/
      );
    }
  });

  test("a 404 means that ID isn't a person", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    globalThis.fetch = (async () =>
      new Response("{}", { status: 404 })) as typeof fetch;

    const r = await verifyDiscordDM("461208577118896129", "hi");
    if (!r.ok) {
      assert.equal(r.problem, "unknown-user");
      // The fix is copying the right ID, so the message says how.
      assert.match(DISCORD_PROBLEM_MESSAGE[r.problem], /Developer Mode/);
    }
  });

  test("a 403 on the message is their privacy settings", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    globalThis.fetch = (async (url: string | URL | Request) =>
      String(url).endsWith("/users/@me/channels")
        ? new Response(JSON.stringify({ id: "chan-1" }))
        : new Response("{}", { status: 403 })) as unknown as typeof fetch;

    const r = await verifyDiscordDM("461208577118896129", "hi");
    if (!r.ok) {
      assert.equal(r.problem, "cannot-dm");
      assert.match(DISCORD_PROBLEM_MESSAGE[r.problem], /server/i);
    }
  });

  test("success reports success", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "chan-1" }))) as typeof fetch;

    assert.deepEqual(await verifyDiscordDM("461208577118896129", "hi"), {
      ok: true,
    });
  });

  test("every problem has a message", () => {
    // A missing entry renders `undefined` in the error banner, which is the
    // worst possible thing to show somebody who just failed at something.
    for (const key of [
      "not-configured",
      "no-id",
      "unknown-user",
      "cannot-dm",
      "bad-token",
      "unreachable",
    ] as const) {
      assert.ok(DISCORD_PROBLEM_MESSAGE[key]?.length > 20, key);
    }
  });
});

/*
  =========================================================================
  The seven DMs added on 2026-08-24.
  =========================================================================

  What is worth pinning is not the wording — it is the FACTS each message has
  to carry. Every one of these replaced somebody having to go and ask, so a
  message missing the who, the what or the link puts them back where they
  started.

  Discord's 2000-character limit applies to all of them, and a message over it
  fails outright rather than truncating, so the length check is a real one.
*/
describe("what each DM has to say", () => {
  const URL = "https://skyrunners.example/projects/wing-spar";

  /** Every DM: has a link, is inside Discord's limit, no `undefined` leaked. */
  function wellFormed(body: string) {
    assert.ok(body.includes(URL), "carries a link back");
    assert.ok(body.length < 2000, "inside Discord's limit");
    assert.doesNotMatch(body, /undefined|null|NaN/);
  }

  test("signed off names the signer and the work", () => {
    const body = discordMessages.deliverableSignedOff({
      title: "Spar FEA converged",
      projectName: "Wing Spar Redesign",
      signedOffBy: "Priya",
      url: URL,
    });
    wellFormed(body);
    assert.match(body, /Spar FEA converged/);
    assert.match(body, /Priya/);
  });

  /*
    The reason is the whole message. "Your sign-off was withdrawn" without it
    leaves somebody with nothing to do but go and ask, which is the dead end
    this app exists to remove.
  */
  test("withdrawn carries the reason", () => {
    const body = discordMessages.signOffWithdrawn({
      title: "Spar FEA converged",
      projectName: "Wing Spar Redesign",
      withdrawnBy: "Priya",
      reason: "the 3.5g case was run at the wrong mass",
      url: URL,
    });
    wellFormed(body);
    assert.match(body, /wrong mass/);
  });

  test("assigned says who assigned it and when it is due", () => {
    const body = discordMessages.deliverableAssigned({
      title: "Coupon tensile test report",
      projectName: "Layup Process Qualification",
      assignedBy: "Marcus",
      dueDate: "Sep 3",
      url: URL,
    });
    wellFormed(body);
    assert.match(body, /Marcus/);
    assert.match(body, /Sep 3/);
  });

  /*
    A deliverable can be assigned with no date. The template must read as a
    sentence either way rather than saying "due undefined" — which `wellFormed`
    would catch, and which is the most common way an optional field ships
    broken.
  */
  test("assigned still reads as a sentence with no due date", () => {
    const body = discordMessages.deliverableAssigned({
      title: "Coupon tensile test report",
      projectName: "Layup Process Qualification",
      assignedBy: "Marcus",
      url: URL,
    });
    wellFormed(body);
  });

  test("awaiting sign-off names the person waiting on you", () => {
    const body = discordMessages.awaitingSignOff({
      title: "Load rig CAD complete",
      projectName: "Spar Load Testing",
      ownerName: "Noah",
      url: URL,
    });
    wellFormed(body);
    assert.match(body, /Noah/);
  });

  test("due soon offers the two honest outs", () => {
    const body = discordMessages.deliverableDueSoon({
      title: "Load rig CAD complete",
      projectName: "Spar Load Testing",
      dueDate: "in 2 days (2026-08-26)",
      url: URL,
    });
    wellFormed(body);
    // Move the date, or say it's blocked. A warning with no way out is just an
    // accusation.
    assert.match(body, /move the date/i);
    assert.match(body, /blocked/i);
  });

  test("blocker cleared closes the loop the app used to leave open", () => {
    const body = discordMessages.blockerCleared({
      what: "ROS 2 migration of the Gazebo world",
      projectName: "Simulation Environment",
      clearedBy: "Lena",
      url: URL,
    });
    wellFormed(body);
    assert.match(body, /Lena/);
  });

  test("a log reply quotes the reply", () => {
    const body = discordMessages.logReplied({
      replierName: "Priya",
      projectName: "Wing Spar Redesign",
      response: "nice — can you post the plots?",
      url: URL,
    });
    wellFormed(body);
    assert.match(body, /post the plots/);
    assert.match(body, /Priya/);
  });

  /*
    A reply is free text from a form. Somebody pasting a wall of log output
    must not produce a DM Discord rejects outright — which would lose the
    notification silently, since `sendDiscordDM` only logs.
  */
  test("a very long reply is still a sendable message", () => {
    const body = discordMessages.logReplied({
      replierName: "Priya",
      projectName: "Wing Spar Redesign",
      response: "x".repeat(5000),
      url: URL,
    });
    assert.ok(body.length < 2000, `was ${body.length} characters`);
    assert.ok(body.includes(URL), "the link survives the trim");
  });
  test("a very long withdrawal reason is too", () => {
    const body = discordMessages.signOffWithdrawn({
      title: "Spar FEA converged",
      projectName: "Wing Spar Redesign",
      withdrawnBy: "Priya",
      reason: "y".repeat(5000),
      url: URL,
    });
    assert.ok(body.length < 2000, `was ${body.length} characters`);
    assert.ok(body.includes(URL), "the link survives the trim");
  });

  /*
    `> ` quotes only the FIRST line in Discord's markdown. A multi-line paste
    renders as one quoted line followed by unattributed text that reads like
    the bot talking.
  */
  test("a multi-line reply is flattened, not left half-quoted", () => {
    const body = discordMessages.logReplied({
      replierName: "Priya",
      projectName: "Wing Spar Redesign",
      response: "line one\nline two\nline three",
      url: URL,
    });
    const quoted = body.split("\n").filter((l) => l.startsWith("> "));
    assert.equal(quoted.length, 1);
    assert.match(quoted[0], /line one line two line three/);
  });
});
