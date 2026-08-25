/**
 * Who may verify a training, and the lock-out safeguard.
 *
 * `mayVerifyItem` is pure, so it is tested directly. The safeguard is tested
 * through `setGlobalRole` and `setMemberStatus` against a temp store, because
 * what matters about it is the MESSAGE as much as the refusal — a guard that
 * says "not allowed" without naming what is blocking it is the kind people work
 * around by deleting something else, and what they would delete here is a safety
 * record.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-verifiers-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;
process.on("exit", () => rmSync(TEST_DIR, { recursive: true, force: true }));

import { mayVerifyItem } from "./verifiers.ts";
import type { CatalogueVerifier } from "@/lib/types";

type Ops = typeof import("@/lib/store/operations");
type Disk = typeof import("@/lib/store/disk");
let ops: Ops;
let disk: Disk;

before(async () => {
  ops = await import("@/lib/store/operations");
  disk = await import("@/lib/store/disk");
});

beforeEach(() => {
  disk.resetStore();
});

// ---------------------------------------------------------------------------
// mayVerifyItem
// ---------------------------------------------------------------------------

const named = (verifierId: string): CatalogueVerifier => ({
  itemId: "i1",
  verifierId,
  selfVerify: false,
});
const selfVerify: CatalogueVerifier = { itemId: "i1", selfVerify: true };

const ask = (over: Partial<Parameters<typeof mayVerifyItem>[0]>) =>
  mayVerifyItem({
    actorId: "lead",
    isCoLead: false,
    subjectId: "member",
    fallbackAllowed: false,
    ...over,
  });

describe("an unconfigured item falls back to the role rule", () => {
  test("allowed when can.verifyTraining said yes", () => {
    // The interim "any Lead" rule. Deliberate rather than a gap: a catalogue of
    // thirty machines cannot be assigned in one sitting, and locking the
    // unassigned ones would keep people out of the shop.
    assert.equal(ask({ fallbackAllowed: true }), true);
  });

  test("refused when it said no", () => {
    assert.equal(ask({ fallbackAllowed: false }), false);
  });
});

describe("a named verifier is the only one who can sign it off", () => {
  test("the named person can", () => {
    assert.equal(ask({ config: named("lead"), fallbackAllowed: false }), true);
  });

  test("another Lead cannot, even though the role rule would allow it", () => {
    /*
      The whole point of naming somebody. If any Lead could still sign off the
      mill, naming Tyler would be a label rather than an assignment -- and the
      member asking would have no idea who to chase.
    */
    assert.equal(
      ask({
        actorId: "otherLead",
        config: named("lead"),
        fallbackAllowed: true,
      }),
      false
    );
  });

  test("not even for themselves", () => {
    // Two people sign off a safety clearance and one of them is never the
    // person being cleared.
    assert.equal(
      ask({ actorId: "lead", subjectId: "lead", config: named("lead") }),
      false
    );
  });

  test("a Co-Lead always can, which is the escape hatch", () => {
    /*
      Load-bearing. If the only person who can verify the mill graduates mid-
      quarter, somebody has to be able to act before the reassignment happens.
      A guard with no exit is worse than no guard.
    */
    assert.equal(
      ask({ actorId: "coLead", isCoLead: true, config: named("lead") }),
      true
    );
  });
});

describe("self-verify means the member, and only the member", () => {
  test("the member can tick their own", () => {
    assert.equal(
      ask({ actorId: "member", subjectId: "member", config: selfVerify }),
      true
    );
  });

  test("a Lead cannot tick it on somebody else's behalf", () => {
    /*
      Deliberately narrower than "anybody can". The value of self-verify is that
      the person attesting is the person who read the thing; a clearance somebody
      else claimed for you is a record you did not make.
    */
    assert.equal(
      ask({
        actorId: "lead",
        subjectId: "member",
        config: selfVerify,
        fallbackAllowed: true,
      }),
      false
    );
  });

  test("a Co-Lead still can, same escape hatch", () => {
    assert.equal(
      ask({ actorId: "coLead", isCoLead: true, config: selfVerify }),
      true
    );
  });
});

