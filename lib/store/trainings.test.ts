/**
 * Trainings and facility access.
 *
 * Run with:  npm test
 *
 * The rules worth pinning, in order of how much they'd cost to get wrong:
 *
 *   1. Nobody self-verifies. It's what makes "verified" mean anything.
 *   2. A lapsed clearance is CANCELLED, not greyed out.
 *   3. The catalogue is data — a Co-Lead adds a machine, no deploy.
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

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-trainings-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let ops: typeof import("./operations.ts");
let disk: typeof import("./disk.ts");

const TODAY = "2026-08-10";
const MEMBER = "m-tyler";
const LEAD = "m-priya";
const CO_LEAD = "m-anish";
const LASER = "tr-l64-trotec";

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

function certFor(memberId: string, itemId: string) {
  return disk
    .readStore()
    .certifications.find((c) => c.memberId === memberId && c.itemId === itemId);
}

function requireCert(memberId: string, itemId: string) {
  const found = certFor(memberId, itemId);
  if (!found) throw new Error(`No certification for ${memberId} / ${itemId}`);
  return found;
}

async function request(itemId = LASER, memberId = MEMBER) {
  return ops.requestCertification({
    memberId,
    itemId,
    completedAt: "2026-08-01",
    today: TODAY,
  });
}

// ---------------------------------------------------------------------------

describe("the seeded catalogue matches the club's real shop", () => {
  test("the machines Anish listed are all there", () => {
    const store = disk.readStore();
    // Verbatim from the list. If this fails, the seed drifted from reality.
    for (const name of [
      "Trotec laser cutter",
      "Fablight metal laser cutter",
      "Vapor Phase One",
      "Reflow oven",
      "Vacuum former",
      "Makera desktop CNC",
      "H2D Printer",
      "Battery handling and soldering",
    ]) {
      assert.ok(
        store.catalogueItems.some((i) => i.name === name),
        `missing: ${name}`
      );
    }
  });

  test("Lab 64 and Lab 64 24-hour are separate accesses", () => {
    // One is not a property of the other. They're different clearances, and
    // modelling the second as a flag on the first would make it unrequestable.
    const access = disk
      .readStore()
      .catalogueItems.filter((i) => i.kind === "site_access")
      .map((i) => i.name);

    assert.ok(access.includes("Lab 64"));
    assert.ok(access.includes("Lab 64 — 24 hour"));
  });

  test("PRL has site access and CNCs, and nothing invented", () => {
    // Anish: "PRL has CNCs which require PRL training, else you only need to
    // get site access." Nothing else was made up to fill the section.
    const store = disk.readStore();
    const prl = store.trainingSections.find((s) => s.name === "PRL");
    const items = store.catalogueItems.filter((i) => i.sectionId === prl?.id);

    assert.deepEqual(
      items.map((i) => `${i.kind}:${i.name}`).sort(),
      ["machine:CNC machines", "site_access:PRL"]
    );
  });

  test("nothing expires yet", () => {
    // The expiry path is built and dormant, which is the correct state.
    assert.ok(
      disk.readStore().catalogueItems.every((i) => i.validityMonths === undefined)
    );
  });
});

describe("request and verify", () => {
  test("a member can request one", async () => {
    assert.equal((await request()).ok, true);
    assert.equal(certFor(MEMBER, LASER)?.status, "requested");
  });

  test("a future completion date is refused", async () => {
    const result = await ops.requestCertification({
      memberId: MEMBER,
      itemId: LASER,
      completedAt: "2027-01-01",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });

  test("NOBODY self-verifies — not even a Co-Lead", async () => {
    // The rule that makes "verified" mean anything at all. Enforced here as
    // well as in `can.verifyTraining`, because it's a safety record and one
    // layer is not enough.
    await request(LASER, CO_LEAD);
    const record = requireCert(CO_LEAD, LASER);

    const result = await ops.verifyCertification({
      certificationId: record.id,
      verifierId: CO_LEAD,
      today: TODAY,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /verify your own/i);
    assert.equal(certFor(CO_LEAD, LASER)?.status, "requested");
  });

  test("nor decides their own rejection", async () => {
    await request(LASER, CO_LEAD);
    const result = await ops.rejectCertification({
      certificationId: requireCert(CO_LEAD, LASER).id,
      verifierId: CO_LEAD,
    });
    assert.equal(result.ok, false);
  });

  test("a Lead verifies, and it records who and when", async () => {
    await request();
    const result = await ops.verifyCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      today: TODAY,
    });

    assert.equal(result.ok, true);
    const saved = certFor(MEMBER, LASER);
    assert.equal(saved?.status, "verified");
    assert.equal(saved?.verifiedById, LEAD);
    assert.equal(saved?.verifiedAt, TODAY);
  });

  test("requesting twice is refused rather than duplicated", async () => {
    await request();
    assert.equal((await request()).ok, false);
    assert.equal(
      disk.readStore().certifications.filter((c) => c.itemId === LASER).length,
      1
    );
  });

  test("re-requesting after a rejection reuses the row", async () => {
    // The normal path — you did the training properly the second time. A
    // second row would violate the unique index in SQL.
    await request();
    await ops.rejectCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      note: "Do the orientation first.",
    });
    assert.equal(certFor(MEMBER, LASER)?.status, "rejected");

    assert.equal((await request()).ok, true);
    assert.equal(certFor(MEMBER, LASER)?.status, "requested");
    // The old rejection note must not linger on the new request.
    assert.equal(certFor(MEMBER, LASER)?.note, undefined);
    assert.equal(
      disk.readStore().certifications.filter((c) => c.itemId === LASER).length,
      1
    );
  });

  test("an already-verified clearance can't be re-requested", async () => {
    await request();
    await ops.verifyCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      today: TODAY,
    });
    assert.equal((await request()).ok, false);
  });
});

describe("expiry cancels the clearance", () => {
  /** Give the laser a validity, since nothing in the real list has one. */
  function makeExpirable(months: number) {
    disk.readStore().catalogueItems.find((i) => i.id === LASER)!.validityMonths =
      months;
  }

  test("no expiry is set when the item never expires", async () => {
    await request();
    await ops.verifyCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      today: TODAY,
    });
    assert.equal(certFor(MEMBER, LASER)?.expiresAt, undefined);
  });

  test("expiry runs from the training date, not the sign-off date", async () => {
    // A clearance earned in March and verified in August lapses 12 months
    // after March. Starting the clock at sign-off silently extends it.
    makeExpirable(12);
    await ops.requestCertification({
      memberId: MEMBER,
      itemId: LASER,
      completedAt: "2026-03-15",
      today: TODAY,
    });
    await ops.verifyCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      today: TODAY,
    });

    assert.equal(certFor(MEMBER, LASER)?.expiresAt, "2027-03-15");
  });

  test("a month-end date clamps instead of rolling over", async () => {
    // 31 Jan + 1 month has no 31 Feb. Rolling into March would hand somebody
    // three extra days of clearance on a machine.
    //
    // The date is in the PAST because `requestCertification` refuses a future
    // completion date — you can't have been trained tomorrow. Which means this
    // clearance is also already lapsed, and that's fine: the assertion is
    // about the arithmetic, and the sweep is tested separately below.
    makeExpirable(1);
    await ops.requestCertification({
      memberId: MEMBER,
      itemId: LASER,
      completedAt: "2026-01-31",
      today: TODAY,
    });
    await ops.verifyCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      today: TODAY,
    });

    assert.equal(certFor(MEMBER, LASER)?.expiresAt, "2026-02-28");
  });

  test("a lapsed clearance is CANCELLED, not merely displayed as old", async () => {
    // Anish's rule, and the one that matters most here: an expired clearance
    // that still reads as valid is how somebody ends up on a machine they're
    // not cleared for.
    makeExpirable(1);
    await ops.requestCertification({
      memberId: MEMBER,
      itemId: LASER,
      completedAt: "2026-01-10",
      today: TODAY,
    });
    await ops.verifyCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      today: TODAY,
    });

    const swept = await ops.expireLapsedCertifications(TODAY);
    assert.equal(swept.ok, true);
    if (swept.ok) assert.equal(swept.value.length, 1);
    assert.equal(certFor(MEMBER, LASER)?.status, "expired");
  });

  test("a clearance still in date is untouched", async () => {
    makeExpirable(24);
    await request();
    await ops.verifyCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      today: TODAY,
    });

    await ops.expireLapsedCertifications(TODAY);
    assert.equal(certFor(MEMBER, LASER)?.status, "verified");
  });

  test("the sweep is idempotent", async () => {
    // It runs on every read of the trainings page, so this is load-bearing.
    assert.equal((await ops.expireLapsedCertifications(TODAY)).ok, true);
    const second = await ops.expireLapsedCertifications(TODAY);
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.value.length, 0);
  });

  test("a withdrawn clearance keeps its record", async () => {
    await request();
    await ops.verifyCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      today: TODAY,
    });

    const result = await ops.revokeCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      note: "Machine replaced.",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    assert.equal(certFor(MEMBER, LASER)?.status, "expired");
    assert.ok(certFor(MEMBER, LASER), "the row must survive being withdrawn");
  });
});

