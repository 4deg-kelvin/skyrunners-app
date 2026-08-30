/**
 * What the inline phase control offers.
 *
 * Run with:  npm test
 *
 * These rules were inline in the JSX first, which made them unverifiable
 * without a hydrated browser — the popover does not exist in the server HTML,
 * so fetching a project page cannot tell you what the list says. That is the
 * whole reason `lib/phase-control.ts` is a module.
 *
 * Nothing here is a guard. `setProjectPhaseAction` re-checks the permission and
 * `ops.updateProject` re-checks the descendants; a withheld button is a hint.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { blockedReason, phaseOptions } from "./phase-control.ts";

const clear = { canComplete: true, incompleteDescendants: [] };

describe("advancing one step", () => {
  test("offers the next phase in order", () => {
    assert.equal(
      phaseOptions({ phase: "manufacturing", ...clear }).advanceTo,
      "integration"
    );
    assert.equal(
      phaseOptions({ phase: "concept", ...clear }).advanceTo,
      "requirements"
    );
  });

  test("offers nothing past the end of the ladder", () => {
    assert.equal(
      phaseOptions({ phase: "complete", ...clear }).advanceTo,
      undefined
    );
  });

  test("from flight test, the next step is complete", () => {
    assert.equal(
      phaseOptions({ phase: "flight_test", ...clear }).advanceTo,
      "complete"
    );
  });
});

describe("who may cross into complete", () => {
  /*
    The narrower right. `can.completeProject` excludes the project's own PL --
    the person accountable for finishing it is not the person who agrees it is
    finished -- and this is the UI half of that rule.
  */
  test("withheld from somebody who cannot complete", () => {
    const o = phaseOptions({
      phase: "flight_test",
      canComplete: false,
      incompleteDescendants: [],
    });
    assert.equal(o.mayComplete, false);
    assert.equal(
      o.advanceTo,
      undefined,
      "and the one-click button is withheld, not offered-then-refused"
    );
  });

  test("withheld while a sub-project is unfinished, even from a Co-Lead", () => {
    const o = phaseOptions({
      phase: "flight_test",
      canComplete: true,
      incompleteDescendants: ["VIO Pipeline"],
    });
    assert.equal(o.mayComplete, false);
    assert.equal(o.advanceTo, undefined);
  });

  /*
    The earlier steps are unaffected by either. Blocking a move from
    manufacturing to integration because a CHILD is unfinished would be
    nonsense -- that is the normal state of a parent project.
  */
  test("neither limit touches the phases before complete", () => {
    const o = phaseOptions({
      phase: "manufacturing",
      canComplete: false,
      incompleteDescendants: ["VIO Pipeline", "Simulation Environment"],
    });
    assert.equal(o.advanceTo, "integration");
  });
});

describe("the reason names the fix", () => {
  test("unfinished children are listed, capped at two", () => {
    const r = blockedReason({
      canComplete: true,
      incompleteDescendants: [
        "Wing Spar",
        "Layup Qual",
        "Load Test",
        "Coupons",
      ],
    });
    assert.match(r, /Wing Spar and Layup Qual/);
    assert.match(r, /2 more/);
  });

  test("one child reads as a sentence, not a list of one", () => {
    const r = blockedReason({
      canComplete: true,
      incompleteDescendants: ["Wing Spar"],
    });
    assert.match(r, /Finish Wing Spar first/);
    assert.doesNotMatch(r, /and.*more/);
  });

  /*
    Order matters when both apply. "Go and finish those" is actionable; "ask
    somebody else" is a dead end while the children are still open, so it would
    send the reader to a person who would also have to refuse.
  */
  test("the descendant rule is stated first when both apply", () => {
    const r = blockedReason({
      canComplete: false,
      incompleteDescendants: ["Wing Spar"],
    });
    assert.match(r, /Finish Wing Spar/);
    assert.doesNotMatch(r, /Division Lead/);
  });

  test("permission alone names who to tell", () => {
    const r = blockedReason({ canComplete: false, incompleteDescendants: [] });
    assert.match(r, /PL above this project/);
    assert.match(r, /Tell them it's ready/);
  });

  test("nothing to say when nothing is blocking", () => {
    assert.equal(blockedReason(clear), "");
  });
});
