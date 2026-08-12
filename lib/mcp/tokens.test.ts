/**
 * Tests for MCP token handling.
 *
 * Run with:  npm test
 *
 * These are credentials for an API that can reassign work across the club, so
 * the rules worth pinning are the ones whose failure is silent: a token that
 * should have stopped working and didn't, or two tokens that collide.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  TOKEN_PREFIX,
  checkTokenRow,
  cleanTokenName,
  expiryFrom,
  generateToken,
  hashToken,
  isTokenScope,
  looksLikeToken,
  tokenFromHeader,
  type TokenRow,
} from "./tokens.ts";

const NOW = new Date("2026-08-12T12:00:00Z");

function row(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id: "t-1",
    member_id: "m-1",
    name: "Laptop",
    scope: "read",
    expires_at: "2026-12-01T00:00:00Z",
    revoked_at: null,
    ...overrides,
  };
}

describe("generateToken", () => {
  test("carries the scannable prefix", () => {
    // Secret scanners match on prefixes. A bare base64 blob pasted into a
    // public repo is invisible to every one of them.
    assert.ok(generateToken().startsWith(TOKEN_PREFIX));
  });

  test("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateToken()));
    assert.equal(seen.size, 500);
  });

  test("carries enough entropy to be unguessable", () => {
    // 32 random bytes in base64url is ~43 chars. Well short of that would mean
    // the CSPRNG call was changed to something weaker.
    assert.ok(generateToken().length >= TOKEN_PREFIX.length + 40);
  });
});

describe("hashToken", () => {
  test("is stable and 64 hex chars", () => {
    const token = generateToken();
    assert.equal(hashToken(token), hashToken(token));
    assert.match(hashToken(token), /^[0-9a-f]{64}$/);
  });

  test("different tokens hash differently", () => {
    assert.notEqual(hashToken(generateToken()), hashToken(generateToken()));
  });

  test("ignores surrounding whitespace", () => {
    // Copy-paste out of a terminal picks up a trailing newline constantly, and
    // "your token is wrong" for an invisible character is a miserable bug.
    const token = generateToken();
    assert.equal(hashToken(`  ${token}\n`), hashToken(token));
  });
});

describe("tokenFromHeader", () => {
  test("reads a Bearer header", () => {
    assert.equal(tokenFromHeader("Bearer skr_abc"), "skr_abc");
    assert.equal(tokenFromHeader("bearer skr_abc"), "skr_abc");
  });

  test("accepts a bare token too", () => {
    // Clients differ, and pasting the raw value into the wrong config field
    // should give a working connection rather than a puzzle.
    assert.equal(tokenFromHeader("skr_abc"), "skr_abc");
  });

  test("returns null for nothing", () => {
    assert.equal(tokenFromHeader(null), null);
    assert.equal(tokenFromHeader("   "), null);
  });
});

describe("looksLikeToken", () => {
  test("rejects obvious non-tokens before a database round trip", () => {
    assert.equal(looksLikeToken("hello"), false);
    assert.equal(looksLikeToken("skr_short"), false);
    assert.equal(looksLikeToken(""), false);
  });

  test("accepts a real one", () => {
    assert.equal(looksLikeToken(generateToken()), true);
  });
});

describe("checkTokenRow", () => {
  test("a live token passes", () => {
    assert.equal(checkTokenRow(row(), NOW), null);
  });

  test("an unknown token is rejected", () => {
    assert.equal(checkTokenRow(null, NOW), "unknown");
  });

  test("revoked beats expired", () => {
    /*
      Order matters. Somebody who revoked a token after a scare needs to hear
      "revoked", not "expired" — the two call for completely different
      reactions, and only one of them means "you were right to worry".
    */
    const both = row({
      revoked_at: "2026-01-01T00:00:00Z",
      expires_at: "2026-01-01T00:00:00Z",
    });
    assert.equal(checkTokenRow(both, NOW), "revoked");
  });

  test("an expired token is rejected", () => {
    assert.equal(
      checkTokenRow(row({ expires_at: "2026-08-01T00:00:00Z" }), NOW),
      "expired"
    );
  });

  test("expiry is exclusive at the boundary", () => {
    // A token expiring exactly now is expired, not usable for one more call.
    assert.equal(
      checkTokenRow(row({ expires_at: NOW.toISOString() }), NOW),
      "expired"
    );
  });
});

describe("expiryFrom", () => {
  test("is 180 days out", () => {
    const expiry = Date.parse(expiryFrom(NOW));
    const days = (expiry - NOW.getTime()) / 86_400_000;
    assert.equal(Math.round(days), 180);
  });

  test("the token it produces is live today and dead after", () => {
    const live = row({ expires_at: expiryFrom(NOW) });
    assert.equal(checkTokenRow(live, NOW), null);

    const later = new Date(NOW.getTime() + 181 * 86_400_000);
    assert.equal(checkTokenRow(live, later), "expired");
  });
});

describe("scope and naming", () => {
  test("only read and write are scopes", () => {
    assert.equal(isTokenScope("read"), true);
    assert.equal(isTokenScope("write"), true);
    assert.equal(isTokenScope("admin"), false);
    assert.equal(isTokenScope(undefined), false);
  });

  test("names are trimmed, collapsed and capped", () => {
    assert.equal(
      cleanTokenName("  Claude   on my   laptop "),
      "Claude on my laptop"
    );
    assert.ok(cleanTokenName("x".repeat(200)).length <= 60);
    assert.equal(cleanTokenName("   "), "");
  });
});