describe("the catalogue is data, not an enum", () => {
  test("a Co-Lead can add a machine and it exists for everyone", async () => {
    const result = await ops.createCatalogueItem({
      sectionId: "sec-lab64",
      name: "Waterjet",
      kind: "machine",
    });

    assert.equal(result.ok, true);
    // No deploy, no union type, no migration. This IS the requirement.
    assert.ok(disk.readStore().catalogueItems.some((i) => i.name === "Waterjet"));
  });

  test("and it's immediately requestable, unearned", async () => {
    const created = await ops.createCatalogueItem({
      sectionId: "sec-lab64",
      name: "Waterjet",
      kind: "machine",
    });
    if (!created.ok) throw new Error(created.error);

    assert.equal((await request(created.value.id)).ok, true);
  });

  test("a Co-Lead can add a whole new site", async () => {
    const section = await ops.createTrainingSection({ name: "Machine Shop 2" });
    assert.equal(section.ok, true);
    if (!section.ok) return;

    assert.equal(
      (
        await ops.createCatalogueItem({
          sectionId: section.value.id,
          name: "Bandsaw",
          kind: "machine",
        })
      ).ok,
      true
    );
  });

  test("a new site sorts before Misc", async () => {
    // Misc is the catch-all and belongs last however many sites get added.
    const section = await ops.createTrainingSection({ name: "New Lab" });
    if (!section.ok) throw new Error(section.error);

    const misc = disk.readStore().trainingSections.find((s) => s.name === "Misc");
    assert.ok(section.value.sortOrder < (misc?.sortOrder ?? 99));
  });

  test("duplicate sites are refused", async () => {
    assert.equal((await ops.createTrainingSection({ name: "Lab 64" })).ok, false);
  });

  test("duplicate names within one section are refused", async () => {
    const result = await ops.createCatalogueItem({
      sectionId: "sec-lab64",
      name: "Soldering",
      kind: "machine",
    });
    assert.equal(result.ok, false);
  });

  test("the same name in a DIFFERENT section is fine", async () => {
    // "3D printers" genuinely exists in both the Robotics Room and CHIP.
    const result = await ops.createCatalogueItem({
      sectionId: "sec-prl",
      name: "3D printers",
      kind: "machine",
    });
    assert.equal(result.ok, true);
  });

  test("a nonsense validity is refused", async () => {
    const result = await ops.createCatalogueItem({
      sectionId: "sec-lab64",
      name: "Something",
      kind: "machine",
      validityMonths: 0,
    });
    assert.equal(result.ok, false);
  });

  test("retiring hides an item without erasing who held it", async () => {
    await request();
    await ops.verifyCertification({
      certificationId: requireCert(MEMBER, LASER).id,
      verifierId: LEAD,
      today: TODAY,
    });

    assert.equal(
      (await ops.setCatalogueItemActive({ itemId: LASER, isActive: false })).ok,
      true
    );

    assert.equal(
      disk.readStore().catalogueItems.find((i) => i.id === LASER)?.isActive,
      false
    );
    // Deleting the item would erase the history of who was trained on what.
    assert.equal(certFor(MEMBER, LASER)?.status, "verified");
  });

  test("a retired item can't be requested", async () => {
    await ops.setCatalogueItemActive({ itemId: LASER, isActive: false });
    assert.equal((await request()).ok, false);
  });

  test("a retired item can be brought back", async () => {
    await ops.setCatalogueItemActive({ itemId: LASER, isActive: false });
    await ops.setCatalogueItemActive({ itemId: LASER, isActive: true });
    assert.equal((await request()).ok, true);
  });

  test("renaming keeps existing records pointing at it", async () => {
    await request();
    assert.equal(
      (
        await ops.updateCatalogueItem({
          itemId: LASER,
          name: "Trotec Speedy 400",
        })
      ).ok,
      true
    );

    assert.equal(
      disk.readStore().catalogueItems.find((i) => i.id === LASER)?.name,
      "Trotec Speedy 400"
    );
    assert.ok(certFor(MEMBER, LASER));
  });

  test("unknown ids fail rather than throwing", async () => {
    assert.equal(
      (await ops.setCatalogueItemActive({ itemId: "nope", isActive: false })).ok,
      false
    );
    assert.equal(
      (await ops.updateCatalogueItem({ itemId: "nope", name: "X" })).ok,
      false
    );
    assert.equal(
      (
        await ops.requestCertification({
          memberId: MEMBER,
          itemId: "nope",
          completedAt: "2026-08-01",
          today: TODAY,
        })
      ).ok,
      false
    );
  });
});
