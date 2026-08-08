/**
 * Tests for the persona list.
 *
 * Run with:  npm test
 *
 * These exist because the failure they prevent is silent. The persona list holds
 * mock member ids as strings; rename a member in `lib/mock-data.ts` or change
 * their role and the switcher would keep offering "Team Lead" while quietly
 * handing you a member — and you'd conclude a permission check was broken when
 * the fixture was.
 *
 * They also pin the two claims the personas are chosen to demonstrate (Tyler is a
 * member who is an RE; Sofia sits four levels deep), so if the mock data drifts
 * away from those, the reason each persona is on the list fails with it.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { TEST_PERSONAS, isKnownPersonaId } from "./personas.ts";
import { getMember, members, projects } from "../mock-data.ts";

describe("test personas", () => {
  test("every persona id resolves to a real mock member", () => {
    for (const persona of TEST_PERSONAS) {
      const member = getMember(persona.id);
      assert.ok(
        member,
        `Persona "${persona.label}" points at "${persona.id}", which is not in lib/mock-data.ts`
      );
    }
  });

  test("every persona's expectedRole still matches mock data", () => {
    for (const persona of TEST_PERSONAS) {
      assert.equal(
        getMember(persona.id)?.globalRole,
        persona.expectedRole,
        `Persona "${persona.label}" (${persona.id}) is labelled ${persona.expectedRole} but mock data says otherwise`
      );
    }
  });

  test("all three roles are covered", () => {
    const roles = new Set(TEST_PERSONAS.map((p) => p.expectedRole));
    for (const role of ["member", "lead", "co_lead"] as const) {
      assert.ok(roles.has(role), `No persona covers the ${role} role`);
    }
  });

  test("personas are unique", () => {
    const ids = TEST_PERSONAS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, "Duplicate persona id");
  });

  test("every persona is active — an inactive one would redirect", () => {
    // A persona whose status isn't `active` would send you to /auth/inactive in
    // live mode and read as a broken switcher in demo mode.
    for (const persona of TEST_PERSONAS) {
      assert.equal(
        getMember(persona.id)?.status,
        "active",
        `Persona "${persona.label}" is not active`
      );
    }
  });

  test("ids outside the list are rejected", () => {
    assert.equal(isKnownPersonaId("m-anish"), true);
    assert.equal(isKnownPersonaId("m-nobody"), false);
    assert.equal(isKnownPersonaId(""), false);
    assert.equal(isKnownPersonaId(undefined), false);
    // The cookie is user-editable, so this is the guard that keeps a crafted
    // value from reaching getMember().
    assert.equal(isKnownPersonaId("../../etc/passwd"), false);
  });

  describe("the properties each persona was chosen for", () => {
    test("Tyler is a plain member who is nonetheless an RE", () => {
      const tyler = getMember("m-tyler");
      assert.equal(tyler?.globalRole, "member");
      assert.ok(
        projects.some((p) => p.reIds.includes("m-tyler")),
        "m-tyler is no longer an RE of anything — the persona that catches inline role checks is now pointless"
      );
    });

    test("Dev is a Lead with no RE role", () => {
      assert.equal(getMember("m-dev")?.globalRole, "lead");
      assert.ok(
        !projects.some((p) => p.reIds.includes("m-dev")),
        "m-dev is now an RE, so he no longer demonstrates Lead-without-RE"
      );
    });

    test("Sofia sits at least three levels below a Co-Lead", () => {
      let depth = 0;
      let current = getMember("m-sofia");
      while (current?.leadId) {
        current = getMember(current.leadId);
        depth++;
        assert.ok(depth < 20, "Cycle in the mock reporting chain");
      }
      assert.ok(
        depth >= 3,
        `Expected Sofia's chain to be 3+ deep, got ${depth}`
      );
    });

    test("Grace has no primary team", () => {
      assert.equal(
        getMember("m-grace")?.primaryTeamId,
        undefined,
        "m-grace now has a division, so she no longer covers the missing-team case"
      );
    });

    test("Priya oversees someone two levels down", () => {
      // The whole point of question 3 in lib/permissions.ts: Lead authority
      // flows UP a chain, so Priya must have at least one indirect report.
      const directs = members.filter((m) => m.leadId === "m-priya");
      const indirect = members.filter(
        (m) => m.leadId && directs.some((d) => d.id === m.leadId)
      );
      assert.ok(
        indirect.length > 0,
        "Nobody reports to one of Priya's directs, so multi-level Lead authority is untested"
      );
    });
  });
});
