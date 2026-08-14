/**
 * Calendar feed tokens, and the client detection the badge rests on.
 *
 * Run with:  npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  clientFromUserAgent,
  FEED_TOKEN_PREFIX,
  generateFeedToken,
  hashFeedToken,
  looksLikeFeedToken,
} from "./feed-token.ts";

describe("minting a token", () => {
  test("it carries the prefix and is long", () => {
    const token = generateFeedToken();
    assert.ok(token.startsWith(FEED_TOKEN_PREFIX));
    assert.ok(token.length > 40);
  });

  test("two tokens are never the same", () => {
    const seen = new Set(Array.from({ length: 200 }, generateFeedToken));
    assert.equal(seen.size, 200);
  });

  test("it is URL-safe, because it lives in a path", () => {
    // The whole point of this token: it goes in a URL a member pastes into Apple
    // Calendar. A `+` or `/` from standard base64 would be mangled or would
    // change the path.
    for (let i = 0; i < 50; i++) {
      const body = generateFeedToken().slice(FEED_TOKEN_PREFIX.length);
      assert.match(body, /^[A-Za-z0-9_-]+$/);
    }
  });

  test("the prefix is distinct from an MCP token", () => {
    // They grant completely different things — a read-only calendar versus
    // acting as the member — and mixing them up in a support conversation is
    // answered instantly by the prefix.
    assert.notEqual(FEED_TOKEN_PREFIX, "skr_");
  });
});

describe("hashing", () => {
  test("the same token hashes the same way", () => {
    const t = generateFeedToken();
    assert.equal(hashFeedToken(t), hashFeedToken(t));
  });

  test("surrounding whitespace is ignored", () => {
    // Pasted URLs pick up spaces and newlines constantly.
    const t = generateFeedToken();
    assert.equal(hashFeedToken(` ${t}\n`), hashFeedToken(t));
  });

  test("the hash does not contain the token", () => {
    const t = generateFeedToken();
    const h = hashFeedToken(t);
    assert.ok(!h.includes(t.slice(FEED_TOKEN_PREFIX.length)));
    assert.match(h, /^[0-9a-f]{64}$/);
  });
});

describe("shape check before a database round trip", () => {
  test("a real token passes", () => {
    assert.equal(looksLikeFeedToken(generateFeedToken()), true);
  });

  test("obvious rubbish is rejected without a query", () => {
    for (const bad of [
      "",
      "cal_",
      "cal_short",
      "skr_wrongprefix00000000000000000000",
      "nonsense",
      "cal_has spaces in it aaaaaaaaaaaaaaaaa",
      "cal_has/slash/aaaaaaaaaaaaaaaaaaaaaaa",
    ]) {
      assert.equal(looksLikeFeedToken(bad), false, `should reject: ${bad}`);
    }
  });
});

/**
 * The badge says which calendars are connected, and this is the only thing that
 * can know. A subscription involves no handshake — the server is never told who
 * subscribed, it just receives a GET — so the client family is read from the
 * User-Agent, and the badge reports what has actually fetched rather than what
 * the member claims to use.
 */
describe("recognising the calendar client", () => {
  test("Google's importer", () => {
    assert.equal(clientFromUserAgent("Google-Calendar-Importer"), "google");
  });

  test("Apple, all three ways it shows up", () => {
    /*
      macOS Calendar sends CalendarAgent, iOS sends dataaccessd, and both can
      appear behind a plain product token. Matching only "calendaragent" would
      report an iPhone as `other` — the commonest device in this club.
    */
    for (const ua of [
      "Mac OS X/10.15.7 (19H2) CalendarAgent/972.1",
      "iOS/17.4 (21E219) dataaccessd/1.0",
      "iPhone/17.4 dataaccessd",
    ]) {
      assert.equal(clientFromUserAgent(ua), "apple", ua);
    }
  });

  test("Outlook and Microsoft's fetchers", () => {
    for (const ua of [
      "Microsoft Outlook 16.0",
      "Outlook-iOS/2.0",
      "Microsoft Office Outlook",
    ]) {
      assert.equal(clientFromUserAgent(ua), "outlook", ua);
    }
  });

  test("anything else is `other`, which is still a real answer", () => {
    /*
      `other` is deliberately not a failure. An unrecognised agent still proves
      SOMETHING is subscribed, which is the fact the badge is actually
      reporting — and these strings are someone else's implementation detail
      that could change without notice.
    */
    assert.equal(clientFromUserAgent("Thunderbird/115.0"), "other");
    assert.equal(clientFromUserAgent("curl/8.4.0"), "other");
    assert.equal(clientFromUserAgent(null), "other");
    assert.equal(clientFromUserAgent(""), "other");
  });

  test("vendor clients on Apple platforms are NOT Apple", () => {
    /*
      The bug this caught on the first attempt. Outlook and Google both ship
      mobile clients whose agents carry platform tokens, and Apple's own clients
      are matched by broad tokens like `iOS/`. Test the platforms first and
      Outlook on an iPhone is reported as Apple Calendar.
    */
    assert.equal(clientFromUserAgent("Outlook-iOS/2.0"), "outlook");
    assert.equal(clientFromUserAgent("Outlook-Android/4.0"), "outlook");
    assert.equal(
      clientFromUserAgent("Microsoft Outlook 16.0 (Mac OS X)"),
      "outlook"
    );
  });

  test("Google is checked before Apple", () => {
    // Google's fetcher has historically included platform tokens. If Apple's
    // broad "mac os x" match ran first it would swallow them.
    assert.equal(
      clientFromUserAgent("Google-Calendar-Importer (Mac OS X)"),
      "google"
    );
  });
});