// ---------------------------------------------------------------------------
// The lock-out safeguard
// ---------------------------------------------------------------------------

/**
 * Make somebody the named verifier for the first catalogue item, and return its
 * name so the test can assert the refusal actually says it.
 */
async function assign(memberId: string): Promise<string> {
  const item = disk.readStore().catalogueItems[0];
  assert.ok(item, "the seed needs at least one catalogue item");

  await disk.mutate((store) => {
    (store.catalogueVerifiers ??= []).push({
      itemId: item.id,
      verifierId: memberId,
      selfVerify: false,
    });
  });
  return item.name;
}

function aLead(): string {
  const lead = disk
    .readStore()
    .members.find((m) => m.globalRole === "lead" && m.status === "active");
  assert.ok(lead, "the seed needs an active Team Lead");
  return lead.id;
}

describe("you cannot remove somebody who still verifies a training", () => {
  test("demoting them to member is refused, and the message names the item", async () => {
    const lead = aLead();
    const itemName = await assign(lead);

    const result = await ops.setGlobalRole({ memberId: lead, role: "member" });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, new RegExp(itemName.slice(0, 12), "i"));
      // Names the way out too. A refusal with no exit is the thing people work
      // around by deleting something else.
      assert.match(result.error, /somebody else|self-verify/i);
    }
  });

  test("deactivating them is refused for the same reason", async () => {
    /*
      This is the case that actually happens: a verifier graduates. It is also
      the one where a silent cascade would do real damage -- the mill would list
      an inactive verifier and nobody would find out until a request sat
      unanswered for a fortnight.
    */
    const lead = aLead();
    await assign(lead);

    const result = await ops.setMemberStatus({
      memberId: lead,
      status: "inactive",
    });
    assert.equal(result.ok, false);
  });

  test("converting them to an advisor is refused too", async () => {
    // An advisor holds no authority, so it is a demotion wearing a different
    // hat -- and the same machine ends up with nobody who can clear anyone.
    const lead = aLead();
    await assign(lead);

    const result = await ops.setGlobalRole({ memberId: lead, role: "advisor" });
    assert.equal(result.ok, false);
  });
});

describe("what the safeguard deliberately allows", () => {
  test("promoting them to Co-Lead is fine", async () => {
    // Takes nothing away: a Co-Lead can verify anything.
    const lead = aLead();
    await assign(lead);

    const result = await ops.setGlobalRole({ memberId: lead, role: "co_lead" });
    assert.equal(result.ok, true);
  });

  test("reassigning first unblocks the demotion", async () => {
    const lead = aLead();
    await assign(lead);

    const itemId = disk.readStore().catalogueItems[0].id;
    await disk.mutate((store) => {
      store.catalogueVerifiers = (store.catalogueVerifiers ?? []).filter(
        (v) => v.itemId !== itemId
      );
    });

    const result = await ops.setGlobalRole({ memberId: lead, role: "member" });
    assert.equal(result.ok, true);
  });

  test("marking the item self-verify unblocks it too", async () => {
    // The second exit the message offers, so it has to actually work.
    const lead = aLead();
    await assign(lead);

    const itemId = disk.readStore().catalogueItems[0].id;
    await disk.mutate((store) => {
      const row = (store.catalogueVerifiers ?? []).find(
        (v) => v.itemId === itemId
      );
      if (row) {
        row.verifierId = undefined;
        row.selfVerify = true;
      }
    });

    const result = await ops.setGlobalRole({ memberId: lead, role: "member" });
    assert.equal(result.ok, true);
  });

  test("somebody who verifies nothing is unaffected", async () => {
    const lead = aLead();
    const result = await ops.setGlobalRole({ memberId: lead, role: "member" });
    assert.equal(result.ok, true);
  });

  test("reactivating is never blocked", async () => {
    const lead = aLead();
    await assign(lead);

    const result = await ops.setMemberStatus({
      memberId: lead,
      status: "active",
    });
    assert.equal(result.ok, true);
  });
});
