/**
 * Normalising what the advisor form submits.
 *
 * Run with:  npm test
 *
 * The form renders a fixed number of degree rows, so most submissions are mostly
 * blank. The behaviour worth pinning is which of those rows survive, and that a
 * typo in an optional field never costs somebody the whole entry.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  EARLIEST_DEGREE_YEAR,
  MAX_DEGREES,
  describeDegree,
  describeRole,
  normaliseAdvisorProfile,
} from "./profile.ts";

const YEAR = 2026;
const norm = (input: Parameters<typeof normaliseAdvisorProfile>[0]) =>
  normaliseAdvisorProfile({ thisYear: YEAR, ...input });

describe("degree rows", () => {
  test("blank rows are dropped without complaint", () => {
    /*
      Not a validation failure — it is the form's shape. Six rows are rendered and
      an advisor with two degrees submits four empty ones, so refusing the save
      would make the feature unusable.
    */
    const out = norm({
      degrees: [
        { degree: "PhD Aeronautics", school: "Stanford", year: "2011" },
        { degree: "", school: "", year: "" },
        { degree: "   ", year: "2020" },
      ],
    });
    assert.equal(out.degrees.length, 1);
    assert.deepEqual(out.degrees[0], {
      degree: "PhD Aeronautics",
      school: "Stanford",
      year: 2011,
    });
  });

  test("a bad year loses the year, not the degree", () => {
    // Losing a whole entry over a typo in an optional field is the worse outcome.
    for (const year of ["201", "20111", "abc", "1743", String(YEAR + 5)]) {
      const out = norm({ degrees: [{ degree: "MS Mech E", year }] });
      assert.equal(out.degrees.length, 1, `dropped the degree for ${year}`);
      assert.equal(out.degrees[0].year, undefined, `kept a bad year: ${year}`);
    }
  });

  test("this year and next are both accepted", () => {
    // Somebody finishing this year thinks of it as done; one year of slack.
    assert.equal(
      norm({ degrees: [{ degree: "MS", year: YEAR }] }).degrees[0].year,
      YEAR
    );
    assert.equal(
      norm({ degrees: [{ degree: "MS", year: YEAR + 1 }] }).degrees[0].year,
      YEAR + 1
    );
  });

  test("the earliest accepted year is a boundary, not a vibe", () => {
    assert.equal(
      norm({ degrees: [{ degree: "BS", year: EARLIEST_DEGREE_YEAR }] })
        .degrees[0].year,
      EARLIEST_DEGREE_YEAR
    );
    assert.equal(
      norm({ degrees: [{ degree: "BS", year: EARLIEST_DEGREE_YEAR - 1 }] })
        .degrees[0].year,
      undefined
    );
  });

  test("order is preserved — advisors put the relevant one first", () => {
    const out = norm({
      degrees: [{ degree: "PhD" }, { degree: "MS" }, { degree: "BS" }],
    });
    assert.deepEqual(
      out.degrees.map((d) => d.degree),
      ["PhD", "MS", "BS"]
    );
  });

  test(`no more than ${MAX_DEGREES} are kept`, () => {
    const many = Array.from({ length: MAX_DEGREES + 4 }, (_, i) => ({
      degree: `Degree ${i}`,
    }));
    assert.equal(norm({ degrees: many }).degrees.length, MAX_DEGREES);
  });

  test("whitespace is trimmed, and empty optional fields are omitted", () => {
    // Omitted rather than stored as "" — an empty string renders as a stray comma
    // through `describeDegree`.
    const out = norm({ degrees: [{ degree: "  PhD  ", school: "   " }] });
    assert.deepEqual(out.degrees[0], { degree: "PhD" });
  });
});

describe("current role", () => {
  test("either half alone still describes something", () => {
    assert.equal(
      describeRole({
        degrees: [],
        jobTitle: "Staff Engineer",
        employer: "Joby",
      }),
      "Staff Engineer at Joby"
    );
    assert.equal(
      describeRole({ degrees: [], jobTitle: "Professor" }),
      "Professor"
    );
    assert.equal(
      describeRole({ degrees: [], employer: "NASA Ames" }),
      "NASA Ames"
    );
    assert.equal(describeRole({ degrees: [] }), undefined);
  });

  test("blank strings do not become an empty role", () => {
    const out = norm({ jobTitle: "  ", employer: "" });
    assert.equal(out.jobTitle, undefined);
    assert.equal(describeRole(out), undefined);
  });
});

describe("rendering a degree", () => {
  test("missing parts are skipped rather than left as gaps", () => {
    assert.equal(
      describeDegree({ degree: "PhD Aero", school: "Stanford", year: 2011 }),
      "PhD Aero, Stanford, 2011"
    );
    assert.equal(
      describeDegree({ degree: "PhD Aero", year: 2011 }),
      "PhD Aero, 2011"
    );
    assert.equal(describeDegree({ degree: "PhD Aero" }), "PhD Aero");
  });
});
